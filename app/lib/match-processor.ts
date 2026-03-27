/**
 * Shared match data processor — extracts all available fields from Match-V5 API response.
 * Used by both /api/summoner and /api/matches routes.
 */

export interface ExtendedMatchData {
  // === Identity ===
  matchId: string;
  champion: string;
  championId: number;
  champLevel: number;
  role: string;
  gameMode: string;
  queueId: number;
  gameCreation: number;
  gameDuration: number;
  win: boolean;
  surrendered: boolean;
  gameEndedInEarlySurrender: boolean;
  timePlayed: number;

  // === KDA ===
  kills: number;
  deaths: number;
  assists: number;
  doubleKills: number;
  tripleKills: number;
  quadraKills: number;
  pentaKills: number;
  killingSprees: number;
  largestKillingSpree: number;
  largestMultiKill: number;
  firstBloodKill: boolean;
  firstBloodAssist: boolean;
  firstBloodVictim: boolean;

  // === Damage Dealt ===
  damageDealt: number; // totalDamageDealtToChampions
  physicalDamageDealtToChampions: number;
  magicDamageDealtToChampions: number;
  trueDamageDealtToChampions: number;
  totalDamageDealt: number; // all targets
  damageDealtToBuildings: number;
  damageDealtToObjectives: number;
  damageDealtToTurrets: number;
  largestCriticalStrike: number;

  // === Damage Taken & Mitigated ===
  totalDamageTaken: number;
  physicalDamageTaken: number;
  magicDamageTaken: number;
  trueDamageTaken: number;
  damageSelfMitigated: number;

  // === Healing & Shielding ===
  totalHeal: number;
  totalHealsOnTeammates: number;
  totalDamageShieldedOnTeammates: number;
  totalUnitsHealed: number;

  // === Gold & Economy ===
  goldEarned: number;
  goldSpent: number;
  consumablesPurchased: number;
  itemsPurchased: number;

  // === Farming ===
  cs: number; // totalMinionsKilled + neutralMinionsKilled
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  totalAllyJungleMinionsKilled: number;
  totalEnemyJungleMinionsKilled: number;

  // === Vision ===
  visionScore: number;
  wardsPlaced: number;
  wardsKilled: number;
  detectorWardsPlaced: number;
  visionWardsBoughtInGame: number;

  // === Objectives ===
  dragonKills: number;
  baronKills: number;
  turretKills: number;
  turretTakedowns: number;
  inhibitorKills: number;
  inhibitorTakedowns: number;
  objectivesStolen: number;
  objectivesStolenAssists: number;

  // === CC & Time ===
  timeCCingOthers: number;
  totalTimeCCDealt: number;
  longestTimeSpentLiving: number;
  totalTimeSpentDead: number;

  // === Spell Casts ===
  spell1Casts: number;
  spell2Casts: number;
  spell3Casts: number;
  spell4Casts: number;
  summoner1Casts: number;
  summoner2Casts: number;

  // === Items ===
  items: number[];

  // === Team Context ===
  teamKills: number;
  teamDamage: number;
  teamGold: number;

