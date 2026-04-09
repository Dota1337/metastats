import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../lib/supabase';

/**
 * AI Coach — Role-specific performance analysis
 * Each role gets its own categories, benchmarks, and advice.
 * A Top-Laner is judged on splitpush & lane dominance, not on Support-level vision.
 */

// ─── Role-specific category definitions ─────────────────────────────────────

interface RoleCategory {
  key: string;
  name: string;
  weight: number;        // importance for overall score (higher = more important)
  inverse?: boolean;     // lower is better (e.g. deaths)
  compute: (matches: any[], avgDuration: number) => number;
  benchmarks: Record<string, number>; // per tier
  advice: { good: string; bad: string };
}

const TIERS = ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND', 'EMERALD', 'PLATINUM', 'GOLD', 'DEFAULT'] as const;

// Helper functions for stat computation
const sumAvg = (matches: any[], getter: (m: any) => number) =>
  matches.reduce((s, m) => s + getter(m), 0) / matches.length;

const getDmgPerMin = (m: any) => {
  if (m.damagePerMinute) return m.damagePerMinute;
  return (m.damageDealt || 0) / Math.max((m.gameDuration || 1800) / 60, 1);
};

const getGoldPerMin = (m: any) => {
  if (m.goldPerMinute) return m.goldPerMinute;
  return (m.goldEarned || 0) / Math.max((m.gameDuration || 1800) / 60, 1);
};

const getDmgShare = (m: any) => {
  if (m.teamDamagePercentage != null && m.teamDamagePercentage > 0) return m.teamDamagePercentage * 100;
  if (m.damageDealt && m.teamDamage && m.teamDamage > 0) return (m.damageDealt / m.teamDamage) * 100;
  return 20; // fallback
};

const getKP = (m: any) => {
  const teamKills = m.teamKills || 1;
  return ((m.kills + m.assists) / Math.max(teamKills, 1)) * 100;
};

const getObjDmg = (m: any) => {
  return ((m.damageDealtToBuildings || 0) + (m.damageDealtToObjectives || 0)) / Math.max((m.gameDuration || 1800) / 60, 1);
};

// ─── TOP LANE ────────────────────────────────────────────────────────────────

