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

export const LOCALE_MAP: Record<Lang, string> = {
  de: 'de-DE', en: 'en-US', ko: 'ko-KR', zh: 'zh-CN', es: 'es-ES', fr: 'fr-FR',
};

const t6 = (de: string, en: string, ko: string, zh: string, es: string, fr: string) => ({ de, en, ko, zh, es, fr });

const translations = {
  // Nav
  'nav.search': t6('Spielersuche', 'Player Search', '\uD50C\uB808\uC774\uC5B4 \uAC80\uC0C9', '\u641C\u7D22\u73A9\u5BB6', 'Buscar Jugador', 'Recherche Joueur'),
  'nav.leaderboard': t6('Rangliste', 'Leaderboard', '\uB9AC\uB354\uBCF4\uB4DC', '\u6392\u884C\u699C', 'Clasificaci\u00F3n', 'Classement'),
  'nav.champions': t6('Champions', 'Champions', '\uCC54\uD53C\uC5B8', '\u82F1\u96C4', 'Campeones', 'Champions'),
  'nav.marketvalue': t6('Marktwerte', 'Market Values', '\uC2DC\uC7A5 \uAC00\uCE58', '\u5E02\u573A\u4EF7\u503C', 'Valor de Mercado', 'Valeur March\u00E9'),
  'nav.analyse': t6('Spielervergleich', 'Player Comparison', '\uC120\uC218 \uBE44\uAD50', '\u9009\u624B\u5BF9\u6BD4', 'Comparaci\u00F3n', 'Comparaison'),
  'nav.proTeams': t6('Pro Teams', 'Pro Teams', '\uD504\uB85C\uD300', '\u804C\u4E1A\u6218\u961F', 'Equipos Pro', '\u00C9quipes Pro'),
  'nav.leagues': t6('Ligen & Wettbewerbe', 'Leagues & Competitions', '\uB9AC\uADF8 & \uB300\uD68C', '\u8054\u8D5B & \u6BD4\u8D5B', 'Ligas & Competiciones', 'Ligues & Comp\u00E9titions'),
  'nav.searchPlaceholder': t6('Spieler / Champion...', 'Player / Champion...', '\uD50C\uB808\uC774\uC5B4 / \uCC54\uD53C\uC5B8...', '\u73A9\u5BB6 / \u82F1\u96C4...', 'Jugador / Campe\u00F3n...', 'Joueur / Champion...'),
  'nav.searchPlaceholderTft': t6('Spieler / Unit / Item...', 'Player / Unit / Item...', '\uD50C\uB808\uC774\uC5B4 / \uC720\uB2DB / \uC544\uC774\uD15C...', '\u73A9\u5BB6 / \u5355\u4F4D / \u88C5\u5907...', 'Jugador / Unidad / \u00CDtem...', 'Joueur / Unit\u00E9 / Objet...'),
  'nav.units': t6('Units', 'Units', '\uC720\uB2DB', '\u5355\u4F4D', 'Unidades', 'Unit\u00E9s'),
  'nav.items': t6('Items', 'Items', '\uC544\uC774\uD15C', '\u88C5\u5907', '\u00CDtems', 'Objets'),
  'nav.augments': t6('Augments', 'Augments', '\uC99D\uAC15', '\u5F3A\u5316\u7B26\u6587', 'Aumentos', 'Augments'),
  'nav.comps': t6('Comps', 'Comps', '\uC870\uD569', '\u9635\u5BB9', 'Comps', 'Comps'),
  'nav.traits': t6('Synergien', 'Traits', '\uC2DC\uB108\uC9C0', '\u7F81\u7ECA', 'Sinergias', 'Synergies'),
  'game.switch': t6('Spiel wechseln', 'Switch game', '\uAC8C\uC784 \uC804\uD658', '\u5207\u6362\u6E38\u620F', 'Cambiar juego', 'Changer de jeu'),
  'game.lol': t6('League of Legends', 'League of Legends', '\uB9AC\uADF8 \uC624\uBE0C \uB808\uC804\uB4DC', '\u82F1\u96C4\u8054\u76DF', 'League of Legends', 'League of Legends'),
  'game.tft': t6('Teamfight Tactics', 'Teamfight Tactics', '\uC804\uB7B5\uC801 \uD300 \uC804\uD22C', '\u4E91\u9876\u4E4B\u5F08', 'Teamfight Tactics', 'Teamfight Tactics'),
  'tft.heroSubtitle': t6(
    'Aktuelle Meta-Comps der Top-Spieler',
    'Current meta comps from top players',
    '\uC0C1\uC704 \uD50C\uB808\uC774\uC5B4\uC758 \uD604\uC7AC \uBA54\uD0C0 \uC870\uD569',
    '\u9876\u5C16\u73A9\u5BB6\u7684\u5F53\u524D\u4E3B\u6D41\u9635\u5BB9',
    'Composiciones meta actuales de los mejores jugadores',
    'Compositions meta actuelles des meilleurs joueurs'
  ),
  'tft.set': t6('Set', 'Set', '\uC2DC\uC98C', '\u8D5B\u5B63', 'Set', 'Set'),
  'tft.allSets': t6('Alle Sets', 'All sets', '\uBAA8\uB4E0 \uC2DC\uC98C', '\u6240\u6709\u8D5B\u5B63', 'Todos los sets', 'Tous les sets'),
  'tft.currentSet': t6('Aktuelles Set', 'Current set', '\uD604\uC7AC \uC2DC\uC98C', '\u5F53\u524D\u8D5B\u5B63', 'Set actual', 'Set actuel'),
  'tft.noMatchesForSet': t6('Keine Matches in diesem Set.', 'No matches in this set.', '\uC774 \uC2DC\uC98C\uC5D0 \uACBD\uAE30\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.', '\u6B64\u8D5B\u5B63\u65E0\u6BD4\u8D5B\u3002', 'Sin partidas en este set.', 'Aucun match dans ce set.'),
  'tft.tier': t6('Liga', 'Tier', '\uB9AC\uADF8', '\u6BB5\u4F4D', 'Liga', 'Ligue'),
  'tft.bucket.all': t6('Alle R\u00E4nge', 'All ranks', '\uBAA8\uB4E0 \uB4F1\uAE09', '\u6240\u6709\u6BB5\u4F4D', 'Todos los rangos', 'Tous les rangs'),
  'tft.bucket.master_plus': t6('Master+', 'Master+', '\uB9C8\uC2A4\uD130+', '\u5927\u5E08+', 'Maestro+', 'Ma\u00EEtre+'),
  'tft.bucket.diamond': t6('Diamant', 'Diamond', '\uB2E4\uC774\uC544', '\u94BB\u77F3', 'Diamante', 'Diamant'),
  'tft.bucket.master': t6('Master', 'Master', '\uB9C8\uC2A4\uD130', '\u5927\u5E08', 'Maestro', 'Ma\u00EEtre'),
  'tft.bucket.grandmaster': t6('Grandmaster', 'Grandmaster', '\uADF8\uB79C\uB4DC\uB9C8\uC2A4\uD130', '\u5B97\u5E08', 'Grand Maestro', 'Grand Ma\u00EEtre'),
  'tft.bucket.challenger': t6('Challenger', 'Challenger', '\uCC4C\uB9B0\uC800', '\u738B\u8005', 'Aspirante', 'Challenger'),
  'tft.avgPlacement': t6('\u00D8 Platzierung', 'Avg Placement', '\uD3C9\uADE0 \uB4F1\uC218', '\u5E73\u5747\u540D\u6B21', 'Posici\u00F3n media', 'Place moy.'),
  'tft.top4': t6('Top 4', 'Top 4', '\uD0D1 4', 'Top 4', 'Top 4', 'Top 4'),
  'tft.top1': t6('Sieg', 'Win', '1\uC704', '\u51A0\u519B', 'Victoria', 'Victoire'),
  'tft.pickRate': t6('Pickrate', 'Pick rate', '\uD53D\uB960', '\u4F7F\u7528\u7387', 'Pickrate', 'Pickrate'),
  'tft.gamesShort': t6('Spiele', 'Games', '\uACBD\uAE30', '\u6BD4\u8D5B', 'Partidas', 'Matchs'),
  'tft.cost': t6('Kosten', 'Cost', '\uBE44\uC6A9', '\u8D39\u7528', 'Coste', 'Co\u00FBt'),
  'tft.activation': t6('Aktivierung', 'Activation', '\uD65C\uC131\uD654', '\u6FC0\u6D3B', 'Activaci\u00F3n', 'Activation'),
  'tft.slot': t6('Slot', 'Slot', '\uC2AC\uB86F', '\u69FD\u4F4D', 'Slot', 'Slot'),
  'tft.allSlots': t6('Alle Slots', 'All slots', '\uBAA8\uB4E0 \uC2AC\uB86F', '\u6240\u6709\u69FD\u4F4D', 'Todos los slots', 'Tous les slots'),
  'tft.topBuilds': t6('Top Item-Builds', 'Top Item Builds', '\uCD5C\uACE0 \uC544\uC774\uD15C \uBE4C\uB4DC', '\u6700\u4F73\u51FA\u88C5', 'Mejores Builds', 'Meilleurs Builds'),
  'tft.mostUsedItems': t6('H\u00E4ufigste Items', 'Most used items', '\uAC00\uC7A5 \uB9CE\uC774 \uC0AC\uC6A9\uB41C \uC544\uC774\uD15C', '\u6700\u5E38\u7528\u88C5\u5907', '\u00CDtems m\u00E1s usados', 'Objets les plus utilis\u00E9s'),
  'tft.topUsers': t6('H\u00E4ufigste Tr\u00E4ger', 'Most common holders', '\uAC00\uC7A5 \uB9CE\uC774 \uC0AC\uC6A9\uD558\uB294 \uCC54\uD53C\uC5B8', '\u6700\u5E38\u88C5\u5907\u7684\u82F1\u96C4', 'Portadores m\u00E1s comunes', 'Porteurs les plus fr\u00E9quents'),
  'tft.topItems': t6('Top-Items', 'Top items', '\uCD5C\uACE0 \uC544\uC774\uD15C', '\u70ED\u95E8\u88C5\u5907', 'Mejores \u00EDtems', 'Meilleurs objets'),
  'tft.filter.patch':   t6('Patch', 'Patch', '\uD328\uCE58', '\u7248\u672C', 'Parche', 'Patch'),
  'tft.filter.bucket':  t6('Rang', 'Rank', '\uB7AD\uD06C', '\u6BB5\u4F4D', 'Rango', 'Rang'),
  'tft.filter.days':    t6('Zeitfenster', 'Time window', '\uAE30\uAC04', '\u65F6\u95F4\u8303\u56F4', 'Periodo', 'P\u00E9riode'),
  'tft.filter.region':  t6('Region', 'Region', '\uC9C0\uC5ED', '\u533A\u57DF', 'Regi\u00F3n', 'R\u00E9gion'),
  'tft.filter.current': t6('Aktueller Patch', 'Current patch', '\uD604\uC7AC \uD328\uCE58', '\u5F53\u524D\u7248\u672C', 'Parche actual', 'Patch actuel'),
  'tft.filter.previous':t6('Voriger Patch', 'Previous patch', '\uC774\uC804 \uD328\uCE58', '\u4E0A\u4E2A\u7248\u672C', 'Parche anterior', 'Patch pr\u00E9c\u00E9dent'),
  'tft.filter.dayOne':  t6('Letzter Tag', 'Last day', '\uCD5C\uADFC 1\uC77C', '\u6700\u8FD11\u5929', '\u00DAltimo d\u00EDa', 'Dernier jour'),
  'tft.filter.dayN':    t6('Letzte {n} Tage', 'Last {n} days', '\uCD5C\uADFC {n}\uC77C', '\u6700\u8FD1{n}\u5929', '\u00DAltimos {n} d\u00EDas', '{n} derniers jours'),
  'tft.filter.allRegions': t6('Alle Regionen', 'All regions', '\uBAA8\uB4E0 \uC9C0\uC5ED', '\u6240\u6709\u533A\u57DF', 'Todas las regiones', 'Toutes les r\u00E9gions'),
  'tft.filter.west':       t6('Westen', 'West', '\uC11C\uAD6C\uAD8C', '\u897F\u65B9', 'Oeste', 'Ouest'),
  'tft.filter.asia':       t6('Asien', 'Asia', '\uC544\uC2DC\uC544', '\u4E9A\u6D32', 'Asia', 'Asie'),
  'tft.filter.allRanks':   t6('Alle R\u00E4nge', 'All ranks', '\uBAA8\uB4E0 \uB7AD\uD06C', '\u6240\u6709\u6BB5\u4F4D', 'Todos los rangos', 'Tous les rangs'),
  'tft.filter.masterPlus': t6('Master+', 'Master+', '\uB9C8\uC2A4\uD130+', '\u5927\u5E08+', 'Maestro+', 'Ma\u00EEtre+'),
  'tft.counters': t6('Konter', 'Counters', '\uCE74\uC6B4\uD130', '\u514B\u5236', 'Counters', 'Counters'),
  'tft.beatsBy': t6('schl\u00E4gt mit', 'beats by', '\uC2B9\uB960', '\u80DC\u7387', 'gana con', 'bat avec'),
  'tft.noDataYet': t6('Noch keine Daten \u2014 der erste Crawl l\u00E4uft Samstag.', 'No data yet \u2014 first crawl runs on Saturday.', '\uC544\uC9C1 \uB370\uC774\uD130 \uC5C6\uC74C \u2014 \uCCAB \uD06C\uB864\uC740 \uD1A0\uC694\uC77C\uC5D0 \uC2E4\uD589\uB429\uB2C8\uB2E4.', '\u6682\u65E0\u6570\u636E \u2014 \u9996\u6B21\u6293\u53D6\u5C06\u4E8E\u5468\u516D\u8FD0\u884C\u3002', 'A\u00FAn sin datos \u2014 primera recolecci\u00F3n el s\u00E1bado.', 'Pas encore de donn\u00E9es \u2014 premi\u00E8re collecte samedi.'),
  'tft.unit.notFound': t6('Unit nicht gefunden', 'Unit not found', '\uC720\uB2DB\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC74C', '\u672A\u627E\u5230\u5355\u4F4D', 'Unidad no encontrada', 'Unit\u00E9 introuvable'),
  'nav.searchPlayer': t6('Spieler suchen', 'Search player', '\uD50C\uB808\uC774\uC5B4 \uAC80\uC0C9', '\u641C\u7D22\u73A9\u5BB6', 'Buscar jugador', 'Rechercher joueur'),
  'nav.champion': t6('Champion', 'Champion', '\uCC54\uD53C\uC5B8', '\u82F1\u96C4', 'Campe\u00F3n', 'Champion'),
  'notFound.title': t6('Seite nicht gefunden', 'Page not found', '\uD398\uC774\uC9C0\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4', '\u9875\u9762\u672A\u627E\u5230', 'P\u00E1gina no encontrada', 'Page introuvable'),
  'notFound.text': t6('Die gesuchte Seite existiert nicht oder wurde verschoben.', 'The page you\'re looking for doesn\'t exist or has been moved.', '\uCC3E\uB294 \uD398\uC774\uC9C0\uAC00 \uC874\uC7AC\uD558\uC9C0 \uC54A\uAC70\uB098 \uC774\uB3D9\uB418\uC5C8\uC2B5\uB2C8\uB2E4.', '\u60A8\u8981\u67E5\u627E\u7684\u9875\u9762\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u79FB\u52A8\u3002', 'La p\u00E1gina que buscas no existe o ha sido movida.', 'La page que vous recherchez n\'existe pas ou a \u00E9t\u00E9 d\u00E9plac\u00E9e.'),
  'notFound.home': t6('Zur Startseite', 'Go to home', '\uD648\uC73C\uB85C', '\u8FD4\u56DE\u9996\u9875', 'Ir al inicio', 'Accueil'),
  'error.crashTitle': t6('Etwas ist schiefgelaufen', 'Something went wrong', '\uBB38\uC81C\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4', '\u51FA\u73B0\u9519\u8BEF', 'Algo sali\u00F3 mal', 'Une erreur est survenue'),
  'error.crashText': t6('Ein unerwarteter Fehler ist aufgetreten. Wir arbeiten daran.', 'An unexpected error occurred. We\'re working on it.', '\uC608\uC0C1\uCE58 \uBABB\uD55C \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4. \uC791\uC5C5 \uC911\uC785\uB2C8\uB2E4.', '\u53D1\u751F\u610F\u5916\u9519\u8BEF\u3002\u6211\u4EEC\u6B63\u5728\u5904\u7406\u3002', 'Ocurri\u00F3 un error inesperado. Estamos trabaj\u00E1ndolo.', 'Une erreur inattendue s\'est produite. Nous y travaillons.'),
  'drawer.viewTournament': t6('Turnier-Tabelle anzeigen', 'View tournament standings', '\uB300\uD68C \uC21C\uC704 \uBCF4\uAE30', '\u67E5\u770B\u8D5B\u4E8B\u6392\u884C\u699C', 'Ver clasificaci\u00F3n', 'Voir classement'),
  'pageTitle.leaderboard': t6('Rangliste', 'Leaderboard', '\uB9AC\uB354\uBCF4\uB4DC', '\u6392\u884C\u699C', 'Clasificaci\u00F3n', 'Classement'),
  'pageTitle.champions': t6('Champions', 'Champions', '\uCC54\uD53C\uC5B8', '\u82F1\u96C4', 'Campeones', 'Champions'),
  'pageTitle.marktwert': t6('Marktwerte', 'Market Values', '\uC2DC\uC7A5 \uAC00\uCE58', '\u5E02\u503C', 'Valores', 'Valeurs'),
  'pageTitle.compare': t6('Spielervergleich', 'Player Comparison', '\uC120\uC218 \uBE44\uAD50', '\u9009\u624B\u5BF9\u6BD4', 'Comparaci\u00F3n', 'Comparaison'),
  'pageTitle.teams': t6('Pro Teams', 'Pro Teams', '\uD504\uB85C\uD300', '\u804C\u4E1A\u6218\u961F', 'Equipos Pro', '\u00C9quipes Pro'),
  'pageTitle.ligen': t6('Ligen & Wettbewerbe', 'Leagues & Competitions', '\uB9AC\uADF8 & \uB300\uD68C', '\u8054\u8D5B & \u6BD4\u8D5B', 'Ligas', 'Ligues'),
  'pageTitle.multiSearch': t6('Multi-Search', 'Multi-Search', '\uBA40\uD2F0 \uAC80\uC0C9', '\u591A\u4EBA\u641C\u7D22', 'Multi-B\u00FAsqueda', 'Multi-Recherche'),
  'error.featureUnavailable': t6(
    'Dieses Feature ist derzeit nicht verf\u00FCgbar. Wir arbeiten daran \u2014 Riot Production-Key ist beantragt.',
    'This feature is currently unavailable. We\'re working on it \u2014 Riot Production Key is pending.',
    '\uC774 \uAE30\uB2A5\uC740 \uD604\uC7AC \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC791\uC5C5 \uC911 \u2014 Riot \uD504\uB85C\uB355\uC158 \uD0A4\uB97C \uB300\uAE30 \uC911\uC785\uB2C8\uB2E4.',
    '\u6B64\u529F\u80FD\u76EE\u524D\u65E0\u6CD5\u4F7F\u7528\u3002\u6B63\u5728\u5904\u7406 \u2014 \u7B49\u5F85Riot\u6B63\u5F0F\u5BC6\u94A5\u3002',
    'Esta funci\u00F3n no est\u00E1 disponible actualmente. Estamos trabajando en ello \u2014 Clave de producci\u00F3n de Riot pendiente.',
    'Cette fonctionnalit\u00E9 est actuellement indisponible. Nous y travaillons \u2014 Cl\u00E9 de production Riot en attente.'
  ),
  'error.retry': t6('Erneut versuchen', 'Retry', '\uB2E4\uC2DC \uC2DC\uB3C4', '\u91CD\u8BD5', 'Reintentar', 'R\u00E9essayer'),

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

  // Role names (DE/EN keep LoL terms, KR/ZH/ES/FR translated per user rule 2026-04-17)
  'role.all': t6('Alle Rollen', 'All Roles', '\uBAA8\uB4E0 \uD3EC\uC9C0\uC158', '\u6240\u6709\u4F4D\u7F6E', 'Todos', 'Tous'),
  'role.top': t6('Top', 'Top', '\uD0D1', '\u4E0A\u8DEF', 'Superior', 'Haut'),
  'role.jungle': t6('Jungle', 'Jungle', '\uC815\uAE00', '\u6253\u91CE', 'Jungla', 'Jungle'),
  'role.mid': t6('Mid', 'Mid', '\uBBF8\uB4DC', '\u4E2D\u8DEF', 'Central', 'Milieu'),
  'role.adc': t6('ADC', 'ADC', '\uC6D0\uB51C', '\u4E0B\u8DEF', 'Tirador', 'Tireur'),
  'role.support': t6('Support', 'Support', '\uC11C\uD3EC\uD130', '\u8F85\u52A9', 'Apoyo', 'Soutien'),

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

  // Champion Builds (op.gg-style per role)
  'champBuild.heading': t6('Builds & Runen', 'Builds & Runes', '\uBE4C\uB4DC \uBC0F \uB8EC', '\u51FA\u88C5\u4E0E\u7B26\u6587', 'Builds y Runas', 'Builds & Runes'),
  'champBuild.runes': t6('Runen', 'Runes', '\uB8EC', '\u7B26\u6587', 'Runas', 'Runes'),
  'champBuild.summoners': t6('Summoner Spells', 'Summoner Spells', '\uC18C\uD658\uC0AC \uC8FC\uBB38', '\u53EC\u5524\u5E08\u6280\u80FD', 'Hechizos', 'Sorts'),
  'champBuild.boots': t6('Schuhe', 'Boots', '\uC2E0\uBC1C', '\u978B\u5B50', 'Botas', 'Bottes'),
  'champBuild.builds': t6('Item Builds', 'Item Builds', '\uC544\uC774\uD15C \uBE4C\uB4DC', '\u88C5\u5907\u51FA\u88C5', 'Builds', 'Builds'),
  'champBuild.items': t6('H\u00E4ufigste Items', 'Most Used Items', '\uAC00\uC7A5 \uB9CE\uC774 \uC0AC\uC6A9\uB41C \uC544\uC774\uD15C', '\u6700\u5E38\u7528\u88C5\u5907', '\u00CDtems m\u00E1s usados', 'Objets les plus utilis\u00E9s'),
  'champBuild.counters': t6('Counters', 'Counters', '\uCE74\uC6B4\uD130', '\u514B\u5236\u82F1\u96C4', 'Counters', 'Counters'),
  'champBuild.strongAgainst': t6('Stark gegen', 'Strong against', '\uAC15\uD55C \uC0C1\uB300', '\u514B\u5236', 'Fuerte contra', 'Fort contre'),
  'champBuild.weakAgainst': t6('Schwach gegen', 'Weak against', '\uC57D\uD55C \uC0C1\uB300', '\u88AB\u514B\u5236', 'D\u00E9bil contra', 'Faible contre'),
  'champBuild.winRate': t6('Win-Rate', 'Win Rate', '\uC2B9\uB960', '\u80DC\u7387', 'Winrate', 'Winrate'),
  'champBuild.pickRate': t6('Pick-Rate', 'Pick Rate', '\uD53D\uB960', '\u9009\u7387', 'Pickrate', 'Pickrate'),
  'champBuild.games': t6('Spiele', 'Games', '\uACBD\uAE30', '\u6BD4\u8D5B', 'Partidas', 'Matchs'),
  'champBuild.statShards': t6('Stat-Shards', 'Stat Shards', '\uB2A5\uB825\uCE58 \uD30C\uD3B8', '\u5C5E\u6027\u788E\u7247', 'Fragmentos', 'Fragments'),
  'champBuild.region': t6('Region', 'Region', '\uC9C0\uC5ED', '\u5730\u533A', 'Regi\u00F3n', 'R\u00E9gion'),
  'champBuild.fromMatches': t6('basierend auf {n} Matches', 'based on {n} matches', '{n}\uAC1C \uACBD\uAE30 \uAE30\uBC18', '\u57FA\u4E8E{n}\u573A\u6BD4\u8D5B', 'basado en {n} partidas', 'd\'apr\u00E8s {n} matchs'),
  'champBuild.role': t6('Rolle', 'Role', '\uD3EC\uC9C0\uC158', '\u4F4D\u7F6E', 'Rol', 'R\u00F4le'),

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

  // Ligen & Wettbewerbe
  'ligen.title1': t6('Ligen', 'Leagues', '\uB9AC\uADF8', '\uC2E0\u8D5B', 'Ligas', 'Ligues'),
  'ligen.title2': t6('& Wettbewerbe', '& Competitions', '& \uB300\uD68C', '& \uC218\u8D5B\u4E8B', '& Competiciones', '& Comp\u00E9titions'),
  'ligen.subtitle': t6('Kalender, Tabellen und Ergebnisse aller LoL Esports Ligen', 'Calendar, standings and results of all LoL Esports leagues', '\uBAA8\uB4E0 LoL e\uC2A4\uD3EC\uCE20 \uB9AC\uADF8\uC758 \uC77C\uC815, \uC21C\uC704 \uBC0F \uACB0\uACFC', '\u6240\u6709LoL\u7535\u7ADE\u8054\u8D5B\u7684\u65E5\u5386\u3001\u6392\u540D\u548C\u7ED3\u679C', 'Calendario, tablas y resultados de todas las ligas de LoL Esports', 'Calendrier, classements et r\u00E9sultats de toutes les ligues LoL Esports'),
  'ligen.back': t6('Zur\u00FCck zur \u00DCbersicht', 'Back to overview', '\uBAA9\uB85D\uC73C\uB85C \uB3CC\uC544\uAC00\uAE30', '\u8FD4\u56DE\u6982\u89C8', 'Volver al resumen', 'Retour \u00E0 l\'aper\u00E7u'),
  'ligen.loadError': t6('Fehler beim Laden der Liga-Daten', 'Error loading league data', '\uB9AC\uADF8 \uB370\uC774\uD130 \uB85C\uB529 \uC624\uB958', '\u52A0\u8F7D\u8054\u8D5B\u6570\u636E\u65F6\u51FA\u9519', 'Error al cargar los datos de la liga', 'Erreur de chargement des donn\u00E9es'),
  'ligen.standings': t6('Tabelle', 'Standings', '\uC21C\uC704', '\u79EF\u5206\u699C', 'Tabla', 'Classement'),
  'ligen.upcoming': t6('Kommend', 'Upcoming', '\uC608\uC815', '\u5373\u5C06\u8FDB\u884C', 'Pr\u00F3ximos', '\u00C0 venir'),
  'ligen.results': t6('Ergebnisse', 'Results', '\uACB0\uACFC', '\u7ED3\u679C', 'Resultados', 'R\u00E9sultats'),
  'ligen.noStandings': t6('Keine Standings verf\u00FCgbar', 'No standings available', '\uC21C\uC704 \uC815\uBCF4 \uC5C6\uC74C', '\u6682\u65E0\u79EF\u5206\u699C', 'No hay clasificaci\u00F3n disponible', 'Pas de classement disponible'),
  'ligen.noUpcoming': t6('Keine kommenden Spiele', 'No upcoming matches', '\uC608\uC815\uB41C \uACBD\uAE30 \uC5C6\uC74C', '\u6682\u65E0\u5373\u5C06\u8FDB\u884C\u7684\u6BD4\u8D5B', 'No hay partidos pr\u00F3ximos', 'Pas de matchs \u00E0 venir'),
  'ligen.noResults': t6('Keine Ergebnisse verf\u00FCgbar', 'No results available', '\uACB0\uACFC \uC5C6\uC74C', '\u6682\u65E0\u7ED3\u679C', 'No hay resultados disponibles', 'Pas de r\u00E9sultats disponibles'),
  'ligen.allLeagues': t6('Alle Ligen', 'All Leagues', '\uBAA8\uB4E0 \uB9AC\uADF8', '\u6240\u6709\u8054\u8D5B', 'Todas las Ligas', 'Toutes les Ligues'),
  'ligen.record': t6('Bilanz', 'Record', '\uC804\uC801', '\u6218\u7EE9', 'Balance', 'Bilan'),

  // Calendar
  'cal.week': t6('Woche', 'Week', '\uC8FC\uAC04', '\u5468', 'Semana', 'Semaine'),
  'cal.month': t6('Monat', 'Month', '\uC6D4\uAC04', '\u6708', 'Mes', 'Mois'),
  'cal.today': t6('Heute', 'Today', '\uC624\uB298', '\u4ECA\u5929', 'Hoy', 'Aujourd\'hui'),

  // SideDrawer
  'drawer.close': t6('Men\u00FC schlie\u00DFen', 'Close menu', '\uBA54\uB274 \uB2EB\uAE30', '\u5173\u95ED\u83DC\u5355', 'Cerrar men\u00FA', 'Fermer le menu'),
  'drawer.open': t6('Patch Notes & Turniere', 'Patch Notes & Tournaments', '\uD328\uCE58 \uB178\uD2B8 & \uB300\uD68C', '\u8865\u4E01\u8BF4\u660E\u548C\u8D5B\u4E8B', 'Notas de parche y Torneos', 'Notes de patch & Tournois'),
  'drawer.tournaments': t6('Turniere', 'Tournaments', '\uB300\uD68C', '\u8D5B\u4E8B', 'Torneos', 'Tournois'),
  'drawer.patchNotes': t6('Patch Notes', 'Patch Notes', '\uD328\uCE58 \uB178\uD2B8', '\u8865\u4E01\u8BF4\u660E', 'Notas de parche', 'Notes de patch'),
  'drawer.all': t6('Alle', 'All', '\uC804\uCCB4', '\u5168\u90E8', 'Todos', 'Tous'),
  'drawer.live': t6('Live', 'Live', '\uB77C\uC774\uBE0C', '\u76F4\u64AD', 'En vivo', 'En direct'),
  'drawer.planned': t6('Geplant', 'Scheduled', '\uC608\uC815', '\u5DF2\u5B89\u6392', 'Programados', 'Planifi\u00E9'),
  'drawer.allLeagues': t6('Alle Ligen', 'All Leagues', '\uBAA8\uB4E0 \uB9AC\uADF8', '\u6240\u6709\u8054\u8D5B', 'Todas las Ligas', 'Toutes les Ligues'),
  'drawer.noMatches': t6('Keine Matches gefunden', 'No matches found', '\uACBD\uAE30\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4', '\u672A\u627E\u5230\u6BD4\u8D5B', 'No se encontraron partidos', 'Aucun match trouv\u00E9'),
  'drawer.current': t6('Aktuell', 'Current', '\uCD5C\uC2E0', '\u6700\u65B0', 'Actual', 'Actuel'),
  'drawer.officialNotes': t6('Offizielle Patch Notes', 'Official Patch Notes', '\uACF5\uC2DD \uD328\uCE58 \uB178\uD2B8', '\u5B98\u65B9\u8865\u4E01\u8BF4\u660E', 'Notas de parche oficiales', 'Notes de patch officielles'),

  // AI Coach
  'coach.analyzing': t6('Analysiere...', 'Analyzing...', '\uBD84\uC11D \uC911...', '\u5206\u6790\u4E2D...', 'Analizando...', 'Analyse en cours...'),
  'coach.gamesAnalyzed': t6('Spiele analysiert', 'games analyzed', '\uACBD\uAE30 \uBD84\uC11D \uC644\uB8CC', '\u573A\u6BD4\u8D5B\u5DF2\u5206\u6790', 'partidas analizadas', 'matchs analys\u00E9s'),
  'coach.improvement': t6('Verbesserungspotenzial', 'Improvement Potential', '\uAC1C\uC120 \uAC00\uB2A5\uC131', '\u63D0\u5347\u6F5C\u529B', 'Potencial de mejora', 'Potentiel d\'am\u00E9lioration'),
  'coach.comparedWith': t6('Verglichen mit anderen', 'Compared with other', '\uB2E4\uB978', '\u4E0E\u5176\u4ED6', 'Comparado con otros', 'Compar\u00E9 aux autres'),
  'coach.playersRole': t6('-Spielern \u00B7 Rolle:', ' players \u00B7 Role:', ' \uD50C\uB808\uC774\uC5B4 \uBE44\uAD50 \u00B7 \uC5ED\uD560:', '\u73A9\u5BB6\u6BD4\u8F83 \u00B7 \u4F4D\u7F6E:', ' jugadores \u00B7 Rol:', ' joueurs \u00B7 R\u00F4le :'),
  'coach.strengths': t6('St\u00E4rken', 'Strengths', '\uAC15\uC810', '\u4F18\u52BF', 'Fortalezas', 'Forces'),
  'coach.weaknesses': t6('Schw\u00E4chen', 'Weaknesses', '\uC57D\uC810', '\u5F31\u70B9', 'Debilidades', 'Faiblesses'),
  'coach.tips': t6('Tipps', 'Tips', '\uD301', '\u5EFA\u8BAE', 'Consejos', 'Conseils'),

  // Market Intelligence
  'mi.title': t6('Market Intelligence', 'Market Intelligence', '\uB9C8\uCF13 \uC778\uD154\uB9AC\uC804\uC2A4', '\u5E02\u573A\u60C5\u62A5', 'Inteligencia de Mercado', 'Intelligence de March\u00E9'),
  'mi.subtitle': t6('Transfer-Predictions & Anomaly-Detection', 'Transfer Predictions & Anomaly Detection', '\uC774\uC801 \uC608\uCE21 & \uC774\uC0C1 \uAC10\uC9C0', '\u8F6C\u4F1A\u9884\u6D4B\u4E0E\u5F02\u5E38\u68C0\u6D4B', 'Predicciones de Transferencias y Anomal\u00EDas', 'Pr\u00E9dictions de Transferts & Anomalies'),
  'mi.transferRadar': t6('Transfer-Radar', 'Transfer Radar', '\uC774\uC801 \uB808\uC774\uB354', '\u8F6C\u4F1A\u96F7\u8FBE', 'Radar de Transferencias', 'Radar de Transferts'),
  'mi.anomalies': t6('Anomalien', 'Anomalies', '\uC774\uC0C1 \uC9D5\uD6C4', '\u5F02\u5E38', 'Anomal\u00EDas', 'Anomalies'),
  'mi.noTransfers': t6('Keine Transfer-Predictions verf\u00FCgbar', 'No transfer predictions available', '\uC774\uC801 \uC608\uCE21 \uC5C6\uC74C', '\u6682\u65E0\u8F6C\u4F1A\u9884\u6D4B', 'No hay predicciones de transferencias', 'Pas de pr\u00E9dictions de transfert'),
  'mi.upgrade': t6('Aufstieg', 'Upgrade', '\uC0C1\uD5A5', '\u4E0A\u5347', 'Ascenso', 'Promotion'),
  'mi.lateral': t6('Lateral', 'Lateral', '\uC218\uD3C9', '\u5E73\u884C', 'Lateral', 'Lat\u00E9ral'),
  'mi.downgrade': t6('Abstieg', 'Downgrade', '\uD558\uD5A5', '\u4E0B\u964D', 'Descenso', 'Descente'),
  'mi.transferProb': t6('Wechselwahrscheinlichkeit', 'Transfer Probability', '\uC774\uC801 \uD655\uB960', '\u8F6C\u4F1A\u6982\u7387', 'Probabilidad de traspaso', 'Probabilit\u00E9 de transfert'),
  'mi.teamPlace': t6('Team-Platz', 'Team Place', '\uD300 \uC21C\uC704', '\u961F\u4F0D\u6392\u540D', 'Puesto del equipo', 'Place de l\'\u00E9quipe'),
  'mi.contractUntil': t6('Vertrag bis', 'Contract until', '\uACC4\uC57D \uB9CC\uB8CC', '\u5408\u540C\u5230\u671F', 'Contrato hasta', 'Contrat jusqu\'au'),
  'mi.noAnomalies': t6('Keine Anomalien erkannt', 'No anomalies detected', '\uC774\uC0C1 \uAC10\uC9C0 \uC5C6\uC74C', '\u672A\u68C0\u6D4B\u5230\u5F02\u5E38', 'No se detectaron anomal\u00EDas', 'Aucune anomalie d\u00E9tect\u00E9e'),
  'mi.notable': t6('Auff\u00E4llig', 'Notable', '\uC8FC\uBAA9', '\u663E\u8457', 'Notable', 'Notable'),

  // Team Synergy
  'synergy.title': t6('Team Synergy', 'Team Synergy', '\uD300 \uC2DC\uB108\uC9C0', '\u56E2\u961F\u534F\u540C', 'Sinergia del Equipo', 'Synergie d\'\u00C9quipe'),
  'synergy.analyze': t6('Synergy-Analyse', 'Synergy Analysis', '\uC2DC\uB108\uC9C0 \uBD84\uC11D', '\u534F\u540C\u5206\u6790', 'An\u00E1lisis de Sinergia', 'Analyse de Synergie'),
  'synergy.titleRate': t6('Titelquote', 'Title Rate', '\uC6B0\uC2B9 \uBE44\uC728', '\u51A0\u519B\u7387', 'Tasa de T\u00EDtulos', 'Taux de Titres'),
  'synergy.experience': t6('Erfahrung', 'Experience', '\uACBD\uD5D8', '\u7ECF\u9A8C', 'Experiencia', 'Exp\u00E9rience'),
  'synergy.competition': t6('Wettbewerb', 'Competition', '\uACBD\uC7C1', '\u7ADE\u4E89', 'Competici\u00F3n', 'Comp\u00E9tition'),
  'synergy.region': t6('Region', 'Region', '\uC9C0\uC5ED', '\u5730\u533A', 'Regi\u00F3n', 'R\u00E9gion'),

  // Compare additional
  'compare.player1': t6('Spieler 1', 'Player 1', '\uD50C\uB808\uC774\uC5B4 1', '\u73A9\u5BB61', 'Jugador 1', 'Joueur 1'),
  'compare.player2': t6('Spieler 2', 'Player 2', '\uD50C\uB808\uC774\uC5B4 2', '\u73A9\u5BB62', 'Jugador 2', 'Joueur 2'),
  'compare.notFound': t6('Nicht gefunden', 'Not found', '\uCC3E\uC744 \uC218 \uC5C6\uC74C', '\u672A\u627E\u5230', 'No encontrado', 'Non trouv\u00E9'),
  'compare.enterBoth': t6('Bitte beide Spielernamen eingeben', 'Please enter both player names', '\uB450 \uD50C\uB808\uC774\uC5B4 \uC774\uB984\uC744 \uBAA8\uB450 \uC785\uB825\uD558\uC138\uC694', '\u8BF7\u8F93\u5165\u4E24\u4E2A\u73A9\u5BB6\u540D\u79F0', 'Introduce ambos nombres', 'Veuillez entrer les deux noms'),
  'compare.topChampions': t6('Top Champions', 'Top Champions', '\uD0D1 \uCC54\uD53C\uC5B8', '\u6700\u4F73\u82F1\u96C4', 'Top Campeones', 'Top Champions'),
  'compare.placeholder': t6('Spieler1#EUW\nSpieler2#EUW\nSpieler3#EUW', 'Player1#EUW\nPlayer2#EUW\nPlayer3#EUW', '\uD50C\uB808\uC774\uC5B41#KR1\n\uD50C\uB808\uC774\uC5B42#KR1\n\uD50C\uB808\uC774\uC5B43#KR1', '\u73A9\u5BB61#KR\n\u73A9\u5BB62#KR\n\u73A9\u5BB63#KR', 'Jugador1#EUW\nJugador2#EUW\nJugador3#EUW', 'Joueur1#EUW\nJoueur2#EUW\nJoueur3#EUW'),

  // Market Value Scale descriptions
  'mv.scaleChallenger': t6('#1 bekommt den H\u00F6chstwert, Top 10 ab $200k', '#1 gets highest value, Top 10 from $200k', '#1\uC774 \uCD5C\uACE0\uAC12, \uC0C1\uC704 10\uBA85 $200k \uC774\uC0C1', '#1\u83B7\u6700\u9AD8\u4EF7\u503C\uFF0C\u524D10\u540D$200k\u8D77', '#1 obtiene el valor m\u00E1ximo, Top 10 desde $200k', '#1 obtient la valeur max, Top 10 \u00E0 partir de $200k'),
  'mv.scaleGrandmaster': t6('Skaliert linear mit LP (bis 400 LP)', 'Scales linearly with LP (up to 400 LP)', 'LP\uC5D0 \uB530\uB77C \uC120\uD615 \uC870\uC815 (\uCD5C\uB300 400 LP)', '\u968FLP\u7EBF\u6027\u589E\u957F\uFF08\u6700\u9AD8400 LP\uFF09', 'Escala linealmente con LP (hasta 400 LP)', '\u00C9chelle lin\u00E9aire avec LP (jusqu\'\u00E0 400 LP)'),
  'mv.scaleMaster': t6('Skaliert linear mit LP (bis 200 LP)', 'Scales linearly with LP (up to 200 LP)', 'LP\uC5D0 \uB530\uB77C \uC120\uD615 \uC870\uC815 (\uCD5C\uB300 200 LP)', '\u968FLP\u7EBF\u6027\u589E\u957F\uFF08\u6700\u9AD8200 LP\uFF09', 'Escala linealmente con LP (hasta 200 LP)', '\u00C9chelle lin\u00E9aire avec LP (jusqu\'\u00E0 200 LP)'),
  'mv.scaleDiamond': t6('Diamond IV ($10) bis Diamond I ($2.000)', 'Diamond IV ($10) to Diamond I ($2,000)', '\uB2E4\uC774\uC544\uBABD\uB4DC IV ($10)\uBD80\uD130 \uB2E4\uC774\uC544\uBABD\uB4DC I ($2,000)', '\u94BB\u77F3IV ($10) \u81F3 \u94BB\u77F3I ($2,000)', 'Diamante IV ($10) a Diamante I ($2.000)', 'Diamant IV ($10) \u00E0 Diamant I ($2.000)'),

  // Champions additional
  'champ.noDataFor': t6('F\u00FCr', 'For', '', '', 'Para', 'Pour'),
  'champ.noDataAvailable': t6('sind derzeit noch keine Daten vorhanden. Die aktuellen Statistiken basieren auf Challenger + Grandmaster Matches.', 'no data is currently available. Current statistics are based on Challenger + Grandmaster matches.', '\uC5D0 \uB300\uD55C \uB370\uC774\uD130\uAC00 \uC544\uC9C1 \uC5C6\uC2B5\uB2C8\uB2E4. \uD604\uC7AC \uD1B5\uACC4\uB294 \uCC4C\uB9B0\uC800 + \uADF8\uB79C\uB4DC\uB9C8\uC2A4\uD130 \uB9E4\uCE58 \uAE30\uC900\uC785\uB2C8\uB2E4.', '\u76EE\u524D\u6CA1\u6709\u6570\u636E\u3002\u5F53\u524D\u7EDF\u8BA1\u57FA\u4E8E\u6700\u5F3A\u738B\u8005+\u5B97\u5E08\u5BF9\u5C40\u3002', 'actualmente no tiene datos. Las estad\u00EDsticas actuales se basan en partidas Aspirante + Gran Maestro.', 'n\'a actuellement pas de donn\u00E9es. Les stats sont bas\u00E9es sur les matchs Challenger + Grand Ma\u00EEtre.'),
  'champ.loadFromApi': t6('Lade Champion-Statistiken von Riot API', 'Loading champion statistics from Riot API', 'Riot API\uC5D0\uC11C \uCC54\uD53C\uC5B8 \uD1B5\uACC4 \uB85C\uB529 \uC911', '\u4ECERiot API\u52A0\u8F7D\u82F1\u96C4\u7EDF\u8BA1\u6570\u636E', 'Cargando estad\u00EDsticas de campeones de Riot API', 'Chargement des stats depuis l\'API Riot'),
  'champ.loadNow': t6('Jetzt laden', 'Load now', '\uC9C0\uAE08 \uB85C\uB529', '\u7ACB\u5373\u52A0\u8F7D', 'Cargar ahora', 'Charger maintenant'),
  'champ.regionLabel': t6('Region', 'Region', '\uC9C0\uC5ED', '\u5730\u533A', 'Regi\u00F3n', 'R\u00E9gion'),

  // Homepage additional
  'home.topChampions': t6('Meistgespielte Champions (Challenger + GM + Master)', 'Most Played Champions (Challenger + GM + Master)', '\uCD5C\uB2E4 \uD50C\uB808\uC774 \uCC54\uD53C\uC5B8 (\uCC4C\uB9B0\uC800 + GM + \uB9C8\uC2A4\uD130)', '\u6700\u5E38\u4F7F\u7528\u82F1\u96C4\uFF08\u6700\u5F3A\u738B\u8005+\u5B97\u5E08+\u5927\u5E08\uFF09', 'Campeones m\u00E1s jugados (Aspirante + GM + Maestro)', 'Champions les plus jou\u00E9s (Challenger + GM + Ma\u00EEtre)'),
  'home.verifiedRosters': t6('Verifizierte Roster', 'Verified Rosters', '\uC778\uC99D\uB41C \uB85C\uC2A4\uD130', '\u5DF2\u9A8C\u8BC1\u9635\u5BB9', 'Plantillas verificadas', 'Effectifs v\u00E9rifi\u00E9s'),
  'home.allLeagues': t6('Alle Ligen weltweit', 'All leagues worldwide', '\uC804 \uC138\uACC4 \uBAA8\uB4E0 \uB9AC\uADF8', '\u5168\u7403\u6240\u6709\u8054\u8D5B', 'Todas las ligas del mundo', 'Toutes les ligues du monde'),
  'home.proPlayers': t6('Pro-Spieler', 'Pro Players', '\uD504\uB85C \uC120\uC218', '\u804C\u4E1A\u9009\u624B', 'Jugadores Pro', 'Joueurs Pro'),

  // Match Detail
  'match.player': t6('Spieler', 'Player', '\uD50C\uB808\uC774\uC5B4', '\u73A9\u5BB6', 'Jugador', 'Joueur'),
  'match.damage': t6('Schaden', 'Damage', '\uD53C\uD574\uB7C9', '\u4F24\u5BB3', 'Da\u00F1o', 'D\u00E9g\u00E2ts'),
  'match.damageDealt': t6('Schaden verursacht', 'Damage Dealt', '\uAC00\uD55C \uD53C\uD574', '\u9020\u6210\u4F24\u5BB3', 'Da\u00F1o causado', 'D\u00E9g\u00E2ts inflig\u00E9s'),
  'match.damageTaken': t6('Schaden erlitten', 'Damage Taken', '\uBC1B\uC740 \uD53C\uD574', '\u627F\u53D7\u4F24\u5BB3', 'Da\u00F1o recibido', 'D\u00E9g\u00E2ts subis'),
  'match.win': t6('Sieg', 'Victory', '\uC2B9\uB9AC', '\u80DC\u5229', 'Victoria', 'Victoire'),
  'match.loss': t6('Niederlage', 'Defeat', '\uD328\uBC30', '\u5931\u8D25', 'Derrota', 'D\u00E9faite'),
  'match.dmgShare': t6('DMG-Anteil', 'DMG Share', '\uD53C\uD574 \uBE44\uC728', '\u4F24\u5BB3\u5360\u6BD4', 'Cuota DMG', 'Part DMG'),
  'match.goldShare': t6('Gold-Anteil', 'Gold Share', '\uACE8\uB4DC \uBE44\uC728', '\u91D1\u5E01\u5360\u6BD4', 'Cuota Oro', 'Part Or'),
  'match.soloKills': t6('Solo Kills', 'Solo Kills', '\uC194\uB85C \uD0AC', '\u5355\u6740', 'Asesinatos en solitario', 'Kills en solo'),
  'match.wards': t6('Wards', 'Wards', '\uC640\uB4DC', '\u5B88\u536B', 'Guardianes', 'Balises'),
  'match.ctrlWards': t6('Ctrl Wards', 'Ctrl Wards', '\uC81C\uC5B4 \uC640\uB4DC', '\u63A7\u536B', 'Guardianes de control', 'Balises de contr\u00F4le'),
  'match.firstBlood': t6('First Blood', 'First Blood', '\uC120\uCDE8\uC810', '\u4E00\u8840', 'Primera sangre', 'Premier sang'),
  'match.double': t6('Double', 'Double', '\uB354\uBE14\uD0AC', '\u53CC\u6740', 'Doble', 'Double'),
  'match.triple': t6('Triple', 'Triple', '\uD2B8\uB9AC\uD50C\uD0AC', '\u4E09\u6740', 'Triple', 'Triple'),
  'match.quadra': t6('Quadra', 'Quadra', '\uCFFC\uB4DC\uB77C\uD0AC', '\u56DB\u6740', 'Cu\u00E1druple', 'Quadra'),
  'match.turrets': t6('Turrets', 'Turrets', '\uD0C0\uC6CC', '\u9632\u5FA1\u5854', 'Torretas', 'Tourelles'),

  // Radar Profile
  'radar.title': t6('Spieler-Profil', 'Player Profile', '\uD50C\uB808\uC774\uC5B4 \uD504\uB85C\uD544', '\u73A9\u5BB6\u8D44\u6599', 'Perfil del Jugador', 'Profil du Joueur'),
  'radar.subtitle': t6('St\u00E4rken-Analyse basierend auf den letzten Spielen', 'Strength analysis based on recent games', '\uCD5C\uADFC \uACBD\uAE30 \uAE30\uBC18 \uAC15\uC810 \uBD84\uC11D', '\u57FA\u4E8E\u8FD1\u671F\u6BD4\u8D5B\u7684\u4F18\u52BF\u5206\u6790', 'An\u00E1lisis de fortalezas reciente', 'Analyse des forces r\u00E9centes'),
  'radar.fighting': t6('K\u00E4mpfen', 'Fighting', '\uC804\uD22C', '\u6218\u6597', 'Combate', 'Combat'),
  'radar.farming': t6('Farmen', 'Farming', '\uD30C\uBC0D', '\u53D1\u80B2', 'Farmeo', 'Farming'),
  'radar.vision': t6('Sicht', 'Vision', '\uC2DC\uC57C', '\u89C6\u91CE', 'Visi\u00F3n', 'Vision'),
  'radar.objectives': t6('Objectives', 'Objectives', '\uC624\uBE0C\uC81D\uD2B8', '\u8D44\u6E90\u70B9', 'Objetivos', 'Objectifs'),
  'radar.survival': t6('\u00DCberleben', 'Survival', '\uC0DD\uC874', '\u751F\u5B58', 'Supervivencia', 'Survie'),
  'radar.teamplay': t6('Teamplay', 'Teamplay', '\uD300\uD50C\uB808\uC774', '\u56E2\u961F\u914D\u5408', 'Juego en equipo', 'Jeu d\'\u00E9quipe'),

  // Leaderboard additional
  'lb.unknownPlayer': t6('Spieler', 'Player', '\uD50C\uB808\uC774\uC5B4', '\u73A9\u5BB6', 'Jugador', 'Joueur'),

  // Prototype Banner
  'banner.label': t6('Prototyp-Phase', 'Prototype Phase', '\uD504\uB85C\uD1A0\uD0C0\uC785 \uB2E8\uACC4', '\u539F\u578B\u9636\u6BB5', 'Fase Prototipo', 'Phase Prototype'),
  'banner.text': t6(
    'Die KI wird gerade trainiert und lernt aus den gesammelten Daten.',
    'The AI is currently being trained and learning from collected data.',
    'AI\uAC00 \uD604\uC7AC \uD559\uC2B5 \uC911\uC774\uBA70 \uC218\uC9D1\uB41C \uB370\uC774\uD130\uB85C \uD6C8\uB828\uB418\uACE0 \uC788\uC2B5\uB2C8\uB2E4.',
    'AI\u6B63\u5728\u63A5\u53D7\u8BAD\u7EC3\u5E76\u4ECE\u6536\u96C6\u7684\u6570\u636E\u4E2D\u5B66\u4E60\u3002',
    'La IA se est\u00E1 entrenando y aprendiendo de los datos recopilados.',
    'L\'IA est actuellement en apprentissage \u00E0 partir des donn\u00E9es collect\u00E9es.'
  ),
  'banner.subtext': t6(
    'Features, Daten und Design k\u00F6nnen sich jederzeit \u00E4ndern.',
    'Features, data and design may change at any time.',
    '\uAE30\uB2A5, \uB370\uC774\uD130 \uBC0F \uB514\uC790\uC778\uC740 \uC5B8\uC81C\uB4E0\uC9C0 \uBCC0\uACBD\uB420 \uC218 \uC788\uC2B5\uB2C8\uB2E4.',
    '\u529F\u80FD\u3001\u6570\u636E\u548C\u8BBE\u8BA1\u53EF\u80FD\u968F\u65F6\u66F4\u6539\u3002',
    'Las funciones, datos y dise\u00F1o pueden cambiar en cualquier momento.',
    'Les fonctionnalit\u00E9s, donn\u00E9es et le design peuvent changer \u00E0 tout moment.'
  ),
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

export const LANG_COOKIE = 'metastats-lang';

export function I18nProvider({ children, initialLang = 'de' }: { children: ReactNode; initialLang?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    // Keep <html lang="..."> in sync with current language (SEO + screen readers)
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  useEffect(() => {
    // On first mount, reconcile with localStorage in case cookie was missing/stale
    try {
      const saved = localStorage.getItem(LANG_COOKIE) as Lang | null;
      if (saved && LANGUAGES.some(l => l.code === saved) && saved !== lang) {
        setLangState(saved);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(LANG_COOKIE, l); } catch {}
    // Persist as cookie so SSR can read it on next request
    if (typeof document !== 'undefined') {
      document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    }
  };

  const t = (key: TranslationKey): string => {
    return translations[key]?.[lang] || translations[key]?.en || key;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
