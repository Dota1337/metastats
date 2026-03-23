interface MatchData {
  kills: number;
  deaths: number;
  assists: number;
  win: boolean;
  gameDuration: number;
  cs: number;
  role: string;
  damageDealt: number;
  visionScore: number;
  wardsPlaced: number;
  firstBloodKill: boolean;
  firstBloodAssist: boolean;
  firstBloodVictim: boolean;
  dragonKills: number;
  baronKills: number;
  turretKills: number;
  gameWonFromBehind: boolean;
  surrendered: boolean;
}

interface RankedData {
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
}

const TIER_ORDER: Record<string, number> = {
  IRON: 0, BRONZE: 1, SILVER: 2, GOLD: 3,
  PLATINUM: 4, EMERALD: 5, DIAMOND: 6,
  MASTER: 7, GRANDMASTER: 8, CHALLENGER: 9,
};

const RANK_ORDER: Record<string, number> = {
  IV: 0, III: 1, II: 2, I: 3,
};

function getBaseValue(tier: string, rank: string, lp: number, totalPlayers?: number, playerRank?: number): number {
  const tierNum = TIER_ORDER[tier] ?? -1;

  if (tierNum < TIER_ORDER['DIAMOND'] || (tierNum === TIER_ORDER['DIAMOND'] && RANK_ORDER[rank] < RANK_ORDER['IV'])) {
    return 0;
  }

  if (tier === 'CHALLENGER') {
    if (playerRank === 1) return 750000;
    if (playerRank && playerRank <= 10) return 200000 + ((10 - playerRank) / 9) * 550000;
    if (playerRank && playerRank <= 50) return 75000 + ((50 - playerRank) / 40) * 125000;
    return 25000 + (lp / 1000) * 50000;
  }

  if (tier === 'GRANDMASTER') return 8000 + (lp / 400) * 17000;
  if (tier === 'MASTER') return 2000 + (lp / 200) * 6000;

  if (tier === 'DIAMOND') {
    if (rank === 'I') return 800 + (lp / 100) * 1200;
    if (rank === 'II') return 500 + (lp / 100) * 300;
    if (rank === 'III') return 250 + (lp / 100) * 250;
    if (rank === 'IV') return 10 + (lp / 100) * 240;
  }

  return 0;
}