const TOP_CATEGORIES: RoleCategory[] = [
  {
    key: 'csPerMin', name: 'CS-Effizienz', weight: 1.2,
    compute: (ms, dur) => sumAvg(ms, m => m.cs || 0) / dur,
    benchmarks: { CHALLENGER: 8.5, GRANDMASTER: 8.0, MASTER: 7.6, DIAMOND: 7.2, EMERALD: 6.7, PLATINUM: 6.2, GOLD: 5.7, DEFAULT: 5.2 },
    advice: { good: 'Exzellentes Farming — du generierst konstant Gold-Vorteile.', bad: 'Arbeite am CS: Sidelane-Farm nach der Lane-Phase ist für Top-Laner essenziell.' },
  },
  {
    key: 'damagePerMin', name: 'Schaden/Minute', weight: 1.0,
    compute: (ms) => sumAvg(ms, getDmgPerMin),
    benchmarks: { CHALLENGER: 750, GRANDMASTER: 700, MASTER: 660, DIAMOND: 620, EMERALD: 570, PLATINUM: 520, GOLD: 470, DEFAULT: 420 },
    advice: { good: 'Starker Schadensoutput — du nutzt deine Items effektiv.', bad: 'Versuche mehr Trades in der Lane und suche Teamfight-Flanken.' },
  },
  {
    key: 'kda', name: 'KDA', weight: 1.0,
    compute: (ms) => { const k = ms.reduce((s: number, m: any) => s + m.kills, 0); const d = ms.reduce((s: number, m: any) => s + m.deaths, 0); const a = ms.reduce((s: number, m: any) => s + m.assists, 0); return (k + a) / Math.max(d, 1); },
    benchmarks: { CHALLENGER: 3.5, GRANDMASTER: 3.2, MASTER: 2.9, DIAMOND: 2.6, EMERALD: 2.4, PLATINUM: 2.2, GOLD: 2.0, DEFAULT: 1.8 },
    advice: { good: 'Starke KDA — du stirbst selten und bist trotzdem in Kills involviert.', bad: 'Achte auf deine Tode: wurden sie durch schlechtes Wave-Management oder fehlende Vision verursacht?' },
  },
  {
    key: 'deathsPerGame', name: 'Überlebensfähigkeit', weight: 1.1, inverse: true,
    compute: (ms) => sumAvg(ms, m => m.deaths || 0),
    benchmarks: { CHALLENGER: 3.5, GRANDMASTER: 3.8, MASTER: 4.2, DIAMOND: 4.8, EMERALD: 5.3, PLATINUM: 5.8, GOLD: 6.3, DEFAULT: 7.0 },
    advice: { good: 'Wenige Tode — du überlebst Ganks und 1v2-Situationen gut.', bad: 'Zu viele Tode auf der Toplane. Warde den River und tracke den feindlichen Jungler.' },
  },
  {
    key: 'goldPerMin', name: 'Gold-Effizienz', weight: 0.9,
    compute: (ms) => sumAvg(ms, getGoldPerMin),
    benchmarks: { CHALLENGER: 470, GRANDMASTER: 445, MASTER: 420, DIAMOND: 400, EMERALD: 375, PLATINUM: 355, GOLD: 335, DEFAULT: 310 },
    advice: { good: 'Hohe Gold-Generierung — Splitpush und Farm-Rotationen sitzen.', bad: 'Achte auf Sidelane-Waves und Jungle-Camps zwischen Teamfights.' },
  },
  {
    key: 'dmgShare', name: 'Schadensanteil', weight: 0.8,
    compute: (ms) => sumAvg(ms, getDmgShare),
    benchmarks: { CHALLENGER: 27, GRANDMASTER: 26, MASTER: 25, DIAMOND: 25, EMERALD: 24, PLATINUM: 24, GOLD: 23, DEFAULT: 22 },
    advice: { good: 'Du trägst einen großen Teil des Teamschadens — starkes Carry-Potenzial.', bad: 'Dein Schadensanteil ist niedrig. Als Top-Laner solltest du in Teamfights oder Splitpush Druck machen.' },
  },
];

// ─── JUNGLE ──────────────────────────────────────────────────────────────────

