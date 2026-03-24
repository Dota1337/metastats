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
  teamKills?: number;
  soloKills?: number;
  totalDamageTaken?: number;
  teamDamage?: number;
  doubleKills?: number;
  tripleKills?: number;
  quadraKills?: number;
  pentaKills?: number;
  goldEarned?: number;
  teamGold?: number;
  controlWardsPlaced?: number;
  wardsKilled?: number;
  riftHeraldKills?: number;
  inhibitorKills?: number;
  totalHealsOnTeammates?: number;
  totalDamageShieldedOnTeammates?: number;
  timeCCingOthers?: number;
}

interface RankedData {
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
}

export interface BreakdownItem {
  category: string;
  label: string;
  impact: number;
  stat: string;
  positive: boolean;
}

export interface MarketValueResult {
  value: number;
  formatted: string;
  role: string;
  rated: boolean;
  breakdown: BreakdownItem[];
  baseValue: number;
  multiplier: number;
  stats: {
    winrate: number;
    kda: number;
    csPerMin: number;
    damagePerMin: number;
    visionScore: number;
    killParticipation: number | null;
    gamesAnalyzed: number;
  };
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

function calculateRoleFlexibility(matches: MatchData[]): number {
  if (matches.length === 0) return 0;
  const roleCounts: Record<string, number> = {};
  matches.forEach(m => {
    const role = m.role || 'UNKNOWN';
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  });
  return Object.values(roleCounts).filter(c => c / matches.length > 0.15).length;
}

function avgOptional(matches: MatchData[], getter: (m: MatchData) => number | undefined): number | null {
  const valid = matches.filter(m => getter(m) != null);
  if (valid.length === 0) return null;
  return valid.reduce((s, m) => s + (getter(m) ?? 0), 0) / valid.length;
}

function calculateMultiplierWithBreakdown(matches: MatchData[], role: string): { multiplier: number; breakdown: BreakdownItem[] } {
  const breakdown: BreakdownItem[] = [];
  if (matches.length === 0) return { multiplier: 1, breakdown };

  const add = (category: string, label: string, impact: number, stat: string) => {
    breakdown.push({ category, label, impact, stat, positive: impact > 0 });
  };

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

  const avgKillParticipation = avgOptional(matches, m =>
    m.teamKills != null && m.teamKills > 0 ? (m.kills + m.assists) / m.teamKills : undefined
  );
  const avgSoloKills = avgOptional(matches, m => m.soloKills);
  const avgDamageTaken = avgOptional(matches, m => m.totalDamageTaken);
  const damageTakenPerMin = avgDamageTaken != null ? avgDamageTaken / avgDuration : null;
  const avgDamageShare = avgOptional(matches, m =>
    m.teamDamage != null && m.teamDamage > 0 ? m.damageDealt / m.teamDamage : undefined
  );
  const multiKillScore = avgOptional(matches, m => {
    if (m.doubleKills == null) return undefined;
    return (m.doubleKills ?? 0) * 1 + (m.tripleKills ?? 0) * 3
      + (m.quadraKills ?? 0) * 5 + (m.pentaKills ?? 0) * 10;
  });
  const avgGoldEarned = avgOptional(matches, m => m.goldEarned);
  const goldPerMin = avgGoldEarned != null ? avgGoldEarned / avgDuration : null;
  const avgGoldShare = avgOptional(matches, m =>
    m.teamGold != null && m.teamGold > 0 ? (m.goldEarned ?? 0) / m.teamGold : undefined
  );
  const avgControlWards = avgOptional(matches, m => m.controlWardsPlaced);
  const avgWardsKilled = avgOptional(matches, m => m.wardsKilled);
  const visionPerMin = avgVision / avgDuration;

  const visionDominance = (() => {
    let score = 0;
    let factors = 0;
    if (avgVision > 0) { score += Math.min(avgVision / 50, 1) * 0.35; factors++; }
    if (avgWards > 0) { score += Math.min(avgWards / 30, 1) * 0.25; factors++; }
    if (avgControlWards != null) { score += Math.min(avgControlWards / 5, 1) * 0.20; factors++; }
    if (avgWardsKilled != null) { score += Math.min(avgWardsKilled / 5, 1) * 0.20; factors++; }
    return factors > 0 ? score : null;
  })();

  const avgHeralds = avgOptional(matches, m => m.riftHeraldKills);
  const objectiveCombo = avgDragons + avgBarons * 2;
  const roleFlexibility = calculateRoleFlexibility(matches);

  let multiplier = 1;

  // === Universal Factors ===

  if (winrate > 0.60) { multiplier += 0.175; add('Allgemein', 'Winrate', +0.175, `${(winrate * 100).toFixed(1)}% (>60%)`); }
  else if (winrate > 0.55) { multiplier += 0.10; add('Allgemein', 'Winrate', +0.10, `${(winrate * 100).toFixed(1)}% (>55%)`); }
  else if (winrate < 0.45) { multiplier -= 0.175; add('Allgemein', 'Winrate', -0.175, `${(winrate * 100).toFixed(1)}% (<45%)`); }
  else if (winrate < 0.50) { multiplier -= 0.10; add('Allgemein', 'Winrate', -0.10, `${(winrate * 100).toFixed(1)}% (<50%)`); }

  if (comebackRate > 0.30) { multiplier += 0.07; add('Allgemein', 'Comeback-Rate', +0.07, `${(comebackRate * 100).toFixed(0)}% (>30%)`); }
  if (surrenderRate > 0.40) { multiplier -= 0.08; add('Allgemein', 'Surrender-Rate', -0.08, `${(surrenderRate * 100).toFixed(0)}% (>40%)`); }

  if (firstBloodRate > 0.30) { multiplier += 0.08; add('Aggression', 'First Blood', +0.08, `${(firstBloodRate * 100).toFixed(0)}% (>30%)`); }
  if (firstBloodVictimRate > 0.30) { multiplier -= 0.05; add('Aggression', 'First Blood Opfer', -0.05, `${(firstBloodVictimRate * 100).toFixed(0)}% (>30%)`); }

  if (avgKillParticipation != null) {
    if (avgKillParticipation > 0.70) { multiplier += 0.06; add('Teamplay', 'Kill Participation', +0.06, `${(avgKillParticipation * 100).toFixed(0)}% (>70%)`); }
    else if (avgKillParticipation > 0.60) { multiplier += 0.03; add('Teamplay', 'Kill Participation', +0.03, `${(avgKillParticipation * 100).toFixed(0)}% (>60%)`); }
    else if (avgKillParticipation < 0.35) { multiplier -= 0.04; add('Teamplay', 'Kill Participation', -0.04, `${(avgKillParticipation * 100).toFixed(0)}% (<35%)`); }
  }

  if (multiKillScore != null) {
    if (multiKillScore > 8) { multiplier += 0.06; add('Aggression', 'Multi-Kills', +0.06, `Score ${multiKillScore.toFixed(1)} (>8)`); }
    else if (multiKillScore > 4) { multiplier += 0.03; add('Aggression', 'Multi-Kills', +0.03, `Score ${multiKillScore.toFixed(1)} (>4)`); }
  }

  if (roleFlexibility >= 3) { multiplier += 0.04; add('Allgemein', 'Rollen-Flexibilität', +0.04, `${roleFlexibility} Rollen`); }

  // === Role-Specific Factors ===

  if (role === 'SUPPORT') {
    const assistsPerGame = totalAssists / matches.length;
    if (assistsPerGame > 18) { multiplier += 0.175; add('Support', 'Assists/Spiel', +0.175, `${assistsPerGame.toFixed(1)} (>18)`); }
    else if (assistsPerGame > 12) { multiplier += 0.10; add('Support', 'Assists/Spiel', +0.10, `${assistsPerGame.toFixed(1)} (>12)`); }
    else if (assistsPerGame < 6) { multiplier -= 0.10; add('Support', 'Assists/Spiel', -0.10, `${assistsPerGame.toFixed(1)} (<6)`); }

    if (avgVision > 45) { multiplier += 0.175; add('Vision', 'Vision Score', +0.175, `${avgVision.toFixed(1)} (>45)`); }
    else if (avgVision > 30) { multiplier += 0.10; add('Vision', 'Vision Score', +0.10, `${avgVision.toFixed(1)} (>30)`); }
    else if (avgVision < 10) { multiplier -= 0.10; add('Vision', 'Vision Score', -0.10, `${avgVision.toFixed(1)} (<10)`); }

    if (avgWards > 25) { multiplier += 0.10; add('Vision', 'Wards/Spiel', +0.10, `${avgWards.toFixed(1)} (>25)`); }
    else if (avgWards < 10) { multiplier -= 0.05; add('Vision', 'Wards/Spiel', -0.05, `${avgWards.toFixed(1)} (<10)`); }

    if (avgDragons + avgBarons > 0.5) { multiplier += 0.10; add('Objectives', 'Dragon+Baron', +0.10, `${(avgDragons + avgBarons).toFixed(2)}/Spiel`); }

    const avgHealShield = avgOptional(matches, m => {
      if (m.totalHealsOnTeammates == null && m.totalDamageShieldedOnTeammates == null) return undefined;
      return (m.totalHealsOnTeammates ?? 0) + (m.totalDamageShieldedOnTeammates ?? 0);
    });
    if (avgHealShield != null) {
      const hsPerMin = avgHealShield / avgDuration;
      if (hsPerMin > 500) { multiplier += 0.10; add('Support', 'Heal/Shield pro Min', +0.10, `${hsPerMin.toFixed(0)} (>500)`); }
      else if (hsPerMin > 300) { multiplier += 0.05; add('Support', 'Heal/Shield pro Min', +0.05, `${hsPerMin.toFixed(0)} (>300)`); }
    }

    const avgCC = avgOptional(matches, m => m.timeCCingOthers);
    if (avgCC != null) {
      if (avgCC > 40) { multiplier += 0.08; add('Support', 'CC Score', +0.08, `${avgCC.toFixed(1)} (>40)`); }
      else if (avgCC > 25) { multiplier += 0.04; add('Support', 'CC Score', +0.04, `${avgCC.toFixed(1)} (>25)`); }
    }

    if (visionPerMin > 1.5) { multiplier += 0.06; add('Vision', 'Vision/Min', +0.06, `${visionPerMin.toFixed(2)} (>1.5)`); }
    if (visionDominance != null && visionDominance > 0.7) { multiplier += 0.06; add('Vision', 'Vision Dominanz', +0.06, `${(visionDominance * 100).toFixed(0)}% (>70%)`); }

  } else if (role === 'JUNGLE') {
    if (kda > 4.0) { multiplier += 0.175; add('Kampf', 'KDA', +0.175, `${kda.toFixed(2)} (>4.0)`); }
    else if (kda > 3.0) { multiplier += 0.10; add('Kampf', 'KDA', +0.10, `${kda.toFixed(2)} (>3.0)`); }
    else if (kda < 1.5) { multiplier -= 0.10; add('Kampf', 'KDA', -0.10, `${kda.toFixed(2)} (<1.5)`); }
    else if (kda < 1.0) { multiplier -= 0.175; add('Kampf', 'KDA', -0.175, `${kda.toFixed(2)} (<1.0)`); }

    if (avgDragons > 1.5) { multiplier += 0.10; add('Objectives', 'Dragons/Spiel', +0.10, `${avgDragons.toFixed(2)} (>1.5)`); }
    if (avgBarons > 0.5) { multiplier += 0.10; add('Objectives', 'Barons/Spiel', +0.10, `${avgBarons.toFixed(2)} (>0.5)`); }
    if (avgDragons + avgBarons > 2) { multiplier += 0.06; add('Objectives', 'Obj. Combo', +0.06, `${(avgDragons + avgBarons).toFixed(2)}/Spiel`); }

    if (avgVision > 25) { multiplier += 0.06; add('Vision', 'Vision Score', +0.06, `${avgVision.toFixed(1)} (>25)`); }
    if (objectiveCombo > 3) { multiplier += 0.04; add('Objectives', 'Obj. Score', +0.04, `${objectiveCombo.toFixed(2)} (>3)`); }
    if (avgHeralds != null && avgHeralds > 0.5) { multiplier += 0.05; add('Objectives', 'Rift Herald', +0.05, `${avgHeralds.toFixed(2)}/Spiel`); }
    if (firstBloodRate > 0.40) { multiplier += 0.04; add('Aggression', 'First Blood (JGL)', +0.04, `${(firstBloodRate * 100).toFixed(0)}% (>40%)`); }
    if (visionPerMin > 1.0) { multiplier += 0.04; add('Vision', 'Vision/Min', +0.04, `${visionPerMin.toFixed(2)} (>1.0)`); }
    if (goldPerMin != null && goldPerMin > 400) { multiplier += 0.04; add('Economy', 'Gold/Min', +0.04, `${goldPerMin.toFixed(0)} (>400)`); }
    if (damageTakenPerMin != null && damageTakenPerMin > 800) { multiplier += 0.03; add('Kampf', 'Schaden genommen/Min', +0.03, `${damageTakenPerMin.toFixed(0)} (>800)`); }

  } else if (role === 'TOP') {
    if (csPerMin > 8.0) { multiplier += 0.10; add('Farming', 'CS/Min', +0.10, `${csPerMin.toFixed(1)} (>8.0)`); }
    else if (csPerMin > 7.0) { multiplier += 0.05; add('Farming', 'CS/Min', +0.05, `${csPerMin.toFixed(1)} (>7.0)`); }
    else if (csPerMin < 5.0) { multiplier -= 0.05; add('Farming', 'CS/Min', -0.05, `${csPerMin.toFixed(1)} (<5.0)`); }
    else if (csPerMin < 4.0) { multiplier -= 0.10; add('Farming', 'CS/Min', -0.10, `${csPerMin.toFixed(1)} (<4.0)`); }

    if (damagePerMin > 800) { multiplier += 0.10; add('Kampf', 'Schaden/Min', +0.10, `${damagePerMin.toFixed(0)} (>800)`); }
    else if (damagePerMin < 400) { multiplier -= 0.05; add('Kampf', 'Schaden/Min', -0.05, `${damagePerMin.toFixed(0)} (<400)`); }

    if (avgTurrets > 2) { multiplier += 0.10; add('Objectives', 'Türme/Spiel', +0.10, `${avgTurrets.toFixed(1)} (>2)`); }

    if (kda > 3.0) { multiplier += 0.10; add('Kampf', 'KDA', +0.10, `${kda.toFixed(2)} (>3.0)`); }
    else if (kda < 1.5) { multiplier -= 0.10; add('Kampf', 'KDA', -0.10, `${kda.toFixed(2)} (<1.5)`); }

    if (avgSoloKills != null) {
      if (avgSoloKills > 1.5) { multiplier += 0.08; add('Aggression', 'Solo Kills', +0.08, `${avgSoloKills.toFixed(1)}/Spiel (>1.5)`); }
      else if (avgSoloKills > 1.0) { multiplier += 0.04; add('Aggression', 'Solo Kills', +0.04, `${avgSoloKills.toFixed(1)}/Spiel (>1.0)`); }
    }
    if (damageTakenPerMin != null && damageTakenPerMin > 1000) { multiplier += 0.05; add('Kampf', 'Tank-Schaden/Min', +0.05, `${damageTakenPerMin.toFixed(0)} (>1000)`); }
    if (avgDamageShare != null && avgDamageShare > 0.28) { multiplier += 0.04; add('Kampf', 'Damage Share', +0.04, `${(avgDamageShare * 100).toFixed(1)}% (>28%)`); }
    if (avgHeralds != null && avgHeralds > 0.3) { multiplier += 0.04; add('Objectives', 'Rift Herald', +0.04, `${avgHeralds.toFixed(2)}/Spiel`); }
    if (goldPerMin != null && goldPerMin > 420) { multiplier += 0.04; add('Economy', 'Gold/Min', +0.04, `${goldPerMin.toFixed(0)} (>420)`); }

  } else if (role === 'MIDDLE') {
    if (kda > 4.0) { multiplier += 0.175; add('Kampf', 'KDA', +0.175, `${kda.toFixed(2)} (>4.0)`); }
    else if (kda > 3.0) { multiplier += 0.10; add('Kampf', 'KDA', +0.10, `${kda.toFixed(2)} (>3.0)`); }
    else if (kda < 1.5) { multiplier -= 0.10; add('Kampf', 'KDA', -0.10, `${kda.toFixed(2)} (<1.5)`); }
    else if (kda < 1.0) { multiplier -= 0.175; add('Kampf', 'KDA', -0.175, `${kda.toFixed(2)} (<1.0)`); }

    if (csPerMin > 8.0) { multiplier += 0.10; add('Farming', 'CS/Min', +0.10, `${csPerMin.toFixed(1)} (>8.0)`); }
    else if (csPerMin > 7.0) { multiplier += 0.05; add('Farming', 'CS/Min', +0.05, `${csPerMin.toFixed(1)} (>7.0)`); }
    else if (csPerMin < 5.0) { multiplier -= 0.05; add('Farming', 'CS/Min', -0.05, `${csPerMin.toFixed(1)} (<5.0)`); }

    if (damagePerMin > 900) { multiplier += 0.175; add('Kampf', 'Schaden/Min', +0.175, `${damagePerMin.toFixed(0)} (>900)`); }
    else if (damagePerMin > 700) { multiplier += 0.10; add('Kampf', 'Schaden/Min', +0.10, `${damagePerMin.toFixed(0)} (>700)`); }
    else if (damagePerMin < 400) { multiplier -= 0.05; add('Kampf', 'Schaden/Min', -0.05, `${damagePerMin.toFixed(0)} (<400)`); }

    if (avgVision > 20) { multiplier += 0.06; add('Vision', 'Vision Score', +0.06, `${avgVision.toFixed(1)} (>20)`); }

    if (avgSoloKills != null) {
      if (avgSoloKills > 1.5) { multiplier += 0.08; add('Aggression', 'Solo Kills', +0.08, `${avgSoloKills.toFixed(1)}/Spiel (>1.5)`); }
      else if (avgSoloKills > 1.0) { multiplier += 0.04; add('Aggression', 'Solo Kills', +0.04, `${avgSoloKills.toFixed(1)}/Spiel (>1.0)`); }
    }
    if (avgDamageShare != null) {
      if (avgDamageShare > 0.30) { multiplier += 0.06; add('Kampf', 'Damage Share', +0.06, `${(avgDamageShare * 100).toFixed(1)}% (>30%)`); }
      else if (avgDamageShare > 0.25) { multiplier += 0.03; add('Kampf', 'Damage Share', +0.03, `${(avgDamageShare * 100).toFixed(1)}% (>25%)`); }
    }
    if (goldPerMin != null && goldPerMin > 430) { multiplier += 0.04; add('Economy', 'Gold/Min', +0.04, `${goldPerMin.toFixed(0)} (>430)`); }
    if (visionPerMin > 0.8) { multiplier += 0.03; add('Vision', 'Vision/Min', +0.03, `${visionPerMin.toFixed(2)} (>0.8)`); }

  } else {
    // ADC / Default
    if (csPerMin > 8.0) { multiplier += 0.10; add('Farming', 'CS/Min', +0.10, `${csPerMin.toFixed(1)} (>8.0)`); }
    else if (csPerMin > 7.0) { multiplier += 0.05; add('Farming', 'CS/Min', +0.05, `${csPerMin.toFixed(1)} (>7.0)`); }
    else if (csPerMin < 5.0) { multiplier -= 0.05; add('Farming', 'CS/Min', -0.05, `${csPerMin.toFixed(1)} (<5.0)`); }
    else if (csPerMin < 4.0) { multiplier -= 0.10; add('Farming', 'CS/Min', -0.10, `${csPerMin.toFixed(1)} (<4.0)`); }

    if (damagePerMin > 950) { multiplier += 0.175; add('Kampf', 'Schaden/Min', +0.175, `${damagePerMin.toFixed(0)} (>950)`); }
    else if (damagePerMin > 750) { multiplier += 0.10; add('Kampf', 'Schaden/Min', +0.10, `${damagePerMin.toFixed(0)} (>750)`); }
    else if (damagePerMin < 400) { multiplier -= 0.05; add('Kampf', 'Schaden/Min', -0.05, `${damagePerMin.toFixed(0)} (<400)`); }

    if (kda > 4.0) { multiplier += 0.175; add('Kampf', 'KDA', +0.175, `${kda.toFixed(2)} (>4.0)`); }
    else if (kda > 3.0) { multiplier += 0.10; add('Kampf', 'KDA', +0.10, `${kda.toFixed(2)} (>3.0)`); }
    else if (kda < 1.5) { multiplier -= 0.10; add('Kampf', 'KDA', -0.10, `${kda.toFixed(2)} (<1.5)`); }
    else if (kda < 1.0) { multiplier -= 0.175; add('Kampf', 'KDA', -0.175, `${kda.toFixed(2)} (<1.0)`); }

    if (avgDamageShare != null) {
      if (avgDamageShare > 0.32) { multiplier += 0.08; add('Kampf', 'Damage Share', +0.08, `${(avgDamageShare * 100).toFixed(1)}% (>32%)`); }
      else if (avgDamageShare > 0.28) { multiplier += 0.04; add('Kampf', 'Damage Share', +0.04, `${(avgDamageShare * 100).toFixed(1)}% (>28%)`); }
      else if (avgDamageShare < 0.20) { multiplier -= 0.05; add('Kampf', 'Damage Share', -0.05, `${(avgDamageShare * 100).toFixed(1)}% (<20%)`); }
    }

    if (avgDamageTaken != null && avgDamageTaken > 0) {
      const kitingRatio = avgDamage / avgDamageTaken;
      if (kitingRatio > 2.5) { multiplier += 0.06; add('Kampf', 'Kiting Effizienz', +0.06, `${kitingRatio.toFixed(2)} (>2.5)`); }
      else if (kitingRatio > 1.8) { multiplier += 0.03; add('Kampf', 'Kiting Effizienz', +0.03, `${kitingRatio.toFixed(2)} (>1.8)`); }
      else if (kitingRatio < 1.0) { multiplier -= 0.04; add('Kampf', 'Kiting Effizienz', -0.04, `${kitingRatio.toFixed(2)} (<1.0)`); }
    }

    if (multiKillScore != null) {
      if (multiKillScore > 10) { multiplier += 0.06; add('Aggression', 'Multi-Kills (ADC)', +0.06, `Score ${multiKillScore.toFixed(1)} (>10)`); }
      else if (multiKillScore > 6) { multiplier += 0.03; add('Aggression', 'Multi-Kills (ADC)', +0.03, `Score ${multiKillScore.toFixed(1)} (>6)`); }
    }

    if (goldPerMin != null && goldPerMin > 440) { multiplier += 0.04; add('Economy', 'Gold/Min', +0.04, `${goldPerMin.toFixed(0)} (>440)`); }
    if (avgGoldShare != null && avgGoldShare > 0.27) { multiplier += 0.04; add('Economy', 'Gold Share', +0.04, `${(avgGoldShare * 100).toFixed(1)}% (>27%)`); }
  }

  return { multiplier: Math.max(multiplier, 0.1), breakdown };
}

export function calculateMarketValue(
  ranked: RankedData | null,
  matches: MatchData[],
  playerRank?: number
): MarketValueResult {
  const emptyStats = { winrate: 0, kda: 0, csPerMin: 0, damagePerMin: 0, visionScore: 0, killParticipation: null, gamesAnalyzed: 0 };

  if (!ranked) {
    return { value: 0, formatted: 'Not Rated', role: 'UNKNOWN', rated: false, breakdown: [], baseValue: 0, multiplier: 1, stats: emptyStats };
  }

  const base = getBaseValue(ranked.tier, ranked.rank, ranked.leaguePoints, undefined, playerRank);

  if (base === 0) {
    return { value: 0, formatted: 'Not Rated', role: 'UNKNOWN', rated: false, breakdown: [], baseValue: 0, multiplier: 1, stats: emptyStats };
  }

  const role = detectPrimaryRole(matches);
  const { multiplier, breakdown } = calculateMultiplierWithBreakdown(matches, role);
  const finalValue = Math.round(base * multiplier);

  const formatted = finalValue >= 1000000
    ? '$' + (finalValue / 1000000).toFixed(2) + 'M'
    : finalValue >= 1000
    ? '$' + (finalValue / 1000).toFixed(1) + 'k'
    : '$' + finalValue;

  const totalKills = matches.reduce((s, m) => s + m.kills, 0);
  const totalDeaths = matches.reduce((s, m) => s + m.deaths, 0);
  const totalAssists = matches.reduce((s, m) => s + m.assists, 0);
  const avgDuration = matches.length > 0 ? matches.reduce((s, m) => s + m.gameDuration, 0) / matches.length / 60 : 1;

  const stats = {
    winrate: matches.length > 0 ? matches.filter(m => m.win).length / matches.length * 100 : 0,
    kda: (totalKills + totalAssists) / Math.max(totalDeaths, 1),
    csPerMin: matches.length > 0 ? matches.reduce((s, m) => s + m.cs, 0) / matches.length / avgDuration : 0,
    damagePerMin: matches.length > 0 ? matches.reduce((s, m) => s + m.damageDealt, 0) / matches.length / avgDuration : 0,
    visionScore: matches.length > 0 ? matches.reduce((s, m) => s + m.visionScore, 0) / matches.length : 0,
    killParticipation: avgOptional(matches, m =>
      m.teamKills != null && m.teamKills > 0 ? (m.kills + m.assists) / m.teamKills : undefined
    ),
    gamesAnalyzed: matches.length,
  };

  return { value: finalValue, formatted, role, rated: true, breakdown, baseValue: base, multiplier, stats };
}