  // === Challenges (advanced metrics) ===
  challenges: {
    // Laning
    laneMinionsFirst10Minutes: number;
    maxCsAdvantageOnLaneOpponent: number;
    maxLevelLeadLaneOpponent: number;
    turretPlatesTaken: number;
    earlyLaningPhaseGoldExpAdvantage: number;
    laningPhaseGoldExpAdvantage: number;
    jungleCsBefore10Minutes: number;
    scuttleCrabKills: number;
    buffsStolen: number;

    // Combat Advanced
    soloKills: number;
    soloBaronKills: number;
    multikills: number;
    multikillsAfterAggressiveFlash: number;
    outnumberedKills: number;
    outnumberedNexusKill: number;
    killsNearEnemyTurret: number;
    killsUnderOwnTurret: number;
    killsOnOtherLanesEarlyJungleAsLaner: number;
    killsOnLanersEarlyJungleAsJungler: number;
    takedowns: number;
    takedownsFirst25Minutes: number;
    takedownsInAlcove: number;
    pickKillWithAlly: number;
    knockEnemyIntoTeamAndKill: number;
    immobilizeAndKillWithAlly: number;
    landSkillShotsEarlyGame: number;
    skillshotsDodged: number;
    dodgeSkillShotsSmallWindow: number;
    survivedSingleDigitHpCount: number;
    survivedThreeImmobilizesInFight: number;

    // Damage Metrics
    damagePerMinute: number;
    damageTakenOnTeamPercentage: number;
    teamDamagePercentage: number;
    effectiveHealAndShielding: number;
    maxKillDeficit: number;

    // Gold & Economy
    goldPerMinute: number;
    bountyGold: number;
    perfectDragonSoulsTaken: number;
    perfectGame: number;

    // Vision Advanced
    controlWardsPlaced: number;
    wardTakedowns: number;
    wardTakedownsBefore20M: number;
    stealthWardsPlaced: number;
    visionScorePerMinute: number;
    visionScoreAdvantageLaneOpponent: number;

    // Objectives Advanced
    riftHeraldTakedowns: number;
    dragonTakedowns: number;
    baronTakedowns: number;
    epicMonsterKillsNearEnemyJungler: number;
    epicMonsterKillsWithin30SecondsOfSpawn: number;
    epicMonsterSteals: number;
    epicMonsterStolenWithoutSmite: number;
    firstTurretKilled: number;
    firstTurretKilledTime: number;
    voidMonsterKill: number;
    elderDragonKillsWithOpposingSoul: number;
    elderDragonMultikills: number;
    turretsTakenWithRiftHerald: number;
    kTurretsDestroyedBeforePlatesFall: number;

    // Teamfight
    saveAllyFromDeath: number;
    assistStreakCount: number;
    fullTeamTakedown: number;
    killAfterHiddenWithAlly: number;
    flawlessAces: number;
    acesBefore15Minutes: number;

    // Streaks & Special
    legendaryCount: number;
    abilityUses: number;
    gameLength: number;
    hadAfkTeammate: boolean;

    // Pings
    allInPings: number;
    assistMePings: number;
    dangerPings: number;
    enemyMissingPings: number;
    onMyWayPings: number;
    getBackPings: number;
    needVisionPings: number;
    commandPings: number;
    holdPings: number;
    pushPings: number;
    enemyVisionPings: number;
    visionClearedPings: number;
    baitPings: number;
    retreatPings: number;
    basicPings: number;
  };
}

/** Safely read a numeric challenge field, defaulting to 0 */
function ch(participant: any, field: string): number {
  return participant?.challenges?.[field] ?? 0;
}

/** Safely read a boolean challenge field, defaulting to false */
function chBool(participant: any, field: string): boolean {
  return participant?.challenges?.[field] ?? false;
}

/**
 * Process a single raw match from the Riot API into our ExtendedMatchData format.
 */