const JUNGLE_CATEGORIES: RoleCategory[] = [
  {
    key: 'killParticipation', name: 'Kill Participation', weight: 1.3,
    compute: (ms) => sumAvg(ms, getKP),
    benchmarks: { CHALLENGER: 72, GRANDMASTER: 70, MASTER: 67, DIAMOND: 64, EMERALD: 60, PLATINUM: 56, GOLD: 52, DEFAULT: 48 },
    advice: { good: 'Du bist an den meisten Kills beteiligt — starkes Ganking und Rotieren.', bad: 'Du verpasst zu viele Plays. Als Jungler musst du proaktiv Lanes beeinflussen.' },
  },
  {
    key: 'kda', name: 'KDA', weight: 1.0,
    compute: (ms) => { const k = ms.reduce((s: number, m: any) => s + m.kills, 0); const d = ms.reduce((s: number, m: any) => s + m.deaths, 0); const a = ms.reduce((s: number, m: any) => s + m.assists, 0); return (k + a) / Math.max(d, 1); },
    benchmarks: { CHALLENGER: 4.0, GRANDMASTER: 3.6, MASTER: 3.3, DIAMOND: 3.0, EMERALD: 2.7, PLATINUM: 2.4, GOLD: 2.2, DEFAULT: 2.0 },
    advice: { good: 'Hohe KDA — du wählst deine Ganks klug und stirbst nicht unnötig.', bad: 'Achte darauf, nur Ganks zu nehmen mit hoher Erfolgswahrscheinlichkeit.' },
  },
  {
    key: 'visionScore', name: 'Vision Control', weight: 1.1,
    compute: (ms, dur) => sumAvg(ms, m => m.visionScore || 0) / dur,
    benchmarks: { CHALLENGER: 1.8, GRANDMASTER: 1.6, MASTER: 1.5, DIAMOND: 1.3, EMERALD: 1.1, PLATINUM: 0.9, GOLD: 0.7, DEFAULT: 0.6 },
    advice: { good: 'Starke Vision — du kontrollierst die Karte für dein Team.', bad: 'Als Jungler bist du verantwortlich für River- und Objective-Vision. Kaufe mehr Control Wards.' },
  },
  {
    key: 'csPerMin', name: 'Farm-Effizienz', weight: 0.9,
    compute: (ms, dur) => sumAvg(ms, m => m.cs || 0) / dur,
    benchmarks: { CHALLENGER: 6.5, GRANDMASTER: 6.2, MASTER: 5.9, DIAMOND: 5.5, EMERALD: 5.2, PLATINUM: 4.8, GOLD: 4.5, DEFAULT: 4.0 },
    advice: { good: 'Du farmst effizient zwischen Ganks — gutes Jungle-Pathing.', bad: 'Deine Farm ist zu niedrig. Optimiere dein Pathing: Full-Clear vs. Gank-Heavy Route.' },
  },
  {
    key: 'deathsPerGame', name: 'Überlebensfähigkeit', weight: 1.0, inverse: true,
    compute: (ms) => sumAvg(ms, m => m.deaths || 0),
    benchmarks: { CHALLENGER: 3.5, GRANDMASTER: 3.8, MASTER: 4.2, DIAMOND: 4.8, EMERALD: 5.3, PLATINUM: 5.8, GOLD: 6.5, DEFAULT: 7.0 },
    advice: { good: 'Wenige Tode — du positionierst dich gut und wählst Fights klug.', bad: 'Zu viele Tode. Vermeide 50/50-Plays und tracke den feindlichen Jungler besser.' },
  },
  {
    key: 'objectiveDmg', name: 'Objektiv-Kontrolle', weight: 0.8,
    compute: (ms) => sumAvg(ms, getObjDmg),
    benchmarks: { CHALLENGER: 350, GRANDMASTER: 320, MASTER: 290, DIAMOND: 260, EMERALD: 230, PLATINUM: 200, GOLD: 170, DEFAULT: 140 },
    advice: { good: 'Du priorisierst Objektive effektiv — Drake und Baron im Fokus.', bad: 'Mehr Fokus auf Drakes und Baron. Spiele um Objective-Timer, nicht nur um Kills.' },
  },
];

// ─── MID LANE ────────────────────────────────────────────────────────────────

