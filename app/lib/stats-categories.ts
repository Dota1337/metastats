/**
 * 20 overarching stat categories for MetaStats market value system.
 *
 * Free users: see category name, score (0-100), trend arrow, and brief summary.
 * Premium users: see all underlying stat details per category.
 */

import type { ExtendedMatchData } from './match-processor';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StatDetail {
  name: string;
  value: number;
  unit: string;
  description: string;
}

export interface CategoryScore {
  id: string;
  name: string;
  nameEn: string;
  icon: string;
  score: number;        // 0–100
  trend: number;        // negative = declining, positive = improving
  impact: number;       // -1 to +1 market value impact
  summary: string;      // Short explanation (free tier)
  summaryEn: string;
  details: StatDetail[]; // Individual stats (premium only)
}

export interface StatsOverview {
  categories: CategoryScore[];
  overallScore: number;
  role: string;
  gamesAnalyzed: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function avg(matches: ExtendedMatchData[], getter: (m: ExtendedMatchData) => number): number {
  if (matches.length === 0) return 0;
  return matches.reduce((s, m) => s + getter(m), 0) / matches.length;
}

function rate(matches: ExtendedMatchData[], predicate: (m: ExtendedMatchData) => boolean): number {
  if (matches.length === 0) return 0;
  return matches.filter(predicate).length / matches.length;
}

/** Clamp value to 0–100 */
function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Calculate trend: compare recent half vs older half */
function trend(matches: ExtendedMatchData[], getter: (m: ExtendedMatchData) => number): number {
  if (matches.length < 6) return 0;
  const mid = Math.floor(matches.length / 2);
  const recent = matches.slice(0, mid);
  const older = matches.slice(mid);
  const recentAvg = avg(recent, getter);
  const olderAvg = avg(older, getter);
  if (olderAvg === 0) return recentAvg > 0 ? 10 : 0;
  const change = ((recentAvg - olderAvg) / Math.abs(olderAvg)) * 100;
  return Math.max(-100, Math.min(100, Math.round(change)));
}

function avgDuration(matches: ExtendedMatchData[]): number {
  if (matches.length === 0) return 1;
  return matches.reduce((s, m) => s + m.gameDuration, 0) / matches.length / 60;
}

function detectRole(matches: ExtendedMatchData[]): string {
  const counts: Record<string, number> = {};
  matches.forEach(m => { counts[m.role] = (counts[m.role] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'UNKNOWN';
}

/** Score maps: translate a stat value to a 0–100 score based on thresholds */
function scoreFromThresholds(value: number, bad: number, ok: number, good: number, great: number): number {
  if (value >= great) return 95;
  if (value >= good) return 70 + (value - good) / (great - good) * 25;
  if (value >= ok) return 45 + (value - ok) / (good - ok) * 25;
  if (value >= bad) return 20 + (value - bad) / (ok - bad) * 25;
  return Math.max(0, 20 * (value / Math.max(bad, 0.01)));
}

// ─── Category Calculators ────────────────────────────────────────────────────

function calcWinRate(matches: ExtendedMatchData[]): CategoryScore {
  const wr = rate(matches, m => m.win) * 100;
  const score = clamp(scoreFromThresholds(wr, 40, 48, 55, 65));
  const t = trend(matches, m => m.win ? 1 : 0);

  return {
    id: 'win_rate', name: 'Siegrate', nameEn: 'Win Rate', icon: '🏆',
    score, trend: t,
    impact: (score - 50) / 200,
    summary: `${wr.toFixed(1)}% Siegrate über ${matches.length} Spiele`,
    summaryEn: `${wr.toFixed(1)}% win rate over ${matches.length} games`,
    details: [
      { name: 'Winrate', value: wr, unit: '%', description: 'Gewonnene Spiele in Prozent' },
      { name: 'Siege', value: matches.filter(m => m.win).length, unit: '', description: 'Anzahl gewonnener Spiele' },
      { name: 'Niederlagen', value: matches.filter(m => !m.win).length, unit: '', description: 'Anzahl verlorener Spiele' },
    ],
  };
}

function calcKDA(matches: ExtendedMatchData[]): CategoryScore {
  const totalK = matches.reduce((s, m) => s + m.kills, 0);
  const totalD = matches.reduce((s, m) => s + m.deaths, 0);
  const totalA = matches.reduce((s, m) => s + m.assists, 0);
  const kda = (totalK + totalA) / Math.max(totalD, 1);
  const avgDeaths = totalD / Math.max(matches.length, 1);

  const score = clamp(scoreFromThresholds(kda, 1.5, 2.5, 3.5, 5.0));
  const t = trend(matches, m => (m.kills + m.assists) / Math.max(m.deaths, 1));

  return {
    id: 'kda_rating', name: 'KDA-Rating', nameEn: 'KDA Rating', icon: '⚔️',
    score, trend: t,
    impact: (score - 50) / 180,
    summary: `${kda.toFixed(2)} KDA (${(totalK / matches.length).toFixed(1)}/${avgDeaths.toFixed(1)}/${(totalA / matches.length).toFixed(1)})`,
    summaryEn: `${kda.toFixed(2)} KDA (${(totalK / matches.length).toFixed(1)}/${avgDeaths.toFixed(1)}/${(totalA / matches.length).toFixed(1)})`,
    details: [
      { name: 'KDA', value: +kda.toFixed(2), unit: '', description: '(Kills + Assists) / Deaths' },
      { name: 'Kills/Spiel', value: +(totalK / matches.length).toFixed(1), unit: '', description: 'Durchschnittliche Kills' },
      { name: 'Deaths/Spiel', value: +avgDeaths.toFixed(1), unit: '', description: 'Durchschnittliche Tode' },
      { name: 'Assists/Spiel', value: +(totalA / matches.length).toFixed(1), unit: '', description: 'Durchschnittliche Assists' },
    ],
  };
}

function calcLaneDominance(matches: ExtendedMatchData[]): CategoryScore {
  const avgCsAdv = avg(matches, m => m.challenges.maxCsAdvantageOnLaneOpponent);
  const avgGoldAdv = avg(matches, m => m.challenges.earlyLaningPhaseGoldExpAdvantage);
  const avgLevelLead = avg(matches, m => m.challenges.maxLevelLeadLaneOpponent);
  const avgCs10 = avg(matches, m => m.challenges.laneMinionsFirst10Minutes);

  const csAdvScore = scoreFromThresholds(avgCsAdv, 5, 15, 25, 40);
  const goldAdvScore = scoreFromThresholds(avgGoldAdv, -200, 0, 400, 800);
  const score = clamp((csAdvScore * 0.4 + goldAdvScore * 0.4 + scoreFromThresholds(avgLevelLead, 0, 1, 2, 3) * 0.2));
  const t = trend(matches, m => m.challenges.maxCsAdvantageOnLaneOpponent);

  return {
    id: 'lane_dominance', name: 'Lane-Dominanz', nameEn: 'Lane Dominance', icon: '🛡️',
    score, trend: t,
    impact: (score - 50) / 250,
    summary: `Ø ${avgCsAdv.toFixed(0)} CS-Vorteil, ${avgGoldAdv > 0 ? '+' : ''}${avgGoldAdv.toFixed(0)} Gold-Vorteil`,
    summaryEn: `Avg ${avgCsAdv.toFixed(0)} CS lead, ${avgGoldAdv > 0 ? '+' : ''}${avgGoldAdv.toFixed(0)} gold advantage`,
    details: [
      { name: 'Max CS-Vorteil', value: +avgCsAdv.toFixed(1), unit: 'CS', description: 'Größter CS-Vorsprung gegen Gegenspieler' },
      { name: 'Gold/XP-Vorteil (früh)', value: +avgGoldAdv.toFixed(0), unit: '', description: 'Gold+XP-Vorsprung in der frühen Lane-Phase' },
      { name: 'Level-Vorsprung', value: +avgLevelLead.toFixed(1), unit: 'Lvl', description: 'Größter Level-Vorsprung gegen Gegenspieler' },
      { name: 'CS in 10 Min', value: +avgCs10.toFixed(0), unit: 'CS', description: 'Lane-Minions in den ersten 10 Minuten' },
    ],
  };
}

function calcFarming(matches: ExtendedMatchData[]): CategoryScore {
  const dur = avgDuration(matches);
  const avgCs = avg(matches, m => m.cs);
  const csPerMin = avgCs / dur;
  const avgCs10 = avg(matches, m => m.challenges.laneMinionsFirst10Minutes);
  const avgJungleCs = avg(matches, m => m.neutralMinionsKilled);

  const score = clamp(scoreFromThresholds(csPerMin, 4, 6, 7.5, 9));
  const t = trend(matches, m => m.cs / Math.max(m.gameDuration / 60, 1));

  return {
    id: 'farming', name: 'Farming-Effizienz', nameEn: 'Farming Efficiency', icon: '🌾',
    score, trend: t,
    impact: (score - 50) / 250,
    summary: `${csPerMin.toFixed(1)} CS/Min (Ø ${avgCs.toFixed(0)} CS/Spiel)`,
    summaryEn: `${csPerMin.toFixed(1)} CS/min (avg ${avgCs.toFixed(0)} CS/game)`,
    details: [
      { name: 'CS/Min', value: +csPerMin.toFixed(1), unit: '/min', description: 'Creep Score pro Minute' },
      { name: 'CS/Spiel', value: +avgCs.toFixed(0), unit: '', description: 'Durchschnittliche CS pro Spiel' },
      { name: 'CS in 10 Min', value: +avgCs10.toFixed(0), unit: '', description: 'Lane-CS in den ersten 10 Minuten' },
      { name: 'Jungle CS', value: +avgJungleCs.toFixed(0), unit: '', description: 'Durchschnittliche Jungle-Minions' },
    ],
  };
}

function calcDamageOutput(matches: ExtendedMatchData[]): CategoryScore {
  const avgDpm = avg(matches, m => m.challenges.damagePerMinute);
  const avgDmg = avg(matches, m => m.damageDealt);
  const avgPhys = avg(matches, m => m.physicalDamageDealtToChampions);
  const avgMagic = avg(matches, m => m.magicDamageDealtToChampions);
  const avgTrue = avg(matches, m => m.trueDamageDealtToChampions);

  const score = clamp(scoreFromThresholds(avgDpm, 300, 500, 700, 1000));
  const t = trend(matches, m => m.challenges.damagePerMinute);

  return {
    id: 'damage_output', name: 'Schadensoutput', nameEn: 'Damage Output', icon: '💥',
    score, trend: t,
    impact: (score - 50) / 200,
    summary: `${avgDpm.toFixed(0)} Schaden/Min (Ø ${(avgDmg / 1000).toFixed(1)}k/Spiel)`,
    summaryEn: `${avgDpm.toFixed(0)} damage/min (avg ${(avgDmg / 1000).toFixed(1)}k/game)`,
    details: [
      { name: 'Schaden/Min', value: +avgDpm.toFixed(0), unit: '/min', description: 'Schaden an Champions pro Minute' },
      { name: 'Schaden/Spiel', value: +avgDmg.toFixed(0), unit: '', description: 'Gesamtschaden an Champions' },
      { name: 'Physisch', value: +avgPhys.toFixed(0), unit: '', description: 'Physischer Schaden an Champions' },
      { name: 'Magisch', value: +avgMagic.toFixed(0), unit: '', description: 'Magischer Schaden an Champions' },
      { name: 'Wahrer Schaden', value: +avgTrue.toFixed(0), unit: '', description: 'Wahrer Schaden an Champions' },
    ],
  };
}

function calcDamageShare(matches: ExtendedMatchData[]): CategoryScore {
  const avgShare = avg(matches, m => m.challenges.teamDamagePercentage) * 100;
  const avgDmgTakenShare = avg(matches, m => m.challenges.damageTakenOnTeamPercentage) * 100;

  const role = detectRole(matches);
  const isCarry = ['MIDDLE', 'BOTTOM'].includes(role);
  const thresholds = isCarry ? [15, 22, 28, 35] : [10, 17, 22, 30];

  const score = clamp(scoreFromThresholds(avgShare, thresholds[0], thresholds[1], thresholds[2], thresholds[3]));
  const t = trend(matches, m => m.challenges.teamDamagePercentage);

  return {
    id: 'damage_share', name: 'Schadensanteil', nameEn: 'Damage Share', icon: '📊',
    score, trend: t,
    impact: (score - 50) / 250,
    summary: `${avgShare.toFixed(1)}% des Teamschadens`,
    summaryEn: `${avgShare.toFixed(1)}% of team damage`,
    details: [
      { name: 'Schadensanteil', value: +avgShare.toFixed(1), unit: '%', description: 'Anteil am gesamten Teamschaden' },
      { name: 'Schadensaufnahme', value: +avgDmgTakenShare.toFixed(1), unit: '%', description: 'Anteil am erlittenen Teamschaden' },
    ],
  };
}

function calcSurvivability(matches: ExtendedMatchData[]): CategoryScore {
  const dur = avgDuration(matches);
  const avgDeadTime = avg(matches, m => m.totalTimeSpentDead);
  const avgLongestAlive = avg(matches, m => m.longestTimeSpentLiving);
  const avgMitigated = avg(matches, m => m.damageSelfMitigated);
  const mitigatedPerMin = avgMitigated / dur;
  const deadTimeRatio = avgDeadTime / (dur * 60);

  const survScore = scoreFromThresholds(avgLongestAlive / 60, 3, 6, 10, 15);
  const deadScore = 100 - scoreFromThresholds(deadTimeRatio * 100, 3, 8, 15, 25);
  const score = clamp(survScore * 0.5 + deadScore * 0.3 + scoreFromThresholds(mitigatedPerMin, 200, 500, 800, 1200) * 0.2);
  const t = trend(matches, m => m.longestTimeSpentLiving);

  return {
    id: 'survivability', name: 'Überlebensfähigkeit', nameEn: 'Survivability', icon: '❤️',
    score, trend: t,
    impact: (score - 50) / 300,
    summary: `Ø ${(avgLongestAlive / 60).toFixed(1)} Min am Leben, ${(deadTimeRatio * 100).toFixed(0)}% Totzeit`,
    summaryEn: `Avg ${(avgLongestAlive / 60).toFixed(1)} min alive, ${(deadTimeRatio * 100).toFixed(0)}% dead time`,
    details: [
      { name: 'Längste Lebensspanne', value: +(avgLongestAlive / 60).toFixed(1), unit: 'min', description: 'Durchschnittlich längste Lebensspanne' },
      { name: 'Totzeit', value: +avgDeadTime.toFixed(0), unit: 's', description: 'Durchschnittliche Totzeit pro Spiel' },
      { name: 'Totzeit-Anteil', value: +(deadTimeRatio * 100).toFixed(1), unit: '%', description: 'Anteil der Spielzeit tot' },
      { name: 'Schaden absorbiert/Min', value: +mitigatedPerMin.toFixed(0), unit: '/min', description: 'Selbst mitigierter Schaden pro Minute' },
    ],
  };
}

function calcVisionControl(matches: ExtendedMatchData[]): CategoryScore {
  const avgVspm = avg(matches, m => m.challenges.visionScorePerMinute);
  const avgVision = avg(matches, m => m.visionScore);
  const avgWards = avg(matches, m => m.wardsPlaced);
  const avgCtrl = avg(matches, m => m.challenges.controlWardsPlaced);
  const avgWardsKilled = avg(matches, m => m.wardsKilled);
  const avgWardsBefore20 = avg(matches, m => m.challenges.wardTakedownsBefore20M);

  const role = detectRole(matches);
  const isSup = role === 'SUPPORT';
  const thresholds = isSup ? [0.8, 1.2, 1.6, 2.2] : [0.3, 0.6, 0.9, 1.3];

  const score = clamp(scoreFromThresholds(avgVspm, thresholds[0], thresholds[1], thresholds[2], thresholds[3]));
  const t = trend(matches, m => m.challenges.visionScorePerMinute);

  return {
    id: 'vision_control', name: 'Vision-Kontrolle', nameEn: 'Vision Control', icon: '👁️',
    score, trend: t,
    impact: (score - 50) / 250,
    summary: `${avgVspm.toFixed(2)} Vision/Min (Ø ${avgVision.toFixed(0)} Score)`,
    summaryEn: `${avgVspm.toFixed(2)} vision/min (avg ${avgVision.toFixed(0)} score)`,
    details: [
      { name: 'Vision Score/Min', value: +avgVspm.toFixed(2), unit: '/min', description: 'Vision Score pro Minute' },
      { name: 'Vision Score', value: +avgVision.toFixed(0), unit: '', description: 'Durchschnittlicher Vision Score' },
      { name: 'Wards gesetzt', value: +avgWards.toFixed(1), unit: '/Spiel', description: 'Wards platziert pro Spiel' },
      { name: 'Control Wards', value: +avgCtrl.toFixed(1), unit: '/Spiel', description: 'Control Wards platziert' },
      { name: 'Wards zerstört', value: +avgWardsKilled.toFixed(1), unit: '/Spiel', description: 'Gegnerische Wards zerstört' },
      { name: 'Wards vor 20 Min', value: +avgWardsBefore20.toFixed(1), unit: '/Spiel', description: 'Wards vor Minute 20 zerstört' },
    ],
  };
}

function calcObjectiveControl(matches: ExtendedMatchData[]): CategoryScore {
  const avgDragons = avg(matches, m => m.challenges.dragonTakedowns);
  const avgBarons = avg(matches, m => m.challenges.baronTakedowns);
  const avgTurrets = avg(matches, m => m.turretKills);
  const avgPlates = avg(matches, m => m.challenges.turretPlatesTaken);
  const avgHeralds = avg(matches, m => m.challenges.riftHeraldTakedowns);
  const avgVoidgrubs = avg(matches, m => m.challenges.voidMonsterKill);
  const avgSteals = avg(matches, m => m.challenges.epicMonsterSteals);
  const avgObjDmg = avg(matches, m => m.damageDealtToObjectives);

  const objScore = avgDragons * 15 + avgBarons * 25 + avgHeralds * 10 + avgPlates * 5 + avgTurrets * 8;
  const score = clamp(scoreFromThresholds(objScore, 15, 35, 60, 90));
  const t = trend(matches, m => m.challenges.dragonTakedowns + m.challenges.baronTakedowns * 2);

  return {
    id: 'objective_control', name: 'Objektiv-Kontrolle', nameEn: 'Objective Control', icon: '🐉',
    score, trend: t,
    impact: (score - 50) / 220,
    summary: `Ø ${avgDragons.toFixed(1)} Drakes, ${avgBarons.toFixed(1)} Barone, ${avgPlates.toFixed(1)} Plates`,
    summaryEn: `Avg ${avgDragons.toFixed(1)} drakes, ${avgBarons.toFixed(1)} barons, ${avgPlates.toFixed(1)} plates`,
    details: [
      { name: 'Drachen-Beteiligung', value: +avgDragons.toFixed(1), unit: '/Spiel', description: 'Drake Takedowns' },
      { name: 'Baron-Beteiligung', value: +avgBarons.toFixed(1), unit: '/Spiel', description: 'Baron Takedowns' },
      { name: 'Rift Herald', value: +avgHeralds.toFixed(1), unit: '/Spiel', description: 'Rift Herald Takedowns' },
      { name: 'Voidgrubs', value: +avgVoidgrubs.toFixed(1), unit: '/Spiel', description: 'Voidgrub Kills' },
      { name: 'Turret Plates', value: +avgPlates.toFixed(1), unit: '/Spiel', description: 'Turm-Platten zerstört' },
      { name: 'Türme', value: +avgTurrets.toFixed(1), unit: '/Spiel', description: 'Türme zerstört' },
      { name: 'Objective Steals', value: +avgSteals.toFixed(2), unit: '/Spiel', description: 'Objectives gestohlen' },
      { name: 'Objective DMG', value: +(avgObjDmg / 1000).toFixed(1), unit: 'k/Spiel', description: 'Schaden an Objectives' },
    ],
  };
}

function calcGoldEfficiency(matches: ExtendedMatchData[]): CategoryScore {
  const avgGpm = avg(matches, m => m.challenges.goldPerMinute);
  const avgGold = avg(matches, m => m.goldEarned);
  const avgSpent = avg(matches, m => m.goldSpent);
  const efficiency = avgGold > 0 ? (avgSpent / avgGold) * 100 : 0;
  const avgGoldShare = avg(matches, m => m.teamGold > 0 ? m.goldEarned / m.teamGold : 0.2) * 100;
  const avgBounty = avg(matches, m => m.challenges.bountyGold);

  const score = clamp(scoreFromThresholds(avgGpm, 250, 350, 420, 500));
  const t = trend(matches, m => m.challenges.goldPerMinute);

  return {
    id: 'gold_efficiency', name: 'Gold-Effizienz', nameEn: 'Gold Efficiency', icon: '💰',
    score, trend: t,
    impact: (score - 50) / 250,
    summary: `${avgGpm.toFixed(0)} Gold/Min, ${efficiency.toFixed(0)}% ausgegeben`,
    summaryEn: `${avgGpm.toFixed(0)} gold/min, ${efficiency.toFixed(0)}% spent`,
    details: [
      { name: 'Gold/Min', value: +avgGpm.toFixed(0), unit: '/min', description: 'Verdientes Gold pro Minute' },
      { name: 'Gold/Spiel', value: +(avgGold / 1000).toFixed(1), unit: 'k', description: 'Verdientes Gold pro Spiel' },
      { name: 'Ausgabenquote', value: +efficiency.toFixed(0), unit: '%', description: 'Anteil des Goldes, das ausgegeben wurde' },
      { name: 'Gold-Anteil', value: +avgGoldShare.toFixed(1), unit: '%', description: 'Anteil am Team-Gold' },
      { name: 'Bounty-Gold', value: +avgBounty.toFixed(0), unit: '/Spiel', description: 'Gold durch Kopfgeld verdient' },
    ],
  };
}

function calcTeamplay(matches: ExtendedMatchData[]): CategoryScore {
  const avgKP = avg(matches, m => m.teamKills > 0 ? (m.kills + m.assists) / m.teamKills : 0) * 100;
  const avgHeals = avg(matches, m => m.totalHealsOnTeammates);
  const avgShields = avg(matches, m => m.totalDamageShieldedOnTeammates);
  const avgSaves = avg(matches, m => m.challenges.saveAllyFromDeath);
  const avgAssistStreak = avg(matches, m => m.challenges.assistStreakCount);
  const avgEffHS = avg(matches, m => m.challenges.effectiveHealAndShielding);
  const avgPicks = avg(matches, m => m.challenges.pickKillWithAlly);
  const avgImmobilize = avg(matches, m => m.challenges.immobilizeAndKillWithAlly);

  const score = clamp(scoreFromThresholds(avgKP, 35, 50, 65, 80));
  const t = trend(matches, m => m.teamKills > 0 ? (m.kills + m.assists) / m.teamKills : 0);

  return {
    id: 'teamplay', name: 'Teamplay', nameEn: 'Teamplay', icon: '🤝',
    score, trend: t,
    impact: (score - 50) / 220,
    summary: `${avgKP.toFixed(0)}% Kill-Beteiligung, Ø ${avgSaves.toFixed(1)} Rettungen`,
    summaryEn: `${avgKP.toFixed(0)}% kill participation, avg ${avgSaves.toFixed(1)} saves`,
    details: [
      { name: 'Kill-Beteiligung', value: +avgKP.toFixed(0), unit: '%', description: 'Beteiligung an Team-Kills' },
      { name: 'Heal auf Teammates', value: +avgHeals.toFixed(0), unit: '/Spiel', description: 'Heilung auf Teammitglieder' },
      { name: 'Shields auf Teammates', value: +avgShields.toFixed(0), unit: '/Spiel', description: 'Schildschaden auf Teammitglieder' },
      { name: 'Effektive H/S', value: +avgEffHS.toFixed(0), unit: '/Spiel', description: 'Effektive Heilung und Schilde' },
      { name: 'Rettungen', value: +avgSaves.toFixed(1), unit: '/Spiel', description: 'Verbündete vor dem Tod bewahrt' },
      { name: 'Pick-Kills', value: +avgPicks.toFixed(1), unit: '/Spiel', description: 'Kills mit Verbündetem in der Nähe' },
      { name: 'CC + Kill', value: +avgImmobilize.toFixed(1), unit: '/Spiel', description: 'CC-Ziel von Verbündetem getötet' },
      { name: 'Assist-Streak', value: +avgAssistStreak.toFixed(0), unit: '', description: 'Längste Assist-Serie' },
    ],
  };
}

function calcClutchFactor(matches: ExtendedMatchData[]): CategoryScore {
  const avgSoloKills = avg(matches, m => m.challenges.soloKills);
  const avgOutnumbered = avg(matches, m => m.challenges.outnumberedKills);
  const avgSurvived = avg(matches, m => m.challenges.survivedSingleDigitHpCount);
  const avgSurvivedCC = avg(matches, m => m.challenges.survivedThreeImmobilizesInFight);
  const avgTowerKills = avg(matches, m => m.challenges.killsNearEnemyTurret);
  const avgDefensiveKills = avg(matches, m => m.challenges.killsUnderOwnTurret);

  const clutchPoints = avgSoloKills * 10 + avgOutnumbered * 15 + avgSurvived * 8 + avgTowerKills * 12;
  const score = clamp(scoreFromThresholds(clutchPoints, 5, 20, 40, 70));
  const t = trend(matches, m => m.challenges.soloKills + m.challenges.outnumberedKills * 1.5);

  return {
    id: 'clutch_factor', name: 'Clutch-Faktor', nameEn: 'Clutch Factor', icon: '🎯',
    score, trend: t,
    impact: (score - 50) / 220,
    summary: `Ø ${avgSoloKills.toFixed(1)} Solo-Kills, ${avgOutnumbered.toFixed(1)} Outplays`,
    summaryEn: `Avg ${avgSoloKills.toFixed(1)} solo kills, ${avgOutnumbered.toFixed(1)} outplays`,
    details: [
      { name: 'Solo-Kills', value: +avgSoloKills.toFixed(1), unit: '/Spiel', description: '1v1-Kills' },
      { name: 'Outplay-Kills', value: +avgOutnumbered.toFixed(1), unit: '/Spiel', description: 'Kills in Unterzahl' },
      { name: 'Knapp überlebt', value: +avgSurvived.toFixed(1), unit: '/Spiel', description: 'Überlebt mit <10% HP' },
      { name: 'CC-Überlebt', value: +avgSurvivedCC.toFixed(1), unit: '/Spiel', description: '3+ CC in einem Kampf überlebt' },
      { name: 'Turm-Dives', value: +avgTowerKills.toFixed(1), unit: '/Spiel', description: 'Kills unter gegnerischem Turm' },
      { name: 'Defensive Kills', value: +avgDefensiveKills.toFixed(1), unit: '/Spiel', description: 'Kills unter eigenem Turm' },
    ],
  };
}

function calcComebackStrength(matches: ExtendedMatchData[]): CategoryScore {
  const avgMaxDeficit = avg(matches, m => m.challenges.maxKillDeficit);
  const winsFromBehind = matches.filter(m => m.win && m.challenges.maxKillDeficit >= 3).length;
  const comebackRate = matches.length > 0 ? (winsFromBehind / matches.length) * 100 : 0;
  const surrenderRate = rate(matches, m => m.surrendered) * 100;

  const comebackScore = scoreFromThresholds(comebackRate, 5, 12, 20, 30);
  const mentalScore = 100 - scoreFromThresholds(surrenderRate, 10, 25, 40, 60);
  const score = clamp(comebackScore * 0.6 + mentalScore * 0.4);
  const t = trend(matches, m => (m.win && m.challenges.maxKillDeficit >= 3) ? 1 : 0);

  return {
    id: 'comeback_strength', name: 'Comeback-Stärke', nameEn: 'Comeback Strength', icon: '🔄',
    score, trend: t,
    impact: (score - 50) / 300,
    summary: `${comebackRate.toFixed(0)}% Comeback-Rate, ${surrenderRate.toFixed(0)}% Surrenders`,
    summaryEn: `${comebackRate.toFixed(0)}% comeback rate, ${surrenderRate.toFixed(0)}% surrenders`,
    details: [
      { name: 'Comeback-Rate', value: +comebackRate.toFixed(0), unit: '%', description: 'Siege nach 3+ Kill-Rückstand' },
      { name: 'Surrender-Rate', value: +surrenderRate.toFixed(0), unit: '%', description: 'Spiele durch Aufgabe beendet' },
      { name: 'Max Kill-Rückstand', value: +avgMaxDeficit.toFixed(1), unit: '', description: 'Durchschnittlich größter Kill-Rückstand' },
      { name: 'Comeback-Siege', value: winsFromBehind, unit: '', description: 'Gewonnene Spiele nach großem Rückstand' },
    ],
  };
}

function calcEarlyGameImpact(matches: ExtendedMatchData[]): CategoryScore {
  const fbRate = rate(matches, m => m.firstBloodKill || m.firstBloodAssist) * 100;
  const fbVictimRate = rate(matches, m => m.firstBloodVictim) * 100;
  const avgPlates = avg(matches, m => m.challenges.turretPlatesTaken);
  const avgTakedowns25 = avg(matches, m => m.challenges.takedownsFirst25Minutes);
  const avgCs10 = avg(matches, m => m.challenges.laneMinionsFirst10Minutes);
  const avgRoamKills = avg(matches, m => m.challenges.killsOnOtherLanesEarlyJungleAsLaner);
  const avgGankKills = avg(matches, m => m.challenges.killsOnLanersEarlyJungleAsJungler);
  const avgFirstTurret = rate(matches, m => m.challenges.firstTurretKilled > 0) * 100;

  const earlyScore = fbRate * 0.3 + avgPlates * 8 + avgTakedowns25 * 3 - fbVictimRate * 0.2;
  const score = clamp(scoreFromThresholds(earlyScore, 10, 25, 45, 70));
  const t = trend(matches, m => m.challenges.takedownsFirst25Minutes);

  return {
    id: 'early_game', name: 'Frühspiel-Einfluss', nameEn: 'Early Game Impact', icon: '⚡',
    score, trend: t,
    impact: (score - 50) / 250,
    summary: `${fbRate.toFixed(0)}% First Blood, Ø ${avgPlates.toFixed(1)} Plates, ${avgTakedowns25.toFixed(1)} Takedowns@25`,
    summaryEn: `${fbRate.toFixed(0)}% first blood, avg ${avgPlates.toFixed(1)} plates, ${avgTakedowns25.toFixed(1)} takedowns@25`,
    details: [
      { name: 'First Blood Rate', value: +fbRate.toFixed(0), unit: '%', description: 'Beteiligung am First Blood' },
      { name: 'First Blood Opfer', value: +fbVictimRate.toFixed(0), unit: '%', description: 'Rate als First-Blood-Opfer' },
      { name: 'Turret Plates', value: +avgPlates.toFixed(1), unit: '/Spiel', description: 'Turm-Platten zerstört' },
      { name: 'Takedowns @25min', value: +avgTakedowns25.toFixed(1), unit: '/Spiel', description: 'Kills+Assists in den ersten 25 Min' },
      { name: 'Roam-Kills', value: +avgRoamKills.toFixed(1), unit: '/Spiel', description: 'Kills auf anderen Lanes (Laner)' },
      { name: 'Gank-Kills', value: +avgGankKills.toFixed(1), unit: '/Spiel', description: 'Lane-Kills als Jungler' },
      { name: 'First Turret', value: +avgFirstTurret.toFixed(0), unit: '%', description: 'Ersten Turm zerstört' },
    ],
  };
}

function calcMechanics(matches: ExtendedMatchData[]): CategoryScore {
  const avgDodged = avg(matches, m => m.challenges.skillshotsDodged);
  const avgDodgedTight = avg(matches, m => m.challenges.dodgeSkillShotsSmallWindow);
  const avgMultikills = avg(matches, m => m.challenges.multikills);
  const avgLegendary = avg(matches, m => m.challenges.legendaryCount);
  const avgLargestSpree = avg(matches, m => m.largestKillingSpree);
  const avgSkillshots = avg(matches, m => m.challenges.landSkillShotsEarlyGame);
  const avgFlashMulti = avg(matches, m => m.challenges.multikillsAfterAggressiveFlash);

  const mechPoints = avgDodged * 0.5 + avgDodgedTight * 2 + avgMultikills * 10 + avgLegendary * 20 + avgLargestSpree * 3;
  const score = clamp(scoreFromThresholds(mechPoints, 10, 30, 55, 85));
  const t = trend(matches, m => m.challenges.skillshotsDodged + m.challenges.multikills * 5);

  return {
    id: 'mechanics', name: 'Mechanik', nameEn: 'Mechanics', icon: '🎮',
    score, trend: t,
    impact: (score - 50) / 250,
    summary: `Ø ${avgDodged.toFixed(0)} Skillshots ausgewichen, ${avgMultikills.toFixed(1)} Multikills`,
    summaryEn: `Avg ${avgDodged.toFixed(0)} skillshots dodged, ${avgMultikills.toFixed(1)} multikills`,
    details: [
      { name: 'Skillshots ausgewichen', value: +avgDodged.toFixed(0), unit: '/Spiel', description: 'Gegnerische Skillshots ausgewichen' },
      { name: 'Knappe Dodges', value: +avgDodgedTight.toFixed(0), unit: '/Spiel', description: 'Skillshots im letzten Moment ausgewichen' },
      { name: 'Multikills', value: +avgMultikills.toFixed(1), unit: '/Spiel', description: 'Multi-Kills pro Spiel' },
      { name: 'Legendary', value: +avgLegendary.toFixed(2), unit: '/Spiel', description: 'Legendary-Status erreicht (8+ Kills ohne Tod)' },
      { name: 'Größte Killserie', value: +avgLargestSpree.toFixed(1), unit: '', description: 'Durchschnittliche größte Killserie' },
      { name: 'Skillshots (early)', value: +avgSkillshots.toFixed(0), unit: '/Spiel', description: 'Skillshots im Early Game getroffen' },
      { name: 'Flash-Multikills', value: +avgFlashMulti.toFixed(2), unit: '/Spiel', description: 'Multikills nach aggressivem Flash' },
    ],
  };
}

function calcConsistency(matches: ExtendedMatchData[]): CategoryScore {
  if (matches.length < 5) {
    return {
      id: 'consistency', name: 'Konstanz', nameEn: 'Consistency', icon: '📈',
      score: 50, trend: 0, impact: 0,
      summary: 'Zu wenige Spiele für Konstanz-Bewertung',
      summaryEn: 'Not enough games for consistency rating',
      details: [],
    };
  }

  const kdas = matches.map(m => (m.kills + m.assists) / Math.max(m.deaths, 1));
  const mean = kdas.reduce((s, v) => s + v, 0) / kdas.length;
  const variance = kdas.reduce((s, v) => s + (v - mean) ** 2, 0) / kdas.length;
  const cv = Math.sqrt(variance) / Math.max(mean, 0.1); // coefficient of variation

  const csPerMin = matches.map(m => m.cs / Math.max(m.gameDuration / 60, 1));
  const csMean = csPerMin.reduce((s, v) => s + v, 0) / csPerMin.length;
  const csVariance = csPerMin.reduce((s, v) => s + (v - csMean) ** 2, 0) / csPerMin.length;
  const csCv = Math.sqrt(csVariance) / Math.max(csMean, 0.1);

  // Lower CV = more consistent = higher score
  const kdaConsistency = 100 - scoreFromThresholds(cv, 0.2, 0.4, 0.6, 0.9);
  const csConsistency = 100 - scoreFromThresholds(csCv, 0.1, 0.2, 0.35, 0.5);
  const score = clamp(kdaConsistency * 0.6 + csConsistency * 0.4);

  return {
    id: 'consistency', name: 'Konstanz', nameEn: 'Consistency', icon: '📈',
    score, trend: 0,
    impact: (score - 50) / 300,
    summary: `KDA-Varianz: ${cv.toFixed(2)}, CS-Varianz: ${csCv.toFixed(2)}`,
    summaryEn: `KDA variance: ${cv.toFixed(2)}, CS variance: ${csCv.toFixed(2)}`,
    details: [
      { name: 'KDA-Variationskoeffizient', value: +cv.toFixed(2), unit: '', description: 'Niedrig = konstant, hoch = schwankend' },
      { name: 'CS-Variationskoeffizient', value: +csCv.toFixed(2), unit: '', description: 'Niedrig = konstantes Farming' },
      { name: 'Ø KDA', value: +mean.toFixed(2), unit: '', description: 'Durchschnittliche KDA' },
      { name: 'Ø CS/Min', value: +csMean.toFixed(1), unit: '', description: 'Durchschnittliche CS/Min' },
    ],
  };
}

function calcVersatility(matches: ExtendedMatchData[]): CategoryScore {
  const champCounts: Record<string, number> = {};
  const roleCounts: Record<string, number> = {};

  matches.forEach(m => {
    champCounts[m.champion] = (champCounts[m.champion] || 0) + 1;
    if (m.role !== 'UNKNOWN') roleCounts[m.role] = (roleCounts[m.role] || 0) + 1;
  });

  const uniqueChamps = Object.keys(champCounts).length;
  const uniqueRoles = Object.values(roleCounts).filter(c => c / matches.length > 0.1).length;
  const topChampRate = Math.max(...Object.values(champCounts)) / matches.length;
  const otp = topChampRate > 0.6; // one-trick indicator

  const champScore = scoreFromThresholds(uniqueChamps, 3, 6, 10, 15);
  const roleScore = scoreFromThresholds(uniqueRoles, 1, 2, 3, 4);
  const score = clamp(champScore * 0.6 + roleScore * 0.4);

  return {
    id: 'versatility', name: 'Vielseitigkeit', nameEn: 'Versatility', icon: '🔀',
    score, trend: 0,
    impact: (score - 50) / 350,
    summary: `${uniqueChamps} Champions, ${uniqueRoles} Rollen${otp ? ' (One-Trick)' : ''}`,
    summaryEn: `${uniqueChamps} champions, ${uniqueRoles} roles${otp ? ' (one-trick)' : ''}`,
    details: [
      { name: 'Unique Champions', value: uniqueChamps, unit: '', description: 'Verschiedene Champions gespielt' },
      { name: 'Aktive Rollen', value: uniqueRoles, unit: '', description: 'Rollen mit >10% Spielanteil' },
      { name: 'Main-Champion-Rate', value: +(topChampRate * 100).toFixed(0), unit: '%', description: 'Spielanteil des meistgespielten Champions' },
      { name: 'One-Trick', value: otp ? 1 : 0, unit: '', description: '>60% auf einem Champion' },
    ],
  };
}

function calcTrend(matches: ExtendedMatchData[]): CategoryScore {
  if (matches.length < 10) {
    return {
      id: 'trend', name: 'Trend', nameEn: 'Trend', icon: '📉',
      score: 50, trend: 0, impact: 0,
      summary: 'Zu wenige Spiele für Trend-Analyse',
      summaryEn: 'Not enough games for trend analysis',
      details: [],
    };
  }

  const mid = Math.floor(matches.length / 2);
  const recent = matches.slice(0, mid);
  const older = matches.slice(mid);

  const recentWR = rate(recent, m => m.win) * 100;
  const olderWR = rate(older, m => m.win) * 100;
  const wrTrend = recentWR - olderWR;

  const recentKDA = avg(recent, m => (m.kills + m.assists) / Math.max(m.deaths, 1));
  const olderKDA = avg(older, m => (m.kills + m.assists) / Math.max(m.deaths, 1));
  const kdaTrend = olderKDA > 0 ? ((recentKDA - olderKDA) / olderKDA) * 100 : 0;

  const recentDPM = avg(recent, m => m.challenges.damagePerMinute);
  const olderDPM = avg(older, m => m.challenges.damagePerMinute);
  const dpmTrend = olderDPM > 0 ? ((recentDPM - olderDPM) / olderDPM) * 100 : 0;

  const overallTrend = wrTrend * 0.5 + kdaTrend * 0.15 + dpmTrend * 0.1;
  const score = clamp(50 + overallTrend);

  return {
    id: 'trend', name: 'Trend', nameEn: 'Trend', icon: '📊',
    score, trend: Math.round(overallTrend),
    impact: overallTrend / 200,
    summary: `WR ${wrTrend > 0 ? '+' : ''}${wrTrend.toFixed(0)}%, KDA ${kdaTrend > 0 ? '+' : ''}${kdaTrend.toFixed(0)}%`,
    summaryEn: `WR ${wrTrend > 0 ? '+' : ''}${wrTrend.toFixed(0)}%, KDA ${kdaTrend > 0 ? '+' : ''}${kdaTrend.toFixed(0)}%`,
    details: [
      { name: 'Winrate-Trend', value: +wrTrend.toFixed(1), unit: '%', description: 'Veränderung der Siegrate (neuere vs. ältere Spiele)' },
      { name: 'KDA-Trend', value: +kdaTrend.toFixed(1), unit: '%', description: 'Veränderung der KDA' },
      { name: 'DPM-Trend', value: +dpmTrend.toFixed(1), unit: '%', description: 'Veränderung des Schadens/Min' },
      { name: 'Aktuelle Winrate', value: +recentWR.toFixed(0), unit: '%', description: 'Winrate in neueren Spielen' },
      { name: 'Frühere Winrate', value: +olderWR.toFixed(0), unit: '%', description: 'Winrate in älteren Spielen' },
    ],
  };
}

function calcCommunication(matches: ExtendedMatchData[]): CategoryScore {
  const avgMia = avg(matches, m => m.challenges.enemyMissingPings);
  const avgOmw = avg(matches, m => m.challenges.onMyWayPings);
  const avgDanger = avg(matches, m => m.challenges.dangerPings);
  const avgAssistMe = avg(matches, m => m.challenges.assistMePings);
  const avgVision = avg(matches, m => m.challenges.needVisionPings);
  const avgEnemyVision = avg(matches, m => m.challenges.enemyVisionPings);
  const avgCommand = avg(matches, m => m.challenges.commandPings);
  const avgRetreat = avg(matches, m => m.challenges.retreatPings + m.challenges.getBackPings);
  const avgBait = avg(matches, m => m.challenges.baitPings);

  // "Constructive" pings: MIA, danger, OMW, vision, command
  const constructive = avgMia + avgOmw + avgDanger + avgVision + avgEnemyVision + avgCommand;
  // Total pings
  const total = constructive + avgAssistMe + avgRetreat + avgBait;

  const constructiveRate = total > 0 ? (constructive / total) * 100 : 50;
  const pingVolume = total;

  // Moderate ping use with high constructive rate = best
  const volumeScore = pingVolume < 5 ? 30 : pingVolume > 100 ? 40 : 70;
  const qualityScore = scoreFromThresholds(constructiveRate, 30, 50, 65, 80);
  const score = clamp(volumeScore * 0.3 + qualityScore * 0.7);

  return {
    id: 'communication', name: 'Kommunikation', nameEn: 'Communication', icon: '💬',
    score, trend: 0,
    impact: (score - 50) / 500,
    summary: `Ø ${total.toFixed(0)} Pings/Spiel, ${constructiveRate.toFixed(0)}% konstruktiv`,
    summaryEn: `Avg ${total.toFixed(0)} pings/game, ${constructiveRate.toFixed(0)}% constructive`,
    details: [
      { name: 'MIA-Pings', value: +avgMia.toFixed(1), unit: '/Spiel', description: 'Enemy Missing Pings' },
      { name: 'OMW-Pings', value: +avgOmw.toFixed(1), unit: '/Spiel', description: 'On My Way Pings' },
      { name: 'Danger-Pings', value: +avgDanger.toFixed(1), unit: '/Spiel', description: 'Danger Pings' },
      { name: 'Assist Me', value: +avgAssistMe.toFixed(1), unit: '/Spiel', description: 'Hilfe-Pings' },
      { name: 'Vision-Pings', value: +avgVision.toFixed(1), unit: '/Spiel', description: 'Vision-Anfragen' },
      { name: 'Command-Pings', value: +avgCommand.toFixed(1), unit: '/Spiel', description: 'Befehls-Pings' },
      { name: 'Gesamt-Pings', value: +total.toFixed(0), unit: '/Spiel', description: 'Alle Pings pro Spiel' },
      { name: 'Konstruktiv-Rate', value: +constructiveRate.toFixed(0), unit: '%', description: 'Anteil konstruktiver Pings' },
    ],
  };
}

function calcRankProgress(matches: ExtendedMatchData[], ranked: { tier: string; rank: string; leaguePoints: number; wins: number; losses: number } | null): CategoryScore {
  if (!ranked) {
    return {
      id: 'rank_progress', name: 'Rangfortschritt', nameEn: 'Rank Progress', icon: '🏅',
      score: 0, trend: 0, impact: 0,
      summary: 'Unranked',
      summaryEn: 'Unranked',
      details: [],
    };
  }

  const totalGames = ranked.wins + ranked.losses;
  const overallWR = totalGames > 0 ? (ranked.wins / totalGames) * 100 : 50;
  const tierOrder: Record<string, number> = { IRON: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4, EMERALD: 5, DIAMOND: 6, MASTER: 7, GRANDMASTER: 8, CHALLENGER: 9 };
  const rankOrder: Record<string, number> = { IV: 0, III: 1, II: 2, I: 3 };
  const tierScore = (tierOrder[ranked.tier] ?? 0) * 10 + (rankOrder[ranked.rank] ?? 0) * 2.5 + ranked.leaguePoints / 100 * 2.5;
  const score = clamp(tierScore);

  return {
    id: 'rank_progress', name: 'Rangfortschritt', nameEn: 'Rank Progress', icon: '🏅',
    score, trend: 0,
    impact: 0, // rank is already reflected in base value
    summary: `${ranked.tier} ${ranked.rank} (${ranked.leaguePoints} LP) — ${overallWR.toFixed(0)}% WR`,
    summaryEn: `${ranked.tier} ${ranked.rank} (${ranked.leaguePoints} LP) — ${overallWR.toFixed(0)}% WR`,
    details: [
      { name: 'Rang', value: tierOrder[ranked.tier] ?? 0, unit: '', description: `${ranked.tier} ${ranked.rank}` },
      { name: 'LP', value: ranked.leaguePoints, unit: 'LP', description: 'League Points' },
      { name: 'Siege (Saison)', value: ranked.wins, unit: '', description: 'Ranked-Siege insgesamt' },
      { name: 'Niederlagen (Saison)', value: ranked.losses, unit: '', description: 'Ranked-Niederlagen insgesamt' },
      { name: 'Winrate (Saison)', value: +overallWR.toFixed(1), unit: '%', description: 'Gesamte Ranked-Winrate' },
    ],
  };
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function calculateStatsOverview(
  matches: ExtendedMatchData[],
  ranked: { tier: string; rank: string; leaguePoints: number; wins: number; losses: number } | null
): StatsOverview {
  if (matches.length === 0) {
    return { categories: [], overallScore: 0, role: 'UNKNOWN', gamesAnalyzed: 0 };
  }

  const role = detectRole(matches);

  const categories: CategoryScore[] = [
    calcWinRate(matches),
    calcKDA(matches),
    calcLaneDominance(matches),
    calcFarming(matches),
    calcDamageOutput(matches),
    calcDamageShare(matches),
    calcSurvivability(matches),
    calcVisionControl(matches),
    calcObjectiveControl(matches),
    calcGoldEfficiency(matches),
    calcTeamplay(matches),
    calcClutchFactor(matches),
    calcComebackStrength(matches),
    calcEarlyGameImpact(matches),
    calcMechanics(matches),
    calcConsistency(matches),
    calcVersatility(matches),
    calcTrend(matches),
    calcCommunication(matches),
    calcRankProgress(matches, ranked),
  ];

  const overallScore = Math.round(
    categories.reduce((s, c) => s + c.score, 0) / categories.length
  );

  return { categories, overallScore, role, gamesAnalyzed: matches.length };
}
