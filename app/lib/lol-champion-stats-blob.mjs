// Champion-Zahlen der LoL-Liste (/champions) und der LoL-Startseite fuer EUW,
// gerechnet aus der Rang-Stichprobe der Box (lol_match_participant_raw) statt
// aus der Wochendatei public/champion-stats-euw.json (4.766 Matches, nur
// Master+). Eine Datei im Vercel Blob, geschrieben von
// scripts/aggregate-lol-builds.mjs im selben Durchlauf wie die Build-Summen der
// Champion-Seiten — gleiche Filter, gleiche Matches.
//
// Eine Quelle fuer drei Stellen: Box (schreibt), app/lib/lol-champion-list.ts
// und app/api/homepage-stats (lesen). Als .mjs, weil die Box keine TS-Dateien
// laedt — steht deshalb im Pfad-Filter von .github/workflows/deploy-hetzner.yml.
// Keine Importe: der Test laedt die Datei direkt mit node.

export const LOL_CHAMPION_STATS_REGION = 'euw1';
export const LOL_CHAMPION_STATS_PATH = `lol/champion-stats/${LOL_CHAMPION_STATS_REGION}.json`;

/**
 * Aelter wird die Datei nicht benutzt (builtAt und neuestes Spiel). Bewusst so
 * lang wie der Takt der Wochendatei: faellt die Box ein paar Tage aus, ist ein
 * paar Tage alter Patch-Stand besser als der sichtbare Sprung auf Master+.
 */
export const LOL_CHAMPION_STATS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Raenge der Stichprobe, wie scripts/aggregate-lol-builds.mjs TIERS. */
export const LOL_STATS_TIERS = Object.freeze(['EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER']);

/**
 * Ab so vielen Matches im gewaehlten Rang zeigt die Liste nur den neuesten
 * Patch, darunter beide neuesten zusammen. Seit 08.11.2026 50.000 statt 15.000
 * (User): 16.22 hatte nach vier Tagen 17.075 Matches (Emerald+), mit 16.21
 * zusammen 129.062 — bei ~8.000 je Tag reicht der neue Patch allein nach etwa
 * einer Woche. Challenger und GM+ bleiben dauerhaft bei zwei Patches.
 */
export const NEWEST_PATCH_MIN_MATCHES = 50_000;

/**
 * Bannrate und KDA erst ab so vielen Matches mit diesen Daten im Fenster (die
 * Rohablage hat sie erst seit Migration 0121, 08.11.2026). Bei einer Bannrate
 * von 30 % sind das +-2 Prozentpunkte.
 */
export const MIN_BAN_MATCHES = 500;

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isCount = v => Number.isFinite(v) && v >= 0;
const PATCH_RE = /^\d+\.\d+$/;
const patchNum = p => p.split('.').map(Number);
const patchNewer = (a, b) => {
  const [a1, a2] = patchNum(a), [b1, b2] = patchNum(b);
  return a1 > b1 || (a1 === b1 && a2 > b2);
};

function isValidChamp(c) {
  return isObj(c) && ['games', 'wins', 'kills', 'deaths', 'assists', 'bans'].every(k => isCount(c[k])) && c.wins <= c.games;
}

function isValidTier(t) {
  return isObj(t) && isCount(t.matches) && isCount(t.participants) && isCount(t.banMatches)
    && isObj(t.champions) && Object.values(t.champions).every(isValidChamp);
}

function isValidPatch(p) {
  return isObj(p) && typeof p.patch === 'string' && PATCH_RE.test(p.patch)
    && isObj(p.tiers) && Object.keys(p.tiers).every(t => LOL_STATS_TIERS.includes(t))
    && Object.values(p.tiers).every(isValidTier);
}

function fresh(stamp, now) {
  const t = Date.parse(stamp);
  return Number.isFinite(t) && now - t <= LOL_CHAMPION_STATS_MAX_AGE_MS && t - now <= 5 * 60_000;
}