const MID_CATEGORIES: RoleCategory[] = [
  {
    key: 'csPerMin', name: 'CS-Effizienz', weight: 1.1,
    compute: (ms, dur) => sumAvg(ms, m => m.cs || 0) / dur,
    benchmarks: { CHALLENGER: 8.5, GRANDMASTER: 8.0, MASTER: 7.6, DIAMOND: 7.2, EMERALD: 6.7, PLATINUM: 6.2, GOLD: 5.7, DEFAULT: 5.2 },
    advice: { good: 'Starkes Farming — du nutzt Mid-Prio für Jungle-Camps und Waves.', bad: 'Dein CS ist zu niedrig. Nutze Mid-Prio: Pushe die Wave, nimm Raptors/Wolves.' },
  },
  {
    key: 'damagePerMin', name: 'Schaden/Minute', weight: 1.2,
    compute: (ms) => sumAvg(ms, getDmgPerMin),
    benchmarks: { CHALLENGER: 800, GRANDMASTER: 750, MASTER: 700, DIAMOND: 650, EMERALD: 600, PLATINUM: 550, GOLD: 500, DEFAULT: 450 },
    advice: { good: 'Exzellenter Schadensoutput — du bist die Carry-Kraft deines Teams.', bad: 'Dein Schaden ist unterdurchschnittlich. Suche mehr Trades und nutze Powerspikes.' },
  },
  {
    key: 'kda', name: 'KDA', weight: 1.0,
    compute: (ms) => { const k = ms.reduce((s: number, m: any) => s + m.kills, 0); const d = ms.reduce((s: number, m: any) => s + m.deaths, 0); const a = ms.reduce((s: number, m: any) => s + m.assists, 0); return (k + a) / Math.max(d, 1); },
    benchmarks: { CHALLENGER: 4.0, GRANDMASTER: 3.6, MASTER: 3.3, DIAMOND: 3.0, EMERALD: 2.7, PLATINUM: 2.4, GOLD: 2.2, DEFAULT: 2.0 },
    advice: { good: 'Starke KDA — du maximierst Kills bei minimalen Toden.', bad: 'Vermeide unnötige Solo-Plays. Mid-Laner haben hohen Impact — jeder Tod kostet Map-Prio.' },
  },
  {
    key: 'killParticipation', name: 'Kill Participation', weight: 1.0,
    compute: (ms) => sumAvg(ms, getKP),
    benchmarks: { CHALLENGER: 65, GRANDMASTER: 62, MASTER: 60, DIAMOND: 57, EMERALD: 54, PLATINUM: 50, GOLD: 47, DEFAULT: 44 },
    advice: { good: 'Du bist bei vielen Kills beteiligt — starkes Roaming und Teamplay.', bad: 'Du verpasst Plays. Nutze Prio zum Roamen und unterstütze Skirmishes.' },
  },
  {
    key: 'deathsPerGame', name: 'Überlebensfähigkeit', weight: 0.9, inverse: true,
    compute: (ms) => sumAvg(ms, m => m.deaths || 0),
    benchmarks: { CHALLENGER: 3.5, GRANDMASTER: 3.8, MASTER: 4.2, DIAMOND: 4.8, EMERALD: 5.3, PLATINUM: 5.8, GOLD: 6.3, DEFAULT: 7.0 },
    advice: { good: 'Wenige Tode — du positionierst dich sicher trotz zentraler Rolle.', bad: 'Zu viele Tode. Respektiere feindliche Jungler-Ganks und warde aggressive Spots.' },
  },
  {
    key: 'goldPerMin', name: 'Gold-Effizienz', weight: 0.8,
    compute: (ms) => sumAvg(ms, getGoldPerMin),
    benchmarks: { CHALLENGER: 460, GRANDMASTER: 440, MASTER: 420, DIAMOND: 400, EMERALD: 375, PLATINUM: 355, GOLD: 335, DEFAULT: 310 },
    advice: { good: 'Hohe Gold-Generierung — du nutzt deine Ressourcen optimal.', bad: 'Farm mehr Sidelane-Waves und Jungle-Camps nach der Lane-Phase.' },
  },
];

// ─── ADC / BOTTOM ────────────────────────────────────────────────────────────

