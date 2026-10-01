import type { TranslationKey } from './i18n';

// Die Marktwert-Aufschluesselung (marketvalue.ts) und die Coach-Kategorien
// (stats-categories.ts) liefern ihre Texte deutsch. Uebersetzt wird erst beim
// Anzeigen: deutscher Text -> Schluessel, unbekannter Text bleibt wie er ist.
// Neue Texte dort brauchen hier einen Eintrag — lol-stat-labels.test.mjs prueft das.

type Translate = (key: TranslationKey) => string;

export const MV_CATEGORY_KEYS: Record<string, TranslationKey> = {
  'Allgemein': 'mvCat.general',
  'Aggression': 'mvCat.aggression',
  'Teamplay': 'mvCat.teamplay',
  'Lane': 'mvCat.lane',
  'Mechanik': 'mvCat.mechanics',
  'Frühspiel': 'mvCat.earlyGame',
  'Objectives': 'mvCat.objectives',
  'Überleben': 'mvCat.survival',
  'Mental': 'mvCat.mentality',
  'Support': 'mvCat.support',
  'Vision': 'mvCat.vision',
  'Kampf': 'mvCat.combat',
  'Economy': 'mvCat.economy',
  'Farming': 'mvCat.farming',
};

/** Labels der Aufschluesselung und Detailnamen der Coach-Kategorien. */
export const LOL_STAT_LABEL_KEYS: Record<string, TranslationKey> = {
  'Assists/Spiel': 'lolStat.assistsGame',
  'Barons/Spiel': 'lolStat.baronsGame',
  'CC Score': 'lolStat.cCScore',
  'Clutch-Überlebend': 'lolStat.clutchSurvival',
  'Comeback-Mentalität': 'lolStat.comebackMentality',
  'Comeback-Rate': 'lolStat.comebackRate',
  'CS/Min': 'lolStat.cSMin',
  'CS-Vorteil': 'lolStat.cSAdvantage',
  'Damage Share': 'lolStat.damageShare',
  'Dragon+Baron': 'lolStat.dragonPlusBaron',
  'Dragons/Spiel': 'lolStat.dragonsGame',
  'First Blood': 'lolStat.firstBlood',
  'First Blood (JGL)': 'lolStat.firstBloodJGL',
  'First Blood Opfer': 'lolStat.firstBloodVictim',
  'Gold Share': 'lolStat.goldShare',
  'Gold/Min': 'lolStat.goldMin',
  'Heal/Shield pro Min': 'lolStat.healShieldPerMin',
  'KDA': 'lolStat.kDA',
  'Kill Participation': 'lolStat.killParticipation',
  'Kiting Effizienz': 'lolStat.kitingEfficiency',
  'Lane-Dominanz': 'lolStat.laneDominance',
  'Lane-Schwäche': 'lolStat.laneWeakness',
  'Legendary-Status': 'lolStat.legendaryStatus',
  'Multi-Kills': 'lolStat.multiKills',
  'Multi-Kills (ADC)': 'lolStat.multiKillsADC',
  'Obj. Combo': 'lolStat.objCombo',
  'Obj. Score': 'lolStat.objScore',
  'Obj. Steals': 'lolStat.objSteals',
  'Obj.-Schaden': 'lolStat.objDamage',
  'Outplay-Kills': 'lolStat.outplayKills',
  'Rift Herald': 'lolStat.riftHerald',
  'Rollen-Flexibilität': 'lolStat.roleFlexibility',
  'Schaden genommen/Min': 'lolStat.damageTakenMin',
  'Schaden/Min': 'lolStat.damageMin',
  'Skillshot-Dodge': 'lolStat.skillshotDodge',
  'Solo Kills': 'lolStat.soloKills',
  'Surrender-Rate': 'lolStat.surrenderRate',
  'Takedowns @25': 'lolStat.takedownsAt25',
  'Tank-Schaden/Min': 'lolStat.tankDamageMin',
  'Totzeit': 'lolStat.timeDead',
  'Türme/Spiel': 'lolStat.towersGame',
  'Turm-Schaden': 'lolStat.towerDamage',
  'Turret Plates': 'lolStat.turretPlates',
  'Vision Dominanz': 'lolStat.visionDominance',
  'Vision Score': 'lolStat.visionScore',
  'Vision/Min': 'lolStat.visionMin',
  'Wards/Spiel': 'lolStat.wardsGame',
  'Winrate': 'lolStat.winrate',
  'Aktuelle Winrate': 'lolStat.currentWinrate',
  'Assist-Streak': 'lolStat.assistStreak',
  'Ausgabenquote': 'lolStat.spendingRate',
  'Baron-Beteiligung': 'lolStat.baronParticipation',
  'Bounty-Gold': 'lolStat.bountyGold',
  'CC + Kill': 'lolStat.cCPlusKill',
  'CC-Überlebt': 'lolStat.cCSurvived',
  'Comeback-Siege': 'lolStat.comebackWins',
  'Control Wards': 'lolStat.controlWards',
  'CS in 10 Min': 'lolStat.cSAt10Min',
  'CS/Spiel': 'lolStat.cSGame',
  'CS-Variationskoeffizient': 'lolStat.cSVariation',
  'Deaths/Spiel': 'lolStat.deathsGame',
  'Defensive Kills': 'lolStat.defensiveKills',
  'DPM-Trend': 'lolStat.dPMTrend',
  'Drachen-Beteiligung': 'lolStat.dragonParticipation',
  'Effektive H/S': 'lolStat.effectiveHS',
  'First Blood Rate': 'lolStat.firstBloodRate',
  'First Turret': 'lolStat.firstTurret',
  'Flash-Multikills': 'lolStat.flashMultikills',
  'Frühere Winrate': 'lolStat.previousWinrate',
  'Gank-Kills': 'lolStat.gankKills',
  'Gold/Spiel': 'lolStat.goldGame',
  'Gold/XP-Vorteil (früh)': 'lolStat.goldXPLeadEarly',
  'Gold-Anteil': 'lolStat.goldShare2',
  'Größte Killserie': 'lolStat.largestKillingSpree',
  'Heal auf Teammates': 'lolStat.healingOnTeammates',
  'Jungle CS': 'lolStat.jungleCS',
  'KDA-Trend': 'lolStat.kDATrend',
  'KDA-Variationskoeffizient': 'lolStat.kDAVariation',
  'Kill-Beteiligung': 'lolStat.killParticipation2',
  'Kills/Spiel': 'lolStat.killsGame',
  'Knapp überlebt': 'lolStat.barelySurvived',
  'Knappe Dodges': 'lolStat.closeDodges',
  'Längste Lebensspanne': 'lolStat.longestTimeAlive',
  'Legendary': 'lolStat.legendary',
  'Level-Vorsprung': 'lolStat.levelLead',
  'Magisch': 'lolStat.magic',
  'Max CS-Vorteil': 'lolStat.maxCSLead',
  'Max Kill-Rückstand': 'lolStat.maxKillDeficit',
  'Multikills': 'lolStat.multikills',
  'Niederlagen': 'lolStat.losses',
  'Ø CS/Min': 'lolStat.avgCSMin',
  'Ø KDA': 'lolStat.avgKDA',
  'Objective DMG': 'lolStat.objectiveDMG',
  'Objective Steals': 'lolStat.objectiveSteals',
  'Physisch': 'lolStat.physical',
  'Pick-Kills': 'lolStat.pickKills',
  'Rettungen': 'lolStat.saves',
  'Roam-Kills': 'lolStat.roamKills',
  'Schaden absorbiert/Min': 'lolStat.damageMitigatedMin',
  'Schaden/Spiel': 'lolStat.damageGame',
  'Schadensanteil': 'lolStat.damageShare2',
  'Schadensaufnahme': 'lolStat.damageTaken',
  'Shields auf Teammates': 'lolStat.shieldsOnTeammates',
  'Siege': 'lolStat.wins',
  'Skillshots (early)': 'lolStat.skillshotsEarly',
  'Skillshots ausgewichen': 'lolStat.skillshotsDodged',
  'Solo-Kills': 'lolStat.soloKills2',
  'Takedowns @25min': 'lolStat.takedownsAt25min',
  'Totzeit-Anteil': 'lolStat.timeDeadShare',
  'Turm-Dives': 'lolStat.towerDives',
  'Türme': 'lolStat.towers',
  'Vision Score/Min': 'lolStat.visionScoreMin',
  'Voidgrubs': 'lolStat.voidgrubs',
  'Wahrer Schaden': 'lolStat.trueDamage',
  'Wards gesetzt': 'lolStat.wardsPlaced',
  'Wards vor 20 Min': 'lolStat.wardsBefore20Min',
  'Wards zerstört': 'lolStat.wardsDestroyed',
  'Winrate-Trend': 'lolStat.winrateTrend',
};