export function processMatch(rawMatch: any, puuid: string): ExtendedMatchData | null {
  if (!rawMatch?.info?.participants) return null;

  const p = rawMatch.info.participants.find((x: any) => x.puuid === puuid);
  if (!p) return null;

  const teamId = p.teamId;
  const teammates = rawMatch.info.participants.filter((x: any) => x.teamId === teamId);
  const teamKills = teammates.reduce((s: number, x: any) => s + (x.kills || 0), 0);
  const teamDamage = teammates.reduce((s: number, x: any) => s + (x.totalDamageDealtToChampions || 0), 0);
  const teamGold = teammates.reduce((s: number, x: any) => s + (x.goldEarned || 0), 0);

  return {
    // Identity
    matchId: rawMatch.metadata.matchId,
    champion: p.championName || '',
    championId: p.championId || 0,
    champLevel: p.champLevel || 0,
    role: p.individualPosition || p.teamPosition || 'UNKNOWN',
    gameMode: rawMatch.info.gameMode || '',
    queueId: rawMatch.info.queueId || 0,
    gameCreation: rawMatch.info.gameCreation || rawMatch.info.gameStartTimestamp || 0,
    gameDuration: rawMatch.info.gameDuration || 0,
    win: p.win || false,
    surrendered: p.gameEndedInSurrender || false,
    gameEndedInEarlySurrender: p.gameEndedInEarlySurrender || false,
    timePlayed: p.timePlayed || rawMatch.info.gameDuration || 0,

    // KDA
    kills: p.kills || 0,
    deaths: p.deaths || 0,
    assists: p.assists || 0,
    doubleKills: p.doubleKills || 0,
    tripleKills: p.tripleKills || 0,
    quadraKills: p.quadraKills || 0,
    pentaKills: p.pentaKills || 0,
    killingSprees: p.killingSprees || 0,
    largestKillingSpree: p.largestKillingSpree || 0,
    largestMultiKill: p.largestMultiKill || 0,
    firstBloodKill: p.firstBloodKill || false,
    firstBloodAssist: p.firstBloodAssist || false,
    firstBloodVictim: p.firstBloodVictim || false,

    // Damage Dealt
    damageDealt: p.totalDamageDealtToChampions || 0,
    physicalDamageDealtToChampions: p.physicalDamageDealtToChampions || 0,
    magicDamageDealtToChampions: p.magicDamageDealtToChampions || 0,
    trueDamageDealtToChampions: p.trueDamageDealtToChampions || 0,
    totalDamageDealt: p.totalDamageDealt || 0,
    damageDealtToBuildings: p.damageDealtToBuildings || 0,
    damageDealtToObjectives: p.damageDealtToObjectives || 0,
    damageDealtToTurrets: p.damageDealtToTurrets || 0,
    largestCriticalStrike: p.largestCriticalStrike || 0,

    // Damage Taken & Mitigated
    totalDamageTaken: p.totalDamageTaken || 0,
    physicalDamageTaken: p.physicalDamageTaken || 0,
    magicDamageTaken: p.magicDamageTaken || 0,
    trueDamageTaken: p.trueDamageTaken || 0,
    damageSelfMitigated: p.damageSelfMitigated || 0,

    // Healing & Shielding
    totalHeal: p.totalHeal || 0,
    totalHealsOnTeammates: p.totalHealsOnTeammates || 0,
    totalDamageShieldedOnTeammates: p.totalDamageShieldedOnTeammates || 0,
    totalUnitsHealed: p.totalUnitsHealed || 0,

    // Gold & Economy
    goldEarned: p.goldEarned || 0,
    goldSpent: p.goldSpent || 0,
    consumablesPurchased: p.consumablesPurchased || 0,
    itemsPurchased: p.itemsPurchased || 0,

    // Farming
    cs: (p.totalMinionsKilled || 0) + (p.neutralMinionsKilled || 0),
    totalMinionsKilled: p.totalMinionsKilled || 0,
    neutralMinionsKilled: p.neutralMinionsKilled || 0,
    totalAllyJungleMinionsKilled: p.totalAllyJungleMinionsKilled || 0,
    totalEnemyJungleMinionsKilled: p.totalEnemyJungleMinionsKilled || 0,

    // Vision
    visionScore: p.visionScore || 0,
    wardsPlaced: p.wardsPlaced || 0,
    wardsKilled: p.wardsKilled || 0,
    detectorWardsPlaced: p.detectorWardsPlaced || 0,
    visionWardsBoughtInGame: p.visionWardsBoughtInGame || 0,

    // Objectives
    dragonKills: p.dragonKills || 0,
    baronKills: p.baronKills || 0,
    turretKills: p.turretKills || 0,
    turretTakedowns: p.turretTakedowns || 0,
    inhibitorKills: p.inhibitorKills || 0,
    inhibitorTakedowns: p.inhibitorTakedowns || 0,
    objectivesStolen: p.objectivesStolen || 0,
    objectivesStolenAssists: p.objectivesStolenAssists || 0,

    // CC & Time
    timeCCingOthers: p.timeCCingOthers || 0,
    totalTimeCCDealt: p.totalTimeCCDealt || 0,
    longestTimeSpentLiving: p.longestTimeSpentLiving || 0,
    totalTimeSpentDead: p.totalTimeSpentDead || 0,

    // Spell Casts
    spell1Casts: p.spell1Casts || 0,
    spell2Casts: p.spell2Casts || 0,
    spell3Casts: p.spell3Casts || 0,
    spell4Casts: p.spell4Casts || 0,
    summoner1Casts: p.summoner1Casts || 0,
    summoner2Casts: p.summoner2Casts || 0,

    // Items
    items: [p.item0 || 0, p.item1 || 0, p.item2 || 0, p.item3 || 0, p.item4 || 0, p.item5 || 0, p.item6 || 0],

    // Team Context
    teamKills,
    teamDamage,
    teamGold,

    // Challenges
    challenges: {
      // Laning
      laneMinionsFirst10Minutes: ch(p, 'laneMinionsFirst10Minutes'),
      maxCsAdvantageOnLaneOpponent: ch(p, 'maxCsAdvantageOnLaneOpponent'),
      maxLevelLeadLaneOpponent: ch(p, 'maxLevelLeadLaneOpponent'),
      turretPlatesTaken: ch(p, 'turretPlatesTaken'),
      earlyLaningPhaseGoldExpAdvantage: ch(p, 'earlyLaningPhaseGoldExpAdvantage'),
      laningPhaseGoldExpAdvantage: ch(p, 'laningPhaseGoldExpAdvantage'),
      jungleCsBefore10Minutes: ch(p, 'jungleCsBefore10Minutes'),
      scuttleCrabKills: ch(p, 'scuttleCrabKills'),
      buffsStolen: ch(p, 'buffsStolen'),

      // Combat Advanced
      soloKills: ch(p, 'soloKills'),
      soloBaronKills: ch(p, 'soloBaronKills'),
      multikills: ch(p, 'multikills'),
      multikillsAfterAggressiveFlash: ch(p, 'multikillsAfterAggressiveFlash'),
      outnumberedKills: ch(p, 'outnumberedKills'),
      outnumberedNexusKill: ch(p, 'outnumberedNexusKill'),
      killsNearEnemyTurret: ch(p, 'killsNearEnemyTurret'),
      killsUnderOwnTurret: ch(p, 'killsUnderOwnTurret'),
      killsOnOtherLanesEarlyJungleAsLaner: ch(p, 'killsOnOtherLanesEarlyJungleAsLaner'),
      killsOnLanersEarlyJungleAsJungler: ch(p, 'killsOnLanersEarlyJungleAsJungler'),
      takedowns: ch(p, 'takedowns'),
      takedownsFirst25Minutes: ch(p, 'takedownsFirst25Minutes'),
      takedownsInAlcove: ch(p, 'takedownsInAlcove'),
      pickKillWithAlly: ch(p, 'pickKillWithAlly'),
      knockEnemyIntoTeamAndKill: ch(p, 'knockEnemyIntoTeamAndKill'),
      immobilizeAndKillWithAlly: ch(p, 'immobilizeAndKillWithAlly'),
      landSkillShotsEarlyGame: ch(p, 'landSkillShotsEarlyGame'),
      skillshotsDodged: ch(p, 'skillshotsDodged'),
      dodgeSkillShotsSmallWindow: ch(p, 'dodgeSkillShotsSmallWindow'),
      survivedSingleDigitHpCount: ch(p, 'survivedSingleDigitHpCount'),
      survivedThreeImmobilizesInFight: ch(p, 'survivedThreeImmobilizesInFight'),

      // Damage Metrics
      damagePerMinute: ch(p, 'damagePerMinute'),
      damageTakenOnTeamPercentage: ch(p, 'damageTakenOnTeamPercentage'),
      teamDamagePercentage: ch(p, 'teamDamagePercentage'),
      effectiveHealAndShielding: ch(p, 'effectiveHealAndShielding'),
      maxKillDeficit: ch(p, 'maxKillDeficit'),

      // Gold & Economy
      goldPerMinute: ch(p, 'goldPerMinute'),
      bountyGold: ch(p, 'bountyGold'),
      perfectDragonSoulsTaken: ch(p, 'perfectDragonSoulsTaken'),
      perfectGame: ch(p, 'perfectGame'),

      // Vision Advanced
      controlWardsPlaced: ch(p, 'controlWardsPlaced'),
      wardTakedowns: ch(p, 'wardTakedowns'),
      wardTakedownsBefore20M: ch(p, 'wardTakedownsBefore20M'),
      stealthWardsPlaced: ch(p, 'stealthWardsPlaced'),
      visionScorePerMinute: ch(p, 'visionScorePerMinute'),
      visionScoreAdvantageLaneOpponent: ch(p, 'visionScoreAdvantageLaneOpponent'),

      // Objectives Advanced
      riftHeraldTakedowns: ch(p, 'riftHeraldTakedowns'),
      dragonTakedowns: ch(p, 'dragonTakedowns'),
      baronTakedowns: ch(p, 'baronTakedowns'),
      epicMonsterKillsNearEnemyJungler: ch(p, 'epicMonsterKillsNearEnemyJungler'),
      epicMonsterKillsWithin30SecondsOfSpawn: ch(p, 'epicMonsterKillsWithin30SecondsOfSpawn'),
      epicMonsterSteals: ch(p, 'epicMonsterSteals'),
      epicMonsterStolenWithoutSmite: ch(p, 'epicMonsterStolenWithoutSmite'),
      firstTurretKilled: ch(p, 'firstTurretKilled'),
      firstTurretKilledTime: ch(p, 'firstTurretKilledTime'),
      voidMonsterKill: ch(p, 'voidMonsterKill'),
      elderDragonKillsWithOpposingSoul: ch(p, 'elderDragonKillsWithOpposingSoul'),
      elderDragonMultikills: ch(p, 'elderDragonMultikills'),
      turretsTakenWithRiftHerald: ch(p, 'turretsTakenWithRiftHerald'),
      kTurretsDestroyedBeforePlatesFall: ch(p, 'kTurretsDestroyedBeforePlatesFall'),

      // Teamfight
      saveAllyFromDeath: ch(p, 'saveAllyFromDeath'),
      assistStreakCount: ch(p, 'assistStreakCount'),
      fullTeamTakedown: ch(p, 'fullTeamTakedown'),
      killAfterHiddenWithAlly: ch(p, 'killAfterHiddenWithAlly'),
      flawlessAces: ch(p, 'flawlessAces'),
      acesBefore15Minutes: ch(p, 'acesBefore15Minutes'),

      // Streaks & Special
      legendaryCount: ch(p, 'legendaryCount'),
      abilityUses: ch(p, 'abilityUses'),
      gameLength: ch(p, 'gameLength'),
      hadAfkTeammate: chBool(p, 'hadAfkTeammate'),

      // Pings
      allInPings: ch(p, 'allInPings'),
      assistMePings: ch(p, 'assistMePings'),
      dangerPings: ch(p, 'dangerPings'),
      enemyMissingPings: ch(p, 'enemyMissingPings'),
      onMyWayPings: ch(p, 'onMyWayPings'),
      getBackPings: ch(p, 'getBackPings'),
      needVisionPings: ch(p, 'needVisionPings'),
      commandPings: ch(p, 'commandPings'),
      holdPings: ch(p, 'holdPings'),
      pushPings: ch(p, 'pushPings'),
      enemyVisionPings: ch(p, 'enemyVisionPings'),
      visionClearedPings: ch(p, 'visionClearedPings'),
      baitPings: ch(p, 'baitPings'),
      retreatPings: ch(p, 'retreatPings'),
      basicPings: ch(p, 'basicPings'),
    },
  };
}