function detectPrimaryRole(matches: MatchData[]): string {
  const roleCounts: Record<string, number> = {};
  matches.forEach(m => {
    const role = m.role || 'UNKNOWN';
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  });
  return Object.entries(roleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'UNKNOWN';
}

function calculateMultiplier(matches: MatchData[], role: string): number {
  if (matches.length === 0) return 1;

  const wins = matches.filter(m => m.win).length;
  const winrate = wins / matches.length;

  const totalKills = matches.reduce((s, m) => s + m.kills, 0);
  const totalDeaths = matches.reduce((s, m) => s + m.deaths, 0);
  const totalAssists = matches.reduce((s, m) => s + m.assists, 0);
  const kda = (totalKills + totalAssists) / Math.max(totalDeaths, 1);

  const avgDuration = matches.reduce((s, m) => s + m.gameDuration, 0) / matches.length / 60;
  const avgCs = matches.reduce((s, m) => s + m.cs, 0) / matches.length;
  const csPerMin = avgCs / avgDuration;

  const avgDamage = matches.reduce((s, m) => s + m.damageDealt, 0) / matches.length;
  const damagePerMin = avgDamage / avgDuration;

  const avgVision = matches.reduce((s, m) => s + m.visionScore, 0) / matches.length;
  const avgWards = matches.reduce((s, m) => s + m.wardsPlaced, 0) / matches.length;

  const firstBloods = matches.filter(m => m.firstBloodKill || m.firstBloodAssist).length;
  const firstBloodRate = firstBloods / matches.length;
  const firstBloodVictimRate = matches.filter(m => m.firstBloodVictim).length / matches.length;

  const avgDragons = matches.reduce((s, m) => s + m.dragonKills, 0) / matches.length;
  const avgBarons = matches.reduce((s, m) => s + m.baronKills, 0) / matches.length;
  const avgTurrets = matches.reduce((s, m) => s + m.turretKills, 0) / matches.length;

  const comebackRate = matches.filter(m => m.gameWonFromBehind).length / matches.length;
  const surrenderRate = matches.filter(m => m.surrendered).length / matches.length;

  let multiplier = 1;

  // Winrate
  if (winrate > 0.60) multiplier += 0.175;
  else if (winrate > 0.55) multiplier += 0.10;
  else if (winrate < 0.45) multiplier -= 0.175;
  else if (winrate < 0.50) multiplier -= 0.10;

  // Comeback & Surrender
  if (comebackRate > 0.30) multiplier += 0.07;
  if (surrenderRate > 0.40) multiplier -= 0.08;

  // First Blood
  if (firstBloodRate > 0.30) multiplier += 0.08;
  if (firstBloodVictimRate > 0.30) multiplier -= 0.05;

  if (role === 'SUPPORT') {
    // Support: Assists, Vision, Wards
    const assistsPerGame = totalAssists / matches.length;
    if (assistsPerGame > 18) multiplier += 0.175;
    else if (assistsPerGame > 12) multiplier += 0.10;
    else if (assistsPerGame < 6) multiplier -= 0.10;

    if (avgVision > 45) multiplier += 0.175;
    else if (avgVision > 30) multiplier += 0.10;
    else if (avgVision < 10) multiplier -= 0.10;

    if (avgWards > 25) multiplier += 0.10;
    else if (avgWards < 10) multiplier -= 0.05;

    if (avgDragons + avgBarons > 0.5) multiplier += 0.10;

  } else if (role === 'JUNGLE') {
    // Jungle: Objectives, First Blood, KDA
    if (kda > 4.0) multiplier += 0.175;
    else if (kda > 3.0) multiplier += 0.10;
    else if (kda < 1.5) multiplier -= 0.10;
    else if (kda < 1.0) multiplier -= 0.175;

    if (avgDragons > 1.5) multiplier += 0.10;
    if (avgBarons > 0.5) multiplier += 0.10;
    if (avgDragons + avgBarons > 2) multiplier += 0.06;

    if (avgVision > 25) multiplier += 0.06;

  } else if (role === 'TOP') {
    // Top: CS, Damage, Turrets
    if (csPerMin > 8.0) multiplier += 0.10;
    else if (csPerMin > 7.0) multiplier += 0.05;
    else if (csPerMin < 5.0) multiplier -= 0.05;
    else if (csPerMin < 4.0) multiplier -= 0.10;

    if (damagePerMin > 800) multiplier += 0.10;
    else if (damagePerMin < 400) multiplier -= 0.05;

    if (avgTurrets > 2) multiplier += 0.10;

    if (kda > 3.0) multiplier += 0.10;
    else if (kda < 1.5) multiplier -= 0.10;

  } else if (role === 'MIDDLE') {
    // Mid: KDA, CS, Damage
    if (kda > 4.0) multiplier += 0.175;
    else if (kda > 3.0) multiplier += 0.10;
    else if (kda < 1.5) multiplier -= 0.10;
    else if (kda < 1.0) multiplier -= 0.175;

    if (csPerMin > 8.0) multiplier += 0.10;
    else if (csPerMin > 7.0) multiplier += 0.05;
    else if (csPerMin < 5.0) multiplier -= 0.05;

    if (damagePerMin > 900) multiplier += 0.175;
    else if (damagePerMin > 700) multiplier += 0.10;
    else if (damagePerMin < 400) multiplier -= 0.05;

    if (avgVision > 20) multiplier += 0.06;

  } else {
    // ADC / Default
    if (csPerMin > 8.0) multiplier += 0.10;
    else if (csPerMin > 7.0) multiplier += 0.05;
    else if (csPerMin < 5.0) multiplier -= 0.05;
    else if (csPerMin < 4.0) multiplier -= 0.10;

    if (damagePerMin > 950) multiplier += 0.175;
    else if (damagePerMin > 750) multiplier += 0.10;
    else if (damagePerMin < 400) multiplier -= 0.05;

    if (kda > 4.0) multiplier += 0.175;
    else if (kda > 3.0) multiplier += 0.10;
    else if (kda < 1.5) multiplier -= 0.10;
    else if (kda < 1.0) multiplier -= 0.175;
  }

  return Math.max(multiplier, 0.1);
}

export function calculateMarketValue(
  ranked: RankedData | null,
  matches: MatchData[],
  playerRank?: number
): { value: number; formatted: string; role: string; rated: boolean } {
  if (!ranked) {
    return { value: 0, formatted: 'Not Rated', role: 'UNKNOWN', rated: false };
  }

  const base = getBaseValue(ranked.tier, ranked.rank, ranked.leaguePoints, undefined, playerRank);

  if (base === 0) {
    return { value: 0, formatted: 'Not Rated', role: 'UNKNOWN', rated: false };
  }

  const role = detectPrimaryRole(matches);
  const multiplier = calculateMultiplier(matches, role);
  const finalValue = Math.round(base * multiplier);

  const formatted = finalValue >= 1000000
    ? '$' + (finalValue / 1000000).toFixed(2) + 'M'
    : finalValue >= 1000
    ? '$' + (finalValue / 1000).toFixed(1) + 'k'
    : '$' + finalValue;

  return { value: finalValue, formatted, role, rated: true };
}