/** Deutsche Woerter in Stat-Texten und Einheiten, in Ersetz-Reihenfolge (laengere zuerst). */
export const MV_STAT_FRAGMENTS: ReadonlyArray<readonly [string, TranslationKey]> = [
  [' Siege nach 5+ Kill-Rückstand', 'mvStat.winsAfterDeficit'],
  [' Gold/XP-Rückstand', 'mvStat.goldXpDeficit'],
  [' Gold/XP-Vorteil', 'mvStat.goldXpLead'],
  [' CS Vorsprung', 'mvStat.csLead'],
  [' (Unterzahl)', 'mvStat.outnumbered'],
  ['x knapp überlebt', 'mvStat.barelySurvived'],
  [' der Spiele', 'mvStat.ofGames'],
  [' tot (', 'mvStat.deadShare'],
  [' Rollen', 'mvStat.roles'],
  ['/Spiel', 'mvStat.perGame'],
];

export function translateMvCategory(t: Translate, text: string): string {
  const key = MV_CATEGORY_KEYS[text];
  return key ? t(key) : text;
}

export function translateStatLabel(t: Translate, text: string): string {
  const key = LOL_STAT_LABEL_KEYS[text];
  return key ? t(key) : text;
}

export function translateStatText(t: Translate, text: string): string {
  let out = text;
  for (const [de, key] of MV_STAT_FRAGMENTS) {
    if (out.includes(de)) out = out.split(de).join(t(key));
  }
  return out;
}