/**
 * Convert ExtendedMatchData to the legacy format expected by the current marketvalue.ts.
 * This allows a gradual migration — routes can use ExtendedMatchData while marketvalue.ts
 * still works with its existing interface until it's updated.
 */
export function toLegacyMatchData(m: ExtendedMatchData) {
  return {
    matchId: m.matchId,
    champion: m.champion,
    kills: m.kills,
    deaths: m.deaths,
    assists: m.assists,
    win: m.win,
    gameDuration: m.gameDuration,
    gameMode: m.gameMode,
    queueId: m.queueId,
    gameCreation: m.gameCreation,
    cs: m.cs,
    role: m.role,
    damageDealt: m.damageDealt,
    visionScore: m.visionScore,
    wardsPlaced: m.wardsPlaced,
    firstBloodKill: m.firstBloodKill,
    firstBloodAssist: m.firstBloodAssist,
    firstBloodVictim: m.firstBloodVictim,
    dragonKills: m.dragonKills,
    baronKills: m.baronKills,
    turretKills: m.turretKills,
    objectivesStolen: m.objectivesStolen,
    gameWonFromBehind: false, // wasLosing not available in challenges; keep at false for now
    surrendered: m.surrendered,
    teamKills: m.teamKills,
    soloKills: m.challenges.soloKills,
    totalDamageTaken: m.totalDamageTaken,
    teamDamage: m.teamDamage,
    doubleKills: m.doubleKills,
    tripleKills: m.tripleKills,
    quadraKills: m.quadraKills,
    pentaKills: m.pentaKills,
    goldEarned: m.goldEarned,
    teamGold: m.teamGold,
    controlWardsPlaced: m.challenges.controlWardsPlaced,
    wardsKilled: m.wardsKilled,
    riftHeraldKills: m.challenges.riftHeraldTakedowns,
    inhibitorKills: m.inhibitorKills,
    totalHealsOnTeammates: m.totalHealsOnTeammates,
    totalDamageShieldedOnTeammates: m.totalDamageShieldedOnTeammates,
    timeCCingOthers: m.timeCCingOthers,
  };
}