const ADC_CATEGORIES: RoleCategory[] = [
  {
    key: 'csPerMin', name: 'CS-Effizienz', weight: 1.3,
    compute: (ms, dur) => sumAvg(ms, m => m.cs || 0) / dur,
    benchmarks: { CHALLENGER: 9.0, GRANDMASTER: 8.5, MASTER: 8.0, DIAMOND: 7.5, EMERALD: 7.0, PLATINUM: 6.5, GOLD: 6.0, DEFAULT: 5.5 },
    advice: { good: 'Exzellentes Farming — als ADC dein wichtigster Skill.', bad: 'CS ist die #1 Priorität für ADCs. Übe Last-Hitting und greife Sidelane-Waves ab.' },
  },
  {
    key: 'damagePerMin', name: 'Schaden/Minute', weight: 1.3,
    compute: (ms) => sumAvg(ms, getDmgPerMin),
    benchmarks: { CHALLENGER: 850, GRANDMASTER: 800, MASTER: 750, DIAMOND: 700, EMERALD: 640, PLATINUM: 580, GOLD: 520, DEFAULT: 460 },
    advice: { good: 'Top-Schadensoutput — du bist der primäre Carry deines Teams.', bad: 'Dein Schaden ist für einen ADC zu niedrig. Positioniere dich in Teamfights sicher und hit den nächsten Gegner.' },
  },
  {
    key: 'dmgShare', name: 'Schadensanteil', weight: 1.0,
    compute: (ms) => sumAvg(ms, getDmgShare),
    benchmarks: { CHALLENGER: 32, GRANDMASTER: 31, MASTER: 30, DIAMOND: 29, EMERALD: 28, PLATINUM: 27, GOLD: 26, DEFAULT: 25 },
    advice: { good: 'Du trägst den größten Teil des Teamschadens — so soll ein ADC spielen.', bad: 'Dein Schadensanteil ist zu niedrig. Ein ADC sollte 28-35% des Teamschadens ausmachen.' },
  },
  {
    key: 'deathsPerGame', name: 'Überlebensfähigkeit', weight: 1.2, inverse: true,
    compute: (ms) => sumAvg(ms, m => m.deaths || 0),
    benchmarks: { CHALLENGER: 3.0, GRANDMASTER: 3.3, MASTER: 3.8, DIAMOND: 4.3, EMERALD: 5.0, PLATINUM: 5.5, GOLD: 6.0, DEFAULT: 6.5 },
    advice: { good: 'Wenige Tode — du überlebst Teamfights und lieferst konstant Schaden.', bad: 'Ein toter ADC macht 0 Schaden. Arbeite an deiner Positionierung und Flash-Nutzung.' },
  },
  {
    key: 'kda', name: 'KDA', weight: 0.9,
    compute: (ms) => { const k = ms.reduce((s: number, m: any) => s + m.kills, 0); const d = ms.reduce((s: number, m: any) => s + m.deaths, 0); const a = ms.reduce((s: number, m: any) => s + m.assists, 0); return (k + a) / Math.max(d, 1); },
    benchmarks: { CHALLENGER: 4.5, GRANDMASTER: 4.0, MASTER: 3.6, DIAMOND: 3.2, EMERALD: 2.8, PLATINUM: 2.5, GOLD: 2.2, DEFAULT: 2.0 },
    advice: { good: 'Starke KDA — du maximierst deinen Impact bei minimalen Toden.', bad: 'Vermeide 1v1-Fights ohne Support. ADC gewinnt durch konstanten DPS, nicht durch Solo-Plays.' },
  },
  {
    key: 'goldPerMin', name: 'Gold-Effizienz', weight: 0.8,
    compute: (ms) => sumAvg(ms, getGoldPerMin),
    benchmarks: { CHALLENGER: 480, GRANDMASTER: 460, MASTER: 440, DIAMOND: 415, EMERALD: 390, PLATINUM: 365, GOLD: 340, DEFAULT: 315 },
    advice: { good: 'Hohe Gold-Generierung — du erreichst deine Powerspikes schnell.', bad: 'Optimiere dein Gold: Sidelane-Farm, Shutdown-Bounties, und Tower-Plates.' },
  },
];

// ─── SUPPORT ─────────────────────────────────────────────────────────────────

