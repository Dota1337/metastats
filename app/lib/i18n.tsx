'use client';
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type Lang = 'de' | 'en';

const translations = {
  // Nav
  'nav.search': { de: 'Spielersuche', en: 'Player Search' },
  'nav.leaderboard': { de: 'Rangliste', en: 'Leaderboard' },
  'nav.champions': { de: 'Champions', en: 'Champions' },
  'nav.marketvalue': { de: 'Marktwerte', en: 'Market Values' },

  // Homepage
  'home.subtitle': { de: 'Die führende E-Sport Analyseplattform', en: 'The Leading E-Sports Analytics Platform' },
  'home.title1': { de: 'League of Legends', en: 'League of Legends' },
  'home.title2': { de: 'Statistiken & Marktwerte', en: 'Statistics & Market Values' },
  'home.desc': { de: 'Echtzeit-Stats, Match History & KI-gestützte Marktwertberechnung für alle Spieler', en: 'Real-time stats, match history & AI-powered market value calculation for all players' },
  'home.searchTab': { de: 'Spielersuche', en: 'Player Search' },
  'home.marketTab': { de: 'Marktwerte', en: 'Market Values' },
  'home.searchPlaceholder': { de: 'Summoner-Name suchen... (z.B. Name#EUW)', en: 'Search summoner name... (e.g. Name#EUW)' },
  'home.searchBtn': { de: 'Suchen', en: 'Search' },
  'home.savedPlayers': { de: 'Gespeicherte Spieler', en: 'Saved Players' },
  'home.analyzedMatches': { de: 'Analysierte Matches', en: 'Analyzed Matches' },
  'home.avgMarketValue': { de: 'Ø KI-Marktwert', en: 'Avg AI Market Value' },
  'home.activeRegions': { de: 'Aktive Regionen', en: 'Active Regions' },
  'home.thisWeek': { de: 'diese Woche', en: 'this week' },
  'home.last30days': { de: 'letzte 30 Tage', en: 'last 30 days' },
  'home.topFrom': { de: 'Top 1% ab $42.000', en: 'Top 1% from $42,000' },
  'home.recentSearches': { de: 'Zuletzt gesucht', en: 'Recently Searched' },
  'home.noSearches': { de: 'Noch keine Suchen', en: 'No searches yet' },
  'home.features': { de: 'Features', en: 'Features' },
  'home.feat1title': { de: 'KI-Marktwert', en: 'AI Market Value' },
  'home.feat1desc': { de: 'Rollenbasierte Bewertung ab Diamond 4', en: 'Role-based valuation from Diamond 4' },
  'home.feat2title': { de: 'Match History', en: 'Match History' },
  'home.feat2desc': { de: 'Letzte 30 Spiele mit allen Stats', en: 'Last 30 games with all stats' },
  'home.feat3title': { de: 'Rangliste', en: 'Leaderboard' },
  'home.feat3desc': { de: 'Top Challenger Spieler EUW', en: 'Top Challenger players EUW' },
  'home.feat4title': { de: 'Multi-Region', en: 'Multi-Region' },
  'home.feat4desc': { de: 'EUW, EUNE, NA, KR', en: 'EUW, EUNE, NA, KR' },
  'home.topMarketValues': { de: 'Top Marktwerte', en: 'Top Market Values' },
  'home.noMarketData': { de: 'Noch keine Daten — Marktwerte werden gesammelt während Spieler gesucht werden', en: 'No data yet — market values are collected as players are searched' },
  'home.winnersWeek': { de: 'Größte Gewinner', en: 'Biggest Gainers' },
  'home.losersWeek': { de: 'Größte Verlierer', en: 'Biggest Losers' },
  'home.thisWeekLabel': { de: 'diese Woche', en: 'this week' },
  'home.noData': { de: 'Noch keine Daten', en: 'No data yet' },
  'home.howCalc': { de: 'Wie wird berechnet?', en: 'How is it calculated?' },
  'home.rank': { de: 'Rang', en: 'Rank' },
  'home.baseFromDia': { de: 'Basis ab Diamond 4', en: 'Base from Diamond 4' },
  'home.winrate': { de: 'Winrate', en: 'Win Rate' },
  'home.last30': { de: 'Letzte 30 Spiele', en: 'Last 30 games' },
  'home.roleSpecific': { de: 'Rollenspezifisch', en: 'Role-specific' },
  'home.objectives': { de: 'Drake, Baron, Türme', en: 'Drake, Baron, Turrets' },
  'home.vision': { de: 'Wards & Vision Score', en: 'Wards & Vision Score' },

  // Player Page
  'player.loading': { de: 'Lade Spielerprofil...', en: 'Loading player profile...' },
  'player.level': { de: 'Level', en: 'Level' },
  'player.aiMarketValue': { de: 'KI-Marktwert', en: 'AI Market Value' },
  'player.rank': { de: 'Rang', en: 'Rank' },
  'player.unranked': { de: 'Unranked', en: 'Unranked' },
  'player.winrate30': { de: 'Winrate (30 Spiele)', en: 'Win Rate (30 Games)' },
  'player.avgKDA': { de: 'Ø KDA', en: 'Avg KDA' },
  'player.mainRole': { de: 'Hauptrolle', en: 'Main Role' },
  'player.marketBreakdown': { de: 'Marktwert-Aufschlüsselung', en: 'Market Value Breakdown' },
  'player.baseValue': { de: 'Basiswert', en: 'Base Value' },
  'player.multiplier': { de: 'Multiplikator', en: 'Multiplier' },
  'player.finalValue': { de: 'Endwert', en: 'Final Value' },
  'player.games': { de: 'Spiele', en: 'Games' },
  'player.matchHistory': { de: 'Match History', en: 'Match History' },
  'player.lastGames': { de: 'letzte', en: 'last' },
  'player.gamesLabel': { de: 'Spiele', en: 'games' },
  'player.win': { de: 'Sieg', en: 'Win' },
  'player.loss': { de: 'Niederlage', en: 'Loss' },
  'player.enterName': { de: 'Gib einen Summoner-Namen ein um zu starten', en: 'Enter a summoner name to get started' },

  // Leaderboard
  'lb.title': { de: 'Rangliste', en: 'Leaderboard' },
  'lb.subtitle': { de: 'Alle Spieler nach Rang und Marktwert', en: 'All players by rank and market value' },
  'lb.searchPlaceholder': { de: 'Spieler suchen... (z.B. Caps, Agurin, Hide on Bush)', en: 'Search player... (e.g. Caps, Agurin, Hide on Bush)' },
  'lb.searchResult': { de: 'Suchergebnis für', en: 'Search result for' },
  'lb.playersFound': { de: 'Spieler gefunden', en: 'players found' },
  'lb.clearSearch': { de: 'Suche leeren', en: 'Clear search' },
  'lb.loading': { de: 'Lade Rangliste...', en: 'Loading leaderboard...' },
  'lb.noPlayers': { de: 'Keine Spieler gefunden', en: 'No players found' },
  'lb.player': { de: 'Spieler', en: 'Player' },
  'lb.region': { de: 'Region', en: 'Region' },
  'lb.marketValue': { de: 'Marktwert', en: 'Market Value' },
  'lb.allRegions': { de: 'Alle', en: 'All' },

  // Champions
  'champ.title': { de: 'Champion-Statistiken', en: 'Champion Statistics' },
  'champ.subtitle': { de: 'Winrate, Pickrate & Banrate aller Champions nach Rang', en: 'Win rate, pick rate & ban rate of all champions by rank' },
  'champ.rank': { de: 'Rang', en: 'Rank' },
  'champ.role': { de: 'Rolle', en: 'Role' },
  'champ.search': { de: 'Suche', en: 'Search' },
  'champ.searchPlaceholder': { de: 'Champion suchen...', en: 'Search champion...' },
  'champ.allRanks': { de: 'Alle Ränge', en: 'All Ranks' },
  'champ.allRoles': { de: 'Alle Rollen', en: 'All Roles' },
  'champ.statsCollecting': { de: 'Statistiken werden gesammelt, wenn Spieler gesucht werden. Suche Spieler um Daten aufzubauen.', en: 'Statistics are collected when players are searched. Search players to build data.' },
  'champ.withData': { de: 'Mit Daten', en: 'With Data' },
  'champ.champion': { de: 'Champion', en: 'Champion' },
  'champ.games': { de: 'Spiele', en: 'Games' },
  'champ.noChampions': { de: 'Keine Champions gefunden', en: 'No champions found' },
  'champ.loading': { de: 'Lade Champion-Daten...', en: 'Loading champion data...' },
  'champ.rankDistribution': { de: 'Rang-Verteilung', en: 'Rank Distribution' },
  'champ.roleLabel': { de: 'Rolle', en: 'Role' },
  'champ.rankLabel': { de: 'Rang', en: 'Rank' },

  // Tier names (same in both languages - they are game terms)
  'tier.all': { de: 'Alle Ränge', en: 'All Ranks' },
  'tier.iron': { de: 'Iron', en: 'Iron' },
  'tier.bronze': { de: 'Bronze', en: 'Bronze' },
  'tier.silver': { de: 'Silver', en: 'Silver' },
  'tier.gold': { de: 'Gold', en: 'Gold' },
  'tier.platinum': { de: 'Platinum', en: 'Platinum' },
  'tier.emerald': { de: 'Emerald', en: 'Emerald' },
  'tier.diamond': { de: 'Diamond', en: 'Diamond' },
  'tier.master': { de: 'Master', en: 'Master' },
  'tier.grandmaster': { de: 'Grandmaster', en: 'Grandmaster' },
  'tier.challenger': { de: 'Challenger', en: 'Challenger' },

  // Role names
  'role.all': { de: 'Alle Rollen', en: 'All Roles' },
  'role.top': { de: 'Top', en: 'Top' },
  'role.jungle': { de: 'Jungle', en: 'Jungle' },
  'role.mid': { de: 'Mid', en: 'Mid' },
  'role.adc': { de: 'ADC', en: 'ADC' },
  'role.support': { de: 'Support', en: 'Support' },

  // Champion Detail
  'champDetail.back': { de: 'Alle Champions', en: 'All Champions' },
  'champDetail.baseStats': { de: 'Grundwerte', en: 'Base Stats' },
  'champDetail.perLevel': { de: 'pro Level', en: 'per level' },
  'champDetail.abilities': { de: 'Fähigkeiten', en: 'Abilities' },
  'champDetail.tips': { de: 'Tipps', en: 'Tips' },
  'champDetail.allyTips': { de: 'Als Verbündeter', en: 'As Ally' },
  'champDetail.enemyTips': { de: 'Als Gegner', en: 'As Enemy' },
  'champDetail.lore': { de: 'Geschichte', en: 'Lore' },
  'champDetail.loading': { de: 'Lade Champion...', en: 'Loading champion...' },
  'champDetail.notFound': { de: 'Champion nicht gefunden', en: 'Champion not found' },

  // Marktwert
  'mv.title': { de: 'Marktwerte', en: 'Market Values' },
  'mv.subtitle': { de: 'KI-gestützte Marktwertberechnung für alle Spieler ab Diamond IV — die E-Sport Referenz', en: 'AI-powered market value calculation for all Diamond IV+ players — the E-Sports reference' },
  'mv.region': { de: 'Region', en: 'Region' },
  'mv.elo': { de: 'Elo', en: 'Elo' },
  'mv.allRegions': { de: 'Alle Regionen', en: 'All Regions' },
  'mv.allElos': { de: 'Alle Elos', en: 'All Elos' },
  'mv.ratedPlayers': { de: 'Bewertete Spieler', en: 'Rated Players' },
  'mv.noData': { de: 'Noch keine Marktwert-Daten vorhanden', en: 'No market value data yet' },
  'mv.noDataDesc': { de: 'Marktwerte werden automatisch berechnet, wenn Spieler ab Diamond IV gesucht werden.', en: 'Market values are automatically calculated when Diamond IV+ players are searched.' },
  'mv.searchOnHome': { de: 'Startseite', en: 'home page' },
  'mv.buildDb': { de: 'Suche Spieler auf der', en: 'Search players on the' },
  'mv.buildDbEnd': { de: ', um die Datenbank aufzubauen.', en: ' to build the database.' },
  'mv.topValues': { de: 'Top Marktwerte', en: 'Top Market Values' },
  'mv.player': { de: 'Spieler', en: 'Player' },
  'mv.rank': { de: 'Rang', en: 'Rank' },
  'mv.winrate': { de: 'Winrate', en: 'Win Rate' },
  'mv.marketValue': { de: 'Marktwert', en: 'Market Value' },
  'mv.7days': { de: '7-Tage', en: '7 Days' },
  'mv.gainersWeek': { de: 'Gewinner der Woche', en: 'Winners of the Week' },
  'mv.losersWeek': { de: 'Verlierer der Woche', en: 'Losers of the Week' },
  'mv.noWeeklyData': { de: 'Noch keine Wochen-Daten vorhanden', en: 'No weekly data yet' },
  'mv.scale': { de: 'Marktwert-Skala', en: 'Market Value Scale' },
  'mv.scaleDesc': { de: 'Endwert = Basiswert x Leistungs-Multiplikator (Winrate, KDA, CS/Min, Vision, Objectives — rollenspezifisch gewichtet)', en: 'Final value = Base value x Performance multiplier (Win rate, KDA, CS/min, Vision, Objectives — role-weighted)' },
  'mv.noDataTier': { de: 'Keine Daten', en: 'No data' },
  'mv.players': { de: 'Spieler', en: 'Players' },

  // Footer
  'footer.disclaimer': { de: 'Nicht offiziell mit Riot Games verbunden', en: 'Not officially affiliated with Riot Games' },
  'footer.privacy': { de: 'Datenschutz', en: 'Privacy' },
  'footer.legal': { de: 'Impressum', en: 'Legal Notice' },

  // Common
  'common.loading': { de: 'Laden...', en: 'Loading...' },
  'common.all': { de: 'Alle', en: 'All' },

  // Stats Categories
  'stats.title': { de: 'Leistungsanalyse', en: 'Performance Analysis' },
  'stats.subtitle': { de: '20 Statistik-Kategorien basierend auf', en: '20 stat categories based on' },
  'stats.games': { de: 'Spielen', en: 'games' },
  'stats.overallScore': { de: 'Gesamtscore', en: 'Overall Score' },
  'stats.improving': { de: 'Verbesserung', en: 'Improving' },
  'stats.declining': { de: 'Rückgang', en: 'Declining' },
  'stats.stable': { de: 'Stabil', en: 'Stable' },
  'stats.premiumHint': { de: 'Detaillierte Statistiken für Premium-Abonnenten', en: 'Detailed stats for premium subscribers' },
  'stats.premiumBadge': { de: 'PREMIUM', en: 'PREMIUM' },
  'stats.unlockDetails': { de: 'Details freischalten', en: 'Unlock details' },
} as const;

type TranslationKey = keyof typeof translations;

interface I18nContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextType>({
  lang: 'de',
  setLang: () => {},
  t: (key) => translations[key]?.de || key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('de');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('metastats-lang') as Lang;
    if (saved === 'en' || saved === 'de') setLangState(saved);
    setMounted(true);
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem('metastats-lang', l);
  };

  const t = (key: TranslationKey): string => {
    return translations[key]?.[lang] || key;
  };

  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
