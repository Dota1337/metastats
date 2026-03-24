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
  // B05: Kill Participation
  teamKills?: number;
  // B06: Solo Kills
  soloKills?: number;
  // B08: Damage Taken
  totalDamageTaken?: number;
  // B09: Damage Share
  teamDamage?: number;
  // B12: Multi-Kills
  doubleKills?: number;
  tripleKills?: number;
  quadraKills?: number;
  pentaKills?: number;
  // C05/C06: Gold
  goldEarned?: number;
  teamGold?: number;
  // D03: Control Wards
  controlWardsPlaced?: number;
  // D04: Wards Destroyed
  wardsKilled?: number;
  // E04: Rift Herald
  riftHeraldKills?: number;
  // E05: Inhibitors
  inhibitorKills?: number;
  // J05: Heal/Shield
  totalHealsOnTeammates?: number;
  totalDamageShieldedOnTeammates?: number;
  // J06: CC Score
  timeCCingOthers?: number;
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

// A09: Role Flexibility - number of roles with >15% play share
function calculateRoleFlexibility(matches: MatchData[]): number {
  if (matches.length === 0) return 0;
  const roleCounts: Record<string, number> = {};
  matches.forEach(m => {
    const role = m.role || 'UNKNOWN';
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  });
  return Object.values(roleCounts).filter(c => c / matches.length > 0.15).length;
}