const SUPPORT_CATEGORIES: RoleCategory[] = [
  {
    key: 'visionScore', name: 'Vision Control', weight: 1.4,
    compute: (ms, dur) => sumAvg(ms, m => m.visionScore || 0) / dur,
    benchmarks: { CHALLENGER: 3.5, GRANDMASTER: 3.2, MASTER: 2.9, DIAMOND: 2.5, EMERALD: 2.1, PLATINUM: 1.8, GOLD: 1.4, DEFAULT: 1.0 },
    advice: { good: 'Exzellente Vision — du kontrollierst die Karte und gibst deinem Team Informationsvorteile.', bad: 'Vision ist deine #1 Aufgabe. Kaufe IMMER Control Wards und nutze Trinket auf Cooldown.' },
  },
  {
    key: 'killParticipation', name: 'Kill Participation', weight: 1.3,
    compute: (ms) => sumAvg(ms, getKP),
    benchmarks: { CHALLENGER: 75, GRANDMASTER: 73, MASTER: 70, DIAMOND: 67, EMERALD: 63, PLATINUM: 59, GOLD: 55, DEFAULT: 50 },
    advice: { good: 'Du bist an fast allen Kills beteiligt — perfektes Roaming und Teamplay.', bad: 'Du verpasst zu viele Fights. Rotiere aktiver und sei bei Objektiven präsent.' },
  },
  {
    key: 'kda', name: 'KDA', weight: 1.0,
    compute: (ms) => { const k = ms.reduce((s: number, m: any) => s + m.kills, 0); const d = ms.reduce((s: number, m: any) => s + m.deaths, 0); const a = ms.reduce((s: number, m: any) => s + m.assists, 0); return (k + a) / Math.max(d, 1); },
    benchmarks: { CHALLENGER: 4.5, GRANDMASTER: 4.0, MASTER: 3.6, DIAMOND: 3.2, EMERALD: 2.8, PLATINUM: 2.5, GOLD: 2.2, DEFAULT: 2.0 },
    advice: { good: 'Hohe KDA — du assistierst effektiv und stirbst selten unnötig.', bad: 'Zu viele Tode. Als Support ist Überleben wichtig — ein toter Support gibt keine Vision und kein Peel.' },
  },
  {
    key: 'deathsPerGame', name: 'Überlebensfähigkeit', weight: 1.1, inverse: true,
    compute: (ms) => sumAvg(ms, m => m.deaths || 0),
    benchmarks: { CHALLENGER: 3.5, GRANDMASTER: 4.0, MASTER: 4.5, DIAMOND: 5.0, EMERALD: 5.5, PLATINUM: 6.0, GOLD: 6.5, DEFAULT: 7.0 },
    advice: { good: 'Wenige Tode — du positionierst dich gut und gehst keine unnötigen Risiken ein.', bad: 'Stirb weniger. Gehe nicht alleine in unwarded Gebiete und tracke feindliche Cooldowns.' },
  },
  {
    key: 'wardsPerMin', name: 'Ward-Frequenz', weight: 1.0,
    compute: (ms, dur) => sumAvg(ms, m => m.wardsPlaced || 0) / dur,
    benchmarks: { CHALLENGER: 1.5, GRANDMASTER: 1.4, MASTER: 1.3, DIAMOND: 1.1, EMERALD: 0.9, PLATINUM: 0.8, GOLD: 0.6, DEFAULT: 0.5 },
    advice: { good: 'Du wardest konstant — dein Team hat immer Informationen.', bad: 'Mehr Wards setzen! Ziel: 1+ Ward pro Minute. Platziere sie proaktiv vor Objektiven.' },
  },
  {
    key: 'utility', name: 'Utility-Score', weight: 0.8,
    compute: (ms, dur) => {
      const heals = sumAvg(ms, m => m.totalHealsOnTeammates || 0);
      const shields = sumAvg(ms, m => m.totalDamageShieldedOnTeammates || 0);
      const cc = sumAvg(ms, m => m.timeCCingOthers || 0);
      // Normalize: heals+shields in thousands + CC seconds
      return (heals + shields) / 1000 + cc;
    },
    benchmarks: { CHALLENGER: 20, GRANDMASTER: 18, MASTER: 16, DIAMOND: 14, EMERALD: 12, PLATINUM: 10, GOLD: 8, DEFAULT: 6 },
    advice: { good: 'Starke Utility — du schützt dein Team effektiv mit Heals, Shields und CC.', bad: 'Nutze deine Abilities aktiver zum Schutz deines Teams. Heal/Shield-Timing ist entscheidend.' },
  },
];

// ─── Role category map ───────────────────────────────────────────────────────

const ROLE_CATEGORIES: Record<string, RoleCategory[]> = {
  TOP: TOP_CATEGORIES,
  JUNGLE: JUNGLE_CATEGORIES,
  MID: MID_CATEGORIES,
  MIDDLE: MID_CATEGORIES,
  BOTTOM: ADC_CATEGORIES,
  ADC: ADC_CATEGORIES,
  UTILITY: SUPPORT_CATEGORIES,
  SUPPORT: SUPPORT_CATEGORIES,
};

// ─── Scoring & grading ──────────────────────────────────────────────────────

function getGrade(score: number): string {
  if (score >= 85) return 'S+';
  if (score >= 75) return 'S';
  if (score >= 65) return 'A';
  if (score >= 55) return 'B';
  if (score >= 45) return 'C';
  if (score >= 35) return 'D';
  return 'D-';
}

