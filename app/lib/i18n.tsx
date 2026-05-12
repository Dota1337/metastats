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
  'tft.bucket.emerald': t6('Smaragd', 'Emerald', '\uC5D0\uBA54\uB784\uB4DC', '\u7FE1\u7FE0', 'Esmeralda', '\u00C9meraude'),
  'tft.bucket.platinum': t6('Platin', 'Platinum', '\uD50C\uB798\uD2F0\uB118', '\u94C2\u91D1', 'Platino', 'Platine'),
  'tft.bucket.gold': t6('Gold', 'Gold', '\uACE8\uB4DC', '\u9EC4\u91D1', 'Oro', 'Or'),
  'tft.bucket.silver': t6('Silber', 'Silver', '\uC2E4\uBC84', '\u767D\u94F6', 'Plata', 'Argent'),
  'tft.bucket.bronze': t6('Bronze', 'Bronze', '\uBE0C\uB860\uC988', '\u9752\u94DC', 'Bronce', 'Bronze'),
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
  'tft.gameStyle':              t6('Spielweise', 'Play style', '\uD50C\uB808\uC774 \uC2A4\uD0C0\uC77C', '\u73A9\u6CD5\u98CE\u683C', 'Estilo de juego', 'Style de jeu'),
  'tft.tempo':                  t6('Tempo', 'Tempo', '\uD15C\uD3EC', '\u8282\u594F', 'Tempo', 'Tempo'),
  'tft.aggression':             t6('Aggression', 'Aggression', '\uACF5\uACA9\uC131', '\u653B\u51FB\u6027', 'Agresi\u00F3n', 'Agressivit\u00E9'),
  'tft.survival':               t6('\u00DCberleben', 'Survival', '\uC0DD\uC874', '\u751F\u5B58', 'Supervivencia', 'Survie'),
  'tft.consistency':            t6('Konsistenz', 'Consistency', '\uC77C\uAD00\uC131', '\u7A33\u5B9A\u6027', 'Consistencia', 'R\u00E9gularit\u00E9'),
  'tft.damage':                 t6('Schaden', 'Damage', '\uD53C\uD574\uB7C9', '\u4F24\u5BB3', 'Da\u00F1o', 'D\u00E9g\u00E2ts'),
  'tft.placementDistribution':  t6('Platzierungsverteilung', 'Placement distribution', '\uC21C\uC704 \uBD84\uD3EC', '\u540D\u6B21\u5206\u5E03', 'Distribuci\u00F3n de posiciones', 'Distribution des places'),
  'tft.avgLevel':               t6('\u00D8 Level', 'Avg level', '\uD3C9\uADE0 \uB808\uBCA8', '\u5E73\u5747\u7B49\u7EA7', 'Nivel medio', 'Niveau moy.'),
  'tft.avgGoldLeft':            t6('\u00D8 Restgold', 'Avg gold left', '\uD3C9\uADE0 \uC794\uC5EC \uACE8\uB4DC', '\u5E73\u5747\u5269\u4F59\u91D1\u5E01', 'Oro medio restante', 'Or restant moy.'),
  'tft.avgEliminations':        t6('\u00D8 Eliminierungen', 'Avg eliminations', '\uD3C9\uADE0 \uCC98\uCE58', '\u5E73\u5747\u6DD8\u6C70', 'Eliminaciones medias', '\u00C9liminations moy.'),
  'tft.avgDamage':              t6('\u00D8 Schaden', 'Avg damage', '\uD3C9\uADE0 \uD53C\uD574\uB7C9', '\u5E73\u5747\u4F24\u5BB3', 'Da\u00F1o medio', 'D\u00E9g\u00E2ts moy.'),
  'tft.avgLastRound':           t6('\u00D8 Endrunde', 'Avg final round', '\uD3C9\uADE0 \uB9C8\uC9C0\uB9C9 \uB77C\uC6B4\uB4DC', '\u5E73\u5747\u6700\u7EC8\u56DE\u5408', '\u00DAltima ronda media', 'Tour final moy.'),
  'tft.topUnitsPlayed':         t6('Meist-gespielte Units', 'Most-played units', '\uAC00\uC7A5 \uB9CE\uC774 \uD50C\uB808\uC774\uD55C \uC720\uB2DB', '\u6700\u5E38\u7528\u5355\u4F4D', 'Unidades m\u00E1s jugadas', 'Unit\u00E9s les plus jou\u00E9es'),
  'tft.favoriteAugments':       t6('Lieblings-Augments', 'Favorite augments', '\uC120\uD638 \uC99D\uAC15', '\u5E38\u7528\u5F3A\u5316\u7B26\u6587', 'Aumentos favoritos', 'Augments pr\u00E9f\u00E9r\u00E9s'),
  'tft.placementOrdinal':       t6('Platz', 'Place', '\uC704', '\u540D', 'Lugar', 'Place'),
  'tft.matches':                t6('Matches', 'Matches', '\uACBD\uAE30', '\u573A\u6B21', 'Partidas', 'Matchs'),
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

  // \u2500 Marktwert / TFT player marketvalue hero \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'tft.marketValue': t6(
    'Marktwert', 'Market Value',
    '\uC2DC\uC7A5 \uAC00\uCE58', '\u5E02\u573A\u4EF7\u503C',
    'Valor de Mercado', 'Valeur March\u00E9'
  ),
  'tft.marketValue.belowMaster': t6(
    'Marktwert ab Master+ verf\u00FCgbar.',
    'Market value available from Master+ upward.',
    'Master+ \uBD80\uD130 \uC774\uC6A9 \uAC00\uB2A5\uD55C \uC2DC\uC7A5 \uAC00\uCE58\uC785\uB2C8\uB2E4.',
    '\u5E02\u573A\u4EF7\u503C\u4ECE Master+ \u8D77\u63D0\u4F9B\u3002',
    'Valor de mercado disponible desde Master+.',
    'Valeur de march\u00E9 disponible \u00E0 partir de Master+.'
  ),
  'tft.marketValue.notRated': t6(
    'Noch nicht bewertet.',
    'Not rated yet.',
    '\uC544\uC9C1 \uD3C9\uAC00\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.',
    '\u5C1A\u672A\u8BC4\u4F30\u3002',
    'A\u00FAn no evaluado.',
    'Pas encore \u00E9valu\u00E9.'
  ),
  'tft.marketValue.notEnoughHistory': t6(
    'Noch nicht genug Historie',
    'Not enough history yet',
    '\uC544\uC9C1 \uCDA9\uBD84\uD55C \uC774\uB825\uC774 \uC5C6\uC2B5\uB2C8\uB2E4',
    '\u5386\u53F2\u6570\u636E\u4E0D\u8DB3',
    'A\u00FAn no hay suficiente historial',
    'Pas encore assez d\'historique'
  ),
  'tft.marketValue.last7d': t6(
    'letzte 7 Tage', 'last 7 days',
    '\uCD5C\uADFC 7\uC77C', '\u6700\u8FD17\u5929',
    '\u00FAltimos 7 d\u00EDas', '7 derniers jours'
  ),
  'tft.marketValue.last30d': t6(
    'letzte 30 Tage', 'last 30 days',
    '\uCD5C\uADFC 30\uC77C', '\u6700\u8FD130\u5929',
    '\u00FAltimos 30 d\u00EDas', '30 derniers jours'
  ),
  'tft.marketValue.multiplier': t6(
    'Multiplikator', 'Multiplier',
    '\uBC30\uC728', '\u500D\u6570',
    'Multiplicador', 'Multiplicateur'
  ),
  'tft.marketValue.basedOn': t6(
    'aus {n} Spielen', 'from {n} games',
    '{n}\uACBD\uAE30 \uAE30\uBC18', '\u57FA\u4E8E{n}\u573A\u6BD4\u8D5B',
    'de {n} partidas', 'sur {n} matchs'
  ),
  'tft.marketValue.howCalculated': t6(
    'Wie wird das berechnet?', 'How is this calculated?',
    '\uC774\uAC83\uC740 \uC5B4\uB5BB\uAC8C \uACC4\uC0B0\uB418\uB098\uC694?', '\u5982\u4F55\u8BA1\u7B97\uFF1F',
    '\u00BFC\u00F3mo se calcula?', 'Comment est-ce calcul\u00E9 ?'
  ),
  'tft.marketValue.methodologyIntro': t6(
    'Basiswert {base} aus Tier + LP, multipliziert durch:',
    'Base value {base} from tier + LP, multiplied by:',
    '\uD2F0\uC5B4 + LP\uC5D0\uC11C \uC0B0\uCD9C\uD55C \uAE30\uBCF8\uAC12 {base}, \uBC30\uC728 \uC801\uC6A9:',
    '\u57FA\u4E8E\u6BB5\u4F4D+LP\u7684\u57FA\u7840\u4EF7\u503C {base}\uFF0C\u4E58\u4EE5\uFF1A',
    'Valor base {base} de tier + LP, multiplicado por:',
    'Valeur de base {base} \u00E0 partir du tier + LP, multipli\u00E9e par :'
  ),
  'tft.marketValue.snapshotFrom': t6(
    'Snapshot vom {date}', 'Snapshot from {date}',
    '{date} \uC2A4\uB0C5\uC0F7', '{date} \u7684\u5FEB\u7167',
    'Snapshot del {date}', 'Snapshot du {date}'
  ),
  'tft.marketValue.agent.performance': t6(
    'Performance', 'Performance',
    '\uD37C\uD3EC\uBC0D\uC2A4', '\u8868\u73B0',
    'Rendimiento', 'Performance'
  ),
  'tft.marketValue.agent.metaAdaptation': t6(
    'Meta-Anpassung', 'Meta Adaptation',
    '\uBA54\uD0C0 \uC801\uC751', '\u9002\u5E94\u4E3B\u6D41',
    'Adaptaci\u00F3n Meta', 'Adaptation M\u00E9ta'
  ),
  'tft.marketValue.agent.highRoll': t6(
    'High-Roll', 'High Roll',
    '\uD558\uC774\uB864', '\u9AD8\u989D\u6536\u76CA',
    'High-Roll', 'High-Roll'
  ),
  'tft.marketValue.agent.consistency': t6(
    'Konsistenz', 'Consistency',
    '\uC77C\uAD00\uC131', '\u7A33\u5B9A\u6027',
    'Consistencia', 'Constance'
  ),
  'tft.marketValue.agent.noImpact': t6(
    'Kein Einfluss', 'No impact',
    '\uC601\uD5A5 \uC5C6\uC74C', '\u65E0\u5F71\u54CD',
    'Sin impacto', 'Aucun impact'
  ),

  // \u2500 Marktwert Page (Top / Movers / Distribution) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'tft.marketValue.pageHint': t6(
    'Marktwerte ab Master \u00B7 TFT Standard Ranked \u00B7 T\u00E4gliche Snapshots',
    'Market values from Master+ \u00B7 TFT Standard Ranked \u00B7 Daily snapshots',
    'Master+ \uBD80\uD130 \u00B7 TFT \uD45C\uC900 \uB7AD\uD06C \u00B7 \uC77C\uC77C \uC2A4\uB0C5\uC0F7',
    '\u4ECE Master \u8D77 \u00B7 TFT \u6807\u51C6\u6392\u4F4D \u00B7 \u6BCF\u65E5\u5FEB\u7167',
    'Valores desde Master+ \u00B7 TFT Est\u00E1ndar Ranked \u00B7 Snapshots diarios',
    'Valeurs \u00E0 partir de Master+ \u00B7 TFT Standard Ranked \u00B7 Snapshots quotidiens'
  ),
  'tft.marketValue.tab.top': t6(
    'Aktuelle Top-Werte', 'Current Top Values',
    '\uD604\uC7AC \uC0C1\uC704 \uAC00\uCE58', '\u5F53\u524D\u6700\u9AD8\u4EF7\u503C',
    'Mejores Valores Actuales', 'Meilleures valeurs actuelles'
  ),
  'tft.marketValue.tab.movers': t6(
    'Top-Mover', 'Top Movers',
    '\uC0C1\uC2B9/\uD558\uB77D', '\u6DA8\u8DCC\u5E45\u699C',
    'Mayores Cambios', 'Plus grands mouvements'
  ),
  'tft.marketValue.tab.distribution': t6(
    'Verteilung', 'Distribution',
    '\uBD84\uD3EC', '\u5206\u5E03',
    'Distribuci\u00F3n', 'R\u00E9partition'
  ),
  'tft.marketValue.empty': t6(
    'Noch keine Daten f\u00FCr diese Region. T\u00E4gliche Snapshots beginnen mit der n\u00E4chsten Aktualisierung.',
    'No data for this region yet. Daily snapshots start with the next refresh.',
    '\uC774 \uC9C0\uC5ED\uC5D0 \uB300\uD55C \uB370\uC774\uD130\uAC00 \uC544\uC9C1 \uC5C6\uC2B5\uB2C8\uB2E4. \uB2E4\uC74C \uC5C5\uB370\uC774\uD2B8\uBD80\uD130 \uC77C\uC77C \uC2A4\uB0C5\uC0F7\uC774 \uC2DC\uC791\uB429\uB2C8\uB2E4.',
    '\u8BE5\u5730\u533A\u6682\u65E0\u6570\u636E\u3002\u4E0B\u6B21\u5237\u65B0\u540E\u5F00\u59CB\u6BCF\u65E5\u5FEB\u7167\u3002',
    'A\u00FAn no hay datos para esta regi\u00F3n. Los snapshots diarios comienzan con la pr\u00F3xima actualizaci\u00F3n.',
    'Pas encore de donn\u00E9es pour cette r\u00E9gion. Les snapshots quotidiens commencent \u00E0 la prochaine mise \u00E0 jour.'
  ),
  'tft.marketValue.col.player': t6(
    'Spieler', 'Player', '\uD50C\uB808\uC774\uC5B4', '\u73A9\u5BB6', 'Jugador', 'Joueur'
  ),
  'tft.marketValue.col.now': t6(
    'Aktuell', 'Now', '\uD604\uC7AC', '\u5F53\u524D', 'Actual', 'Actuel'
  ),
  'tft.marketValue.movers.gainers': t6(
    'Aufsteiger', 'Gainers',
    '\uC0C1\uC2B9', '\u4E0A\u6DA8',
    'Ganadores', 'Hausses'
  ),
  'tft.marketValue.movers.losers': t6(
    'Absteiger', 'Losers',
    '\uD558\uB77D', '\u4E0B\u8DCC',
    'Perdedores', 'Baisses'
  ),
  'tft.marketValue.movers.notEnoughHistory': t6(
    'Noch nicht genug Snapshot-Historie f\u00FCr diese Zeitspanne. Komm in ein paar Tagen wieder.',
    'Not enough snapshot history for this window yet. Check back in a few days.',
    '\uC774 \uAE30\uAC04\uC5D0 \uB300\uD55C \uC2A4\uB0C5\uC0F7 \uC774\uB825\uC774 \uC544\uC9C1 \uBD80\uC871\uD569\uB2C8\uB2E4. \uBA70\uCE60 \uD6C4\uC5D0 \uB2E4\uC2DC \uD655\uC778\uD574 \uC8FC\uC138\uC694.',
    '\u6B64\u65F6\u95F4\u6BB5\u7684\u5FEB\u7167\u5386\u53F2\u4E0D\u8DB3\u3002\u8BF7\u51E0\u5929\u540E\u518D\u6765\u67E5\u770B\u3002',
    'A\u00FAn no hay suficiente historial de snapshots para este periodo. Vuelve en unos d\u00EDas.',
    'Pas encore assez d\'historique pour cette p\u00E9riode. Revenez dans quelques jours.'
  ),
  'tft.marketValue.distribution.title': t6(
    'Marktwert-Verteilung in der Region',
    'Market value distribution in the region',
    '\uC9C0\uC5ED \uB0B4 \uC2DC\uC7A5 \uAC00\uCE58 \uBD84\uD3EC',
    '\u8BE5\u5730\u533A\u5E02\u573A\u4EF7\u503C\u5206\u5E03',
    'Distribuci\u00F3n de valor de mercado en la regi\u00F3n',
    'Distribution de la valeur de march\u00E9 dans la r\u00E9gion'
  ),
  'tft.marketValue.distribution.basedOn': t6(
    'aus {n} Spielern', 'from {n} players',
    '{n}\uBA85 \uD50C\uB808\uC774\uC5B4', '\u57FA\u4E8E{n}\u540D\u73A9\u5BB6',
    'de {n} jugadores', 'sur {n} joueurs'
  ),
  'tft.marketValue.distribution.players': t6(
    'Spieler', 'Players', '\uD50C\uB808\uC774\uC5B4', '\u73A9\u5BB6', 'Jugadores', 'Joueurs'
  ),
  'tft.marketValue.distribution.xAxisHint': t6(
    '\u20AC-Buckets (Tausend \u20AC)',
    'EUR buckets (thousand \u20AC)',
    'EUR \uAD6C\uAC04 (\uCC9C \u20AC)',
    'EUR \u533A\u95F4 (\u5343\u6B27\u5143)',
    'Buckets en \u20AC (mil \u20AC)',
    'Tranches \u20AC (millier d\'\u20AC)'
  ),

  // \u2500 Match Detail Page \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'tft.match.title': t6(
    'Match-Details', 'Match Details',
    '\uB9E4\uCE58 \uC0C1\uC138', '\u6BD4\u8D5B\u8BE6\u60C5',
    'Detalles del Match', 'D\u00E9tails du match'
  ),
  'tft.match.loading': t6(
    'Lade Match-Daten ...', 'Loading match data ...',
    '\uB9E4\uCE58 \uB370\uC774\uD130 \uB85C\uB529 \uC911 ...', '\u6B63\u5728\u52A0\u8F7D\u6BD4\u8D5B\u6570\u636E...',
    'Cargando datos del match ...', 'Chargement des donn\u00E9es du match ...'
  ),
  'tft.match.notFound': t6(
    'Match nicht gefunden.', 'Match not found.',
    '\uB9E4\uCE58\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.', '\u672A\u627E\u5230\u8BE5\u6BD4\u8D5B\u3002',
    'Match no encontrado.', 'Match introuvable.'
  ),
  'tft.match.date': t6(
    'Datum', 'Date', '\uB0A0\uC9DC', '\u65E5\u671F', 'Fecha', 'Date'
  ),
  'tft.match.length': t6(
    'Spielzeit', 'Length', '\uAC8C\uC784 \uC2DC\uAC04', '\u6BD4\u8D5B\u65F6\u957F', 'Duraci\u00F3n', 'Dur\u00E9e'
  ),
  'tft.match.patch': t6(
    'Patch', 'Patch', '\uD328\uCE58', '\u7248\u672C', 'Parche', 'Patch'
  ),
  'tft.match.eliminated': t6(
    'Kills', 'kills', '\uD0AC', '\u51FB\u6740', 'kills', 'kills'
  ),

  // \u2500 Compare Page \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'tft.compare.player': t6(
    'Spieler', 'Player', '\uD50C\uB808\uC774\uC5B4', '\u73A9\u5BB6', 'Jugador', 'Joueur'
  ),
  'tft.compare.button': t6(
    'Vergleichen', 'Compare',
    '\uBE44\uAD50', '\u6BD4\u8F83',
    'Comparar', 'Comparer'
  ),
  'tft.compare.comparing': t6(
    'Vergleiche ...', 'Comparing ...',
    '\uBE44\uAD50 \uC911 ...', '\u6BD4\u8F83\u4E2D...',
    'Comparando ...', 'Comparaison ...'
  ),
  'tft.compare.chartTitle': t6(
    'Marktwert-Verlauf (30 Tage)',
    'Market Value Trend (30 days)',
    '\uC2DC\uC7A5 \uAC00\uCE58 \uCD94\uC774 (30\uC77C)',
    '\u5E02\u573A\u4EF7\u503C\u8D70\u52BF (30\u5929)',
    'Tendencia de Valor de Mercado (30 d\u00EDas)',
    '\u00C9volution de la valeur de march\u00E9 (30 jours)'
  ),

  // \u2500 Trait Detail Page \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'tft.trait.tiers': t6(
    'Stufen', 'Tiers', '\uB2E8\uACC4', '\u9636\u6BB5', 'Niveles', 'Niveaux'
  ),
  'tft.trait.bestAt': t6(
    'Beste Stufe', 'Best Tier', '\uCD5C\uACE0 \uB2E8\uACC4', '\u6700\u4F73\u9636\u6BB5', 'Mejor Nivel', 'Meilleur Niveau'
  ),
  'tft.trait.statsPerTier': t6(
    'Statistiken pro Stufe', 'Stats Per Tier',
    '\uB2E8\uACC4\uBCC4 \uD1B5\uACC4', '\u9636\u6BB5\u7EDF\u8BA1',
    'Estad\u00EDsticas por Nivel', 'Statistiques par niveau'
  ),
  'tft.trait.bestUnits': t6(
    'Beste Units mit diesem Trait', 'Best Units With This Trait',
    '\uC774 \uC2DC\uB108\uC9C0\uB97C \uAC00\uC9C4 \uCD5C\uACE0 \uC720\uB2DB', '\u62E5\u6709\u6B64\u7F81\u7ECA\u7684\u6700\u4F73\u5355\u4F4D',
    'Mejores Unidades con este Trait', 'Meilleures unit\u00E9s avec ce trait'
  ),
  'tft.trait.noData': t6(
    'Keine Daten zu diesem Trait.', 'No data for this trait.',
    '\uC774 \uC2DC\uB108\uC9C0\uC5D0 \uB300\uD55C \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.', '\u8BE5\u7F81\u7ECA\u6682\u65E0\u6570\u636E\u3002',
    'No hay datos para este trait.', 'Pas de donn\u00E9es pour ce trait.'
  ),
  'tft.loading': t6(
    'L\u00E4dt \u2026', 'Loading \u2026', '\uB85C\uB529 \uC911 \u2026', '\u52A0\u8F7D\u4E2D\u2026', 'Cargando \u2026', 'Chargement \u2026'
  ),
  'tft.avgPlacementShort': t6(
    'Avg', 'Avg', '\uD3C9\uADE0', '\u5E73\u5747', 'Avg', 'Moy.'
  ),

  // \u2500 Comp Detail Page \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'tft.comp.notFound': t6(
    'Comp nicht gefunden.', 'Comp not found.',
    '\uC870\uD569\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.', '\u672A\u627E\u5230\u8BE5\u9635\u5BB9\u3002',
    'Comp no encontrada.', 'Comp introuvable.'
  ),
  'tft.comp.topItemSets': t6(
    'H\u00E4ufigste Item-Sets am Carry', 'Most Common Item Sets on Carry',
    '\uCE90\uB9AC \uCD5C\uB2E4 \uC544\uC774\uD15C \uC138\uD2B8', '\u4E3BC\u6700\u5E38\u7528\u88C5\u5907\u7EC4\u5408',
    'Sets de \u00CDtems m\u00E1s comunes en el Carry', 'Sets d\'objets les plus utilis\u00E9s sur le Carry'
  ),
  'tft.comp.itemSet': t6(
    'Set', 'Set', '\uC138\uD2B8', '\u7EC4\u5408', 'Set', 'Set'
  ),
  'tft.comp.augmentsByStage': t6(
    'Augments nach Stage', 'Augments By Stage',
    '\uC2A4\uD14C\uC774\uC9C0\uBCC4 \uC99D\uAC15\uCCB4', '\u9636\u6BB5\u5F3A\u5316',
    'Aumentos por Etapa', 'Augments par \u00E9tape'
  ),
  'tft.comp.stage': t6(
    'Stage', 'Stage', '\uC2A4\uD14C\uC774\uC9C0', '\u9636\u6BB5', 'Etapa', '\u00C9tape'
  ),
  'tft.comp.noStageData': t6(
    'Keine Daten', 'No data',
    '\uB370\uC774\uD130 \uC5C6\uC74C', '\u65E0\u6570\u636E',
    'Sin datos', 'Aucune donn\u00E9e'
  ),
  'tft.comp.typicalUnits': t6(
    'Typische Units', 'Typical Units',
    '\uC77C\uBC18\uC801\uC778 \uC720\uB2DB', '\u5E38\u7528\u5355\u4F4D',
    'Unidades T\u00EDpicas', 'Unit\u00E9s typiques'
  ),
  'tft.comp.strongAgainst': t6(
    'Stark gegen', 'Strong Against',
    '\uAC15\uD55C \uC0C1\uB300', '\u514B\u5236',
    'Fuerte contra', 'Fort contre'
  ),
  'tft.comp.weakAgainst': t6(
    'Schwach gegen', 'Weak Against',
    '\uC57D\uD55C \uC0C1\uB300', '\u88AB\u514B\u5236',
    'D\u00E9bil contra', 'Faible contre'
  ),
  'tft.comp.noSignificantData': t6(
    'Keine signifikanten Daten', 'No significant data',
    '\uC720\uC758\uBBF8\uD55C \uB370\uC774\uD130 \uC5C6\uC74C', '\u65E0\u663E\u8457\u6570\u636E',
    'Sin datos significativos', 'Pas de donn\u00E9es significatives'
  ),

  // \u2500 Item Detail Page (recipe + siblings) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'tft.item.recipe': t6(
    'Rezept', 'Recipe', '\uB808\uC2DC\uD53C', '\u914D\u65B9', 'Receta', 'Recette'
  ),
  'tft.item.sharedComponents': t6(
    'Items mit geteilten Komponenten', 'Items With Shared Components',
    '\uACF5\uC720 \uAD6C\uC131 \uC694\uC18C\uB97C \uAC00\uC9C4 \uC544\uC774\uD15C', '\u5171\u4EAB\u90E8\u4EF6\u7684\u88C5\u5907',
    '\u00CDtems con componentes compartidos', 'Objets avec composants partag\u00E9s'
  ),

  // \u2500 Augment Detail Page \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'tft.augment.statsPerStage': t6(
    'Statistiken pro Stage', 'Stats Per Stage',
    '\uC2A4\uD14C\uC774\uC9C0\uBCC4 \uD1B5\uACC4', '\u9636\u6BB5\u7EDF\u8BA1',
    'Estad\u00EDsticas por Etapa', 'Statistiques par \u00E9tape'
  ),
  'tft.augment.stage': t6(
    'Stage', 'Stage', '\uC2A4\uD14C\uC774\uC9C0', '\u9636\u6BB5', 'Etapa', '\u00C9tape'
  ),
  'tft.augment.bestSlot': t6(
    'Bester Slot', 'Best Slot',
    '\uCD5C\uACE0 \uC2AC\uB86F', '\u6700\u4F73\u4F4D\u7F6E',
    'Mejor Slot', 'Meilleur slot'
  ),
  'tft.augment.notOfferedHere': t6(
    'In diesem Slot nicht angeboten.', 'Not offered in this slot.',
    '\uC774 \uC2AC\uB86F\uC5D0\uC11C \uC81C\uACF5\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.', '\u6B64\u4F4D\u7F6E\u4E0D\u63D0\u4F9B\u3002',
    'No ofrecido en este slot.', 'Non propos\u00E9 \u00E0 cet emplacement.'
  ),

  // \u2500 Legal pages: Impressum + Datenschutz + Cookie Banner \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'legal.imprint': t6(
    'Impressum', 'Imprint', '\uBC95\uC801 \uACE0\uC9C0', '\u6CD5\u5F8B\u58F0\u660E', 'Aviso Legal', 'Mentions l\u00E9gales'
  ),
  'legal.privacy': t6(
    'Datenschutz', 'Privacy', '\uAC1C\uC778\uC815\uBCF4\uCC98\uB9AC\uBC29\uCE68', '\u9690\u79C1\u653F\u7B56', 'Privacidad', 'Confidentialit\u00E9'
  ),
  'legal.imprint.providerHeading': t6(
    'Diensteanbieter', 'Service Provider',
    '\uC11C\uBE44\uC2A4 \uC81C\uACF5\uC790', '\u670D\u52A1\u63D0\u4F9B\u5546',
    'Proveedor del Servicio', 'Fournisseur du service'
  ),
  'legal.imprint.contactHeading': t6(
    'Kontakt', 'Contact',
    '\uC5F0\uB77D\uCC98', '\u8054\u7CFB\u65B9\u5F0F',
    'Contacto', 'Contact'
  ),
  'legal.imprint.responsibleHeading': t6(
    'Verantwortlich f\u00FCr den Inhalt nach \u00A7 55 Abs. 2 RStV',
    'Responsible for content per \u00A7 55 Abs. 2 RStV',
    '\uCF58\uD150\uCE20 \uCC45\uC784\uC790 (RStV \u00A7 55 Abs. 2)',
    '\u5185\u5BB9\u8D23\u4EFB\u4EBA (RStV \u00A755 Abs. 2)',
    'Responsable del contenido (RStV \u00A755 Abs. 2)',
    'Responsable du contenu (RStV \u00A755 Abs. 2)'
  ),
  'legal.imprint.responsibleText': t6(
    'Der Diensteanbieter ist gleichzeitig inhaltlich Verantwortlicher:',
    'The service provider is also responsible for content:',
    '\uC11C\uBE44\uC2A4 \uC81C\uACF5\uC790\uAC00 \uCF58\uD150\uCE20 \uCC45\uC784\uC790\uC785\uB2C8\uB2E4:',
    '\u670D\u52A1\u63D0\u4F9B\u5546\u540C\u65F6\u4E3A\u5185\u5BB9\u8D1F\u8D23\u4EBA\uFF1A',
    'El proveedor tambi\u00E9n es responsable del contenido:',
    'Le fournisseur est \u00E9galement responsable du contenu :'
  ),
  'legal.imprint.disclaimerHeading': t6(
    'Haftungsausschluss', 'Disclaimer',
    '\uBA74\uCC45 \uC870\uD56D', '\u514D\u8D23\u58F0\u660E',
    'Descargo de responsabilidad', 'Avertissement'
  ),
  'legal.imprint.disclaimerContent': t6(
    'Die Inhalte dieser Seite werden mit gr\u00F6\u00DFter Sorgfalt erstellt. F\u00FCr die Richtigkeit, Vollst\u00E4ndigkeit und Aktualit\u00E4t der Inhalte kann jedoch keine Gew\u00E4hr \u00FCbernommen werden. Statistiken werden aus \u00F6ffentlichen APIs (Riot Games, CommunityDragon, metatft) bezogen und sind ohne Gew\u00E4hr.',
    'Content on this site is produced with care; we cannot guarantee accuracy, completeness, or timeliness. Statistics come from public APIs (Riot, CommunityDragon, metatft) and are provided without warranty.',
    '\uC774 \uC0AC\uC774\uD2B8\uC758 \uCF58\uD150\uCE20\uB294 \uC2E0\uC911\uD788 \uC791\uC131\uB418\uC9C0\uB9CC \uC815\uD655\uC131, \uC644\uC804\uC131 \uBC0F \uC2DC\uC758\uC131\uC744 \uBCF4\uC7A5\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uD1B5\uACC4\uB294 \uACF5\uAC1C API\uC5D0\uC11C \uC218\uC9D1\uB418\uBA70 \uBCF4\uC99D \uC5C6\uC774 \uC81C\uACF5\uB429\uB2C8\uB2E4.',
    '\u672C\u7F51\u7AD9\u5185\u5BB9\u7ECF\u7CBE\u5FC3\u5236\u4F5C\uFF0C\u4F46\u4E0D\u4FDD\u8BC1\u5176\u51C6\u786E\u6027\u3001\u5B8C\u6574\u6027\u6216\u65F6\u6548\u6027\u3002\u7EDF\u8BA1\u6570\u636E\u6765\u81EA\u516C\u5F00API\uFF0C\u6309\u539F\u6837\u63D0\u4F9B\u3002',
    'Los contenidos se elaboran con cuidado, sin garant\u00EDa de exactitud o actualidad. Las estad\u00EDsticas provienen de APIs p\u00FAblicas y se entregan sin garant\u00EDa.',
    'Le contenu est produit avec soin, sans garantie d\'exactitude ni d\'actualit\u00E9. Les statistiques proviennent d\'APIs publiques, sans garantie.'
  ),
  'legal.imprint.disclaimerLinks': t6(
    'Trotz sorgf\u00E4ltiger inhaltlicher Kontrolle \u00FCbernehmen wir keine Haftung f\u00FCr die Inhalte externer Links. F\u00FCr den Inhalt der verlinkten Seiten sind ausschlie\u00DFlich deren Betreiber verantwortlich.',
    'Despite careful review, we cannot accept liability for the content of external links. The operators of linked pages are solely responsible for their content.',
    '\uC678\uBD80 \uB9C1\uD06C \uB0B4\uC6A9\uC5D0 \uB300\uD574\uC11C\uB294 \uCC45\uC784\uC744 \uC9C0\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uB9C1\uD06C\uB41C \uD398\uC774\uC9C0\uC758 \uB0B4\uC6A9\uC740 \uD574\uB2F9 \uC6B4\uC601\uC790\uC758 \uCC45\uC784\uC785\uB2C8\uB2E4.',
    '\u6211\u4EEC\u5BF9\u5916\u90E8\u94FE\u63A5\u7684\u5185\u5BB9\u4E0D\u627F\u62C5\u8D23\u4EFB\u3002\u94FE\u63A5\u9875\u9762\u7684\u5185\u5BB9\u4EC5\u7531\u5176\u8FD0\u8425\u8005\u8D1F\u8D23\u3002',
    'No asumimos responsabilidad por el contenido de enlaces externos.',
    'Nous ne sommes pas responsables du contenu des liens externes.'
  ),
  'legal.imprint.riotHeading': t6(
    'Hinweis zu Riot Games',
    'Riot Games Notice',
    'Riot Games \uC548\uB0B4',
    '\u5173\u4E8E Riot Games',
    'Aviso sobre Riot Games',
    'Mention Riot Games'
  ),
  'legal.imprint.riotDisclaimer': t6(
    'metastats.gg ist nicht mit Riot Games, Inc. verbunden, von Riot Games unterst\u00FCtzt oder finanziert. League of Legends und Teamfight Tactics sind eingetragene Marken von Riot Games, Inc.',
    'metastats.gg isn\'t endorsed by Riot Games and doesn\'t reflect the views or opinions of Riot Games or anyone officially involved in producing or managing League of Legends or Teamfight Tactics. League of Legends and Teamfight Tactics are registered trademarks of Riot Games, Inc.',
    'metastats.gg\uC740 Riot Games\uC640 \uACF5\uC2DD\uC801\uC73C\uB85C \uC81C\uD734\uB418\uC5B4 \uC788\uC9C0 \uC54A\uC73C\uBA70 Riot Games\uC758 \uD6C4\uC6D0\uC774\uB098 \uC790\uAE08 \uC9C0\uC6D0\uC744 \uBC1B\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. League of Legends\uC640 Teamfight Tactics\uB294 Riot Games\uC758 \uB4F1\uB85D \uC0C1\uD45C\uC785\uB2C8\uB2E4.',
    'metastats.gg \u4E0D\u96B6\u5C5E\u4E8E Riot Games\uFF0C\u4EA6\u672A\u83B7\u5176\u8BA4\u53EF\u6216\u8D44\u52A9\u3002League of Legends \u4E0E Teamfight Tactics \u662F Riot Games, Inc. \u7684\u6CE8\u518C\u5546\u6807\u3002',
    'metastats.gg no est\u00E1 afiliado, respaldado ni patrocinado por Riot Games, Inc. League of Legends y Teamfight Tactics son marcas registradas.',
    'metastats.gg n\'est ni affili\u00E9 ni soutenu par Riot Games, Inc. League of Legends et Teamfight Tactics sont des marques d\u00E9pos\u00E9es.'
  ),
  'legal.imprint.copyrightHeading': t6(
    'Urheberrecht', 'Copyright',
    '\uC800\uC791\uAD8C', '\u7248\u6743',
    'Derechos de autor', 'Droits d\'auteur'
  ),
  'legal.imprint.copyrightText': t6(
    'Die durch die Seitenbetreiber erstellten Inhalte und Werke unterliegen dem deutschen Urheberrecht. Die Vervielf\u00E4ltigung, Bearbeitung, Verbreitung jeder Art au\u00DFerhalb der Grenzen des Urheberrechts bed\u00FCrfen der schriftlichen Zustimmung.',
    'Content created by the site operators is subject to German copyright law. Any duplication, processing, distribution beyond copyright limits requires written consent.',
    '\uC6B4\uC601\uC790\uAC00 \uC791\uC131\uD55C \uCF58\uD150\uCE20\uB294 \uB3C5\uC77C \uC800\uC791\uAD8C\uBC95\uC758 \uBCF4\uD638\uB97C \uBC1B\uC2B5\uB2C8\uB2E4. \uC800\uC791\uAD8C \uD55C\uB3C4\uB97C \uB118\uB294 \uBAA8\uB4E0 \uC0AC\uC6A9\uC5D0\uB294 \uC11C\uBA74 \uB3D9\uC758\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.',
    '\u672C\u7F51\u7AD9\u8FD0\u8425\u8005\u521B\u4F5C\u7684\u5185\u5BB9\u53D7\u5FB7\u56FD\u7248\u6743\u6CD5\u4FDD\u62A4\u3002\u8D85\u51FA\u7248\u6743\u9650\u5236\u7684\u4EFB\u4F55\u4F7F\u7528\u5747\u9700\u4E66\u9762\u540C\u610F\u3002',
    'Los contenidos creados por los operadores est\u00E1n sujetos a la legislaci\u00F3n alemana de derechos de autor.',
    'Les contenus cr\u00E9\u00E9s par les op\u00E9rateurs sont soumis au droit d\'auteur allemand.'
  ),
  'legal.privacy.overviewHeading': t6(
    '\u00DCberblick', 'Overview', '\uAC1C\uC694', '\u6982\u89C8', 'Resumen', 'Aper\u00E7u'
  ),
  'legal.privacy.overviewText': t6(
    'Diese Datenschutzerkl\u00E4rung informiert \u00FCber Art, Umfang und Zweck der Verarbeitung personenbezogener Daten auf metastats.gg im Sinne von Art. 13 DSGVO.',
    'This privacy notice describes how personal data is processed on metastats.gg in line with Art. 13 GDPR.',
    '\uC774 \uAC1C\uC778\uC815\uBCF4\uCC98\uB9AC\uBC29\uCE68\uC740 metastats.gg\uC5D0\uC11C \uAC1C\uC778\uC815\uBCF4\uB97C \uCC98\uB9AC\uD558\uB294 \uBC29\uBC95\uC744 GDPR 13\uC870\uC5D0 \uB530\uB77C \uC124\uBA85\uD569\uB2C8\uB2E4.',
    '\u672C\u9690\u79C1\u58F0\u660E\u6839\u636E GDPR \u7B2C 13 \u6761\u8BF4\u660E metastats.gg \u5982\u4F55\u5904\u7406\u4E2A\u4EBA\u6570\u636E\u3002',
    'Esta pol\u00EDtica de privacidad describe el tratamiento de datos personales conforme al art. 13 RGPD.',
    'Cette politique d\u00E9crit le traitement des donn\u00E9es personnelles conform\u00E9ment \u00E0 l\'art. 13 RGPD.'
  ),
  'legal.privacy.controllerHeading': t6(
    'Verantwortlicher', 'Controller',
    '\uCC45\uC784\uC790', '\u8D1F\u8D23\u4EBA',
    'Responsable', 'Responsable du traitement'
  ),
  'legal.privacy.dataCollectedHeading': t6(
    'Welche Daten werden erfasst?', 'What data is collected?',
    '\uC218\uC9D1\uB418\uB294 \uB370\uC774\uD130', '\u6536\u96C6\u7684\u6570\u636E',
    '\u00BFQu\u00E9 datos se recopilan?', 'Quelles donn\u00E9es sont collect\u00E9es ?'
  ),
  'legal.privacy.dataCollectedIntro': t6(
    'metastats.gg verarbeitet folgende Datenkategorien:',
    'metastats.gg processes the following data categories:',
    'metastats.gg\uB294 \uB2E4\uC74C \uB370\uC774\uD130 \uBC94\uC8FC\uB97C \uCC98\uB9AC\uD569\uB2C8\uB2E4:',
    'metastats.gg \u5904\u7406\u4EE5\u4E0B\u6570\u636E\u7C7B\u522B\uFF1A',
    'metastats.gg procesa las siguientes categor\u00EDas:',
    'metastats.gg traite les cat\u00E9gories suivantes :'
  ),
  'legal.privacy.dataRiot': t6(
    'Spielerdaten aus der \u00F6ffentlichen Riot Games API (puuid, Riot-ID, Match-Daten, Rang) \u2014 ausschlie\u00DFlich f\u00FCr die angeforderte Spielersuche und in Caching-Tabellen zur Performance-Optimierung.',
    'Player data from the public Riot Games API (puuid, Riot ID, match data, rank) \u2014 only for the player search requested and in caching tables for performance.',
    '\uACF5\uAC1C Riot Games API\uC758 \uD50C\uB808\uC774\uC5B4 \uB370\uC774\uD130(puuid, Riot ID, \uACBD\uAE30 \uB370\uC774\uD130, \uD2F0\uC5B4) \u2014 \uC694\uCCAD\uB41C \uD50C\uB808\uC774\uC5B4 \uAC80\uC0C9\uC5D0\uB9CC \uC0AC\uC6A9\uB418\uBA70 \uC131\uB2A5 \uCE90\uC2DC \uD14C\uC774\uBE14\uC5D0 \uC800\uC7A5\uB429\uB2C8\uB2E4.',
    '\u6765\u81EA\u516C\u5F00 Riot Games API \u7684\u73A9\u5BB6\u6570\u636E\uFF08puuid\u3001Riot ID\u3001\u5BF9\u6218\u6570\u636E\u3001\u6BB5\u4F4D\uFF09\u2014\u2014 \u4EC5\u7528\u4E8E\u6240\u8BF7\u6C42\u7684\u73A9\u5BB6\u641C\u7D22\u53CA\u6027\u80FD\u7F13\u5B58\u3002',
    'Datos de jugadores de la API p\u00FAblica de Riot (puuid, Riot ID, datos de partida, rango), solo para b\u00FAsquedas y cach\u00E9 de rendimiento.',
    'Donn\u00E9es de joueurs via l\'API publique de Riot (puuid, Riot ID, donn\u00E9es de match, rang), uniquement pour la recherche demand\u00E9e et le cache.'
  ),
  'legal.privacy.dataLogs': t6(
    'Server-Logs (anonymisierte IP, User-Agent, Zeitstempel) durch unseren Hosting-Anbieter Vercel \u2014 zur Sicherheits- und Performance-Analyse.',
    'Server logs (anonymised IP, user-agent, timestamp) via our hosting provider Vercel \u2014 for security and performance analysis.',
    '\uC11C\uBC84 \uB85C\uADF8(\uC775\uBA85\uD654\uB41C IP, \uC0AC\uC6A9\uC790 \uC5D0\uC774\uC804\uD2B8, \uD0C0\uC784\uC2A4\uD0EC\uD504) \u2014 \uD638\uC2A4\uD305 \uC81C\uACF5\uC5C5\uCCB4 Vercel\uC744 \uD1B5\uD574 \uBCF4\uC548 \uBC0F \uC131\uB2A5 \uBD84\uC11D \uBAA9\uC801.',
    '\u7531\u6258\u7BA1\u5546 Vercel \u6536\u96C6\u7684\u670D\u52A1\u5668\u65E5\u5FD7\uFF08\u533F\u540D\u5316 IP\u3001\u7528\u6237\u4EE3\u7406\u3001\u65F6\u95F4\u6233\uFF09\uFF0C\u7528\u4E8E\u5B89\u5168\u548C\u6027\u80FD\u5206\u6790\u3002',
    'Registros del servidor (IP anonimizada, user-agent, marca de tiempo) por nuestro hosting Vercel.',
    'Journaux serveur (IP anonymis\u00E9e, user-agent, horodatage) via notre h\u00E9bergeur Vercel.'
  ),
  'legal.privacy.dataLang': t6(
    'Sprach-Cookie (metastats-lang) zur Speicherung deiner Sprachauswahl \u2014 funktional notwendig im Sinne von \u00A7 25 Abs. 2 TTDSG.',
    'Language cookie (metastats-lang) to persist your language choice \u2014 functionally required per \u00A7 25 Abs. 2 TTDSG.',
    '\uC5B8\uC5B4 \uCFE0\uD0A4(metastats-lang)\uB294 \uC5B8\uC5B4 \uC120\uD0DD\uC744 \uC800\uC7A5\uD558\uB294 \uAE30\uB2A5 \uCFE0\uD0A4\uC785\uB2C8\uB2E4.',
    '\u8BED\u8A00 Cookie\uFF08metastats-lang\uFF09\u7528\u4E8E\u4FDD\u5B58\u60A8\u7684\u8BED\u8A00\u9009\u62E9\uFF0C\u5C5E\u4E8E\u529F\u80FD\u6027\u5FC5\u9700 Cookie\u3002',
    'Cookie de idioma (metastats-lang) para guardar tu selecci\u00F3n \u2014 funcionalmente necesaria.',
    'Cookie de langue (metastats-lang) pour m\u00E9moriser votre choix \u2014 n\u00E9cessaire au fonctionnement.'
  ),
  'legal.privacy.processorsHeading': t6(
    'Auftragsverarbeiter & Dienste',
    'Processors & Services',
    '\uB370\uC774\uD130 \uCC98\uB9AC\uC790 \uBC0F \uC11C\uBE44\uC2A4',
    '\u6570\u636E\u5904\u7406\u65B9\u4E0E\u670D\u52A1',
    'Encargados del tratamiento y servicios',
    'Sous-traitants et services'
  ),
  'legal.privacy.processorVercel': t6(
    'Vercel Inc. (USA) \u2014 Hosting & Edge-Cache. Privacy Shield zertifiziert, DSGVO-konforme Datenverarbeitungsvereinbarung.',
    'Vercel Inc. (USA) \u2014 hosting & edge cache. Privacy Shield certified, GDPR-compliant DPA.',
    'Vercel Inc.(\uBBF8\uAD6D) \u2014 \uD638\uC2A4\uD305 \uBC0F \uC5E3\uC9C0 \uCE90\uC2DC.',
    'Vercel Inc.\uFF08\u7F8E\u56FD\uFF09\u2014 \u6258\u7BA1\u548C\u8FB9\u7F18\u7F13\u5B58\u3002',
    'Vercel Inc. (EE.UU.) \u2014 alojamiento.',
    'Vercel Inc. (USA) \u2014 h\u00E9bergement.'
  ),
  'legal.privacy.processorSupabase': t6(
    'Supabase (USA/EU) \u2014 Datenbank-Hosting. PostgreSQL mit Row-Level-Security, Cache nur Game-Daten (kein PII).',
    'Supabase (USA/EU) \u2014 database hosting. PostgreSQL with row-level security, caches only game data (no PII).',
    'Supabase(\uBBF8\uAD6D/EU) \u2014 \uB370\uC774\uD130\uBCA0\uC774\uC2A4 \uD638\uC2A4\uD305. \uAC8C\uC784 \uB370\uC774\uD130 \uCE90\uC2DC(PII \uC5C6\uC74C).',
    'Supabase\uFF08\u7F8E\u56FD/EU\uFF09\u2014 \u6570\u636E\u5E93\u6258\u7BA1\u3002\u4EC5\u7F13\u5B58\u6E38\u620F\u6570\u636E\u3002',
    'Supabase \u2014 alojamiento de base de datos.',
    'Supabase \u2014 h\u00E9bergement de base de donn\u00E9es.'
  ),
  'legal.privacy.processorRiot': t6(
    'Riot Games, Inc. (USA) \u2014 Spieldaten-API. Wir senden Spielernamen / puuid f\u00FCr Suchanfragen.',
    'Riot Games, Inc. (USA) \u2014 game data API. We forward player name / puuid for searches.',
    'Riot Games, Inc.(\uBBF8\uAD6D) \u2014 \uAC8C\uC784 \uB370\uC774\uD130 API.',
    'Riot Games, Inc.\uFF08\u7F8E\u56FD\uFF09\u2014 \u6E38\u620F\u6570\u636E API\u3002',
    'Riot Games, Inc. (EE.UU.) \u2014 API de datos de partida.',
    'Riot Games, Inc. (USA) \u2014 API de donn\u00E9es de jeu.'
  ),
  'legal.privacy.processorCdragon': t6(
    'CommunityDragon (CDN) \u2014 statische Asset-Auslieferung (Icons, Bilder). Keine personenbezogene Verarbeitung.',
    'CommunityDragon (CDN) \u2014 static asset delivery (icons, images). No personal data processing.',
    'CommunityDragon(CDN) \u2014 \uC815\uC801 \uC790\uC0B0 \uC81C\uACF5.',
    'CommunityDragon (CDN)\u2014 \u9759\u6001\u8D44\u6E90\u5206\u53D1\u3002',
    'CommunityDragon (CDN) \u2014 entrega de activos est\u00E1ticos.',
    'CommunityDragon (CDN) \u2014 livraison d\'assets statiques.'
  ),
  'legal.privacy.cookiesHeading': t6(
    'Cookies', 'Cookies', '\uCFE0\uD0A4', 'Cookie', 'Cookies', 'Cookies'
  ),
  'legal.privacy.cookiesText': t6(
    'metastats.gg setzt nur ein funktionales Cookie (metastats-lang) zur Speicherung der Sprachauswahl. Es werden keine Tracking- oder Werbe-Cookies gesetzt. Vercel Analytics nutzt eine anonymisierte, hash-basierte Methode ohne Cookies und ohne IP-Speicherung.',
    'metastats.gg sets only a functional cookie (metastats-lang) for language preference. No tracking or advertising cookies are set. Vercel Analytics uses an anonymous, hash-based method without cookies and without IP storage.',
    'metastats.gg\uB294 \uC5B8\uC5B4 \uC120\uD0DD\uC6A9 \uAE30\uB2A5 \uCFE0\uD0A4(metastats-lang)\uB9CC \uC0AC\uC6A9\uD569\uB2C8\uB2E4. \uCD94\uC801/\uAD11\uACE0 \uCFE0\uD0A4\uB294 \uC5C6\uC2B5\uB2C8\uB2E4.',
    'metastats.gg \u4EC5\u8BBE\u7F6E\u4E00\u4E2A\u529F\u80FD\u6027 Cookie\uFF08metastats-lang\uFF09\u7528\u4E8E\u8BED\u8A00\u504F\u597D\uFF0C\u65E0\u8FFD\u8E2A\u6216\u5E7F\u544A Cookie\u3002',
    'metastats.gg solo establece una cookie funcional (metastats-lang). Sin cookies de seguimiento o publicidad.',
    'metastats.gg ne d\u00E9finit qu\'un cookie fonctionnel (metastats-lang). Aucun cookie de suivi ou publicitaire.'
  ),
  'legal.privacy.retentionHeading': t6(
    'Speicherdauer', 'Retention',
    '\uBCF4\uAD00 \uAE30\uAC04', '\u4FDD\u7559\u671F',
    'Conservaci\u00F3n', 'Conservation'
  ),
  'legal.privacy.retentionText': t6(
    'Server-Logs werden maximal 14 Tage gespeichert. Spielerdaten-Caches (puuid, Match-IDs) verbleiben in der Datenbank, solange sie f\u00FCr die Plattform-Funktionalit\u00E4t erforderlich sind. Auf Anfrage l\u00F6schen wir Datens\u00E4tze einzelner Spieler innerhalb von 30 Tagen.',
    'Server logs are kept for max 14 days. Player-data caches (puuid, match IDs) remain as long as needed for platform functionality. On request, we erase individual player records within 30 days.',
    '\uC11C\uBC84 \uB85C\uADF8\uB294 \uCD5C\uB300 14\uC77C \uBCF4\uAD00\uB429\uB2C8\uB2E4. \uD50C\uB808\uC774\uC5B4 \uCE90\uC2DC\uB294 \uAE30\uB2A5 \uC720\uC9C0\uC5D0 \uD544\uC694\uD55C \uB9CC\uD07C \uBCF4\uAD00\uB429\uB2C8\uB2E4.',
    '\u670D\u52A1\u5668\u65E5\u5FD7\u6700\u957F\u4FDD\u7559 14 \u5929\u3002\u73A9\u5BB6\u6570\u636E\u7F13\u5B58\u6309\u9700\u4FDD\u7559\u3002',
    'Los registros se conservan m\u00E1x. 14 d\u00EDas. Las cach\u00E9s de jugadores se mantienen mientras sean necesarias.',
    'Les journaux sont conserv\u00E9s max. 14 jours. Les caches de joueurs restent tant que n\u00E9cessaire.'
  ),
  'legal.privacy.rightsHeading': t6(
    'Deine Rechte', 'Your Rights',
    '\uADC0\uD558\uC758 \uAD8C\uB9AC', '\u60A8\u7684\u6743\u5229',
    'Tus derechos', 'Vos droits'
  ),
  'legal.privacy.rightsIntro': t6(
    'Du hast nach DSGVO folgende Rechte:',
    'Under GDPR you have the following rights:',
    'GDPR\uC5D0 \uB530\uB77C \uB2E4\uC74C \uAD8C\uB9AC\uB97C \uAC00\uC9D1\uB2C8\uB2E4:',
    '\u4F9D\u636E GDPR\uFF0C\u60A8\u4EAB\u6709\u4EE5\u4E0B\u6743\u5229\uFF1A',
    'Seg\u00FAn el RGPD tienes los siguientes derechos:',
    'Selon le RGPD, vous disposez des droits suivants :'
  ),
  'legal.privacy.rightAccess': t6(
    'Auskunft \u00FCber gespeicherte Daten (Art. 15)',
    'Access (Art. 15)',
    '\uC561\uC138\uC2A4 \uAD8C\uB9AC (\uC81C15\uC870)',
    '\u8BBF\u95EE\u6743 (\u7B2C15\u6761)',
    'Acceso (art. 15)',
    'Acc\u00E8s (art. 15)'
  ),
  'legal.privacy.rightRectify': t6(
    'Berichtigung (Art. 16)', 'Rectification (Art. 16)',
    '\uC815\uC815 (\uC81C16\uC870)', '\u66F4\u6B63 (\u7B2C16\u6761)',
    'Rectificaci\u00F3n (art. 16)', 'Rectification (art. 16)'
  ),
  'legal.privacy.rightErase': t6(
    'L\u00F6schung (Art. 17, "Recht auf Vergessenwerden")',
    'Erasure (Art. 17, "right to be forgotten")',
    '\uC0AD\uC81C (\uC81C17\uC870)', '\u5220\u9664 (\u7B2C17\u6761)',
    'Supresi\u00F3n (art. 17)', 'Effacement (art. 17)'
  ),
  'legal.privacy.rightRestrict': t6(
    'Einschr\u00E4nkung der Verarbeitung (Art. 18)',
    'Restriction of processing (Art. 18)',
    '\uCC98\uB9AC \uC81C\uD55C (\uC81C18\uC870)', '\u5904\u7406\u9650\u5236 (\u7B2C18\u6761)',
    'Limitaci\u00F3n del tratamiento (art. 18)',
    'Limitation du traitement (art. 18)'
  ),
  'legal.privacy.rightPortability': t6(
    'Daten\u00FCbertragbarkeit (Art. 20)',
    'Data portability (Art. 20)',
    '\uB370\uC774\uD130 \uC774\uB3D9\uC131 (\uC81C20\uC870)', '\u6570\u636E\u53EF\u643A\u6743 (\u7B2C20\u6761)',
    'Portabilidad (art. 20)', 'Portabilit\u00E9 (art. 20)'
  ),
  'legal.privacy.rightComplain': t6(
    'Beschwerde bei einer Aufsichtsbeh\u00F6rde (Art. 77)',
    'Complaint to a supervisory authority (Art. 77)',
    '\uAC10\uB3C5 \uAE30\uAD00\uC5D0 \uD56D\uC758 (\uC81C77\uC870)',
    '\u5411\u76D1\u7BA1\u673A\u6784\u6295\u8BC9 (\u7B2C77\u6761)',
    'Reclamaci\u00F3n ante autoridad (art. 77)',
    'Plainte aupr\u00E8s d\'une autorit\u00E9 (art. 77)'
  ),
  'legal.privacy.rightsContact': t6(
    'Zur Aus\u00FCbung deiner Rechte schreibe an info@metastats.gg. Wir bearbeiten Anfragen innerhalb von 30 Tagen.',
    'Email info@metastats.gg to exercise these rights. We respond within 30 days.',
    '\uAD8C\uB9AC \uD589\uC0AC\uB294 info@metastats.gg\uB85C \uC5F0\uB77D\uC8FC\uC138\uC694. 30\uC77C \uC774\uB0B4 \uB2F5\uBCC0\uB4DC\uB9BD\uB2C8\uB2E4.',
    '\u8BF7\u53D1\u90AE\u4EF6\u81F3 info@metastats.gg \u884C\u4F7F\u6743\u5229\u3002\u6211\u4EEC\u5C06\u5728 30 \u5929\u5185\u56DE\u590D\u3002',
    'Para ejercer estos derechos: info@metastats.gg. Respondemos en 30 d\u00EDas.',
    'Pour exercer vos droits : info@metastats.gg. R\u00E9ponse sous 30 jours.'
  ),
  'legal.privacy.changesHeading': t6(
    '\u00C4nderungen', 'Changes',
    '\uBCC0\uACBD\uC0AC\uD56D', '\u53D8\u66F4',
    'Cambios', 'Modifications'
  ),
  'legal.privacy.changesText': t6(
    'Diese Datenschutzerkl\u00E4rung kann angepasst werden, um aktuellen rechtlichen Anforderungen zu entsprechen. Die jeweils aktuelle Fassung gilt ab Ver\u00F6ffentlichung auf dieser Seite.',
    'This privacy notice may be updated to reflect current legal requirements. The current version applies from publication on this page.',
    '\uBCF8 \uAC1C\uC778\uC815\uBCF4\uCC98\uB9AC\uBC29\uCE68\uC740 \uBC95\uC801 \uC694\uAC74\uC5D0 \uB530\uB77C \uBCC0\uACBD\uB420 \uC218 \uC788\uC2B5\uB2C8\uB2E4.',
    '\u672C\u58F0\u660E\u53EF\u80FD\u6839\u636E\u6CD5\u5F8B\u8981\u6C42\u66F4\u65B0\uFF0C\u6700\u65B0\u7248\u672C\u81EA\u53D1\u5E03\u4E4B\u65E5\u8D77\u751F\u6548\u3002',
    'Esta pol\u00EDtica puede actualizarse para reflejar requisitos legales.',
    'Cette politique peut \u00EAtre mise \u00E0 jour selon les exigences l\u00E9gales.'
  ),

  // \u2500 Cookie banner \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'cookie.title': t6(
    'Cookies', 'Cookies', '\uCFE0\uD0A4', 'Cookie', 'Cookies', 'Cookies'
  ),
  'cookie.body': t6(
    'Wir setzen ein notwendiges Cookie f\u00FCr die Sprachauswahl und nutzen anonyme Analytics ohne Tracking. Details unter',
    'We set one functional cookie for language and use anonymous analytics with no tracking. Details in our',
    '\uC5B8\uC5B4 \uC120\uD0DD\uC744 \uC704\uD55C \uD544\uC218 \uCFE0\uD0A4\uC640 \uC775\uBA85 \uBD84\uC11D\uC744 \uC0AC\uC6A9\uD569\uB2C8\uB2E4. \uC790\uC138\uD55C \uB0B4\uC6A9\uC740',
    '\u6211\u4EEC\u8BBE\u7F6E\u4E00\u4E2A\u529F\u80FD\u6027 Cookie\uFF08\u8BED\u8A00\uFF09\u5E76\u4F7F\u7528\u533F\u540D\u5206\u6790\u3002\u8BE6\u60C5\u89C1',
    'Usamos una cookie funcional para el idioma y anal\u00EDtica an\u00F3nima. Detalles en',
    'Un cookie fonctionnel pour la langue, analytique anonyme. D\u00E9tails dans la'
  ),
  'cookie.accept': t6(
    'Akzeptieren', 'Accept',
    '\uC218\uB77D', '\u63A5\u53D7',
    'Aceptar', 'Accepter'
  ),
  'cookie.decline': t6(
    'Ablehnen', 'Decline',
    '\uAC70\uBD80', '\u62D2\u7EDD',
    'Rechazar', 'Refuser'
  ),

  // \u2500 Patch Notes / Patch Diff \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'tft.patchNotes.title': t6(
    'Patch-\u00DCbersicht', 'Patch Overview',
    '\uD328\uCE58 \uAC1C\uC694', '\u7248\u672C\u6982\u89C8',
    'Resumen de Parches', 'Aper\u00E7u des patchs'
  ),
  'tft.patchNotes.subtitle': t6(
    'Was hat sich pro Patch gemessen ge\u00E4ndert \u2014 automatisch generierte Winners & Losers.',
    'What measurably changed each patch \u2014 auto-generated winners & losers.',
    '\uAC01 \uD328\uCE58\uB9C8\uB2E4 \uCE21\uC815\uB41C \uBCC0\uACBD \uC0AC\uD56D \u2014 \uC790\uB3D9 \uC0DD\uC131\uB41C \uC0C1\uC2B9/\uD558\uB77D \uBAA9\uB85D.',
    '\u6BCF\u4E2A\u7248\u672C\u7684\u53EF\u91CF\u5316\u53D8\u5316 \u2014 \u81EA\u52A8\u751F\u6210\u7684\u8D62\u5BB6\u4E0E\u8F93\u5BB6\u3002',
    'Cambios medibles por parche \u2014 ganadores y perdedores autogenerados.',
    'Changements mesurables par patch \u2014 gagnants et perdants g\u00E9n\u00E9r\u00E9s.'
  ),
  'tft.patchNotes.empty': t6(
    'Noch keine Patch-Daten verf\u00FCgbar. Komm in ein paar Tagen wieder.',
    'No patch data available yet. Check back in a few days.',
    '\uC544\uC9C1 \uD328\uCE58 \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.',
    '\u6682\u65E0\u7248\u672C\u6570\u636E\u3002',
    'A\u00FAn no hay datos de parche.',
    'Pas encore de donn\u00E9es de patch.'
  ),
  'tft.patchNotes.singlePatch': t6(
    'Erst ein Patch in den Daten. Diff-Vergleich erscheint sobald der n\u00E4chste Patch live ist.',
    'Only one patch in the data yet. Diff comparison appears once the next patch is live.',
    '\uB370\uC774\uD130\uC5D0 \uD328\uCE58\uAC00 \uD558\uB098\uBFD0\uC785\uB2C8\uB2E4.',
    '\u6570\u636E\u4E2D\u53EA\u6709\u4E00\u4E2A\u7248\u672C\uFF0C\u9700\u8981\u81F3\u5C11\u4E24\u4E2A\u7248\u672C\u624D\u80FD\u5BF9\u6BD4\u3002',
    'Solo un parche en los datos.',
    'Un seul patch dans les donn\u00E9es.'
  ),
  'tft.patchNotes.current': t6(
    'Aktuell', 'Current', '\uD604\uC7AC', '\u5F53\u524D', 'Actual', 'Actuel'
  ),
  'tft.patchNotes.matches': t6(
    'Spiele', 'Matches', '\uACBD\uAE30', '\u6BD4\u8D5B', 'Partidas', 'Matchs'
  ),
  'tft.patchNotes.comparedTo': t6(
    'verglichen mit', 'compared to',
    '\uB300\uBE44', '\u5BF9\u6BD4',
    'comparado con', 'compar\u00E9 \u00E0'
  ),
  'tft.patchNotes.entitiesCompared': t6(
    'Eintr\u00E4ge verglichen', 'entities compared',
    '\uD56D\uBAA9 \uBE44\uAD50\uB428', '\u9879\u5DF2\u6BD4\u8F83',
    'entradas comparadas', 'entr\u00E9es compar\u00E9es'
  ),
  'tft.patchNotes.winners': t6(
    'Gewinner', 'Winners',
    '\uC0C1\uC2B9', '\u8D62\u5BB6',
    'Ganadores', 'Gagnants'
  ),
  'tft.patchNotes.losers': t6(
    'Verlierer', 'Losers',
    '\uD558\uB77D', '\u8F93\u5BB6',
    'Perdedores', 'Perdants'
  ),
  'tft.patchNotes.entity.unit': t6(
    'Units', 'Units', '\uC720\uB2DB', '\u5355\u4F4D', 'Unidades', 'Unit\u00E9s'
  ),
  'tft.patchNotes.entity.item': t6(
    'Items', 'Items', '\uC544\uC774\uD15C', '\u88C5\u5907', '\u00CDtems', 'Objets'
  ),
  'tft.patchNotes.entity.trait': t6(
    'Synergien', 'Traits', '\uC2DC\uB108\uC9C0', '\u7F81\u7ECA', 'Sinergias', 'Synergies'
  ),

  // \u2500 Comp leveling tempo \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'tft.comp.avgLevel': t6(
    '\u00D8 Level', 'Avg Level',
    '\uD3C9\uADE0 \uB808\uBCA8', '\u5E73\u5747\u7B49\u7EA7',
    'Nivel medio', 'Niveau moyen'
  ),
  'tft.comp.avgLastRound': t6(
    '\u00D8 End-Stage', 'Avg End Stage',
    '\uD3C9\uADE0 \uC885\uB8CC \uB77C\uC6B4\uB4DC', '\u5E73\u5747\u7ED3\u675F\u9636\u6BB5',
    'Etapa final media', '\u00C9tape finale moyenne'
  ),
  'tft.comp.tempo': t6(
    'Tempo', 'Tempo', '\uD15C\uD3EC', '\u8282\u594F', 'Tempo', 'Tempo'
  ),
  'tft.comp.tempo.fastEight': t6(
    'Fast 8', 'Fast 8',
    '\uBE60\uB978 8\uB808\uBCA8', '\u901F\u6500 8',
    'R\u00E1pido a 8', 'Niveau 8 rapide'
  ),
  'tft.comp.tempo.slowRoll': t6(
    'Slow-Roll', 'Slow-Roll',
    '\uC2AC\uB85C\uC6B0\uB864', '\u4F4E\u8D39\u641C',
    'Slow-Roll', 'Slow-Roll'
  ),
  'tft.comp.tempo.balanced': t6(
    'Standard', 'Standard',
    '\uD45C\uC900', '\u6807\u51C6',
    'Est\u00E1ndar', 'Standard'
  ),

  // \u2500 Pro-Player Vertical (S\u00E4ule 2) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'tft.pros.title': t6(
    'TFT Pro-Spieler', 'TFT Pro Players',
    'TFT \uD504\uB85C \uC120\uC218', 'TFT \u804C\u4E1A\u9009\u624B',
    'Jugadores Pro TFT', 'Joueurs Pro TFT'
  ),
  'tft.pros.subtitle': t6(
    'Verifizierte Tournament-Spieler und Streamer mit Riot-Account-Validierung',
    'Verified tournament players and streamers with Riot account validation',
    '\uB9AC\uC624\uD2B8 \uACC4\uC815 \uAC80\uC99D\uC744 \uD1B5\uACFC\uD55C \uD1A0\uB108\uBA3C\uD2B8 \uC120\uC218 \uBC0F \uC2A4\uD2B8\uB9AC\uBA38',
    '\u5DF2\u9A8C\u8BC1\u7684\u8D5B\u4E8B\u9009\u624B\u4E0E\u4E3B\u64AD\uFF0C\u9644 Riot \u8D26\u53F7\u6821\u9A8C',
    'Jugadores de torneos y streamers verificados con validaci\u00F3n de cuenta Riot',
    'Joueurs de tournoi et streamers v\u00E9rifi\u00E9s avec validation Riot'
  ),
  'tft.pros.empty': t6(
    'Keine Pros gefunden. Filter zur\u00FCcksetzen?',
    'No pros found. Reset filters?',
    '\uD504\uB85C\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uD544\uD130\uB97C \uC7AC\uC124\uC815\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?',
    '\u672A\u627E\u5230\u804C\u4E1A\u9009\u624B\u3002\u91CD\u7F6E\u7B5B\u9009\uFF1F',
    'No se encontraron pros. \u00BFRestablecer filtros?',
    'Aucun pro trouv\u00E9. R\u00E9initialiser les filtres ?'
  ),
  'tft.pros.allTeams': t6(
    'Alle Teams', 'All Teams',
    '\uBAA8\uB4E0 \uD300', '\u6240\u6709\u6218\u961F',
    'Todos los equipos', 'Toutes les \u00E9quipes'
  ),
  'tft.pros.allRoles': t6(
    'Alle Rollen', 'All Roles',
    '\uBAA8\uB4E0 \uC5ED\uD560', '\u6240\u6709\u89D2\u8272',
    'Todos los roles', 'Tous les r\u00F4les'
  ),
  'tft.pros.searchPlaceholder': t6(
    'Suche Name, Team, Riot-ID \u2026',
    'Search name, team, Riot ID \u2026',
    '\uC774\uB984, \uD300, Riot ID \uAC80\uC0C9\u2026',
    '\u641C\u7D22\u540D\u79F0\u3001\u6218\u961F\u3001Riot ID\u2026',
    'Buscar nombre, equipo, Riot ID\u2026',
    'Rechercher nom, \u00E9quipe, Riot ID\u2026'
  ),
  'tft.pros.col.player': t6(
    'Pro-Name / Real Name', 'Pro Name / Real Name',
    '\uD504\uB85C \uC774\uB984 / \uBCF8\uBA85', '\u804C\u4E1A ID / \u771F\u5B9E\u59D3\u540D',
    'Nombre Pro / Real', 'Nom Pro / R\u00E9el'
  ),
  'tft.pros.col.team': t6(
    'Team', 'Team', '\uD300', '\u6218\u961F', 'Equipo', '\u00C9quipe'
  ),
  'tft.pros.col.role': t6(
    'Rolle', 'Role', '\uC5ED\uD560', '\u89D2\u8272', 'Rol', 'R\u00F4le'
  ),
  'tft.pros.col.region': t6(
    'Region', 'Region', '\uC9C0\uC5ED', '\u533A\u57DF', 'Regi\u00F3n', 'R\u00E9gion'
  ),

  // \u2500 Pro-Picks Filter Toggle \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'tft.filter.proOnly': t6(
    'Nur Pros',
    'Pros Only',
    '\uD504\uB85C\uB9CC',
    '\u4EC5\u804C\u4E1A',
    'Solo Pros',
    'Pros uniquement'
  ),

  // \u2500 Comp Pro-vs-Solo-Queue Section \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'tft.comp.proVsSolo': t6(
    'Pro vs Solo-Queue',
    'Pro vs Solo Queue',
    '\uD504\uB85C vs \uC194\uB85C\uD050',
    '\u804C\u4E1A vs \u5355\u6392',
    'Pro vs Cola Solo',
    'Pro vs Solo Queue'
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
