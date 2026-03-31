'use client';
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type Lang = 'de' | 'en' | 'ko' | 'zh' | 'es' | 'fr';

export const LANGUAGES: { code: Lang; label: string; flag: string; flagUrl: string; country: string }[] = [
  { code: 'de', label: 'Deutsch', flag: '\uD83C\uDDE9\uD83C\uDDEA', flagUrl: 'https://flagcdn.com/w40/de.png', country: 'Deutschland' },
  { code: 'en', label: 'English', flag: '\uD83C\uDDEC\uD83C\uDDE7', flagUrl: 'https://flagcdn.com/w40/gb.png', country: 'United Kingdom' },
  { code: 'ko', label: '\uD55C\uAD6D\uC5B4', flag: '\uD83C\uDDF0\uD83C\uDDF7', flagUrl: 'https://flagcdn.com/w40/kr.png', country: '\uD55C\uAD6D' },
  { code: 'zh', label: '\u4E2D\u6587', flag: '\uD83C\uDDE8\uD83C\uDDF3', flagUrl: 'https://flagcdn.com/w40/cn.png', country: '\u4E2D\u56FD' },
  { code: 'es', label: 'Espa\u00F1ol', flag: '\uD83C\uDDEA\uD83C\uDDF8', flagUrl: 'https://flagcdn.com/w40/es.png', country: 'Espa\u00F1a' },
  { code: 'fr', label: 'Fran\u00E7ais', flag: '\uD83C\uDDEB\uD83C\uDDF7', flagUrl: 'https://flagcdn.com/w40/fr.png', country: 'France' },
];

const t6 = (de: string, en: string, ko: string, zh: string, es: string, fr: string) => ({ de, en, ko, zh, es, fr });