function computePercentile(playerVal: number, benchmarkVal: number, inverse: boolean): number {
  if (benchmarkVal === 0) return 60;
  let ratio: number;
  if (inverse) {
    ratio = benchmarkVal / Math.max(playerVal, 0.1);
  } else {
    ratio = playerVal / benchmarkVal;
  }
  // Meeting the benchmark for your tier = 60 (solid B).
  // Exceeding it = up to 100, falling short = down to 0.
  // A Challenger player who hits Challenger averages IS good.
  if (ratio >= 1) {
    // Above benchmark: 60-100 range
    return Math.min(100, Math.round(60 + (ratio - 1) * 200));
  } else {
    // Below benchmark: 0-60 range, scaled
    return Math.max(0, Math.round(ratio * 60));
  }
}

function getImprovementTip(role: string, weaknesses: any[]): string {
  if (weaknesses.length === 0) return 'Du performst auf allen Ebenen überdurchschnittlich. Fokussiere dich auf Konsistenz.';
  const top = weaknesses[0];

  const roleTips: Record<string, Record<string, string>> = {
    TOP: {
      csPerMin: 'Farming ist als Top-Laner dein wichtigstes Tool. 1 CS/Min mehr = ~500 Gold/Spiel Vorteil.',
      deathsPerGame: 'Auf der Toplane allein zu sterben kostet deinem Team massiv. Warde den River und respektiere Ganks.',
      damagePerMin: 'Suche aktiver Trades und nutze Teleport für Teamfight-Flanken.',
    },
    JUNGLE: {
      killParticipation: 'Dein Einfluss auf das Spiel hängt von deiner Präsenz ab. Gank mehr oder invade aggressiver.',
      visionScore: 'Kontrolliere River und feindlichen Jungle mit Wards. Vision = Information = Kontrolle.',
      deathsPerGame: 'Jungle-Tode geben dem Gegner Objektiv-Kontrolle. Vermeide 50/50-Plays.',
    },
    MID: {
      damagePerMin: 'Als Mid-Laner bist du der primäre Damage-Dealer. Trade aggressiver und nutze Powerspikes.',
      csPerMin: 'Nutze Mid-Prio: Push die Wave und nimm Raptors/Wolves. Jede verpasste Wave kostet dich.',
      killParticipation: 'Nutze deine zentrale Position zum Roamen. River-Fights und Jungle-Invades gewinnen Spiele.',
    },
    BOTTOM: {
      csPerMin: 'CS ist deine #1 Goldquelle. Als ADC musst du 8+ CS/Min anstreben. Übe Last-Hitting.',
      deathsPerGame: 'Ein toter ADC = 0 DPS. Positioniere dich hinter deinem Team und nutze Flash defensiv.',
      damagePerMin: 'Dein Job ist maximaler Schaden. Triff in Teamfights den nächsten Gegner — nicht den am weitesten entfernten.',
    },
    SUPPORT: {
      visionScore: 'Vision ist dein #1 Job. Kaufe JEDES Recall eine Control Ward und nutze Trinket auf Cooldown.',
      killParticipation: 'Sei bei jedem Play dabei. Roame nach dem Pushen der Botlane-Wave.',
      deathsPerGame: 'Stirb weniger. Gehe nicht alleine warden ohne Info über feindliche Positionen.',
    },
  };

  const tips = roleTips[role] || roleTips.MID || {};
  return tips[top.category] || `Fokussiere dich auf ${top.title} — das hat den größten Einfluss auf dein Spiel.`;
}