/** Gueltige, nicht zu alte Datei? Sonst nehmen die Leser die Wochendatei. `now` nur fuer Tests. */
export function isValidLolChampionStats(file, now = Date.now()) {
  if (!isObj(file) || file.version !== 1 || file.source !== 'box' || file.region !== LOL_CHAMPION_STATS_REGION) return false;
  if (!fresh(file.builtAt, now) || !fresh(file.dataNewest, now)) return false;
  if (!Number.isFinite(file.matchesAnalyzed) || file.matchesAnalyzed <= 0) return false;
  if (!Array.isArray(file.patches) || file.patches.length < 1 || file.patches.length > 2) return false;
  if (!file.patches.every(isValidPatch)) return false;
  if (file.patches.length === 2 && !patchNewer(file.patches[0].patch, file.patches[1].patch)) return false;
  if (!isObj(file.roles) || Object.keys(file.roles).length < 100) return false;
  return Object.values(file.roles).every(r => isObj(r) && Object.values(r).every(isCount));
}

/**
 * Zahlen fuer einen Rang oder eine Rang-Gruppe (tiers = null: alle Raenge der
 * Stichprobe). Gleiche Form wie statsForTiers (champion-tier-stats.ts), damit
 * die Liste eine Formel behaelt:
 * - totalGames = gezaehlte Teilnehmer (9 je Match, der Stichproben-Spieler
 *   zaehlt nicht) → Pickrate = Spiele * 10 / totalGames
 * - banMatches = Matches mit Ban-Daten (null unter MIN_BAN_MATCHES) → Bannrate = Bans / banMatches
 * - kdaOk = genug Matches mit K/D/A-Daten (gleicher Schreibvorgang wie die Bans)
 * null = fuer diese Auswahl gibt die Datei nichts her.
 *
 * @typedef {{ wins: number, games: number, kills: number, deaths: number, assists: number, bans: number }} BoxChampStat
 * @param {any} file
 * @param {string[] | null} tiers
 * @returns {{ stats: Record<string, BoxChampStat>, totalGames: number, banMatches: number | null,
 *   kdaOk: boolean, matches: number, patches: string[], tiers: string[] } | null}
 *   tiers = gezaehlte Raenge mit Matches im Fenster, aufsteigend (Emerald zuerst).
 */
export function boxStatsForTiers(file, tiers) {
  if (!isObj(file) || !Array.isArray(file.patches) || !file.patches.length) return null;
  const wanted = tiers === null ? [...LOL_STATS_TIERS] : [...new Set(tiers.map(t => String(t).toUpperCase()))];
  if (!wanted.length || !wanted.every(t => LOL_STATS_TIERS.includes(t))) return null;

  const matchesIn = p => wanted.reduce((s, t) => s + (p.tiers[t]?.matches || 0), 0);
  const window = matchesIn(file.patches[0]) >= NEWEST_PATCH_MIN_MATCHES ? [file.patches[0]] : file.patches.slice(0, 2);

  /** @type {Record<string, BoxChampStat>} */
  const stats = {};
  let participants = 0, banMatches = 0, matches = 0;
  for (const p of window) {
    for (const t of wanted) {
      const tier = p.tiers[t];
      if (!tier) continue;
      participants += tier.participants;
      banMatches += tier.banMatches;
      matches += tier.matches;
      for (const [key, c] of Object.entries(tier.champions)) {
        const acc = stats[key] ||= { wins: 0, games: 0, kills: 0, deaths: 0, assists: 0, bans: 0 };
        acc.wins += c.wins; acc.games += c.games; acc.kills += c.kills;
        acc.deaths += c.deaths; acc.assists += c.assists; acc.bans += c.bans;
      }
    }
  }
  if (participants <= 0) return null;
  const enough = banMatches >= MIN_BAN_MATCHES;
  return {
    stats,
    totalGames: participants,
    banMatches: enough ? banMatches : null,
    kdaOk: enough,
    matches,
    patches: window.map(p => p.patch),
    tiers: LOL_STATS_TIERS.filter(t => wanted.includes(t) && window.some(p => (p.tiers[t]?.matches || 0) > 0)),
  };
}

/** Die Liste wechselt erst, wenn „Alle Raenge" Bannrate und KDA zeigen kann — sonst bliebe EUW eine Weile ohne beides. */
export function boxListReady(file) {
  return boxStatsForTiers(file, null)?.banMatches != null;
}