const translations = {
  // Nav
  'nav.search': t6('Spielersuche', 'Player Search', '\uD50C\uB808\uC774\uC5B4 \uAC80\uC0C9', '\u641C\u7D22\u73A9\u5BB6', 'Buscar Jugador', 'Recherche Joueur'),
  'nav.leaderboard': t6('Rangliste', 'Leaderboard', '\uB9AC\uB354\uBCF4\uB4DC', '\u6392\u884C\u699C', 'Clasificaci\u00F3n', 'Classement'),
  'nav.champions': t6('Champions', 'Champions', '\uCC54\uD53C\uC5B8', '\u82F1\u96C4', 'Campeones', 'Champions'),
  'nav.marketvalue': t6('Marktwerte', 'Market Values', '\uC2DC\uC7A5 \uAC00\uCE58', '\u5E02\u573A\u4EF7\u503C', 'Valor de Mercado', 'Valeur March\u00E9'),
  'nav.analyse': t6('Spieleranalyse', 'Player Analysis', '\uC120\uC218 \uBD84\uC11D', '\u9009\u624B\u5206\u6790', 'An\u00E1lisis', 'Analyse'),

  // Homepage
  'home.subtitle': t6('Die f\u00FChrende E-Sport Analyseplattform', 'The Leading E-Sports Analytics Platform', '\uCD5C\uACE0\uC758 e\uC2A4\uD3EC\uCE20 \uBD84\uC11D \uD50C\uB7AB\uD3FC', '\u9886\u5148\u7684\u7535\u5B50\u7ADE\u6280\u5206\u6790\u5E73\u53F0', 'La plataforma l\u00EDder de an\u00E1lisis de eSports', 'La plateforme d\'analyse eSport de r\u00E9f\u00E9rence'),
  'home.title1': t6('League of Legends', 'League of Legends', '\uB9AC\uADF8 \uC624\uBE0C \uB808\uC804\uB4DC', '\u82F1\u96C4\u8054\u76DF', 'League of Legends', 'League of Legends'),
  'home.title2': t6('Statistiken & Marktwerte', 'Statistics & Market Values', '\uD1B5\uACC4 \uBC0F \uC2DC\uC7A5 \uAC00\uCE58', '\u7EDF\u8BA1\u4E0E\u5E02\u573A\u4EF7\u503C', 'Estad\u00EDsticas y Valores', 'Statistiques & Valeurs'),
  'home.desc': t6('Echtzeit-Stats, Match History & KI-gest\u00FCtzte Marktwertberechnung f\u00FCr alle Spieler', 'Real-time stats, match history & AI-powered market value calculation for all players', '\uC2E4\uC2DC\uAC04 \uD1B5\uACC4, \uB9E4\uCE58 \uAE30\uB85D \uBC0F AI \uC2DC\uC7A5 \uAC00\uCE58 \uC0B0\uC815', '\u5B9E\u65F6\u6570\u636E\u3001\u6BD4\u8D5B\u8BB0\u5F55\u548CAI\u5E02\u573A\u4EF7\u503C\u8BA1\u7B97', 'Estad\u00EDsticas en tiempo real, historial y valor de mercado con IA', 'Stats en temps r\u00E9el, historique et valeur march\u00E9 par IA'),
  'home.searchTab': t6('Spielersuche', 'Player Search', '\uD50C\uB808\uC774\uC5B4 \uAC80\uC0C9', '\u641C\u7D22\u73A9\u5BB6', 'Buscar Jugador', 'Recherche Joueur'),
  'home.marketTab': t6('Marktwerte', 'Market Values', '\uC2DC\uC7A5 \uAC00\uCE58', '\u5E02\u573A\u4EF7\u503C', 'Valores', 'Valeurs'),
  'home.searchPlaceholder': t6('Summoner-Name suchen... (z.B. Name#EUW)', 'Search summoner name... (e.g. Name#EUW)', '\uC18C\uD658\uC0AC\uBA85 \uAC80\uC0C9... (\uC608: \uC774\uB984#KR1)', '\u641C\u7D22\u53EC\u5524\u5E08\u540D\u5B57... (\u4F8B: \u540D\u5B57#KR)', 'Buscar invocador... (ej. Nombre#EUW)', 'Rechercher... (ex. Nom#EUW)'),
  'home.searchBtn': t6('Suchen', 'Search', '\uAC80\uC0C9', '\u641C\u7D22', 'Buscar', 'Rechercher'),
  'home.savedPlayers': t6('Gespeicherte Spieler', 'Saved Players', '\uC800\uC7A5\uB41C \uD50C\uB808\uC774\uC5B4', '\u5DF2\u4FDD\u5B58\u73A9\u5BB6', 'Jugadores guardados', 'Joueurs sauvegard\u00E9s'),
  'home.analyzedMatches': t6('Analysierte Matches', 'Analyzed Matches', '\uBD84\uC11D\uB41C \uB9E4\uCE58', '\u5DF2\u5206\u6790\u6BD4\u8D5B', 'Partidas analizadas', 'Matchs analys\u00E9s'),
  'home.avgMarketValue': t6('\u00D8 KI-Marktwert', 'Avg AI Market Value', '\uD3C9\uADE0 AI \uC2DC\uC7A5\uAC00\uCE58', '\u5E73\u5747AI\u5E02\u503C', 'Valor medio IA', 'Valeur moy. IA'),
  'home.activeRegions': t6('Aktive Regionen', 'Active Regions', '\uD65C\uC131 \uC9C0\uC5ED', '\u6D3B\u8DC3\u5730\u533A', 'Regiones activas', 'R\u00E9gions actives'),
  'home.thisWeek': t6('diese Woche', 'this week', '\uC774\uBC88 \uC8FC', '\u672C\u5468', 'esta semana', 'cette semaine'),
  'home.last30days': t6('letzte 30 Tage', 'last 30 days', '\uCD5C\uADFC 30\uC77C', '\u8FD130\u5929', '\u00FAltimos 30 d\u00EDas', '30 derniers jours'),
  'home.topFrom': t6('Top 1% ab $42.000', 'Top 1% from $42,000', '\uC0C1\uC704 1% $42,000\uBD80\uD130', 'Top 1% $42,000\u8D77', 'Top 1% desde $42.000', 'Top 1% \u00E0 partir de $42.000'),
  'home.recentSearches': t6('Zuletzt gesucht', 'Recently Searched', '\uCD5C\uADFC \uAC80\uC0C9', '\u6700\u8FD1\u641C\u7D22', 'B\u00FAsquedas recientes', 'Recherches r\u00E9centes'),
  'home.noSearches': t6('Noch keine Suchen', 'No searches yet', '\uAC80\uC0C9 \uAE30\uB85D \uC5C6\uC74C', '\u8FD8\u6CA1\u6709\u641C\u7D22', 'Sin b\u00FAsquedas', 'Pas encore de recherches'),
  'home.features': t6('Features', 'Features', '\uAE30\uB2A5', '\u529F\u80FD', 'Caracter\u00EDsticas', 'Fonctionnalit\u00E9s'),
  'home.feat1title': t6('KI-Marktwert', 'AI Market Value', 'AI \uC2DC\uC7A5\uAC00\uCE58', 'AI\u5E02\u573A\u4EF7\u503C', 'Valor IA', 'Valeur IA'),
  'home.feat1desc': t6('Rollenbasierte Bewertung ab Diamond 4', 'Role-based valuation from Diamond 4', '\uB2E4\uC774\uC544 4\uBD80\uD130 \uC5ED\uD560\uBCC4 \uD3C9\uAC00', '\u94BB\u77F34\u8D77\u89D2\u8272\u8BC4\u4F30', 'Valoraci\u00F3n por rol desde Diamante 4', '\u00C9valuation par r\u00F4le depuis Diamant 4'),
  'home.feat2title': t6('Match History', 'Match History', '\uB9E4\uCE58 \uAE30\uB85D', '\u6BD4\u8D5B\u8BB0\u5F55', 'Historial', 'Historique'),
  'home.feat2desc': t6('Letzte 30 Spiele mit allen Stats', 'Last 30 games with all stats', '\uCD5C\uADFC 30\uACBD\uAE30 \uC804\uCCB4 \uD1B5\uACC4', '\u6700\u8FD130\u573A\u6BD4\u8D5B\u5168\u90E8\u6570\u636E', '\u00DAltimas 30 partidas con estad\u00EDsticas', '30 derniers matchs avec stats'),
  'home.feat3title': t6('Rangliste', 'Leaderboard', '\uB9AC\uB354\uBCF4\uB4DC', '\u6392\u884C\u699C', 'Clasificaci\u00F3n', 'Classement'),
  'home.feat3desc': t6('Top Challenger Spieler EUW', 'Top Challenger players EUW', 'EUW \uCC4C\uB9B0\uC800 \uC0C1\uC704 \uD50C\uB808\uC774\uC5B4', 'EUW\u6700\u5F3A\u738B\u8005\u73A9\u5BB6', 'Top Challenger EUW', 'Top Challenger EUW'),
  'home.feat4title': t6('Multi-Region', 'Multi-Region', '\uBA40\uD2F0 \uC9C0\uC5ED', '\u591A\u5730\u533A', 'Multi-Regi\u00F3n', 'Multi-R\u00E9gion'),
  'home.feat4desc': t6('EUW, EUNE, NA, KR', 'EUW, EUNE, NA, KR', 'EUW, EUNE, NA, KR', 'EUW, EUNE, NA, KR', 'EUW, EUNE, NA, KR', 'EUW, EUNE, NA, KR'),
  'home.topMarketValues': t6('Top Marktwerte', 'Top Market Values', '\uCD5C\uACE0 \uC2DC\uC7A5\uAC00\uCE58', '\u6700\u9AD8\u5E02\u503C', 'Top Valores', 'Top Valeurs'),
  'home.noMarketData': t6('Noch keine Daten \u2014 Marktwerte werden gesammelt w\u00E4hrend Spieler gesucht werden', 'No data yet \u2014 market values are collected as players are searched', '\uC544\uC9C1 \uB370\uC774\uD130 \uC5C6\uC74C', '\u6682\u65E0\u6570\u636E', 'Sin datos a\u00FAn', 'Pas encore de donn\u00E9es'),
  'home.winnersWeek': t6('Gr\u00F6\u00DFte Gewinner', 'Biggest Gainers', '\uCD5C\uB300 \uC0C1\uC2B9', '\u6700\u5927\u8D62\u5BB6', 'Mayores ganadores', 'Plus grands gagnants'),
  'home.losersWeek': t6('Gr\u00F6\u00DFte Verlierer', 'Biggest Losers', '\uCD5C\uB300 \uD558\uB77D', '\u6700\u5927\u8F93\u5BB6', 'Mayores perdedores', 'Plus grands perdants'),
  'home.thisWeekLabel': t6('diese Woche', 'this week', '\uC774\uBC88 \uC8FC', '\u672C\u5468', 'esta semana', 'cette semaine'),
  'home.noData': t6('Noch keine Daten', 'No data yet', '\uB370\uC774\uD130 \uC5C6\uC74C', '\u6682\u65E0\u6570\u636E', 'Sin datos', 'Pas de donn\u00E9es'),
  'home.howCalc': t6('Wie wird berechnet?', 'How is it calculated?', '\uC5B4\uB5BB\uAC8C \uACC4\uC0B0\uB418\uB098\uC694?', '\u5982\u4F55\u8BA1\u7B97\uFF1F', '\u00BFC\u00F3mo se calcula?', 'Comment c\'est calcul\u00E9 ?'),
  'home.rank': t6('Rang', 'Rank', '\uB7AD\uD06C', '\u6BB5\u4F4D', 'Rango', 'Rang'),
  'home.baseFromDia': t6('Basis ab Diamond 4', 'Base from Diamond 4', '\uB2E4\uC774\uC544 4 \uAE30\uBCF8\uAC12', '\u94BB\u77F34\u57FA\u7840\u503C', 'Base desde Diamante 4', 'Base depuis Diamant 4'),
  'home.winrate': t6('Winrate', 'Win Rate', '\uC2B9\uB960', '\u80DC\u7387', 'Winrate', 'Winrate'),
  'home.last30': t6('Letzte 30 Spiele', 'Last 30 games', '\uCD5C\uADFC 30\uACBD\uAE30', '\u6700\u8FD130\u573A', '\u00DAltimas 30 partidas', '30 derniers matchs'),
  'home.roleSpecific': t6('Rollenspezifisch', 'Role-specific', '\uC5ED\uD560\uBCC4', '\u89D2\u8272\u7279\u5B9A', 'Por rol', 'Par r\u00F4le'),
  'home.objectives': t6('Drake, Baron, T\u00FCrme', 'Drake, Baron, Turrets', '\uB4DC\uB798\uACE4, \uBC14\uB860, \uD0C0\uC6CC', '\u5C0F\u9F99, \u5927\u9F99, \u9632\u5FA1\u5854', 'Drag\u00F3n, Bar\u00F3n, Torres', 'Dragon, Baron, Tours'),
  'home.vision': t6('Wards & Vision Score', 'Wards & Vision Score', '\uC640\uB4DC & \uC2DC\uC57C \uC810\uC218', '\u5B88\u536B & \u89C6\u91CE\u5206', 'Wards & Visi\u00F3n', 'Wards & Vision'),

  // Player Page
  'player.loading': t6('Lade Spielerprofil...', 'Loading player profile...', '\uD50C\uB808\uC774\uC5B4 \uD504\uB85C\uD544 \uB85C\uB529...', '\u52A0\u8F7D\u73A9\u5BB6\u8D44\u6599...', 'Cargando perfil...', 'Chargement du profil...'),
  'player.level': t6('Level', 'Level', '\uB808\uBCA8', '\u7B49\u7EA7', 'Nivel', 'Niveau'),
  'player.aiMarketValue': t6('KI-Marktwert', 'AI Market Value', 'AI \uC2DC\uC7A5\uAC00\uCE58', 'AI\u5E02\u503C', 'Valor IA', 'Valeur IA'),
  'player.rank': t6('Rang', 'Rank', '\uB7AD\uD06C', '\u6BB5\u4F4D', 'Rango', 'Rang'),
  'player.unranked': t6('Unranked', 'Unranked', '\uBC30\uCE58 \uC804', '\u672A\u5B9A\u7EA7', 'Sin clasificar', 'Non class\u00E9'),
  'player.winrate30': t6('Winrate (30 Spiele)', 'Win Rate (30 Games)', '\uC2B9\uB960 (30\uACBD\uAE30)', '\u80DC\u7387 (30\u573A)', 'Winrate (30 partidas)', 'Winrate (30 matchs)'),
  'player.avgKDA': t6('\u00D8 KDA', 'Avg KDA', '\uD3C9\uADE0 KDA', '\u5E73\u5747KDA', 'KDA medio', 'KDA moyen'),
  'player.mainRole': t6('Hauptrolle', 'Main Role', '\uC8FC \uD3EC\uC9C0\uC158', '\u4E3B\u8981\u4F4D\u7F6E', 'Rol principal', 'R\u00F4le principal'),
  'player.marketBreakdown': t6('Marktwert-Aufschl\u00FCsselung', 'Market Value Breakdown', '\uC2DC\uC7A5\uAC00\uCE58 \uBD84\uC11D', '\u5E02\u503C\u5206\u6790', 'Desglose de valor', 'D\u00E9tail de la valeur'),
  'player.baseValue': t6('Basiswert', 'Base Value', '\uAE30\uBCF8\uAC12', '\u57FA\u7840\u503C', 'Valor base', 'Valeur de base'),
  'player.multiplier': t6('Multiplikator', 'Multiplier', '\uBC30\uC728', '\u500D\u7387', 'Multiplicador', 'Multiplicateur'),
  'player.finalValue': t6('Endwert', 'Final Value', '\uCD5C\uC885\uAC12', '\u6700\u7EC8\u503C', 'Valor final', 'Valeur finale'),
  'player.games': t6('Spiele', 'Games', '\uACBD\uAE30', '\u6BD4\u8D5B', 'Partidas', 'Matchs'),
  'player.matchHistory': t6('Match History', 'Match History', '\uB9E4\uCE58 \uAE30\uB85D', '\u6BD4\u8D5B\u8BB0\u5F55', 'Historial', 'Historique'),
  'player.lastGames': t6('letzte', 'last', '\uCD5C\uADFC', '\u6700\u8FD1', '\u00FAltimas', 'derniers'),
  'player.gamesLabel': t6('Spiele', 'games', '\uACBD\uAE30', '\u573A', 'partidas', 'matchs'),
  'player.win': t6('Sieg', 'Win', '\uC2B9\uB9AC', '\u80DC', 'Victoria', 'Victoire'),
  'player.loss': t6('Niederlage', 'Loss', '\uD328\uBC30', '\u8D1F', 'Derrota', 'D\u00E9faite'),
  'player.enterName': t6('Gib einen Summoner-Namen ein um zu starten', 'Enter a summoner name to get started', '\uC18C\uD658\uC0AC\uBA85\uC744 \uC785\uB825\uD558\uC138\uC694', '\u8F93\u5165\u53EC\u5524\u5E08\u540D\u5B57\u5F00\u59CB', 'Introduce un nombre de invocador', 'Entrez un nom d\'invocateur'),

  // Leaderboard
  'lb.title': t6('Rangliste', 'Leaderboard', '\uB9AC\uB354\uBCF4\uB4DC', '\u6392\u884C\u699C', 'Clasificaci\u00F3n', 'Classement'),
  'lb.subtitle': t6('Alle Spieler nach Rang und Marktwert', 'All players by rank and market value', '\uB7AD\uD06C \uBC0F \uC2DC\uC7A5\uAC00\uCE58\uBCC4 \uBAA8\uB4E0 \uD50C\uB808\uC774\uC5B4', '\u6309\u6BB5\u4F4D\u548C\u5E02\u503C\u6392\u5E8F', 'Todos los jugadores por rango y valor', 'Tous les joueurs par rang et valeur'),
  'lb.searchPlaceholder': t6('Spieler suchen... (z.B. Caps, Agurin, Hide on Bush)', 'Search player... (e.g. Caps, Agurin, Hide on Bush)', '\uD50C\uB808\uC774\uC5B4 \uAC80\uC0C9...', '\u641C\u7D22\u73A9\u5BB6...', 'Buscar jugador...', 'Rechercher joueur...'),
  'lb.searchResult': t6('Suchergebnis f\u00FCr', 'Search result for', '\uAC80\uC0C9 \uACB0\uACFC', '\u641C\u7D22\u7ED3\u679C', 'Resultado para', 'R\u00E9sultat pour'),
  'lb.playersFound': t6('Spieler gefunden', 'players found', '\uBA85 \uCC3E\uC74C', '\u4E2A\u73A9\u5BB6', 'jugadores', 'joueurs trouv\u00E9s'),
  'lb.clearSearch': t6('Suche leeren', 'Clear search', '\uAC80\uC0C9 \uCDE8\uC18C', '\u6E05\u9664\u641C\u7D22', 'Limpiar', 'Effacer'),
  'lb.loading': t6('Lade Rangliste...', 'Loading leaderboard...', '\uB9AC\uB354\uBCF4\uB4DC \uB85C\uB529...', '\u52A0\u8F7D\u6392\u884C\u699C...', 'Cargando clasificaci\u00F3n...', 'Chargement du classement...'),
  'lb.noPlayers': t6('Keine Spieler gefunden', 'No players found', '\uD50C\uB808\uC774\uC5B4\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4', '\u672A\u627E\u5230\u73A9\u5BB6', 'No se encontraron jugadores', 'Aucun joueur trouv\u00E9'),
  'lb.player': t6('Spieler', 'Player', '\uD50C\uB808\uC774\uC5B4', '\u73A9\u5BB6', 'Jugador', 'Joueur'),
  'lb.region': t6('Region', 'Region', '\uC9C0\uC5ED', '\u5730\u533A', 'Regi\u00F3n', 'R\u00E9gion'),
  'lb.marketValue': t6('Marktwert', 'Market Value', '\uC2DC\uC7A5\uAC00\uCE58', '\u5E02\u503C', 'Valor', 'Valeur'),
  'lb.allRegions': t6('Alle', 'All', '\uC804\uCCB4', '\u5168\u90E8', 'Todas', 'Toutes'),

  // Champions
  'champ.title': t6('Champion-Statistiken', 'Champion Statistics', '\uCC54\uD53C\uC5B8 \uD1B5\uACC4', '\u82F1\u96C4\u7EDF\u8BA1', 'Estad\u00EDsticas de Campeones', 'Stats des Champions'),
  'champ.subtitle': t6('Winrate, Pickrate & Banrate aller Champions nach Rang', 'Win rate, pick rate & ban rate of all champions by rank', '\uB7AD\uD06C\uBCC4 \uBAA8\uB4E0 \uCC54\uD53C\uC5B8 \uC2B9\uB960, \uD53D\uB960, \uBC34\uB960', '\u6309\u6BB5\u4F4D\u7EDF\u8BA1\u6240\u6709\u82F1\u96C4\u80DC\u7387\u3001\u9009\u7387\u3001\u7981\u7528\u7387', 'Winrate, pickrate y banrate por rango', 'Winrate, pickrate et banrate par rang'),
  'champ.rank': t6('Rang', 'Rank', '\uB7AD\uD06C', '\u6BB5\u4F4D', 'Rango', 'Rang'),
  'champ.role': t6('Rolle', 'Role', '\uD3EC\uC9C0\uC158', '\u4F4D\u7F6E', 'Rol', 'R\u00F4le'),
  'champ.search': t6('Suche', 'Search', '\uAC80\uC0C9', '\u641C\u7D22', 'Buscar', 'Rechercher'),
  'champ.searchPlaceholder': t6('Champion suchen...', 'Search champion...', '\uCC54\uD53C\uC5B8 \uAC80\uC0C9...', '\u641C\u7D22\u82F1\u96C4...', 'Buscar campe\u00F3n...', 'Rechercher champion...'),
  'champ.allRanks': t6('Alle R\u00E4nge', 'All Ranks', '\uBAA8\uB4E0 \uB7AD\uD06C', '\u6240\u6709\u6BB5\u4F4D', 'Todos los rangos', 'Tous les rangs'),
  'champ.allRoles': t6('Alle Rollen', 'All Roles', '\uBAA8\uB4E0 \uD3EC\uC9C0\uC158', '\u6240\u6709\u4F4D\u7F6E', 'Todos los roles', 'Tous les r\u00F4les'),
  'champ.statsCollecting': t6('Statistiken werden gesammelt, wenn Spieler gesucht werden.', 'Statistics are collected when players are searched.', '\uD50C\uB808\uC774\uC5B4 \uAC80\uC0C9 \uC2DC \uD1B5\uACC4\uAC00 \uC218\uC9D1\uB429\uB2C8\uB2E4.', '\u641C\u7D22\u73A9\u5BB6\u65F6\u6536\u96C6\u7EDF\u8BA1\u6570\u636E\u3002', 'Las estad\u00EDsticas se recopilan al buscar jugadores.', 'Les stats sont collect\u00E9es lors des recherches.'),
  'champ.withData': t6('Mit Daten', 'With Data', '\uB370\uC774\uD130 \uC788\uC74C', '\u6709\u6570\u636E', 'Con datos', 'Avec donn\u00E9es'),
  'champ.champion': t6('Champion', 'Champion', '\uCC54\uD53C\uC5B8', '\u82F1\u96C4', 'Campe\u00F3n', 'Champion'),
  'champ.games': t6('Spiele', 'Games', '\uACBD\uAE30', '\u6BD4\u8D5B', 'Partidas', 'Matchs'),
  'champ.noChampions': t6('Keine Champions gefunden', 'No champions found', '\uCC54\uD53C\uC5B8\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4', '\u672A\u627E\u5230\u82F1\u96C4', 'No se encontraron campeones', 'Aucun champion trouv\u00E9'),
  'champ.loading': t6('Lade Champion-Daten...', 'Loading champion data...', '\uCC54\uD53C\uC5B8 \uB370\uC774\uD130 \uB85C\uB529...', '\u52A0\u8F7D\u82F1\u96C4\u6570\u636E...', 'Cargando datos...', 'Chargement...'),
  'champ.rankDistribution': t6('Rang-Verteilung', 'Rank Distribution', '\uB7AD\uD06C \uBD84\uD3EC', '\u6BB5\u4F4D\u5206\u5E03', 'Distribuci\u00F3n de rangos', 'Distribution des rangs'),
  'champ.roleLabel': t6('Rolle', 'Role', '\uD3EC\uC9C0\uC158', '\u4F4D\u7F6E', 'Rol', 'R\u00F4le'),
  'champ.rankLabel': t6('Rang', 'Rank', '\uB7AD\uD06C', '\u6BB5\u4F4D', 'Rango', 'Rang'),

  // Tier names (game terms - same in DE/EN, localized for KR/ZH/ES/FR per Riot)
  'tier.all': t6('Alle R\u00E4nge', 'All Ranks', '\uBAA8\uB4E0 \uB7AD\uD06C', '\u6240\u6709\u6BB5\u4F4D', 'Todos', 'Tous'),
  'tier.iron': t6('Iron', 'Iron', '\uC544\uC774\uC5B8', '\u9ED1\u94C1', 'Hierro', 'Fer'),
  'tier.bronze': t6('Bronze', 'Bronze', '\uBE0C\uB860\uC988', '\u9752\u94DC', 'Bronce', 'Bronze'),
  'tier.silver': t6('Silver', 'Silver', '\uC2E4\uBC84', '\u767D\u94F6', 'Plata', 'Argent'),
  'tier.gold': t6('Gold', 'Gold', '\uACE8\uB4DC', '\u9EC4\u91D1', 'Oro', 'Or'),
  'tier.platinum': t6('Platinum', 'Platinum', '\uD50C\uB798\uD2F0\uB118', '\u767D\u91D1', 'Platino', 'Platine'),
  'tier.emerald': t6('Emerald', 'Emerald', '\uC5D0\uBA54\uB784\uB4DC', '\u7FE1\u7FE0', 'Esmeralda', '\u00C9meraude'),
  'tier.diamond': t6('Diamond', 'Diamond', '\uB2E4\uC774\uC544\uBABD\uB4DC', '\u94BB\u77F3', 'Diamante', 'Diamant'),
  'tier.master': t6('Master', 'Master', '\uB9C8\uC2A4\uD130', '\u5927\u5E08', 'Maestro', 'Ma\u00EEtre'),
  'tier.grandmaster': t6('Grandmaster', 'Grandmaster', '\uADF8\uB79C\uB4DC\uB9C8\uC2A4\uD130', '\u5B97\u5E08', 'Gran Maestro', 'Grand Ma\u00EEtre'),
  'tier.challenger': t6('Challenger', 'Challenger', '\uCC4C\uB9B0\uC800', '\u6700\u5F3A\u738B\u8005', 'Aspirante', 'Challenger'),

  // Role names (game terms - Top/Jungle/Mid/ADC/Support stay in DE/EN/ES/FR)
  'role.all': t6('Alle Rollen', 'All Roles', '\uBAA8\uB4E0 \uD3EC\uC9C0\uC158', '\u6240\u6709\u4F4D\u7F6E', 'Todos', 'Tous'),
  'role.top': t6('Top', 'Top', '\uD0D1', '\u4E0A\u8DEF', 'Top', 'Top'),
  'role.jungle': t6('Jungle', 'Jungle', '\uC815\uAE00', '\u6253\u91CE', 'Jungle', 'Jungle'),
  'role.mid': t6('Mid', 'Mid', '\uBBF8\uB4DC', '\u4E2D\u8DEF', 'Mid', 'Mid'),
  'role.adc': t6('ADC', 'ADC', '\uC6D0\uB51C', '\u4E0B\u8DEF', 'ADC', 'ADC'),
  'role.support': t6('Support', 'Support', '\uC11C\uD3EC\uD130', '\u8F85\u52A9', 'Support', 'Support'),

  // Champion Detail
  'champDetail.back': t6('Alle Champions', 'All Champions', '\uBAA8\uB4E0 \uCC54\uD53C\uC5B8', '\u6240\u6709\u82F1\u96C4', 'Todos los campeones', 'Tous les champions'),
  'champDetail.baseStats': t6('Grundwerte', 'Base Stats', '\uAE30\uBCF8 \uC2A4\uD0EF', '\u57FA\u7840\u5C5E\u6027', 'Atributos base', 'Stats de base'),
  'champDetail.perLevel': t6('pro Level', 'per level', '\uB808\uBCA8\uB2F9', '\u6BCF\u7EA7', 'por nivel', 'par niveau'),
  'champDetail.abilities': t6('F\u00E4higkeiten', 'Abilities', '\uC2A4\uD0AC', '\u6280\u80FD', 'Habilidades', 'Comp\u00E9tences'),
  'champDetail.tips': t6('Tipps', 'Tips', '\uD301', '\u63D0\u793A', 'Consejos', 'Conseils'),
  'champDetail.allyTips': t6('Als Verb\u00FCndeter', 'As Ally', '\uC544\uAD70\uC77C \uB54C', '\u4F5C\u4E3A\u961F\u53CB', 'Como aliado', 'En alli\u00E9'),
  'champDetail.enemyTips': t6('Als Gegner', 'As Enemy', '\uC801\uAD70\uC77C \uB54C', '\u4F5C\u4E3A\u654C\u4EBA', 'Como enemigo', 'En ennemi'),
  'champDetail.lore': t6('Geschichte', 'Lore', '\uC2A4\uD1A0\uB9AC', '\u80CC\u666F\u6545\u4E8B', 'Historia', 'Histoire'),
  'champDetail.loading': t6('Lade Champion...', 'Loading champion...', '\uCC54\uD53C\uC5B8 \uB85C\uB529...', '\u52A0\u8F7D\u82F1\u96C4...', 'Cargando...', 'Chargement...'),
  'champDetail.notFound': t6('Champion nicht gefunden', 'Champion not found', '\uCC54\uD53C\uC5B8\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4', '\u672A\u627E\u5230\u82F1\u96C4', 'Campe\u00F3n no encontrado', 'Champion introuvable'),

  // Marktwert
  'mv.title': t6('Marktwerte', 'Market Values', '\uC2DC\uC7A5 \uAC00\uCE58', '\u5E02\u573A\u4EF7\u503C', 'Valores de Mercado', 'Valeurs March\u00E9'),
  'mv.subtitle': t6('KI-gest\u00FCtzte Marktwertberechnung f\u00FCr alle Spieler ab Diamond IV', 'AI-powered market value calculation for all Diamond IV+ players', '\uB2E4\uC774\uC544 IV+ \uC804\uCCB4 AI \uC2DC\uC7A5\uAC00\uCE58', '\u94BB\u77F3IV+\u73A9\u5BB6AI\u5E02\u503C\u8BA1\u7B97', 'Valor de mercado IA para jugadores Diamante IV+', 'Valeur march\u00E9 IA pour joueurs Diamant IV+'),
  'mv.region': t6('Region', 'Region', '\uC9C0\uC5ED', '\u5730\u533A', 'Regi\u00F3n', 'R\u00E9gion'),
  'mv.elo': t6('Elo', 'Elo', '\uC5D8\uB85C', 'Elo', 'Elo', 'Elo'),
  'mv.allRegions': t6('Alle Regionen', 'All Regions', '\uBAA8\uB4E0 \uC9C0\uC5ED', '\u6240\u6709\u5730\u533A', 'Todas', 'Toutes'),
  'mv.allElos': t6('Alle Elos', 'All Elos', '\uBAA8\uB4E0 \uC5D8\uB85C', '\u6240\u6709Elo', 'Todos', 'Tous'),
  'mv.ratedPlayers': t6('Bewertete Spieler', 'Rated Players', '\uD3C9\uAC00\uB41C \uD50C\uB808\uC774\uC5B4', '\u5DF2\u8BC4\u4F30\u73A9\u5BB6', 'Jugadores valorados', 'Joueurs \u00E9valu\u00E9s'),
  'mv.noData': t6('Noch keine Marktwert-Daten vorhanden', 'No market value data yet', '\uC2DC\uC7A5\uAC00\uCE58 \uB370\uC774\uD130 \uC5C6\uC74C', '\u6682\u65E0\u5E02\u503C\u6570\u636E', 'Sin datos de valor', 'Pas de donn\u00E9es'),
  'mv.noDataDesc': t6('Marktwerte werden automatisch berechnet, wenn Spieler ab Diamond IV gesucht werden.', 'Market values are automatically calculated when Diamond IV+ players are searched.', '\uB2E4\uC774\uC544 IV+ \uD50C\uB808\uC774\uC5B4 \uAC80\uC0C9 \uC2DC \uC790\uB3D9 \uACC4\uC0B0\uB429\uB2C8\uB2E4.', '\u641C\u7D22\u94BB\u77F3IV+\u73A9\u5BB6\u65F6\u81EA\u52A8\u8BA1\u7B97\u3002', 'Se calculan al buscar jugadores Diamante IV+.', 'Calcul\u00E9es lors de la recherche de joueurs Diamant IV+.'),
  'mv.searchOnHome': t6('Startseite', 'home page', '\uD648\uD398\uC774\uC9C0', '\u9996\u9875', 'p\u00E1gina principal', 'page d\'accueil'),
  'mv.buildDb': t6('Suche Spieler auf der', 'Search players on the', '\uD50C\uB808\uC774\uC5B4 \uAC80\uC0C9:', '\u5728\u4EE5\u4E0B\u9875\u9762\u641C\u7D22:', 'Busca jugadores en la', 'Recherchez des joueurs sur la'),
  'mv.buildDbEnd': t6(', um die Datenbank aufzubauen.', ' to build the database.', '', '', ' para construir la base de datos.', ' pour remplir la base.'),
  'mv.topValues': t6('Top Marktwerte', 'Top Market Values', '\uCD5C\uACE0 \uC2DC\uC7A5\uAC00\uCE58', '\u6700\u9AD8\u5E02\u503C', 'Top Valores', 'Top Valeurs'),
  'mv.player': t6('Spieler', 'Player', '\uD50C\uB808\uC774\uC5B4', '\u73A9\u5BB6', 'Jugador', 'Joueur'),
  'mv.rank': t6('Rang', 'Rank', '\uB7AD\uD06C', '\u6BB5\u4F4D', 'Rango', 'Rang'),
  'mv.winrate': t6('Winrate', 'Win Rate', '\uC2B9\uB960', '\u80DC\u7387', 'Winrate', 'Winrate'),
  'mv.marketValue': t6('Marktwert', 'Market Value', '\uC2DC\uC7A5\uAC00\uCE58', '\u5E02\u503C', 'Valor', 'Valeur'),
  'mv.7days': t6('7-Tage', '7 Days', '7\uC77C', '7\u5929', '7 d\u00EDas', '7 jours'),
  'mv.gainersWeek': t6('Gewinner der Woche', 'Winners of the Week', '\uC8FC\uAC04 \uC0C1\uC2B9', '\u672C\u5468\u8D62\u5BB6', 'Ganadores de la semana', 'Gagnants de la semaine'),
  'mv.losersWeek': t6('Verlierer der Woche', 'Losers of the Week', '\uC8FC\uAC04 \uD558\uB77D', '\u672C\u5468\u8F93\u5BB6', 'Perdedores de la semana', 'Perdants de la semaine'),
  'mv.noWeeklyData': t6('Noch keine Wochen-Daten vorhanden', 'No weekly data yet', '\uC8FC\uAC04 \uB370\uC774\uD130 \uC5C6\uC74C', '\u6682\u65E0\u5468\u6570\u636E', 'Sin datos semanales', 'Pas de donn\u00E9es hebdo'),
  'mv.scale': t6('Marktwert-Skala', 'Market Value Scale', '\uC2DC\uC7A5\uAC00\uCE58 \uCC99\uB3C4', '\u5E02\u503C\u8303\u56F4', 'Escala de valor', '\u00C9chelle de valeur'),
  'mv.scaleDesc': t6('Endwert = Basiswert x Leistungs-Multiplikator', 'Final value = Base value x Performance multiplier', '\uCD5C\uC885\uAC12 = \uAE30\uBCF8\uAC12 x \uC131\uACFC \uBC30\uC728', '\u6700\u7EC8\u503C = \u57FA\u7840\u503C x \u8868\u73B0\u500D\u7387', 'Valor final = Base x Multiplicador', 'Valeur finale = Base x Multiplicateur'),
  'mv.noDataTier': t6('Keine Daten', 'No data', '\uB370\uC774\uD130 \uC5C6\uC74C', '\u65E0\u6570\u636E', 'Sin datos', 'Pas de donn\u00E9es'),
  'mv.players': t6('Spieler', 'Players', '\uD50C\uB808\uC774\uC5B4', '\u73A9\u5BB6', 'Jugadores', 'Joueurs'),

  // Footer
  'footer.disclaimer': t6('Nicht offiziell mit Riot Games verbunden', 'Not officially affiliated with Riot Games', 'Riot Games\uC640 \uACF5\uC2DD \uC81C\uD734 \uC544\uB2D8', '\u4E0ERiot Games\u65E0\u5B98\u65B9\u5173\u8054', 'No afiliado oficialmente a Riot Games', 'Non affili\u00E9 officiellement \u00E0 Riot Games'),
  'footer.privacy': t6('Datenschutz', 'Privacy', '\uAC1C\uC778\uC815\uBCF4', '\u9690\u79C1', 'Privacidad', 'Confidentialit\u00E9'),
  'footer.legal': t6('Impressum', 'Legal Notice', '\uBC95\uC801 \uACF5\uC9C0', '\u6CD5\u5F8B\u58F0\u660E', 'Aviso legal', 'Mentions l\u00E9gales'),

  // Common
  'common.loading': t6('Laden...', 'Loading...', '\uB85C\uB529...', '\u52A0\u8F7D\u4E2D...', 'Cargando...', 'Chargement...'),
  'common.all': t6('Alle', 'All', '\uC804\uCCB4', '\u5168\u90E8', 'Todos', 'Tous'),

  // Stats
  'stats.title': t6('Leistungsanalyse', 'Performance Analysis', '\uC131\uACFC \uBD84\uC11D', '\u8868\u73B0\u5206\u6790', 'An\u00E1lisis de rendimiento', 'Analyse de performance'),
  'stats.subtitle': t6('17 Statistik-Kategorien basierend auf', '17 stat categories based on', '17\uAC1C \uD1B5\uACC4 \uCE74\uD14C\uACE0\uB9AC \uAE30\uBC18', '17\u4E2A\u7EDF\u8BA1\u7C7B\u522B\u57FA\u4E8E', '17 categor\u00EDas basadas en', '17 cat\u00E9gories bas\u00E9es sur'),
  'stats.games': t6('Spielen', 'games', '\uACBD\uAE30', '\u573A\u6BD4\u8D5B', 'partidas', 'matchs'),
  'stats.overallScore': t6('Gesamtscore', 'Overall Score', '\uC885\uD569 \uC810\uC218', '\u7EFC\u5408\u5206\u6570', 'Puntuaci\u00F3n total', 'Score global'),
  'stats.improving': t6('Verbesserung', 'Improving', '\uC0C1\uC2B9', '\u8FDB\u6B65', 'Mejorando', 'En progr\u00E8s'),
  'stats.declining': t6('R\u00FCckgang', 'Declining', '\uD558\uB77D', '\u4E0B\u964D', 'Bajando', 'En baisse'),
  'stats.stable': t6('Stabil', 'Stable', '\uC548\uC815', '\u7A33\u5B9A', 'Estable', 'Stable'),
  'stats.premiumHint': t6('Detaillierte Statistiken f\u00FCr Premium-Abonnenten', 'Detailed stats for premium subscribers', '\uD504\uB9AC\uBBF8\uC5C4 \uAD6C\uB3C5\uC790 \uC804\uC6A9 \uC0C1\uC138 \uD1B5\uACC4', '\u9AD8\u7EA7\u7528\u6237\u8BE6\u7EC6\u6570\u636E', 'Estad\u00EDsticas detalladas para premium', 'Stats d\u00E9taill\u00E9es pour abonn\u00E9s premium'),
  'stats.premiumBadge': t6('PREMIUM', 'PREMIUM', '\uD504\uB9AC\uBBF8\uC5C4', 'PREMIUM', 'PREMIUM', 'PREMIUM'),
  'stats.unlockDetails': t6('Details freischalten', 'Unlock details', '\uC0C1\uC138\uC815\uBCF4 \uD574\uC81C', '\u89E3\u9501\u8BE6\u60C5', 'Desbloquear detalles', 'D\u00E9bloquer d\u00E9tails'),

  // Teams
  'teams.title': t6('Pro Teams', 'Pro Teams', '\uD504\uB85C\uD300', '\uC9C1\uC5C5\uD300', 'Equipos Pro', '\u00C9quipes Pro'),
  'teams.subtitle': t6('Alle professionellen LoL-Teams mit Roster, Titeln und Preisgeldern', 'All professional LoL teams with rosters, titles and prize money', '\uBAA8\uB4E0 \uD504\uB85C \uB9AC\uADF8 \uC624\uBE0C \uB808\uC804\uB4DC \uD300', '\u6240\u6709\u804C\u4E1A\u82F1\u96C4\u8054\u76DF\u6218\u961F', 'Todos los equipos profesionales de LoL', 'Toutes les \u00E9quipes LoL professionnelles'),
  'teams.sort': t6('Sortierung', 'Sort by', '\uC815\uB82C', '\u6392\u5E8F', 'Ordenar', 'Trier'),
  'teams.prizeTotal': t6('Preisgeld (Gesamt)', 'Prize Money (Total)', '\uCD1D \uC0C1\uAE08', '\u603B\u5956\u91D1', 'Premios (Total)', 'Gains (Total)'),
  'teams.prizeSeason': t6('Saison-Preisgeld', 'Season Prize Money', '\uC2DC\uC98C \uC0C1\uAE08', '\u8D5B\u5B63\u5956\u91D1', 'Premios por Temporada', 'Gains par Saison'),
  'teams.trophies': t6('Titel', 'Titles', '\uD0C0\uC774\uD2C0', '\u51A0\u519B', 'T\u00EDtulos', 'Titres'),
  'teams.name': t6('Name', 'Name', '\uC774\uB984', '\u540D\u79F0', 'Nombre', 'Nom'),
  'teams.roster': t6('Kader', 'Roster', '\uB85C\uC2A4\uD130', '\u9635\u5BB9', 'Plantilla', 'Effectif'),
  'teams.season': t6('Saison', 'Season', '\uC2DC\uC98C', '\u8D5B\u5B63', 'Temporada', 'Saison'),
  'teams.allSeasons': t6('Alle', 'All', '\uC804\uCCB4', '\u5168\u90E8', 'Todas', 'Toutes'),
  'teams.count': t6('Teams', 'Teams', '\uD300', '\u6218\u961F', 'Equipos', '\u00C9quipes'),
  'teams.withRoster': t6('Mit Roster', 'With Roster', '\uB85C\uC2A4\uD130 \uC788\uC74C', '\u6709\u9635\u5BB9', 'Con Plantilla', 'Avec Effectif'),
  'teams.withTitles': t6('Mit Titeln', 'With Titles', '\uD0C0\uC774\uD2C0 \uC788\uC74C', '\u6709\u51A0\u519B', 'Con T\u00EDtulos', 'Avec Titres'),
  'teams.totalPrize': t6('Gesamtes Preisgeld', 'Total Prize Money', '\uCD1D \uC0C1\uAE08', '\u603B\u5956\u91D1', 'Premios Totales', 'Gains Totaux'),
  'teams.players': t6('Spieler', 'Players', '\uC120\uC218', '\u9009\u624B', 'Jugadores', 'Joueurs'),
  'teams.search': t6('Suche', 'Search', '\uAC80\uC0C9', '\u641C\u7D22', 'Buscar', 'Recherche'),
  'teams.searchPlaceholder': t6('Teamname...', 'Team name...', '\uD300\uBA85...', '\u6218\u961F\u540D...', 'Nombre del equipo...', 'Nom d\'\u00E9quipe...'),
  'teams.loading': t6('Lade Teams...', 'Loading teams...', '\uD300 \uB85C\uB529 \uC911...', '\u52A0\u8F7D\u4E2D...', 'Cargando equipos...', 'Chargement...'),
  'teams.noTeams': t6('Keine Teams gefunden', 'No teams found', '\uD300\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4', '\u672A\u627E\u5230\u6218\u961F', 'No se encontraron equipos', 'Aucune \u00E9quipe trouv\u00E9e'),

  // Team Detail
  'team.allTeams': t6('Alle Teams', 'All Teams', '\uBAA8\uB4E0 \uD300', '\u6240\u6709\u6218\u961F', 'Todos los equipos', 'Toutes les \u00E9quipes'),
  'team.notFound': t6('Team nicht gefunden', 'Team not found', '\uD300\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4', '\u672A\u627E\u5230\u6218\u961F', 'Equipo no encontrado', '\u00C9quipe non trouv\u00E9e'),
  'team.prizeMoney': t6('Preisgelder', 'Prize Money', '\uC0C1\uAE08', '\u5956\u91D1', 'Premios', 'Gains'),
  'team.activeRoster': t6('Aktives Roster', 'Active Roster', '\uD604\uC7AC \uB85C\uC2A4\uD130', '\u73B0\u5F79\u9635\u5BB9', 'Plantilla Activa', 'Effectif Actif'),
  'team.subs': t6('Ersatzspieler', 'Substitutes', '\uB300\uCCB4 \uC120\uC218', '\u66FF\u8865\u9009\u624B', 'Suplentes', 'Rempla\u00E7ants'),
  'team.staff': t6('Staff', 'Staff', '\uC2A4\uD0DC\uD504', '\u6559\u7EC3\u7EC4', 'Personal', 'Staff'),
  'team.history': t6('Turnierhistorie', 'Tournament History', '\uB300\uD68C \uAE30\uB85D', '\u8D5B\u4E8B\u5386\u53F2', 'Historial de Torneos', 'Historique des Tournois'),
  'team.tournament': t6('Turnier', 'Tournament', '\uB300\uD68C', '\u8D5B\u4E8B', 'Torneo', 'Tournoi'),
  'team.place': t6('Platz', 'Place', '\uC21C\uC704', '\u540D\u6B21', 'Puesto', 'Place'),
  'team.date': t6('Datum', 'Date', '\uB0A0\uC9DC', '\u65E5\u671F', 'Fecha', 'Date'),
  'team.tournaments': t6('Turniere', 'Tournaments', '\uB300\uD68C', '\u8D5B\u4E8B', 'Torneos', 'Tournois'),
  'team.firstPlace': t6('Platz 1', '1st Place', '1\uC704', '\u7B2C1\u540D', '1\u00BA Puesto', '1\u00E8re Place'),
  'team.noResults': t6('Keine Ergebnisse', 'No results', '\uACB0\uACFC \uC5C6\uC74C', '\u65E0\u7ED3\u679C', 'Sin resultados', 'Aucun r\u00E9sultat'),
  'team.viewProfile': t6('Profil ansehen', 'View Profile', '\uD504\uB85C\uD544 \uBCF4\uAE30', '\u67E5\u770B\u8D44\u6599', 'Ver Perfil', 'Voir Profil'),
  'team.prev': t6('Zurueck', 'Previous', '\uC774\uC804', '\u4E0A\u4E00\u9875', 'Anterior', 'Pr\u00E9c\u00E9dent'),
  'team.next': t6('Weiter', 'Next', '\uB2E4\uC74C', '\u4E0B\u4E00\u9875', 'Siguiente', 'Suivant'),
  'team.page': t6('Seite', 'Page', '\uD398\uC774\uC9C0', '\u9875\u7801', 'P\u00E1gina', 'Page'),
  'team.results': t6('Ergebnisse', 'Results', '\uACB0\uACFC', '\u7ED3\u679C', 'Resultados', 'R\u00E9sultats'),

  // Compare
  'compare.title': t6('Spieler-Vergleich', 'Player Comparison', '\uC120\uC218 \uBE44\uAD50', '\u9009\u624B\u5BF9\u6BD4', 'Comparar Jugadores', 'Comparaison de Joueurs'),
  'compare.subtitle': t6('Vergleiche zwei Spieler direkt miteinander', 'Compare two players head to head', '\uB450 \uC120\uC218\uB97C \uC9C1\uC811 \uBE44\uAD50\uD574\uBCF4\uC138\uC694', '\u76F4\u63A5\u5BF9\u6BD4\u4E24\u540D\u9009\u624B', 'Compara dos jugadores directamente', 'Comparez deux joueurs face \u00E0 face'),

  // Multi-Search
  'multi.title': t6('Multi-Search', 'Multi-Search', '\uBA40\uD2F0 \uAC80\uC0C9', '\u591A\u4EBA\u641C\u7D22', 'Multi-B\u00FAsqueda', 'Multi-Recherche'),
  'multi.subtitle': t6('Analysiere mehrere Spieler gleichzeitig', 'Analyze multiple players at once', '\uC5EC\uB7EC \uC120\uC218\uB97C \uB3D9\uC2DC\uC5D0 \uBD84\uC11D\uD558\uC138\uC694', '\u540C\u65F6\u5206\u6790\u591A\u4E2A\u73A9\u5BB6', 'Analiza varios jugadores a la vez', 'Analysez plusieurs joueurs simultan\u00E9ment'),
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
    if (saved && LANGUAGES.some(l => l.code === saved)) setLangState(saved);
    setMounted(true);
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem('metastats-lang', l);
  };

  const t = (key: TranslationKey): string => {
    return translations[key]?.[lang] || translations[key]?.en || key;
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