// Helper: safe average for optional numeric fields
function avgOptional(matches: MatchData[], getter: (m: MatchData) => number | undefined): number | null {
  const valid = matches.filter(m => getter(m) != null);
  if (valid.length === 0) return null;
  return valid.reduce((s, m) => s + (getter(m) ?? 0), 0) / valid.length;
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

  // B05: Kill Participation
  const avgKillParticipation = avgOptional(matches, m =>
    m.teamKills != null && m.teamKills > 0 ? (m.kills + m.assists) / m.teamKills : undefined
  );

  // B06: Solo Kills per game
  const avgSoloKills = avgOptional(matches, m => m.soloKills);

  // B08: Damage Taken per minute
  const avgDamageTaken = avgOptional(matches, m => m.totalDamageTaken);
  const damageTakenPerMin = avgDamageTaken != null ? avgDamageTaken / avgDuration : null;

  // B09: Damage Share
  const avgDamageShare = avgOptional(matches, m =>
    m.teamDamage != null && m.teamDamage > 0 ? m.damageDealt / m.teamDamage : undefined
  );

  // B12: Multi-Kill Score (weighted: double=1, triple=3, quadra=5, penta=10)
  const multiKillScore = avgOptional(matches, m => {
    if (m.doubleKills == null) return undefined;
    return (m.doubleKills ?? 0) * 1 + (m.tripleKills ?? 0) * 3
      + (m.quadraKills ?? 0) * 5 + (m.pentaKills ?? 0) * 10;
  });

  // C05: Gold per minute
  const avgGoldEarned = avgOptional(matches, m => m.goldEarned);
  const goldPerMin = avgGoldEarned != null ? avgGoldEarned / avgDuration : null;

  // C06: Gold Share
  const avgGoldShare = avgOptional(matches, m =>
    m.teamGold != null && m.teamGold > 0 ? (m.goldEarned ?? 0) / m.teamGold : undefined
  );

  // C08: Damage / Gold Ratio
  const damageGoldRatio = avgOptional(matches, m =>
    m.goldEarned != null && m.goldEarned > 0 ? m.damageDealt / m.goldEarned : undefined
  );

  // D03: Control Wards
  const avgControlWards = avgOptional(matches, m => m.controlWardsPlaced);

  // D04: Wards Destroyed
  const avgWardsKilled = avgOptional(matches, m => m.wardsKilled);

  // D05: Vision Score per minute
  const visionPerMin = avgVision / avgDuration;

  // D08: Vision Dominance Composite (normalized 0-1)
  const visionDominance = (() => {
    let score = 0;
    let factors = 0;
    if (avgVision > 0) { score += Math.min(avgVision / 50, 1) * 0.35; factors++; }
    if (avgWards > 0) { score += Math.min(avgWards / 30, 1) * 0.25; factors++; }
    if (avgControlWards != null) { score += Math.min(avgControlWards / 5, 1) * 0.20; factors++; }
    if (avgWardsKilled != null) { score += Math.min(avgWardsKilled / 5, 1) * 0.20; factors++; }
    return factors > 0 ? score : null;
  })();

  // E04: Rift Herald
  const avgHeralds = avgOptional(matches, m => m.riftHeraldKills);

  // E05: Inhibitor Kills
  const avgInhibitors = avgOptional(matches, m => m.inhibitorKills);

  // E06: Objective Combo Score (dragons + barons weighted)
  const objectiveCombo = avgDragons + avgBarons * 2;

  // A09: Role Flexibility bonus
  const roleFlexibility = calculateRoleFlexibility(matches);

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

  // B05: Kill Participation (universal)
  if (avgKillParticipation != null) {
    if (avgKillParticipation > 0.70) multiplier += 0.06;
    else if (avgKillParticipation > 0.60) multiplier += 0.03;
    else if (avgKillParticipation < 0.35) multiplier -= 0.04;
  }

  // B12: Multi-Kill bonus (universal)
  if (multiKillScore != null) {
    if (multiKillScore > 8) multiplier += 0.06;
    else if (multiKillScore > 4) multiplier += 0.03;
  }

  // A09: Role Flexibility bonus
  if (roleFlexibility >= 3) multiplier += 0.04;

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

    // J05: Heal/Shield output
    const avgHealShield = avgOptional(matches, m => {
      if (m.totalHealsOnTeammates == null && m.totalDamageShieldedOnTeammates == null) return undefined;
      return (m.totalHealsOnTeammates ?? 0) + (m.totalDamageShieldedOnTeammates ?? 0);
    });
    if (avgHealShield != null) {
      const healShieldPerMin = avgHealShield / avgDuration;
      if (healShieldPerMin > 500) multiplier += 0.10;
      else if (healShieldPerMin > 300) multiplier += 0.05;
    }

    // J06: CC Score
    const avgCC = avgOptional(matches, m => m.timeCCingOthers);
    if (avgCC != null) {
      if (avgCC > 40) multiplier += 0.08;
      else if (avgCC > 25) multiplier += 0.04;
    }

    // D05/D08: Vision per minute & dominance (SUP emphasis)
    if (visionPerMin > 1.5) multiplier += 0.06;
    if (visionDominance != null && visionDominance > 0.7) multiplier += 0.06;

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

    // G04: Objective Combo (enhanced)
    if (objectiveCombo > 3) multiplier += 0.04;

    // E04: Rift Herald
    if (avgHeralds != null && avgHeralds > 0.5) multiplier += 0.05;

    // G09: First Blood involvement (JGL ganks)
    if (firstBloodRate > 0.40) multiplier += 0.04;

    // D05: Vision per minute
    if (visionPerMin > 1.0) multiplier += 0.04;

    // C05: Gold efficiency
    if (goldPerMin != null && goldPerMin > 400) multiplier += 0.04;

    // B08: Damage Taken (tanky junglers)
    if (damageTakenPerMin != null && damageTakenPerMin > 800) multiplier += 0.03;

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

    // F08: Solo Kill Rate (1v1 dominance)
    if (avgSoloKills != null) {
      if (avgSoloKills > 1.5) multiplier += 0.08;
      else if (avgSoloKills > 1.0) multiplier += 0.04;
    }

    // B08: Damage Taken (tank toplaners)
    if (damageTakenPerMin != null && damageTakenPerMin > 1000) multiplier += 0.05;

    // B09: Damage Share
    if (avgDamageShare != null && avgDamageShare > 0.28) multiplier += 0.04;

    // E04: Rift Herald (TOP lane impact)
    if (avgHeralds != null && avgHeralds > 0.3) multiplier += 0.04;

    // C05: Gold efficiency
    if (goldPerMin != null && goldPerMin > 420) multiplier += 0.04;

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

    // H08: Solo Kills (assassination/lane dominance)
    if (avgSoloKills != null) {
      if (avgSoloKills > 1.5) multiplier += 0.08;
      else if (avgSoloKills > 1.0) multiplier += 0.04;
    }

    // B09: Damage Share (carry potential)
    if (avgDamageShare != null) {
      if (avgDamageShare > 0.30) multiplier += 0.06;
      else if (avgDamageShare > 0.25) multiplier += 0.03;
    }

    // C05: Gold efficiency
    if (goldPerMin != null && goldPerMin > 430) multiplier += 0.04;

    // D05: Vision per minute (roaming awareness)
    if (visionPerMin > 0.8) multiplier += 0.03;

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

    // I04: Damage Share (ADC carry signal)
    if (avgDamageShare != null) {
      if (avgDamageShare > 0.32) multiplier += 0.08;
      else if (avgDamageShare > 0.28) multiplier += 0.04;
      else if (avgDamageShare < 0.20) multiplier -= 0.05;
    }

    // I06: Kiting Efficiency (damage dealt / damage taken)
    if (avgDamageTaken != null && avgDamageTaken > 0) {
      const kitingRatio = avgDamage / avgDamageTaken;
      if (kitingRatio > 2.5) multiplier += 0.06;
      else if (kitingRatio > 1.8) multiplier += 0.03;
      else if (kitingRatio < 1.0) multiplier -= 0.04;
    }

    // I08: Multi-Kill Rate (ADC carry highlights)
    if (multiKillScore != null) {
      if (multiKillScore > 10) multiplier += 0.06;
      else if (multiKillScore > 6) multiplier += 0.03;
    }

    // C05: Gold per minute
    if (goldPerMin != null && goldPerMin > 440) multiplier += 0.04;

    // C06: Gold Share
    if (avgGoldShare != null && avgGoldShare > 0.27) multiplier += 0.04;
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