// ─── API Routes ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const puuid = request.nextUrl.searchParams.get('puuid');
  if (!puuid) return NextResponse.json({ error: 'puuid required' }, { status: 400 });

  try {
    const { data: player } = await supabase.from('players').select('*').eq('puuid', puuid).single();
    if (!player) return NextResponse.json({ error: 'Spieler nicht gefunden' }, { status: 404 });

    return NextResponse.json({ tier: player.tier || 'GOLD', playerName: player.summoner_name });
  } catch {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { matches, tier, role: playerRole } = await request.json();
    if (!matches || !Array.isArray(matches) || matches.length === 0) {
      return NextResponse.json({ error: 'Match-Daten erforderlich' }, { status: 400 });
    }

    const effectiveTier = tier || 'GOLD';
    const role = playerRole || detectRole(matches);
    const normalizedRole = normalizeRole(role);
    const categories = ROLE_CATEGORIES[normalizedRole] || MID_CATEGORIES;
    const gamesAnalyzed = matches.length;
    const avgDuration = matches.reduce((s: number, m: any) => s + (m.gameDuration || 1800), 0) / gamesAnalyzed / 60;

    // Evaluate each category
    const insights: any[] = [];

    for (const cat of categories) {
      const playerVal = cat.compute(matches, avgDuration);
      const benchmark = cat.benchmarks[effectiveTier] || cat.benchmarks.DEFAULT;
      const percentile = computePercentile(playerVal, benchmark, !!cat.inverse);
      const priority = Math.abs(percentile - 50) / 10;

      const isStrength = percentile >= 65;
      const isWeakness = percentile < 45;

      insights.push({
        type: isStrength ? 'strength' : isWeakness ? 'weakness' : 'tip',
        category: cat.key,
        title: cat.name,
        description: isStrength ? cat.advice.good : isWeakness ? cat.advice.bad : '',
        stat: formatStat(cat.key, playerVal),
        playerValue: +playerVal.toFixed(2),
        benchmarkValue: +benchmark.toFixed(2),
        percentile,
        priority: Math.round(priority),
      });
    }

    // Weighted overall score
    const totalWeight = categories.reduce((s, c) => s + c.weight, 0);
    const overallScore = Math.round(
      insights.reduce((s: number, insight: any, i: number) => s + insight.percentile * categories[i].weight, 0) / totalWeight
    );

    const strengths = insights.filter((i: any) => i.type === 'strength').sort((a: any, b: any) => b.priority - a.priority).slice(0, 5);
    const weaknesses = insights.filter((i: any) => i.type === 'weakness').sort((a: any, b: any) => b.priority - a.priority).slice(0, 5);
    const tips = insights.filter((i: any) => i.type === 'tip').sort((a: any, b: any) => b.priority - a.priority).slice(0, 3);

    const roleLabel = { TOP: 'Top', JUNGLE: 'Jungle', MID: 'Mid', BOTTOM: 'ADC', SUPPORT: 'Support' }[normalizedRole] || role;

    return NextResponse.json({
      overallGrade: getGrade(overallScore),
      overallScore,
      strengths,
      weaknesses,
      tips,
      role: roleLabel,
      tier: effectiveTier,
      gamesAnalyzed,
      comparedTo: effectiveTier,
      improvementPotential: getImprovementTip(normalizedRole, weaknesses),
    });
  } catch {
    return NextResponse.json({ error: 'Analyse fehlgeschlagen' }, { status: 500 });
  }
}

function detectRole(matches: any[]): string {
  const counts: Record<string, number> = {};
  matches.forEach((m: any) => { counts[m.role || 'UNKNOWN'] = (counts[m.role || 'UNKNOWN'] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'MID';
}

function normalizeRole(role: string): string {
  const map: Record<string, string> = {
    TOP: 'TOP', JUNGLE: 'JUNGLE', MID: 'MID', MIDDLE: 'MID',
    BOTTOM: 'BOTTOM', ADC: 'BOTTOM', UTILITY: 'SUPPORT', SUPPORT: 'SUPPORT',
  };
  return map[role.toUpperCase()] || 'MID';
}

function formatStat(cat: string, val: number): string {
  if (cat === 'killParticipation' || cat === 'dmgShare') return `${val.toFixed(1)}%`;
  if (cat === 'kda') return val.toFixed(2);
  if (cat === 'deathsPerGame') return val.toFixed(1);
  if (cat === 'objectiveDmg' || cat === 'damagePerMin' || cat === 'goldPerMin' || cat === 'utility') return Math.round(val).toString();
  return val.toFixed(1);
}
