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
  'nav.tftPros': t6('Pro-Spieler', 'Pro Player', '\uD504\uB85C \uC120\uC218', '\u804C\u4E1A\u9009\u624B', 'Jugadores Pro', 'Joueurs Pro'),
  'nav.rising': t6('Rising', 'Rising', '급상승', '上升榜', 'En ascenso', 'En progression'),
  'nav.onetricks': t6('One-Tricks', 'One-Tricks', '\uC6D0\uD2B8\uB9AD', '\u4E13\u7CBE\u73A9\u5BB6', 'One-Tricks', 'One-Tricks'),
  'nav.patchWinners': t6('Patch-Diff', 'Patch Diff', '\uD328\uCE58 \uBE44\uAD50', '\u7248\u672C\u53D8\u5316', 'Patch Diff', 'Patch Diff'),
  'nav.explorer': t6('Daten-Explorer', 'Data Explorer', '\uB370\uC774\uD130 \uD0D0\uC0C9\uAE30', '\u6570\u636E\u63A2\u7D22', 'Explorador de Datos', 'Explorateur de Donn\u00E9es'),
  'nav.rollOdds': t6('Roll-Wahrscheinlichkeiten', 'Roll Odds', '\uB864 \uD655\uB960', '\u5237\u65B0\u6982\u7387', 'Probabilidades de Roll', 'Probabilit\u00E9s de Roll'),
  'tft.explorer.title': t6('Daten-Explorer', 'Data Explorer', '\uB370\uC774\uD130 \uD0D0\uC0C9\uAE30', '\u6570\u636E\u63A2\u7D22', 'Explorador de Datos', 'Explorateur de Donn\u00E9es'),
  'tft.explorer.units': t6('Units', 'Units', '\uC720\uB2DB', '\u5355\u4F4D', 'Unidades', 'Unit\u00E9s'),
  'tft.explorer.items': t6('Items', 'Items', '\uC544\uC774\uD15C', '\u88C5\u5907', '\u00CDtems', 'Objets'),
  'tft.explorer.traits': t6('Synergien', 'Traits', '\uC2DC\uB108\uC9C0', '\u7F81\u7ECA', 'Sinergias', 'Synergies'),
  'tft.explorer.minGames': t6('Min. Spiele', 'Min. games', '\uCD5C\uC18C \uACBD\uAE30', '\u6700\u5C11\u573A\u6B21', 'M\u00EDn. partidas', 'Parties min.'),
  'tft.explorer.sort.avg': t6('\u00D8 Platz', 'Avg place', '\uD3C9\uADE0 \uC21C\uC704', '\u5E73\u5747\u540D\u6B21', 'Posici\u00F3n media', 'Place moy.'),
  'tft.explorer.sort.top4': t6('Top 4', 'Top 4', 'Top 4', 'Top 4', 'Top 4', 'Top 4'),
  'tft.explorer.sort.top1': t6('Sieg', 'Win', '\uC2B9\uB9AC', '\u80DC\u5229', 'Victoria', 'Victoire'),
  'tft.explorer.sort.games': t6('Spiele', 'Games', '\uACBD\uAE30', '\u573A\u6B21', 'Partidas', 'Parties'),
  'tft.tools.odds.title': t6('Roll-Wahrscheinlichkeiten', 'Roll Odds Calculator', '\uB864 \uD655\uB960 \uACC4\uC0B0\uAE30', '\u5237\u65B0\u6982\u7387\u8BA1\u7B97\u5668', 'Calculadora de Probabilidades', 'Calculatrice de Probabilit\u00E9s'),
  'tft.tools.odds.cost': t6('Kosten', 'Cost', '\uBE44\uC6A9', '\u8D39\u7528', 'Coste', 'Co\u00FBt'),
  'tft.tools.odds.costShort': t6('Cost', 'Cost', 'Cost', 'Cost', 'Cost', 'Cost'),
  'tft.tools.odds.level': t6('Level', 'Level', '\uB808\uBCA8', '\u7B49\u7EA7', 'Nivel', 'Niveau'),
  'tft.tools.odds.copiesOwned': t6('Eigene Kopien', 'Copies owned', '\uBCF4\uC720 \uBCF5\uC0AC\uBCF8', '\u62E5\u6709\u526F\u672C', 'Copias propias', 'Copies poss\u00E9d\u00E9es'),
  'tft.tools.odds.copiesContested': t6('Von anderen weg', 'Bought by others', '\uB2E4\uB978 \uC0AC\uB78C\uC774 \uAD6C\uB9E4', '\u4ED6\u4EBA\u8D2D\u4E70', 'Comprados por otros', 'Achet\u00E9s par autres'),
  'tft.tools.odds.othersOut': t6('Andere dieser Kosten weg', 'Others of this cost gone', '같은 비용 다른 유닛 소진', '同费其他单位已购', 'Otros de este coste fuera', 'Autres de ce coût partis'),
  'tft.tools.odds.totalPool': t6('Gesamt-Pool', 'Total pool', '\uC804\uCCB4 \uD480', '\u603B\u6C60', 'Pool total', 'Pool total'),
  'tft.tools.odds.copiesLeft': t6('Verbleibend', 'Copies left', '\uB0A8\uC740 \uBCF5\uC0AC\uBCF8', '\u5269\u4F59\u526F\u672C', 'Restantes', 'Restantes'),
  'tft.tools.odds.hitChance': t6('Treffer-Chance', 'Hit chance', '\uBA85\uC911 \uD655\uB960', '\u547D\u4E2D\u6982\u7387', 'Probabilidad de acierto', 'Probabilit\u00E9 de touche'),
  'tft.tools.odds.perSlot': t6('pro Slot', 'per slot', '\uC2AC\uB86F\uB2F9', '\u6BCF\u4E2A\u69FD\u4F4D', 'por casilla', 'par slot'),
  'tft.tools.odds.perShop': t6('pro Shop', 'per shop', '\uC0F5\uB2F9', '\u6BCF\u4E2A\u5546\u5E97', 'por tienda', 'par boutique'),
  'tft.tools.odds.costAtLevel': t6('Kosten-Anteil', 'Cost share', '\uBE44\uC6A9 \uBE44\uC728', '\u8D39\u7528\u5360\u6BD4', 'Cuota de coste', 'Part de co\u00FBt'),
  'tft.tools.odds.expected': t6('Erwartungswerte', 'Expected', '\uAE30\uB300\uAC12', '\u9884\u671F', 'Esperado', 'Attendu'),
  'tft.tools.odds.toNextHit': t6('Bis n\u00E4chster Treffer', 'To next hit', '\uB2E4\uC74C \uBA85\uC911\uAE4C\uC9C0', '\u5230\u4E0B\u4E00\u6B21\u547D\u4E2D', 'Hasta pr\u00F3ximo acierto', 'Jusqu\'au prochain hit'),
  'tft.tools.odds.toTwoStar': t6('Bis 2-Stern', 'To 2-star', '2\uC131\uAE4C\uC9C0', '\u52302\u661F', 'Hasta 2 estrellas', 'Jusqu\'\u00E0 2 \u00E9toiles'),
  'tft.tools.odds.toThreeStar': t6('Bis 3-Stern', 'To 3-star', '3\uC131\uAE4C\uC9C0', '\u52303\u661F', 'Hasta 3 estrellas', 'Jusqu\'\u00E0 3 \u00E9toiles'),
  'tft.tools.odds.shopOddsTable': t6('Shop-Odds-Tabelle', 'Shop odds table', '\uC0F5 \uD655\uB960\uD45C', '\u5546\u5E97\u6982\u7387\u8868', 'Tabla de probabilidades', 'Tableau des probabilit\u00E9s'),
  'nav.tables': t6('Tabellen', 'Tables', '\uD45C', '\u8868\u683C', 'Tablas', 'Tableaux'),
  'tft.tables.title': t6('Loot-Tabellen & Wisps', 'Loot Tables & Wisps', '\uC804\uB9AC\uD488 \uD45C & \uC704\uC2B5', '\u6218\u5229\u54C1\u8868 & \u5C0F\u7CBE\u7075', 'Tablas de bot\u00EDn y Wisps', 'Tables de butin & Wisps'),
  'tft.tables.loot': t6('Loot', 'Loot', '\uC804\uB9AC\uD488', '\u6218\u5229\u54C1', 'Bot\u00EDn', 'Butin'),
  'tft.tables.wisps': t6('Wisps', 'Wisps', '\uC704\uC2B5', '\u5C0F\u7CBE\u7075', 'Wisps', 'Wisps'),
  'tft.tables.source': t6('Daten:', 'Data:', '\uB370\uC774\uD130:', '\u6570\u636E\uFF1A', 'Datos:', 'Donn\u00E9es :'),
  'tft.tables.stage': t6('Stage', 'Stage', '\uC2A4\uD14C\uC774\uC9C0', '\u9636\u6BB5', 'Fase', '\u00C9tape'),
  'tft.tables.patch': t6('Patch', 'Patch', '\uD328\uCE58', '\u7248\u672C', 'Parche', 'Patch'),
  'tft.tables.essence': t6('Essenz', 'Essence', '\uC815\uC218', '\u7CBE\u534E', 'Esencia', 'Essence'),
  'tft.tables.traits': t6('{n} Synergien', '{n} traits', '\uC2DC\uB108\uC9C0 {n}\uAC1C', '{n}\u4E2A\u7F81\u7ECA', '{n} sinergias', '{n} synergies'),
  'tft.tables.face': t6('W\u00FCrfel {n}', 'Roll {n}', '\uC8FC\uC0AC\uC704 {n}', '\u9AB0\u5B50 {n}', 'Dado {n}', 'D\u00E9 {n}'),
  'tft.tables.sum': t6('Summe {v}', 'Sum {v}', '\uD569\uACC4 {v}', '\u603B\u548C {v}', 'Suma {v}', 'Somme {v}'),
  'tft.tables.gold': t6('Gold', 'Gold', '\uACE8\uB4DC', '\u91D1\u5E01', 'Oro', 'Or'),
  'tft.tables.rerolls': t6('Rerolls', 'Rerolls', '\uC0C8\uB85C\uACE0\uCE68', '\u5237\u65B0', 'Rerolls', 'Relances'),
  'tft.tables.hp': t6('+{v} Leben f\u00FCr alle Einheiten', '+{v} health for all units', '\uBAA8\uB4E0 \uC720\uB2DB \uCCB4\uB825 +{v}', '\u6240\u6709\u5355\u4F4D\u751F\u547D\u503C +{v}', '+{v} de vida para todas las unidades', '+{v} PV pour toutes les unit\u00E9s'),
  'tft.tables.randomUnit': t6('Zuf\u00E4lliger {c}-Kosten-Champion', 'Random {c}-cost champion', '\uBB34\uC791\uC704 {c}\uCF54\uC2A4\uD2B8 \uCC54\uD53C\uC5B8', '\u968F\u673A{c}\u8D39\u82F1\u96C4', 'Campe\u00F3n aleatorio de coste {c}', 'Champion al\u00E9atoire co\u00FBt {c}'),
  'tft.tables.costShort': t6('{c}-Kosten', '{c}-cost', '{c}\uCF54\uC2A4\uD2B8', '{c}\u8D39', 'coste {c}', 'co\u00FBt {c}'),
  'tft.tables.specialEgg': t6('Spezial-Ei ({n} Runden)', 'Special egg ({n} turns)', '\uD2B9\uBCC4\uD55C \uC54C ({n}\uB77C\uC6B4\uB4DC)', '\u7279\u6B8A\u86CB\uFF08{n}\u56DE\u5408\uFF09', 'Huevo especial ({n} rondas)', '\u0152uf sp\u00E9cial ({n} tours)'),
  'tft.tables.r.component': t6('Komponente', 'Component', '\uC7AC\uB8CC \uC544\uC774\uD15C', '\u6563\u4EF6', 'Componente', 'Composant'),
  'tft.tables.r.fullItem': t6('Fertiges Item', 'Completed item', '\uC644\uC131 \uC544\uC774\uD15C', '\u6210\u88C5', 'Objeto completo', 'Objet complet'),
  'tft.tables.r.radiant': t6('Strahlendes Item', 'Radiant item', '\uCC2C\uB780\uD55C \uC544\uC774\uD15C', '\u5149\u660E\u88C5\u5907', 'Objeto radiante', 'Objet radieux'),
  'tft.tables.r.emblem': t6('Emblem', 'Emblem', '\uC0C1\uC9D5', '\u7EB9\u7AE0', 'Emblema', 'Embl\u00E8me'),
  'tft.tables.r.artifact': t6('Artefakt', 'Artifact', '\uC720\uBB3C', '\u795E\u5668', 'Artefacto', 'Artefact'),
  'tft.tables.r.tacticianItem': t6('Taktiker-Item', 'Tactician item', '\uC804\uB7B5\uAC00 \uC544\uC774\uD15C', '\u6307\u6325\u5B98\u88C5\u5907', 'Objeto de estratega', 'Objet de tacticien'),
  'tft.tables.r.sameComponent': t6('gleiche Komponente', 'same component', '\uAC19\uC740 \uC7AC\uB8CC \uC544\uC774\uD15C', '\u76F8\u540C\u6563\u4EF6', 'mismo componente', 'm\u00EAme composant'),
  'tft.tables.r.uniqueComponents': t6('verschiedene Komponenten', 'different components', '\uC11C\uB85C \uB2E4\uB978 \uC7AC\uB8CC \uC544\uC774\uD15C', '\u4E0D\u540C\u6563\u4EF6', 'componentes distintos', 'composants diff\u00E9rents'),
  'tft.tables.units': t6('Einheiten', 'Units', '\uC720\uB2DB', '\u5355\u4F4D', 'Unidades', 'Unit\u00E9s'),
  'tft.tables.perKill': t6('Pro Kill', 'Per kill', '\uCC98\uCE58\uB2F9', '\u6BCF\u6B21\u51FB\u6740', 'Por baja', 'Par \u00E9limination'),
  'tft.tables.perLoss': t6('Pro Niederlage', 'Per loss', '\uD328\uBC30\uB2F9', '\u6BCF\u6B21\u5931\u8D25', 'Por derrota', 'Par d\u00E9faite'),
  'tft.tables.ap': t6('AP', 'AP', 'AP', 'AP', 'AP', 'AP'),
  'tft.tables.tier': t6('Stufe', 'Tier', '\uD2F0\uC5B4', '\u7B49\u7EA7', 'Nivel', 'Palier'),
  'tft.tables.mode': t6('Modus', 'Mode', '\uBAA8\uB4DC', '\u6A21\u5F0F', 'Modo', 'Mode'),
  'tft.tables.all': t6('Alle', 'All', '\uC804\uCCB4', '\u5168\u90E8', 'Todos', 'Tous'),
  'tft.tables.upgrade': t6('Upgrade', 'Upgrade', '\uC5C5\uADF8\uB808\uC774\uB4DC', '\u5347\u7EA7', 'Mejora', 'Am\u00E9lioration'),
  'tft.tables.prismatic': t6('Prismatisch', 'Prismatic', '\uD504\uB9AC\uC998', '\u68F1\u5F69', 'Prism\u00E1tico', 'Prismatique'),
  'tft.tables.requires': t6('Bedingung:', 'Requires:', '\uC870\uAC74:', '\u6761\u4EF6\uFF1A', 'Requisito:', 'Condition :'),
  'tft.tables.excludes': t6('Nicht zusammen mit:', 'Excludes:', '\uD568\uAED8 \uBD88\uAC00:', '\u4E92\u65A5\uFF1A', 'Excluye:', 'Exclut :'),
  'tft.tables.round.Early': t6('Fr\u00FCh', 'Early', '\uCD08\uBC18', '\u524D\u671F', 'Temprano', 'D\u00E9but'),
  'tft.tables.round.EarlyMid': t6('Fr\u00FCh-Mitte', 'Early-mid', '\uCD08\uC911\uBC18', '\u524D\u4E2D\u671F', 'Temprano-medio', 'D\u00E9but-milieu'),
  'tft.tables.round.Mid': t6('Mitte', 'Mid', '\uC911\uBC18', '\u4E2D\u671F', 'Medio', 'Milieu'),
  'tft.tables.round.MidLate': t6('Mitte-Sp\u00E4t', 'Mid-late', '\uC911\uD6C4\uBC18', '\u4E2D\u540E\u671F', 'Medio-tard\u00EDo', 'Milieu-fin'),
  'tft.tables.round.Late': t6('Sp\u00E4t', 'Late', '\uD6C4\uBC18', '\u540E\u671F', 'Tard\u00EDo', 'Fin'),
  'tft.tables.round.VeryLate': t6('Sehr sp\u00E4t', 'Very late', '\uCD5C\uD6C4\uBC18', '\u672B\u671F', 'Muy tard\u00EDo', 'Tr\u00E8s tard'),
  'tft.tables.cat': t6('Art', 'Type', '\uC720\uD615', '\u7C7B\u578B', 'Tipo', 'Type'),
  'tft.tables.cat.Champion': t6('Champion', 'Champion', '\uCC54\uD53C\uC5B8', '\u82F1\u96C4', 'Campe\u00F3n', 'Champion'),
  'tft.tables.cat.Combat': t6('Kampf', 'Combat', '\uC804\uD22C', '\u6218\u6597', 'Combate', 'Combat'),
  'tft.tables.cat.GoldXP': t6('Gold & XP', 'Gold & XP', '\uACE8\uB4DC & \uACBD\uD5D8\uCE58', '\u91D1\u5E01\u548C\u7ECF\u9A8C', 'Oro y XP', 'Or et XP'),
  'tft.tables.cat.Item': t6('Item', 'Item', '\uC544\uC774\uD15C', '\u88C5\u5907', 'Objeto', 'Objet'),
  'tft.tables.cat.Misc': t6('Sonstiges', 'Misc', '\uAE30\uD0C0', '\u5176\u4ED6', 'Varios', 'Divers'),
  'tft.tables.cat.Risky': t6('Riskant', 'Risky', '\uC704\uD5D8', '\u5192\u9669', 'Arriesgado', 'Risqu\u00E9'),
  'tft.tables.cat.Shop': t6('Shop', 'Shop', '\uC0C1\uC810', '\u5546\u5E97', 'Tienda', 'Boutique'),
  'tft.tables.soloOnly': t6('Nur Solo', 'Solo only', '\uC194\uB85C \uC804\uC6A9', '\u4EC5\u5355\u4EBA', 'Solo individual', 'Solo uniquement'),
  'tft.tables.cooldown': t6('Cooldown:', 'Cooldown:', '\uCFE8\uB2E4\uC6B4:', '\u51B7\u5374\uFF1A', 'Enfriamiento:', 'Recharge :'),
  'tft.tables.details': t6('Details', 'Details', '\uC0C1\uC138', '\u8BE6\u60C5', 'Detalles', 'D\u00E9tails'),
  'nav.leagues': t6('Ligen & Wettbewerbe', 'Leagues & Competitions', '\uB9AC\uADF8 & \uB300\uD68C', '\u8054\u8D5B & \u6BD4\u8D5B', 'Ligas & Competiciones', 'Ligues & Comp\u00E9titions'),
  'nav.searchPlaceholder': t6('Spieler / Champion...', 'Player / Champion...', '\uD50C\uB808\uC774\uC5B4 / \uCC54\uD53C\uC5B8...', '\u73A9\u5BB6 / \u82F1\u96C4...', 'Jugador / Campe\u00F3n...', 'Joueur / Champion...'),
  'nav.searchPlaceholderTft': t6('Spieler / Unit / Item...', 'Player / Unit / Item...', '\uD50C\uB808\uC774\uC5B4 / \uC720\uB2DB / \uC544\uC774\uD15C...', '\u73A9\u5BB6 / \u5355\u4F4D / \u88C5\u5907...', 'Jugador / Unidad / \u00CDtem...', 'Joueur / Unit\u00E9 / Objet...'),
  'nav.units': t6('Units', 'Units', '\uC720\uB2DB', '\u5355\u4F4D', 'Unidades', 'Unit\u00E9s'),
  'nav.items': t6('Items', 'Items', '\uC544\uC774\uD15C', '\u88C5\u5907', '\u00CDtems', 'Objets'),
  'nav.augments': t6('Augments', 'Augments', '\uC99D\uAC15', '\u5F3A\u5316\u7B26\u6587', 'Aumentos', 'Augments'),
  'nav.comps': t6('Comps', 'Comps', '\uC870\uD569', '\u9635\u5BB9', 'Comps', 'Comps'),
  'nav.meta': t6('Meta', 'Meta', '\uBA54\uD0C0', 'Meta', 'Meta', 'Meta'),
  'nav.traits': t6('Synergien', 'Traits', '\uC2DC\uB108\uC9C0', '\u7F81\u7ECA', 'Sinergias', 'Synergies'),
  'game.switch': t6('Spiel wechseln', 'Switch game', '\uAC8C\uC784 \uC804\uD658', '\u5207\u6362\u6E38\u620F', 'Cambiar juego', 'Changer de jeu'),
  'game.lol': t6('League of Legends', 'League of Legends', '\uB9AC\uADF8 \uC624\uBE0C \uB808\uC804\uB4DC', '\u82F1\u96C4\u8054\u76DF', 'League of Legends', 'League of Legends'),
  'game.tft': t6('Teamfight Tactics', 'Teamfight Tactics', '\uC804\uB7B5\uC801 \uD300 \uC804\uD22C', '\u4E91\u9876\u4E4B\u5F08', 'Teamfight Tactics', 'Teamfight Tactics'),
  'gamestrip.home': t6('Startseite', 'Home', '\uD648', '\u9996\u9875', 'Inicio', 'Accueil'),
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
  'tft.bucket.grandmaster_plus': t6('Grandmaster+', 'Grandmaster+', '\uADF8\uB79C\uB4DC\uB9C8\uC2A4\uD130+', '\u5B97\u5E08+', 'Grand Maestro+', 'Grand Ma\u00EEtre+'),
  'tft.bucket.diamond': t6('Diamant', 'Diamond', '\uB2E4\uC774\uC544', '\u94BB\u77F3', 'Diamante', 'Diamant'),
  'tft.bucket.diamond_plus': t6('Diamant+', 'Diamond+', '\uB2E4\uC774\uC544+', '\u94BB\u77F3+', 'Diamante+', 'Diamant+'),
  'tft.bucket.emerald_plus': t6('Smaragd+', 'Emerald+', '\uC5D0\uBA54\uB784\uB4DC+', '\u7FE1\u7FE0+', 'Esmeralda+', '\u00C9meraude+'),
  'tft.bucket.platinum_plus': t6('Platin+', 'Platinum+', '\uD50C\uB798\uD2F0\uB118+', '\u94C2\u91D1+', 'Platino+', 'Platine+'),
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
  'tft.bottom4': t6('Bottom 4', 'Bottom 4', '바텀 4', 'Bottom 4', 'Bottom 4', 'Bottom 4'),
  'tft.top1': t6('Sieg', 'Win', '1\uC704', '\u51A0\u519B', 'Victoria', 'Victoire'),
  'tft.pickRate': t6('Pickrate', 'Pick rate', '\uD53D\uB960', '\u4F7F\u7528\u7387', 'Pickrate', 'Pickrate'),
  'tft.gamesShort': t6('Spiele', 'Games', '\uACBD\uAE30', '\u6BD4\u8D5B', 'Partidas', 'Matchs'),
  'tft.cost': t6('Kosten', 'Cost', '\uBE44\uC6A9', '\u8D39\u7528', 'Coste', 'Co\u00FBt'),
  'tft.activation': t6('Aktivierung', 'Activation', '\uD65C\uC131\uD654', '\u6FC0\u6D3B', 'Activaci\u00F3n', 'Activation'),
  'tft.slot': t6('Slot', 'Slot', '\uC2AC\uB86F', '\u69FD\u4F4D', 'Slot', 'Slot'),
  'tft.allSlots': t6('Alle Slots', 'All slots', '\uBAA8\uB4E0 \uC2AC\uB86F', '\u6240\u6709\u69FD\u4F4D', 'Todos los slots', 'Tous les slots'),
  'tft.topBuilds': t6('Top Item-Builds', 'Top Item Builds', '\uCD5C\uACE0 \uC544\uC774\uD15C \uBE4C\uB4DC', '\u6700\u4F73\u51FA\u88C5', 'Mejores Builds', 'Meilleurs Builds'),
  'tft.byStarLevel': t6('Nach Stern-Level', 'By star level', '\uBCC4 \uB808\uBCA8\uBCC4', '\u6309\u661F\u7EA7', 'Por nivel de estrella', 'Par niveau d\u2019\u00E9toile'),
  'tft.starTierAll': t6('Alle', 'All', '\uC804\uCCB4', '\u5168\u90E8', 'Todos', 'Tous'),
  'tft.damageAtlas': t6('Spieler-HP-Schaden als Carry', 'Player-HP damage as carry', '\uCE90\uB9AC\uC758 \uD50C\uB808\uC774\uC5B4 HP \uD53C\uD574', '\u4F5C\u4E3A\u6838\u5FC3\u5BF9\u73A9\u5BB6\u751F\u547D\u7684\u4F24\u5BB3', 'Da\u00F1o a vida de jugadores como Carry', 'D\u00E9g\u00E2ts aux PV joueurs en Carry'),
  'tft.damageAtlasCaption': t6(
    'HP-Schaden an Mitspielern (kein Unit-Combat-Schaden) \u2014 dem Carry zugeordnet',
    'HP damage to other players (not unit combat damage) \u2014 attributed to the carry',
    '\uB2E4\uB978 \uD50C\uB808\uC774\uC5B4 HP\uC5D0 \uAC00\uD55C \uD53C\uD574 (\uC720\uB2DB \uC804\uD22C \uD53C\uD574 \uC544\uB2D8) \u2014 \uCE90\uB9AC\uC5D0 \uADC0\uC18D',
    '\u5BF9\u5176\u4ED6\u73A9\u5BB6\u751F\u547D\u503C\u7684\u4F24\u5BB3\uFF08\u975E\u5355\u4F4D\u6218\u6597\u4F24\u5BB3\uFF09\u2014 \u5F52\u4E8E\u6838\u5FC3',
    'Da\u00F1o a la vida de otros jugadores (no da\u00F1o de combate de unidades) \u2014 atribuido al carry',
    'D\u00E9g\u00E2ts aux PV des autres joueurs (pas les d\u00E9g\u00E2ts de combat des unit\u00E9s) \u2014 attribu\u00E9s au carry'
  ),
  'tft.dmgTypical': t6('Typisch', 'Typical', '\uC77C\uBC18', '\u5178\u578B', 'T\u00EDpico', 'Typique'),
  'tft.dmgPeak': t6('Spitze', 'Peak', '\uCD5C\uACE0', '\u5CF0\u503C', 'Pico', 'Pic'),
  'tft.carryStrength': t6('Carry-St\u00E4rke', 'Carry Strength', '\uCE90\uB9AC \uC131\uB2A5', '\u6838\u5FC3\u5F3A\u5EA6', 'Fuerza como Carry', 'Puissance en Carry'),
  'tft.carryStrengthCaption': t6(
    '\u00D8-Platzierung & Top-4, wenn diese Unit der Carry ist',
    'Avg placement & Top-4 when this unit is the carry',
    '\uC774 \uC720\uB2DB\uC774 \uCE90\uB9AC\uC77C \uB54C\uC758 \uD3C9\uADE0 \uB4F1\uC218 & Top-4',
    '\u5F53\u8BE5\u5355\u4F4D\u4E3A\u6838\u5FC3\u65F6\u7684\u5E73\u5747\u540D\u6B21\u4E0E Top-4',
    'Posici\u00F3n media y Top-4 cuando esta unidad es el carry',
    'Placement moyen & Top-4 quand cette unit\u00E9 est le carry'
  ),
  'tft.carryAvgPlace': t6('\u00D8 Platz.', 'Avg place', '\uD3C9\uADE0 \uB4F1\uC218', '\u5E73\u5747\u540D\u6B21', 'Pos. media', 'Place. moy.'),
  'tft.stars': t6('Sterne', 'Stars', '\uBCC4', '\u661F\u7EA7', 'Estrellas', '\u00C9toiles'),
  'tft.itemsShort': t6('Items', 'Items', '\uC544\uC774\uD15C', '\u88C5\u5907', '\u00CDtems', 'Objets'),
  'tft.comp.deathCurve': t6('Sterbe-Verteilung & Top-4-Survival', 'Death distribution & Top-4 survival', '\uC0AC\uB9DD \uBD84\uD3EC & Top-4 \uC0DD\uC874', '\u9635\u4EA1\u5206\u5E03 & Top-4 \u5B58\u6D3B', 'Distribuci\u00F3n de muerte y supervivencia Top-4', 'Distribution de mort & survie Top-4'),
  'tft.comp.modeRound': t6('H\u00E4ufigster Tod', 'Most common death', '\uAC00\uC7A5 \uD754\uD55C \uC0AC\uB9DD', '\u6700\u5E38\u9635\u4EA1\u56DE\u5408', 'Muerte m\u00E1s com\u00FAn', 'Mort la plus fr\u00E9quente'),
  'tft.comp.survivalInflection': t6('Top-4-Schwelle', 'Top-4 threshold', 'Top-4 \uC784\uACC4\uC810', 'Top-4 \u4E34\u754C\u70B9', 'Umbral Top-4', 'Seuil Top-4'),
  'tft.comp.inflectionShare': t6('Spieler-Anteil', 'Player share', '\uD50C\uB808\uC774\uC5B4 \uBE44\uC911', '\u73A9\u5BB6\u5360\u6BD4', 'Cuota de jugadores', 'Part des joueurs'),
  'tft.comp.dieHere': t6('Hier gestorben', 'Died here', '\uC5EC\uAE30\uC11C \uC0AC\uB9DD', '\u5728\u6B64\u9635\u4EA1', 'Murieron aqu\u00ED', 'Mort ici'),
  'tft.comp.survivalChart': t6('Top-4-Wahrscheinlichkeit', 'Top-4 probability', 'Top-4 \uD655\uB960', 'Top-4 \u6982\u7387', 'Probabilidad Top-4', 'Probabilit\u00E9 Top-4'),
  'tft.comp.death.title': t6('Spielverlauf & Top-4-Chance', 'Game progression & Top-4 chance', '\uAC8C\uC784 \uC9C4\uD589 & Top-4 \uD655\uB960', '\u6E38\u620F\u8FDB\u7A0B\u4E0E Top-4 \u6982\u7387', 'Progresi\u00F3n & probabilidad Top-4', 'Progression & probabilit\u00E9 Top-4'),
  'tft.comp.death.stable': t6('Top-4 stabilisiert', 'Top-4 locked in', 'Top-4 \uC548\uC815\uD654', 'Top-4 \u7A33\u5B9A', 'Top-4 estable', 'Top-4 verrouill\u00E9'),
  'tft.comp.death.thresholdSub': t6('Solide Top-4-Chance ab hier', 'Solid Top-4 chance from here', '\uC5EC\uAE30\uC11C\uBD80\uD130 \uC548\uC815\uC801\uC778 Top-4 \uD655\uB960', '\u6B64\u540E\u7A33\u83B7 Top-4 \u673A\u4F1A', 'Buena probabilidad Top-4 desde aqu\u00ED', 'Bonne chance Top-4 d\u00E8s ici'),
  'tft.comp.death.stableSub': t6('Top-4 fast garantiert', 'Top-4 almost guaranteed', 'Top-4 \uAC70\uC758 \uD655\uC815', 'Top-4 \u51E0\u4E4E\u7A33\u5B9A', 'Top-4 casi garantizado', 'Top-4 quasi garanti'),
  'tft.comp.detail.prosPlayingThis': t6('Pros mit dieser Comp', 'Pros playing this comp', '\uC774 \uC870\uD569\uC744 \uD50C\uB808\uC774\uD558\uB294 \uD504\uB85C', '\u4F7F\u7528\u6B64\u9635\u5BB9\u7684\u804C\u4E1A\u73A9\u5BB6', 'Pros jugando esta comp', 'Pros jouant cette comp'),
  'tft.comp.death.commonSub': t6('{share}% der Spiele \u00B7 {phase}', '{share}% of games \u00B7 {phase}', '\uAC8C\uC784\uC758 {share}% \u00B7 {phase}', '{share}% \u5BF9\u5C40 \u00B7 {phase}', '{share}% de partidas \u00B7 {phase}', '{share}% des parties \u00B7 {phase}'),
  'tft.comp.death.story.dies': t6('Diese Comp stirbt typischerweise im {phase} (Stage {stage}).', 'This comp typically dies in the {phase} (Stage {stage}).', '\uC774 \uC870\uD569\uC740 \uBCF4\uD1B5 {phase}\uC5D0 \uC0AC\uB9DD\uD569\uB2C8\uB2E4 (\uC2A4\uD14C\uC774\uC9C0 {stage}).', '\u8BE5\u9635\u5BB9\u901A\u5E38\u5728{phase}\u9635\u4EA1\uFF08\u9636\u6BB5 {stage}\uFF09\u3002', 'Esta comp suele morir en el {phase} (Stage {stage}).', 'Cette comp meurt typiquement au {phase} (\u00E9tape {stage}).'),
  'tft.comp.death.story.stable': t6('\u00DCberlebst du Stage {stage}, landest du in \u00FCber {pct}% der Spiele in den Top 4.', 'If you survive Stage {stage}, you finish Top 4 in over {pct}% of games.', '\uC2A4\uD14C\uC774\uC9C0 {stage}\uAE4C\uC9C0 \uC0DD\uC874\uD558\uBA74 {pct}% \uC774\uC0C1\uC758 \uAC8C\uC784\uC5D0\uC11C Top 4\uC5D0 \uC9C4\uC785\uD569\uB2C8\uB2E4.', '\u5982\u679C\u4F60\u6491\u5230\u9636\u6BB5 {stage}\uFF0C\u5C06\u5728\u8D85\u8FC7 {pct}% \u7684\u5BF9\u5C40\u4E2D\u83B7\u5F97 Top 4\u3002', 'Si sobrevives al Stage {stage}, terminas Top 4 en m\u00E1s del {pct}% de partidas.', 'Si tu survis \u00E0 l\'\u00E9tape {stage}, tu finis Top 4 dans plus de {pct}% des parties.'),
  'tft.comp.death.story.threshold': t6('Ab Stage {stage} liegt deine Top-4-Chance bei {pct}%.', 'From Stage {stage} onward your Top-4 chance is {pct}%.', '\uC2A4\uD14C\uC774\uC9C0 {stage}\uBD80\uD130 Top-4 \uD655\uB960\uC740 {pct}%\uC785\uB2C8\uB2E4.', '\u4ECE\u9636\u6BB5 {stage} \u8D77\uFF0C\u4F60\u7684 Top-4 \u6982\u7387\u4E3A {pct}%\u3002', 'A partir del Stage {stage}, tu probabilidad Top-4 es {pct}%.', '\u00C0 partir de l\'\u00E9tape {stage}, ta chance Top-4 est de {pct}%.'),
  'tft.comp.death.detailsToggle': t6('Detail-Verlauf anzeigen', 'Show detailed timeline', '\uC0C1\uC138 \uD0C0\uC784\uB77C\uC778 \uD45C\uC2DC', '\u663E\u793A\u8BE6\u7EC6\u65F6\u95F4\u7EBF', 'Mostrar l\u00EDnea de tiempo detallada', 'Afficher la chronologie d\u00E9taill\u00E9e'),
  'tft.comp.phase.early': t6('Early-Game', 'Early-Game', '\uCD08\uBC18', '\u524D\u671F', 'Early-Game', 'D\u00E9but'),
  'tft.comp.phase.mid': t6('Mid-Game', 'Mid-Game', '\uC911\uBC18', '\u4E2D\u671F', 'Mid-Game', 'Milieu'),
  'tft.comp.phase.late': t6('Late-Game', 'Late-Game', '\uD6C4\uBC18', '\u540E\u671F', 'Late-Game', 'Fin'),
  'tft.comp.phase.end': t6('End-Game', 'End-Game', '\uC885\uBC18', '\u7EC8\u5C40', 'End-Game', 'Finale'),
  'tft.comp.phase.earlyRange': t6('Stage 2-3', 'Stage 2-3', '\uC2A4\uD14C\uC774\uC9C0 2-3', '\u9636\u6BB5 2-3', 'Stage 2-3', '\u00C9tape 2-3'),
  'tft.comp.phase.midRange': t6('Stage 4', 'Stage 4', '\uC2A4\uD14C\uC774\uC9C0 4', '\u9636\u6BB5 4', 'Stage 4', '\u00C9tape 4'),
  'tft.comp.phase.lateRange': t6('Stage 5-6', 'Stage 5-6', '\uC2A4\uD14C\uC774\uC9C0 5-6', '\u9636\u6BB5 5-6', 'Stage 5-6', '\u00C9tape 5-6'),
  'tft.comp.phase.endRange': t6('Stage 7+', 'Stage 7+', '\uC2A4\uD14C\uC774\uC9C0 7+', '\u9636\u6BB5 7+', 'Stage 7+', '\u00C9tape 7+'),
  'tft.comp.phase.diedHere': t6('Spielende', 'Games ended', '\uAC8C\uC784 \uC885\uB8CC', '\u5BF9\u5C40\u7ED3\u675F', 'Partidas finalizadas', 'Parties termin\u00E9es'),
  'tft.comp.phase.top4IfSurvived': t6('Top-4 wenn \u00FCberlebt', 'Top-4 if survived', '\uC0DD\uC874 \uC2DC Top-4', '\u5B58\u6D3B\u540E Top-4', 'Top-4 si sobrevives', 'Top-4 si survie'),
  'tft.comp.compDna': t6('Comp-DNA', 'Comp DNA', '\uC870\uD569 DNA', '\u9635\u5BB9 DNA', 'ADN de la comp', 'ADN de la comp'),
  'tft.comp.aggroIndex': t6('Eliminierte Gegner \u00D8', 'Eliminations per game', '\uACE0\uC18C\uB108 \uC81C\uAC70 \uD3C9\uADE0', '\u6DD8\u6C70\u73A9\u5BB6\u5747\u503C', 'Eliminaciones promedio', 'Adversaires \u00E9limin\u00E9s \u00D8'),
  'tft.comp.aggro.perGame': t6('pro Spiel', 'per game', '\uAC8C\uC784\uB2F9', '\u6BCF\u5C40', 'por partida', 'par partie'),
  'tft.comp.aggro.lobbyAvg': t6('Liga-\u00D8', 'Lobby avg', '\uB85C\uBE44 \uD3C9\uADE0', '\u5BF9\u5C40\u5747\u503C', 'Promedio del lobby', 'Moy. lobby'),
  'tft.comp.aggro.style': t6('Stil', 'Style', '\uC2A4\uD0C0\uC77C', '\u98CE\u683C', 'Estilo', 'Style'),
  'tft.comp.aggro.push': t6('Push-Streak-Comp', 'Push-streak comp', '\uC5F0\uC2B9 \uAC15\uD589 \uC870\uD569', '\u8FDE\u80DC\u63A8\u8FDB\u578B', 'Comp de racha agresiva', 'Comp push-streak'),
  'tft.comp.aggro.balanced': t6('Ausgewogen', 'Balanced', '\uADE0\uD615 \uC7A1\uD78C', '\u5E73\u8861\u578B', 'Equilibrada', '\u00C9quilibr\u00E9e'),
  'tft.comp.aggro.econ': t6('Econ-Cost-Comp', 'Econ-cost comp', '\uACBD\uC81C \uB204\uC801\uD615', '\u7ECF\u6D4E\u82DF\u4F4F\u578B', 'Comp de econom\u00EDa', 'Comp econ-cost'),
  'tft.comp.skillCap': t6('Schwierigkeit', 'Difficulty', '\uB09C\uC774\uB3C4', '\u96BE\u5EA6', 'Dificultad', 'Difficult\u00E9'),
  'tft.comp.skillCap.execution': t6('Skill-intensiv', 'Skill-intensive', '\uACE0\uB09C\uB3C4', '\u9AD8\u96BE\u5EA6', 'Exigente', 'Exigeante'),
  'tft.comp.skillCap.medium': t6('Erfordert \u00DCbung', 'Requires practice', '\uC5F0\uC2B5 \uD544\uC694', '\u9700\u8981\u7EC3\u4E60', 'Requiere pr\u00E1ctica', 'Demande de la pratique'),
  'tft.comp.skillCap.consistent': t6('Konstant', 'Consistent', '\uC77C\uAD00\uB428', '\u7A33\u5B9A', 'Consistente', 'Constante'),
  'tft.comp.levelTempo': t6('Spieltempo', 'Game pace', '\uAC8C\uC784 \uD15C\uD3EC', '\u6E38\u620F\u8282\u594F', 'Ritmo de partida', 'Rythme de partie'),
  'tft.comp.levelShare': t6('Spiel-Anteil', 'Game share', '\uAC8C\uC784 \uBE44\uC911', '\u5BF9\u5C40\u5360\u6BD4', 'Cuota de partidas', 'Part des parties'),
  'tft.comp.tempo.peakLevel': t6('Schwerpunkt', 'Typically', '\uC8FC\uB825 \uB808\uBCA8', '\u4E3B\u529B\u7B49\u7EA7', 'Nivel t\u00EDpico', 'Niveau cible'),
  'tft.comp.tempo.avgEnd': t6('Spielende \u00D8', 'Ends around', '\uAC8C\uC784 \uC885\uB8CC \uD3C9\uADE0', '\u7ED3\u675F\u9636\u6BB5\u5747\u503C', 'Final t\u00EDpico', 'Fin moyenne'),
  'tft.comp.tempo.reroll': t6('Reroll', 'Reroll', '\uB9AC\uB864', 'Reroll', 'Reroll', 'Reroll'),
  'tft.comp.tempo.rerollCost': t6('{cost}-Cost-Reroll', '{cost}-Cost Reroll', '{cost}\uCF54\uC2A4\uD2B8 \uB9AC\uB864', '{cost}\u8D39\u518D\u968F', 'Reroll de {cost} costes', 'Reroll {cost} co\u00FBts'),
  'tft.comp.tempo.standard': t6('Standard', 'Standard', '\uC2A4\uD0E0\uB2E4\uB4DC', '\u6807\u51C6', 'Est\u00E1ndar', 'Standard'),
  'tft.comp.tempo.fast9': t6('Fast-9', 'Fast-9', '\uD328\uC2A4\uD2B8 9', 'Fast-9', 'Fast-9', 'Fast-9'),
  'tft.comp.tempo.capout': t6('Cap-Out', 'Cap-Out', '\uCEA1 \uC544\uC6C3', '\u6781\u9650\u9635\u5BB9', 'Cap-Out', 'Cap-Out'),
  'tft.comp.board.title': t6('Board-Zusammensetzung', 'Board composition', '\uBCF4\uB4DC \uAD6C\uC131', '\u9635\u5BB9\u6784\u6210', 'Composici\u00F3n del board', 'Composition du board'),
  'tft.comp.board.core': t6('Core', 'Core', '\uACE0\uC815', '\u6838\u5FC3', 'N\u00FAcleo', 'C\u0153ur'),
  'tft.comp.board.flex': t6('Flex', 'Flex', '\uC720\uC5F0', '\u5F39\u6027', 'Flex', 'Flex'),
  'tft.comp.board.tech': t6('Tech', 'Tech', '\uD14C\uD06C', '\u6280\u672F\u4F4D', 'Tech', 'Tech'),
  'tft.comp.matchups': t6('Matchups & Konter', 'Matchups & counters', '\uB9E4\uCE58\uC5C5 & \uCE74\uC6B4\uD130', '\u5BF9\u4F4D\u4E0E\u514B\u5236', 'Enfrentamientos y counters', 'Matchups & counters'),
  'tft.comp.beats': t6('Schl\u00E4gt', 'Beats', '\uC6B0\uC138', '\u514B\u5236', 'Vence a', 'Bat'),
  'tft.comp.even': t6('Ausgeglichen', 'Even', '\uB300\uB4F1', '\u52BF\u5747\u529B\u654C', 'Igualado', '\u00C9quilibr\u00E9'),
  'tft.comp.losesTo': t6('Verliert gegen', 'Loses to', '\uC5F4\uC138', '\u88AB\u514B\u5236', 'Pierde contra', 'Perd contre'),
  'tft.comp.noMatchupData': t6('Noch keine Matchup-Daten', 'No matchup data yet', '\uC544\uC9C1 \uB9E4\uCE58\uC5C5 \uB370\uC774\uD130 \uC5C6\uC74C', '\u6682\u65E0\u5BF9\u4F4D\u6570\u636E', 'Sin datos de enfrentamiento', 'Pas encore de donn\u00E9es'),
  'tft.itemSlotOrder': t6('Item-Build-Reihenfolge', 'Item build order', '\uC544\uC774\uD15C \uBE4C\uB4DC \uC21C\uC11C', '\u88C5\u5907\u51FA\u88C5\u987A\u5E8F', 'Orden de construcci\u00F3n', 'Ordre de construction'),
  'tft.unitTimeline': t6('Patch-Verlauf', 'Patch timeline', '\uD328\uCE58 \uCD94\uC774', '\u7248\u672C\u8D70\u52BF', 'Cronolog\u00EDa de parches', '\u00C9volution par patch'),
  'tft.builderPublish': t6('Ver\u00F6ffentlichen', 'Publish', '\uAC8C\uC2DC', '\u53D1\u5E03', 'Publicar', 'Publier'),
  'tft.builderPublishHint': t6(
    'Comp im Community-Galerie teilen \u2014 sichtbar f\u00FCr alle.',
    'Share comp in the community gallery \u2014 visible to everyone.',
    '\uCEE4\uBBA4\uB2C8\uD2F0 \uAC24\uB7EC\uB9AC\uC5D0 \uACF5\uC720',
    '\u5728\u793E\u533A\u753B\u5ECA\u5206\u4EAB',
    'Compartir en galer\u00EDa comunitaria',
    'Partager dans la galerie communautaire'
  ),
  'tft.builderPublishName': t6('Name der Comp', 'Comp name', '\uC870\uD569 \uC774\uB984', '\u9635\u5BB9\u540D\u79F0', 'Nombre de la comp', 'Nom de la comp'),
  'tft.builderPublishHandle': t6('Dein Anzeigename (optional)', 'Your display name (optional)', '\uD45C\uC2DC \uC774\uB984 (\uC120\uD0DD)', '\u663E\u793A\u540D (\u53EF\u9009)', 'Tu nombre (opcional)', 'Ton nom (optionnel)'),
  'tft.builderPublished': t6('Geteilt', 'Published', '\uAC8C\uC2DC\uB428', '\u5DF2\u53D1\u5E03', 'Publicado', 'Publi\u00E9'),
  'tft.builderPublishErr': t6('Fehler', 'Error', '\uC624\uB958', '\u9519\u8BEF', 'Error', 'Erreur'),
  // Cross-Drill ins Data-Explorer (Klick auf Detail-Page-Header)
  'tft.drill.openInExplorer': t6('Im Explorer \u00F6ffnen', 'Open in Explorer', '\uD0D0\uC0C9\uAE30\uC5D0\uC11C \uC5F4\uAE30', '\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00', 'Abrir en Explorador', 'Ouvrir dans l\'Explorateur'),
  // Explorer Item-Picker-Tabs (Standard-Combat vs Artefakte)
  // Explorer Filter-Visibility (Chip-Leiste + Empty-State-Diagnose)
  'tft.explorer.resetAll': t6('Alle zur\u00FCcksetzen', 'Reset all', '\uBAA8\uB450 \uCD08\uAE30\uD654', '\u5168\u90E8\u91CD\u7F6E', 'Restablecer todo', 'Tout r\u00E9initialiser'),
  'tft.explorer.noResults': t6('Keine Treffer f\u00FCr die aktiven Filter', 'No matches for the active filters', '\uD65C\uC131 \uD544\uD130\uC5D0 \uC77C\uCE58\uD558\uB294 \uACB0\uACFC \uC5C6\uC74C', '\u5F53\u524D\u7B5B\u9009\u65E0\u5339\u914D', 'Sin coincidencias para los filtros activos', 'Aucun r\u00E9sultat pour les filtres actifs'),
  // Trend-Time-Series-Chart auf Comp-Detail
  'tft.trend.title': t6('Verlauf', 'Trend', '\uCD94\uC774', '\u8D70\u52BF', 'Tendencia', 'Tendance'),
  'tft.trend.last14': t6('14 Tage', '14 days', '14\uC77C', '14\u5929', '14 d\u00EDas', '14 jours'),
  'tft.trend.last30': t6('30 Tage', '30 days', '30\uC77C', '30\u5929', '30 d\u00EDas', '30 jours'),
  'tft.trend.empty': t6('Noch kein Verlauf', 'No trend yet', '\uC544\uC9C1 \uCD94\uC774 \uC5C6\uC74C', '\u6682\u65E0\u8D70\u52BF', 'Sin tendencia', 'Pas de tendance'),
  // Carry-Cost-Filter f\u00FCr die Comps-Liste (Reroll / Mid / Fast 8-9)
  'tft.cost.label': t6('Kosten', 'Cost', '\uBE44\uC6A9', '\u8D39\u7528', 'Coste', 'Co\u00FBt'),
  'tft.cost.all': t6('Alle', 'All', '\uC804\uCCB4', '\u5168\u90E8', 'Todos', 'Tous'),
  'tft.cost.reroll': t6('Reroll (1-2)', 'Reroll (1-2)', '\uB9AC\uB864 (1-2)', 'Reroll (1-2)', 'Reroll (1-2)', 'Reroll (1-2)'),
  'tft.cost.mid': t6('Mid (3)', 'Mid (3)', '\uC911\uAC04 (3)', '\u4E2D\u8D39 (3)', 'Mid (3)', 'Mid (3)'),
  'tft.cost.fast8': t6('Fast 8/9 (4-5)', 'Fast 8/9 (4-5)', 'Fast 8/9 (4-5)', 'Fast 8/9 (4-5)', 'Fast 8/9 (4-5)', 'Fast 8/9 (4-5)'),
  // In-Game Plan-Ahead Code Export (Riot Team Planner)
  'tft.planAhead.copy': t6('Plan-Ahead-Code', 'Plan Ahead code', 'Plan Ahead \uCF54\uB4DC', 'Plan Ahead \u4EE3\u7801', 'C\u00F3digo Plan Ahead', 'Code Plan Ahead'),
  'tft.planAhead.copied': t6('Kopiert!', 'Copied!', '\uBCF5\uC0AC\uB428!', '\u5DF2\u590D\u5236!', '\u00A1Copiado!', 'Copi\u00E9 !'),
  'tft.planAhead.failed': t6('Fehlgeschlagen', 'Failed', '\uC2E4\uD328', '\u5931\u8D25', 'Fall\u00F3', '\u00C9chec'),
  'tft.planAhead.export': t6('In-Game-Code exportieren', 'Export in-game code', '\uC778\uAC8C\uC784 \uCF54\uB4DC \uB0B4\uBCF4\uB0B4\uAE30', '\u5BFC\u51FA\u6E38\u620F\u5185\u4EE3\u7801', 'Exportar c\u00F3digo en juego', 'Exporter code in-game'),
  'tft.community.title': t6('Community-Comps', 'Community Comps', '\uCEE4\uBBA4\uB2C8\uD2F0 \uC870\uD569', '\u793E\u533A\u9635\u5BB9', 'Comps de la comunidad', 'Comps communaut\u00E9'),
  'tft.community.subtitle': t6(
    'Von Spielern geteilte Comp-Builds \u2014 bewerte deine Favoriten.',
    'Player-shared comp builds \u2014 upvote your favourites.',
    '\uD50C\uB808\uC774\uC5B4\uAC00 \uACF5\uC720\uD55C \uC870\uD569 \u2014 \uC88B\uC544\uD558\uB294 \uAC83\uC5D0 \uD22C\uD45C\uD558\uC138\uC694.',
    '\u73A9\u5BB6\u5206\u4EAB\u7684\u9635\u5BB9\u2014\u2014\u4E3A\u4F60\u559C\u6B22\u7684\u6295\u7968\u3002',
    'Builds compartidas por jugadores \u2014 vota tus favoritas.',
    'Comps partag\u00E9es par les joueurs \u2014 vote pour tes pr\u00E9f\u00E9r\u00E9es.'
  ),
  'tft.community.sort.top': t6('Top', 'Top', '\uC778\uAE30', '\u70ED\u95E8', 'Top', 'Top'),
  'tft.community.sort.recent': t6('Neueste', 'Recent', '\uCD5C\uC2E0', '\u6700\u65B0', 'Recientes', 'R\u00E9centes'),
  'tft.community.buildOwn': t6('Eigene erstellen', 'Build your own', '\uC9C1\uC811 \uB9CC\uB4E4\uAE30', '\u521B\u5EFA\u81EA\u5DF1\u7684', 'Crea la tuya', 'Cr\u00E9e la tienne'),
  'tft.community.buildFirst': t6('Sei der Erste!', 'Be the first!', '\uCCAB \uBC88\uC9F8\uAC00 \uB418\uC138\uC694!', '\u6210\u4E3A\u7B2C\u4E00\u4EBA!', '\u00A1S\u00E9 el primero!', 'Sois le premier !'),
  'tft.community.empty': t6('Noch keine Community-Comps.', 'No community comps yet.', '\uCEE4\uBBA4\uB2C8\uD2F0 \uC870\uD569\uC774 \uC544\uC9C1 \uC5C6\uC2B5\uB2C8\uB2E4.', '\u6682\u65E0\u793E\u533A\u9635\u5BB9\u3002', 'A\u00FAn no hay comps comunitarias.', 'Pas encore de comps communautaires.'),
  'nav.community': t6('Community', 'Community', '\uCEE4\uBBA4\uB2C8\uD2F0', '\u793E\u533A', 'Comunidad', 'Communaut\u00E9'),
  'nav.coach': t6('Coach', 'Coach', '\uCF54\uCE58', '\u6559\u7EC3', 'Entrenador', 'Coach'),
  'nav.login': t6('Login', 'Login', '\uB85C\uADF8\uC778', '\u767B\u5F55', 'Iniciar sesi\u00F3n', 'Connexion'),
  'nav.logout': t6('Abmelden', 'Sign out', '\uB85C\uADF8\uC544\uC6C3', '\u9000\u51FA', 'Cerrar sesi\u00F3n', 'D\u00E9connexion'),
  'auth.login': t6('Anmelden', 'Sign in', '\uB85C\uADF8\uC778', '\u767B\u5F55', 'Iniciar sesi\u00F3n', 'Se connecter'),
  'auth.signup': t6('Registrieren', 'Sign up', '\uAC00\uC785', '\u6CE8\u518C', 'Registrarse', "S'inscrire"),
  'auth.email': t6('E-Mail', 'Email', '\uC774\uBA54\uC77C', '\u90AE\u7BB1', 'Correo', 'Email'),
  'auth.password': t6('Passwort', 'Password', '\uBE44\uBC00\uBC88\uD638', '\u5BC6\u7801', 'Contrase\u00F1a', 'Mot de passe'),
  'auth.or': t6('oder', 'or', '\uB610\uB294', '\u6216', 'o', 'ou'),
  'auth.confirmEmail': t6(
    'Best\u00E4tigungs-E-Mail gesendet. Bitte Posteingang pr\u00FCfen.',
    'Confirmation email sent. Please check your inbox.',
    '\uD655\uC778 \uC774\uBA54\uC77C\uC774 \uC804\uC1A1\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uBC1B\uC740\uD3B8\uC9C0\uD568\uC744 \uD655\uC778\uD558\uC138\uC694.',
    '\u5DF2\u53D1\u9001\u786E\u8BA4\u90AE\u4EF6,\u8BF7\u68C0\u67E5\u6536\u4EF6\u7BB1\u3002',
    'Correo de confirmaci\u00F3n enviado. Revisa tu bandeja.',
    'E-mail de confirmation envoy\u00E9. V\u00E9rifie ta bo\u00EEte de r\u00E9ception.'
  ),
  'tft.coach.title': t6('TFT-Coach', 'TFT Coach', 'TFT \uCF54\uCE58', 'TFT \u6559\u7EC3', 'Entrenador TFT', 'Coach TFT'),
  'tft.coach.subtitle': t6(
    'Frag den Coach zu Comps, Augments, Economy, Item-Slamming.',
    'Ask the coach about comps, augments, economy, item-slamming.',
    '\uC870\uD569, \uC99D\uAC15, \uACBD\uC81C, \uC544\uC774\uD15C\uC5D0 \uB300\uD574 \uCF54\uCE58\uC5D0\uAC8C \uBB3C\uC5B4\uBCF4\uC138\uC694.',
    '\u5411\u6559\u7EC3\u8BE2\u95EE\u9635\u5BB9\u3001\u5F3A\u5316\u7B26\u6587\u3001\u7ECF\u6D4E\u548C\u88C5\u5907\u3002',
    'Pregunta al entrenador sobre comps, augments, econom\u00EDa, items.',
    'Demande au coach des comps, augments, \u00E9conomie, items.'
  ),
  'tft.coach.subtitleWithProfile': t6(
    'Pers\u00F6nlicher Coach mit Kontext aus deinen letzten 20 Spielen.',
    'Personal coach with context from your last 20 games.',
    '\uCD5C\uADFC 20\uAC8C\uC784 \uCEE8\uD14D\uC2A4\uD2B8\uB97C \uD65C\uC6A9\uD55C \uAC1C\uC778 \uCF54\uCE58.',
    '\u57FA\u4E8E\u4F60\u6700\u8FD120\u573A\u6BD4\u8D5B\u7684\u4E2A\u6027\u5316\u6559\u7EC3\u3002',
    'Entrenador personal con contexto de tus \u00FAltimas 20 partidas.',
    'Coach personnel avec contexte de tes 20 derni\u00E8res parties.'
  ),
  'tft.coach.greet': t6(
    'Was m\u00F6chtest du verbessern?',
    'What would you like to improve?',
    '\uBB34\uC5C7\uC744 \uAC1C\uC120\uD558\uACE0 \uC2F6\uC73C\uC2E0\uAC00\uC694?',
    '\u4F60\u60F3\u6539\u8FDB\u4EC0\u4E48?',
    '\u00BFQu\u00E9 quieres mejorar?',
    'Que veux-tu am\u00E9liorer ?'
  ),
  'tft.coach.placeholder': t6('Stell deine Frage\u2026', 'Ask your question\u2026', '\uC9C8\uBB38\uC744 \uC785\uB825\uD558\uC138\uC694\u2026', '\u63D0\u51FA\u95EE\u9898\u2026', 'Haz tu pregunta\u2026', 'Pose ta question\u2026'),
  'tft.coach.send': t6('Senden', 'Send', '\uC804\uC1A1', '\u53D1\u9001', 'Enviar', 'Envoyer'),
  'tft.coach.unavailable': t6(
    'Coach derzeit nicht verf\u00FCgbar (Server-Konfiguration).',
    'Coach currently unavailable (server config).',
    '\uD604\uC7AC \uCF54\uCE58\uB97C \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.',
    '\u6559\u7EC3\u76EE\u524D\u4E0D\u53EF\u7528\u3002',
    'Entrenador no disponible.',
    'Coach indisponible.'
  ),
  'tft.coach.q1': t6('Wie verbessere ich meine Economy?', 'How do I improve my economy?', '\uACBD\uC81C\uB97C \uC5B4\uB5BB\uAC8C \uAC1C\uC120\uD558\uB098\uC694?', '\u5982\u4F55\u6539\u5584\u7ECF\u6D4E?', '\u00BFC\u00F3mo mejoro la econom\u00EDa?', "Comment am\u00E9liorer mon \u00E9conomie ?"),
  'tft.coach.q2': t6('Wann sollte ich auf Level 8 pushen?', 'When should I push to level 8?', '\uC5B8\uC81C 8\uB808\uBCA8\uB85C \uC62C\uB9AC\uB098\uC694?', '\u4F55\u65F6\u8BE5\u5347\u52308\u7EA7?', '\u00BFCu\u00E1ndo subir a nivel 8?', 'Quand passer niveau 8 ?'),
  'tft.coach.q3': t6('Welche Comp passt zu meinem Spielstil?', 'Which comp fits my playstyle?', '\uC5B4\uB5A4 \uC870\uD569\uC774 \uC81C \uC2A4\uD0C0\uC77C\uC5D0 \uB9DE\uB098\uC694?', '\u4EC0\u4E48\u9635\u5BB9\u9002\u5408\u6211?', '\u00BFQu\u00E9 comp se adapta a m\u00ED?', 'Quelle comp me correspond ?'),
  'tft.coach.q4': t6('Wie slamme ich Items richtig?', 'How do I slam items correctly?', '\uC544\uC774\uD15C\uC744 \uC5B4\uB5BB\uAC8C \uD65C\uC6A9\uD558\uB098\uC694?', '\u5982\u4F55\u6B63\u786E\u88C5\u5907?', '\u00BFC\u00F3mo slamear items?', 'Comment slammer mes items ?'),
  'tft.slotFirst': t6('Erster Slot', 'First slot', '\uCCAB \uBC88\uC9F8 \uC2AC\uB86F', '\u7B2C\u4E00\u4EF6\u88C5\u5907', 'Primer slot', 'Premier slot'),
  'tft.slotSecond': t6('Zweiter Slot', 'Second slot', '\uB450 \uBC88\uC9F8 \uC2AC\uB86F', '\u7B2C\u4E8C\u4EF6\u88C5\u5907', 'Segundo slot', 'Deuxi\u00E8me slot'),
  'tft.slotThird': t6('Dritter Slot', 'Third slot', '\uC138 \uBC88\uC9F8 \uC2AC\uB86F', '\u7B2C\u4E09\u4EF6\u88C5\u5907', 'Tercer slot', 'Troisi\u00E8me slot'),
  'tft.player.proSpecialty': t6('Pro-Spezialisierung & Signature-Builds', 'Pro Specialty & Signature Builds', '\uD504\uB85C \uC804\uBB38\uD654 & \uC2DC\uADF8\uB2C8\uCC98 \uBE4C\uB4DC', '\u804C\u4E1A\u73A9\u5BB6\u4E13\u7CBE & \u6807\u5FD7\u6027\u51FA\u88C5', 'Especialidad Pro y Builds firma', 'Sp\u00E9cialit\u00E9 Pro & Builds signature'),
  'tft.player.loading': t6('Lade Spieler-Daten \u2026', 'Loading player data \u2026', '\uD50C\uB808\uC774\uC5B4 \uB370\uC774\uD130 \uBD88\uB7EC\uC624\uB294 \uC911 \u2026', '\u6B63\u5728\u52A0\u8F7D\u73A9\u5BB6\u6570\u636E \u2026', 'Cargando datos del jugador \u2026', 'Chargement des donn\u00E9es du joueur \u2026'),
  'tft.player.error': t6('Fehler', 'Error', '\uC624\uB958', '\u9519\u8BEF', 'Error', 'Erreur'),
  'tft.player.matchHistory': t6('Match-History', 'Match History', '\uB9E4\uCE58 \uD788\uC2A4\uD1A0\uB9AC', '\u6BD4\u8D5B\u5386\u53F2', 'Historial de partidas', 'Historique des matchs'),
  'tft.player.loadingMatchHistory': t6('Lade Match-History \u2026', 'Loading match history \u2026', '\uB9E4\uCE58 \uD788\uC2A4\uD1A0\uB9AC \uBD88\uB7EC\uC624\uB294 \uC911 \u2026', '\u6B63\u5728\u52A0\u8F7D\u6BD4\u8D5B\u5386\u53F2 \u2026', 'Cargando historial \u2026', 'Chargement de l\'historique \u2026'),
  'tft.player.noStandardMatches': t6('Keine Standard-Ranked-Matches gefunden.', 'No Standard Ranked matches found.', '\uC2A4\uD0E0\uB2E4\uB4DC \uB7AD\uD06C \uB9E4\uCE58\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.', '\u672A\u627E\u5230\u6807\u51C6\u6392\u4F4D\u8D5B\u6BD4\u8D5B\u3002', 'No se encontraron partidas Standard Ranked.', 'Aucun match Standard Ranked trouv\u00E9.'),
  'tft.player.prev': t6('\u2190 Zur\u00FCck', '\u2190 Previous', '\u2190 \uC774\uC804', '\u2190 \u4E0A\u4E00\u9875', '\u2190 Anterior', '\u2190 Pr\u00E9c\u00E9dent'),
  'tft.player.next': t6('Weiter \u2192', 'Next \u2192', '\uB2E4\uC74C \u2192', '\u4E0B\u4E00\u9875 \u2192', 'Siguiente \u2192', 'Suivant \u2192'),
  'tft.player.seasonStats': t6('Saison-Statistik', 'Season stats', '\uC2DC\uC98C \uD1B5\uACC4', '\u8D5B\u5B63\u7EDF\u8BA1', 'Estad\u00EDsticas de temporada', 'Statistiques de saison'),
  'tft.player.computingFromAllMatches': t6('Berechne aus allen Saison-Matches \u2026', 'Computing from all season matches \u2026', '\uC2DC\uC98C \uC804\uCCB4 \uB9E4\uCE58\uC5D0\uC11C \uACC4\uC0B0 \uC911 \u2026', '\u6B63\u5728\u4ECE\u8D5B\u5B63\u5168\u90E8\u6BD4\u8D5B\u8BA1\u7B97 \u2026', 'Calculando desde todas las partidas \u2026', 'Calcul \u00E0 partir de tous les matchs \u2026'),
  'tft.player.noSoloMatchesForSet': t6('Keine Solo-Ranked-Matches f\u00FCr Set {n} im Cache.', 'No Solo Ranked matches for Set {n} in cache.', '\uCE90\uC2DC\uC5D0 \uC138\uD2B8 {n} \uC194\uB85C \uB7AD\uD06C \uB9E4\uCE58\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.', '\u7F13\u5B58\u4E2D\u6CA1\u6709\u7B2C {n} \u8D5B\u5B63\u7684\u5355\u6392\u6BD4\u8D5B\u3002', 'Sin partidas Solo Ranked para Set {n} en cach\u00E9.', 'Aucun match Solo Ranked pour le Set {n} en cache.'),
  'tft.player.verifiedPro': t6('Verifizierter Pro', 'Verified Pro', '\uAC80\uC99D\uB41C \uD504\uB85C', '\u8BA4\u8BC1\u804C\u4E1A\u73A9\u5BB6', 'Pro verificado', 'Pro v\u00E9rifi\u00E9'),
  'tft.player.verifiedTftPro': t6('Verifizierter TFT-Pro', 'Verified TFT Pro', '\uAC80\uC99D\uB41C TFT \uD504\uB85C', '\u8BA4\u8BC1 TFT \u804C\u4E1A\u73A9\u5BB6', 'Pro de TFT verificado', 'Pro TFT v\u00E9rifi\u00E9'),
  'tft.player.verifiedProBadge': t6('\u2713 Verified Pro', '\u2713 Verified Pro', '\u2713 Verified Pro', '\u2713 Verified Pro', '\u2713 Verified Pro', '\u2713 Verified Pro'),
  'tft.player.verifiedTftProBadge': t6('\u2713 Verified TFT Pro', '\u2713 Verified TFT Pro', '\u2713 Verified TFT Pro', '\u2713 Verified TFT Pro', '\u2713 Verified TFT Pro', '\u2713 Verified TFT Pro'),
  'tft.player.tournamentHistory': t6('Turnierhistorie', 'Tournament History', '\uD1A0\uB108\uBA3C\uD2B8 \uAE30\uB85D', '\u8D5B\u4E8B\u8BB0\u5F55', 'Historial de torneos', 'Historique des tournois'),
  'tft.player.tournaments': t6('Turniere', 'Tournaments', '\uD1A0\uB108\uBA3C\uD2B8', '\u8D5B\u4E8B', 'Torneos', 'Tournois'),
  'tft.player.colDate': t6('Datum', 'Date', '\uB0A0\uC9DC', '\u65E5\u671F', 'Fecha', 'Date'),
  'tft.player.colPlace': t6('Platz', 'Place', '\uC21C\uC704', '\u540D\u6B21', 'Posici\u00F3n', 'Place'),
  'tft.player.colTournament': t6('Turnier', 'Tournament', '\uD1A0\uB108\uBA3C\uD2B8', '\u8D5B\u4E8B', 'Torneo', 'Tournoi'),
  'tft.player.colTier': t6('Tier', 'Tier', '\uD2F0\uC5B4', '\u7B49\u7EA7', 'Tier', 'Tier'),
  'tft.player.colPrize': t6('Preisgeld', 'Prize', '\uC0C1\uAE08', '\u5956\u91D1', 'Premio', 'Gain'),
  'tft.player.showLess': t6('Weniger anzeigen', 'Show less', '\uAC04\uB2E8\uD788 \uBCF4\uAE30', '\u6536\u8D77', 'Mostrar menos', 'Voir moins'),
  'tft.player.showMore': t6('+ {n} weitere anzeigen', '+ {n} more', '+ {n} \uAC1C \uB354 \uBCF4\uAE30', '+ \u8FD8\u6709 {n} \u9879', '+ {n} m\u00E1s', '+ {n} de plus'),
  'tft.player.standardRanked': t6('Standard Ranked', 'Standard Ranked', '\uC2A4\uD0E0\uB2E4\uB4DC \uB7AD\uD06C', '\u6807\u51C6\u6392\u4F4D', 'Standard Ranked', 'Standard Ranked'),
  'tft.player.unranked': t6('Unranked', 'Unranked', '\uC5B8\uB7AD\uD06C', '\u672A\u5B9A\u7EA7', 'Sin clasificar', 'Non class\u00E9'),
  'tft.player.allSeasons': t6('Alle Saisons ({n})', 'All seasons ({n})', '\uC804\uCCB4 \uC2DC\uC98C ({n})', '\u6240\u6709\u8D5B\u5B63 ({n})', 'Todas las temporadas ({n})', 'Toutes les saisons ({n})'),
  'tft.player.peakRankPerSet': t6('Rang pro Set', 'Rank per Set', '\uC138\uD2B8\uBCC4 \uB4F1\uAE09', '\u6BCF\u8D5B\u5B63\u6BB5\u4F4D', 'Rango por Set', 'Rang par Set'),
  'tft.champion': t6('Champion', 'Champion', '\uCC54\uD53C\uC5B8', '\u82F1\u96C4', 'Campe\u00F3n', 'Champion'),
  'tft.compare.performanceRadar': t6('Performance-Radar', 'Performance Radar', '\uD37C\uD3EC\uBA3C\uC2A4 \uB808\uC774\uB354', '\u8868\u73B0\u96F7\u8FBE', 'Radar de rendimiento', 'Radar de performance'),
  'tft.compare.headToHead': t6('Head-to-Head', 'Head-to-Head', '\uB9DE\uB300\uACB0', '\u6B63\u9762\u5BF9\u51B3', 'Cara a cara', 'Face-\u00E0-face'),
  'tft.saved.remove': t6('Bookmark entfernen', 'Remove bookmark', '\uBD81\uB9C8\uD06C \uC81C\uAC70', '\u79FB\u9664\u6536\u85CF', 'Quitar marcador', 'Retirer le favori'),
  'tft.carry': t6('Carry', 'Carry', '\uCE90\uB9AC', '\u4E3BC', 'Carry', 'Carry'),
  'tft.games': t6('Spiele', 'Games', '\uACBD\uAE30', '\u573A\u6B21', 'Partidas', 'Parties'),
  'tft.win': t6('Sieg', 'Win', '\uC2B9\uB9AC', '\u80DC\u5229', 'Victoria', 'Victoire'),
  'tft.match.lvl': t6('Lvl', 'Lvl', '\uB808\uBCA8', 'Lvl', 'Niv', 'Niv'),
  'tft.match.stage': t6('Stage', 'Stage', '\uC2A4\uD14C\uC774\uC9C0', '\u9636\u6BB5', 'Etapa', '\u00C9tape'),
  'tft.match.detail': t6('Match-Detail \u2192', 'Match detail \u2192', '\uB9E4\uCE58 \uC0C1\uC138 \u2192', '\u6BD4\u8D5B\u8BE6\u60C5 \u2192', 'Detalle del partido \u2192', 'D\u00E9tail du match \u2192'),
  'tft.marketvalue.unavailable': t6('Marktwert nicht verf\u00FCgbar', 'Marketvalue unavailable', '\uC2DC\uC138 \uC0AC\uC6A9 \uBD88\uAC00', '\u5E02\u573A\u4EF7\u503C\u4E0D\u53EF\u7528', 'Valor de mercado no disponible', 'Valeur marchande indisponible'),
  'tft.player.signatureComps': t6('Lieblings-Comps', 'Favourite comps', '\uC120\uD638 \uC870\uD569', '\u5E38\u7528\u9635\u5BB9', 'Comps preferidas', 'Comps favorites'),
  'tft.player.signatureBuilds': t6('Signature-Item-Builds', 'Signature item builds', '\uC2DC\uADF8\uB2C8\uCC98 \uC544\uC774\uD15C \uBE4C\uB4DC', '\u6807\u5FD7\u6027\u51FA\u88C5', 'Builds firma', 'Builds signature'),
  'tft.player.seasonProfile': t6('Saison-Profil', 'Season Profile', '\uC2DC\uC98C \uD504\uB85C\uD544', '\u8D5B\u5B63\u6982\u51B5', 'Perfil de temporada', 'Profil de saison'),
  'tft.player.consistency': t6('Konstanz', 'Consistency', '\uC77C\uAD00\uC131', '\u7A33\u5B9A\u6027', 'Constancia', 'R\u00E9gularit\u00E9'),
  'tft.player.consistency.tip': t6('Standardabweichung der Platzierung \u2014 niedriger = konstanter', 'Placement standard deviation \u2014 lower is more consistent', '\uC21C\uC704 \uD45C\uC900\uD3B8\uCC28 \u2014 \uB0AE\uC744\uC218\uB85D \uC77C\uAD00\uC801', '\u540D\u6B21\u6807\u51C6\u5DEE \u2014 \u8D8A\u4F4E\u8D8A\u7A33\u5B9A', 'Desviaci\u00F3n est\u00E1ndar de posici\u00F3n \u2014 menor es m\u00E1s constante', '\u00C9cart-type du classement \u2014 plus bas = plus r\u00E9gulier'),
  'tft.player.bestStreak': t6('Beste Top-4-Serie', 'Best Top-4 streak', '\uCD5C\uACE0 \uD1B14 \uC5F0\uC18D', '\u6700\u4F73\u524D\u56DB\u8FDE\u573A', 'Mejor racha Top-4', 'Meilleure s\u00E9rie Top-4'),
  'tft.player.bestStreak.tip': t6('L\u00E4ngste Serie aufeinanderfolgender Top-4-Platzierungen', 'Longest run of consecutive Top-4 finishes', '\uC5F0\uC18D \uD1B14 \uCD5C\uC7A5 \uAE30\uB85D', '\u8FDE\u7EED\u8FDB\u5165\u524D\u56DB\u7684\u6700\u957F\u7EAA\u5F55', 'Racha m\u00E1s larga de Top-4 consecutivos', 'Plus longue s\u00E9rie de Top-4 cons\u00E9cutifs'),
  'tft.player.uniqueComps': t6('Gespielte Comps', 'Unique comps', '\uD50C\uB808\uC774\uD55C \uC870\uD569 \uC218', '\u4F7F\u7528\u9635\u5BB9\u6570', 'Comps \u00FAnicas', 'Comps uniques'),
  'tft.player.uniqueComps.tip': t6('Anzahl verschiedener Comps diese Saison', 'Number of distinct comps this season', '\uC774\uBC88 \uC2DC\uC98C \uD50C\uB808\uC774\uD55C \uC11C\uB85C \uB2E4\uB978 \uC870\uD569 \uC218', '\u672C\u8D5B\u5B63\u4F7F\u7528\u7684\u4E0D\u540C\u9635\u5BB9\u6570\u91CF', 'N\u00FAmero de comps distintas esta temporada', 'Nombre de comps distinctes cette saison'),
  'tft.player.dominantShare': t6('Main-Comp-Anteil', 'Main-comp share', '\uC8FC\uB825 \uC870\uD569 \uBE44\uC911', '\u4E3B\u529B\u9635\u5BB9\u5360\u6BD4', 'Comp principal %', 'Part comp principale'),
  'tft.player.dominantShare.tip': t6('Anteil der Spiele in der meistgespielten Comp', 'Share of games in the most-played comp', '\uAC00\uC7A5 \uB9CE\uC774 \uD55C \uC870\uD569\uC758 \uAC8C\uC784 \uBE44\uC911', '\u6700\u5E38\u7528\u9635\u5BB9\u7684\u5BF9\u5C40\u5360\u6BD4', 'Porcentaje de partidas en la comp m\u00E1s jugada', 'Part des parties dans la comp la plus jou\u00E9e'),
  'tft.player.metaPickShare': t6('Meta-Anteil', 'Meta share', '\uBA54\uD0C0 \uBE44\uC911', '\u7248\u672C\u5F3A\u52BF\u5360\u6BD4', 'Cuota meta', 'Part m\u00E9ta'),
  'tft.player.metaPickShare.tip': t6('Anteil der Spiele in aktuell starken Meta-Comps', 'Share of games in currently strong meta comps', '\uD604\uC7AC \uAC15\uD55C \uBA54\uD0C0 \uC870\uD569 \uBE44\uC911', '\u5F53\u524D\u5F3A\u52BF\u7248\u672C\u9635\u5BB9\u5360\u6BD4', 'Porcentaje de partidas en comps meta fuertes', 'Part des parties dans les comps m\u00E9ta fortes'),
  'tft.player.itemSlam': t6('Item-Effizienz', 'Item efficiency', '\uC544\uC774\uD15C \uD6A8\uC728', '\u88C5\u5907\u6548\u7387', 'Eficiencia de \u00EDtems', 'Efficacit\u00E9 objets'),
  'tft.player.itemSlam.tip': t6('Wie oft empfohlene BiS-Items gebaut wurden', 'How often recommended BiS items were built', '\uAD8C\uC7A5 BiS \uC544\uC774\uD15C \uC81C\uC791 \uBE48\uB3C4', '\u6253\u9020\u63A8\u8350BiS\u88C5\u5907\u7684\u9891\u7387', 'Con qu\u00E9 frecuencia se construyeron \u00EDtems BiS recomendados', 'Fr\u00E9quence de construction des objets BiS recommand\u00E9s'),
  'tft.player.bottom4Rate': t6('Bottom-4-Quote', 'Bottom-4 rate', '\uD558\uC704 4\uC704 \uBE44\uC728', '\u540E\u56DB\u7387', 'Tasa Bottom-4', 'Taux Bottom-4'),
  'tft.player.bottom4Rate.tip': t6('Anteil der Spiele mit Platzierung 5\u20138', 'Share of games finishing 5th\u20138th', '5~8\uC704\uB85C \uB05D\uB09C \uAC8C\uC784 \uBE44\uC728', '\u540D\u52175-8\u540D\u7684\u5BF9\u5C40\u5360\u6BD4', 'Porcentaje de partidas en puestos 5.\u00BA\u20138.\u00BA', 'Part des parties termin\u00E9es 5e\u20138e'),
  'tft.compsWithUnit': t6('Comps mit dieser Unit', 'Comps with this unit', '\uC774 \uC720\uB2DB\uC744 \uC0AC\uC6A9\uD558\uB294 \uC870\uD569', '\u4F7F\u7528\u8BE5\u82F1\u96C4\u7684\u9635\u5BB9', 'Comps con esta unidad', 'Comps avec cette unit\u00E9'),
  'tft.sortBy': t6('Sortieren', 'Sort by', '\uC815\uB82C', '\u6392\u5E8F', 'Ordenar', 'Trier par'),
  'tft.compsWithItem': t6('Comps mit diesem Item', 'Comps with this item', '\uC774 \uC544\uC774\uD15C\uC744 \uC0AC\uC6A9\uD558\uB294 \uC870\uD569', '\u4F7F\u7528\u8BE5\u88C5\u5907\u7684\u9635\u5BB9', 'Comps con este \u00EDtem', 'Comps avec cet objet'),
  'tft.savedTitle': t6('Gespeichert', 'Saved', '\uC800\uC7A5\uB428', '\u5DF2\u6536\u85CF', 'Guardados', 'Favoris'),
  'tft.savedEmpty': t6('Noch nichts gespeichert. Klicke auf das Stern-Symbol bei einer Comp oder einem Spieler-Profil, um sie hier zu sammeln.', 'Nothing saved yet. Click the star next to a comp or player profile to collect them here.', '\uC544\uC9C1 \uC800\uC7A5\uB41C \uD56D\uBAA9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uC870\uD569\uC774\uB098 \uD50C\uB808\uC774\uC5B4 \uD504\uB85C\uD544 \uC606\uC758 \uBCC4 \uBAA8\uC591\uC744 \uB20C\uB7EC \uBAA8\uC544\uBCF4\uC138\uC694.', '\u5C1A\u672A\u4FDD\u5B58\u3002\u70B9\u51FB\u9635\u5BB9\u6216\u73A9\u5BB6\u6863\u6848\u65C1\u7684\u661F\u6807\u5373\u53EF\u6536\u85CF\u3002', 'A\u00FAn no hay nada guardado. Haz clic en la estrella junto a una comp o un perfil para agregarlo.', 'Rien d\'enregistr\u00E9. Cliquez sur l\'\u00E9toile \u00E0 c\u00F4t\u00E9 d\'une comp ou d\'un profil pour les retrouver ici.'),
  'tft.savedEmptyComps': t6('Keine Comps gespeichert', 'No comps saved', '\uC800\uC7A5\uB41C \uC870\uD569 \uC5C6\uC74C', '\u6CA1\u6709\u5DF2\u4FDD\u5B58\u7684\u9635\u5BB9', 'Sin comps guardadas', 'Aucune comp enregistr\u00E9e'),
  'tft.savedEmptyPlayers': t6('Keine Spieler gespeichert', 'No players saved', '\uC800\uC7A5\uB41C \uD50C\uB808\uC774\uC5B4 \uC5C6\uC74C', '\u6CA1\u6709\u5DF2\u4FDD\u5B58\u7684\u73A9\u5BB6', 'Sin jugadores guardados', 'Aucun joueur enregistr\u00E9'),
  'tft.players': t6('Spieler', 'Players', '\uD50C\uB808\uC774\uC5B4', '\u73A9\u5BB6', 'Jugadores', 'Joueurs'),
  'tft.builderTitle': t6('Comp-Builder', 'Comp Builder', '\uC870\uD569 \uBE4C\uB354', '\u9635\u5BB9\u6784\u5EFA\u5668', 'Editor de Comp', '\u00C9diteur de Comp'),
  'tft.builderSubtitle': t6('Eigene Comp zusammenstellen \u2014 Champions klicken, Traits live ablesen.', 'Build your own comp \u2014 click champions, read traits live.', '\uC9C1\uC811 \uC870\uD569\uC744 \uB9CC\uB4E4\uC5B4 \uBCF4\uC138\uC694 \u2014 \uCC54\uD53C\uC5B8\uC744 \uD074\uB9AD\uD558\uACE0 \uC2DC\uB108\uC9C0\uB97C \uC2E4\uC2DC\uAC04\uC73C\uB85C \uD655\uC778\uD558\uC138\uC694.', '\u642D\u5EFA\u4F60\u7684\u9635\u5BB9\u2014\u2014\u70B9\u51FB\u82F1\u96C4\uFF0C\u5B9E\u65F6\u67E5\u770B\u7F81\u7ECA\u3002', 'Crea tu comp \u2014 haz clic en campeones y mira las sinergias en vivo.', 'Construis ta comp \u2014 clique sur les champions, lis les synergies en direct.'),
  'tft.builderBoard': t6('Aufstellung', 'Board', '\uBC30\uCE58', '\u9635\u5BB9', 'Tablero', 'Plateau'),
  'tft.builderClear': t6('Leeren', 'Clear', '\uC9C0\uC6B0\uAE30', '\u6E05\u7A7A', 'Vaciar', 'Vider'),
  'tft.builderSearch': t6('Champion suchen\u2026', 'Search champion\u2026', '\uCC54\uD53C\uC5B8 \uAC80\uC0C9\u2026', '\u641C\u7D22\u82F1\u96C4\u2026', 'Buscar campe\u00F3n\u2026', 'Chercher un champion\u2026'),
  'tft.builderTraits': t6('Aktive Synergien', 'Active traits', '\uD65C\uC131 \uC2DC\uB108\uC9C0', '\u6FC0\u6D3B\u7684\u7F81\u7ECA', 'Sinergias activas', 'Synergies actives'),
  'tft.builderItems': t6('Items', 'Items', '\uC544\uC774\uD15C', '\u88C5\u5907', '\u00CDtems', 'Objets'),
  'tft.builderItemsAll': t6('Alle', 'All', '\uC804\uCCB4', '\u5168\u90E8', 'Todos', 'Tous'),
  'tft.builderItemsCompleted': t6('Fertige Items', 'Completed items', '\uC644\uC131 \uC544\uC774\uD15C', '\u6210\u54C1\u88C5\u5907', '\u00CDtems completos', 'Objets compl\u00E9t\u00E9s'),
  'tft.builderItemsComponents': t6('Komponenten', 'Components', '\uBD80\uD488', '\u90E8\u4EF6', 'Componentes', 'Composants'),
  'tft.builderItemsRadiant': t6('Radiant', 'Radiant', '\uB798\uB514\uC5B8\uD2B8', '\u706F\u706C\u88C5\u5907', 'Radiantes', 'Radieux'),
  'tft.builderItemsArtifacts': t6('Artefakte', 'Artifacts', '\uC720\uBB3C', '\u9057\u7269', 'Artefactos', 'Artefacts'),
  'tft.builderItemsEmblems': t6('Embleme', 'Emblems', '\uBB38\uC7A5', '\u5FBD\u7AE0', 'Emblemas', 'Embl\u00E8mes'),
  'tft.builderItemsPsyonic': t6('Psyonic', 'Psyonic', '\uC0AC\uC774\uC624\uB2C9', '\u5FC3\u7075', 'Psi\u00F3nico', 'Psyonique'),
  'tft.builderItemsAnimasquad': t6('Anima', 'Anima', '\uC560\uB2C8\uB9C8', '\u7075\u7EB3', 'Anima', 'Anima'),
  'tft.builderMfStance': t6('Modus', 'Stance', '\uBAA8\uB4DC', '\u6A21\u5F0F', 'Modo', 'Mode'),
  'tft.builderStarLevel': t6('Stern-Level', 'Star level', '\uBCC4 \uB808\uBCA8', '\u661F\u7EA7', 'Nivel de estrellas', 'Niveau d\u2019\u00E9toiles'),
  'tft.builderAbility': t6('F\u00E4higkeit', 'Ability', '\uC2A4\uD0AC', '\u6280\u80FD', 'Habilidad', 'Capacit\u00E9'),
  'tft.builderItemsSearch': t6('Item suchen\u2026', 'Search item\u2026', '\uC544\uC774\uD15C \uAC80\uC0C9\u2026', '\u641C\u7D22\u88C5\u5907\u2026', 'Buscar item\u2026', 'Chercher un objet\u2026'),
  'tft.builderSave': t6('Speichern', 'Save', '\uC800\uC7A5', '\u4FDD\u5B58', 'Guardar', 'Enregistrer'),
  'tft.builderShare': t6('Link kopieren', 'Copy link', '\uB9C1\uD06C \uBCF5\uC0AC', '\u590D\u5236\u94FE\u63A5', 'Copiar enlace', 'Copier le lien'),
  'tft.builderShareCopied': t6('Link kopiert', 'Link copied', '\uB9C1\uD06C \uBCF5\uC0AC\uB428', '\u5DF2\u590D\u5236\u94FE\u63A5', 'Enlace copiado', 'Lien copi\u00E9'),
  'tft.builderMyComps': t6('Meine Comps', 'My comps', '\uB0B4 \uC870\uD569', '\u6211\u7684\u9635\u5BB9', 'Mis comps', 'Mes comps'),
  'tft.builderSaveName': t6('Name der Comp', 'Comp name', '\uC870\uD569 \uC774\uB984', '\u9635\u5BB9\u540D\u79F0', 'Nombre de comp', 'Nom de la comp'),
  'tft.builderDelete': t6('L\u00F6schen', 'Delete', '\uC0AD\uC81C', '\u5220\u9664', 'Eliminar', 'Supprimer'),
  'tft.builderLoad': t6('Laden', 'Load', '\uBD88\uB7EC\uC624\uAE30', '\u52A0\u8F7D', 'Cargar', 'Charger'),
  'tft.builderUnitItems': t6('Items dieser Einheit', 'Items on this unit', '\uC774 \uC720\uB2DB\uC758 \uC544\uC774\uD15C', '\u6B64\u5355\u4F4D\u7684\u88C5\u5907', '\u00CDtems en esta unidad', 'Objets de cette unit\u00E9'),
  'tft.builderOpponent': t6('Gegner-Brett', 'Opponent board', '\uC0C1\uB300 \uBCF4\uB4DC', '\u5BF9\u624B\u68CB\u76D8', 'Tablero rival', 'Plateau adverse'),
  'tft.builderShowOpponent': t6('Gegner einblenden', 'Show opponent', '\uC0C1\uB300 \uD45C\uC2DC', '\u663E\u793A\u5BF9\u624B', 'Mostrar rival', 'Afficher l\u2019adversaire'),
  'tft.builderHideOpponent': t6('Gegner ausblenden', 'Hide opponent', '\uC0C1\uB300 \uC228\uAE30\uAE30', '\u9690\u85CF\u5BF9\u624B', 'Ocultar rival', 'Masquer l\u2019adversaire'),
  'tft.builderOwn': t6('Eigenes Brett', 'Your board', '\uB0B4 \uBCF4\uB4DC', '\u6211\u7684\u68CB\u76D8', 'Tu tablero', 'Ton plateau'),
  'tft.compsWithTrait': t6('Top-Comps mit dieser Synergie', 'Top comps with this trait', '\uC774 \uC2DC\uB108\uC9C0\uB97C \uC0AC\uC6A9\uD558\uB294 \uC0C1\uC704 \uC870\uD569', '\u4F7F\u7528\u8BE5\u7F81\u7ECA\u7684\u9876\u7EA7\u9635\u5BB9', 'Mejores comps con esta sinergia', 'Meilleures comps avec cette synergie'),
  'tft.mostUsedItems': t6('H\u00E4ufigste Items', 'Most used items', '\uAC00\uC7A5 \uB9CE\uC774 \uC0AC\uC6A9\uB41C \uC544\uC774\uD15C', '\u6700\u5E38\u7528\u88C5\u5907', '\u00CDtems m\u00E1s usados', 'Objets les plus utilis\u00E9s'),
  'tft.topUsers': t6('H\u00E4ufigste Tr\u00E4ger', 'Most common holders', '\uAC00\uC7A5 \uB9CE\uC774 \uC0AC\uC6A9\uD558\uB294 \uCC54\uD53C\uC5B8', '\u6700\u5E38\u88C5\u5907\u7684\u82F1\u96C4', 'Portadores m\u00E1s comunes', 'Porteurs les plus fr\u00E9quents'),
  'tft.topItems': t6('Top-Items', 'Top items', '\uCD5C\uACE0 \uC544\uC774\uD15C', '\u70ED\u95E8\u88C5\u5907', 'Mejores \u00EDtems', 'Meilleurs objets'),
  'tft.filter.patch':   t6('Patch', 'Patch', '\uD328\uCE58', '\u7248\u672C', 'Parche', 'Patch'),
  'tft.filter.bucket':  t6('Rang', 'Rank', '\uB7AD\uD06C', '\u6BB5\u4F4D', 'Rango', 'Rang'),
  'tft.filter.days':    t6('Zeitfenster', 'Time window', '\uAE30\uAC04', '\u65F6\u95F4\u8303\u56F4', 'Periodo', 'P\u00E9riode'),
  'tft.filter.region':  t6('Region', 'Region', '\uC9C0\uC5ED', '\u533A\u57DF', 'Regi\u00F3n', 'R\u00E9gion'),
  'tft.filter.current': t6('Aktueller Patch', 'Current patch', '\uD604\uC7AC \uD328\uCE58', '\u5F53\u524D\u7248\u672C', 'Parche actual', 'Patch actuel'),
  'tft.filter.previous':t6('Voriger Patch', 'Previous patch', '\uC774\uC804 \uD328\uCE58', '\u4E0A\u4E2A\u7248\u672C', 'Parche anterior', 'Patch pr\u00E9c\u00E9dent'),
  'tft.filter.patchSince': t6('Patch {patch} \u00B7 seit {date}', 'Patch {patch} \u00B7 since {date}', '\uD328\uCE58 {patch} \u00B7 {date} \uBD80\uD130', '\u7248\u672C {patch} \u00B7 \u81EA {date}', 'Parche {patch} \u00B7 desde {date}', 'Patch {patch} \u00B7 depuis {date}'),
  'tft.filter.patchAggregated': t6('Werte patch\u00FCbergreifend aggregiert', 'Values aggregated across patches', '\uD328\uCE58 \uAC04 \uC9D1\uACC4\uB41C \uAC12', '\u8DE8\u7248\u672C\u805A\u5408\u6570\u636E', 'Valores agregados entre parches', 'Valeurs agr\u00E9g\u00E9es sur plusieurs patchs'),
  'tft.filter.dayOne':  t6('Letzter Tag', 'Last day', '\uCD5C\uADFC 1\uC77C', '\u6700\u8FD11\u5929', '\u00DAltimo d\u00EDa', 'Dernier jour'),
  'tft.filter.dayN':    t6('Letzte {n} Tage', 'Last {n} days', '\uCD5C\uADFC {n}\uC77C', '\u6700\u8FD1{n}\u5929', '\u00DAltimos {n} d\u00EDas', '{n} derniers jours'),
  'tft.filter.allRegions': t6('Alle Regionen', 'All regions', '\uBAA8\uB4E0 \uC9C0\uC5ED', '\u6240\u6709\u533A\u57DF', 'Todas las regiones', 'Toutes les r\u00E9gions'),
  'tft.filter.west':       t6('Westen', 'West', '\uC11C\uAD6C\uAD8C', '\u897F\u65B9', 'Oeste', 'Ouest'),
  'tft.filter.asia':       t6('Asien', 'Asia', '\uC544\uC2DC\uC544', '\u4E9A\u6D32', 'Asia', 'Asie'),
  'tft.filter.allRanks':   t6('Alle R\u00E4nge', 'All ranks', '\uBAA8\uB4E0 \uB7AD\uD06C', '\u6240\u6709\u6BB5\u4F4D', 'Todos los rangos', 'Tous les rangs'),
  'tft.filter.masterPlus': t6('Master+', 'Master+', '\uB9C8\uC2A4\uD130+', '\u5927\u5E08+', 'Maestro+', 'Ma\u00EEtre+'),
  'tft.filter.grandmasterPlus': t6('Grandmaster+', 'Grandmaster+', '\uADF8\uB79C\uB4DC\uB9C8\uC2A4\uD130+', '\u5B97\u5E08+', 'Grand Maestro+', 'Grand Ma\u00EEtre+'),
  'tft.filter.diamondPlus': t6('Diamant+', 'Diamond+', '\uB2E4\uC774\uC544+', '\u94BB\u77F3+', 'Diamante+', 'Diamant+'),
  'tft.filter.emeraldPlus': t6('Smaragd+', 'Emerald+', '\uC5D0\uBA54\uB784\uB4DC+', '\u7FE1\u7FE0+', 'Esmeralda+', '\u00C9meraude+'),
  'tft.filter.platinumPlus': t6('Platin+', 'Platinum+', '\uD50C\uB798\uD2F0\uB118+', '\u94C2\u91D1+', 'Platino+', 'Platine+'),
  'tft.filter.velocity':   t6('\u0394-Vergleich', '\u0394 comparison', '\u0394 \uBE44\uAD50', '\u0394 \u5BF9\u6BD4', 'Comparaci\u00F3n \u0394', 'Comparaison \u0394'),
  'tft.filter.velocityOff':t6('Aus', 'Off', '\uB044\uAE30', '\u5173', 'Desactivado', 'D\u00E9sactiv\u00E9'),
  'tft.filter.velocity1d': t6('vs Vortag', 'vs day before', '\uC804\uB0A0 \uB300\uBE44', '\u5BF9\u524D\u4E00\u5929', 'vs d\u00EDa anterior', 'vs la veille'),
  'tft.filter.velocity2d': t6('vs vor 2 Tagen', 'vs 2 days ago', '2\uC77C \uC804 \uB300\uBE44', '\u5BF92\u5929\u524D', 'vs hace 2 d\u00EDas', 'vs il y a 2 jours'),
  'tft.filter.velocity3d': t6('vs vor 3 Tagen', 'vs 3 days ago', '3\uC77C \uC804 \uB300\uBE44', '\u5BF93\u5929\u524D', 'vs hace 3 d\u00EDas', 'vs il y a 3 jours'),
  'tft.filter.velocity7d': t6('vs vor 7 Tagen', 'vs 7 days ago', '7\uC77C \uC804 \uB300\uBE44', '\u5BF97\u5929\u524D', 'vs hace 7 d\u00EDas', 'vs il y a 7 jours'),
  'tft.filter.velocity14d':t6('vs vor 14 Tagen', 'vs 14 days ago', '14\uC77C \uC804 \uB300\uBE44', '\u5BF914\u5929\u524D', 'vs hace 14 d\u00EDas', 'vs il y a 14 jours'),
  'tft.velocity.delta':    t6('\u0394 Platz', '\u0394 Place', '\u0394 \uC21C\uC704', '\u0394 \u540D\u6B21', '\u0394 Posici\u00F3n', '\u0394 Place'),
  'tft.velocity.deltaVs':  t6('\u0394 vs vor {n}T', '\u0394 vs {n}d ago', '\u0394 vs {n}\uC77C \uC804', '\u0394 vs {n}\u5929\u524D', '\u0394 vs hace {n}d', '\u0394 vs {n}j'),
  'tft.velocity.newComp':  t6('NEU', 'NEW', '\uC2E0\uADDC', '\u65B0', 'NUEVO', 'NOUV.'),
  'tft.velocity.better':   t6('besser', 'better', '\uAC1C\uC120', '\u66F4\u597D', 'mejor', 'mieux'),
  'tft.velocity.worse':    t6('schlechter', 'worse', '\uC545\uD654', '\u53D8\u5DEE', 'peor', 'pire'),
  'tft.velocity.notEnough':t6('zu wenig Daten', 'not enough data', '\uB370\uC774\uD130 \uBD80\uC871', '\u6570\u636E\u4E0D\u8DB3', 'datos insuficientes', 'donn\u00E9es insuffisantes'),
  'tft.velocity.trending': t6('Trending', 'Trending', '\uD2B8\uB80C\uB529', '\u8DA3\u52BF', 'Tendencia', 'Tendance'),
  'tft.velocity.tooltip':  t6('Verbesserung der \u00D8-Platzierung vs Vergleichsfenster', 'Avg-placement improvement vs comparison window', '\uBE44\uAD50 \uAE30\uAC04 \uB300\uBE44 \uD3C9\uADE0 \uC21C\uC704 \uAC1C\uC120', '\u5E73\u5747\u540D\u6B21\u76F8\u6BD4\u53C2\u8003\u671F\u95F4\u7684\u6539\u5584', 'Mejora del puesto medio vs ventana de referencia', 'Am\u00E9lioration du classement moyen vs fen\u00EAtre de comparaison'),
  'tft.velocity.tooltipDetail': t6('Jetzt \u00D8 {now} \u00B7 vorher \u00D8 {prev}', 'Now \u00D8 {now} \u00B7 before \u00D8 {prev}', '\uD604\uC7AC \u00D8 {now} \u00B7 \uC774\uC804 \u00D8 {prev}', '\u73B0\u5728 \u00D8 {now} \u00B7 \u4E4B\u524D \u00D8 {prev}', 'Ahora \u00D8 {now} \u00B7 antes \u00D8 {prev}', 'Maintenant \u00D8 {now} \u00B7 avant \u00D8 {prev}'),
  'tft.adv.title':         t6('Erweiterte Filter', 'Advanced filters', '\uACE0\uAE09 \uD544\uD130', '\u9AD8\u7EA7\u7B5B\u9009', 'Filtros avanzados', 'Filtres avanc\u00E9s'),
  'tft.adv.reset':         t6('Zur\u00FCcksetzen', 'Reset', '\uCD08\uAE30\uD654', '\u91CD\u7F6E', 'Restablecer', 'R\u00E9initialiser'),
  'tft.adv.avgMax':        t6('\u00D8 max', 'Avg max', '\uD3C9\uADE0 \uCD5C\uB300', '\u5E73\u5747\u6700\u5927', 'Med. m\u00E1x', 'Moy. max'),
  'tft.adv.top4Min':       t6('Top 4 min', 'Top 4 min', 'Top 4 \uCD5C\uC18C', 'Top 4 \u6700\u5C0F', 'Top 4 m\u00EDn', 'Top 4 min'),
  'tft.adv.top1Min':       t6('Top 1 min', 'Top 1 min', 'Top 1 \uCD5C\uC18C', 'Top 1 \u6700\u5C0F', 'Top 1 m\u00EDn', 'Top 1 min'),
  'tft.adv.pickMax':       t6('Pick max', 'Pick max', '\uD53D\uB960 \uCD5C\uB300', '\u9009\u53D6\u7387\u6700\u5927', 'Pick m\u00E1x', 'Pick max'),
  'tft.adv.gamesMin':      t6('Spiele min', 'Games min', '\uACBD\uAE30 \uCD5C\uC18C', '\u573A\u6B21\u6700\u5C0F', 'Partidas m\u00EDn', 'Parties min'),
  'tft.adv.preset.gems':       t6('Hidden Gems', 'Hidden Gems', '\uC228\uC740 \uBCF4\uC11D', '\u9690\u85CF\u5B9D\u85CF', 'Joyas Ocultas', 'P\u00E9pites cach\u00E9es'),
  'tft.adv.preset.safe':       t6('Safe Picks', 'Safe Picks', '\uC548\uC804 \uD53D', '\u7A33\u5065\u9009\u62E9', 'Picks Seguros', 'Picks s\u00FBrs'),
  'tft.adv.preset.tournament': t6('Tournament-stark', 'Tournament-strong', '\uD1A0\uB108\uBA3C\uD2B8 \uAC15\uC138', '\u6BD4\u8D5B\u5F3A\u52BF', 'Fuerte en torneo', 'Fort en tournoi'),
  'tft.regions.title':         t6('Regionen-Meta', 'Region Meta', '\uC9C0\uC5ED\uBCC4 \uBA54\uD0C0', '\u5730\u533AMeta', 'Meta por regi\u00F3n', 'M\u00E9ta par r\u00E9gion'),
  'tft.regions.subtitle':      t6('Was KR vor dem Westen spielt', 'What KR plays before the West', '\uC11C\uC591\uBCF4\uB2E4 \uBA3C\uC800 \uD55C\uAD6D\uC774 \uD50C\uB808\uC774\uD558\uB294 \uAC83', '\u97E9\u670D\u9886\u5148\u897F\u65B9\u7684\u73A9\u6CD5', 'Lo que KR juega antes que Occidente', 'Ce que la KR joue avant l\'Ouest'),
  'tft.regions.lensKr':        t6('KR voraus', 'KR ahead', 'KR \uC55E\uC11C', '\u97E9\u670D\u9886\u5148', 'KR adelantado', 'KR en avance'),
  'tft.regions.lensEu':        t6('EU voraus', 'EU ahead', 'EU \uC55E\uC11C', '\u6B27\u670D\u9886\u5148', 'EU adelantado', 'EU en avance'),
  'tft.regions.lensNa':        t6('NA voraus', 'NA ahead', 'NA \uC55E\uC11C', '\u7F8E\u670D\u9886\u5148', 'NA adelantado', 'NA en avance'),
  // Mode-Filter (neu)
  'tft.regions.mode.all':       t6('Alle Trends', 'All trends', '\uBAA8\uB4E0 \uD2B8\uB80C\uB4DC', '\u6240\u6709\u8D8B\u52BF', 'Todas las tendencias', 'Toutes les tendances'),
  'tft.regions.mode.krAhead':   t6('KR-Vorsprung', 'KR ahead', 'KR \uC120\uD589', '\u97E9\u670D\u9886\u5148', 'KR adelantado', 'KR en avance'),
  'tft.regions.mode.westAhead': t6('West-Vorsprung', 'West ahead', '\uC11C\uC591 \uC120\uD589', '\u897F\u670D\u9886\u5148', 'Occidente adelantado', 'Ouest en avance'),
  'tft.regions.mode.mastery':   t6('Mastery-L\u00FCcke', 'Mastery gap', '\uC219\uB828\uB3C4 \uACA9\uCC28', '\u719F\u7EC3\u5EA6\u5DEE\u5F02', 'Diferencia de dominio', 'Ma\u00EEtrise'),
  // Pattern-Badges (deskriptiv statt wertend \u2014 User-Feedback 2026-06-18)
  'tft.regions.pattern.krSecret':  t6('St\u00E4rker in KR', 'Stronger in KR', 'KR\uC5D0\uC11C \uB354 \uAC15\uD568', '\u97E9\u670D\u66F4\u5F3A', 'M\u00E1s fuerte en KR', 'Plus forte en KR'),
  'tft.regions.pattern.westTrend': t6('St\u00E4rker im Westen', 'Stronger in the West', '\uC11C\uC591\uC5D0\uC11C \uB354 \uAC15\uD568', '\u897F\u670D\u66F4\u5F3A', 'M\u00E1s fuerte en Occidente', 'Plus forte en Occident'),
  'tft.regions.pattern.mastery':   t6('Besser in KR', 'Better in KR', 'KR\uC5D0\uC11C \uB354 \uC798\uD568', '\u97E9\u670D\u6253\u5F97\u66F4\u597D', 'Mejor en KR', 'Mieux en KR'),
  'tft.regions.pattern.niche':     t6('Selten gespielt', 'Rarely played', '\uB4DC\uBB3C\uAC8C \uD50C\uB808\uC774', '\u5C11\u6709\u4EBA\u73A9', 'Rara vez jugada', 'Rarement jou\u00E9e'),
  'tft.regions.pattern.etabliert': t6('Stabil verbreitet', 'Stable across regions', '\uC548\uC815\uC801\uC73C\uB85C \uBCF4\uAE09', '\u7A33\u5B9A\u6D41\u884C', 'Estable en todas las regiones', 'Stable partout'),
  // Tooltip-Erkl\u00E4rungen (Mouse-Over / Tap-to-Show)
  'tft.regions.pattern.krSecret.tooltip': t6(
    'Diese Comp wird in Korea mind. 1.3\u00D7 h\u00E4ufiger gespielt als im Westen. Kann ein Indikator f\u00FCr einen aufkommenden KR-Trend sein.',
    'This comp is played at least 1.3\u00D7 more often in Korea than in the West. May indicate an emerging KR trend.',
    '\uC774 \uC870\uD569\uC740 \uD55C\uAD6D\uC5D0\uC11C \uC11C\uC591\uBCF4\uB2E4 \uCD5C\uC18C 1.3\uBC30 \uC790\uC8FC \uD50C\uB808\uC774\uB429\uB2C8\uB2E4. \uC0C8\uB85C\uC6B4 KR \uD2B8\uB80C\uB4DC\uC758 \uC9C0\uD45C\uC77C \uC218 \uC788\uC2B5\uB2C8\uB2E4.',
    '\u8BE5\u9635\u5BB9\u5728\u97E9\u670D\u7684\u9009\u53D6\u7387\u6BD4\u897F\u670D\u81F3\u5C11\u9AD81.3\u500D\u3002\u53EF\u80FD\u662F\u65B0\u5174\u97E9\u670D\u8D8B\u52BF\u7684\u6307\u6807\u3002',
    'Esta comp se juega al menos 1.3\u00D7 m\u00E1s en Corea que en Occidente. Puede indicar una tendencia KR emergente.',
    'Cette compo est jou\u00E9e au moins 1,3\u00D7 plus souvent en Cor\u00E9e qu\'en Occident. Possible indicateur d\'une tendance KR \u00E9mergente.'
  ),
  'tft.regions.pattern.westTrend.tooltip': t6(
    'Diese Comp wird im Westen mind. 1.3\u00D7 h\u00E4ufiger gespielt als in Korea.',
    'This comp is played at least 1.3\u00D7 more often in the West than in Korea.',
    '\uC774 \uC870\uD569\uC740 \uC11C\uC591\uC5D0\uC11C \uD55C\uAD6D\uBCF4\uB2E4 \uCD5C\uC18C 1.3\uBC30 \uC790\uC8FC \uD50C\uB808\uC774\uB429\uB2C8\uB2E4.',
    '\u8BE5\u9635\u5BB9\u5728\u897F\u670D\u7684\u9009\u53D6\u7387\u6BD4\u97E9\u670D\u81F3\u5C11\u9AD81.3\u500D\u3002',
    'Esta comp se juega al menos 1.3\u00D7 m\u00E1s en Occidente que en Corea.',
    'Cette compo est jou\u00E9e au moins 1,3\u00D7 plus souvent en Occident qu\'en Cor\u00E9e.'
  ),
  'tft.regions.pattern.mastery.tooltip': t6(
    'Bei vergleichbarer Pickrate erreicht KR mit dieser Comp eine signifikant bessere \u00D8-Platzierung (\u0394 \u2265 0.25).',
    'At similar pick rates, KR achieves a significantly better avg-place with this comp (\u0394 \u2265 0.25).',
    '\uC720\uC0AC\uD55C \uC120\uD0DD\uB960\uC5D0\uC11C KR\uC774 \uC774 \uC870\uD569\uC73C\uB85C \uD3C9\uADE0 \uC21C\uC704\uAC00 \uD604\uC800\uD788 \uB354 \uC88B\uC2B5\uB2C8\uB2E4 (\u0394 \u2265 0.25).',
    '\u5728\u9009\u53D6\u7387\u76F8\u8FD1\u7684\u60C5\u51B5\u4E0B\uFF0C\u97E9\u670D\u7528\u6B64\u9635\u5BB9\u83B7\u5F97\u660E\u663E\u66F4\u597D\u7684\u5E73\u5747\u540D\u6B21 (\u0394 \u2265 0.25)\u3002',
    'Con tasas de selecci\u00F3n similares, KR logra una plaza promedio significativamente mejor (\u0394 \u2265 0.25).',
    '\u00C0 taux de s\u00E9lection similaires, la KR atteint une place moyenne nettement meilleure (\u0394 \u2265 0,25).'
  ),
  'tft.regions.pattern.niche.tooltip': t6(
    'Pickrate unter 0.3% in allen drei Regionen \u2014 f\u00FCr statistische Aussagen sind die Daten d\u00FCnn.',
    'Pick rate below 0.3% in all three regions \u2014 data is thin for statistical claims.',
    '\uC138 \uC9C0\uC5ED \uBAA8\uB450\uC5D0\uC11C \uC120\uD0DD\uB960 0.3% \uBBF8\uB9CC \u2014 \uD1B5\uACC4\uC801 \uD310\uB2E8\uC744 \uC704\uD55C \uB370\uC774\uD130\uAC00 \uBD80\uC871\uD569\uB2C8\uB2E4.',
    '\u4E09\u670D\u9009\u53D6\u7387\u5747\u4F4E\u4E8E0.3% \u2014 \u6570\u636E\u91CF\u4E0D\u8DB3\u4EE5\u652F\u6491\u7EDF\u8BA1\u7ED3\u8BBA\u3002',
    'Tasa de selecci\u00F3n bajo 0.3% en las tres regiones \u2014 datos escasos para conclusiones estad\u00EDsticas.',
    'Taux de s\u00E9lection sous 0,3% dans les trois r\u00E9gions \u2014 donn\u00E9es limit\u00E9es pour des conclusions statistiques.'
  ),
  'tft.regions.pattern.etabliert.tooltip': t6(
    'Pickrate und \u00D8-Platz unterscheiden sich nur geringf\u00FCgig zwischen den Regionen.',
    'Pick rate and avg-place differ only slightly between regions.',
    '\uC9C0\uC5ED \uAC04 \uC120\uD0DD\uB960\uACFC \uD3C9\uADE0 \uC21C\uC704 \uCC28\uC774\uAC00 \uBBF8\uBBF8\uD569\uB2C8\uB2E4.',
    '\u5404\u5730\u533A\u7684\u9009\u53D6\u7387\u4E0E\u5E73\u5747\u540D\u6B21\u5DEE\u5F02\u4E0D\u5927\u3002',
    'Tasa de selecci\u00F3n y plaza promedio difieren poco entre regiones.',
    'Le taux de s\u00E9lection et la place moyenne diff\u00E8rent peu entre les r\u00E9gions.'
  ),
  // Mode-Filter Tooltips
  'tft.regions.mode.all.tooltip': t6(
    'Zeigt alle Comps, sortiert nach St\u00E4rke des Regionen-Unterschieds.',
    'Shows all comps, sorted by strength of regional difference.',
    '\uC9C0\uC5ED \uCC28\uC774\uC758 \uAC15\uB3C4\uC21C\uC73C\uB85C \uBAA8\uB4E0 \uC870\uD569 \uD45C\uC2DC.',
    '\u663E\u793A\u6240\u6709\u9635\u5BB9\uFF0C\u6309\u5730\u533A\u5DEE\u5F02\u5F3A\u5EA6\u6392\u5E8F\u3002',
    'Muestra todas las comps, ordenadas por la fuerza de la diferencia regional.',
    'Affiche toutes les compos, tri\u00E9es par force de la diff\u00E9rence r\u00E9gionale.'
  ),
  'tft.regions.mode.krAhead.tooltip': t6(
    'Nur Comps die in KR mind. 1.3\u00D7 h\u00E4ufiger gespielt werden als im Westen.',
    'Only comps played at least 1.3\u00D7 more often in KR than in the West.',
    '\uC11C\uC591\uBCF4\uB2E4 KR\uC5D0\uC11C \uCD5C\uC18C 1.3\uBC30 \uC790\uC8FC \uD50C\uB808\uC774\uB418\uB294 \uC870\uD569\uB9CC.',
    '\u4EC5\u663E\u793A\u97E9\u670D\u9009\u53D6\u7387\u6BD4\u897F\u670D\u9AD81.3\u500D\u4EE5\u4E0A\u7684\u9635\u5BB9\u3002',
    'Solo comps que se juegan al menos 1.3\u00D7 m\u00E1s en KR que en Occidente.',
    'Seulement les compos jou\u00E9es au moins 1,3\u00D7 plus souvent en KR qu\'en Occident.'
  ),
  'tft.regions.mode.westAhead.tooltip': t6(
    'Nur Comps die im Westen mind. 1.3\u00D7 h\u00E4ufiger gespielt werden als in KR.',
    'Only comps played at least 1.3\u00D7 more often in the West than in KR.',
    'KR\uBCF4\uB2E4 \uC11C\uC591\uC5D0\uC11C \uCD5C\uC18C 1.3\uBC30 \uC790\uC8FC \uD50C\uB808\uC774\uB418\uB294 \uC870\uD569\uB9CC.',
    '\u4EC5\u663E\u793A\u897F\u670D\u9009\u53D6\u7387\u6BD4\u97E9\u670D\u9AD81.3\u500D\u4EE5\u4E0A\u7684\u9635\u5BB9\u3002',
    'Solo comps que se juegan al menos 1.3\u00D7 m\u00E1s en Occidente que en KR.',
    'Seulement les compos jou\u00E9es au moins 1,3\u00D7 plus souvent en Occident qu\'en KR.'
  ),
  'tft.regions.mode.mastery.tooltip': t6(
    'Nur Comps mit \u00E4hnlicher Pickrate aber signifikant besserer KR-\u00D8-Platzierung.',
    'Only comps with similar pick rate but significantly better KR avg-place.',
    '\uC120\uD0DD\uB960\uC774 \uBE44\uC2B7\uD558\uC9C0\uB9CC KR \uD3C9\uADE0 \uC21C\uC704\uAC00 \uD604\uC800\uD788 \uB354 \uC88B\uC740 \uC870\uD569\uB9CC.',
    '\u4EC5\u663E\u793A\u9009\u53D6\u7387\u76F8\u8FD1\u4F46\u97E9\u670D\u5E73\u5747\u540D\u6B21\u660E\u663E\u66F4\u597D\u7684\u9635\u5BB9\u3002',
    'Solo comps con tasa de selecci\u00F3n similar pero plaza promedio KR significativamente mejor.',
    'Seulement les compos \u00E0 taux de s\u00E9lection similaire mais place moyenne KR nettement meilleure.'
  ),
  // Narrative Templates pro Pattern. Placeholder: {factor} {avgDiff} {krAvg} {westAvg}
  'tft.regions.narrative.krSecret': t6(
    'KR spielt {factor} h\u00E4ufiger als der Westen \u00B7 \u00D8-Platz {avgDiff}',
    'KR plays {factor} more than the West \u00B7 Avg-Place {avgDiff}',
    'KR\uC774 \uC11C\uC591\uBCF4\uB2E4 {factor} \uB354 \uC790\uC8FC \uD50C\uB808\uC774 \u00B7 \uD3C9\uADE0 \uC21C\uC704 {avgDiff}',
    '\u97E9\u670D\u6BD4\u897F\u65B9\u591A\u73A9{factor} \u00B7 \u5E73\u5747\u540D\u6B21{avgDiff}',
    'KR juega {factor} m\u00E1s que Occidente \u00B7 Plaza prom. {avgDiff}',
    'La KR joue {factor} plus que l\'Ouest \u00B7 Place moy. {avgDiff}'
  ),
  'tft.regions.narrative.westTrend': t6(
    'Westen spielt {factor} h\u00E4ufiger als KR \u00B7 \u00D8-Platz {avgDiff}',
    'West plays {factor} more than KR \u00B7 Avg-Place {avgDiff}',
    '\uC11C\uC591\uC774 KR\uBCF4\uB2E4 {factor} \uB354 \uC790\uC8FC \uD50C\uB808\uC774 \u00B7 \uD3C9\uADE0 \uC21C\uC704 {avgDiff}',
    '\u897F\u65B9\u6BD4\u97E9\u670D\u591A\u73A9{factor} \u00B7 \u5E73\u5747\u540D\u6B21{avgDiff}',
    'Occidente juega {factor} m\u00E1s que KR \u00B7 Plaza prom. {avgDiff}',
    'L\'Ouest joue {factor} plus que la KR \u00B7 Place moy. {avgDiff}'
  ),
  'tft.regions.narrative.mastery': t6(
    'KR spielt sie deutlich besser: {krAvg} vs Westen {westAvg}',
    'KR plays it significantly better: {krAvg} vs West {westAvg}',
    'KR\uAC00 \uD6E8\uC52C \uC798 \uD50C\uB808\uC774\uD568: {krAvg} vs \uC11C\uC591 {westAvg}',
    '\u97E9\u670D\u73A9\u5F97\u660E\u663E\u66F4\u597D\uFF1A{krAvg} vs \u897F\u65B9 {westAvg}',
    'KR juega mucho mejor: {krAvg} vs Oeste {westAvg}',
    'La KR la joue nettement mieux : {krAvg} vs Ouest {westAvg}'
  ),
  'tft.regions.narrative.niche': t6(
    'Niedriges Spielaufkommen in allen Regionen',
    'Low play volume across all regions',
    '\uBAA8\uB4E0 \uC9C0\uC5ED\uC5D0\uC11C \uC801\uC740 \uD50C\uB808\uC774',
    '\u6240\u6709\u5730\u533A\u73A9\u6CD5\u91CF\u5C11',
    'Bajo volumen de juego en todas las regiones',
    'Faible volume de jeu dans toutes les r\u00E9gions'
  ),
  'tft.regions.narrative.etabliert': t6(
    'Pickrate und \u00D8-Platz \u00FCber alle Regionen vergleichbar',
    'Pick-rate and avg-place comparable across all regions',
    '\uBAA8\uB4E0 \uC9C0\uC5ED\uC5D0\uC11C \uC120\uD0DD\uB960\uACFC \uD3C9\uADE0 \uC21C\uC704 \uBE44\uC2B7',
    '\u5404\u5730\u533A\u9009\u53D6\u7387\u4E0E\u5E73\u5747\u540D\u6B21\u76F8\u4F3C',
    'Tasa de selecci\u00F3n y plaza prom. comparables en todas las regiones',
    'Taux de s\u00E9lection et place moy. similaires dans toutes les r\u00E9gions'
  ),
  'tft.regions.vsEu':          t6('vs EU', 'vs EU', 'EU \uB300\uBE44', '\u5BF9\u6B27\u670D', 'vs EU', 'vs EU'),
  'tft.regions.vsNa':          t6('vs NA', 'vs NA', 'NA \uB300\uBE44', '\u5BF9\u7F8E\u670D', 'vs NA', 'vs NA'),
  'nav.regions':               t6('Regionen', 'Regions', '\uC9C0\uC5ED', '\u5730\u533A', 'Regiones', 'R\u00E9gions'),
  'tft.comp.econRoi':          t6('Roll-Stage-ROI', 'Roll-Stage ROI', '\uB808\uBCA8 ROI', '\u6EDA\u52A8\u9636\u6BB5ROI', 'ROI por nivel', 'ROI par niveau'),
  'tft.comp.capLevel':         t6('Cap-Level', 'Cap level', '\uCEA1 \uB808\uBCA8', '\u4E0A\u9650\u7B49\u7EA7', 'Nivel tope', 'Niveau plafond'),
  'tft.comp.capShare':         t6('Anteil bei Cap', 'Cap share', '\uCEA1 \uBE44\uC728', '\u4E0A\u9650\u5360\u6BD4', 'Cuota en tope', 'Part au plafond'),
  'tft.comp.capReach':         t6('\u00D8 Reach bei Cap', 'Avg reach at cap', '\uCEA1 \uB3C4\uB2EC \uD3C9\uADE0', '\u4E0A\u9650\u5E73\u5747\u5230\u8FBE', 'Alcance medio en tope', 'Atteinte moy. au plafond'),
  'nav.metaPulse':             t6('Meta Pulse', 'Meta Pulse', '\uBA54\uD0C0 \uD384\uC2A4', '\u5143\u6570\u636E\u8109\u640F', 'Meta Pulse', 'Pouls de la m\u00E9ta'),
  'tft.metaPulse.title':       t6('Meta Pulse', 'Meta Pulse', '\uBA54\uD0C0 \uD384\uC2A4', '\u5143\u6570\u636E\u8109\u640F', 'Meta Pulse', 'Pouls de la m\u00E9ta'),
  'tft.metaPulse.subtitle':    t6('Was sich gerade bewegt', 'What\'s moving right now', '\uC9C0\uAE08 \uC6C0\uC9C1\uC774\uB294 \uAC83', '\u73B0\u5728\u7684\u8D8B\u52BF', 'Qu\u00E9 se mueve ahora', 'Ce qui bouge maintenant'),
  'tft.metaPulse.rising':      t6('Rising', 'Rising', '\uC0C1\uC2B9\uC138', '\u4E0A\u5347', 'En subida', 'En hausse'),
  'tft.metaPulse.regionCompare': t6('Regionen im Vergleich', 'Region comparison', '\uC9C0\uC5ED \uBE44\uAD50', '\u5730\u533A\u5BF9\u6BD4', 'Comparaci\u00F3n de regiones', 'Comparaison des r\u00E9gions'),
  'tft.metaPulse.regionAdd':   t6('{r} hinzuf\u00FCgen', 'Add {r}', '{r} \uCD94\uAC00', '\u6DFB\u52A0 {r}', 'A\u00F1adir {r}', 'Ajouter {r}'),
  'tft.metaPulse.regionRemove':t6('{r} entfernen', 'Remove {r}', '{r} \uC81C\uAC70', '\u79FB\u9664 {r}', 'Quitar {r}', 'Retirer {r}'),
  'tft.metaPulse.sortGap':     t6('Gr\u00F6\u00DFter Unterschied', 'Biggest gap', '\uCC28\uC774 \uD070 \uC21C', '\u5DEE\u8DDD\u6700\u5927', 'Mayor diferencia', 'Plus grand \u00E9cart'),
  'tft.metaPulse.patchWinners':t6('Patch-Gewinner', 'Patch winners', '\uD328\uCE58 \uC2B9\uC790', '\u7248\u672C\u80DC\u8005', 'Ganadores del parche', 'Gagnants du patch'),
  'tft.metaPulse.patchLosers': t6('Patch-Verlierer', 'Patch losers', '\uD328\uCE58 \uD328\uC790', '\u7248\u672C\u8D25\u8005', 'Perdedores del parche', 'Perdants du patch'),
  'tft.metaPulse.vsPatch':     t6('\u0394 vs {p}', '\u0394 vs {p}', '\u0394 vs {p}', '\u0394 vs {p}', '\u0394 vs {p}', '\u0394 vs {p}'),
  'tft.metaPulse.shortcut':    t6('Pro-Tool', 'Pro tool', '\uD504\uB85C \uB3C4\uAD6C', '\u4E13\u4E1A\u5DE5\u5177', 'Pro tool', 'Outil pro'),
  'tft.comp.carryStarOutcome': t6('Carry-Sternstufe \u2192 Outcome', 'Carry star \u2192 Outcome', '\uCE90\uB9AC \uBCC4 \u2192 \uACB0\uACFC', '\u4E3BC\u661F\u7EA7 \u2192 \u7ED3\u679C', 'Estrella del carry \u2192 resultado', '\u00C9toile du carry \u2192 r\u00E9sultat'),
  'tft.comp.contestedPenalty': t6('Contested-Penalty', 'Contested penalty', '\uACBD\uC7C1 \uD398\uB110\uD2F0', '\u4E89\u62A2\u60E9\u7F5A', 'Penalizaci\u00F3n por contenci\u00F3n', 'P\u00E9nalit\u00E9 de contention'),
  'tft.comp.contestedSolo':    t6('Solo', 'Solo', '\uB2E8\uB3C5', '\u72EC\u5360', 'Solo', 'Solo'),
  'tft.comp.contestedDuo':     t6('2 in Lobby', '2 in lobby', '\uB85C\uBE44\uC5D0 2\uBA85', '2\u4EBA\u5BF9\u5C40', '2 en lobby', '2 dans le lobby'),
  'tft.comp.contestedTriple':  t6('3+ in Lobby', '3+ in lobby', '\uB85C\uBE44\uC5D0 3\uBA85+', '3+\u4EBA\u5BF9\u5C40', '3+ en lobby', '3+ dans le lobby'),
  'tft.gameStyle':              t6('Spielweise', 'Play style', '\uD50C\uB808\uC774 \uC2A4\uD0C0\uC77C', '\u73A9\u6CD5\u98CE\u683C', 'Estilo de juego', 'Style de jeu'),
  'tft.tempo':                  t6('Tempo', 'Tempo', '\uD15C\uD3EC', '\u8282\u594F', 'Tempo', 'Tempo'),
  'tft.eco':                    t6('Eco', 'Eco', '\uACBD\uC81C', '\u7ECF\u6D4E', 'Econom\u00EDa', '\u00C9conomie'),
  'tft.tempo.tooltip': t6(
    'Wie schnell du levelst.',
    'How fast you level.',
    '\uB808\uBCA8\uC5C5 \uC18D\uB3C4.',
    '\u5347\u7EA7\u901F\u5EA6\u3002',
    'Velocidad de subida de nivel.',
    'Vitesse de progression.',
  ),
  'tft.eco.tooltip': t6(
    'Slam-Disziplin. Niedriges Restgold = sauber rausgespielt.',
    'Slam discipline. Low leftover gold = clean spend-out.',
    '\uC2AC\uB7A8 \uB514\uC2DC\uD50C\uB9B0. \uB0A8\uC740 \uACE8\uB4DC\uAC00 \uC801\uC744\uC218\uB85D \uAE54\uB054.',
    '\u88C5\u5907\u7EC4\u5408\u7EAA\u5F8B\u3002\u5269\u4F59\u91D1\u5E01\u8D8A\u5C11\u8D8A\u597D\u3002',
    'Disciplina de slam. Menos oro restante = mejor uso.',
    'Discipline de slam. Peu d\'or restant = bien d\u00E9pens\u00E9.',
  ),
  'tft.damage.tooltip': t6(
    '\u00D8 Schaden an Mitspielern (Spieler-HP, nicht Units).',
    'Avg damage to other players (player HP, not units).',
    '\uB2E4\uB978 \uD50C\uB808\uC774\uC5B4\uC5D0\uAC8C \uC900 \uD3C9\uADE0 \uD53C\uD574 (\uD50C\uB808\uC774\uC5B4 HP, \uC720\uB2DB \uC544\uB2D8).',
    '\u5BF9\u5176\u4ED6\u73A9\u5BB6\u7684\u5E73\u5747\u4F24\u5BB3\uFF08\u73A9\u5BB6HP\uFF0C\u975E\u5355\u4F4D\uFF09\u3002',
    'Da\u00F1o medio a otros jugadores (HP del jugador, no unidades).',
    'D\u00E9g\u00E2ts moy. aux autres joueurs (PV joueur, pas unit\u00E9s).',
  ),
  'tft.survival.tooltip': t6(
    'Durchschnittsplatzierung.',
    'Average placement.',
    '\uD3C9\uADE0 \uC21C\uC704.',
    '\u5E73\u5747\u540D\u6B21\u3002',
    'Posici\u00F3n media.',
    'Placement moyen.',
  ),
  'tft.consistency.tooltip': t6(
    'Anteil deiner Top-4-Platzierungen.',
    'Share of your Top 4 finishes.',
    'Top 4 \uBE44\uC728.',
    'Top 4 \u5360\u6BD4\u3002',
    'Proporci\u00F3n de partidas en Top 4.',
    'Part de tes Top 4.',
  ),
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
  'tft.noDataYet': t6('Noch keine Daten', 'No data yet', '\uC544\uC9C1 \uB370\uC774\uD130 \uC5C6\uC74C', '\u6682\u65E0\u6570\u636E', 'A\u00FAn sin datos', 'Pas encore de donn\u00E9es'),
  'tft.noCompsForSelection': t6('Keine Comps mit ausreichend Spielen f\u00FCr diese Auswahl.', 'No comps with enough games for this selection.', '\uC774 \uC120\uD0DD\uC5D0 \uCDA9\uBD84\uD55C \uAC8C\uC784\uC774 \uC788\uB294 \uB371\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.', '\u8BE5\u7B5B\u9009\u4E0B\u6CA1\u6709\u8DB3\u591F\u5BF9\u5C40\u7684\u9635\u5BB9\u3002', 'No hay composiciones con suficientes partidas para esta selecci\u00F3n.', 'Aucune compo avec assez de parties pour cette s\u00E9lection.'),
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
  'error.temporarilyUnavailable': t6(
    'Die Daten sind gerade nicht erreichbar. Bitte in einem Moment erneut versuchen.',
    'The data is temporarily unreachable. Please try again in a moment.',
    '\uD604\uC7AC \uB370\uC774\uD130\uC5D0 \uC5F0\uACB0\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.',
    '\u6570\u636E\u6682\u65F6\u65E0\u6CD5\u83B7\u53D6\u3002\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002',
    'Los datos no est\u00E1n disponibles en este momento. Int\u00E9ntalo de nuevo en un instante.',
    'Les donn\u00E9es sont momentan\u00E9ment indisponibles. Merci de r\u00E9essayer dans un instant.'
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
  'home.noMarketData': t6('Noch keine Daten', 'No data yet', '\uC544\uC9C1 \uB370\uC774\uD130 \uC5C6\uC74C', '\u6682\u65E0\u6570\u636E', 'A\u00FAn sin datos', 'Pas encore de donn\u00E9es'),
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
  'player.winrate30': t6('Winrate ({n} Spiele)', 'Win Rate ({n} Games)', '\uC2B9\uB960 ({n}\uACBD\uAE30)', '\u80DC\u7387 ({n}\u573A)', 'Winrate ({n} partidas)', 'Winrate ({n} matchs)'),
  'player.notRated': t6('Nicht bewertet', 'Not Rated', '\uD3C9\uAC00 \uC5C6\uC74C', '\u672A\u8BC4\u7EA7', 'Sin valorar', 'Non \u00E9valu\u00E9'),
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
  'lb.allTiers': t6('Alle R\u00E4nge', 'All ranks', '\uC804\uCCB4 \uB7AD\uD06C', '\u5168\u90E8\u6BB5\u4F4D', 'Todos los rangos', 'Tous les rangs'),
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
  'champ.statsCollecting': t6('Noch keine Daten', 'No data yet', '\uC544\uC9C1 \uB370\uC774\uD130 \uC5C6\uC74C', '\u6682\u65E0\u6570\u636E', 'A\u00FAn sin datos', 'Pas encore de donn\u00E9es'),
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
  'tier.masterPlus': t6('Master+', 'Master+', '\uB9C8\uC2A4\uD130+', '\u5927\u5E08+', 'Maestro+', 'Ma\u00EEtre+'),
  'tier.grandmasterPlus': t6('Grandmaster+', 'Grandmaster+', '\uADF8\uB79C\uB4DC\uB9C8\uC2A4\uD130+', '\u5B97\u5E08+', 'Gran Maestro+', 'Grand Ma\u00EEtre+'),
  'tier.diamondPlus': t6('Diamond+', 'Diamond+', '\uB2E4\uC774\uC544\uBABD\uB4DC+', '\u94BB\u77F3+', 'Diamante+', 'Diamant+'),
  'tier.emeraldPlus': t6('Emerald+', 'Emerald+', '\uC5D0\uBA54\uB784\uB4DC+', '\u7FE1\u7FE0+', 'Esmeralda+', '\u00C9meraude+'),
  'tier.platinumPlus': t6('Platinum+', 'Platinum+', '\uD50C\uB798\uD2F0\uB118+', '\u767D\u91D1+', 'Platino+', 'Platine+'),

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
  'champBuild.rank': t6('Rang', 'Rank', '티어', '段位', 'Rango', 'Rang'),
  'champBuild.patch': t6('Patch {p}', 'Patch {p}', '패치 {p}', '版本 {p}', 'Parche {p}', 'Patch {p}'),
  'champBuild.verdict.core': t6('Kern', 'Core', '핵심', '核心', 'Esencial', 'Essentiel'),
  'champBuild.verdict.important': t6('Wichtig', 'Strong', '중요', '重要', 'Importante', 'Important'),
  'champBuild.verdict.optional': t6('Optional', 'Optional', '선택', '可选', 'Opcional', 'Optionnel'),
  'champBuild.verdict.weak': t6('schwach', 'weak', '약함', '较弱', 'débil', 'faible'),
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
  'time.justNow': t6('Gerade eben', 'Just now', '\uBC29\uAE08 \uC804', '\u521A\u521A', 'Justo ahora', '\u00C0 l\'instant'),
  'time.minutesAgo': t6('Vor {n} Min.', '{n} min ago', '{n}\uBD84 \uC804', '{n}\u5206\u949F\u524D', 'Hace {n} min', 'Il y a {n} min'),
  'time.hoursAgo': t6('Vor {n} Std.', '{n} h ago', '{n}\uC2DC\uAC04 \uC804', '{n}\u5C0F\u65F6\u524D', 'Hace {n} h', 'Il y a {n} h'),
  'time.dayAgo': t6('Vor 1 Tag', '1 day ago', '1\uC77C \uC804', '1\u5929\u524D', 'Hace 1 d\u00EDa', 'Il y a 1 jour'),
  'time.daysAgo': t6('Vor {n} Tagen', '{n} days ago', '{n}\uC77C \uC804', '{n}\u5929\u524D', 'Hace {n} d\u00EDas', 'Il y a {n} jours'),
  'time.weekAgo': t6('Vor 1 Woche', '1 week ago', '1\uC8FC \uC804', '1\u5468\u524D', 'Hace 1 semana', 'Il y a 1 semaine'),
  'time.weeksAgo': t6('Vor {n} Wochen', '{n} weeks ago', '{n}\uC8FC \uC804', '{n}\u5468\u524D', 'Hace {n} semanas', 'Il y a {n} semaines'),
  'time.monthAgo': t6('Vor 1 Monat', '1 month ago', '1\uAC1C\uC6D4 \uC804', '1\u4E2A\u6708\u524D', 'Hace 1 mes', 'Il y a 1 mois'),
  'time.monthsAgo': t6('Vor {n} Monaten', '{n} months ago', '{n}\uAC1C\uC6D4 \uC804', '{n}\u4E2A\u6708\u524D', 'Hace {n} meses', 'Il y a {n} mois'),
  'time.overYearAgo': t6('Vor \u00FCber 1 Jahr', 'Over a year ago', '1\uB144 \uC774\uC0C1 \uC804', '1\u5E74\u591A\u524D', 'Hace m\u00E1s de un a\u00F1o', 'Il y a plus d\'un an'),
  'player.notFound': t6('Spieler nicht gefunden', 'Player not found', '\uD50C\uB808\uC774\uC5B4\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4', '\u672A\u627E\u5230\u73A9\u5BB6', 'Jugador no encontrado', 'Joueur introuvable'),
  'player.rateLimited': t6('Daten in K\u00FCrze wieder verf\u00FCgbar', 'Data will be available again shortly', '\uC7A0\uC2DC \uD6C4 \uB370\uC774\uD130\uB97C \uB2E4\uC2DC \uC774\uC6A9\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4', '\u6570\u636E\u7A0D\u540E\u5373\u53EF\u6062\u590D', 'Los datos volver\u00E1n a estar disponibles en breve', 'Les donn\u00E9es seront de nouveau disponibles sous peu'),
  'player.riotUnavailable': t6('Riot-Daten gerade nicht erreichbar', 'Riot data is currently unavailable', '\uD604\uC7AC Riot \uB370\uC774\uD130\uB97C \uBD88\uB7EC\uC62C \uC218 \uC5C6\uC2B5\uB2C8\uB2E4', '\u6682\u65F6\u65E0\u6CD5\u83B7\u53D6 Riot \u6570\u636E', 'Los datos de Riot no est\u00E1n disponibles en este momento', 'Les donn\u00E9es Riot sont momentan\u00E9ment indisponibles'),
  'player.loadMoreMatches': t6('Mehr Matches laden', 'Load more matches', '\uB9E4\uCE58 \uB354 \uBCF4\uAE30', '\u52A0\u8F7D\u66F4\u591A\u6BD4\u8D5B', 'Cargar m\u00E1s partidas', 'Charger plus de parties'),
  'player.masteryPoints': t6('{n} Punkte', '{n} points', '{n}\uC810', '{n}\u70B9', '{n} puntos', '{n} points'),
  'perf.title': t6('Performance-Verlauf', 'Performance trend', '\uD37C\uD3EC\uBA3C\uC2A4 \uCD94\uC774', '\u8868\u73B0\u8D70\u52BF', 'Evoluci\u00F3n del rendimiento', '\u00C9volution des performances'),
  'perf.wrTrend': t6('Winrate-Verlauf', 'Winrate trend', '\uC2B9\uB960 \uCD94\uC774', '\u80DC\u7387\u8D70\u52BF', 'Evoluci\u00F3n del winrate', '\u00C9volution du winrate'),
  'perf.wrSub': t6('Kumulativ + 5-Spiele-Schnitt', 'Cumulative + 5-game average', '\uB204\uC801 + 5\uACBD\uAE30 \uD3C9\uADE0', '\u7D2F\u8BA1 + 5\u573A\u5E73\u5747', 'Acumulado + media de 5 partidas', 'Cumul\u00E9 + moyenne sur 5 parties'),
  'perf.cumulative': t6('Kumulativ', 'Cumulative', '\uB204\uC801', '\u7D2F\u8BA1', 'Acumulado', 'Cumul\u00E9'),
  'perf.rolling': t6('5-Spiele {stat}', '5-game {stat}', '5\uACBD\uAE30 {stat}', '5\u573A{stat}', '{stat} (5 partidas)', '{stat} (5 parties)'),
  'perf.kdaTrend': t6('KDA-Verlauf', 'KDA trend', 'KDA \uCD94\uC774', 'KDA\u8D70\u52BF', 'Evoluci\u00F3n del KDA', '\u00C9volution du KDA'),
  'perf.avg5': t6('5-Spiele-Durchschnitt', '5-game average', '5\uACBD\uAE30 \uD3C9\uADE0', '5\u573A\u5E73\u5747', 'Media de 5 partidas', 'Moyenne sur 5 parties'),
  'perf.csTrend': t6('CS/Min-Verlauf', 'CS/min trend', '\uBD84\uB2F9 CS \uCD94\uC774', '\u6BCF\u5206\u949FCS\u8D70\u52BF', 'Evoluci\u00F3n de CS/min', '\u00C9volution des CS/min'),
  'perf.winsLosses': t6('Siege & Niederlagen', 'Wins & losses', '\uC2B9\uB9AC & \uD328\uBC30', '\u80DC\u8D1F', 'Victorias y derrotas', 'Victoires et d\u00E9faites'),
  'perf.perGame': t6('Pro Spiel', 'Per game', '\uACBD\uAE30\uBCC4', '\u6BCF\u573A', 'Por partida', 'Par partie'),
  'champBreakdown.title': t6('Champion-Statistiken', 'Champion stats', '\uCC54\uD53C\uC5B8 \uD1B5\uACC4', '\u82F1\u96C4\u7EDF\u8BA1', 'Estad\u00EDsticas de campeones', 'Statistiques des champions'),
  'mvChart.title': t6('Marktwert-Verlauf', 'Market value history', '\uC2DC\uC7A5 \uAC00\uCE58 \uCD94\uC774', '\u8EAB\u4EF7\u8D70\u52BF', 'Evoluci\u00F3n del valor de mercado', '\u00C9volution de la valeur marchande'),
  'mvChart.currentSeason': t6('Aktuelle Season', 'Current season', '\uD604\uC7AC \uC2DC\uC98C', '\u5F53\u524D\u8D5B\u5B63', 'Temporada actual', 'Saison actuelle'),
  'mvChart.allData': t6('Alle Daten', 'All data', '\uC804\uCCB4 \uB370\uC774\uD130', '\u5168\u90E8\u6570\u636E', 'Todos los datos', 'Toutes les donn\u00E9es'),
  'compare.vision': t6('Vision', 'Vision', '\uC2DC\uC57C', '\u89C6\u91CE', 'Visi\u00F3n', 'Vision'),
  'compare.damageSplit': t6('Schadens-Verteilung', 'Damage split', '\uD53C\uD574 \uC720\uD615 \uBD84\uD3EC', '\u4F24\u5BB3\u6784\u6210', 'Reparto de da\u00F1o', 'R\u00E9partition des d\u00E9g\u00E2ts'),
  'compare.visionPerGame': t6('Vision (\u00D8 pro Spiel)', 'Vision (avg. per game)', '\uC2DC\uC57C (\uACBD\uAE30\uB2F9 \uD3C9\uADE0)', '\u89C6\u91CE\uFF08\u573A\u5747\uFF09', 'Visi\u00F3n (media por partida)', 'Vision (moy. par partie)'),
  'compare.objectivesPerGame': t6('Objectives (\u00D8 pro Spiel)', 'Objectives (avg. per game)', '\uC624\uBE0C\uC81D\uD2B8 (\uACBD\uAE30\uB2F9 \uD3C9\uADE0)', '\u8D44\u6E90\u70B9\uFF08\u573A\u5747\uFF09', 'Objetivos (media por partida)', 'Objectifs (moy. par partie)'),
  'compare.wardsKilled': t6('Zerst\u00F6rt', 'Killed', '\uC81C\uAC70', '\u6392\u773C', 'Destruidos', 'D\u00E9truites'),
  'compare.controlWards': t6('Control', 'Control', '\uC81C\uC5B4 \uC640\uB4DC', '\u63A7\u5236\u5B88\u536B', 'Control', 'Contr\u00F4le'),
  'compare.drakes': t6('Drakes', 'Drakes', '\uB4DC\uB798\uACE4', '\u5C0F\u9F99', 'Dragones', 'Dragons'),
  'compare.baron': t6('Baron', 'Baron', '\uBC14\uB860', '\u7537\u7235', 'Bar\u00F3n', 'Baron'),
  'compare.roleSplit': t6('Rollen-Verteilung', 'Role split', '\uD3EC\uC9C0\uC158 \uBD84\uD3EC', '\u4F4D\u7F6E\u5206\u5E03', 'Reparto de roles', 'R\u00E9partition des r\u00F4les'),
  'compare.championPool': t6('Champion-Pool', 'Champion pool', '\uCC54\uD53C\uC5B8 \uD3ED', '\u82F1\u96C4\u6C60', 'Grupo de campeones', 'Pool de champions'),
  'live.bans': t6('Bans:', 'Bans:', '\uBC34:', '\u7981\u7528\uFF1A', 'Bloqueos:', 'Bannissements :'),
  'match.visShort': t6('Vis', 'Vis', '\uC2DC\uC57C', '\u89C6\u91CE', 'Vis', 'Vis'),
  'champBuild.primary': t6('Prim\u00E4r', 'Primary', '\uC8FC \uB8EC', '\u4E3B\u7CFB', 'Principal', 'Principale'),
  'champBuild.secondary': t6('Sekund\u00E4r', 'Secondary', '\uBCF4\uC870 \uB8EC', '\u526F\u7CFB', 'Secundaria', 'Secondaire'),
  'champDetail.loadError': t6('Fehler beim Laden', 'Failed to load', '\uBD88\uB7EC\uC624\uAE30 \uC2E4\uD328', '\u52A0\u8F7D\u5931\u8D25', 'Error al cargar', '\u00C9chec du chargement'),

  // Stats
  'stats.title': t6('Leistungsanalyse', 'Performance Analysis', '\uC131\uACFC \uBD84\uC11D', '\u8868\u73B0\u5206\u6790', 'An\u00E1lisis de rendimiento', 'Analyse de performance'),
  'stats.subtitle': t6('17 Statistik-Kategorien basierend auf', '17 stat categories based on', '17\uAC1C \uD1B5\uACC4 \uCE74\uD14C\uACE0\uB9AC \uAE30\uBC18', '17\u4E2A\u7EDF\u8BA1\u7C7B\u522B\u57FA\u4E8E', '17 categor\u00EDas basadas en', '17 cat\u00E9gories bas\u00E9es sur'),
  'stats.games': t6('Spielen', 'games', '\uACBD\uAE30', '\u573A\u6BD4\u8D5B', 'partidas', 'matchs'),
  'stats.coverage': t6('{n} Ranked-Spiele \u00B7 {from} \u2013 {to}', '{n} ranked games \u00B7 {from} \u2013 {to}', '\uB7AD\uD06C \uAC8C\uC784 {n}\uD310 \u00B7 {from} \u2013 {to}', '{n} \u573A\u6392\u4F4D\u8D5B \u00B7 {from} \u2013 {to}', '{n} partidas clasificatorias \u00B7 {from} \u2013 {to}', '{n} parties class\u00E9es \u00B7 {from} \u2013 {to}'),
  'stats.period': t6('Zeitraum', 'Period', '\uAE30\uAC04', '\u65F6\u95F4\u6BB5', 'Periodo', 'P\u00E9riode'),
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
  'team.loadError': t6('Team-Daten konnten nicht geladen werden', 'Could not load team data', '팀 데이터를 불러올 수 없습니다', '无法加载战队数据', 'No se pudieron cargar los datos del equipo', 'Impossible de charger les données de l’équipe'),
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
  // Coach-Texte je Rolle (DE = app/lib/ai-coach-categories.ts, Waechter: ai-coach-categories.test.mjs)
  'coach.TOP.csPerMin.title': t6('CS-Effizienz', 'CS Efficiency', 'CS \uD6A8\uC728', '\u8865\u5200\u6548\u7387', 'Eficiencia de CS', 'Efficacit\u00E9 CS'),
  'coach.TOP.csPerMin.good': t6('Exzellentes Farming \u2014 du generierst konstant Gold-Vorteile.', 'Excellent farming \u2014 you consistently generate gold leads.', '\uD6CC\uB96D\uD55C \uD30C\uBC0D \u2014 \uAFB8\uC900\uD788 \uACE8\uB4DC \uC6B0\uC704\uB97C \uB9CC\uB4E4\uC5B4\uB0C5\uB2C8\uB2E4.', '\u8865\u5200\u51FA\u8272\u2014\u2014\u4F60\u6301\u7EED\u5EFA\u7ACB\u7ECF\u6D4E\u4F18\u52BF\u3002', 'Farmeo excelente: generas ventajas de oro de forma constante.', 'Excellent farm : tu cr\u00E9es constamment des avantages en or.'),
  'coach.TOP.csPerMin.bad': t6('Arbeite am CS: Sidelane-Farm nach der Lane-Phase ist f\u00FCr Top-Laner essenziell.', 'Work on your CS: side-lane farming after the laning phase is essential for top laners.', 'CS\uB97C \uAC1C\uC120\uD558\uC138\uC694: \uB77C\uC778\uC804 \uC774\uD6C4 \uC0AC\uC774\uB4DC \uB77C\uC778 \uD30C\uBC0D\uC740 \uD0D1 \uB77C\uC774\uB108\uC5D0\uAC8C \uD544\uC218\uC785\uB2C8\uB2E4.', '\u63D0\u5347\u8865\u5200\uFF1A\u5BF9\u7EBF\u671F\u7ED3\u675F\u540E\u7684\u8FB9\u7EBF\u53D1\u80B2\u5BF9\u4E0A\u5355\u81F3\u5173\u91CD\u8981\u3002', 'Mejora tu CS: farmear las l\u00EDneas laterales tras la fase de l\u00EDneas es esencial para un top.', 'Travaille ton CS : farmer les side lanes apr\u00E8s la phase de lane est essentiel pour un toplaner.'),
  'coach.TOP.damagePerMin.title': t6('Schaden/Minute', 'Damage/Minute', '\uBD84\uB2F9 \uD53C\uD574\uB7C9', '\u6BCF\u5206\u949F\u4F24\u5BB3', 'Da\u00F1o/minuto', 'D\u00E9g\u00E2ts/minute'),
  'coach.TOP.damagePerMin.good': t6('Starker Schadensoutput \u2014 du nutzt deine Items effektiv.', 'Strong damage output \u2014 you use your items effectively.', '\uAC15\uB825\uD55C \uB51C\uB7C9 \u2014 \uC544\uC774\uD15C\uC744 \uD6A8\uACFC\uC801\uC73C\uB85C \uD65C\uC6A9\uD569\uB2C8\uB2E4.', '\u4F24\u5BB3\u8F93\u51FA\u5F3A\u52B2\u2014\u2014\u4F60\u6709\u6548\u5229\u7528\u4E86\u88C5\u5907\u3002', 'Gran producci\u00F3n de da\u00F1o: aprovechas bien tus objetos.', 'Gros d\u00E9g\u00E2ts : tu exploites efficacement tes objets.'),
  'coach.TOP.damagePerMin.bad': t6('Versuche mehr Trades in der Lane und suche Teamfight-Flanken.', 'Look for more trades in lane and find flanks in teamfights.', '\uB77C\uC778\uC5D0\uC11C \uB354 \uB9CE\uC774 \uB51C\uAD50\uD658\uD558\uACE0 \uD55C\uD0C0\uC5D0\uC11C \uCE21\uBA74\uC744 \uB178\uB9AC\uC138\uC694.', '\u5BF9\u7EBF\u65F6\u591A\u6362\u8840\uFF0C\u56E2\u6218\u4E2D\u5BFB\u627E\u4FA7\u7FFC\u5207\u5165\u673A\u4F1A\u3002', 'Busca m\u00E1s intercambios en l\u00EDnea y flanqueos en las peleas de equipo.', 'Cherche plus d\'\u00E9changes en lane et des flancs en teamfight.'),
  'coach.TOP.kda.title': t6('KDA', 'KDA', 'KDA', 'KDA', 'KDA', 'KDA'),
  'coach.TOP.kda.good': t6('Starke KDA \u2014 du stirbst selten und bist trotzdem in Kills involviert.', 'Strong KDA \u2014 you rarely die and are still involved in kills.', '\uD6CC\uB96D\uD55C KDA \u2014 \uAC70\uC758 \uC8FD\uC9C0 \uC54A\uC73C\uBA74\uC11C\uB3C4 \uD0AC\uC5D0 \uAD00\uC5EC\uD569\uB2C8\uB2E4.', 'KDA\u51FA\u8272\u2014\u2014\u4F60\u5F88\u5C11\u9635\u4EA1\uFF0C\u540C\u65F6\u4ECD\u79EF\u6781\u53C2\u4E0E\u51FB\u6740\u3002', 'Gran KDA: mueres poco y aun as\u00ED participas en los asesinatos.', 'Excellent KDA : tu meurs rarement tout en participant aux kills.'),
  'coach.TOP.kda.bad': t6('Achte auf deine Tode: wurden sie durch schlechtes Wave-Management oder fehlende Vision verursacht?', 'Watch your deaths: were they caused by poor wave management or missing vision?', '\uB370\uC2A4\uB97C \uC810\uAC80\uD558\uC138\uC694: \uC6E8\uC774\uBE0C \uAD00\uB9AC \uC2E4\uC218\uB098 \uC2DC\uC57C \uBD80\uC871 \uB54C\uBB38\uC774\uC5C8\uB098\uC694?', '\u6CE8\u610F\u4F60\u7684\u9635\u4EA1\uFF1A\u662F\u5175\u7EBF\u5904\u7406\u4E0D\u5F53\u8FD8\u662F\u7F3A\u5C11\u89C6\u91CE\u5BFC\u81F4\u7684\uFF1F', 'Revisa tus muertes: \u00BFse debieron a una mala gesti\u00F3n de oleadas o a falta de visi\u00F3n?', 'Surveille tes morts : sont-elles dues \u00E0 une mauvaise gestion des vagues ou \u00E0 un manque de vision ?'),
  'coach.TOP.deathsPerGame.title': t6('\u00DCberlebensf\u00E4higkeit', 'Survivability', '\uC0DD\uC874\uB825', '\u751F\u5B58\u80FD\u529B', 'Supervivencia', 'Survie'),
  'coach.TOP.deathsPerGame.good': t6('Wenige Tode \u2014 du \u00FCberlebst Ganks und 1v2-Situationen gut.', 'Few deaths \u2014 you survive ganks and 1v2 situations well.', '\uC801\uC740 \uB370\uC2A4 \u2014 \uAC31\uD0B9\uACFC 1\uB3002 \uC0C1\uD669\uC5D0\uC11C\uB3C4 \uC798 \uC0B4\uC544\uB0A8\uC2B5\uB2C8\uB2E4.', '\u9635\u4EA1\u5F88\u5C11\u2014\u2014\u4F60\u80FD\u5F88\u597D\u5730\u8EB2\u8FC7Gank\u548C1v2\u5C40\u9762\u3002', 'Pocas muertes: sobrevives bien a los ganks y a los 1v2.', 'Peu de morts : tu survis bien aux ganks et aux 1v2.'),
  'coach.TOP.deathsPerGame.bad': t6('Zu viele Tode auf der Toplane. Warde den River und tracke den feindlichen Jungler.', 'Too many deaths in top lane. Ward the river and track the enemy jungler.', '\uD0D1 \uB77C\uC778\uC5D0\uC11C \uB108\uBB34 \uB9CE\uC774 \uC8FD\uC2B5\uB2C8\uB2E4. \uAC15\uAC00\uC5D0 \uC640\uB4DC\uB97C \uBC15\uACE0 \uC0C1\uB300 \uC815\uAE00\uB7EC\uB97C \uCD94\uC801\uD558\uC138\uC694.', '\u4E0A\u8DEF\u9635\u4EA1\u592A\u591A\u3002\u5728\u6CB3\u9053\u63D2\u773C\u5E76\u8FFD\u8E2A\u654C\u65B9\u6253\u91CE\u3002', 'Demasiadas muertes en la l\u00EDnea superior. Coloca guardianes en el r\u00EDo y sigue al jungla enemigo.', 'Trop de morts en top. Pose des balises dans la rivi\u00E8re et traque le jungler adverse.'),
  'coach.TOP.goldPerMin.title': t6('Gold-Effizienz', 'Gold Efficiency', '\uACE8\uB4DC \uD6A8\uC728', '\u7ECF\u6D4E\u6548\u7387', 'Eficiencia de oro', 'Efficacit\u00E9 en or'),
  'coach.TOP.goldPerMin.good': t6('Hohe Gold-Generierung \u2014 Splitpush und Farm-Rotationen sitzen.', 'High gold income \u2014 your split-pushing and farm rotations are on point.', '\uB192\uC740 \uACE8\uB4DC \uC218\uAE09 \u2014 \uC2A4\uD50C\uB9BF \uD478\uC2DC\uC640 \uD30C\uBC0D \uB3D9\uC120\uC774 \uC88B\uC2B5\uB2C8\uB2E4.', '\u7ECF\u6D4E\u83B7\u53D6\u9AD8\u2014\u2014\u5E26\u7EBF\u548C\u53D1\u80B2\u8DEF\u7EBF\u90FD\u5F88\u5230\u4F4D\u3002', 'Gran generaci\u00F3n de oro: tu split push y tus rotaciones de farmeo funcionan.', 'Gros revenu en or : ton split push et tes rotations de farm sont ma\u00EEtris\u00E9s.'),
  'coach.TOP.goldPerMin.bad': t6('Achte auf Sidelane-Waves und Jungle-Camps zwischen Teamfights.', 'Pick up side-lane waves and jungle camps between teamfights.', '\uD55C\uD0C0 \uC0AC\uC774\uC0AC\uC774 \uC0AC\uC774\uB4DC \uC6E8\uC774\uBE0C\uC640 \uC815\uAE00 \uCEA0\uD504\uB97C \uCC59\uAE30\uC138\uC694.', '\u56E2\u6218\u95F4\u9699\u6CE8\u610F\u5403\u8FB9\u7EBF\u5175\u548C\u91CE\u602A\u3002', 'Recoge oleadas laterales y campamentos de jungla entre peleas.', 'R\u00E9cup\u00E8re les vagues des side lanes et les camps de jungle entre les teamfights.'),
  'coach.TOP.dmgShare.title': t6('Schadensanteil', 'Damage Share', '\uD53C\uD574\uB7C9 \uBE44\uC911', '\u4F24\u5BB3\u5360\u6BD4', 'Porcentaje de da\u00F1o', 'Part des d\u00E9g\u00E2ts'),
  'coach.TOP.dmgShare.good': t6('Du tr\u00E4gst einen gro\u00DFen Teil des Teamschadens \u2014 starkes Carry-Potenzial.', 'You deal a large share of your team\'s damage \u2014 strong carry potential.', '\uD300 \uD53C\uD574\uB7C9\uC758 \uD070 \uBD80\uBD84\uC744 \uB2F4\uB2F9\uD569\uB2C8\uB2E4 \u2014 \uCE90\uB9AC \uC7A0\uC7AC\uB825\uC774 \uB192\uC2B5\uB2C8\uB2E4.', '\u4F60\u627F\u62C5\u4E86\u56E2\u961F\u5927\u90E8\u5206\u4F24\u5BB3\u2014\u2014Carry\u6F5C\u529B\u5F88\u5F3A\u3002', 'Aportas gran parte del da\u00F1o del equipo: gran potencial de carry.', 'Tu infliges une grande part des d\u00E9g\u00E2ts de l\'\u00E9quipe : fort potentiel de carry.'),
  'coach.TOP.dmgShare.bad': t6('Dein Schadensanteil ist niedrig. Als Top-Laner solltest du in Teamfights oder Splitpush Druck machen.', 'Your damage share is low. As a top laner you should create pressure in teamfights or by split-pushing.', '\uD53C\uD574\uB7C9 \uBE44\uC911\uC774 \uB0AE\uC2B5\uB2C8\uB2E4. \uD0D1 \uB77C\uC774\uB108\uB77C\uBA74 \uD55C\uD0C0\uB098 \uC2A4\uD50C\uB9BF \uD478\uC2DC\uB85C \uC555\uBC15\uD574\uC57C \uD569\uB2C8\uB2E4.', '\u4F60\u7684\u4F24\u5BB3\u5360\u6BD4\u504F\u4F4E\u3002\u4F5C\u4E3A\u4E0A\u5355\uFF0C\u4F60\u5E94\u5728\u56E2\u6218\u6216\u5E26\u7EBF\u4E2D\u5236\u9020\u538B\u529B\u3002', 'Tu porcentaje de da\u00F1o es bajo. Como top deber\u00EDas presionar en peleas o con split push.', 'Ta part des d\u00E9g\u00E2ts est faible. En top, tu dois mettre la pression en teamfight ou en split push.'),
  'coach.JUNGLE.killParticipation.title': t6('Kill Participation', 'Kill Participation', '\uD0AC \uAD00\uC5EC\uC728', '\u53C2\u56E2\u7387', 'Participaci\u00F3n en asesinatos', 'Participation aux kills'),
  'coach.JUNGLE.killParticipation.good': t6('Du bist an den meisten Kills beteiligt \u2014 starkes Ganking und Rotieren.', 'You are involved in most kills \u2014 strong ganking and rotations.', '\uB300\uBD80\uBD84\uC758 \uD0AC\uC5D0 \uAD00\uC5EC\uD569\uB2C8\uB2E4 \u2014 \uAC31\uD0B9\uACFC \uD569\uB958\uAC00 \uD6CC\uB96D\uD569\uB2C8\uB2E4.', '\u4F60\u53C2\u4E0E\u4E86\u5927\u90E8\u5206\u51FB\u6740\u2014\u2014Gank\u548C\u652F\u63F4\u90FD\u5F88\u51FA\u8272\u3002', 'Participas en la mayor\u00EDa de asesinatos: buenos ganks y rotaciones.', 'Tu participes \u00E0 la plupart des kills : bons ganks et bonnes rotations.'),
  'coach.JUNGLE.killParticipation.bad': t6('Du verpasst zu viele Plays. Als Jungler musst du proaktiv Lanes beeinflussen.', 'You miss too many plays. As a jungler you need to influence lanes proactively.', '\uB108\uBB34 \uB9CE\uC740 \uAD50\uC804\uC744 \uB193\uCE69\uB2C8\uB2E4. \uC815\uAE00\uB7EC\uB294 \uC801\uADF9\uC801\uC73C\uB85C \uB77C\uC778\uC5D0 \uC601\uD5A5\uC744 \uC918\uC57C \uD569\uB2C8\uB2E4.', '\u4F60\u9519\u8FC7\u4E86\u592A\u591A\u673A\u4F1A\u3002\u4F5C\u4E3A\u6253\u91CE\uFF0C\u4F60\u5FC5\u987B\u4E3B\u52A8\u5F71\u54CD\u5404\u8DEF\u3002', 'Te pierdes demasiadas jugadas. Como jungla debes influir en las l\u00EDneas de forma proactiva.', 'Tu rates trop d\'actions. En jungle, tu dois influencer les lanes de mani\u00E8re proactive.'),
  'coach.JUNGLE.kda.title': t6('KDA', 'KDA', 'KDA', 'KDA', 'KDA', 'KDA'),
  'coach.JUNGLE.kda.good': t6('Hohe KDA \u2014 du w\u00E4hlst deine Ganks klug und stirbst nicht unn\u00F6tig.', 'High KDA \u2014 you pick your ganks wisely and don\'t die needlessly.', '\uB192\uC740 KDA \u2014 \uAC31\uD0B9\uC744 \uD604\uBA85\uD558\uAC8C \uC120\uD0DD\uD558\uACE0 \uBD88\uD544\uC694\uD558\uAC8C \uC8FD\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.', 'KDA\u5F88\u9AD8\u2014\u2014\u4F60\u660E\u667A\u5730\u9009\u62E9Gank\u65F6\u673A\uFF0C\u4E0D\u505A\u65E0\u8C13\u727A\u7272\u3002', 'KDA alto: eliges bien tus ganks y no mueres sin necesidad.', 'KDA \u00E9lev\u00E9 : tu choisis bien tes ganks et ne meurs pas inutilement.'),
  'coach.JUNGLE.kda.bad': t6('Achte darauf, nur Ganks zu nehmen mit hoher Erfolgswahrscheinlichkeit.', 'Make sure to only take ganks with a high chance of success.', '\uC131\uACF5 \uD655\uB960\uC774 \uB192\uC740 \uAC31\uD0B9\uB9CC \uC2DC\uB3C4\uD558\uC138\uC694.', '\u53EA\u9009\u62E9\u6210\u529F\u7387\u9AD8\u7684Gank\u3002', 'Procura hacer solo ganks con alta probabilidad de \u00E9xito.', 'Ne tente que des ganks \u00E0 forte chance de r\u00E9ussite.'),
  'coach.JUNGLE.visionScore.title': t6('Vision Control', 'Vision Control', '\uC2DC\uC57C \uC7A5\uC545', '\u89C6\u91CE\u63A7\u5236', 'Control de visi\u00F3n', 'Contr\u00F4le de la vision'),
  'coach.JUNGLE.visionScore.good': t6('Starke Vision \u2014 du kontrollierst die Karte f\u00FCr dein Team.', 'Strong vision \u2014 you control the map for your team.', '\uB6F0\uC5B4\uB09C \uC2DC\uC57C \u2014 \uD300\uC744 \uC704\uD574 \uB9F5\uC744 \uC7A5\uC545\uD569\uB2C8\uB2E4.', '\u89C6\u91CE\u51FA\u8272\u2014\u2014\u4F60\u4E3A\u56E2\u961F\u638C\u63A7\u4E86\u5730\u56FE\u3002', 'Buena visi\u00F3n: controlas el mapa para tu equipo.', 'Bonne vision : tu contr\u00F4les la carte pour ton \u00E9quipe.'),
  'coach.JUNGLE.visionScore.bad': t6('Als Jungler bist du verantwortlich f\u00FCr River- und Objective-Vision. Kaufe mehr Control Wards.', 'As a jungler you are responsible for river and objective vision. Buy more Control Wards.', '\uC815\uAE00\uB7EC\uB294 \uAC15\uAC00\uC640 \uC624\uBE0C\uC81D\uD2B8 \uC2DC\uC57C\uB97C \uCC45\uC784\uC9D1\uB2C8\uB2E4. \uC81C\uC5B4 \uC640\uB4DC\uB97C \uB354 \uAD6C\uB9E4\uD558\uC138\uC694.', '\u4F5C\u4E3A\u6253\u91CE\uFF0C\u4F60\u8D1F\u8D23\u6CB3\u9053\u548C\u8D44\u6E90\u533A\u7684\u89C6\u91CE\u3002\u591A\u4E70\u63A7\u5236\u5B88\u536B\u3002', 'Como jungla eres responsable de la visi\u00F3n del r\u00EDo y de los objetivos. Compra m\u00E1s guardianes de control.', 'En jungle, tu es responsable de la vision de la rivi\u00E8re et des objectifs. Ach\u00E8te plus de balises de contr\u00F4le.'),
  'coach.JUNGLE.csPerMin.title': t6('Farm-Effizienz', 'Farm Efficiency', '\uD30C\uBC0D \uD6A8\uC728', '\u5237\u91CE\u6548\u7387', 'Eficiencia de farmeo', 'Efficacit\u00E9 de farm'),
  'coach.JUNGLE.csPerMin.good': t6('Du farmst effizient zwischen Ganks \u2014 gutes Jungle-Pathing.', 'You farm efficiently between ganks \u2014 good jungle pathing.', '\uAC31\uD0B9 \uC0AC\uC774\uC5D0 \uD6A8\uC728\uC801\uC73C\uB85C \uD30C\uBC0D\uD569\uB2C8\uB2E4 \u2014 \uC815\uAE00 \uB3D9\uC120\uC774 \uC88B\uC2B5\uB2C8\uB2E4.', '\u4F60\u5728Gank\u95F4\u9699\u9AD8\u6548\u5237\u91CE\u2014\u2014\u6253\u91CE\u8DEF\u7EBF\u89C4\u5212\u5F97\u597D\u3002', 'Farmeas eficientemente entre ganks: buena ruta de jungla.', 'Tu farmes efficacement entre les ganks : bon pathing en jungle.'),
  'coach.JUNGLE.csPerMin.bad': t6('Deine Farm ist zu niedrig. Optimiere dein Pathing: Full-Clear vs. Gank-Heavy Route.', 'Your farm is too low. Optimize your pathing: full clear vs. gank-heavy route.', '\uD30C\uBC0D\uC774 \uB108\uBB34 \uC801\uC2B5\uB2C8\uB2E4. \uB3D9\uC120\uC744 \uCD5C\uC801\uD654\uD558\uC138\uC694: \uD480 \uD074\uB9AC\uC5B4 vs. \uAC31\uD0B9 \uC704\uC8FC \uB8E8\uD2B8.', '\u4F60\u7684\u5237\u91CE\u91CF\u592A\u4F4E\u3002\u4F18\u5316\u8DEF\u7EBF\uFF1A\u5168\u6E05\u8FD8\u662F\u591AGank\u3002', 'Tu farmeo es demasiado bajo. Optimiza tu ruta: limpieza completa o ruta de ganks.', 'Ton farm est trop faible. Optimise ton pathing : full clear ou route orient\u00E9e ganks.'),
  'coach.JUNGLE.deathsPerGame.title': t6('\u00DCberlebensf\u00E4higkeit', 'Survivability', '\uC0DD\uC874\uB825', '\u751F\u5B58\u80FD\u529B', 'Supervivencia', 'Survie'),
  'coach.JUNGLE.deathsPerGame.good': t6('Wenige Tode \u2014 du positionierst dich gut und w\u00E4hlst Fights klug.', 'Few deaths \u2014 you position well and pick your fights wisely.', '\uC801\uC740 \uB370\uC2A4 \u2014 \uD3EC\uC9C0\uC154\uB2DD\uC774 \uC88B\uACE0 \uAD50\uC804\uC744 \uD604\uBA85\uD558\uAC8C \uC120\uD0DD\uD569\uB2C8\uB2E4.', '\u9635\u4EA1\u5F88\u5C11\u2014\u2014\u4F60\u7AD9\u4F4D\u5408\u7406\uFF0C\u9009\u62E9\u56E2\u6218\u660E\u667A\u3002', 'Pocas muertes: te posicionas bien y eliges bien tus peleas.', 'Peu de morts : tu te places bien et choisis tes combats avec soin.'),
  'coach.JUNGLE.deathsPerGame.bad': t6('Zu viele Tode. Vermeide 50/50-Plays und tracke den feindlichen Jungler besser.', 'Too many deaths. Avoid 50/50 plays and track the enemy jungler better.', '\uB370\uC2A4\uAC00 \uB108\uBB34 \uB9CE\uC2B5\uB2C8\uB2E4. 50/50 \uD50C\uB808\uC774\uB97C \uD53C\uD558\uACE0 \uC0C1\uB300 \uC815\uAE00\uB7EC\uB97C \uB354 \uC798 \uCD94\uC801\uD558\uC138\uC694.', '\u9635\u4EA1\u592A\u591A\u3002\u907F\u514D\u4E94\u4E94\u5F00\u7684\u64CD\u4F5C\uFF0C\u66F4\u597D\u5730\u8FFD\u8E2A\u654C\u65B9\u6253\u91CE\u3002', 'Demasiadas muertes. Evita jugadas 50/50 y sigue mejor al jungla enemigo.', 'Trop de morts. \u00C9vite les actions \u00E0 50/50 et traque mieux le jungler adverse.'),
  'coach.JUNGLE.objectiveDmg.title': t6('Objektiv-Kontrolle', 'Objective Control', '\uC624\uBE0C\uC81D\uD2B8 \uC7A5\uC545', '\u8D44\u6E90\u63A7\u5236', 'Control de objetivos', 'Contr\u00F4le des objectifs'),
  'coach.JUNGLE.objectiveDmg.good': t6('Du priorisierst Objektive effektiv \u2014 Drake und Baron im Fokus.', 'You prioritize objectives effectively \u2014 drakes and Baron in focus.', '\uC624\uBE0C\uC81D\uD2B8\uB97C \uD6A8\uACFC\uC801\uC73C\uB85C \uC6B0\uC120\uC2DC\uD569\uB2C8\uB2E4 \u2014 \uB4DC\uB798\uACE4\uACFC \uBC14\uB860\uC5D0 \uC9D1\uC911\uD569\uB2C8\uB2E4.', '\u4F60\u6709\u6548\u5730\u4F18\u5148\u5904\u7406\u8D44\u6E90\u2014\u2014\u4E13\u6CE8\u5C0F\u9F99\u548C\u5927\u9F99\u3002', 'Priorizas bien los objetivos: dragones y Bar\u00F3n en el foco.', 'Tu priorises efficacement les objectifs : dragons et Baron en ligne de mire.'),
  'coach.JUNGLE.objectiveDmg.bad': t6('Mehr Fokus auf Drakes und Baron. Spiele um Objective-Timer, nicht nur um Kills.', 'Focus more on drakes and Baron. Play around objective timers, not just kills.', '\uB4DC\uB798\uACE4\uACFC \uBC14\uB860\uC5D0 \uB354 \uC9D1\uC911\uD558\uC138\uC694. \uD0AC\uB9CC\uC774 \uC544\uB2C8\uB77C \uC624\uBE0C\uC81D\uD2B8 \uD0C0\uC774\uBA38\uB97C \uC911\uC2EC\uC73C\uB85C \uD50C\uB808\uC774\uD558\uC138\uC694.', '\u66F4\u591A\u5173\u6CE8\u5C0F\u9F99\u548C\u5927\u9F99\u3002\u56F4\u7ED5\u8D44\u6E90\u5237\u65B0\u65F6\u95F4\u8FD0\u8425\uFF0C\u800C\u4E0D\u53EA\u662F\u8FFD\u6C42\u51FB\u6740\u3002', 'C\u00E9ntrate m\u00E1s en dragones y Bar\u00F3n. Juega en torno a los tiempos de objetivos, no solo a los asesinatos.', 'Concentre-toi davantage sur les dragons et le Baron. Joue autour des timers d\'objectifs, pas seulement des kills.'),
  'coach.MID.csPerMin.title': t6('CS-Effizienz', 'CS Efficiency', 'CS \uD6A8\uC728', '\u8865\u5200\u6548\u7387', 'Eficiencia de CS', 'Efficacit\u00E9 CS'),
  'coach.MID.csPerMin.good': t6('Starkes Farming \u2014 du nutzt Mid-Prio f\u00FCr Jungle-Camps und Waves.', 'Strong farming \u2014 you use mid priority for jungle camps and waves.', '\uD6CC\uB96D\uD55C \uD30C\uBC0D \u2014 \uBBF8\uB4DC \uC8FC\uB3C4\uAD8C\uC744 \uC815\uAE00 \uCEA0\uD504\uC640 \uC6E8\uC774\uBE0C\uC5D0 \uD65C\uC6A9\uD569\uB2C8\uB2E4.', '\u8865\u5200\u51FA\u8272\u2014\u2014\u4F60\u5229\u7528\u4E2D\u8DEF\u7EBF\u6743\u5403\u91CE\u602A\u548C\u5175\u7EBF\u3002', 'Buen farmeo: aprovechas la prioridad en medio para campamentos y oleadas.', 'Bon farm : tu utilises la priorit\u00E9 mid pour les camps et les vagues.'),
  'coach.MID.csPerMin.bad': t6('Dein CS ist zu niedrig. Nutze Mid-Prio: Pushe die Wave, nimm Raptors/Wolves.', 'Your CS is too low. Use mid priority: push the wave, take raptors/wolves.', 'CS\uAC00 \uB108\uBB34 \uB0AE\uC2B5\uB2C8\uB2E4. \uBBF8\uB4DC \uC8FC\uB3C4\uAD8C\uC744 \uD65C\uC6A9\uD558\uC138\uC694: \uC6E8\uC774\uBE0C\uB97C \uBC00\uACE0 \uCE7C\uB0A0\uBD80\uB9AC/\uB291\uB300\uB97C \uCC59\uAE30\uC138\uC694.', '\u4F60\u7684\u8865\u5200\u592A\u4F4E\u3002\u5229\u7528\u4E2D\u8DEF\u7EBF\u6743\uFF1A\u63A8\u7EBF\u540E\u62FF\u950B\u5599\u9E1F/\u5E7D\u5F71\u72FC\u3002', 'Tu CS es demasiado bajo. Usa la prioridad en medio: empuja la oleada y toma raptores/lobos.', 'Ton CS est trop faible. Utilise la priorit\u00E9 mid : pousse la vague et prends raptors/loups.'),
  'coach.MID.damagePerMin.title': t6('Schaden/Minute', 'Damage/Minute', '\uBD84\uB2F9 \uD53C\uD574\uB7C9', '\u6BCF\u5206\u949F\u4F24\u5BB3', 'Da\u00F1o/minuto', 'D\u00E9g\u00E2ts/minute'),
  'coach.MID.damagePerMin.good': t6('Exzellenter Schadensoutput \u2014 du bist die Carry-Kraft deines Teams.', 'Excellent damage output \u2014 you are your team\'s carry.', '\uD6CC\uB96D\uD55C \uB51C\uB7C9 \u2014 \uD300\uC758 \uCE90\uB9AC\uC785\uB2C8\uB2E4.', '\u4F24\u5BB3\u8F93\u51FA\u51FA\u8272\u2014\u2014\u4F60\u662F\u56E2\u961F\u7684Carry\u6838\u5FC3\u3002', 'Producci\u00F3n de da\u00F1o excelente: eres el carry de tu equipo.', 'Excellents d\u00E9g\u00E2ts : tu es le carry de ton \u00E9quipe.'),
  'coach.MID.damagePerMin.bad': t6('Dein Schaden ist unterdurchschnittlich. Suche mehr Trades und nutze Powerspikes.', 'Your damage is below average. Look for more trades and use your power spikes.', '\uD53C\uD574\uB7C9\uC774 \uD3C9\uADE0 \uC774\uD558\uC785\uB2C8\uB2E4. \uB354 \uB9CE\uC774 \uB51C\uAD50\uD658\uD558\uACE0 \uD30C\uC6CC \uC2A4\uD30C\uC774\uD06C\uB97C \uD65C\uC6A9\uD558\uC138\uC694.', '\u4F60\u7684\u4F24\u5BB3\u4F4E\u4E8E\u5E73\u5747\u3002\u591A\u6362\u8840\u5E76\u5229\u7528\u5F3A\u52BF\u671F\u3002', 'Tu da\u00F1o est\u00E1 por debajo de la media. Busca m\u00E1s intercambios y aprovecha tus picos de poder.', 'Tes d\u00E9g\u00E2ts sont sous la moyenne. Cherche plus d\'\u00E9changes et exploite tes pics de puissance.'),
  'coach.MID.kda.title': t6('KDA', 'KDA', 'KDA', 'KDA', 'KDA', 'KDA'),
  'coach.MID.kda.good': t6('Starke KDA \u2014 du maximierst Kills bei minimalen Toden.', 'Strong KDA \u2014 you maximize kills with minimal deaths.', '\uD6CC\uB96D\uD55C KDA \u2014 \uCD5C\uC18C\uD55C\uC758 \uB370\uC2A4\uB85C \uD0AC\uC744 \uADF9\uB300\uD654\uD569\uB2C8\uB2E4.', 'KDA\u51FA\u8272\u2014\u2014\u4F60\u4EE5\u6700\u5C11\u7684\u9635\u4EA1\u6362\u53D6\u6700\u591A\u7684\u51FB\u6740\u3002', 'Gran KDA: maximizas asesinatos con el m\u00EDnimo de muertes.', 'Excellent KDA : tu maximises les kills avec un minimum de morts.'),
  'coach.MID.kda.bad': t6('Vermeide unn\u00F6tige Solo-Plays. Mid-Laner haben hohen Impact \u2014 jeder Tod kostet Map-Prio.', 'Avoid unnecessary solo plays. Mid laners have high impact \u2014 every death costs map priority.', '\uBD88\uD544\uC694\uD55C \uB2E8\uB3C5 \uD50C\uB808\uC774\uB97C \uD53C\uD558\uC138\uC694. \uBBF8\uB4DC \uB77C\uC774\uB108\uB294 \uC601\uD5A5\uB825\uC774 \uCEE4\uC11C \uB370\uC2A4\uB9C8\uB2E4 \uB9F5 \uC8FC\uB3C4\uAD8C\uC744 \uC783\uC2B5\uB2C8\uB2E4.', '\u907F\u514D\u4E0D\u5FC5\u8981\u7684\u5355\u72EC\u884C\u52A8\u3002\u4E2D\u5355\u5F71\u54CD\u529B\u5927\u2014\u2014\u6BCF\u6B21\u9635\u4EA1\u90FD\u4F1A\u5931\u53BB\u5730\u56FE\u4E3B\u52A8\u6743\u3002', 'Evita jugadas en solitario innecesarias. Los mid tienen mucho impacto: cada muerte cuesta prioridad en el mapa.', '\u00C9vite les actions solo inutiles. Les midlaners ont un fort impact : chaque mort co\u00FBte la priorit\u00E9 sur la carte.'),
  'coach.MID.killParticipation.title': t6('Kill Participation', 'Kill Participation', '\uD0AC \uAD00\uC5EC\uC728', '\u53C2\u56E2\u7387', 'Participaci\u00F3n en asesinatos', 'Participation aux kills'),
  'coach.MID.killParticipation.good': t6('Du bist bei vielen Kills beteiligt \u2014 starkes Roaming und Teamplay.', 'You are involved in many kills \u2014 strong roaming and teamplay.', '\uB9CE\uC740 \uD0AC\uC5D0 \uAD00\uC5EC\uD569\uB2C8\uB2E4 \u2014 \uB85C\uBC0D\uACFC \uD300\uD50C\uB808\uC774\uAC00 \uD6CC\uB96D\uD569\uB2C8\uB2E4.', '\u4F60\u53C2\u4E0E\u4E86\u5F88\u591A\u51FB\u6740\u2014\u2014\u6E38\u8D70\u548C\u56E2\u961F\u914D\u5408\u51FA\u8272\u3002', 'Participas en muchos asesinatos: buen roaming y juego en equipo.', 'Tu participes \u00E0 beaucoup de kills : bon roaming et bon jeu d\'\u00E9quipe.'),
  'coach.MID.killParticipation.bad': t6('Du verpasst Plays. Nutze Prio zum Roamen und unterst\u00FCtze Skirmishes.', 'You miss plays. Use priority to roam and support skirmishes.', '\uAD50\uC804\uC744 \uB193\uCE58\uACE0 \uC788\uC2B5\uB2C8\uB2E4. \uC8FC\uB3C4\uAD8C\uC744 \uD65C\uC6A9\uD574 \uB85C\uBC0D\uD558\uACE0 \uC18C\uADDC\uBAA8 \uAD50\uC804\uC744 \uC9C0\uC6D0\uD558\uC138\uC694.', '\u4F60\u9519\u8FC7\u4E86\u673A\u4F1A\u3002\u5229\u7528\u7EBF\u6743\u6E38\u8D70\u5E76\u652F\u63F4\u5C0F\u89C4\u6A21\u56E2\u6218\u3002', 'Te pierdes jugadas. Usa la prioridad para rotar y apoyar escaramuzas.', 'Tu rates des actions. Utilise ta priorit\u00E9 pour roam et soutenir les escarmouches.'),
  'coach.MID.deathsPerGame.title': t6('\u00DCberlebensf\u00E4higkeit', 'Survivability', '\uC0DD\uC874\uB825', '\u751F\u5B58\u80FD\u529B', 'Supervivencia', 'Survie'),
  'coach.MID.deathsPerGame.good': t6('Wenige Tode \u2014 du positionierst dich sicher trotz zentraler Rolle.', 'Few deaths \u2014 you position safely despite your central role.', '\uC801\uC740 \uB370\uC2A4 \u2014 \uC911\uC2EC \uC5ED\uD560\uC784\uC5D0\uB3C4 \uC548\uC804\uD558\uAC8C \uD3EC\uC9C0\uC154\uB2DD\uD569\uB2C8\uB2E4.', '\u9635\u4EA1\u5F88\u5C11\u2014\u2014\u5C3D\u7BA1\u4F4D\u7F6E\u5C45\u4E2D\uFF0C\u4F60\u7684\u7AD9\u4F4D\u4F9D\u7136\u5B89\u5168\u3002', 'Pocas muertes: te posicionas con seguridad pese a tu rol central.', 'Peu de morts : tu te places prudemment malgr\u00E9 ton r\u00F4le central.'),
  'coach.MID.deathsPerGame.bad': t6('Zu viele Tode. Respektiere feindliche Jungler-Ganks und warde aggressive Spots.', 'Too many deaths. Respect enemy jungler ganks and ward aggressive spots.', '\uB370\uC2A4\uAC00 \uB108\uBB34 \uB9CE\uC2B5\uB2C8\uB2E4. \uC0C1\uB300 \uC815\uAE00\uB7EC\uC758 \uAC31\uD0B9\uC744 \uACBD\uACC4\uD558\uACE0 \uACF5\uACA9\uC801\uC778 \uC704\uCE58\uC5D0 \uC640\uB4DC\uB97C \uBC15\uC73C\uC138\uC694.', '\u9635\u4EA1\u592A\u591A\u3002\u63D0\u9632\u654C\u65B9\u6253\u91CEGank\uFF0C\u5728\u6FC0\u8FDB\u4F4D\u7F6E\u63D2\u773C\u3002', 'Demasiadas muertes. Respeta los ganks del jungla enemigo y coloca guardianes en zonas agresivas.', 'Trop de morts. Respecte les ganks du jungler adverse et pose des balises dans les zones agressives.'),
  'coach.MID.goldPerMin.title': t6('Gold-Effizienz', 'Gold Efficiency', '\uACE8\uB4DC \uD6A8\uC728', '\u7ECF\u6D4E\u6548\u7387', 'Eficiencia de oro', 'Efficacit\u00E9 en or'),
  'coach.MID.goldPerMin.good': t6('Hohe Gold-Generierung \u2014 du nutzt deine Ressourcen optimal.', 'High gold income \u2014 you make optimal use of your resources.', '\uB192\uC740 \uACE8\uB4DC \uC218\uAE09 \u2014 \uC790\uC6D0\uC744 \uCD5C\uC801\uC73C\uB85C \uD65C\uC6A9\uD569\uB2C8\uB2E4.', '\u7ECF\u6D4E\u83B7\u53D6\u9AD8\u2014\u2014\u4F60\u5145\u5206\u5229\u7528\u4E86\u8D44\u6E90\u3002', 'Gran generaci\u00F3n de oro: aprovechas al m\u00E1ximo tus recursos.', 'Gros revenu en or : tu exploites au mieux tes ressources.'),
  'coach.MID.goldPerMin.bad': t6('Farm mehr Sidelane-Waves und Jungle-Camps nach der Lane-Phase.', 'Farm more side-lane waves and jungle camps after the laning phase.', '\uB77C\uC778\uC804 \uC774\uD6C4 \uC0AC\uC774\uB4DC \uC6E8\uC774\uBE0C\uC640 \uC815\uAE00 \uCEA0\uD504\uB97C \uB354 \uCC59\uAE30\uC138\uC694.', '\u5BF9\u7EBF\u671F\u540E\u591A\u5403\u8FB9\u7EBF\u5175\u548C\u91CE\u602A\u3002', 'Farmea m\u00E1s oleadas laterales y campamentos de jungla tras la fase de l\u00EDneas.', 'Farme plus de vagues en side lane et de camps de jungle apr\u00E8s la phase de lane.'),
  'coach.BOTTOM.csPerMin.title': t6('CS-Effizienz', 'CS Efficiency', 'CS \uD6A8\uC728', '\u8865\u5200\u6548\u7387', 'Eficiencia de CS', 'Efficacit\u00E9 CS'),
  'coach.BOTTOM.csPerMin.good': t6('Exzellentes Farming \u2014 als ADC dein wichtigster Skill.', 'Excellent farming \u2014 your most important skill as an ADC.', '\uD6CC\uB96D\uD55C \uD30C\uBC0D \u2014 \uC6D0\uB51C\uC5D0\uAC8C \uAC00\uC7A5 \uC911\uC694\uD55C \uB2A5\uB825\uC785\uB2C8\uB2E4.', '\u8865\u5200\u51FA\u8272\u2014\u2014\u8FD9\u662FADC\u6700\u91CD\u8981\u7684\u6280\u80FD\u3002', 'Farmeo excelente: tu habilidad m\u00E1s importante como ADC.', 'Excellent farm : ta comp\u00E9tence la plus importante en ADC.'),
  'coach.BOTTOM.csPerMin.bad': t6('CS ist die #1 Priorit\u00E4t f\u00FCr ADCs. \u00DCbe Last-Hitting und greife Sidelane-Waves ab.', 'CS is the #1 priority for ADCs. Practice last-hitting and pick up side-lane waves.', 'CS\uB294 \uC6D0\uB51C\uC758 \uCD5C\uC6B0\uC120 \uACFC\uC81C\uC785\uB2C8\uB2E4. \uB9C9\uD0C0 \uC5F0\uC2B5\uC744 \uD558\uACE0 \uC0AC\uC774\uB4DC \uC6E8\uC774\uBE0C\uB97C \uCC59\uAE30\uC138\uC694.', '\u8865\u5200\u662FADC\u7684\u7B2C\u4E00\u8981\u52A1\u3002\u7EC3\u4E60\u8865\u5200\u5E76\u5403\u8FB9\u7EBF\u5175\u3002', 'El CS es la prioridad n.\u00BA 1 de un ADC. Practica el \u00FAltimo golpe y recoge oleadas laterales.', 'Le CS est la priorit\u00E9 n\u00B0 1 d\'un ADC. Entra\u00EEne-toi au last hit et r\u00E9cup\u00E8re les vagues des side lanes.'),
  'coach.BOTTOM.damagePerMin.title': t6('Schaden/Minute', 'Damage/Minute', '\uBD84\uB2F9 \uD53C\uD574\uB7C9', '\u6BCF\u5206\u949F\u4F24\u5BB3', 'Da\u00F1o/minuto', 'D\u00E9g\u00E2ts/minute'),
  'coach.BOTTOM.damagePerMin.good': t6('Top-Schadensoutput \u2014 du bist der prim\u00E4re Carry deines Teams.', 'Top damage output \u2014 you are your team\'s primary carry.', '\uCD5C\uC0C1\uC704 \uB51C\uB7C9 \u2014 \uD300\uC758 \uC8FC\uB825 \uCE90\uB9AC\uC785\uB2C8\uB2E4.', '\u9876\u7EA7\u4F24\u5BB3\u8F93\u51FA\u2014\u2014\u4F60\u662F\u56E2\u961F\u7684\u4E3B\u529BCarry\u3002', 'Producci\u00F3n de da\u00F1o de primer nivel: eres el carry principal de tu equipo.', 'D\u00E9g\u00E2ts de haut niveau : tu es le carry principal de ton \u00E9quipe.'),
  'coach.BOTTOM.damagePerMin.bad': t6('Dein Schaden ist f\u00FCr einen ADC zu niedrig. Positioniere dich in Teamfights sicher und hit den n\u00E4chsten Gegner.', 'Your damage is too low for an ADC. Position safely in teamfights and hit the closest enemy.', '\uC6D0\uB51C\uCE58\uACE0 \uD53C\uD574\uB7C9\uC774 \uB108\uBB34 \uB0AE\uC2B5\uB2C8\uB2E4. \uD55C\uD0C0\uC5D0\uC11C \uC548\uC804\uD558\uAC8C \uC790\uB9AC \uC7A1\uACE0 \uAC00\uC7A5 \uAC00\uAE4C\uC6B4 \uC801\uC744 \uACF5\uACA9\uD558\uC138\uC694.', '\u4F5C\u4E3AADC\u4F60\u7684\u4F24\u5BB3\u592A\u4F4E\u3002\u56E2\u6218\u4E2D\u7AD9\u4F4D\u5B89\u5168\uFF0C\u653B\u51FB\u6700\u8FD1\u7684\u654C\u4EBA\u3002', 'Tu da\u00F1o es demasiado bajo para un ADC. Posici\u00F3nate con seguridad en las peleas y golpea al enemigo m\u00E1s cercano.', 'Tes d\u00E9g\u00E2ts sont trop faibles pour un ADC. Place-toi en s\u00E9curit\u00E9 en teamfight et frappe l\'ennemi le plus proche.'),
  'coach.BOTTOM.dmgShare.title': t6('Schadensanteil', 'Damage Share', '\uD53C\uD574\uB7C9 \uBE44\uC911', '\u4F24\u5BB3\u5360\u6BD4', 'Porcentaje de da\u00F1o', 'Part des d\u00E9g\u00E2ts'),
  'coach.BOTTOM.dmgShare.good': t6('Du tr\u00E4gst den gr\u00F6\u00DFten Teil des Teamschadens \u2014 so soll ein ADC spielen.', 'You deal the largest share of your team\'s damage \u2014 that\'s how an ADC should play.', '\uD300 \uD53C\uD574\uB7C9\uC758 \uAC00\uC7A5 \uD070 \uBD80\uBD84\uC744 \uB2F4\uB2F9\uD569\uB2C8\uB2E4 \u2014 \uC6D0\uB51C\uB2E4\uC6B4 \uD50C\uB808\uC774\uC785\uB2C8\uB2E4.', '\u4F60\u627F\u62C5\u4E86\u56E2\u961F\u6700\u591A\u7684\u4F24\u5BB3\u2014\u2014ADC\u5C31\u8BE5\u8FD9\u4E48\u6253\u3002', 'Aportas la mayor parte del da\u00F1o del equipo: as\u00ED debe jugar un ADC.', 'Tu infliges la plus grande part des d\u00E9g\u00E2ts de l\'\u00E9quipe : c\'est ainsi qu\'un ADC doit jouer.'),
  'coach.BOTTOM.dmgShare.bad': t6('Dein Schadensanteil ist zu niedrig. Ein ADC sollte 25-32% des Teamschadens ausmachen.', 'Your damage share is too low. An ADC should deal 25-32% of the team\'s damage.', '\uD53C\uD574\uB7C9 \uBE44\uC911\uC774 \uB108\uBB34 \uB0AE\uC2B5\uB2C8\uB2E4. \uC6D0\uB51C\uC740 \uD300 \uD53C\uD574\uB7C9\uC758 25-32%\uB97C \uB2F4\uB2F9\uD574\uC57C \uD569\uB2C8\uB2E4.', '\u4F60\u7684\u4F24\u5BB3\u5360\u6BD4\u592A\u4F4E\u3002ADC\u5E94\u5360\u56E2\u961F\u4F24\u5BB3\u768425-32%\u3002', 'Tu porcentaje de da\u00F1o es demasiado bajo. Un ADC deber\u00EDa aportar el 25-32 % del da\u00F1o del equipo.', 'Ta part des d\u00E9g\u00E2ts est trop faible. Un ADC devrait infliger 25-32 % des d\u00E9g\u00E2ts de l\'\u00E9quipe.'),
  'coach.BOTTOM.deathsPerGame.title': t6('\u00DCberlebensf\u00E4higkeit', 'Survivability', '\uC0DD\uC874\uB825', '\u751F\u5B58\u80FD\u529B', 'Supervivencia', 'Survie'),
  'coach.BOTTOM.deathsPerGame.good': t6('Wenige Tode \u2014 du \u00FCberlebst Teamfights und lieferst konstant Schaden.', 'Few deaths \u2014 you survive teamfights and deal consistent damage.', '\uC801\uC740 \uB370\uC2A4 \u2014 \uD55C\uD0C0\uC5D0\uC11C \uC0B4\uC544\uB0A8\uC544 \uAFB8\uC900\uD788 \uD53C\uD574\uB97C \uC90D\uB2C8\uB2E4.', '\u9635\u4EA1\u5F88\u5C11\u2014\u2014\u4F60\u80FD\u5728\u56E2\u6218\u4E2D\u5B58\u6D3B\u5E76\u6301\u7EED\u8F93\u51FA\u3002', 'Pocas muertes: sobrevives a las peleas e infliges da\u00F1o constante.', 'Peu de morts : tu survis aux teamfights et infliges des d\u00E9g\u00E2ts constants.'),
  'coach.BOTTOM.deathsPerGame.bad': t6('Ein toter ADC macht 0 Schaden. Arbeite an deiner Positionierung und Flash-Nutzung.', 'A dead ADC deals 0 damage. Work on your positioning and Flash usage.', '\uC8FD\uC740 \uC6D0\uB51C\uC740 \uD53C\uD574\uB97C 0 \uC90D\uB2C8\uB2E4. \uD3EC\uC9C0\uC154\uB2DD\uACFC \uC810\uBA78 \uC0AC\uC6A9\uC744 \uAC1C\uC120\uD558\uC138\uC694.', '\u9635\u4EA1\u7684ADC\u4F24\u5BB3\u4E3A0\u3002\u6539\u8FDB\u4F60\u7684\u7AD9\u4F4D\u548C\u95EA\u73B0\u4F7F\u7528\u3002', 'Un ADC muerto hace 0 de da\u00F1o. Trabaja tu posicionamiento y el uso de Destello.', 'Un ADC mort inflige 0 d\u00E9g\u00E2t. Travaille ton placement et ton utilisation du Saut \u00E9clair.'),
  'coach.BOTTOM.kda.title': t6('KDA', 'KDA', 'KDA', 'KDA', 'KDA', 'KDA'),
  'coach.BOTTOM.kda.good': t6('Starke KDA \u2014 du maximierst deinen Impact bei minimalen Toden.', 'Strong KDA \u2014 you maximize your impact with minimal deaths.', '\uD6CC\uB96D\uD55C KDA \u2014 \uCD5C\uC18C\uD55C\uC758 \uB370\uC2A4\uB85C \uC601\uD5A5\uB825\uC744 \uADF9\uB300\uD654\uD569\uB2C8\uB2E4.', 'KDA\u51FA\u8272\u2014\u2014\u4F60\u4EE5\u6700\u5C11\u7684\u9635\u4EA1\u53D1\u6325\u6700\u5927\u5F71\u54CD\u529B\u3002', 'Gran KDA: maximizas tu impacto con el m\u00EDnimo de muertes.', 'Excellent KDA : tu maximises ton impact avec un minimum de morts.'),
  'coach.BOTTOM.kda.bad': t6('Vermeide 1v1-Fights ohne Support. ADC gewinnt durch konstanten DPS, nicht durch Solo-Plays.', 'Avoid 1v1 fights without your support. ADCs win through consistent DPS, not solo plays.', '\uC11C\uD3EC\uD130 \uC5C6\uC774 1\uB3001\uC744 \uD53C\uD558\uC138\uC694. \uC6D0\uB51C\uC740 \uB2E8\uB3C5 \uD50C\uB808\uC774\uAC00 \uC544\uB2CC \uAFB8\uC900\uD55C DPS\uB85C \uC774\uAE41\uB2C8\uB2E4.', '\u907F\u514D\u6CA1\u6709\u8F85\u52A9\u65F61v1\u3002ADC\u9760\u6301\u7EED\u8F93\u51FA\u53D6\u80DC\uFF0C\u800C\u4E0D\u662F\u5355\u72EC\u884C\u52A8\u3002', 'Evita los 1v1 sin tu apoyo. Un ADC gana con DPS constante, no con jugadas en solitario.', '\u00C9vite les 1v1 sans ton support. Un ADC gagne gr\u00E2ce \u00E0 un DPS constant, pas \u00E0 des actions solo.'),
  'coach.BOTTOM.goldPerMin.title': t6('Gold-Effizienz', 'Gold Efficiency', '\uACE8\uB4DC \uD6A8\uC728', '\u7ECF\u6D4E\u6548\u7387', 'Eficiencia de oro', 'Efficacit\u00E9 en or'),
  'coach.BOTTOM.goldPerMin.good': t6('Hohe Gold-Generierung \u2014 du erreichst deine Powerspikes schnell.', 'High gold income \u2014 you reach your power spikes quickly.', '\uB192\uC740 \uACE8\uB4DC \uC218\uAE09 \u2014 \uD30C\uC6CC \uC2A4\uD30C\uC774\uD06C\uC5D0 \uBE60\uB974\uAC8C \uB3C4\uB2EC\uD569\uB2C8\uB2E4.', '\u7ECF\u6D4E\u83B7\u53D6\u9AD8\u2014\u2014\u4F60\u80FD\u5FEB\u901F\u8FDB\u5165\u5F3A\u52BF\u671F\u3002', 'Gran generaci\u00F3n de oro: alcanzas r\u00E1pido tus picos de poder.', 'Gros revenu en or : tu atteins vite tes pics de puissance.'),
  'coach.BOTTOM.goldPerMin.bad': t6('Optimiere dein Gold: Sidelane-Farm, Shutdown-Bounties, und Tower-Plates.', 'Optimize your gold: side-lane farm, shutdown bounties and tower plates.', '\uACE8\uB4DC\uB97C \uCD5C\uC801\uD654\uD558\uC138\uC694: \uC0AC\uC774\uB4DC \uD30C\uBC0D, \uD604\uC0C1\uAE08, \uD3EC\uD0D1 \uBC29\uD328.', '\u4F18\u5316\u4F60\u7684\u7ECF\u6D4E\uFF1A\u8FB9\u7EBF\u53D1\u80B2\u3001\u7EC8\u7ED3\u8D4F\u91D1\u548C\u9632\u5FA1\u5854\u9540\u5C42\u3002', 'Optimiza tu oro: farmeo lateral, recompensas por racha y placas de torre.', 'Optimise ton or : farm en side lane, primes de shutdown et plaques de tour.'),
  'coach.SUPPORT.visionScore.title': t6('Vision Control', 'Vision Control', '\uC2DC\uC57C \uC7A5\uC545', '\u89C6\u91CE\u63A7\u5236', 'Control de visi\u00F3n', 'Contr\u00F4le de la vision'),
  'coach.SUPPORT.visionScore.good': t6('Exzellente Vision \u2014 du kontrollierst die Karte und gibst deinem Team Informationsvorteile.', 'Excellent vision \u2014 you control the map and give your team an information edge.', '\uD6CC\uB96D\uD55C \uC2DC\uC57C \u2014 \uB9F5\uC744 \uC7A5\uC545\uD558\uACE0 \uD300\uC5D0 \uC815\uBCF4 \uC6B0\uC704\uB97C \uC81C\uACF5\uD569\uB2C8\uB2E4.', '\u89C6\u91CE\u51FA\u8272\u2014\u2014\u4F60\u638C\u63A7\u5730\u56FE\uFF0C\u4E3A\u56E2\u961F\u63D0\u4F9B\u4FE1\u606F\u4F18\u52BF\u3002', 'Visi\u00F3n excelente: controlas el mapa y das a tu equipo ventaja de informaci\u00F3n.', 'Excellente vision : tu contr\u00F4les la carte et donnes un avantage d\'information \u00E0 ton \u00E9quipe.'),
  'coach.SUPPORT.visionScore.bad': t6('Vision ist deine #1 Aufgabe. Kaufe IMMER Control Wards und nutze Trinket auf Cooldown.', 'Vision is your #1 job. ALWAYS buy Control Wards and use your trinket on cooldown.', '\uC2DC\uC57C\uAC00 \uCD5C\uC6B0\uC120 \uC784\uBB34\uC785\uB2C8\uB2E4. \uD56D\uC0C1 \uC81C\uC5B4 \uC640\uB4DC\uB97C \uC0AC\uACE0 \uC7A5\uC2E0\uAD6C\uB97C \uCFE8\uB9C8\uB2E4 \uC0AC\uC6A9\uD558\uC138\uC694.', '\u89C6\u91CE\u662F\u4F60\u7684\u9996\u8981\u4EFB\u52A1\u3002\u52A1\u5FC5\u8D2D\u4E70\u63A7\u5236\u5B88\u536B\uFF0C\u9970\u54C1\u51B7\u5374\u597D\u5C31\u7528\u3002', 'La visi\u00F3n es tu tarea n.\u00BA 1. Compra SIEMPRE guardianes de control y usa el abalorio en cuanto est\u00E9 disponible.', 'La vision est ta t\u00E2che n\u00B0 1. Ach\u00E8te TOUJOURS des balises de contr\u00F4le et utilise ton trinket d\u00E8s qu\'il est disponible.'),
  'coach.SUPPORT.killParticipation.title': t6('Kill Participation', 'Kill Participation', '\uD0AC \uAD00\uC5EC\uC728', '\u53C2\u56E2\u7387', 'Participaci\u00F3n en asesinatos', 'Participation aux kills'),
  'coach.SUPPORT.killParticipation.good': t6('Du bist an fast allen Kills beteiligt \u2014 perfektes Roaming und Teamplay.', 'You are involved in almost every kill \u2014 perfect roaming and teamplay.', '\uAC70\uC758 \uBAA8\uB4E0 \uD0AC\uC5D0 \uAD00\uC5EC\uD569\uB2C8\uB2E4 \u2014 \uC644\uBCBD\uD55C \uB85C\uBC0D\uACFC \uD300\uD50C\uB808\uC774\uC785\uB2C8\uB2E4.', '\u4F60\u51E0\u4E4E\u53C2\u4E0E\u4E86\u6240\u6709\u51FB\u6740\u2014\u2014\u6E38\u8D70\u548C\u56E2\u961F\u914D\u5408\u5B8C\u7F8E\u3002', 'Participas en casi todos los asesinatos: roaming y juego en equipo perfectos.', 'Tu participes \u00E0 presque tous les kills : roaming et jeu d\'\u00E9quipe parfaits.'),
  'coach.SUPPORT.killParticipation.bad': t6('Du verpasst zu viele Fights. Rotiere aktiver und sei bei Objektiven pr\u00E4sent.', 'You miss too many fights. Rotate more actively and be present at objectives.', '\uB108\uBB34 \uB9CE\uC740 \uAD50\uC804\uC744 \uB193\uCE69\uB2C8\uB2E4. \uB354 \uC801\uADF9\uC801\uC73C\uB85C \uD569\uB958\uD558\uACE0 \uC624\uBE0C\uC81D\uD2B8\uC5D0 \uD568\uAED8\uD558\uC138\uC694.', '\u4F60\u9519\u8FC7\u4E86\u592A\u591A\u56E2\u6218\u3002\u66F4\u79EF\u6781\u5730\u8F6C\u7EBF\uFF0C\u5728\u8D44\u6E90\u4E89\u593A\u65F6\u5230\u573A\u3002', 'Te pierdes demasiadas peleas. Rota m\u00E1s activamente y est\u00E1 presente en los objetivos.', 'Tu rates trop de combats. Fais des rotations plus actives et sois pr\u00E9sent aux objectifs.'),
  'coach.SUPPORT.kda.title': t6('KDA', 'KDA', 'KDA', 'KDA', 'KDA', 'KDA'),
  'coach.SUPPORT.kda.good': t6('Hohe KDA \u2014 du assistierst effektiv und stirbst selten unn\u00F6tig.', 'High KDA \u2014 you assist effectively and rarely die needlessly.', '\uB192\uC740 KDA \u2014 \uD6A8\uACFC\uC801\uC73C\uB85C \uC5B4\uC2DC\uC2A4\uD2B8\uD558\uACE0 \uBD88\uD544\uC694\uD558\uAC8C \uAC70\uC758 \uC8FD\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.', 'KDA\u5F88\u9AD8\u2014\u2014\u4F60\u6709\u6548\u52A9\u653B\uFF0C\u5F88\u5C11\u65E0\u8C13\u9635\u4EA1\u3002', 'KDA alto: asistes con eficacia y rara vez mueres sin necesidad.', 'KDA \u00E9lev\u00E9 : tu assistes efficacement et meurs rarement inutilement.'),
  'coach.SUPPORT.kda.bad': t6('Zu viele Tode. Als Support ist \u00DCberleben wichtig \u2014 ein toter Support gibt keine Vision und kein Peel.', 'Too many deaths. Survival matters as a support \u2014 a dead support provides no vision and no peel.', '\uB370\uC2A4\uAC00 \uB108\uBB34 \uB9CE\uC2B5\uB2C8\uB2E4. \uC11C\uD3EC\uD130\uB294 \uC0DD\uC874\uC774 \uC911\uC694\uD569\uB2C8\uB2E4 \u2014 \uC8FD\uC740 \uC11C\uD3EC\uD130\uB294 \uC2DC\uC57C\uB3C4 \uBCF4\uD638\uB3C4 \uC81C\uACF5\uD558\uC9C0 \uBABB\uD569\uB2C8\uB2E4.', '\u9635\u4EA1\u592A\u591A\u3002\u8F85\u52A9\u9700\u8981\u6D3B\u7740\u2014\u2014\u9635\u4EA1\u7684\u8F85\u52A9\u65E0\u6CD5\u63D0\u4F9B\u89C6\u91CE\u548C\u4FDD\u62A4\u3002', 'Demasiadas muertes. Sobrevivir es clave como apoyo: un apoyo muerto no da visi\u00F3n ni protecci\u00F3n.', 'Trop de morts. Survivre est essentiel en support : un support mort n\'apporte ni vision ni protection.'),
  'coach.SUPPORT.deathsPerGame.title': t6('\u00DCberlebensf\u00E4higkeit', 'Survivability', '\uC0DD\uC874\uB825', '\u751F\u5B58\u80FD\u529B', 'Supervivencia', 'Survie'),
  'coach.SUPPORT.deathsPerGame.good': t6('Wenige Tode \u2014 du positionierst dich gut und gehst keine unn\u00F6tigen Risiken ein.', 'Few deaths \u2014 you position well and take no unnecessary risks.', '\uC801\uC740 \uB370\uC2A4 \u2014 \uD3EC\uC9C0\uC154\uB2DD\uC774 \uC88B\uACE0 \uBD88\uD544\uC694\uD55C \uC704\uD5D8\uC744 \uAC10\uC218\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.', '\u9635\u4EA1\u5F88\u5C11\u2014\u2014\u4F60\u7AD9\u4F4D\u5408\u7406\uFF0C\u4E0D\u5192\u4E0D\u5FC5\u8981\u7684\u98CE\u9669\u3002', 'Pocas muertes: te posicionas bien y no asumes riesgos innecesarios.', 'Peu de morts : tu te places bien et ne prends pas de risques inutiles.'),
  'coach.SUPPORT.deathsPerGame.bad': t6('Stirb weniger. Gehe nicht alleine in unwarded Gebiete und tracke feindliche Cooldowns.', 'Die less. Don\'t walk into unwarded areas alone and track enemy cooldowns.', '\uB35C \uC8FD\uC73C\uC138\uC694. \uC640\uB4DC \uC5C6\uB294 \uACF3\uC5D0 \uD63C\uC790 \uB4E4\uC5B4\uAC00\uC9C0 \uB9D0\uACE0 \uC0C1\uB300 \uCFE8\uB2E4\uC6B4\uC744 \uCD94\uC801\uD558\uC138\uC694.', '\u51CF\u5C11\u9635\u4EA1\u3002\u4E0D\u8981\u72EC\u81EA\u8FDB\u5165\u6CA1\u6709\u89C6\u91CE\u7684\u533A\u57DF\uFF0C\u5E76\u8FFD\u8E2A\u654C\u65B9\u6280\u80FD\u51B7\u5374\u3002', 'Muere menos. No entres solo en zonas sin guardianes y vigila los enfriamientos enemigos.', 'Meurs moins. N\'entre pas seul dans des zones sans balises et surveille les temps de recharge adverses.'),
  'coach.SUPPORT.wardsPerMin.title': t6('Ward-Frequenz', 'Ward Frequency', '\uC640\uB4DC \uBE48\uB3C4', '\u63D2\u773C\u9891\u7387', 'Frecuencia de guardianes', 'Fr\u00E9quence des balises'),
  'coach.SUPPORT.wardsPerMin.good': t6('Du wardest konstant \u2014 dein Team hat immer Informationen.', 'You ward consistently \u2014 your team always has information.', '\uAFB8\uC900\uD788 \uC640\uB4DC\uB97C \uBC15\uC2B5\uB2C8\uB2E4 \u2014 \uD300\uC774 \uD56D\uC0C1 \uC815\uBCF4\uB97C \uAC00\uC9D1\uB2C8\uB2E4.', '\u4F60\u6301\u7EED\u63D2\u773C\u2014\u2014\u56E2\u961F\u59CB\u7EC8\u638C\u63E1\u4FE1\u606F\u3002', 'Colocas guardianes de forma constante: tu equipo siempre tiene informaci\u00F3n.', 'Tu poses des balises en continu : ton \u00E9quipe a toujours des informations.'),
  'coach.SUPPORT.wardsPerMin.bad': t6('Mehr Wards setzen! Ziel: 1+ Ward pro Minute. Platziere sie proaktiv vor Objektiven.', 'Place more wards! Goal: 1+ ward per minute. Place them proactively before objectives.', '\uC640\uB4DC\uB97C \uB354 \uBC15\uC73C\uC138\uC694! \uBAA9\uD45C: \uBD84\uB2F9 1\uAC1C \uC774\uC0C1. \uC624\uBE0C\uC81D\uD2B8 \uC804\uC5D0 \uBBF8\uB9AC \uC124\uCE58\uD558\uC138\uC694.', '\u591A\u63D2\u773C\uFF01\u76EE\u6807\uFF1A\u6BCF\u5206\u949F1\u4E2A\u4EE5\u4E0A\u3002\u5728\u8D44\u6E90\u5237\u65B0\u524D\u63D0\u524D\u5E03\u7F6E\u3002', '\u00A1Coloca m\u00E1s guardianes! Objetivo: 1+ por minuto. Col\u00F3calos de forma proactiva antes de los objetivos.', 'Pose plus de balises ! Objectif : 1+ balise par minute. Place-les de mani\u00E8re proactive avant les objectifs.'),
  'coach.SUPPORT.utility.title': t6('Utility-Score', 'Utility Score', '\uC720\uD2F8\uB9AC\uD2F0 \uC810\uC218', '\u8F85\u52A9\u6548\u7528\u8BC4\u5206', 'Puntuaci\u00F3n de utilidad', 'Score d\'utilit\u00E9'),
  'coach.SUPPORT.utility.good': t6('Starke Utility \u2014 du sch\u00FCtzt dein Team effektiv mit Heals, Shields und CC.', 'Strong utility \u2014 you protect your team effectively with heals, shields and CC.', '\uB6F0\uC5B4\uB09C \uC720\uD2F8\uB9AC\uD2F0 \u2014 \uD68C\uBCF5, \uBCF4\uD638\uB9C9, CC\uB85C \uD300\uC744 \uD6A8\uACFC\uC801\uC73C\uB85C \uC9C0\uD0B5\uB2C8\uB2E4.', '\u8F85\u52A9\u6548\u7528\u51FA\u8272\u2014\u2014\u4F60\u7528\u6CBB\u7597\u3001\u62A4\u76FE\u548C\u63A7\u5236\u6709\u6548\u4FDD\u62A4\u56E2\u961F\u3002', 'Gran utilidad: proteges bien a tu equipo con curaciones, escudos y control.', 'Bonne utilit\u00E9 : tu prot\u00E8ges efficacement ton \u00E9quipe avec soins, boucliers et contr\u00F4les.'),
  'coach.SUPPORT.utility.bad': t6('Nutze deine Abilities aktiver zum Schutz deines Teams. Heal/Shield-Timing ist entscheidend.', 'Use your abilities more actively to protect your team. Heal/shield timing is crucial.', '\uD300\uC744 \uC9C0\uD0A4\uAE30 \uC704\uD574 \uC2A4\uD0AC\uC744 \uB354 \uC801\uADF9\uC801\uC73C\uB85C \uC0AC\uC6A9\uD558\uC138\uC694. \uD68C\uBCF5/\uBCF4\uD638\uB9C9 \uD0C0\uC774\uBC0D\uC774 \uD575\uC2EC\uC785\uB2C8\uB2E4.', '\u66F4\u79EF\u6781\u5730\u7528\u6280\u80FD\u4FDD\u62A4\u961F\u53CB\u3002\u6CBB\u7597/\u62A4\u76FE\u7684\u65F6\u673A\u81F3\u5173\u91CD\u8981\u3002', 'Usa tus habilidades m\u00E1s activamente para proteger a tu equipo. El momento de curar/proteger es clave.', 'Utilise tes comp\u00E9tences plus activement pour prot\u00E9ger ton \u00E9quipe. Le timing des soins/boucliers est d\u00E9cisif.'),
  'coach.tip.TOP.csPerMin': t6('Farming ist als Top-Laner dein wichtigstes Tool. 1 CS/Min mehr = ~500 Gold/Spiel Vorteil.', 'Farming is your most important tool as a top laner. 1 more CS/min = ~500 gold per game.', '\uD0D1 \uB77C\uC774\uB108\uC5D0\uAC8C \uD30C\uBC0D\uC740 \uAC00\uC7A5 \uC911\uC694\uD55C \uB3C4\uAD6C\uC785\uB2C8\uB2E4. \uBD84\uB2F9 CS 1\uAC1C = \uAC8C\uC784\uB2F9 \uC57D 500\uACE8\uB4DC.', '\u5BF9\u4E0A\u5355\u6765\u8BF4\uFF0C\u53D1\u80B2\u662F\u6700\u91CD\u8981\u7684\u624B\u6BB5\u3002\u6BCF\u5206\u949F\u591A1\u4E2A\u8865\u5200 = \u6BCF\u5C40\u7EA6500\u91D1\u5E01\u4F18\u52BF\u3002', 'Farmear es tu herramienta m\u00E1s importante como top. 1 CS/min m\u00E1s = ~500 de oro por partida.', 'Le farm est ton outil le plus important en top. 1 CS/min de plus = ~500 or par partie.'),
  'coach.tip.TOP.deathsPerGame': t6('Auf der Toplane allein zu sterben kostet deinem Team massiv. Warde den River und respektiere Ganks.', 'Dying alone in top lane costs your team a lot. Ward the river and respect ganks.', '\uD0D1 \uB77C\uC778\uC5D0\uC11C \uD63C\uC790 \uC8FD\uC73C\uBA74 \uD300\uC5D0 \uD070 \uC190\uD574\uC785\uB2C8\uB2E4. \uAC15\uAC00\uC5D0 \uC640\uB4DC\uB97C \uBC15\uACE0 \uAC31\uD0B9\uC744 \uACBD\uACC4\uD558\uC138\uC694.', '\u5728\u4E0A\u8DEF\u5355\u72EC\u9635\u4EA1\u4F1A\u8BA9\u56E2\u961F\u635F\u5931\u60E8\u91CD\u3002\u5728\u6CB3\u9053\u63D2\u773C\u5E76\u63D0\u9632Gank\u3002', 'Morir solo en la l\u00EDnea superior le cuesta mucho a tu equipo. Coloca guardianes en el r\u00EDo y respeta los ganks.', 'Mourir seul en top co\u00FBte cher \u00E0 ton \u00E9quipe. Pose des balises dans la rivi\u00E8re et respecte les ganks.'),
  'coach.tip.TOP.damagePerMin': t6('Suche aktiver Trades und nutze Teleport f\u00FCr Teamfight-Flanken.', 'Look for trades more actively and use Teleport to flank in teamfights.', '\uB354 \uC801\uADF9\uC801\uC73C\uB85C \uB51C\uAD50\uD658\uD558\uACE0 \uC21C\uAC04\uC774\uB3D9\uC73C\uB85C \uD55C\uD0C0 \uCE21\uBA74\uC744 \uB178\uB9AC\uC138\uC694.', '\u66F4\u79EF\u6781\u5730\u6362\u8840\uFF0C\u5E76\u7528\u4F20\u9001\u5728\u56E2\u6218\u4E2D\u4FA7\u7FFC\u5207\u5165\u3002', 'Busca intercambios m\u00E1s activamente y usa Teleportar para flanquear en las peleas.', 'Cherche plus activement les \u00E9changes et utilise la T\u00E9l\u00E9portation pour prendre les teamfights de flanc.'),
  'coach.tip.JUNGLE.killParticipation': t6('Dein Einfluss auf das Spiel h\u00E4ngt von deiner Pr\u00E4senz ab. Gank mehr oder invade aggressiver.', 'Your influence on the game depends on your presence. Gank more or invade more aggressively.', '\uAC8C\uC784\uC5D0 \uB300\uD55C \uC601\uD5A5\uB825\uC740 \uC874\uC7AC\uAC10\uC5D0 \uB2EC\uB824 \uC788\uC2B5\uB2C8\uB2E4. \uB354 \uB9CE\uC774 \uAC31\uD0B9\uD558\uAC70\uB098 \uB354 \uACF5\uACA9\uC801\uC73C\uB85C \uCE74\uC815\uD558\uC138\uC694.', '\u4F60\u5BF9\u6BD4\u8D5B\u7684\u5F71\u54CD\u53D6\u51B3\u4E8E\u4F60\u7684\u5B58\u5728\u611F\u3002\u591AGank\u6216\u66F4\u79EF\u6781\u5730\u53CD\u91CE\u3002', 'Tu influencia en la partida depende de tu presencia. Haz m\u00E1s ganks o invade con m\u00E1s agresividad.', 'Ton influence sur la partie d\u00E9pend de ta pr\u00E9sence. Gank davantage ou envahis plus agressivement.'),
  'coach.tip.JUNGLE.visionScore': t6('Kontrolliere River und feindlichen Jungle mit Wards. Vision = Information = Kontrolle.', 'Control the river and enemy jungle with wards. Vision = information = control.', '\uC640\uB4DC\uB85C \uAC15\uAC00\uC640 \uC0C1\uB300 \uC815\uAE00\uC744 \uC7A5\uC545\uD558\uC138\uC694. \uC2DC\uC57C = \uC815\uBCF4 = \uC7A5\uC545.', '\u7528\u5B88\u536B\u63A7\u5236\u6CB3\u9053\u548C\u654C\u65B9\u91CE\u533A\u3002\u89C6\u91CE = \u4FE1\u606F = \u63A7\u5236\u3002', 'Controla el r\u00EDo y la jungla enemiga con guardianes. Visi\u00F3n = informaci\u00F3n = control.', 'Contr\u00F4le la rivi\u00E8re et la jungle adverse avec des balises. Vision = information = contr\u00F4le.'),
  'coach.tip.JUNGLE.deathsPerGame': t6('Jungle-Tode geben dem Gegner Objektiv-Kontrolle. Vermeide 50/50-Plays.', 'Jungler deaths hand the enemy objective control. Avoid 50/50 plays.', '\uC815\uAE00\uB7EC\uC758 \uB370\uC2A4\uB294 \uC0C1\uB300\uC5D0\uAC8C \uC624\uBE0C\uC81D\uD2B8 \uC7A5\uC545\uC744 \uB118\uACA8\uC90D\uB2C8\uB2E4. 50/50 \uD50C\uB808\uC774\uB97C \uD53C\uD558\uC138\uC694.', '\u6253\u91CE\u9635\u4EA1\u4F1A\u8BA9\u5BF9\u624B\u638C\u63A7\u8D44\u6E90\u3002\u907F\u514D\u4E94\u4E94\u5F00\u7684\u64CD\u4F5C\u3002', 'Las muertes del jungla dan al rival el control de objetivos. Evita jugadas 50/50.', 'Les morts du jungler donnent le contr\u00F4le des objectifs \u00E0 l\'adversaire. \u00C9vite les actions \u00E0 50/50.'),
  'coach.tip.MID.damagePerMin': t6('Als Mid-Laner bist du der prim\u00E4re Damage-Dealer. Trade aggressiver und nutze Powerspikes.', 'As a mid laner you are the primary damage dealer. Trade more aggressively and use your power spikes.', '\uBBF8\uB4DC \uB77C\uC774\uB108\uB294 \uC8FC\uB825 \uB51C\uB7EC\uC785\uB2C8\uB2E4. \uB354 \uACF5\uACA9\uC801\uC73C\uB85C \uB51C\uAD50\uD658\uD558\uACE0 \uD30C\uC6CC \uC2A4\uD30C\uC774\uD06C\uB97C \uD65C\uC6A9\uD558\uC138\uC694.', '\u4F5C\u4E3A\u4E2D\u5355\uFF0C\u4F60\u662F\u4E3B\u8981\u8F93\u51FA\u70B9\u3002\u66F4\u79EF\u6781\u5730\u6362\u8840\u5E76\u5229\u7528\u5F3A\u52BF\u671F\u3002', 'Como mid eres la principal fuente de da\u00F1o. Intercambia con m\u00E1s agresividad y aprovecha tus picos de poder.', 'En mid, tu es la principale source de d\u00E9g\u00E2ts. \u00C9change plus agressivement et exploite tes pics de puissance.'),
  'coach.tip.MID.csPerMin': t6('Nutze Mid-Prio: Push die Wave und nimm Raptors/Wolves. Jede verpasste Wave kostet dich.', 'Use mid priority: push the wave and take raptors/wolves. Every missed wave costs you.', '\uBBF8\uB4DC \uC8FC\uB3C4\uAD8C\uC744 \uD65C\uC6A9\uD558\uC138\uC694: \uC6E8\uC774\uBE0C\uB97C \uBC00\uACE0 \uCE7C\uB0A0\uBD80\uB9AC/\uB291\uB300\uB97C \uCC59\uAE30\uC138\uC694. \uB193\uCE5C \uC6E8\uC774\uBE0C\uB9C8\uB2E4 \uC190\uD574\uC785\uB2C8\uB2E4.', '\u5229\u7528\u4E2D\u8DEF\u7EBF\u6743\uFF1A\u63A8\u7EBF\u540E\u62FF\u950B\u5599\u9E1F/\u5E7D\u5F71\u72FC\u3002\u6BCF\u9519\u8FC7\u4E00\u6CE2\u5175\u90FD\u662F\u635F\u5931\u3002', 'Usa la prioridad en medio: empuja la oleada y toma raptores/lobos. Cada oleada perdida te cuesta.', 'Utilise la priorit\u00E9 mid : pousse la vague et prends raptors/loups. Chaque vague manqu\u00E9e te co\u00FBte.'),
  'coach.tip.MID.killParticipation': t6('Nutze deine zentrale Position zum Roamen. River-Fights und Jungle-Invades gewinnen Spiele.', 'Use your central position to roam. River fights and jungle invades win games.', '\uC911\uC559 \uC704\uCE58\uB97C \uD65C\uC6A9\uD574 \uB85C\uBC0D\uD558\uC138\uC694. \uAC15\uAC00 \uAD50\uC804\uACFC \uCE74\uC815\uC774 \uAC8C\uC784\uC744 \uC774\uAE41\uB2C8\uB2E4.', '\u5229\u7528\u4F60\u7684\u4E2D\u8DEF\u4F4D\u7F6E\u6E38\u8D70\u3002\u6CB3\u9053\u56E2\u6218\u548C\u53CD\u91CE\u80FD\u8D62\u4E0B\u6BD4\u8D5B\u3002', 'Usa tu posici\u00F3n central para rotar. Las peleas en el r\u00EDo y las invasiones de jungla ganan partidas.', 'Utilise ta position centrale pour roam. Les combats en rivi\u00E8re et les invasions de jungle gagnent des parties.'),
  'coach.tip.BOTTOM.csPerMin': t6('CS ist deine #1 Goldquelle. Als ADC musst du 8+ CS/Min anstreben. \u00DCbe Last-Hitting.', 'CS is your #1 gold source. As an ADC aim for 8+ CS/min. Practice last-hitting.', 'CS\uB294 \uCD5C\uACE0\uC758 \uACE8\uB4DC \uC218\uAE09\uC6D0\uC785\uB2C8\uB2E4. \uC6D0\uB51C\uC740 \uBD84\uB2F9 8 CS \uC774\uC0C1\uC744 \uBAA9\uD45C\uB85C \uD558\uC138\uC694. \uB9C9\uD0C0\uB97C \uC5F0\uC2B5\uD558\uC138\uC694.', '\u8865\u5200\u662F\u4F60\u7684\u7B2C\u4E00\u7ECF\u6D4E\u6765\u6E90\u3002\u4F5C\u4E3AADC\uFF0C\u76EE\u6807\u662F\u6BCF\u5206\u949F8\u4E2A\u4EE5\u4E0A\u8865\u5200\u3002\u7EC3\u4E60\u8865\u5200\u3002', 'El CS es tu fuente de oro n.\u00BA 1. Como ADC apunta a 8+ CS/min. Practica el \u00FAltimo golpe.', 'Le CS est ta source d\'or n\u00B0 1. En ADC, vise 8+ CS/min. Entra\u00EEne-toi au last hit.'),
  'coach.tip.BOTTOM.deathsPerGame': t6('Ein toter ADC = 0 DPS. Positioniere dich hinter deinem Team und nutze Flash defensiv.', 'A dead ADC = 0 DPS. Position behind your team and use Flash defensively.', '\uC8FD\uC740 \uC6D0\uB51C = 0 DPS. \uD300 \uB4A4\uC5D0 \uC790\uB9AC \uC7A1\uACE0 \uC810\uBA78\uC744 \uBC29\uC5B4\uC801\uC73C\uB85C \uC0AC\uC6A9\uD558\uC138\uC694.', '\u9635\u4EA1\u7684ADC = 0\u8F93\u51FA\u3002\u7AD9\u5728\u961F\u53CB\u8EAB\u540E\uFF0C\u9632\u5FA1\u6027\u5730\u4F7F\u7528\u95EA\u73B0\u3002', 'Un ADC muerto = 0 DPS. Col\u00F3cate detr\u00E1s de tu equipo y usa Destello a la defensiva.', 'Un ADC mort = 0 DPS. Place-toi derri\u00E8re ton \u00E9quipe et utilise le Saut \u00E9clair en d\u00E9fense.'),
  'coach.tip.BOTTOM.damagePerMin': t6('Dein Job ist maximaler Schaden. Triff in Teamfights den n\u00E4chsten Gegner \u2014 nicht den am weitesten entfernten.', 'Your job is maximum damage. In teamfights hit the closest enemy \u2014 not the one furthest away.', '\uB2F9\uC2E0\uC758 \uC784\uBB34\uB294 \uCD5C\uB300 \uD53C\uD574\uC785\uB2C8\uB2E4. \uD55C\uD0C0\uC5D0\uC11C\uB294 \uAC00\uC7A5 \uBA3C \uC801\uC774 \uC544\uB2C8\uB77C \uAC00\uC7A5 \uAC00\uAE4C\uC6B4 \uC801\uC744 \uACF5\uACA9\uD558\uC138\uC694.', '\u4F60\u7684\u4EFB\u52A1\u662F\u6253\u51FA\u6700\u5927\u4F24\u5BB3\u3002\u56E2\u6218\u4E2D\u653B\u51FB\u6700\u8FD1\u7684\u654C\u4EBA\u2014\u2014\u800C\u4E0D\u662F\u6700\u8FDC\u7684\u3002', 'Tu trabajo es el da\u00F1o m\u00E1ximo. En las peleas golpea al enemigo m\u00E1s cercano, no al m\u00E1s lejano.', 'Ton r\u00F4le est d\'infliger un maximum de d\u00E9g\u00E2ts. En teamfight, frappe l\'ennemi le plus proche, pas le plus \u00E9loign\u00E9.'),
  'coach.tip.SUPPORT.visionScore': t6('Vision ist dein #1 Job. Kaufe JEDES Recall eine Control Ward und nutze Trinket auf Cooldown.', 'Vision is your #1 job. Buy a Control Ward EVERY recall and use your trinket on cooldown.', '\uC2DC\uC57C\uAC00 \uCD5C\uC6B0\uC120 \uC784\uBB34\uC785\uB2C8\uB2E4. \uADC0\uD658\uD560 \uB54C\uB9C8\uB2E4 \uC81C\uC5B4 \uC640\uB4DC\uB97C \uC0AC\uACE0 \uC7A5\uC2E0\uAD6C\uB97C \uCFE8\uB9C8\uB2E4 \uC0AC\uC6A9\uD558\uC138\uC694.', '\u89C6\u91CE\u662F\u4F60\u7684\u9996\u8981\u4EFB\u52A1\u3002\u6BCF\u6B21\u56DE\u57CE\u90FD\u4E70\u4E00\u4E2A\u63A7\u5236\u5B88\u536B\uFF0C\u9970\u54C1\u51B7\u5374\u597D\u5C31\u7528\u3002', 'La visi\u00F3n es tu tarea n.\u00BA 1. Compra un guardi\u00E1n de control en CADA regreso y usa el abalorio en cuanto est\u00E9 disponible.', 'La vision est ta t\u00E2che n\u00B0 1. Ach\u00E8te une balise de contr\u00F4le \u00E0 CHAQUE retour et utilise ton trinket d\u00E8s qu\'il est disponible.'),
  'coach.tip.SUPPORT.killParticipation': t6('Sei bei jedem Play dabei. Roame nach dem Pushen der Botlane-Wave.', 'Be part of every play. Roam after pushing the bot lane wave.', '\uBAA8\uB4E0 \uAD50\uC804\uC5D0 \uD568\uAED8\uD558\uC138\uC694. \uBC14\uD140 \uC6E8\uC774\uBE0C\uB97C \uBBFC \uB4A4 \uB85C\uBC0D\uD558\uC138\uC694.', '\u53C2\u4E0E\u6BCF\u4E00\u6B21\u884C\u52A8\u3002\u63A8\u5B8C\u4E0B\u8DEF\u5175\u7EBF\u540E\u53BB\u6E38\u8D70\u3002', 'Participa en cada jugada. Rota despu\u00E9s de empujar la oleada de la l\u00EDnea inferior.', 'Participe \u00E0 chaque action. Roam apr\u00E8s avoir pouss\u00E9 la vague du bot.'),
  'coach.tip.SUPPORT.deathsPerGame': t6('Stirb weniger. Gehe nicht alleine warden ohne Info \u00FCber feindliche Positionen.', 'Die less. Don\'t go warding alone without information on enemy positions.', '\uB35C \uC8FD\uC73C\uC138\uC694. \uC801 \uC704\uCE58 \uC815\uBCF4 \uC5C6\uC774 \uD63C\uC790 \uC640\uB4DC\uB97C \uBC15\uC73C\uB7EC \uAC00\uC9C0 \uB9C8\uC138\uC694.', '\u51CF\u5C11\u9635\u4EA1\u3002\u5728\u4E0D\u6E05\u695A\u654C\u65B9\u4F4D\u7F6E\u65F6\u4E0D\u8981\u72EC\u81EA\u53BB\u63D2\u773C\u3002', 'Muere menos. No vayas a colocar guardianes solo sin saber d\u00F3nde est\u00E1n los enemigos.', 'Meurs moins. Ne va pas poser des balises seul sans savoir o\u00F9 sont les ennemis.'),
  'coach.tip.none': t6('Du performst auf allen Ebenen \u00FCberdurchschnittlich. Fokussiere dich auf Konsistenz.', 'You perform above average across the board. Focus on consistency.', '\uBAA8\uB4E0 \uBA74\uC5D0\uC11C \uD3C9\uADE0 \uC774\uC0C1\uC785\uB2C8\uB2E4. \uAFB8\uC900\uD568\uC5D0 \uC9D1\uC911\uD558\uC138\uC694.', '\u4F60\u5728\u5404\u65B9\u9762\u90FD\u9AD8\u4E8E\u5E73\u5747\u6C34\u5E73\u3002\u4E13\u6CE8\u4E8E\u4FDD\u6301\u7A33\u5B9A\u3002', 'Rindes por encima de la media en todo. C\u00E9ntrate en la constancia.', 'Tu es au-dessus de la moyenne sur tous les plans. Concentre-toi sur la r\u00E9gularit\u00E9.'),
  'coach.tip.focus': t6('Fokussiere dich auf {name} \u2014 das hat den gr\u00F6\u00DFten Einfluss auf dein Spiel.', 'Focus on {name} \u2014 it has the biggest impact on your game.', '{name}\uC5D0 \uC9D1\uC911\uD558\uC138\uC694 \u2014 \uAC8C\uC784\uC5D0 \uAC00\uC7A5 \uD070 \uC601\uD5A5\uC744 \uC90D\uB2C8\uB2E4.', '\u4E13\u6CE8\u4E8E{name}\u2014\u2014\u8FD9\u5BF9\u4F60\u7684\u6BD4\u8D5B\u5F71\u54CD\u6700\u5927\u3002', 'C\u00E9ntrate en {name}: es lo que m\u00E1s influye en tu juego.', 'Concentre-toi sur {name} : c\'est ce qui a le plus d\'impact sur ton jeu.'),

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
  'synergy.detail.titles': t6('{titles} Titel in {n} Turnieren ({pct} %)', '{titles} titles in {n} tournaments ({pct}%)', '{n}\uAC1C \uB300\uD68C \uC911 {titles}\uD68C \uC6B0\uC2B9 ({pct}%)', '{n}\u9879\u8D5B\u4E8B\u4E2D\u593A\u51A0{titles}\u6B21\uFF08{pct}%\uFF09', '{titles} t\u00EDtulos en {n} torneos ({pct} %)', '{titles} titres en {n} tournois ({pct} %)'),
  'synergy.detail.experience': t6('{n} Turniere, {top4} Top-4-Platzierungen', '{n} tournaments, {top4} top-4 finishes', '{n}\uAC1C \uB300\uD68C, 4\uC704 \uC774\uB0B4 {top4}\uD68C', '{n}\u9879\u8D5B\u4E8B\uFF0C{top4}\u6B21\u8FDB\u5165\u524D\u56DB', '{n} torneos, {top4} veces en el top 4', '{n} tournois, {top4} fois dans le top 4'),
  'synergy.detail.recent': t6('\u00D8 Platzierung {avg} (letzte {n} Turniere)', 'Avg. placement {avg} (last {n} tournaments)', '\uD3C9\uADE0 \uC21C\uC704 {avg} (\uCD5C\uADFC {n}\uAC1C \uB300\uD68C)', '\u5E73\u5747\u540D\u6B21 {avg}\uFF08\u6700\u8FD1{n}\u9879\u8D5B\u4E8B\uFF09', 'Posici\u00F3n media {avg} (\u00FAltimos {n} torneos)', 'Classement moyen {avg} ({n} derniers tournois)'),
  'synergy.detail.region': t6('{region} \u00B7 St\u00E4rke {score}/100', '{region} \u00B7 strength {score}/100', '{region} \u00B7 \uAC15\uB3C4 {score}/100', '{region} \u00B7 \u5B9E\u529B {score}/100', '{region} \u00B7 fuerza {score}/100', '{region} \u00B7 force {score}/100'),
  'synergy.insight.highTitleRate': t6('Hohe Titelquote \u2014 gewinnt {pct} % der Turniere.', 'High title rate \u2014 wins {pct}% of tournaments.', '\uB192\uC740 \uC6B0\uC2B9 \uBE44\uC728 \u2014 \uB300\uD68C\uC758 {pct}%\uB97C \uC6B0\uC2B9\uD569\uB2C8\uB2E4.', '\u593A\u51A0\u7387\u9AD8\u2014\u2014\u8D62\u5F97{pct}%\u7684\u8D5B\u4E8B\u3002', 'Alta tasa de t\u00EDtulos: gana el {pct} % de los torneos.', 'Taux de titres \u00E9lev\u00E9 : remporte {pct} % des tournois.'),
  'synergy.insight.noTitleYet': t6('Noch kein Turniersieg trotz vieler Teilnahmen.', 'No tournament win yet despite many appearances.', '\uB9CE\uC740 \uCC38\uAC00\uC5D0\uB3C4 \uC544\uC9C1 \uB300\uD68C \uC6B0\uC2B9\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.', '\u53C2\u8D5B\u591A\u6B21\u4F46\u5C1A\u672A\u593A\u51A0\u3002', 'A\u00FAn sin t\u00EDtulos pese a muchas participaciones.', 'Toujours aucun titre malgr\u00E9 de nombreuses participations.'),
  'synergy.insight.strongRecent': t6('Starke Performance in letzten Turnieren.', 'Strong performance in recent tournaments.', '\uCD5C\uADFC \uB300\uD68C\uC5D0\uC11C \uAC15\uD55C \uC131\uC801.', '\u8FD1\u671F\u8D5B\u4E8B\u8868\u73B0\u51FA\u8272\u3002', 'Gran rendimiento en los \u00FAltimos torneos.', 'Solides performances lors des derniers tournois.'),
  'synergy.insight.weakRecent': t6('Schwache Turnierergebnisse \u2014 Umstrukturierung k\u00F6nnte n\u00F6tig sein.', 'Weak tournament results \u2014 a restructure may be needed.', '\uBD80\uC9C4\uD55C \uB300\uD68C \uC131\uC801 \u2014 \uC7AC\uC815\uBE44\uAC00 \uD544\uC694\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.', '\u8D5B\u4E8B\u6210\u7EE9\u4E0D\u4F73\u2014\u2014\u53EF\u80FD\u9700\u8981\u8C03\u6574\u9635\u5BB9\u3002', 'Malos resultados en torneos: quiz\u00E1 haga falta una reestructuraci\u00F3n.', 'R\u00E9sultats faibles en tournoi : une restructuration pourrait \u00EAtre n\u00E9cessaire.'),
  'synergy.insight.experienced': t6('Erfahrenes Team mit vielen Turnierteilnahmen.', 'Experienced team with many tournament appearances.', '\uB300\uD68C \uCC38\uAC00 \uACBD\uD5D8\uC774 \uB9CE\uC740 \uD300.', '\u53C2\u8D5B\u7ECF\u9A8C\u4E30\u5BCC\u7684\u961F\u4F0D\u3002', 'Equipo experimentado con muchas participaciones.', '\u00C9quipe exp\u00E9riment\u00E9e aux nombreuses participations.'),
  'synergy.insight.strongRegion': t6('Spielt in einer der st\u00E4rksten Regionen ({region}).', 'Plays in one of the strongest regions ({region}).', '\uAC00\uC7A5 \uAC15\uD55C \uC9C0\uC5ED \uC911 \uD558\uB098\uC5D0\uC11C \uD65C\uB3D9\uD569\uB2C8\uB2E4 ({region}).', '\u8EAB\u5904\u6700\u5F3A\u8D5B\u533A\u4E4B\u4E00\uFF08{region}\uFF09\u3002', 'Juega en una de las regiones m\u00E1s fuertes ({region}).', '\u00C9volue dans l\'une des r\u00E9gions les plus fortes ({region}).'),
  'synergy.regionName.KR': t6('Korea', 'Korea', '\uD55C\uAD6D', '\u97E9\u56FD', 'Corea', 'Cor\u00E9e'),
  'synergy.regionName.CN': t6('China', 'China', '\uC911\uAD6D', '\u4E2D\u56FD', 'China', 'Chine'),
  'synergy.regionName.EU': t6('Europa', 'Europe', '\uC720\uB7FD', '\u6B27\u6D32', 'Europa', 'Europe'),
  'synergy.regionName.NA': t6('Nordamerika', 'North America', '\uBD81\uBBF8', '\u5317\u7F8E', 'Norteam\u00E9rica', 'Am\u00E9rique du Nord'),
  'synergy.regionName.APAC': t6('Asien-Pazifik', 'Asia-Pacific', '\uC544\uC2DC\uC544 \uD0DC\uD3C9\uC591', '\u4E9A\u592A', 'Asia-Pac\u00EDfico', 'Asie-Pacifique'),
  'synergy.regionName.BR': t6('Brasilien', 'Brazil', '\uBE0C\uB77C\uC9C8', '\u5DF4\u897F', 'Brasil', 'Br\u00E9sil'),
  'synergy.regionName.JP': t6('Japan', 'Japan', '\uC77C\uBCF8', '\u65E5\u672C', 'Jap\u00F3n', 'Japon'),
  'synergy.regionName.TR': t6('T\u00FCrkei', 'Turkey', '\uD280\uB974\uD0A4\uC608', '\u571F\u8033\u5176', 'Turqu\u00EDa', 'Turquie'),
  'synergy.regionName.CIS': t6('GUS', 'CIS', 'CIS', '\u72EC\u8054\u4F53', 'CEI', 'CEI'),
  'synergy.regionName.OCE': t6('Ozeanien', 'Oceania', '\uC624\uC138\uC544\uB2C8\uC544', '\u5927\u6D0B\u6D32', 'Ocean\u00EDa', 'Oc\u00E9anie'),
  'synergy.regionName.LATAM': t6('Lateinamerika', 'Latin America', '\uB77C\uD2F4 \uC544\uBA54\uB9AC\uCE74', '\u62C9\u4E01\u7F8E\u6D32', 'Latinoam\u00E9rica', 'Am\u00E9rique latine'),
  'statCat.win_rate': t6('Siegrate', 'Win Rate', '\uC2B9\uB960', '\u80DC\u7387', 'Tasa de victorias', 'Taux de victoire'),
  'statCat.kda_rating': t6('KDA-Rating', 'KDA Rating', 'KDA \uD3C9\uAC00', 'KDA\u8BC4\u7EA7', 'Valoraci\u00F3n KDA', 'Note KDA'),
  'statCat.lane_dominance': t6('Lane-Dominanz', 'Lane Dominance', '\uB77C\uC778\uC804 \uC6B0\uC704', '\u5BF9\u7EBF\u538B\u5236', 'Dominio de l\u00EDnea', 'Domination en voie'),
  'statCat.farming': t6('Farming-Effizienz', 'Farming Efficiency', '\uD30C\uBC0D \uD6A8\uC728', '\u8865\u5200\u6548\u7387', 'Eficiencia de farmeo', 'Efficacit\u00E9 du farm'),
  'statCat.damage_output': t6('Schadensoutput', 'Damage Output', '\uD53C\uD574\uB7C9', '\u4F24\u5BB3\u8F93\u51FA', 'Da\u00F1o infligido', 'D\u00E9g\u00E2ts inflig\u00E9s'),
  'statCat.damage_share': t6('Schadensanteil', 'Damage Share', '\uD53C\uD574 \uBE44\uC911', '\u4F24\u5BB3\u5360\u6BD4', 'Cuota de da\u00F1o', 'Part des d\u00E9g\u00E2ts'),
  'statCat.survivability': t6('\u00DCberlebensf\u00E4higkeit', 'Survivability', '\uC0DD\uC874\uB825', '\u751F\u5B58\u80FD\u529B', 'Supervivencia', 'Survie'),
  'statCat.vision_control': t6('Vision-Kontrolle', 'Vision Control', '\uC2DC\uC57C \uC7A5\uC545', '\u89C6\u91CE\u63A7\u5236', 'Control de visi\u00F3n', 'Contr\u00F4le de la vision'),
  'statCat.objective_control': t6('Objektiv-Kontrolle', 'Objective Control', '\uC624\uBE0C\uC81D\uD2B8 \uC7A5\uC545', '\u8D44\u6E90\u63A7\u5236', 'Control de objetivos', 'Contr\u00F4le des objectifs'),
  'statCat.gold_efficiency': t6('Gold-Effizienz', 'Gold Efficiency', '\uACE8\uB4DC \uD6A8\uC728', '\u7ECF\u6D4E\u6548\u7387', 'Eficiencia de oro', 'Efficacit\u00E9 de l\'or'),
  'statCat.teamplay': t6('Teamplay', 'Teamplay', '\uD300\uD50C\uB808\uC774', '\u56E2\u961F\u914D\u5408', 'Juego en equipo', 'Jeu d\'\u00E9quipe'),
  'statCat.clutch_factor': t6('Clutch-Faktor', 'Clutch Factor', '\uD074\uB7EC\uCE58 \uB2A5\uB825', '\u5173\u952E\u65F6\u523B\u8868\u73B0', 'Factor clutch', 'Facteur clutch'),
  'statCat.comeback_strength': t6('Comeback-St\u00E4rke', 'Comeback Strength', '\uC5ED\uC804 \uB2A5\uB825', '\u7FFB\u76D8\u80FD\u529B', 'Capacidad de remontada', 'Force de comeback'),
  'statCat.early_game': t6('Fr\u00FChspiel-Einfluss', 'Early Game Impact', '\uCD08\uBC18 \uC601\uD5A5\uB825', '\u524D\u671F\u5F71\u54CD\u529B', 'Impacto en fase temprana', 'Impact en d\u00E9but de partie'),
  'statCat.mechanics': t6('Mechanik', 'Mechanics', '\uD53C\uC9C0\uCEEC', '\u64CD\u4F5C', 'Mec\u00E1nica', 'M\u00E9canique'),
  'statCat.consistency': t6('Konstanz', 'Consistency', '\uAFB8\uC900\uD568', '\u7A33\u5B9A\u6027', 'Consistencia', 'R\u00E9gularit\u00E9'),
  'statCat.trend': t6('Trend', 'Trend', '\uCD94\uC138', '\u8D8B\u52BF', 'Tendencia', 'Tendance'),
  'mvCat.general': t6('Allgemein', 'General', '\uC77C\uBC18', '\u7EFC\u5408', 'General', 'G\u00E9n\u00E9ral'),
  'mvCat.aggression': t6('Aggression', 'Aggression', '\uACF5\uACA9\uC131', '\u4FB5\u7565\u6027', 'Agresividad', 'Agressivit\u00E9'),
  'mvCat.teamplay': t6('Teamplay', 'Teamplay', '\uD300\uD50C\uB808\uC774', '\u56E2\u961F\u914D\u5408', 'Juego en equipo', 'Jeu d\'\u00E9quipe'),
  'mvCat.lane': t6('Lane', 'Lane', '\uB77C\uC778', '\u5BF9\u7EBF', 'L\u00EDnea', 'Voie'),
  'mvCat.mechanics': t6('Mechanik', 'Mechanics', '\uD53C\uC9C0\uCEEC', '\u64CD\u4F5C', 'Mec\u00E1nica', 'M\u00E9canique'),
  'mvCat.earlyGame': t6('Fr\u00FChspiel', 'Early Game', '\uCD08\uBC18', '\u524D\u671F', 'Fase temprana', 'D\u00E9but de partie'),
  'mvCat.objectives': t6('Objectives', 'Objectives', '\uC624\uBE0C\uC81D\uD2B8', '\u8D44\u6E90', 'Objetivos', 'Objectifs'),
  'mvCat.survival': t6('\u00DCberleben', 'Survival', '\uC0DD\uC874', '\u751F\u5B58', 'Supervivencia', 'Survie'),
  'mvCat.mentality': t6('Mental', 'Mentality', '\uBA58\uD0C8', '\u5FC3\u6001', 'Mentalidad', 'Mental'),
  'mvCat.support': t6('Support', 'Support', '\uC11C\uD3EC\uD2B8', '\u8F85\u52A9', 'Apoyo', 'Soutien'),
  'mvCat.vision': t6('Vision', 'Vision', '\uC2DC\uC57C', '\u89C6\u91CE', 'Visi\u00F3n', 'Vision'),
  'mvCat.combat': t6('Kampf', 'Combat', '\uC804\uD22C', '\u6218\u6597', 'Combate', 'Combat'),
  'mvCat.economy': t6('Economy', 'Economy', '\uACBD\uC81C', '\u7ECF\u6D4E', 'Econom\u00EDa', '\u00C9conomie'),
  'mvCat.farming': t6('Farming', 'Farming', '\uD30C\uBC0D', '\u8865\u5200', 'Farmeo', 'Farm'),
  'lolStat.assistsGame': t6('Assists/Spiel', 'Assists/Game', '\uC5B4\uC2DC\uC2A4\uD2B8/\uAC8C\uC784', '\u52A9\u653B/\u573A', 'Asistencias/partida', 'Assists/partie'),
  'lolStat.baronsGame': t6('Barons/Spiel', 'Barons/Game', '\uBC14\uB860/\uAC8C\uC784', '\u5927\u9F99/\u573A', 'Barones/partida', 'Barons/partie'),
  'lolStat.cCScore': t6('CC Score', 'CC Score', 'CC \uC810\uC218', '\u63A7\u5236\u5F97\u5206', 'Puntuaci\u00F3n CC', 'Score CC'),
  'lolStat.clutchSurvival': t6('Clutch-\u00DCberlebend', 'Clutch Survival', '\uC704\uAE30 \uC0DD\uC874', '\u5173\u952E\u5B58\u6D3B', 'Supervivencia clutch', 'Survie clutch'),
  'lolStat.comebackMentality': t6('Comeback-Mentalit\u00E4t', 'Comeback Mentality', '\uC5ED\uC804 \uBA58\uD0C8', '\u7FFB\u76D8\u5FC3\u6001', 'Mentalidad de remontada', 'Mental de comeback'),
  'lolStat.comebackRate': t6('Comeback-Rate', 'Comeback Rate', '\uC5ED\uC804\uB960', '\u7FFB\u76D8\u7387', 'Tasa de remontada', 'Taux de comeback'),
  'lolStat.cSMin': t6('CS/Min', 'CS/Min', 'CS/\uBD84', 'CS/\u5206', 'CS/min', 'CS/min'),
  'lolStat.cSAdvantage': t6('CS-Vorteil', 'CS Advantage', 'CS \uC6B0\uC704', 'CS\u4F18\u52BF', 'Ventaja de CS', 'Avantage CS'),
  'lolStat.damageShare': t6('Damage Share', 'Damage Share', '\uD53C\uD574 \uBE44\uC911', '\u4F24\u5BB3\u5360\u6BD4', 'Cuota de da\u00F1o', 'Part des d\u00E9g\u00E2ts'),
  'lolStat.dragonPlusBaron': t6('Dragon+Baron', 'Dragon+Baron', '\uB4DC\uB798\uACE4+\uBC14\uB860', '\u5C0F\u9F99+\u5927\u9F99', 'Drag\u00F3n+Bar\u00F3n', 'Dragon+Baron'),
  'lolStat.dragonsGame': t6('Dragons/Spiel', 'Dragons/Game', '\uB4DC\uB798\uACE4/\uAC8C\uC784', '\u5C0F\u9F99/\u573A', 'Dragones/partida', 'Dragons/partie'),
  'lolStat.firstBlood': t6('First Blood', 'First Blood', '\uD37C\uC2A4\uD2B8 \uBE14\uB7EC\uB4DC', '\u4E00\u8840', 'Primera sangre', 'Premier sang'),
  'lolStat.firstBloodJGL': t6('First Blood (JGL)', 'First Blood (JGL)', '\uD37C\uC2A4\uD2B8 \uBE14\uB7EC\uB4DC (\uC815\uAE00)', '\u4E00\u8840\uFF08\u6253\u91CE\uFF09', 'Primera sangre (JGL)', 'Premier sang (JGL)'),
  'lolStat.firstBloodVictim': t6('First Blood Opfer', 'First Blood Victim', '\uD37C\uC2A4\uD2B8 \uBE14\uB7EC\uB4DC \uD76C\uC0DD', '\u88AB\u62FF\u4E00\u8840', 'V\u00EDctima de primera sangre', 'Victime du premier sang'),
  'lolStat.goldShare': t6('Gold Share', 'Gold Share', '\uACE8\uB4DC \uBE44\uC911', '\u7ECF\u6D4E\u5360\u6BD4', 'Cuota de oro', 'Part de l\'or'),
  'lolStat.goldMin': t6('Gold/Min', 'Gold/Min', '\uACE8\uB4DC/\uBD84', '\u91D1\u5E01/\u5206', 'Oro/min', 'Or/min'),
  'lolStat.healShieldPerMin': t6('Heal/Shield pro Min', 'Heal/Shield per Min', '\uBD84\uB2F9 \uD790/\uC2E4\uB4DC', '\u6BCF\u5206\u949F\u6CBB\u7597/\u62A4\u76FE', 'Curaci\u00F3n/escudo por min', 'Soin/bouclier par min'),
  'lolStat.kDA': t6('KDA', 'KDA', 'KDA', 'KDA', 'KDA', 'KDA'),
  'lolStat.killParticipation': t6('Kill Participation', 'Kill Participation', '\uD0AC \uAD00\uC5EC\uC728', '\u53C2\u56E2\u7387', 'Participaci\u00F3n en asesinatos', 'Participation aux kills'),
  'lolStat.kitingEfficiency': t6('Kiting Effizienz', 'Kiting Efficiency', '\uCE74\uC774\uD305 \uD6A8\uC728', '\u98CE\u7B5D\u6548\u7387', 'Eficiencia de kiteo', 'Efficacit\u00E9 de kiting'),
  'lolStat.laneDominance': t6('Lane-Dominanz', 'Lane Dominance', '\uB77C\uC778\uC804 \uC6B0\uC704', '\u5BF9\u7EBF\u538B\u5236', 'Dominio de l\u00EDnea', 'Domination en voie'),
  'lolStat.laneWeakness': t6('Lane-Schw\u00E4che', 'Lane Weakness', '\uB77C\uC778\uC804 \uC57D\uC138', '\u5BF9\u7EBF\u52A3\u52BF', 'Debilidad en l\u00EDnea', 'Faiblesse en voie'),
  'lolStat.legendaryStatus': t6('Legendary-Status', 'Legendary Status', '\uC804\uC124\uC758 \uCD9C\uD604', '\u8D85\u795E\u72B6\u6001', 'Estado legendario', 'Statut l\u00E9gendaire'),
  'lolStat.multiKills': t6('Multi-Kills', 'Multi-Kills', '\uBA40\uD2F0\uD0AC', '\u591A\u6740', 'Multiasesinatos', 'Multi-kills'),
  'lolStat.multiKillsADC': t6('Multi-Kills (ADC)', 'Multi-Kills (ADC)', '\uBA40\uD2F0\uD0AC (\uC6D0\uB51C)', '\u591A\u6740\uFF08ADC\uFF09', 'Multiasesinatos (ADC)', 'Multi-kills (ADC)'),
  'lolStat.objCombo': t6('Obj. Combo', 'Obj. Combo', '\uC624\uBE0C\uC81D\uD2B8 \uCF64\uBCF4', '\u8D44\u6E90\u8FDE\u53D6', 'Combo de obj.', 'Combo d\'obj.'),
  'lolStat.objScore': t6('Obj. Score', 'Obj. Score', '\uC624\uBE0C\uC81D\uD2B8 \uC810\uC218', '\u8D44\u6E90\u5F97\u5206', 'Puntuaci\u00F3n de obj.', 'Score d\'obj.'),
  'lolStat.objSteals': t6('Obj. Steals', 'Obj. Steals', '\uC624\uBE0C\uC81D\uD2B8 \uC2A4\uD2F8', '\u62A2\u8D44\u6E90', 'Robos de obj.', 'Vols d\'obj.'),
  'lolStat.objDamage': t6('Obj.-Schaden', 'Obj. Damage', '\uC624\uBE0C\uC81D\uD2B8 \uD53C\uD574', '\u8D44\u6E90\u4F24\u5BB3', 'Da\u00F1o a obj.', 'D\u00E9g\u00E2ts aux obj.'),
  'lolStat.outplayKills': t6('Outplay-Kills', 'Outplay Kills', '\uC544\uC6C3\uD50C\uB808\uC774 \uD0AC', '\u4EE5\u5C11\u6253\u591A\u51FB\u6740', 'Asesinatos en inferioridad', 'Kills en inf\u00E9riorit\u00E9'),
  'lolStat.riftHerald': t6('Rift Herald', 'Rift Herald', '\uD611\uACE1\uC758 \uC804\uB839', '\u5CE1\u8C37\u5148\u950B', 'Heraldo de la Grieta', 'H\u00E9raut de la Faille'),
  'lolStat.roleFlexibility': t6('Rollen-Flexibilit\u00E4t', 'Role Flexibility', '\uD3EC\uC9C0\uC158 \uC720\uC5F0\uC131', '\u4F4D\u7F6E\u7075\u6D3B\u6027', 'Flexibilidad de rol', 'Flexibilit\u00E9 de r\u00F4le'),
  'lolStat.damageTakenMin': t6('Schaden genommen/Min', 'Damage Taken/Min', '\uBC1B\uC740 \uD53C\uD574/\uBD84', '\u627F\u53D7\u4F24\u5BB3/\u5206', 'Da\u00F1o recibido/min', 'D\u00E9g\u00E2ts subis/min'),
  'lolStat.damageMin': t6('Schaden/Min', 'Damage/Min', '\uD53C\uD574\uB7C9/\uBD84', '\u4F24\u5BB3/\u5206', 'Da\u00F1o/min', 'D\u00E9g\u00E2ts/min'),
  'lolStat.skillshotDodge': t6('Skillshot-Dodge', 'Skillshot Dodge', '\uC2A4\uD0AC\uC0F7 \uD68C\uD53C', '\u8EB2\u907F\u6280\u80FD', 'Esquiva de habilidades', 'Esquive de skillshots'),
  'lolStat.soloKills': t6('Solo Kills', 'Solo Kills', '\uC194\uB85C\uD0AC', '\u5355\u6740', 'Asesinatos en solitario', 'Solo kills'),
  'lolStat.surrenderRate': t6('Surrender-Rate', 'Surrender Rate', '\uD56D\uBCF5\uB960', '\u6295\u964D\u7387', 'Tasa de rendici\u00F3n', 'Taux d\'abandon'),
  'lolStat.takedownsAt25': t6('Takedowns @25', 'Takedowns @25', '25\uBD84 \uD0AC \uAD00\uC5EC', '25\u5206\u949F\u51FB\u6740\u53C2\u4E0E', 'Derribos @25', 'Takedowns @25'),
  'lolStat.tankDamageMin': t6('Tank-Schaden/Min', 'Tank Damage/Min', '\uD0F1\uD0B9 \uD53C\uD574/\uBD84', '\u627F\u4F24/\u5206', 'Da\u00F1o tanqueado/min', 'D\u00E9g\u00E2ts tank\u00E9s/min'),
  'lolStat.timeDead': t6('Totzeit', 'Time Dead', '\uC0AC\uB9DD \uC2DC\uAC04', '\u9635\u4EA1\u65F6\u95F4', 'Tiempo muerto', 'Temps mort'),
  'lolStat.towersGame': t6('T\u00FCrme/Spiel', 'Towers/Game', '\uD3EC\uD0D1/\uAC8C\uC784', '\u9632\u5FA1\u5854/\u573A', 'Torres/partida', 'Tours/partie'),
  'lolStat.towerDamage': t6('Turm-Schaden', 'Tower Damage', '\uD3EC\uD0D1 \uD53C\uD574', '\u5854\u4F24', 'Da\u00F1o a torres', 'D\u00E9g\u00E2ts aux tours'),
  'lolStat.turretPlates': t6('Turret Plates', 'Turret Plates', '\uD3EC\uD0D1 \uBC29\uD328', '\u9632\u5FA1\u5854\u9540\u5C42', 'Placas de torre', 'Plaques de tourelle'),
  'lolStat.visionDominance': t6('Vision Dominanz', 'Vision Dominance', '\uC2DC\uC57C \uC7A5\uC545', '\u89C6\u91CE\u538B\u5236', 'Dominio de visi\u00F3n', 'Domination de vision'),
  'lolStat.visionScore': t6('Vision Score', 'Vision Score', '\uC2DC\uC57C \uC810\uC218', '\u89C6\u91CE\u5F97\u5206', 'Puntuaci\u00F3n de visi\u00F3n', 'Score de vision'),
  'lolStat.visionMin': t6('Vision/Min', 'Vision/Min', '\uC2DC\uC57C/\uBD84', '\u89C6\u91CE/\u5206', 'Visi\u00F3n/min', 'Vision/min'),
  'lolStat.wardsGame': t6('Wards/Spiel', 'Wards/Game', '\uC640\uB4DC/\uAC8C\uC784', '\u5B88\u536B/\u573A', 'Guardianes/partida', 'Balises/partie'),
  'lolStat.winrate': t6('Winrate', 'Winrate', '\uC2B9\uB960', '\u80DC\u7387', 'Tasa de victorias', 'Taux de victoire'),
  'lolStat.currentWinrate': t6('Aktuelle Winrate', 'Current Winrate', '\uD604\uC7AC \uC2B9\uB960', '\u5F53\u524D\u80DC\u7387', 'Tasa de victorias actual', 'Taux de victoire actuel'),
  'lolStat.assistStreak': t6('Assist-Streak', 'Assist Streak', '\uC5F0\uC18D \uC5B4\uC2DC\uC2A4\uD2B8', '\u8FDE\u7EED\u52A9\u653B', 'Racha de asistencias', 'S\u00E9rie d\'assists'),
  'lolStat.spendingRate': t6('Ausgabenquote', 'Spending Rate', '\uACE8\uB4DC \uC0AC\uC6A9\uB960', '\u82B1\u8D39\u7387', 'Tasa de gasto', 'Taux de d\u00E9pense'),
  'lolStat.baronParticipation': t6('Baron-Beteiligung', 'Baron Participation', '\uBC14\uB860 \uAD00\uC5EC', '\u5927\u9F99\u53C2\u4E0E', 'Participaci\u00F3n en barones', 'Participation aux barons'),
  'lolStat.bountyGold': t6('Bounty-Gold', 'Bounty Gold', '\uD604\uC0C1\uAE08 \uACE8\uB4DC', '\u8D4F\u91D1', 'Oro de recompensa', 'Or de prime'),
  'lolStat.cCPlusKill': t6('CC + Kill', 'CC + Kill', 'CC + \uD0AC', '\u63A7\u5236+\u51FB\u6740', 'CC + asesinato', 'CC + kill'),
  'lolStat.cCSurvived': t6('CC-\u00DCberlebt', 'CC Survived', 'CC \uC0DD\uC874', '\u88AB\u63A7\u5B58\u6D3B', 'Sobrevivi\u00F3 a CC', 'CC surv\u00E9cus'),
  'lolStat.comebackWins': t6('Comeback-Siege', 'Comeback Wins', '\uC5ED\uC804\uC2B9', '\u7FFB\u76D8\u80DC\u573A', 'Victorias por remontada', 'Victoires de comeback'),
  'lolStat.controlWards': t6('Control Wards', 'Control Wards', '\uC81C\uC5B4 \uC640\uB4DC', '\u63A7\u5236\u5B88\u536B', 'Guardianes de control', 'Balises de contr\u00F4le'),
  'lolStat.cSAt10Min': t6('CS in 10 Min', 'CS at 10 Min', '10\uBD84 CS', '10\u5206\u949FCS', 'CS a los 10 min', 'CS \u00E0 10 min'),
  'lolStat.cSGame': t6('CS/Spiel', 'CS/Game', 'CS/\uAC8C\uC784', 'CS/\u573A', 'CS/partida', 'CS/partie'),
  'lolStat.cSVariation': t6('CS-Variationskoeffizient', 'CS Variation', 'CS \uBCC0\uB3D9\uACC4\uC218', 'CS\u53D8\u5F02\u7CFB\u6570', 'Variaci\u00F3n de CS', 'Variation du CS'),
  'lolStat.deathsGame': t6('Deaths/Spiel', 'Deaths/Game', '\uB370\uC2A4/\uAC8C\uC784', '\u6B7B\u4EA1/\u573A', 'Muertes/partida', 'Morts/partie'),
  'lolStat.defensiveKills': t6('Defensive Kills', 'Defensive Kills', '\uC218\uBE44 \uD0AC', '\u9632\u5B88\u51FB\u6740', 'Asesinatos defensivos', 'Kills d\u00E9fensifs'),
  'lolStat.dPMTrend': t6('DPM-Trend', 'DPM Trend', 'DPM \uCD94\uC138', 'DPM\u8D8B\u52BF', 'Tendencia de DPM', 'Tendance DPM'),
  'lolStat.dragonParticipation': t6('Drachen-Beteiligung', 'Dragon Participation', '\uB4DC\uB798\uACE4 \uAD00\uC5EC', '\u5C0F\u9F99\u53C2\u4E0E', 'Participaci\u00F3n en dragones', 'Participation aux dragons'),
  'lolStat.effectiveHS': t6('Effektive H/S', 'Effective H/S', '\uC720\uD6A8 \uD790/\uC2E4\uB4DC', '\u6709\u6548\u6CBB\u7597/\u62A4\u76FE', 'C/E efectivos', 'Soin/bouclier effectif'),
  'lolStat.firstBloodRate': t6('First Blood Rate', 'First Blood Rate', '\uD37C\uC2A4\uD2B8 \uBE14\uB7EC\uB4DC \uBE44\uC728', '\u4E00\u8840\u7387', 'Tasa de primera sangre', 'Taux de premier sang'),
  'lolStat.firstTurret': t6('First Turret', 'First Turret', '\uCCAB \uD3EC\uD0D1', '\u4E00\u5854', 'Primera torre', 'Premi\u00E8re tourelle'),
  'lolStat.flashMultikills': t6('Flash-Multikills', 'Flash Multikills', '\uC810\uBA78 \uBA40\uD2F0\uD0AC', '\u95EA\u73B0\u591A\u6740', 'Multiasesinatos con Destello', 'Multi-kills avec Saut \u00E9clair'),
  'lolStat.previousWinrate': t6('Fr\u00FChere Winrate', 'Previous Winrate', '\uC774\uC804 \uC2B9\uB960', '\u5148\u524D\u80DC\u7387', 'Tasa de victorias anterior', 'Taux de victoire pr\u00E9c\u00E9dent'),
  'lolStat.gankKills': t6('Gank-Kills', 'Gank Kills', '\uAC31\uD0B9 \uD0AC', 'Gank\u51FB\u6740', 'Asesinatos por gank', 'Kills sur gank'),
  'lolStat.goldGame': t6('Gold/Spiel', 'Gold/Game', '\uACE8\uB4DC/\uAC8C\uC784', '\u91D1\u5E01/\u573A', 'Oro/partida', 'Or/partie'),
  'lolStat.goldXPLeadEarly': t6('Gold/XP-Vorteil (fr\u00FCh)', 'Gold/XP Lead (early)', '\uACE8\uB4DC/\uACBD\uD5D8\uCE58 \uC6B0\uC704 (\uCD08\uBC18)', '\u7ECF\u6D4E/\u7ECF\u9A8C\u9886\u5148\uFF08\u524D\u671F\uFF09', 'Ventaja de oro/XP (temprana)', 'Avance or/XP (d\u00E9but)'),
  'lolStat.goldShare2': t6('Gold-Anteil', 'Gold Share', '\uACE8\uB4DC \uBE44\uC911', '\u7ECF\u6D4E\u5360\u6BD4', 'Cuota de oro', 'Part de l\'or'),
  'lolStat.largestKillingSpree': t6('Gr\u00F6\u00DFte Killserie', 'Largest Killing Spree', '\uCD5C\uB300 \uC5F0\uC18D \uD0AC', '\u6700\u5927\u8FDE\u6740', 'Mayor racha de asesinatos', 'Plus grande s\u00E9rie de kills'),
  'lolStat.healingOnTeammates': t6('Heal auf Teammates', 'Healing on Teammates', '\uC544\uAD70 \uD68C\uBCF5', '\u6CBB\u7597\u961F\u53CB', 'Curaci\u00F3n a aliados', 'Soins sur alli\u00E9s'),
  'lolStat.jungleCS': t6('Jungle CS', 'Jungle CS', '\uC815\uAE00 CS', '\u91CE\u602ACS', 'CS de jungla', 'CS de jungle'),
  'lolStat.kDATrend': t6('KDA-Trend', 'KDA Trend', 'KDA \uCD94\uC138', 'KDA\u8D8B\u52BF', 'Tendencia de KDA', 'Tendance KDA'),
  'lolStat.kDAVariation': t6('KDA-Variationskoeffizient', 'KDA Variation', 'KDA \uBCC0\uB3D9\uACC4\uC218', 'KDA\u53D8\u5F02\u7CFB\u6570', 'Variaci\u00F3n de KDA', 'Variation du KDA'),
  'lolStat.killParticipation2': t6('Kill-Beteiligung', 'Kill Participation', '\uD0AC \uAD00\uC5EC\uC728', '\u53C2\u56E2\u7387', 'Participaci\u00F3n en asesinatos', 'Participation aux kills'),
  'lolStat.killsGame': t6('Kills/Spiel', 'Kills/Game', '\uD0AC/\uAC8C\uC784', '\u51FB\u6740/\u573A', 'Asesinatos/partida', 'Kills/partie'),
  'lolStat.barelySurvived': t6('Knapp \u00FCberlebt', 'Barely Survived', '\uC544\uC2AC\uC544\uC2AC\uD55C \uC0DD\uC874', '\u60CA\u9669\u5B58\u6D3B', 'Sobrevivi\u00F3 por poco', 'Surv\u00E9cu de justesse'),
  'lolStat.closeDodges': t6('Knappe Dodges', 'Close Dodges', '\uC544\uC2AC\uC544\uC2AC\uD55C \uD68C\uD53C', '\u60CA\u9669\u8EB2\u907F', 'Esquivas ajustadas', 'Esquives de justesse'),
  'lolStat.longestTimeAlive': t6('L\u00E4ngste Lebensspanne', 'Longest Time Alive', '\uCD5C\uC7A5 \uC0DD\uC874 \uC2DC\uAC04', '\u6700\u957F\u5B58\u6D3B\u65F6\u95F4', 'Mayor tiempo con vida', 'Plus longue survie'),
  'lolStat.legendary': t6('Legendary', 'Legendary', '\uC804\uC124\uC758 \uCD9C\uD604', '\u8D85\u795E', 'Legendario', 'L\u00E9gendaire'),
  'lolStat.levelLead': t6('Level-Vorsprung', 'Level Lead', '\uB808\uBCA8 \uC6B0\uC704', '\u7B49\u7EA7\u9886\u5148', 'Ventaja de nivel', 'Avance de niveau'),
  'lolStat.magic': t6('Magisch', 'Magic', '\uB9C8\uBC95', '\u9B54\u6CD5', 'M\u00E1gico', 'Magique'),
  'lolStat.maxCSLead': t6('Max CS-Vorteil', 'Max CS Lead', '\uCD5C\uB300 CS \uC6B0\uC704', '\u6700\u5927CS\u9886\u5148', 'M\u00E1x. ventaja de CS', 'Avance CS max.'),
  'lolStat.maxKillDeficit': t6('Max Kill-R\u00FCckstand', 'Max Kill Deficit', '\uCD5C\uB300 \uD0AC \uC5F4\uC138', '\u6700\u5927\u4EBA\u5934\u843D\u540E', 'M\u00E1x. desventaja de asesinatos', 'Retard de kills max.'),
  'lolStat.multikills': t6('Multikills', 'Multikills', '\uBA40\uD2F0\uD0AC', '\u591A\u6740', 'Multiasesinatos', 'Multi-kills'),
  'lolStat.losses': t6('Niederlagen', 'Losses', '\uD328\uBC30', '\u8D25\u573A', 'Derrotas', 'D\u00E9faites'),
  'lolStat.avgCSMin': t6('\u00D8 CS/Min', 'Avg. CS/Min', '\uD3C9\uADE0 CS/\uBD84', '\u5E73\u5747CS/\u5206', 'CS/min medio', 'CS/min moyen'),
  'lolStat.avgKDA': t6('\u00D8 KDA', 'Avg. KDA', '\uD3C9\uADE0 KDA', '\u5E73\u5747KDA', 'KDA medio', 'KDA moyen'),
  'lolStat.objectiveDMG': t6('Objective DMG', 'Objective DMG', '\uC624\uBE0C\uC81D\uD2B8 \uD53C\uD574', '\u8D44\u6E90\u4F24\u5BB3', 'DMG a objetivos', 'DMG aux objectifs'),
  'lolStat.objectiveSteals': t6('Objective Steals', 'Objective Steals', '\uC624\uBE0C\uC81D\uD2B8 \uC2A4\uD2F8', '\u62A2\u8D44\u6E90', 'Robos de objetivos', 'Vols d\'objectifs'),
  'lolStat.physical': t6('Physisch', 'Physical', '\uBB3C\uB9AC', '\u7269\u7406', 'F\u00EDsico', 'Physique'),
  'lolStat.pickKills': t6('Pick-Kills', 'Pick Kills', '\uD53D \uD0AC', '\u6293\u5355\u51FB\u6740', 'Asesinatos por pick', 'Kills sur pick'),
  'lolStat.saves': t6('Rettungen', 'Saves', '\uAD6C\uC870', '\u6551\u63F4', 'Salvadas', 'Sauvetages'),
  'lolStat.roamKills': t6('Roam-Kills', 'Roam Kills', '\uB85C\uBC0D \uD0AC', '\u6E38\u8D70\u51FB\u6740', 'Asesinatos por roaming', 'Kills en roaming'),
  'lolStat.damageMitigatedMin': t6('Schaden absorbiert/Min', 'Damage Mitigated/Min', '\uD53C\uD574 \uD761\uC218/\uBD84', '\u5438\u6536\u4F24\u5BB3/\u5206', 'Da\u00F1o absorbido/min', 'D\u00E9g\u00E2ts absorb\u00E9s/min'),
  'lolStat.damageGame': t6('Schaden/Spiel', 'Damage/Game', '\uD53C\uD574\uB7C9/\uAC8C\uC784', '\u4F24\u5BB3/\u573A', 'Da\u00F1o/partida', 'D\u00E9g\u00E2ts/partie'),
  'lolStat.damageShare2': t6('Schadensanteil', 'Damage Share', '\uD53C\uD574 \uBE44\uC911', '\u4F24\u5BB3\u5360\u6BD4', 'Cuota de da\u00F1o', 'Part des d\u00E9g\u00E2ts'),
  'lolStat.damageTaken': t6('Schadensaufnahme', 'Damage Taken', '\uBC1B\uC740 \uD53C\uD574', '\u627F\u53D7\u4F24\u5BB3', 'Da\u00F1o recibido', 'D\u00E9g\u00E2ts subis'),
  'lolStat.shieldsOnTeammates': t6('Shields auf Teammates', 'Shields on Teammates', '\uC544\uAD70 \uC2E4\uB4DC', '\u4E3A\u961F\u53CB\u62A4\u76FE', 'Escudos a aliados', 'Boucliers sur alli\u00E9s'),
  'lolStat.wins': t6('Siege', 'Wins', '\uC2B9\uB9AC', '\u80DC\u573A', 'Victorias', 'Victoires'),
  'lolStat.skillshotsEarly': t6('Skillshots (early)', 'Skillshots (early)', '\uC2A4\uD0AC\uC0F7 (\uCD08\uBC18)', '\u6280\u80FD\u547D\u4E2D\uFF08\u524D\u671F\uFF09', 'Habilidades (temprano)', 'Skillshots (d\u00E9but)'),
  'lolStat.skillshotsDodged': t6('Skillshots ausgewichen', 'Skillshots Dodged', '\uC2A4\uD0AC\uC0F7 \uD68C\uD53C', '\u8EB2\u907F\u6280\u80FD', 'Habilidades esquivadas', 'Skillshots esquiv\u00E9s'),
  'lolStat.soloKills2': t6('Solo-Kills', 'Solo Kills', '\uC194\uB85C\uD0AC', '\u5355\u6740', 'Asesinatos en solitario', 'Solo kills'),
  'lolStat.takedownsAt25min': t6('Takedowns @25min', 'Takedowns @25min', '25\uBD84 \uD0AC \uAD00\uC5EC', '25\u5206\u949F\u51FB\u6740\u53C2\u4E0E', 'Derribos @25min', 'Takedowns @25min'),
  'lolStat.timeDeadShare': t6('Totzeit-Anteil', 'Time Dead Share', '\uC0AC\uB9DD \uC2DC\uAC04 \uBE44\uC728', '\u9635\u4EA1\u65F6\u95F4\u5360\u6BD4', 'Proporci\u00F3n de tiempo muerto', 'Part du temps mort'),
  'lolStat.towerDives': t6('Turm-Dives', 'Tower Dives', '\uD3EC\uD0D1 \uB2E4\uC774\uBE0C', '\u8D8A\u5854', 'Dives bajo torre', 'Dives sous tour'),
  'lolStat.towers': t6('T\u00FCrme', 'Towers', '\uD3EC\uD0D1', '\u9632\u5FA1\u5854', 'Torres', 'Tours'),
  'lolStat.visionScoreMin': t6('Vision Score/Min', 'Vision Score/Min', '\uC2DC\uC57C \uC810\uC218/\uBD84', '\u89C6\u91CE\u5F97\u5206/\u5206', 'Puntuaci\u00F3n de visi\u00F3n/min', 'Score de vision/min'),
  'lolStat.voidgrubs': t6('Voidgrubs', 'Voidgrubs', '\uACF5\uD5C8 \uC720\uCDA9', '\u865A\u7A7A\u5DE2\u866B', 'Larvas del Vac\u00EDo', 'Larves du N\u00E9ant'),
  'lolStat.trueDamage': t6('Wahrer Schaden', 'True Damage', '\uACE0\uC815 \uD53C\uD574', '\u771F\u5B9E\u4F24\u5BB3', 'Da\u00F1o verdadero', 'D\u00E9g\u00E2ts bruts'),
  'lolStat.wardsPlaced': t6('Wards gesetzt', 'Wards Placed', '\uC640\uB4DC \uC124\uCE58', '\u63D2\u773C', 'Guardianes colocados', 'Balises pos\u00E9es'),
  'lolStat.wardsBefore20Min': t6('Wards vor 20 Min', 'Wards before 20 Min', '20\uBD84 \uC804 \uC640\uB4DC', '20\u5206\u949F\u524D\u63D2\u773C', 'Guardianes antes de 20 min', 'Balises avant 20 min'),
  'lolStat.wardsDestroyed': t6('Wards zerst\u00F6rt', 'Wards Destroyed', '\uC640\uB4DC \uD30C\uAD34', '\u6392\u773C', 'Guardianes destruidos', 'Balises d\u00E9truites'),
  'lolStat.winrateTrend': t6('Winrate-Trend', 'Winrate Trend', '\uC2B9\uB960 \uCD94\uC138', '\u80DC\u7387\u8D8B\u52BF', 'Tendencia de victorias', 'Tendance du taux de victoire'),
  'mvStat.winsAfterDeficit': t6(' Siege nach 5+ Kill-R\u00FCckstand', ' wins after a 5+ kill deficit', ' 5\uD0AC \uC774\uC0C1 \uC5F4\uC138 \uD6C4 \uC2B9\uB9AC', ' \u843D\u540E5+\u4EBA\u5934\u540E\u83B7\u80DC', ' victorias tras 5+ asesinatos de desventaja', ' victoires apr\u00E8s 5+ kills de retard'),
  'mvStat.goldXpDeficit': t6(' Gold/XP-R\u00FCckstand', ' Gold/XP deficit', ' \uACE8\uB4DC/\uACBD\uD5D8\uCE58 \uC5F4\uC138', ' \u7ECF\u6D4E/\u7ECF\u9A8C\u843D\u540E', ' desventaja de oro/XP', ' retard or/XP'),
  'mvStat.goldXpLead': t6(' Gold/XP-Vorteil', ' Gold/XP lead', ' \uACE8\uB4DC/\uACBD\uD5D8\uCE58 \uC6B0\uC704', ' \u7ECF\u6D4E/\u7ECF\u9A8C\u9886\u5148', ' ventaja de oro/XP', ' avance or/XP'),
  'mvStat.csLead': t6(' CS Vorsprung', ' CS lead', ' CS \uC6B0\uC704', ' CS\u9886\u5148', ' de ventaja de CS', ' d\'avance CS'),
  'mvStat.outnumbered': t6(' (Unterzahl)', ' (outnumbered)', ' (\uC218\uC801 \uC5F4\uC138)', '\uFF08\u4EE5\u5C11\u6253\u591A\uFF09', ' (en inferioridad)', ' (en inf\u00E9riorit\u00E9)'),
  'mvStat.barelySurvived': t6('x knapp \u00FCberlebt', 'x barely survived', '\uD68C \uC544\uC2AC\uC544\uC2AC\uD558\uAC8C \uC0DD\uC874', '\u6B21\u60CA\u9669\u5B58\u6D3B', 'x sobrevivi\u00F3 por poco', 'x surv\u00E9cu de justesse'),
  'mvStat.ofGames': t6(' der Spiele', ' of games', ' \uAC8C\uC784', '\u7684\u5BF9\u5C40', ' de las partidas', ' des parties'),
  'mvStat.deadShare': t6(' tot (', ' dead (', ' \uC0AC\uB9DD (', ' \u9635\u4EA1 (', ' muerto (', ' mort ('),
  'mvStat.roles': t6(' Rollen', ' roles', ' \uD3EC\uC9C0\uC158', ' \u4E2A\u4F4D\u7F6E', ' roles', ' r\u00F4les'),
  'mvStat.perGame': t6('/Spiel', '/game', '/\uAC8C\uC784', '/\u573A', '/partida', '/partie'),
  'player.gamesCount': t6('{n} Spiele', '{n} games', '{n}\uAC8C\uC784', '{n}\u573A', '{n} partidas', '{n} parties'),

  // Compare additional
  'compare.player1': t6('Spieler 1', 'Player 1', '\uD50C\uB808\uC774\uC5B4 1', '\u73A9\u5BB61', 'Jugador 1', 'Joueur 1'),
  'compare.player2': t6('Spieler 2', 'Player 2', '\uD50C\uB808\uC774\uC5B4 2', '\u73A9\u5BB62', 'Jugador 2', 'Joueur 2'),
  'compare.notFound': t6('Nicht gefunden', 'Not found', '\uCC3E\uC744 \uC218 \uC5C6\uC74C', '\u672A\u627E\u5230', 'No encontrado', 'Non trouv\u00E9'),
  'compare.category': t6('Kategorie', 'category', '\uCE74\uD14C\uACE0\uB9AC', '\u9879', 'categor\u00EDa', 'cat\u00E9gorie'),
  'compare.categories': t6('Kategorien', 'categories', '\uCE74\uD14C\uACE0\uB9AC', '\u9879', 'categor\u00EDas', 'cat\u00E9gories'),
  'compare.recentForm': t6('Letzte 10 Spiele \u00B7 Streak', 'Last 10 games \u00B7 Streak', '\uCD5C\uADFC 10\uACBD\uAE30 \u00B7 \uC5F0\uC18D', '\u6700\u8FD110\u573A \u00B7 \u8FDE\u7EED', '\u00DAltimas 10 partidas \u00B7 Racha', '10 derni\u00E8res parties \u00B7 S\u00E9rie'),
  'compare.basedOn': t6('Grundlage:', 'Based on', '\uAE30\uC900:', '\u57FA\u4E8E', 'Basado en', 'Bas\u00E9 sur'),
  'compare.tooFewGames': t6('zu wenige Kluft-Spiele f\u00FCr einen Vergleich', 'too few Summoner\'s Rift games to compare', '\uBE44\uAD50\uD560 \uC18C\uD658\uC0AC\uC758 \uD611\uACE1 \uACBD\uAE30\uAC00 \uBD80\uC871\uD569\uB2C8\uB2E4', '\u53EC\u5524\u5E08\u5CE1\u8C37\u5BF9\u5C40\u592A\u5C11\uFF0C\u65E0\u6CD5\u6BD4\u8F83', 'muy pocas partidas en la Grieta para comparar', 'trop peu de parties sur la Faille pour comparer'),
  'ligen.teams': t6('Teams', 'Teams', '\uD300', '\u961F\u4F0D', 'Equipos', '\u00C9quipes'),
  'ligen.games': t6('Spiele', 'Games', '\uACBD\uAE30', '\u6BD4\u8D5B', 'Partidas', 'Matchs'),
  'ligen.winsShort': t6('S', 'W', '\uC2B9', '\u80DC', 'V', 'V'),
  'ligen.lossesShort': t6('N', 'L', '\uD328', '\u8D1F', 'D', 'D'),
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
  'champ.noDataAvailable': t6('sind derzeit noch keine Daten vorhanden. Die aktuellen Statistiken basieren auf Challenger-, Grandmaster- und Master-Matches.', 'no data is currently available. Current statistics are based on Challenger, Grandmaster and Master matches.', '\uC5D0 \uB300\uD55C \uB370\uC774\uD130\uAC00 \uC544\uC9C1 \uC5C6\uC2B5\uB2C8\uB2E4. \uD604\uC7AC \uD1B5\uACC4\uB294 \uCC4C\uB9B0\uC800 + \uADF8\uB79C\uB4DC\uB9C8\uC2A4\uD130 + \uB9C8\uC2A4\uD130 \uB9E4\uCE58 \uAE30\uC900\uC785\uB2C8\uB2E4.', '\u76EE\u524D\u6CA1\u6709\u6570\u636E\u3002\u5F53\u524D\u7EDF\u8BA1\u57FA\u4E8E\u6700\u5F3A\u738B\u8005+\u5B97\u5E08+\u5927\u5E08\u5BF9\u5C40\u3002', 'actualmente no tiene datos. Las estad\u00EDsticas actuales se basan en partidas Aspirante, Gran Maestro y Maestro.', 'n\'a actuellement pas de donn\u00E9es. Les stats sont bas\u00E9es sur les matchs Challenger, Grand Ma\u00EEtre et Ma\u00EEtre.'),
  'champ.loadFromApi': t6('Lade Champion-Statistiken von Riot API', 'Loading champion statistics from Riot API', 'Riot API\uC5D0\uC11C \uCC54\uD53C\uC5B8 \uD1B5\uACC4 \uB85C\uB529 \uC911', '\u4ECERiot API\u52A0\u8F7D\u82F1\u96C4\u7EDF\u8BA1\u6570\u636E', 'Cargando estad\u00EDsticas de campeones de Riot API', 'Chargement des stats depuis l\'API Riot'),
  'champ.loadNow': t6('Jetzt laden', 'Load now', '\uC9C0\uAE08 \uB85C\uB529', '\u7ACB\u5373\u52A0\u8F7D', 'Cargar ahora', 'Charger maintenant'),
  'champ.regionLabel': t6('Region', 'Region', '\uC9C0\uC5ED', '\u5730\u533A', 'Regi\u00F3n', 'R\u00E9gion'),

  // Homepage additional
  'home.topChampions': t6('Meistgespielte Champions', 'Most Played Champions', '\uCD5C\uB2E4 \uD50C\uB808\uC774 \uCC54\uD53C\uC5B8', '\u6700\u5E38\u4F7F\u7528\u82F1\u96C4', 'Campeones m\u00E1s jugados', 'Champions les plus jou\u00E9s'),
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
  'tft.marketValue.refresh.button': t6(
    'Aktualisieren', 'Refresh',
    '\uC0C8\uB85C\uACE0\uCE68', '\u5237\u65B0',
    'Actualizar', 'Actualiser'
  ),
  'tft.marketValue.refresh.busy': t6(
    'Lade\u2026', 'Loading\u2026',
    '\uB85C\uB529 \uC911\u2026', '\u52A0\u8F7D\u4E2D\u2026',
    'Cargando\u2026', 'Chargement\u2026'
  ),
  'tft.marketValue.refresh.cooldown': t6(
    'Bitte {s}s warten', 'Please wait {s}s',
    '{s}\uCD08 \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4', '\u8BF7\u7B49\u5F85 {s} \u79D2',
    'Espera {s}s', 'Patientez {s}s'
  ),
  'tft.marketValue.refresh.failed': t6(
    'Aktualisierung fehlgeschlagen \u2014 bitte sp\u00E4ter erneut versuchen',
    'Refresh failed \u2014 please try again later',
    '\uC0C8\uB85C\uACE0\uCE68 \uC2E4\uD328 \u2014 \uB098\uC911\uC5D0 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694',
    '\u5237\u65B0\u5931\u8D25 \u2014 \u8BF7\u7A0D\u540E\u518D\u8BD5',
    'Actualizaci\u00F3n fallida \u2014 int\u00E9ntalo m\u00E1s tarde',
    '\u00C9chec de l\'actualisation \u2014 r\u00E9essayez plus tard'
  ),
  'tft.marketValue.dataFrom': t6(
    'Daten vom', 'Data from',
    '\uB370\uC774\uD130 \uAE30\uC900\uC77C', '\u6570\u636E\u65E5\u671F',
    'Datos del', 'Donn\u00E9es du'
  ),
  'tft.trait.possibleItems': t6(
    'Mögliche Items', 'Possible items',
    '가능한 아이템', '可能的物品',
    'Ítems posibles', 'Items possibles'
  ),
  'tft.trait.variants': t6(
    '{n} Konstellationen — pro Spiel wird eine zufällig gewählt',
    '{n} constellations — one rolled per game',
    '{n}개 별자리 — 게임마다 하나 무작위 선택',
    '{n} 个星座 — 每局随机选择一个',
    '{n} constelaciones — una se elige al azar por partida',
    '{n} constellations — une tirée au sort par partie'
  ),
  'tft.trait.arbiterPicker': t6(
    'Ursache + Effekt wählen',
    'Pick a Cause + Effect',
    '원인 + 효과 선택',
    '选择原因 + 效果',
    'Elige causa + efecto',
    'Choisis cause + effet'
  ),
  'tft.trait.arbiterCauses': t6(
    'Mögliche Ursachen', 'Available Causes',
    '가능한 원인', '可选原因',
    'Causas posibles', 'Causes possibles'
  ),
  'tft.trait.arbiterEffects': t6(
    'Mögliche Effekte', 'Available Effects',
    '가능한 효과', '可选效果',
    'Efectos posibles', 'Efectos possibles'
  ),
  'tft.setTimeline.setLabel': t6(
    'Set {n}', 'Set {n}',
    '\uC2DC\uC98C {n}', '\u8D5B\u5B63 {n}',
    'Set {n}', 'Set {n}'
  ),
  'tft.setTimeline.dayOf': t6(
    'Tag {d} von {t}', 'Day {d} of {t}',
    '{t}\uC77C \uC911 {d}\uC77C\uC9F8', '\u7B2C {d} / {t} \u5929',
    'D\u00EDa {d} de {t}', 'Jour {d} sur {t}'
  ),
  'tft.setTimeline.remaining': t6(
    'noch {r} Tage', '{r} days left',
    '{r}\uC77C \uB0A8\uC74C', '\u5269\u4F59 {r} \u5929',
    '{r} d\u00EDas restantes', '{r} jours restants'
  ),
  'tft.setTimeline.today': t6(
    'Heute', 'Today',
    '\uC624\uB298', '\u4ECA\u5929',
    'Hoy', 'Aujourd\'hui'
  ),
  'tft.setTimeline.hotfix': t6(
    'Hotfix', 'Hotfix',
    '\uD56B\uD53D\uC2A4', '\u70ED\u4FEE',
    'Hotfix', 'Hotfix'
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
    'Marktwert-Berechnung', 'Market Value Calculation',
    '\uC2DC\uC7A5 \uAC00\uCE58 \uACC4\uC0B0', '\u5E02\u573A\u4EF7\u503C\u8BA1\u7B97',
    'C\u00E1lculo de Valor de Mercado', 'Calcul de valeur de march\u00E9'
  ),
  'tft.marketValue.contributions': t6(
    'Beitrag zum Skill-Score', 'Skill-score contributions',
    '\uC2A4\uD0AC \uC810\uC218 \uAE30\uC5EC\uB3C4', '\u6280\u672F\u5206\u8D21\u732E',
    'Aportes al skill-score', 'Contributions au skill-score'
  ),
  'tft.marketValue.contribution': t6(
    'Beitrag', 'Contribution',
    '\uAE30\uC5EC\uB3C4', '\u8D21\u732E',
    'Aporte', 'Contribution'
  ),
  'tft.marketValue.ladderRank': t6(
    'Region-Rang #{n}', 'Region rank #{n}',
    '\uC9C0\uC5ED \uC21C\uC704 #{n}', '\u533A\u57DF\u6392\u540D #{n}',
    'Rango de regi\u00F3n #{n}', 'Rang r\u00E9gional #{n}'
  ),
  'tft.marketValue.peak': t6(
    'H\u00F6chster MW Set {n}', 'Peak MV Set {n}',
    '\uC138\uD2B8 {n} \uCD5C\uACE0 MV', '\u7B2C{n}\u8D5B\u5B63\u6700\u9AD8\u5E02\u503C',
    'VM m\u00E1ximo Set {n}', 'VM max. Set {n}'
  ),
  'tft.marketValue.peakAll': t6(
    'Alle Sets', 'All sets',
    '\uBAA8\uB4E0 \uC138\uD2B8', '\u6240\u6709\u8D5B\u5B63',
    'Todos los Sets', 'Tous les Sets'
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
  'tft.marketValue.agent.flexMastery': t6(
    'Flex-K\u00F6nnen', 'Flex Mastery',
    '\uD50C\uB809\uC2A4 \uC219\uB828\uB3C4', '\u7075\u6D3B\u7CBE\u901A',
    'Maestr\u00EDa flex', 'Ma\u00EEtrise flex'
  ),
  'tft.marketValue.agent.gameSense': t6(
    'Game Sense', 'Game Sense',
    '\uAC8C\uC784 \uC13C\uC2A4', '\u6E38\u620F\u610F\u8BC6',
    'Visi\u00F3n de juego', 'Sens du jeu'
  ),
  'tft.marketValue.agent.metaRelative': t6(
    'Meta-Vorsprung', 'Meta Edge',
    '\uBA54\uD0C0 \uC6B0\uC704', '\u8D85\u989D\u8868\u73B0',
    'Ventaja Meta', 'Avantage M\u00E9ta'
  ),
  'tft.marketValue.agent.boardStrength': t6(
    'Board-St\u00E4rke', 'Board Strength',
    '\uBCF4\uB4DC \uD30C\uC6CC', '\u68CB\u76D8\u5F3A\u5EA6',
    'Fuerza del tablero', 'Force du plateau'
  ),
  'tft.marketValue.agent.notRated': t6(
    'zu wenig Daten', 'not enough data',
    '\uB370\uC774\uD130 \uBD80\uC871', '\u6570\u636E\u4E0D\u8DB3',
    'datos insuficientes', 'donn\u00E9es insuffisantes'
  ),
  'tft.marketValue.skillScore': t6(
    'Skill-Score', 'Skill Score',
    '\uC2A4\uD0AC \uC810\uC218', '\u6280\u5DE7\u8BC4\u5206',
    'Puntuaci\u00F3n de habilidad', 'Score de comp\u00E9tence'
  ),
  'tft.marketValue.timeline.start': t6(
    'Patch-Start', 'Patch start',
    '\uD328\uCE58 \uC2DC\uC791', '\u7248\u672C\u5F00\u59CB',
    'Inicio del parche', 'D\u00E9but du patch'
  ),
  'tft.marketValue.agent.noImpact': t6(
    'Kein Einfluss', 'No impact',
    '\uC601\uD5A5 \uC5C6\uC74C', '\u65E0\u5F71\u54CD',
    'Sin impacto', 'Aucun impact'
  ),

  // \u2500\u2500 Marktwert-Methodik / Q&A-Seite (/tft/marktwert/methodik) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'tft.mv.method.link': t6(
    'Marktwert-Berechnung', "How it's calculated",
    '\uC0B0\uC815 \uBC29\uC2DD', '\u4F30\u503C\u8BA1\u7B97\u65B9\u5F0F',
    'C\u00F3mo se calcula', 'M\u00E9thode de calcul'
  ),
  'tft.mv.method.title': t6(
    'Marktwert-Berechnung', 'How the market value is calculated',
    '\uC2DC\uC7A5 \uAC00\uCE58 \uC0B0\uC815 \uBC29\uC2DD', '\u5E02\u573A\u4EF7\u503C\u5982\u4F55\u8BA1\u7B97',
    'C\u00F3mo se calcula el valor de mercado', 'Comment la valeur marchande est calcul\u00E9e'
  ),
  'tft.mv.method.intro': t6(
    'Wie der Marktwert eines Spielers entsteht \u2014 Schritt f\u00FCr Schritt erkl\u00E4rt.',
    "How a player's market value is built \u2014 explained step by step.",
    '\uC120\uC218\uC758 \uC2DC\uC7A5 \uAC00\uCE58\uAC00 \uC5B4\uB5BB\uAC8C \uC0B0\uCD9C\uB418\uB294\uC9C0 \uB2E8\uACC4\uBCC4\uB85C \uC124\uBA85\uD569\uB2C8\uB2E4.',
    '\u9010\u6B65\u8BF4\u660E\u9009\u624B\u7684\u5E02\u573A\u4EF7\u503C\u662F\u5982\u4F55\u5F97\u51FA\u7684\u3002',
    'C\u00F3mo se construye el valor de mercado de un jugador, explicado paso a paso.',
    "Comment la valeur marchande d'un joueur est \u00E9tablie, expliqu\u00E9e \u00E9tape par \u00E9tape."
  ),
  'tft.mv.method.q.what': t6(
    'Was ist der Marktwert?', 'What is the market value?',
    '\uC2DC\uC7A5 \uAC00\uCE58\uB780 \uBB34\uC5C7\uC778\uAC00\uC694?', '\u4EC0\u4E48\u662F\u5E02\u573A\u4EF7\u503C\uFF1F',
    '\u00BFQu\u00E9 es el valor de mercado?', "Qu'est-ce que la valeur marchande ?"
  ),
  'tft.mv.method.a.what': t6(
    'Der Marktwert sch\u00E4tzt die aktuelle Spielst\u00E4rke als Geldbetrag und macht Spieler vergleichbar. Er besteht aus einem Basiswert (aus dem Rang) multipliziert mit einem Skill-Multiplikator (aus der Leistung).',
    "The market value estimates a player's current strength as a monetary figure, making players comparable. It is a base value (from rank) multiplied by a skill multiplier (from performance).",
    '\uC2DC\uC7A5 \uAC00\uCE58\uB294 \uC120\uC218\uC758 \uD604\uC7AC \uC2E4\uB825\uC744 \uAE08\uC561\uC73C\uB85C \uD658\uC0B0\uD574 \uC11C\uB85C \uBE44\uAD50\uD560 \uC218 \uC788\uAC8C \uD569\uB2C8\uB2E4. \uB7AD\uD06C \uAE30\uBC18\uC758 \uAE30\uBCF8\uAC12\uC5D0 \uC2E4\uB825 \uAE30\uBC18\uC758 \uC2A4\uD0AC \uBC30\uC218\uB97C \uACF1\uD55C \uAC12\uC785\uB2C8\uB2E4.',
    '\u5E02\u573A\u4EF7\u503C\u5C06\u9009\u624B\u5F53\u524D\u7684\u5B9E\u529B\u6362\u7B97\u4E3A\u91D1\u989D\uFF0C\u4FBF\u4E8E\u76F8\u4E92\u6BD4\u8F83\u3002\u5B83\u7531\u57FA\u7840\u503C\uFF08\u6765\u81EA\u6BB5\u4F4D\uFF09\u4E58\u4EE5\u5B9E\u529B\u500D\u6570\uFF08\u6765\u81EA\u8868\u73B0\uFF09\u6784\u6210\u3002',
    'El valor de mercado estima la fuerza actual de un jugador como una cifra monetaria, permitiendo compararlos. Es un valor base (seg\u00FAn el rango) multiplicado por un multiplicador de habilidad (seg\u00FAn el rendimiento).',
    "La valeur marchande estime la force actuelle d'un joueur sous forme d'un montant, ce qui permet de les comparer. C'est une valeur de base (issue du rang) multipli\u00E9e par un multiplicateur de comp\u00E9tence (issu des performances)."
  ),
  'tft.mv.method.q.base': t6(
    'Wie entsteht der Basiswert?', 'How is the base value determined?',
    '\uAE30\uBCF8\uAC12\uC740 \uC5B4\uB5BB\uAC8C \uC815\uD574\uC9C0\uB098\uC694?', '\u57FA\u7840\u503C\u662F\u5982\u4F55\u786E\u5B9A\u7684\uFF1F',
    '\u00BFC\u00F3mo se determina el valor base?', 'Comment la valeur de base est-elle d\u00E9termin\u00E9e ?'
  ),
  'tft.mv.method.a.base': t6(
    'Aus Tier und LP \u00FCber eine feste Kurve: h\u00F6herer Rang \u2192 h\u00F6herer Basiswert. Der niedrigste angesetzte Rang ist Diamant II.',
    'From tier and LP via a fixed curve: higher rank \u2192 higher base value. The lowest rank we score is Diamond II.',
    '\uD2F0\uC5B4\uC640 LP\uB97C \uACE0\uC815\uB41C \uACE1\uC120\uC73C\uB85C \uD658\uC0B0\uD569\uB2C8\uB2E4. \uB7AD\uD06C\uAC00 \uB192\uC744\uC218\uB85D \uAE30\uBCF8\uAC12\uC774 \uCEE4\uC9C0\uBA70, \uC0B0\uC815 \uB300\uC0C1\uC758 \uCD5C\uC800 \uB7AD\uD06C\uB294 \uB2E4\uC774\uC544\uBAAC\uB4DC II\uC785\uB2C8\uB2E4.',
    '\u6839\u636E\u6BB5\u4F4D\u548C LP \u901A\u8FC7\u56FA\u5B9A\u66F2\u7EBF\u5F97\u51FA\uFF1A\u6BB5\u4F4D\u8D8A\u9AD8\uFF0C\u57FA\u7840\u503C\u8D8A\u9AD8\u3002\u8BA1\u5165\u7684\u6700\u4F4E\u6BB5\u4F4D\u4E3A\u94BB\u77F3 II\u3002',
    'A partir del tier y los LP mediante una curva fija: mayor rango \u2192 mayor valor base. El rango m\u00E1s bajo que puntuamos es Diamante II.',
    '\u00C0 partir du palier et des LP via une courbe fixe : rang plus \u00E9lev\u00E9 \u2192 valeur de base plus \u00E9lev\u00E9e. Le rang le plus bas pris en compte est Diamant II.'
  ),
  'tft.mv.method.q.z': t6(
    'Was bedeutet der z-Score?', 'What does the z-score mean?',
    'z \uC810\uC218\uB294 \uBB34\uC5C7\uC744 \uC758\uBBF8\uD558\uB098\uC694?', 'z \u5206\u6570\u662F\u4EC0\u4E48\u610F\u601D\uFF1F',
    '\u00BFQu\u00E9 significa la puntuaci\u00F3n z?', 'Que signifie le score z ?'
  ),
  'tft.mv.method.a.z': t6(
    'Der z-Score misst, wie weit ein Spieler vom Median seiner Kohorte (Diamant II+, gleiche Region und gleiches Set) entfernt ist \u2014 in robusten Standardabweichungen (MAD). 0 = Durchschnitt, positiv = besser, negativ = schlechter. Extremwerte werden bei \u00B13 gekappt.',
    'The z-score measures how far a player is from the median of their cohort (Diamond II+, same region and set) \u2014 in robust standard deviations (MAD). 0 = average, positive = better, negative = worse. Extremes are capped at \u00B13.',
    'z \uC810\uC218\uB294 \uC120\uC218\uAC00 \uC18D\uD55C \uC9D1\uB2E8(\uB2E4\uC774\uC544\uBAAC\uB4DC II \uC774\uC0C1, \uB3D9\uC77C \uC9C0\uC5ED\u00B7\uC2DC\uC98C)\uC758 \uC911\uC559\uAC12\uC5D0\uC11C \uC5BC\uB9C8\uB098 \uB5A8\uC5B4\uC838 \uC788\uB294\uC9C0\uB97C \uACAC\uACE0\uD55C \uD45C\uC900\uD3B8\uCC28(MAD)\uB85C \uB098\uD0C0\uB0C5\uB2C8\uB2E4. 0 = \uD3C9\uADE0, \uC591\uC218 = \uC6B0\uC218, \uC74C\uC218 = \uC800\uC870\uC774\uBA70 \uADF9\uB2E8\uAC12\uC740 \u00B13\uC73C\uB85C \uC81C\uD55C\uB429\uB2C8\uB2E4.',
    'z \u5206\u6570\u8861\u91CF\u9009\u624B\u4E0E\u5176\u540C\u7EC4\uFF08\u94BB\u77F3 II \u4EE5\u4E0A\u3001\u76F8\u540C\u5927\u533A\u4E0E\u7248\u672C\uFF09\u4E2D\u4F4D\u6570\u7684\u8DDD\u79BB\uFF0C\u5355\u4F4D\u4E3A\u7A33\u5065\u6807\u51C6\u5DEE\uFF08MAD\uFF09\u30020 = \u5E73\u5747\uFF0C\u6B63\u503C = \u66F4\u597D\uFF0C\u8D1F\u503C = \u66F4\u5DEE\uFF0C\u6781\u7AEF\u503C\u88AB\u9650\u5236\u5728 \u00B13\u3002',
    'La puntuaci\u00F3n z mide cu\u00E1n lejos est\u00E1 un jugador de la mediana de su cohorte (Diamante II+, misma regi\u00F3n y set), en desviaciones est\u00E1ndar robustas (MAD). 0 = promedio, positivo = mejor, negativo = peor. Los extremos se limitan a \u00B13.',
    'Le score z mesure l\u2019\u00E9cart d\u2019un joueur par rapport \u00E0 la m\u00E9diane de sa cohorte (Diamant II+, m\u00EAme r\u00E9gion et m\u00EAme set), en \u00E9carts-types robustes (MAD). 0 = moyenne, positif = meilleur, n\u00E9gatif = moins bon. Les extr\u00EAmes sont plafonn\u00E9s \u00E0 \u00B13.'
  ),
  'tft.mv.method.q.signals': t6(
    'Welche Signale flie\u00DFen ein?', 'Which signals go into it?',
    '\uC5B4\uB5A4 \uC9C0\uD45C\uAC00 \uBC18\uC601\uB418\uB098\uC694?', '\u5305\u542B\u54EA\u4E9B\u6307\u6807\uFF1F',
    '\u00BFQu\u00E9 se\u00F1ales intervienen?', 'Quels signaux entrent en jeu ?'
  ),
  'tft.mv.method.a.signals': t6(
    'Sechs gewichtete Signale ergeben den Skill-Multiplikator. Jedes wird als z-Score gegen die Kohorte gemessen:',
    'Six weighted signals form the skill multiplier. Each is measured as a z-score against the cohort:',
    '\uC5EC\uC12F \uAC1C\uC758 \uAC00\uC911 \uC9C0\uD45C\uAC00 \uC2A4\uD0AC \uBC30\uC218\uB97C \uAD6C\uC131\uD558\uBA70, \uAC01\uAC01 \uC9D1\uB2E8 \uB300\uBE44 z \uC810\uC218\uB85C \uCE21\uC815\uB429\uB2C8\uB2E4:',
    '\u516D\u4E2A\u52A0\u6743\u6307\u6807\u5171\u540C\u6784\u6210\u5B9E\u529B\u500D\u6570\uFF0C\u6BCF\u4E2A\u90FD\u4EE5\u76F8\u5BF9\u540C\u7EC4\u7684 z \u5206\u6570\u8861\u91CF\uFF1A',
    'Seis se\u00F1ales ponderadas forman el multiplicador de habilidad. Cada una se mide como puntuaci\u00F3n z frente a la cohorte:',
    'Six signaux pond\u00E9r\u00E9s forment le multiplicateur de comp\u00E9tence. Chacun est mesur\u00E9 sous forme de score z par rapport \u00E0 la cohorte :'
  ),
  'tft.mv.method.sig.performance': t6(
    'Wie gut platzierst du dich im Schnitt? Basis: \u00D8-Platzierung kombiniert mit Top-4- und Sieg-Anteil.',
    'How well do you place on average? Based on average placement combined with Top-4 and win rate.',
    '\uD3C9\uADE0\uC801\uC73C\uB85C \uC5BC\uB9C8\uB098 \uB192\uC740 \uC21C\uC704\uC5D0 \uB4DC\uB294\uAC00? \uD3C9\uADE0 \uB4F1\uC218\uC5D0 Top-4\u00B71\uC704 \uBE44\uC728\uC744 \uACB0\uD569\uD569\uB2C8\uB2E4.',
    '\u4F60\u7684\u5E73\u5747\u540D\u6B21\u6709\u591A\u597D\uFF1F\u57FA\u4E8E\u5E73\u5747\u540D\u6B21\u7ED3\u5408 Top-4 \u4E0E\u5403\u9E21\u7387\u3002',
    '\u00BFQu\u00E9 tan bien te posicionas de media? Basado en la posici\u00F3n media combinada con la tasa de Top-4 y de victorias.',
    'Quel est votre classement moyen ? Bas\u00E9 sur le placement moyen combin\u00E9 au taux de Top-4 et de victoires.'
  ),
  'tft.mv.method.sig.metaRelative': t6(
    'Holst du mit denselben Comps mehr heraus als der Durchschnitt? Vergleich gegen die Meta-Baseline derselben Comps.',
    'Do you get more out of the same comps than average? Compared against the meta baseline of those comps.',
    '\uAC19\uC740 \uC870\uD569\uC73C\uB85C \uD3C9\uADE0\uBCF4\uB2E4 \uB354 \uC88B\uC740 \uC131\uACFC\uB97C \uB0B4\uB294\uAC00? \uB3D9\uC77C \uC870\uD569\uC758 \uBA54\uD0C0 \uAE30\uC900\uC120\uACFC \uBE44\uAD50\uD569\uB2C8\uB2E4.',
    '\u7528\u76F8\u540C\u9635\u5BB9\u4F60\u80FD\u5426\u6253\u51FA\u9AD8\u4E8E\u5E73\u5747\u7684\u6210\u7EE9\uFF1F\u4E0E\u8FD9\u4E9B\u9635\u5BB9\u7684 Meta \u57FA\u51C6\u7EBF\u6BD4\u8F83\u3002',
    '\u00BFSacas m\u00E1s partido que la media a las mismas composiciones? Comparado con la l\u00EDnea base meta de esas composiciones.',
    'Tirez-vous plus parti des m\u00EAmes compositions que la moyenne ? Compar\u00E9 \u00E0 la r\u00E9f\u00E9rence m\u00E9ta de ces compositions.'
  ),
  'tft.mv.method.sig.consistency': t6(
    'Wie konstant sind deine Platzierungen? Basis: Streuung (\u03C3) \u2014 weniger Ausrei\u00DFer ist besser.',
    'How consistent are your placements? Based on spread (\u03C3) \u2014 fewer outliers is better.',
    '\uC21C\uC704\uAC00 \uC5BC\uB9C8\uB098 \uC77C\uC815\uD55C\uAC00? \uBD84\uC0B0(\u03C3) \uAE30\uBC18\uC73C\uB85C \uAE30\uBCF5\uC774 \uC801\uC744\uC218\uB85D \uC88B\uC2B5\uB2C8\uB2E4.',
    '\u4F60\u7684\u540D\u6B21\u6709\u591A\u7A33\u5B9A\uFF1F\u57FA\u4E8E\u79BB\u6563\u5EA6\uFF08\u03C3\uFF09\uFF0C\u6CE2\u52A8\u8D8A\u5C0F\u8D8A\u597D\u3002',
    '\u00BFQu\u00E9 tan constantes son tus posiciones? Basado en la dispersi\u00F3n (\u03C3): menos valores at\u00EDpicos es mejor.',
    'Vos placements sont-ils r\u00E9guliers ? Bas\u00E9 sur la dispersion (\u03C3) : moins de valeurs extr\u00EAmes, c\u2019est mieux.'
  ),
  'tft.mv.method.sig.flexMastery': t6(
    'Wie viele verschiedene Comps spielst du erfolgreich? Belohnt Flexibilit\u00E4t statt Einseitigkeit.',
    'How many different comps do you play successfully? Rewards flexibility over one-tricking.',
    '\uC11C\uB85C \uB2E4\uB978 \uC870\uD569\uC744 \uC5BC\uB9C8\uB098 \uC798 \uC18C\uD654\uD558\uB294\uAC00? \uD55C \uC870\uD569\uB9CC \uACE0\uC9D1\uD558\uAE30\uBCF4\uB2E4 \uC720\uC5F0\uD568\uC744 \uB192\uC774 \uD3C9\uAC00\uD569\uB2C8\uB2E4.',
    '\u4F60\u80FD\u6210\u529F\u9A7E\u9A6D\u591A\u5C11\u79CD\u4E0D\u540C\u9635\u5BB9\uFF1F\u5956\u52B1\u7075\u6D3B\u591A\u53D8\u800C\u975E\u5355\u4E00\u6253\u6CD5\u3002',
    '\u00BFCu\u00E1ntas composiciones distintas juegas con \u00E9xito? Premia la flexibilidad frente a jugar siempre lo mismo.',
    'Combien de compositions diff\u00E9rentes jouez-vous avec succ\u00E8s ? R\u00E9compense la polyvalence plut\u00F4t que le mono-jeu.'
  ),
  'tft.mv.method.sig.gameSense': t6(
    'Late-Game-\u00DCberleben und Eco-Management \u2014 wie lange du dich h\u00E4ltst und wie effizient du dein Gold nutzt.',
    'Late-game survival and economy management \u2014 how long you last and how efficiently you use gold.',
    '\uD6C4\uBC18 \uC0DD\uC874\uB825\uACFC \uC774\uCF54\uB178\uBBF8 \uAD00\uB9AC \u2014 \uC5BC\uB9C8\uB098 \uC624\uB798 \uBC84\uD2F0\uACE0 \uACE8\uB4DC\uB97C \uC5BC\uB9C8\uB098 \uD6A8\uC728\uC801\uC73C\uB85C \uC4F0\uB294\uC9C0.',
    '\u540E\u671F\u751F\u5B58\u4E0E\u7ECF\u6D4E\u8FD0\u8425\u2014\u2014\u4F60\u80FD\u6491\u591A\u4E45\uFF0C\u4EE5\u53CA\u7528\u91D1\u5E01\u7684\u6548\u7387\u3002',
    'Supervivencia en late-game y gesti\u00F3n de econom\u00EDa: cu\u00E1nto aguantas y con qu\u00E9 eficiencia usas el oro.',
    'Survie en fin de partie et gestion de l\u2019\u00E9conomie : combien de temps vous tenez et l\u2019efficacit\u00E9 de votre or.'
  ),
  'tft.mv.method.sig.boardStrength': t6(
    'St\u00E4rke deines finalen Boards relativ zur erreichten Platzierung.',
    'Strength of your final board relative to the placement reached.',
    '\uB3C4\uB2EC\uD55C \uC21C\uC704 \uB300\uBE44 \uCD5C\uC885 \uBCF4\uB4DC\uC758 \uAC15\uD568.',
    '\u76F8\u5BF9\u4E8E\u6700\u7EC8\u540D\u6B21\uFF0C\u4F60\u6700\u7EC8\u68CB\u76D8\u7684\u5F3A\u5EA6\u3002',
    'Fuerza de tu tablero final en relaci\u00F3n con la posici\u00F3n alcanzada.',
    'Force de votre plateau final par rapport au classement atteint.'
  ),
  'tft.mv.method.q.mult': t6(
    'Wie wird daraus der Marktwert?', 'How does that become the market value?',
    '\uC774 \uAC12\uB4E4\uC774 \uC5B4\uB5BB\uAC8C \uC2DC\uC7A5 \uAC00\uCE58\uAC00 \uB418\uB098\uC694?', '\u8FD9\u4E9B\u6307\u6807\u5982\u4F55\u53D8\u6210\u5E02\u573A\u4EF7\u503C\uFF1F',
    '\u00BFC\u00F3mo se convierte eso en el valor de mercado?', 'Comment cela devient-il la valeur marchande ?'
  ),
  'tft.mv.method.a.mult': t6(
    'Die sechs z-Scores werden mit ihren Gewichten verrechnet, gegl\u00E4ttet und zu einem Multiplikator zwischen 0,45 und 1,65 zusammengefasst. Basiswert \u00D7 Multiplikator = Marktwert.',
    'The six z-scores are combined with their weights, smoothed, and condensed into a multiplier between 0.45 and 1.65. Base value \u00D7 multiplier = market value.',
    '\uC5EC\uC12F \uAC1C\uC758 z \uC810\uC218\uB97C \uAC00\uC911\uCE58\uC640 \uD568\uAED8 \uD569\uC0B0\u00B7\uD3C9\uD65C\uD654\uD558\uC5EC 0.45~1.65 \uC0AC\uC774\uC758 \uBC30\uC218\uB85C \uB9CC\uB4ED\uB2C8\uB2E4. \uAE30\uBCF8\uAC12 \u00D7 \uBC30\uC218 = \uC2DC\uC7A5 \uAC00\uCE58.',
    '\u516D\u4E2A z \u5206\u6570\u6309\u6743\u91CD\u5408\u5E76\u3001\u5E73\u6ED1\u540E\uFF0C\u6C47\u603B\u4E3A 0.45 \u5230 1.65 \u4E4B\u95F4\u7684\u500D\u6570\u3002\u57FA\u7840\u503C \u00D7 \u500D\u6570 = \u5E02\u573A\u4EF7\u503C\u3002',
    'Las seis puntuaciones z se combinan con sus pesos, se suavizan y se condensan en un multiplicador entre 0,45 y 1,65. Valor base \u00D7 multiplicador = valor de mercado.',
    'Les six scores z sont combin\u00E9s selon leurs poids, liss\u00E9s, puis condens\u00E9s en un multiplicateur compris entre 0,45 et 1,65. Valeur de base \u00D7 multiplicateur = valeur marchande.'
  ),
  'tft.mv.method.q.example': t6(
    'Ein Beispiel', 'An example',
    '\uC608\uC2DC', '\u4E3E\u4F8B',
    'Un ejemplo', 'Un exemple'
  ),
  'tft.mv.method.a.example': t6(
    'Basiswert 112.000\u00A0\u20AC \u00D7 Multiplikator 1,20 = 134.400\u00A0\u20AC. Ein Multiplikator \u00FCber 1,0 steht f\u00FCr \u00FCberdurchschnittliche Leistung, unter 1,0 f\u00FCr unterdurchschnittliche.',
    'Base value \u20AC112,000 \u00D7 multiplier 1.20 = \u20AC134,400. A multiplier above 1.0 means above-average performance, below 1.0 means below-average.',
    '\uAE30\uBCF8\uAC12 112,000\u20AC \u00D7 \uBC30\uC218 1.20 = 134,400\u20AC. \uBC30\uC218\uAC00 1.0\uBCF4\uB2E4 \uD06C\uBA74 \uD3C9\uADE0 \uC774\uC0C1, \uC791\uC73C\uBA74 \uD3C9\uADE0 \uC774\uD558\uC758 \uC2E4\uB825\uC744 \uB73B\uD569\uB2C8\uB2E4.',
    '\u57FA\u7840\u503C 112,000\u20AC \u00D7 \u500D\u6570 1.20 = 134,400\u20AC\u3002\u500D\u6570\u9AD8\u4E8E 1.0 \u8868\u793A\u9AD8\u4E8E\u5E73\u5747\u6C34\u5E73\uFF0C\u4F4E\u4E8E 1.0 \u8868\u793A\u4F4E\u4E8E\u5E73\u5747\u6C34\u5E73\u3002',
    'Valor base 112.000\u00A0\u20AC \u00D7 multiplicador 1,20 = 134.400\u00A0\u20AC. Un multiplicador superior a 1,0 indica un rendimiento por encima de la media; inferior a 1,0, por debajo.',
    'Valeur de base 112\u00A0000\u00A0\u20AC \u00D7 multiplicateur 1,20 = 134\u00A0400\u00A0\u20AC. Un multiplicateur sup\u00E9rieur \u00E0 1,0 indique une performance au-dessus de la moyenne, inf\u00E9rieur \u00E0 1,0 en dessous.'
  ),
  'tft.mv.tip.z': t6(
    'z-Score: Abstand zum Median-Spieler (Diamant II+) in robusten Standardabweichungen. 0 = Durchschnitt, + besser, - schlechter.',
    'z-score: distance from the median player (Diamond II+) in robust standard deviations. 0 = average, + better, - worse.',
    'z \uC810\uC218: \uC911\uC559\uAC12 \uC120\uC218(\uB2E4\uC774\uC544\uBAAC\uB4DC II \uC774\uC0C1)\uC640\uC758 \uAC70\uB9AC(\uACAC\uACE0\uD55C \uD45C\uC900\uD3B8\uCC28). 0 = \uD3C9\uADE0, + \uC6B0\uC218, - \uC800\uC870.',
    'z \u5206\u6570\uFF1A\u4E0E\u4E2D\u4F4D\u6570\u9009\u624B\uFF08\u94BB\u77F3 II \u4EE5\u4E0A\uFF09\u7684\u8DDD\u79BB\uFF0C\u5355\u4F4D\u4E3A\u7A33\u5065\u6807\u51C6\u5DEE\u30020 = \u5E73\u5747\uFF0C+ \u66F4\u597D\uFF0C- \u66F4\u5DEE\u3002',
    'Puntuaci\u00F3n z: distancia respecto al jugador mediano (Diamante II+) en desviaciones est\u00E1ndar robustas. 0 = promedio, + mejor, - peor.',
    'Score z : \u00E9cart par rapport au joueur m\u00E9dian (Diamant II+) en \u00E9carts-types robustes. 0 = moyenne, + meilleur, - moins bon.'
  ),

  // \u2500 Marktwert agent-note labels \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // Stable IDs come from the agent files (e.g. 'placement stddev'), the
  // frontend maps them to these human-readable, localized strings.
  'tft.marketValue.note.avgPlacement': t6(
    '\u00D8 Platzierung', 'Avg placement',
    '\uD3C9\uADE0 \uB4F1\uC218', '\u5E73\u5747\u540D\u6B21',
    'Posici\u00F3n media', 'Placement moyen'
  ),
  'tft.marketValue.note.top4Rate': t6(
    'Top-4-Quote', 'Top-4 rate',
    'Top-4 \uBE44\uC728', 'Top-4 \u6BD4\u7387',
    'Tasa Top-4', 'Taux Top-4'
  ),
  'tft.marketValue.note.top1Rate': t6(
    'Sieg-Quote', 'Win rate',
    '1\uC704 \uBE44\uC728', '\u5403\u9E21\u7387',
    'Tasa de victorias', 'Taux de victoire'
  ),
  'tft.marketValue.note.compDiversity': t6(
    'Comp-Vielfalt', 'Comp diversity',
    '\uB371 \uB2E4\uC591\uC131', '\u9635\u5BB9\u591A\u6837\u6027',
    'Diversidad de comp', 'Diversit\u00E9 de comp'
  ),
  'tft.marketValue.note.metaPicks': t6(
    'meta picks', 'meta picks',
    '\uBA54\uD0C0 \uD53D', '\u4E3B\u6D41\u9635\u5BB9',
    'picks meta', 'picks m\u00E9ta'
  ),
  'tft.marketValue.note.oneTrickPenalty': t6(
    'One-Trick-Abzug', 'One-trick penalty',
    '\uC6D0\uD2B8\uB9AD \uAC10\uC810', '\u5355\u4E00\u9635\u5BB9\u6263\u5206',
    'Penalizaci\u00F3n one-trick', 'P\u00E9nalit\u00E9 one-trick'
  ),
  'tft.marketValue.note.offMeta': t6(
    'Off-Meta', 'Off-meta',
    '\uBE44\uBA54\uD0C0', '\u975E\u4E3B\u6D41',
    'Fuera del meta', 'Hors m\u00E9ta'
  ),
  'tft.marketValue.note.itemSlam': t6(
    'Items gut getroffen', 'Items on point',
    '\uC544\uC774\uD15C \uC801\uC911', '\u88C5\u5907\u547D\u4E2D',
    '\u00CDtems acertados', 'Items bien plac\u00E9s'
  ),
  'tft.marketValue.note.prismaticShare': t6(
    'Prismatic-Quote', 'Prismatic share',
    '\uD504\uB9AC\uC988\uB9C8\uD2F1 \uBE44\uC728', '\u68F1\u5F69\u6BD4\u7387',
    'Cuota prism\u00E1tica', 'Part prismatique'
  ),
  'tft.marketValue.note.placementStddev': t6(
    'Platzierungs-Stabilit\u00E4t', 'Placement stability',
    '\uC21C\uC704 \uC548\uC815\uC131', '\u540D\u6B21\u7A33\u5B9A\u6027',
    'Estabilidad de posici\u00F3n', 'Stabilit\u00E9 du placement'
  ),
  'tft.marketValue.note.top4Streak': t6(
    'Top-4-Serie', 'Top-4 streak',
    'Top-4 \uC5F0\uC18D', 'Top-4 \u8FDE\u80DC',
    'Racha Top-4', 'S\u00E9rie Top-4'
  ),
  'tft.marketValue.note.bottom4Share': t6(
    'Bottom-4-Quote', 'Bottom-4 rate',
    '\uD558\uC704 4 \uBE44\uC728', '\u4E0B\u534A\u533A\u6BD4\u7387',
    'Tasa Bottom-4', 'Taux Bottom-4'
  ),
  'tft.marketValue.note.tooFewMatches': t6(
    'Zu wenige Matches', 'Too few matches',
    '\uACBD\uAE30 \uBD80\uC871', '\u6BD4\u8D5B\u8FC7\u5C11',
    'Pocas partidas', 'Trop peu de matchs'
  ),
  // flexMastery
  'tft.marketValue.note.flexMastery': t6(
    'Flex-Komposition', 'Flex comp pool',
    '\uD50C\uB809\uC2A4 \uB371', '\u7075\u6D3B\u9635\u5BB9',
    'Pool flex', 'Pool flex'
  ),
  'tft.marketValue.note.oneTrickMastery': t6(
    'One-Trick-Meisterschaft', 'One-trick mastery',
    '\uC6D0\uD2B8\uB9AD \uB9C8\uC2A4\uD130', '\u5355\u4E00\u7CBE\u901A',
    'Maestr\u00EDa one-trick', 'Ma\u00EEtrise one-trick'
  ),
  'tft.marketValue.note.flexNoSubstance': t6(
    'Flex ohne Resultate', 'Flex without results',
    '\uACB0\uACFC \uC5C6\uB294 \uD50C\uB809\uC2A4', '\u7075\u6D3B\u4F46\u7F3A\u4E4F\u6210\u679C',
    'Flex sin resultados', 'Flex sans r\u00E9sultats'
  ),
  'tft.marketValue.note.carryDiversity': t6(
    'Carry-Vielfalt', 'Carry diversity',
    '\uCE90\uB9AC \uB2E4\uC591\uC131', '\u4E3B\u529B\u591A\u6837\u6027',
    'Diversidad de carry', 'Diversit\u00E9 de carry'
  ),
  'tft.marketValue.note.narrowCarryPool': t6(
    'Schmaler Carry-Pool', 'Narrow carry pool',
    '\uC81C\uD55C\uB41C \uCE90\uB9AC \uD480', '\u4E3B\u529B\u6C60\u7A84',
    'Pool de carry limitado', 'Pool de carry limit\u00E9'
  ),
  // gameSense
  'tft.marketValue.note.lateExit': t6(
    'Sp\u00E4tes Ausscheiden', 'Late exit',
    '\uD6C4\uBC18 \uC9C4\uCD9C', '\u540E\u671F\u51FA\u5C40',
    'Salida tard\u00EDa', 'Sortie tardive'
  ),
  'tft.marketValue.note.earlyExit': t6(
    'Fr\u00FChes Ausscheiden', 'Early exit',
    '\uCD08\uBC18 \uD0C8\uB77D', '\u524D\u671F\u51FA\u5C40',
    'Salida temprana', 'Sortie pr\u00E9coce'
  ),
  'tft.marketValue.note.ecoMastery': t6(
    'Eco-Effizienz', 'Eco mastery',
    '\uACBD\uC81C \uC6B4\uC601', '\u7ECF\u6D4E\u7CBE\u901A',
    'Maestr\u00EDa econ\u00F3mica', 'Ma\u00EEtrise \u00E9co'
  ),
  'tft.marketValue.note.unspentGold': t6(
    'Ungenutztes Gold', 'Unspent gold',
    '\uBBF8\uC0AC\uC6A9 \uACE8\uB4DC', '\u672A\u4F7F\u7528\u91D1\u5E01',
    'Oro sin usar', 'Or non d\u00E9pens\u00E9'
  ),
  // Detail-string fragments \u2014 agents emit detail strings like "6 in a row"
  // or "67% recommended"; the frontend pattern-matches and swaps the
  // English fragment for the localized one.
  'tft.marketValue.note.detail.inARow': t6(
    'in Folge', 'in a row',
    '\uC5F0\uC18D', '\u8FDE\u80DC',
    'seguidas', "d'affil\u00E9e"
  ),
  'tft.marketValue.note.detail.recommended': t6(
    'empfohlen', 'recommended',
    '\uCD94\uCC9C', '\u63A8\u8350',
    'recomendados', 'recommand\u00E9s'
  ),
  'tft.marketValue.note.detail.inTop10': t6(
    'in Top-10', 'in top-10',
    'Top-10 \uC548', 'Top-10 \u5185',
    'en top-10', 'dans top-10'
  ),
  'tft.marketValue.note.detail.oneComp': t6(
    'gleiche Comp', 'one comp',
    '\uAC19\uC740 \uB371', '\u76F8\u540C\u9635\u5BB9',
    'la misma comp', 'm\u00EAme comp'
  ),
  'tft.marketValue.note.detail.compsUnit': t6(
    'Comps', 'comps',
    '\uB371', '\u9635\u5BB9',
    'comps', 'comps'
  ),
  'tft.marketValue.note.detail.leftover': t6(
    'Restgold', 'leftover',
    '\uC794\uC5EC', '\u5269\u4F59',
    'restante', 'restant'
  ),
  'tft.marketValue.note.detail.carries': t6(
    'Carries', 'carries',
    '\uCE90\uB9AC', '\u4E3B\u529B',
    'carries', 'carries'
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
  'tft.marketValue.tab.teams': t6(
    'Teams', 'Teams', '\uD300', '\u6218\u961F', 'Equipos', '\u00C9quipes'
  ),
  'tft.marketValue.tab.distribution': t6(
    'Verteilung', 'Distribution',
    '\uBD84\uD3EC', '\u5206\u5E03',
    'Distribuci\u00F3n', 'R\u00E9partition'
  ),
  'tft.marketValue.teams.empty': t6(
    'Noch keine Team-Marktwerte verf\u00FCgbar.',
    'No team market values available yet.',
    '\uD300 \uC2DC\uC7A5 \uAC00\uCE58\uAC00 \uC544\uC9C1 \uC5C6\uC2B5\uB2C8\uB2E4.',
    '\u6682\u65E0\u6218\u961F\u5E02\u573A\u4EF7\u503C\u3002',
    'A\u00FAn no hay valores de mercado por equipo.',
    'Pas encore de valeurs de march\u00E9 par \u00E9quipe.'
  ),
  'tft.marketValue.teams.players': t6('Spieler', 'players', '\uC120\uC218', '\u540D\u73A9\u5BB6', 'jugadores', 'joueurs'),
  'tft.onetricks.title': t6('One-Tricks der Region', 'Regional One-Tricks', '\uC9C0\uC5ED \uC6D0\uD2B8\uB9AD', '\u533A\u57DF\u4E13\u7CBE\u73A9\u5BB6', 'One-Tricks regionales', 'One-Tricks de la r\u00E9gion'),
  'tft.onetricks.subtitle': t6(
    'High-Elo Spieler, deren Top-2 Comps \u226560% ihrer letzten Spiele ausmachen.',
    'High-elo players whose top-2 comps make up \u226560% of their recent games.',
    '\uCD5C\uADFC \uAC8C\uC784\uC758 60% \uC774\uC0C1\uC744 \uC0C1\uC704 2\uAC1C \uC870\uD569\uC5D0 \uC9D1\uC911\uD558\uB294 \uACE0\uD2F0\uC5B4 \uD50C\uB808\uC774\uC5B4.',
    '\u8FD1\u671F60%\u4EE5\u4E0A\u573A\u6B21\u96C6\u4E2D\u5728\u4E24\u5957\u9635\u5BB9\u7684\u9AD8\u5206\u73A9\u5BB6\u3002',
    'Jugadores de alto elo cuyas 2 comps principales suman \u226560% de sus partidas.',
    'Joueurs haut elo dont les 2 comps pr\u00E9f\u00E9r\u00E9es d\u00E9passent 60% de leurs parties.'
  ),
  'tft.onetricks.empty': t6(
    'Keine One-Tricks in dieser Region gefunden \u2014 entweder gibt es noch nicht genug Match-Cache-Daten oder die Top-Spieler spielen zu diverse Comps.',
    'No one-tricks found for this region yet \u2014 either match cache is sparse or top players play too diverse a comp set.',
    '\uC774 \uC9C0\uC5ED\uC5D0\uC11C \uC6D0\uD2B8\uB9AD\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.',
    '\u6B64\u533A\u57DF\u6682\u672A\u627E\u5230\u4E13\u7CBE\u73A9\u5BB6\u3002',
    'No se encontraron one-tricks en esta regi\u00F3n.',
    'Aucun one-trick trouv\u00E9 pour cette r\u00E9gion.'
  ),
  'tft.onetricks.specialty': t6('Spezialisierung', 'specialty', '\uC804\uBB38\uD654', '\u4E13\u7CBE', 'especialidad', 'sp\u00E9cialit\u00E9'),
  'tft.rising.title': t6('Aufsteiger', 'Rising Players', '\uAE09\uC0C1\uC2B9 \uD50C\uB808\uC774\uC5B4', '\u4E0A\u5347\u6700\u5FEB\u7684\u73A9\u5BB6', 'Jugadores en ascenso', 'Joueurs en progression'),
  'tft.rising.days1': t6('1 Tag', '1 Day', '1\uC77C', '1\u5929', '1 d\u00EDa', '1 jour'),
  'tft.rising.days3': t6('3 Tage', '3 Days', '3\uC77C', '3\u5929', '3 d\u00EDas', '3 jours'),
  'tft.rising.days5': t6('5 Tage', '5 Days', '5\uC77C', '5\u5929', '5 d\u00EDas', '5 jours'),
  'tft.rising.placements': t6('Platzierungen', 'Placements', '\uC21C\uC704 \uBD84\uD3EC', '\u540D\u6B21\u5206\u5E03', 'Posiciones', 'Placements'),
  'tft.rising.compsPlayed': t6('Gespielte Comps', 'Comps played', '\uD50C\uB808\uC774\uD55C \uC870\uD569', '\u4F7F\u7528\u9635\u5BB9\u6570', 'Comps jugadas', 'Comps jou\u00E9es'),
  'tft.rising.topCompRate': t6('Anteil Top-Comp', 'Top comp playrate', '\uC8FC\uB825 \uC870\uD569 \uBE44\uC728', '\u4E3B\u529B\u9635\u5BB9\u5360\u6BD4', 'Uso de la comp principal', 'Taux de la comp principale'),
  'tft.rising.playstyle': t6('Spielstil', 'Playstyle', '\uD50C\uB808\uC774 \uC2A4\uD0C0\uC77C', '\u73A9\u6CD5\u98CE\u683C', 'Estilo de juego', 'Style de jeu'),
  'tft.rising.style.oneTrick': t6('One-Trick', 'One-trick', '\uC6D0\uD2B8\uB9AD', '\u4E13\u7CBE', 'One-trick', 'One-trick'),
  'tft.rising.style.default': t6('Stamm-Comp', 'Default comp', '\uAE30\uBCF8 \uC870\uD569', '\u56FA\u5B9A\u9635\u5BB9', 'Comp habitual', 'Comp habituelle'),
  'tft.rising.style.flexible': t6('Flexibel', 'Flexible', '\uC720\uC5F0\uD568', '\u7075\u6D3B', 'Flexible', 'Flexible'),
  'tft.rising.topComp': t6('Meistgespielte Comp', 'Most played comp', '\uAC00\uC7A5 \uB9CE\uC774 \uD50C\uB808\uC774\uD55C \uC870\uD569', '\u6700\u5E38\u7528\u9635\u5BB9', 'Comp m\u00E1s jugada', 'Comp la plus jou\u00E9e'),
  'tft.twitchLive.title': t6('Jetzt live auf Twitch', 'Live now on Twitch', '\uD2B8\uC704\uCE58 \uC2E4\uC2DC\uAC04 \uBC29\uC1A1', 'Twitch \u76F4\u64AD\u4E2D', 'En vivo en Twitch', 'En direct sur Twitch'),
  'tft.tournamentWatch.title': t6('Aktuelle Turniere', 'Live tournaments', '\uC9C4\uD589 \uC911\uC778 \uB300\uD68C', '\u6B63\u5728\u8FDB\u884C\u7684\u8D5B\u4E8B', 'Torneos en vivo', 'Tournois en direct'),
  'tft.tournamentWatch.live': t6('LIVE', 'LIVE', 'LIVE', '\u76F4\u64AD\u4E2D', 'EN VIVO', 'EN DIRECT'),
  // Stoerungs-Banner (app/components/tft/RiotStatusBanner.tsx). Hinter dem Text
  // stehen die betroffenen Regionen als Kuerzel, deshalb endet er offen.
  'tft.riotStatus.warning': t6(
    'Riot meldet St\u00F6rungen:',
    'Riot reports issues:',
    'Riot \uC7A5\uC560 \uBCF4\uACE0:',
    'Riot \u62A5\u544A\u6545\u969C\uFF1A',
    'Riot informa incidencias:',
    'Riot signale des incidents :',
  ),
  'tft.riotStatus.critical': t6(
    'Riot meldet schwere St\u00F6rungen:',
    'Riot reports major issues:',
    'Riot \uC2EC\uAC01\uD55C \uC7A5\uC560 \uBCF4\uACE0:',
    'Riot \u62A5\u544A\u4E25\u91CD\u6545\u969C\uFF1A',
    'Riot informa incidencias graves:',
    'Riot signale des incidents majeurs :',
  ),
  'tft.comp.editorialTiers': t6('Editorial-Tier-Lists', 'Editorial tier lists', '\uC5D0\uB514\uD1A0\uB9AC\uC5BC \uD2F0\uC5B4\uB9AC\uC2A4\uD2B8', '\u7F16\u8F91\u7CBE\u9009\u699C\u5355', 'Listas editoriales', 'Tier lists \u00E9ditoriales'),
  'tft.comp.flexScore': t6('Flex-Score', 'Flex score', '유연성 점수', '灵活性评分', 'Puntuación Flex', 'Score flex'),
  'tft.comp.flex.flexible': t6('Sehr flexibel', 'Very flexible', '매우 유연함', '非常灵活', 'Muy flexible', 'Très flexible'),
  'tft.comp.flex.adaptive': t6('Anpassungsfähig', 'Adaptive', '적응형', '可调整', 'Adaptable', 'Adaptable'),
  'tft.comp.flex.locked': t6('Locked-in', 'Locked-in', '고정', '锁定', 'Fija', 'Verrouillée'),
  'tft.patchWinners.title': t6('Patch-Winner & Loser', 'Patch winners & losers', '패치 우승자 & 패배자', '版本胜者 & 败者', 'Ganadores y Perdedores del Parche', 'Gagnants & Perdants du Patch'),
  'tft.patchWinners.subtitle': t6(
    'Größte Schwankungen zwischen den letzten zwei Patches.',
    'Biggest swings between the last two patches.',
    '최근 두 패치 사이의 가장 큰 변화.',
    '最近两个版本之间的最大变化。',
    'Mayores cambios entre los dos últimos parches.',
    'Plus gros écarts entre les deux derniers patchs.'
  ),
  'tft.patchWinners.winners': t6('Aufsteiger', 'Winners', '상승', '上升', 'Ganadores', 'Gagnants'),
  'tft.patchWinners.losers': t6('Absteiger', 'Losers', '하락', '下降', 'Perdedores', 'Perdants'),
  'tft.patchWinners.swingChart': t6('Größte Veränderungen', 'Biggest swings', '가장 큰 변화', '最大变动', 'Mayores cambios', 'Plus grands écarts'),
  'tft.patchWinners.swing': t6('Ø-Platzierungs-Schwung', 'Avg-placement swing', '평균 순위 변화', '平均名次变动', 'Cambio de posición media', 'Variation du classement moyen'),
  'tft.patchWinners.swingHint': t6('Rechts/grün = verbessert · Links/rot = verschlechtert', 'Right/green = improved · Left/red = worse', '오른쪽/녹색 = 개선 · 왼쪽/빨강 = 악화', '右/绿=变强 · 左/红=变弱', 'Derecha/verde = mejoró · Izquierda/rojo = empeoró', 'Droite/vert = amélioré · Gauche/rouge = pire'),
  'tft.patchWinners.empty': t6(
    'Noch keine Patch-Vergleichsdaten — der vorherige Patch wird nach 2 Tagen Daten sichtbar.',
    'No patch comparison data yet — previous patch appears after ~2 days of data.',
    '아직 패치 비교 데이터가 없습니다.',
    '暂无版本对比数据。',
    'Aún no hay datos de comparación de parches.',
    'Pas encore de comparaison de patchs disponible.'
  ),
  'tft.comp.editorialTiers.intro': t6(
    'Was andere Tools zu dieser Comp sagen \u2014 vergleiche mit unseren Daten.',
    'What other tools say about this comp \u2014 compare against our data.',
    '\uB2E4\uB978 \uBD84\uC11D \uC0AC\uC774\uD2B8\uC758 \uD3C9\uAC00\uC640 \uBE44\uAD50\uD574 \uBCF4\uC138\uC694.',
    '\u5176\u4ED6\u5E73\u53F0\u5BF9\u6B64\u9635\u5BB9\u7684\u8BC4\u4EF7\u2014\u2014\u4E0E\u6211\u4EEC\u7684\u6570\u636E\u5BF9\u6BD4\u3002',
    'Lo que dicen otras herramientas \u2014 compara con nuestros datos.',
    'Ce que disent les autres outils \u2014 compare avec nos donn\u00E9es.'
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
  'tft.marketValue.col.trend': t6(
    'Trend (14T)', 'Trend (14d)', '\uCD94\uC138 (14\uC77C)', '\u8D8B\u52BF (14\u5929)', 'Tendencia (14d)', 'Tendance (14j)'
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
  'tft.compare.placements': t6(
    'Platzierungen', 'Placements', '\uC21C\uC704 \uBD84\uD3EC', '\u540D\u6B21\u5206\u5E03', 'Posiciones', 'Classements'
  ),
  'tft.compare.place': t6(
    'Platz', 'Place', '\uC21C\uC704', '\u540D\u6B21', 'Puesto', 'Place'
  ),
  'tft.compare.form': t6(
    'Form (letzte 20 Spiele)', 'Form (last 20 games)', '\uCD5C\uADFC \uD3FC (\uCD5C\uADFC 20\uACBD\uAE30)', '\u8FD1\u671F\u72B6\u6001\uFF08\u6700\u8FD1 20 \u573A\uFF09', 'Forma (\u00FAltimas 20 partidas)', 'Forme (20 derniers matchs)'
  ),
  'tft.compare.history': t6(
    'Verlauf (30 Tage)', 'Trend (30 days)', '\uCD94\uC774 (30\uC77C)', '\u8D70\u52BF\uFF0830 \u5929\uFF09', 'Evoluci\u00F3n (30 d\u00EDas)', '\u00C9volution (30 jours)'
  ),
  'tft.compare.factors': t6(
    'Marktwert-Faktoren', 'Market value factors', '\uC2DC\uC7A5 \uAC00\uCE58 \uC694\uC778', '\u5E02\u573A\u4EF7\u503C\u56E0\u7D20', 'Factores del valor de mercado', 'Facteurs de la valeur marchande'
  ),
  'tft.compare.categoryWins': t6(
    'Kategorie-Siege', 'Category wins', '\uBD80\uBB38\uBCC4 \uC6B0\uC704', '\u5206\u9879\u80DC\u51FA', 'Categor\u00EDas ganadas', 'Cat\u00E9gories remport\u00E9es'
  ),
  'tft.compare.keyStats': t6(
    'Kennzahlen', 'Key stats', '\uD575\uC2EC \uC9C0\uD45C', '\u6838\u5FC3\u6570\u636E', 'Estad\u00EDsticas clave', 'Statistiques cl\u00E9s'
  ),
  'tft.compare.topTraits': t6(
    'Meistgespielte Synergien', 'Most played traits', '\uAC00\uC7A5 \uB9CE\uC774 \uC0AC\uC6A9\uD55C \uC2DC\uB108\uC9C0', '\u6700\u5E38\u7528\u7F81\u7ECA', 'Sinergias m\u00E1s jugadas', 'Synergies les plus jou\u00E9es'
  ),
  'tft.compare.units': t6(
    'Meistgespielte Champions', 'Most played champions', '\uAC00\uC7A5 \uB9CE\uC774 \uC0AC\uC6A9\uD55C \uCC54\uD53C\uC5B8', '\u6700\u5E38\u7528\u82F1\u96C4', 'Campeones m\u00E1s jugados', 'Champions les plus jou\u00E9s'
  ),
  'tft.compare.levelEnd': t6(
    'Level bei Spielende', 'Level at game end', '\uAC8C\uC784 \uC885\uB8CC \uC2DC \uB808\uBCA8', '\u5BF9\u5C40\u7ED3\u675F\u65F6\u7B49\u7EA7', 'Nivel al final de la partida', 'Niveau en fin de partie'
  ),
  'tft.compare.playstyle': t6(
    'Spielstil', 'Playstyle', '\uD50C\uB808\uC774 \uC2A4\uD0C0\uC77C', '\u6E38\u620F\u98CE\u683C', 'Estilo de juego', 'Style de jeu'
  ),
  'tft.compare.setRanks': t6(
    'Rang je Set', 'Rank per set', '\uC138\uD2B8\uBCC4 \uB7AD\uD06C', '\u5404\u8D5B\u5B63\u6BB5\u4F4D', 'Rango por set', 'Rang par set'
  ),
  'tft.compare.sharedLobbies': t6(
    'Gemeinsame Lobbys', 'Shared lobbies', '\uAC19\uC740 \uB85C\uBE44 \uACBD\uAE30', '\u540C\u573A\u5BF9\u5C40', 'Partidas compartidas', 'Parties communes'
  ),
  'tft.compare.avgLastRound': t6(
    '\u00D8 letzte Runde', 'Avg. last round', '\uD3C9\uADE0 \uB9C8\uC9C0\uB9C9 \uB77C\uC6B4\uB4DC', '\u5E73\u5747\u6700\u540E\u56DE\u5408', '\u00D8 \u00FAltima ronda', '\u00D8 dernier round'
  ),
  'tft.compare.addPlayer': t6(
    'Spieler hinzuf\u00FCgen', 'Add player', '\uD50C\uB808\uC774\uC5B4 \uCD94\uAC00', '\u6DFB\u52A0\u73A9\u5BB6', 'A\u00F1adir jugador', 'Ajouter un joueur'
  ),
  'tft.compare.remove': t6(
    'Entfernen', 'Remove', '\uC0AD\uC81C', '\u79FB\u9664', 'Quitar', 'Retirer'
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
  'tft.trait.activationCurve': t6(
    'Aktivierungskurve', 'Activation curve',
    '\uD65C\uC131\uD654 \uACE1\uC120', '\u6FC0\u6D3B\u66F2\u7EBF',
    'Curva de activaci\u00F3n', 'Courbe d\'activation'
  ),
  'tft.trait.unitCountCurve': t6(
    '\u00D8-Platzierung pro Unit-Anzahl', 'Avg placement by unit count',
    '\uC720\uB2DB \uC218\uBCC4 \uD3C9\uADE0 \uC21C\uC704', '\u6309\u5355\u4F4D\u6570\u7684\u5E73\u5747\u540D\u6B21',
    'Posici\u00F3n media por n\u00BA de unidades', 'Classement moyen par nombre d\'unit\u00E9s'
  ),
  'tft.trait.unitCountHint': t6(
    'Lohnt sich Overcapping? Mehr Units desselben Traits als der Breakpoint verlangt.',
    'Does overcapping help? More units of the trait than the breakpoint needs.',
    '\uC624\uBC84\uCEA1\uC774 \uB3C4\uC6C0\uC774 \uB420\uAE4C\uC694? \uBE0C\uB808\uC774\uD06C\uD3EC\uC778\uD2B8\uBCF4\uB2E4 \uB9CE\uC740 \uC720\uB2DB.',
    '\u53E0\u6EE1\u662F\u5426\u6709\u76CA\uFF1F\u540C\u7279\u8D28\u5355\u4F4D\u6570\u8D85\u8FC7\u6FC0\u6D3B\u70B9\u3002',
    '\u00BFVale la pena sobrepasar? M\u00E1s unidades del rasgo de las que pide el breakpoint.',
    'Le surplus paie-t-il ? Plus d\'unit\u00E9s du trait que le palier n\'exige.'
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
  'tft.comp.withSecondary': t6(
    '(mit {name})', '(with {name})',
    '({name} \uD3EC\uD568)', '(\u542B {name})',
    '(con {name})', '(avec {name})'
  ),
  'tft.comp.build.tank': t6(
    'Tank-Variante', 'Tank build',
    '\uD0F1\uCEE4 \uBE4C\uB4DC', '\u5766\u514B\u6D41',
    'Build de tanque', 'Build tank'
  ),
  'tft.comp.build.bruiser': t6(
    'Bruiser-Variante', 'Bruiser build',
    '\uBE0C\uB8E8\uC800 \uBE4C\uB4DC', '\u6218\u58EB\u6D41',
    'Build bruiser', 'Build bruiser'
  ),
  'tft.comp.topItemSets': t6(
    'H\u00E4ufigste Item-Sets am Carry', 'Most Common Item Sets on Carry',
    '\uCE90\uB9AC \uCD5C\uB2E4 \uC544\uC774\uD15C \uC138\uD2B8', '\u4E3BC\u6700\u5E38\u7528\u88C5\u5907\u7EC4\u5408',
    'Sets de \u00CDtems m\u00E1s comunes en el Carry', 'Sets d\'objets les plus utilis\u00E9s sur le Carry'
  ),
  'tft.comp.componentPriority': t6(
    'Bauteil-Priorit\u00E4t (Carousel)', 'Component Priority (Carousel)',
    '\uCEF4\uD3EC\uB10C\uD2B8 \uC6B0\uC120\uC21C\uC704 (\uCE90\uB7EC\uC140)', '\u7EC4\u4EF6\u4F18\u5148\u7EA7 (\u8F6C\u76D8)',
    'Prioridad de Componentes (Carrusel)', 'Priorit\u00E9 des composants (carrousel)'
  ),
  'tft.comp.componentInItems': t6(
    'verbaut in', 'used in',
    '\uC0AC\uC6A9 \uCC98', '\u7528\u4E8E',
    'usado en', 'utilis\u00E9 dans'
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
  'tft.comp.flexUnits.title': t6(
    'Flex Slots', 'Flex Slots',
    '\uD50C\uB809\uC2A4 \uC2AC\uB86F', '\u673A\u52A8\u4F4D',
    'Espacios Flex', 'Emplacements Flex'
  ),
  // Levelplan. MetaTFT liefert die Strategie als Kuerzel ("lvl 6", "Fast 8"),
  // das mechanisch in die falsche Richtung liest: "lvl 6" heisst nicht "auf 6
  // leveln", sondern "auf 6 bleiben und rerollen". Deshalb ausgeschrieben.
  'tft.comp.levelling': t6(
    'Levelplan', 'Levelling plan',
    '레벨링 계획', '升级路线',
    'Plan de niveles', 'Plan de niveaux'
  ),
  'tft.comp.levelling.reroll': t6(
    'Level {level} Reroll', 'Level {level} reroll',
    '{level}레벨 리롤', '{level} 级 Reroll',
    'Reroll en nivel {level}', 'Reroll au niveau {level}'
  ),
  'tft.comp.levelling.fast': t6(
    'Schnell auf Level {level}', 'Fast to level {level}',
    '빠르게 {level}레벨', '快速 {level} 级',
    'Subir rápido a nivel {level}', 'Montée rapide au niveau {level}'
  ),
  'tft.comp.levelling.standard': t6(
    'Standard-Kurve', 'Standard curve',
    '표준 진행', '标准节奏',
    'Curva estándar', 'Courbe standard'
  ),
  'tft.comp.levelling.step': t6(
    'Lv {level}', 'Lv {level}',
    '{level}레벨', '{level} 级',
    'Nv {level}', 'Niv {level}'
  ),
  'tft.comp.levelOutcome': t6(
    'Trait-Aktivierung \u2014 Performance pro Stufe',
    'Trait activation \u2014 performance per tier',
    '\uD2B9\uC131 \uD65C\uC131\uD654 \u2014 \uB2E8\uACC4\uBCC4 \uC131\uACFC',
    '\u7F81\u7ECA\u6FC0\u6D3B \u2014 \u5404\u7B49\u7EA7\u8868\u73B0',
    'Activaci\u00F3n de rasgo \u2014 rendimiento por nivel',
    'Activation de trait \u2014 performance par palier'
  ),
  'tft.comp.levelOutcome.activation': t6(
    'Aktivierung {n}', 'Tier {n}',
    '{n}\uB2E8\uACC4', '{n} \u7EA7',
    'Nivel {n}', 'Palier {n}'
  ),
  'tft.comp.levelOutcome.star3Share': t6(
    '{pct}% mit 3\u2605-Carry', '{pct}% with 3\u2605 carry',
    '{pct}% 3\uC131 \uCE90\uB9AC', '{pct}% \u4E09\u661F\u6838\u5FC3',
    '{pct}% con carry 3\u2605', '{pct}% avec carry 3\u2605'
  ),
  'tft.comp.levelOutcome.units': t6(
    'Units', 'units',
    '\uC720\uB2DB', '\u5355\u4F4D',
    'unidades', 'unit\u00E9s'
  ),
  'tft.comp.outcome.placement': t6('Platzverteilung', 'Placement distribution', '\uC21C\uC704 \uBD84\uD3EC', '\u540D\u6B21\u5206\u5E03', 'Distribuci\u00F3n de puestos', 'R\u00E9partition des places'),
  'tft.comp.outcome.items': t6('Items je Unit', 'Items per unit', '\uC720\uB2DB\uBCC4 \uC544\uC774\uD15C', '\u5404\u68CB\u5B50\u88C5\u5907', 'Objetos por unidad', 'Objets par unit\u00E9'),
  'tft.comp.outcome.item': t6('Item', 'Item', '\uC544\uC774\uD15C', '\u88C5\u5907', 'Objeto', 'Objet'),
  'tft.comp.outcome.share': t6('Anteil', 'Share', '\uBE44\uC728', '\u5360\u6BD4', 'Cuota', 'Part'),
  'tft.comp.outcome.effect': t6('Wirkung', 'Impact', '\uC601\uD5A5', '\u5F71\u54CD', 'Impacto', 'Impact'),
  'tft.comp.outcome.grade': t6('Stufe', 'Grade', '\uB4F1\uAE09', '\u8BC4\u7EA7', 'Nivel', 'Niveau'),
  'tft.comp.outcome.grade.core': t6('Kern', 'Core', '\uD575\uC2EC', '\u6838\u5FC3', 'N\u00FAcleo', 'C\u0153ur'),
  'tft.comp.outcome.grade.strong': t6('Stark', 'Strong', '\uAC15\uD568', '\u5F3A\u52BF', 'Fuerte', 'Fort'),
  'tft.comp.outcome.grade.optional': t6('Optional', 'Optional', '\uC120\uD0DD', '\u53EF\u9009', 'Opcional', 'Optionnel'),
  'tft.comp.outcome.grade.weak': t6('Schwach', 'Weak', '\uC57D\uD568', '\u5F31\u52BF', 'D\u00E9bil', 'Faible'),
  'tft.comp.outcome.group.standard': t6('Standard', 'Standard', '\uC77C\uBC18', '\u666E\u901A', 'Est\u00E1ndar', 'Standard'),
  'tft.comp.outcome.group.artifact': t6('Artefakte', 'Artifacts', '\uC720\uBB3C', '\u795E\u5668', 'Artefactos', 'Artefacts'),
  'tft.comp.outcome.group.radiant': t6('Strahlend', 'Radiant', '\uCC2C\uB780\uD55C', '\u5149\u660E', 'Radiantes', 'Radieux'),
  'tft.comp.outcome.group.emblem': t6('Embleme', 'Emblems', '\uC0C1\uC9D5', '\u7EB9\u7AE0', 'Emblemas', 'Embl\u00E8mes'),
  'tft.comp.outcome.group.tactician': t6('Taktiker', 'Tactician', '\uC804\uB7B5\uAC00', '\u6307\u6325\u5B98', 'Estratega', 'Tacticien'),
  'tft.comp.outcome.combos': t6('3er-Kombis', '3-item combos', '3\uC544\uC774\uD15C \uC870\uD569', '\u4E09\u4EF6\u5957\u7EC4\u5408', 'Combos de 3 objetos', 'Combos de 3 objets'),
  'tft.comp.outcome.unitEffect': t6('Unit-Wirkung', 'Unit impact', '\uC720\uB2DB \uC601\uD5A5', '\u68CB\u5B50\u5F71\u54CD', 'Impacto por unidad', 'Impact par unit\u00E9'),
  'tft.comp.outcome.presence': t6('Pr\u00E4senz', 'Presence', '\uCC44\uC6A9\uB960', '\u51FA\u573A\u7387', 'Presencia', 'Pr\u00E9sence'),
  'tft.comp.outcome.endLevel': t6('Endlevel', 'Final level', '\uCD5C\uC885 \uB808\uBCA8', '\u6700\u7EC8\u7B49\u7EA7', 'Nivel final', 'Niveau final'),
  'tft.comp.outcome.level': t6('Level', 'Level', '\uB808\uBCA8', '\u7B49\u7EA7', 'Nivel', 'Niveau'),
  'tft.comp.outcome.lowData': t6('wenig Daten', 'little data', '\uB370\uC774\uD130 \uBD80\uC871', '\u6570\u636E\u8F83\u5C11', 'pocos datos', 'peu de donn\u00E9es'),
  'tft.comp.outcome.avgShort': t6('Ø', 'Avg', '평균', '平均', 'Media', 'Moy.'),
  'tft.comp.familyMode.banner': t6(
    'Familien-Ansicht \u2014 Stats \u00FCber alle Build-Varianten gemittelt',
    'Family view \u2014 stats averaged across all build variants',
    '\uD328\uBC00\uB9AC \uBCF4\uAE30 \u2014 \uBAA8\uB4E0 \uBE4C\uB4DC \uBCC0\uD615 \uD1B5\uACC4 \uD3C9\uADE0',
    '\u65CF\u7CFB\u89C6\u56FE \u2014 \u6240\u6709\u53D8\u4F53\u52A0\u6743\u5E73\u5747',
    'Vista de familia \u2014 promedio sobre todas las variantes',
    'Vue Famille \u2014 moyenne sur toutes les variantes'
  ),
  'tft.comp.familyMode.toggleToExact': t6(
    '\u2192 Nur diese Variante',
    '\u2192 This variant only',
    '\u2192 \uC774 \uBCC0\uD615\uB9CC',
    '\u2192 \u4EC5\u6B64\u53D8\u4F53',
    '\u2192 Solo esta variante',
    '\u2192 Cette variante seulement'
  ),
  'tft.comp.familyMode.exactNotice': t6(
    'Du siehst nur diese eine Sub-Variante',
    'You see only this single sub-variant',
    '\uC774 \uC11C\uBE0C \uBCC0\uD615\uB9CC \uD45C\uC2DC',
    '\u4EC5\u663E\u793A\u8BE5\u5B50\u53D8\u4F53',
    'Solo ves esta \u00FAnica subvariante',
    'Vous voyez uniquement cette sous-variante'
  ),
  'tft.comp.familyMode.toggleToFamily': t6(
    '\u2192 Familien-Ansicht',
    '\u2192 Family view',
    '\u2192 \uD328\uBC00\uB9AC \uBCF4\uAE30',
    '\u2192 \u65CF\u7CFB\u89C6\u56FE',
    '\u2192 Vista de familia',
    '\u2192 Vue Famille'
  ),
  'tft.comp.flexUnits.pickrate': t6(
    'Pick', 'Pick',
    '\uD53D', '\u9009\u62E9',
    'Pick', 'Pick'
  ),
  'tft.comp.flexUnits.top1': t6(
    'Top1', 'Top1',
    'Top1', '\u7B2C\u4E00',
    'Top1', 'Top1'
  ),
  'tft.comp.flexUnits.avgPlc': t6(
    'Plc', 'Plc',
    '\uD3C9\uADE0', '\u540D\u6B21',
    'Pos', 'Pos'
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
  'tft.comp.augments': t6(
    'Empfohlene Augments', 'Recommended Augments',
    '\uCD94\uCC9C \uC99D\uAC15\uCCB4', '\u63A8\u8350\u5F3A\u5316',
    'Aumentos recomendados', 'Augmentations recommand\u00E9es'
  ),
  'tft.comp.moreVariants': t6(
    'Weitere Varianten', 'More variants',
    '\uB2E4\uB978 \uBCC0\uD615', '\u5176\u4ED6\u53D8\u4F53',
    'M\u00E1s variantes', 'Autres variantes'
  ),
  'tft.comp.mainVariant': t6(
    'Hauptvariante', 'Main variant',
    '\uC8FC\uC694 \uBCC0\uD615', '\u4E3B\u8981\u53D8\u4F53',
    'Variante principal', 'Variante principale'
  ),
  'tft.comp.topEmblems': t6(
    'Top Embleme', 'Top emblems',
    '\uC8FC\uC694 \uC5E0\uBE14\uB7FC', '\u4E3B\u8981\u5FBD\u7AE0',
    'Emblemas principales', 'Embl\u00E8mes principaux'
  ),
  'tft.comp.activeTraits': t6(
    'Aktive Synergien', 'Active Synergies',
    '\uD65C\uC131 \uC2DC\uB108\uC9C0', '\u6FC0\u6D3B\u7FC1\u7D46',
    'Sinergias activas', 'Synergies actives'
  ),
  'tft.comp.activeTraits.nextHint': t6(
    'noch {n} f\u00FCr n\u00E4chste Stufe', '{n} more to next tier',
    '\uB2E4\uC74C \uB2E8\uACC4\uAE4C\uC9C0 {n}', '\u8FD8\u9700{n}\u4E2A\u5230\u4E0B\u4E00\u7EA7',
    '{n} m\u00E1s para siguiente nivel', '{n} de plus pour le palier suivant'
  ),
  'tft.comp.activeTraits.contributors': t6(
    '{n} Units tragen bei', '{n} units contribute',
    '{n} \uC720\uB2DB \uAE30\uC5EC', '{n} \u4E2A\u5355\u4F4D\u8D21\u732E',
    '{n} unidades contribuyen', '{n} unit\u00E9s contribuent'
  ),
  'tft.comp.activeTraits.multiplicityStack': t6(
    'Zweite Kopie via Augment (\u00D72)', 'Second copy via augment (\u00D72)',
    '\uC99D\uAC15 \uD6A8\uACFC\uB85C \uB450 \uBC88\uC9F8 \uC0AC\uBCF8 (\u00D72)', '\u901A\u8FC7\u5F3A\u5316\u83B7\u5F97\u7B2C\u4E8C\u4EFD\u526F\u672C (\u00D72)',
    'Segunda copia v\u00EDa aumento (\u00D72)', 'Deuxi\u00E8me copie via augmentation (\u00D72)'
  ),
  'tft.comp.block.live': t6(
    'In der Runde', 'In Round',
    '\uB77C\uC6B4\uB4DC \uC911', '\u5BF9\u5C40\u4E2D',
    'En la ronda', 'En partie'
  ),
  'tft.comp.block.strategy': t6(
    'Strategie', 'Strategy',
    '\uC804\uB7B5', '\u7B56\u7565',
    'Estrategia', 'Strat\u00E9gie'
  ),
  'tft.comp.block.deep': t6(
    'Detail-Analyse', 'Deep Analysis',
    '\uC2EC\uCE35 \uBD84\uC11D', '\u6DF1\u5EA6\u5206\u6790',
    'An\u00E1lisis profundo', 'Analyse approfondie'
  ),
  'tft.trend.patchLine': t6(
    'Patch {p}', 'Patch {p}',
    '\uD328\uCE58 {p}', '\u7248\u672C {p}',
    'Parche {p}', 'Patch {p}'
  ),
  'tft.comp.lowSample': t6(
    'wenig Daten', 'low sample',
    '\uB370\uC774\uD130 \uBD80\uC871', '\u6837\u672C\u4E0D\u8DB3',
    'pocos datos', 'peu de donn\u00E9es'
  ),
  'tft.augment.compsPlayingThis': t6(
    'Comps mit diesem Augment', 'Comps using this Augment',
    '\uC774 \uC99D\uAC15\uCCB4\uB97C \uC0AC\uC6A9\uD558\uB294 \uC870\uD569', '\u4F7F\u7528\u6B64\u5F3A\u5316\u7684\u9635\u5BB9',
    'Comps con este aumento', 'Compositions avec cette augmentation'
  ),
  'tft.augment.compsPlayingThis.note': t6(
    'Kuratiert \u2014 keine Live-Stats. Riot exposiert keine Augment-Stats mehr.',
    'Curated \u2014 no live stats. Riot no longer exposes augment statistics.',
    '\uD050\uB808\uC774\uD305 \u2014 \uB77C\uC774\uBE0C \uD1B5\uACC4 \uC5C6\uC74C. Riot\uC740 \uB354 \uC774\uC0C1 \uC99D\uAC15 \uD1B5\uACC4\uB97C \uC81C\uACF5\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.',
    '\u7CBE\u9009 \u2014 \u65E0\u5B9E\u65F6\u6570\u636E\u3002Riot \u4E0D\u518D\u516C\u5F00\u5F3A\u5316\u6570\u636E\u3002',
    'Seleccionado \u2014 sin estad\u00EDsticas en vivo. Riot ya no expone estad\u00EDsticas de aumentos.',
    'S\u00E9lectionn\u00E9 \u2014 pas de statistiques en direct. Riot ne divulgue plus les statistiques d\'augmentation.'
  ),
  'tft.item.compsPlayingThis': t6(
    'Comps mit diesem Item', 'Comps using this Item',
    '\uC774 \uC544\uC774\uD15C\uC744 \uC0AC\uC6A9\uD558\uB294 \uC870\uD569', '\u4F7F\u7528\u6B64\u88C5\u5907\u7684\u9635\u5BB9',
    'Comps con este objeto', 'Compositions avec cet objet'
  ),
  'tft.compare.title': t6(
    'Comp-Vergleich', 'Comp Comparison',
    '\uC870\uD569 \uBE44\uAD50', '\u9635\u5BB9\u5BF9\u6BD4',
    'Comparaci\u00F3n de comps', 'Comparaison de comps'
  ),
  'tft.compare.pickTwo': t6(
    'Zwei Comps zum Vergleichen w\u00E4hlen', 'Pick two comps to compare',
    '\uBE44\uAD50\uD560 \uB450 \uC870\uD569 \uC120\uD0DD', '\u9009\u62E9\u4E24\u4E2A\u9635\u5BB9\u8FDB\u884C\u5BF9\u6BD4',
    'Elige dos comps para comparar', 'S\u00E9lectionnez deux comps \u00E0 comparer'
  ),
  'tft.compare.pickTwo.hint': t6(
    'URL-Format: ?a=<slug>&b=<slug>. Compare-Buttons auf der Comp-Liste folgen.',
    'URL format: ?a=<slug>&b=<slug>. Compare-buttons on the comp list coming soon.',
    'URL \uD615\uC2DD: ?a=<slug>&b=<slug>. \uC870\uD569 \uBAA9\uB85D \uBE44\uAD50 \uBC84\uD2BC\uC740 \uACE7 \uCD94\uAC00\uB429\uB2C8\uB2E4.',
    'URL \u683C\u5F0F: ?a=<slug>&b=<slug>\u3002\u9635\u5BB9\u5217\u8868\u7684\u5BF9\u6BD4\u6309\u94AE\u5373\u5C06\u63A8\u51FA\u3002',
    'Formato URL: ?a=<slug>&b=<slug>. Botones de comparaci\u00F3n en la lista pr\u00F3ximamente.',
    'Format URL : ?a=<slug>&b=<slug>. Boutons de comparaison \u00E0 venir.'
  ),
  'tft.compare.goToList': t6(
    'Zur Comp-Liste', 'Go to comp list',
    '\uC870\uD569 \uBAA9\uB85D\uC73C\uB85C', '\u524D\u5F80\u9635\u5BB9\u5217\u8868',
    'Ir a la lista de comps', 'Aller \u00E0 la liste des comps'
  ),
  'tft.compare.notFound': t6(
    'Comp nicht gefunden', 'Comp not found',
    '\uC870\uD569\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC74C', '\u672A\u627E\u5230\u9635\u5BB9',
    'Comp no encontrado', 'Comp introuvable'
  ),
  'tft.compare.traits': t6(
    'Synergie-Vergleich', 'Synergy Diff',
    '\uC2DC\uB108\uC9C0 \uBE44\uAD50', '\u7F81\u7ECA\u5BF9\u6BD4',
    'Comparaci\u00F3n de sinergias', 'Comparaison de synergies'
  ),
  'tft.compare.traits.shared': t6(
    'Gemeinsam', 'Shared',
    '\uACF5\uD1B5', '\u5171\u6709',
    'Compartidas', 'Communes'
  ),
  'tft.compare.traits.onlyA': t6(
    'Nur A', 'A only',
    'A \uC804\uC6A9', '\u4EC5 A',
    'Solo A', 'A uniquement'
  ),
  'tft.compare.traits.onlyB': t6(
    'Nur B', 'B only',
    'B \uC804\uC6A9', '\u4EC5 B',
    'Solo B', 'B uniquement'
  ),
  'tft.compare.selectedCount': t6(
    '{n} / 2 zum Vergleichen ausgew\u00E4hlt',
    '{n} / 2 selected for compare',
    '{n} / 2 \uBE44\uAD50 \uC120\uD0DD\uB428',
    '\u5DF2\u9009\u62E9 {n} / 2 \u8FDB\u884C\u5BF9\u6BD4',
    '{n} / 2 seleccionadas para comparar',
    '{n} / 2 s\u00E9lectionn\u00E9es pour comparer'
  ),
  'tft.compare.action': t6(
    'Vergleichen', 'Compare',
    '\uBE44\uAD50\uD558\uAE30', '\u5BF9\u6BD4',
    'Comparar', 'Comparer'
  ),
  'tft.comps.tab.list': t6('Liste', 'List', '\uBAA9\uB85D', '\u5217\u8868', 'Lista', 'Liste'),
  'tft.comps.tab.overview': t6('\u00DCbersicht', 'Overview', '\uAC1C\uC694', '\u603B\u89C8', 'Resumen', 'Aper\u00E7u'),
  'tft.comps.atlas.cost': t6('{n} Kosten', '{n} Cost', '{n}\uCF54\uC2A4\uD2B8', '{n}\u8D39', 'Coste {n}', 'Co\u00FBt {n}'),
  'tft.comps.atlas.fast9': t6('Fast 9', 'Fast 9', '\uBE60\uB978 9\uB808\uBCA8', '\u901F9', 'Nivel 9 r\u00E1pido', 'Niveau 9 rapide'),
  'tft.comps.atlas.fast8': t6('Fast 8', 'Fast 8', '\uBE60\uB978 8\uB808\uBCA8', '\u901F8', 'Nivel 8 r\u00E1pido', 'Niveau 8 rapide'),
  'tft.comps.atlas.reroll': t6('Reroll', 'Reroll', '\uB9AC\uB864', '\u8D4C\u72D7', 'Reroll', 'Reroll'),
  'tft.compare.reset': t6(
    'Zur\u00FCcksetzen', 'Reset',
    '\uCD08\uAE30\uD654', '\u91CD\u7F6E',
    'Reiniciar', 'R\u00E9initialiser'
  ),
  'tft.compare.tooltip.toggle': t6(
    'Zum Vergleich ausw\u00E4hlen', 'Add to compare',
    '\uBE44\uAD50\uC5D0 \uCD94\uAC00', '\u6DFB\u52A0\u5230\u5BF9\u6BD4',
    'A\u00F1adir a la comparaci\u00F3n', 'Ajouter \u00E0 la comparaison'
  ),
  'tft.compare.tooltip.selected': t6(
    'Ausgew\u00E4hlt \u2014 klicken zum Entfernen', 'Selected \u2014 click to remove',
    '\uC120\uD0DD\uB428 \u2014 \uD074\uB9AD\uD558\uC5EC \uC81C\uAC70', '\u5DF2\u9009\u62E9 \u2014 \u70B9\u51FB\u79FB\u9664',
    'Seleccionada \u2014 clic para quitar', 'S\u00E9lectionn\u00E9e \u2014 cliquez pour retirer'
  ),
  'tft.patchNotes.officialLink': t6(
    'Offizielle Riot Patch Notes', 'Official Riot Patch Notes',
    '\uACF5\uC2DD Riot \uD328\uCE58 \uB178\uD2B8', '\u5B98\u65B9 Riot \u8865\u4E01\u8BF4\u660E',
    'Notas oficiales del parche Riot', 'Notes officielles du patch Riot'
  ),
  'tft.compare.fromDetail': t6(
    'Mit anderer Comp vergleichen', 'Compare with another comp',
    '다른 조합과 비교', '与其他阵容对比',
    'Comparar con otra comp', 'Comparer avec une autre comp'
  ),
  'tft.compare.firstSelected': t6(
    'Erste Comp ausgewählt — jetzt zweite Comp wählen',
    'First comp selected — now pick the second',
    '첫 번째 조합 선택됨 — 두 번째 선택',
    '已选择第一个阵容 — 现在选择第二个',
    'Primera comp seleccionada — ahora elige la segunda',
    'Première comp sélectionnée — choisissez la seconde'
  ),
  'tft.augmentsCompare.title': t6(
    'Augment-Vergleich', 'Augment Comparison',
    '증강 비교', '强化对比',
    'Comparación de aumentos', 'Comparaison d\'augmentations'
  ),
  'tft.augmentsCompare.pickTwo': t6(
    'Zwei Augments zum Vergleichen wählen', 'Pick two augments to compare',
    '비교할 두 증강 선택', '选择两个强化进行对比',
    'Elige dos aumentos para comparar', 'Sélectionnez deux augmentations à comparer'
  ),
  'tft.augmentsCompare.pickTwo.hint': t6(
    'URL-Format: ?a=<apiName>&b=<apiName>',
    'URL format: ?a=<apiName>&b=<apiName>',
    'URL 형식: ?a=<apiName>&b=<apiName>',
    'URL 格式: ?a=<apiName>&b=<apiName>',
    'Formato URL: ?a=<apiName>&b=<apiName>',
    'Format URL : ?a=<apiName>&b=<apiName>'
  ),
  'tft.augmentsCompare.goToList': t6(
    'Zur Augment-Liste', 'Go to augment list',
    '증강 목록으로', '前往强化列表',
    'Ir a la lista de aumentos', 'Aller à la liste des augmentations'
  ),
  'tft.augmentsCompare.notFound': t6(
    'Augment nicht gefunden', 'Augment not found',
    '증강을 찾을 수 없음', '未找到强化',
    'Aumento no encontrado', 'Augmentation introuvable'
  ),
  'tft.augmentsCompare.compsCount': t6(
    '{n} Comps spielen dieses Augment', '{n} comps use this augment',
    '{n}개 조합이 이 증강 사용', '{n} 个阵容使用此强化',
    '{n} comps usan este aumento', '{n} comps utilisent cette augmentation'
  ),
  'tft.augmentsCompare.more': t6(
    'weitere', 'more',
    '더', '更多',
    'más', 'plus'
  ),
  'tft.augmentsCompare.fromDetail': t6(
    'Mit anderem Augment vergleichen', 'Compare with another augment',
    '다른 증강과 비교', '与其他强化对比',
    'Comparar con otro aumento', 'Comparer avec une autre augmentation'
  ),
  'tft.search.units': t6(
    'Champion suchen…', 'Search champion…',
    '챔피언 검색…', '搜索英雄…',
    'Buscar campeón…', 'Rechercher un champion…'
  ),
  'tft.search.items': t6(
    'Item suchen…', 'Search item…',
    '아이템 검색…', '搜索装备…',
    'Buscar objeto…', 'Rechercher un objet…'
  ),
  'tft.search.augments': t6(
    'Augment suchen…', 'Search augment…',
    '증강 검색…', '搜索强化…',
    'Buscar aumento…', 'Rechercher une augmentation…'
  ),
  'tft.search.traits': t6(
    'Synergie suchen…', 'Search trait…',
    '시너지 검색…', '搜索羁绊…',
    'Buscar sinergia…', 'Rechercher une synergie…'
  ),
  'tft.search.comps': t6(
    'Comp suchen (Trait oder Carry)…', 'Search comp (trait or carry)…',
    '조합 검색 (시너지 또는 캐리)…', '搜索阵容 (羁绊或核心)…',
    'Buscar comp (sinergia o carry)…', 'Rechercher comp (synergie ou carry)…'
  ),
  'tft.search.pros': t6(
    'Pro suchen (Name, Team)…', 'Search pro (name, team)…',
    '프로 검색 (이름, 팀)…', '搜索职业选手 (姓名、队伍)…',
    'Buscar pro (nombre, equipo)…', 'Rechercher pro (nom, équipe)…'
  ),
  'tft.search.player': t6(
    'Spieler suchen…', 'Search player…',
    '플레이어 검색…', '搜索玩家…',
    'Buscar jugador…', 'Rechercher un joueur…'
  ),
  'tft.search.tournaments': t6(
    'Turnier oder Region suchen…', 'Search tournament or region…',
    '대회 또는 지역 검색…', '搜索赛事或地区…',
    'Buscar torneo o región…', 'Rechercher tournoi ou région…'
  ),
  'tft.patchNotes.changes': t6(
    'Was hat sich geändert?', 'What changed?',
    '무엇이 바뀌었나요?', '什么发生了变化?',
    '¿Qué cambió?', 'Qu\'est-ce qui a changé ?'
  ),
  'tft.patchNotes.changes.source': t6(
    'Quelle: tactics.tools (gescraped pro Patch)',
    'Source: tactics.tools (scraped per patch)',
    '출처: tactics.tools (패치별 스크랩)',
    '来源: tactics.tools (按补丁抓取)',
    'Fuente: tactics.tools (scraped por parche)',
    'Source : tactics.tools (extrait par patch)'
  ),
  'tft.augment.stage.label': t6(
    'Stage', 'Stage',
    '스테이지', '阶段',
    'Etapa', 'Étape'
  ),
  'tft.augment.stage.all': t6(
    'Alle Stages', 'All stages',
    '모든 스테이지', '所有阶段',
    'Todas las etapas', 'Toutes les étapes'
  ),
  'tft.augment.sort.tier': t6(
    'nach Tier', 'by Tier',
    '등급순', '按等级',
    'por nivel', 'par tier'
  ),
  'tft.augment.sort.stage': t6(
    'nach Stage', 'by Stage',
    '스테이지순', '按阶段',
    'por etapa', 'par étape'
  ),
  'tft.augment.stage.appearsIn': t6(
    'Erscheint in folgenden Stages',
    'Appears in these stages',
    '다음 스테이지에 등장',
    '在以下阶段出现',
    'Aparece en estas etapas',
    'Apparaît dans ces étapes'
  ),
  'tft.augment.stage.unknown': t6(
    'Stage-Daten nicht verfügbar', 'Stage data not available',
    '스테이지 데이터 없음', '阶段数据不可用',
    'Datos de etapa no disponibles', 'Données d\'étape indisponibles'
  ),
  'tft.augment.stage.sourceNote': t6(
    '{n} Augments mit Stage-Daten (tactics.tools)',
    '{n} augments with stage data (tactics.tools)',
    '{n}개 증강에 스테이지 데이터 있음 (tactics.tools)',
    '{n} 个强化有阶段数据 (tactics.tools)',
    '{n} aumentos con datos de etapa (tactics.tools)',
    '{n} augmentations avec données d\'étape (tactics.tools)'
  ),
  'tft.augment.stage.sourceFooter': t6(
    'Quelle: tactics.tools (öffentliche Spielmechanik-Ground-Truth)',
    'Source: tactics.tools (public game-mechanic ground truth)',
    '출처: tactics.tools (공개 게임 메커니즘 정보)',
    '来源: tactics.tools (公开游戏机制数据)',
    'Fuente: tactics.tools (datos públicos de mecánica)',
    'Source : tactics.tools (mécanique de jeu publique)'
  ),
  'tft.search.noResults': t6(
    'Kein Treffer für „{q}“', 'No match for „{q}“',
    '„{q}“ 검색 결과 없음', '没有找到 „{q}“',
    'Sin resultados para „{q}“', 'Aucun résultat pour „{q}“'
  ),
  'tft.patchNotes.officialLinkHint': t6(
    'Externe Riot-Seite \u2014 Detail-\u00C4nderungen pro Champion / Trait / Augment / Item',
    'External Riot page \u2014 detail changes per champion / trait / augment / item',
    '\uC678\uBD80 Riot \uD398\uC774\uC9C0 \u2014 \uCC54\uD53C\uC5B8 / \uC2DC\uB108\uC9C0 / \uC99D\uAC15 / \uC544\uC774\uD15C\uBCC4 \uC0C1\uC138 \uBCC0\uACBD',
    '\u5916\u90E8 Riot \u9875\u9762 \u2014 \u6BCF\u4E2A\u82F1\u96C4 / \u7F81\u7ECA / \u5F3A\u5316 / \u88C5\u5907\u7684\u8BE6\u7EC6\u53D8\u66F4',
    'P\u00E1gina externa de Riot \u2014 cambios detallados por campe\u00F3n / sinergia / aumento / objeto',
    'Page externe Riot \u2014 modifications d\u00E9taill\u00E9es par champion / synergie / augmentation / objet'
  ),
  // Augment-Reihen der Comp-Seite nach Rarity (1 Silber, 2 Gold, 3 Prismatisch)
  'tft.comp.augments.rarity.3': t6('Prismatisch', 'Prismatic', '\uD504\uB9AC\uC998', '\u68F1\u5F69', 'Prism\u00E1tico', 'Prismatique'),
  'tft.comp.augments.rarity.2': t6('Gold', 'Gold', '\uACE8\uB4DC', '\u9EC4\u91D1', 'Oro', 'Or'),
  'tft.comp.augments.rarity.1': t6('Silber', 'Silver', '\uC2E4\uBC84', '\u767D\u94F6', 'Plata', 'Argent'),
  'tft.comp.augments.group.ECON': t6('Econ', 'Econ', '\uACBD\uC81C', '\u7ECF\u6D4E', 'Eco', '\u00C9co'),
  'tft.comp.augments.group.ITEMS': t6('Items', 'Items', '\uC544\uC774\uD15C', '\u88C5\u5907', 'Objetos', 'Objets'),
  'tft.comp.augments.group.COMBAT': t6('Combat', 'Combat', '\uC804\uD22C', '\u6218\u6597', 'Combate', 'Combat'),
  'tft.comp.augments.group.EMBLEM': t6('Emblem', 'Emblem', '\uC5E0\uBE14\uB7FC', '\u5FBD\u7AE0', 'Emblema', 'Embl\u00E8me'),
  'tft.comp.augments.group.HERO': t6('Hero', 'Hero', '\uC601\uC6C5', '\u82F1\u96C4', 'H\u00E9roe', 'H\u00E9ros'),
  'tft.comp.difficulty.EASY': t6('Einfach', 'Easy', '\uC26C\uC6C0', '\u7B80\u5355', 'F\u00E1cil', 'Facile'),
  'tft.comp.difficulty.MEDIUM': t6('Mittel', 'Medium', '\uBCF4\uD1B5', '\u4E2D\u7B49', 'Medio', 'Moyen'),
  'tft.comp.difficulty.HARD': t6('Schwer', 'Hard', '\uC5B4\uB824\uC6C0', '\u56F0\u96BE', 'Dif\u00EDcil', 'Difficile'),
  'tft.comp.difficulty.CONDITIONAL': t6(
    'Situativ', 'Conditional',
    '\uC0C1\uD669\uC801', '\u6761\u4EF6\u6027',
    'Condicional', 'Conditionnel'
  ),
  'tft.comp.earlyGame': t6(
    'Early Game', 'Early Game',
    '\uCD08\uBC18 \uAC8C\uC784', '\u524D\u671F',
    'Juego temprano', 'D\u00E9but de partie'
  ),
  'tft.comp.avgPlacement': t6(
    '\u00D8 Platz', 'Avg place',
    '\uD3C9\uADE0 \uC21C\uC704', '\u5E73\u5747\u6392\u540D',
    'Puesto medio', 'Place moy.'
  ),
  'tft.comp.games': t6(
    'Spiele', 'games',
    '\uAC8C\uC784', '\u5C40',
    'partidas', 'parties'
  ),
  'tft.comp.carousel': t6(
    'Carousel \u00B7 Runde 1', 'Carousel \u00B7 Round 1',
    '\uCE90\uB7EC\uC140 \u00B7 \uB77C\uC6B4\uB4DC 1', '\u8F6C\u76D8 \u00B7 \u7B2C1\u8F6E',
    'Carrusel \u00B7 Ronda 1', 'Carousel \u00B7 Manche 1'
  ),
  'tft.comp.variants': t6(
    'Varianten', 'Variants',
    '\uBCC0\uD615', '\u53D8\u4F53',
    'Variantes', 'Variantes'
  ),
  'tft.comp.variant.base': t6(
    'Basis', 'Base',
    '\uAE30\uBCF8', '\u57FA\u7840',
    'Base', 'Base'
  ),
  'tft.comp.variant.level': t6(
    'Stufe {n}', 'Tier {n}',
    '{n}단계', '{n}级',
    'Nivel {n}', 'Palier {n}'
  ),
  'tft.comp.variant.reroll3': t6(
    '3\u2605', '3\u2605',
    '3\uC131', '3\u661F',
    '3\u2605', '3\u2605'
  ),
  'tft.comp.variant.with': t6(
    'mit {name}', 'with {name}',
    '{name} \uD3EC\uD568', '\u642D\u914D {name}',
    'con {name}', 'avec {name}'
  ),
  'tft.comp.variant.lowSample': t6(
    'Niedrige Stichprobe', 'Low sample',
    '\uB0AE\uC740 \uD45C\uBCF8', '\u6837\u672C\u4E0D\u8DB3',
    'Muestra baja', '\u00C9chantillon faible'
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

  // Tier-Letter badge (S/A/B/C/D) \u2014 Phase-A1, market standard analog MetaTFT/MetaBot/u.gg.
  'tft.tier.S': t6('S', 'S', 'S', 'S', 'S', 'S'),
  'tft.tier.A': t6('A', 'A', 'A', 'A', 'A', 'A'),
  'tft.tier.B': t6('B', 'B', 'B', 'B', 'B', 'B'),
  'tft.tier.C': t6('C', 'C', 'C', 'C', 'C', 'C'),
  'tft.tier.D': t6('D', 'D', 'D', 'D', 'D', 'D'),
  'tft.tier.tooltip.S': t6('Meta-pr\u00E4gend', 'Meta-defining', '\uBA54\uD0C0 \uC815\uC758', '\u7248\u672C\u4E3B\u5BFC', 'Define el meta', 'D\u00E9finit le m\u00E9ta'),
  'tft.tier.tooltip.A': t6('Stark', 'Strong', '\uAC15\uB825', '\u5F3A\u529B', 'Fuerte', 'Solide'),
  'tft.tier.tooltip.B': t6('Solide', 'Viable', '\uC4F8 \uB9CC\uD568', '\u53EF\u7528', 'Viable', 'Viable'),
  'tft.tier.tooltip.C': t6('Situativ', 'Situational', '\uC0C1\uD669\uBCC4', '\u60C5\u5883', 'Situacional', 'Situationnel'),
  'tft.tier.tooltip.D': t6('Schwach', 'Below average', '\uD3C9\uADE0 \uC774\uD558', '\u4F4E\u4E8E\u5E73\u5747', 'Bajo el promedio', 'En dessous de la moyenne'),
  'tft.tier.tooltip.empty': t6('Zu wenig Daten', 'Not enough data', '\uB370\uC774\uD130 \uBD80\uC871', '\u6570\u636E\u4E0D\u8DB3', 'Datos insuficientes', 'Donn\u00E9es insuffisantes'),

  // Win Share / Top4 Share \u2014 MetaTFT-equivalent metrics, surfaced as tooltips.
  'tft.shares.winShareLabel': t6('Win-Anteil', 'Win Share', '\uC2B9\uB9AC \uC810\uC720', '\u80DC\u573A\u5360\u6BD4', 'Cuota de victoria', 'Part de victoires'),
  'tft.shares.top4ShareLabel': t6('Top-4-Anteil', 'Top 4 Share', '\uD1B14 \uC810\uC720', '\u524D4\u5360\u6BD4', 'Cuota de Top 4', 'Part Top 4'),
  'tft.shares.winShareTooltip.unit': t6(
    '{share}% aller Gewinner-Boards enthalten diese Unit',
    '{share}% of all winning boards contain this unit',
    '\uBAA8\uB4E0 \uC2B9\uB9AC \uBCF4\uB4DC\uC758 {share}%\uC5D0 \uC774 \uC720\uB2DB\uC774 \uD3EC\uD568',
    '{share}% \u7684\u80DC\u5229\u68CB\u76D8\u5305\u542B\u6B64\u82F1\u96C4',
    '{share}% de los tableros ganadores incluyen esta unidad',
    '{share}% des plateaux gagnants contiennent cette unit\u00E9'
  ),
  'tft.shares.top4ShareTooltip.unit': t6(
    '{share}% aller Top-4-Boards enthalten diese Unit',
    '{share}% of all Top-4 boards contain this unit',
    '\uBAA8\uB4E0 \uD1B14 \uBCF4\uB4DC\uC758 {share}%\uC5D0 \uC774 \uC720\uB2DB\uC774 \uD3EC\uD568',
    '{share}% \u7684\u524D4\u68CB\u76D8\u5305\u542B\u6B64\u82F1\u96C4',
    '{share}% de los tableros Top 4 incluyen esta unidad',
    '{share}% des plateaux Top 4 contiennent cette unit\u00E9'
  ),
  'tft.shares.winShareTooltip.item': t6(
    '{share}% aller Gewinner-Boards bauten dieses Item',
    '{share}% of all winning boards built this item',
    '\uBAA8\uB4E0 \uC2B9\uB9AC \uBCF4\uB4DC\uC758 {share}%\uAC00 \uC774 \uC544\uC774\uD15C \uC0AC\uC6A9',
    '{share}% \u7684\u80DC\u5229\u68CB\u76D8\u643A\u5E26\u6B64\u88C5\u5907',
    '{share}% de los tableros ganadores construyeron este \u00EDtem',
    '{share}% des plateaux gagnants ont cet objet'
  ),
  'tft.shares.top4ShareTooltip.item': t6(
    '{share}% aller Top-4-Boards bauten dieses Item',
    '{share}% of all Top-4 boards built this item',
    '\uBAA8\uB4E0 \uD1B14 \uBCF4\uB4DC\uC758 {share}%\uAC00 \uC774 \uC544\uC774\uD15C \uC0AC\uC6A9',
    '{share}% \u7684\u524D4\u68CB\u76D8\u643A\u5E26\u6B64\u88C5\u5907',
    '{share}% de los tableros Top 4 construyeron este \u00EDtem',
    '{share}% des plateaux Top 4 ont cet objet'
  ),
  'tft.shares.winShareTooltip.comp': t6(
    '{share}% aller Wins werden mit dieser Comp erzielt',
    '{share}% of all wins are with this comp',
    '\uBAA8\uB4E0 \uC2B9\uB9AC\uC758 {share}%\uAC00 \uC774 \uC870\uD569',
    '{share}% \u7684\u80DC\u573A\u6765\u81EA\u6B64\u9635\u5BB9',
    '{share}% de las victorias son con esta comp',
    '{share}% des victoires viennent de cette comp'
  ),
  'tft.shares.top4ShareTooltip.comp': t6(
    '{share}% aller Top 4 werden mit dieser Comp erzielt',
    '{share}% of all Top 4 are with this comp',
    '\uBAA8\uB4E0 \uD1B14\uC758 {share}%\uAC00 \uC774 \uC870\uD569',
    '{share}% \u7684\u524D4\u6765\u81EA\u6B64\u9635\u5BB9',
    '{share}% de los Top 4 son con esta comp',
    '{share}% des Top 4 viennent de cette comp'
  ),

  // Trait filter on /tft/units (Phase A1)
  'tft.unit.trait.allTraits': t6('Alle Traits', 'All traits', '\uBAA8\uB4E0 \uD2B9\uC131', '\u6240\u6709\u7F81\u7ECA', 'Todos los rasgos', 'Toutes les origines'),
  'tft.unit.trait.label': t6('Trait', 'Trait', '\uD2B9\uC131', '\u7F81\u7ECA', 'Rasgo', 'Origine'),

  // Explorer Star / Items-Count filters (Phase A2)
  'tft.explorer.starLevel': t6('Sterne', 'Star level', '\uC131\uAE09', '\u661F\u7EA7', 'Nivel de estrella', 'Niveau d\'\u00E9toile'),
  'tft.explorer.itemsCount': t6('Items', 'Items', '\uC544\uC774\uD15C', '\u88C5\u5907\u6570', '\u00CDtems', 'Objets'),

  // Data Explorer (Neubau 2026-09-28)
  'tft.explorer.x.patch.latest': t6('Neuester Patch', 'Latest patch', '\uCD5C\uC2E0 \uD328\uCE58', '\u6700\u65B0\u7248\u672C', '\u00DAltimo parche', 'Dernier patch'),
  'tft.explorer.x.patch.all': t6('Alle Patches', 'All patches', '\uBAA8\uB4E0 \uD328\uCE58', '\u6240\u6709\u7248\u672C', 'Todos los parches', 'Tous les patchs'),
  'tft.explorer.x.search': t6('Suchen', 'Search', '\uAC80\uC0C9', '\u641C\u7D22', 'Buscar', 'Rechercher'),
  'tft.explorer.x.with': t6('mit', 'with', '\uD3EC\uD568', '\u5305\u542B', 'con', 'avec'),
  'tft.explorer.x.without': t6('ohne', 'without', '\uC81C\uC678', '\u4E0D\u542B', 'sin', 'sans'),
  'tft.explorer.x.any': t6('egal', 'any', '\uC804\uCCB4', '\u4EFB\u610F', 'cualquiera', 'tous'),
  'tft.explorer.x.atLeast': t6('mind.', 'at least', '\uC774\uC0C1', '\u81F3\u5C11', 'm\u00EDn.', 'min.'),
  'tft.explorer.x.exact': t6('genau', 'exactly', '\uC815\uD655\uD788', '\u6070\u597D', 'exacto', 'exact'),
  'tft.explorer.x.withItem': t6('Mit Item', 'With item', '\uD3EC\uD568 \uC544\uC774\uD15C', '\u5305\u542B\u88C5\u5907', 'Con \u00EDtem', 'Avec objet'),
  'tft.explorer.x.withoutItem': t6('Ohne Item', 'Without item', '\uC81C\uC678 \uC544\uC774\uD15C', '\u4E0D\u542B\u88C5\u5907', 'Sin \u00EDtem', 'Sans objet'),
  'tft.explorer.x.level': t6('Stufe', 'Tier', '\uB2E8\uACC4', '\u5C42\u7EA7', 'Nivel', 'Palier'),
  'tft.explorer.x.remove': t6('Entfernen', 'Remove', '\uC81C\uAC70', '\u79FB\u9664', 'Quitar', 'Retirer'),
  'tft.explorer.x.matches': t6('Partien', 'Lobbies', '\uAC8C\uC784', '\u5BF9\u5C40', 'Partidas', 'Parties'),
  'tft.explorer.x.share': t6('Anteil', 'Share', '\uBE44\uC728', '\u5360\u6BD4', 'Cuota', 'Part'),
  'tft.explorer.x.delta': t6('\u0394 Platz', '\u0394 place', '\u0394 \uC21C\uC704', '\u0394 \u540D\u6B21', '\u0394 posici\u00F3n', '\u0394 place'),
  'tft.explorer.x.deltaMode.base': t6('gegen Auswahl', 'vs selection', '\uC120\uD0DD \uB300\uBE44', '\u5BF9\u6BD4\u6240\u9009', 'vs selecci\u00F3n', 'vs s\u00E9lection'),
  'tft.explorer.x.deltaMode.out': t6('mit gegen ohne', 'with vs without', '\uD3EC\uD568 vs \uC81C\uC678', '\u6709 vs \u65E0', 'con vs sin', 'avec vs sans'),
  'tft.explorer.x.base': t6('Grundwert', 'Baseline', '\uAE30\uC900\uAC12', '\u57FA\u51C6', 'Base', 'R\u00E9f\u00E9rence'),
  'tft.explorer.x.placeDist': t6('Platzverteilung', 'Placement distribution', '\uC21C\uC704 \uBD84\uD3EC', '\u540D\u6B21\u5206\u5E03', 'Distribuci\u00F3n de posiciones', 'R\u00E9partition des places'),
  'tft.explorer.x.tab.units': t6('Units', 'Units', '\uC720\uB2DB', '\u5355\u4F4D', 'Unidades', 'Unit\u00E9s'),
  'tft.explorer.x.tab.items': t6('Items', 'Items', '\uC544\uC774\uD15C', '\u88C5\u5907', '\u00CDtems', 'Objets'),
  'tft.explorer.x.tab.traits': t6('Synergien', 'Traits', '\uC2DC\uB108\uC9C0', '\u7F81\u7ECA', 'Sinergias', 'Synergies'),
  'tft.explorer.x.tab.comps': t6('Comps', 'Comps', '\uC870\uD569', '\u9635\u5BB9', 'Comps', 'Compos'),
  'tft.explorer.x.tab.level': t6('End-Level', 'End level', '\uCD5C\uC885 \uB808\uBCA8', '\u6700\u7EC8\u7B49\u7EA7', 'Nivel final', 'Niveau final'),
  'tft.explorer.x.tab.round': t6('Letzte Runde', 'Last round', '\uB9C8\uC9C0\uB9C9 \uB77C\uC6B4\uB4DC', '\u6700\u540E\u56DE\u5408', '\u00DAltima ronda', 'Dernier tour'),
  'tft.explorer.x.tab.gold': t6('Gold \u00FCbrig', 'Gold left', '\uB0A8\uC740 \uACE8\uB4DC', '\u5269\u4F59\u91D1\u5E01', 'Oro restante', 'Or restant'),
  'tft.explorer.x.tab.region': t6('Region', 'Region', '\uC9C0\uC5ED', '\u533A\u57DF', 'Regi\u00F3n', 'R\u00E9gion'),
  'tft.explorer.x.tab.rank': t6('Rang', 'Rank', '\uB7AD\uD06C', '\u6BB5\u4F4D', 'Rango', 'Rang'),
  'tft.explorer.x.split.star': t6('nach Sternen', 'by stars', '\uC131\uAE09\uBCC4', '\u6309\u661F\u7EA7', 'por estrellas', 'par \u00E9toiles'),
  'tft.explorer.x.split.over': t6('nach \u00DCberzahl', 'by overcap', '\uCD08\uACFC \uC778\uC6D0\uBCC4', '\u6309\u8D85\u51FA\u4EBA\u6570', 'por exceso', 'par surplus'),
  'tft.explorer.x.focus': t6('Tr\u00E4ger', 'Holder', '\uCC29\uC6A9 \uC720\uB2DB', '\u88C5\u5907\u8005', 'Portador', 'Porteur'),
  'tft.explorer.x.combo.1': t6('Einzeln', 'Single', '\uB2E8\uC77C', '\u5355\u4EF6', 'Individual', 'Seul'),
  'tft.explorer.x.combo.2': t6('Paare', 'Pairs', '2\uAC1C \uC870\uD569', '\u4E24\u4EF6\u7EC4\u5408', 'Pares', 'Paires'),
  'tft.explorer.x.combo.3': t6('Trios', 'Trios', '3\uAC1C \uC870\uD569', '\u4E09\u4EF6\u7EC4\u5408', 'Tr\u00EDos', 'Trios'),
  'tft.explorer.x.dataDate': t6('Datenstand', 'Data as of', '\uB370\uC774\uD130 \uAE30\uC900', '\u6570\u636E\u622A\u81F3', 'Datos a', 'Donn\u00E9es au'),
  'tft.explorer.x.err.busy': t6('Server ausgelastet', 'Server busy', '\uC11C\uBC84 \uC0AC\uC6A9\uB7C9 \uB9CE\uC74C', '\u670D\u52A1\u5668\u7E41\u5FD9', 'Servidor ocupado', 'Serveur occup\u00E9'),
  'tft.explorer.x.err.timeout': t6('Abfrage zu aufwendig', 'Query too heavy', '\uCFFC\uB9AC\uAC00 \uB108\uBB34 \uBB34\uAC70\uC6C0', '\u67E5\u8BE2\u8FC7\u4E8E\u590D\u6742', 'Consulta demasiado pesada', 'Requ\u00EAte trop lourde'),
  'tft.explorer.x.err.unavailable': t6('Explorer gerade nicht erreichbar', 'Explorer currently unavailable', '\uD0D0\uC0C9\uAE30\uB97C \uD604\uC7AC \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC74C', '\u63A2\u7D22\u5668\u6682\u65F6\u4E0D\u53EF\u7528', 'Explorador no disponible ahora', 'Explorateur indisponible pour le moment'),
  'tft.explorer.x.retry': t6('Erneut versuchen', 'Try again', '\uB2E4\uC2DC \uC2DC\uB3C4', '\u91CD\u8BD5', 'Reintentar', 'R\u00E9essayer'),

  // Item bucket filter (analog to tactics.tools/metatft Standard/Artifact/Emblem/Radiant)
  'tft.item.bucket.all': t6('Alle', 'All', '\uC804\uCCB4', '\u5168\u90E8', 'Todos', 'Tous'),
  'tft.item.bucket.standard': t6('Standard', 'Standard', '\uAE30\uBCF8', '\u6807\u51C6', 'Est\u00E1ndar', 'Standard'),
  'tft.item.bucket.artifact': t6('Artefakte', 'Artifacts', '\uC544\uD2F0\uD329\uD2B8', '\u795E\u5668', 'Artefactos', 'Artefacts'),
  'tft.item.bucket.emblem': t6('Embleme', 'Emblems', '\uBB38\uC7A5', '\u5FBD\u7AE0', 'Emblemas', 'Embl\u00E8mes'),
  'tft.item.bucket.radiant': t6('Radiant', 'Radiant', '\uB798\uB514\uC5B8\uD2B8', '\u706F\u706C', 'Radiantes', 'Radieux'),

  // Item detail: per-carrier stats table (Avg-Place + Top4 + Games)
  'tft.item.topCarrier.title': t6(
    'Top-Tr\u00E4ger', 'Top Carriers',
    '\uC8FC\uC694 \uCC54\uD53C\uC5B8', '\u70ED\u95E8\u643A\u5E26\u8005',
    'Portadores principales', 'Porteurs principaux'
  ),
  'tft.item.topCarrier.carrier': t6('Tr\u00E4ger', 'Carrier', '\uCC54\uD53C\uC5B8', '\u643A\u5E26\u8005', 'Portador', 'Porteur'),

  // Item detail: item-combos (Top item-sets this item appears in)
  'tft.item.combos.title': t6(
    'Top Item-Kombinationen', 'Top Item Combinations',
    '\uC8FC\uC694 \uC544\uC774\uD15C \uC870\uD569', '\u70ED\u95E8\u88C5\u5907\u7EC4\u5408',
    'Combinaciones de \u00EDtems principales', 'Meilleures combinaisons d\'objets'
  ),
  'tft.item.combos.caption': t6(
    'St\u00E4rkste Builds, in denen dieses Item vorkommt \u2014 \u00FCber alle Comps gewichtet.',
    'Strongest builds containing this item \u2014 weighted across all comps.',
    '\uC774 \uC544\uC774\uD15C\uC774 \uD3EC\uD568\uB41C \uAC00\uC7A5 \uAC15\uB825\uD55C \uBE4C\uB4DC \u2014 \uBAA8\uB4E0 \uC870\uD569 \uAC00\uC911\uCE58 \uC801\uC6A9.',
    '\u5305\u542B\u8BE5\u88C5\u5907\u7684\u6700\u5F3A\u6784\u5EFA \u2014 \u8DE8\u9635\u5BB9\u52A0\u6743\u3002',
    'Las builds m\u00E1s fuertes que contienen este \u00EDtem \u2014 ponderado a trav\u00E9s de todas las comps.',
    'Builds les plus fortes contenant cet objet \u2014 pond\u00E9r\u00E9es sur l\'ensemble des comps.'
  ),

  // \u2500 Augment Detail Page \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'tft.augment.allTiers': t6(
    'Alle Tiers', 'All tiers',
    '\uBAA8\uB4E0 \uD2F0\uC5B4', '\u6240\u6709\u7B49\u7EA7',
    'Todos los tiers', 'Tous les tiers'
  ),
  'tft.augment.searchPlaceholder': t6(
    'Augment suchen\u2026', 'Search augment\u2026',
    '\uC99D\uAC15\uCCB4 \uAC80\uC0C9\u2026', '\u641C\u7D22\u5F3A\u5316\u2026',
    'Buscar aumento\u2026', 'Rechercher un augment\u2026'
  ),
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
    'Die Inhalte dieser Seite werden mit gr\u00F6\u00DFter Sorgfalt erstellt. F\u00FCr die Richtigkeit, Vollst\u00E4ndigkeit und Aktualit\u00E4t der Inhalte kann jedoch keine Gew\u00E4hr \u00FCbernommen werden. Statistiken werden aus \u00F6ffentlichen APIs (Riot Games, CommunityDragon) bezogen und sind ohne Gew\u00E4hr.',
    'Content on this site is produced with care; we cannot guarantee accuracy, completeness, or timeliness. Statistics come from public APIs (Riot, CommunityDragon) and are provided without warranty.',
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
  'legal.privacy.processorSentry': t6(
    'Sentry (Functional Software, Inc., USA) — Fehler-Überwachung. Erhält Fehlermeldungen und Stack-Traces bei technischen Störungen. Kein Performance-Tracking, keine IP-Adressen.',
    'Sentry (Functional Software, Inc., USA) — error monitoring. Receives error messages and stack traces on technical faults. No performance tracking, no IP addresses.',
    'Sentry(미국) — 오류 모니터링. IP 주소 없음.',
    'Sentry（美国）— 错误监控。不记录 IP 地址。',
    'Sentry (EE.UU.) — supervisión de errores. Sin direcciones IP.',
    'Sentry (USA) — surveillance des erreurs. Sans adresses IP.'
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
  'tft.patchNotes.entity.comp': t6(
    'Comps', 'Comps', '\uB371', '\u9635\u5BB9', 'Comps', 'Compos'
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
  'tft.pros.col.earnings': t6(
    'Preisgeld', 'Earnings', '\uC0C1\uAE08', '\u5956\u91D1', 'Premios', 'Gains'
  ),
  'tft.pros.col.classification': t6(
    'Status', 'Status', '\uC0C1\uD0DC', '\u72B6\u6001', 'Estado', 'Statut'
  ),
  'tft.pros.tab.verified': t6(
    'Verifiziert', 'Verified', '\uC778\uC99D\uB428', '\u5DF2\u8BA4\u8BC1', 'Verificados', 'V\u00E9rifi\u00E9s'
  ),
  'tft.pros.tab.tpc': t6(
    'TPC', 'TPC', 'TPC', 'TPC', 'TPC', 'TPC'
  ),
  'tft.pros.tab.tournament': t6(
    'Turnier-Pros', 'Tournament', '\uD1A0\uB108\uBA3C\uD2B8', '\u9526\u6807\u8D5B', 'Torneos', 'Tournoi'
  ),
  'tft.pros.tab.streamer': t6(
    'Streamer', 'Streamer', '\uC2A4\uD2B8\uB9AC\uBA38', '\u4E3B\u64AD', 'Streamer', 'Streamer'
  ),
  'tft.pros.tab.historic': t6(
    'Historisch', 'Historic', '\uC774\uC804', '\u5386\u53F2', 'Hist\u00F3rico', 'Historique'
  ),
  'tft.pros.tab.all': t6(
    'Alle', 'All', '\uC804\uCCB4', '\u5168\u90E8', 'Todos', 'Tous'
  ),
  'tft.pros.tournaments': t6(
    'Turniere', 'Tournaments', '\uD1A0\uB108\uBA3C\uD2B8', '\u9526\u6807\u8D5B', 'Torneos', 'Tournois'
  ),
  'tft.pros.totalEarnings': t6(
    'Gesamtes Preisgeld', 'Total Earnings', '\uCD1D \uC0C1\uAE08', '\u603B\u5956\u91D1', 'Premios Totales', 'Gains Totaux'
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

  // \u2500 TFT Tournaments / Esports \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'tft.tournaments.title': t6(
    'TFT Ligen & Wettbewerbe', 'TFT Leagues & Tournaments',
    'TFT \uB9AC\uADF8 & \uD1A0\uB108\uBA3C\uD2B8', 'TFT \u8054\u8D5B\u4E0E\u8D5B\u4E8B',
    'Ligas y Torneos TFT', 'Ligues et Tournois TFT'
  ),
  'tft.tournaments.subtitle': t6(
    'Aktuelle TFT-Tournaments mit Standings, Prize Pools und Pro-Spieler-Verlinkung.',
    'Current TFT tournaments with standings, prize pools and pro-player links.',
    '\uCD5C\uC2E0 TFT \uD1A0\uB108\uBA3C\uD2B8, \uC21C\uC704\uC640 \uC0C1\uAE08 \uC815\uBCF4.',
    'TFT \u8D5B\u4E8B\u6570\u636E\uFF0C\u542B\u6392\u540D\u548C\u5956\u91D1\u3002',
    'Torneos TFT con clasificaciones y bolsas de premios.',
    'Tournois TFT avec classements et cashprizes.'
  ),
  'tft.tournaments.allRegions': t6(
    'Alle Regionen', 'All Regions',
    '\uBAA8\uB4E0 \uC9C0\uC5ED', '\u6240\u6709\u533A\u57DF',
    'Todas las regiones', 'Toutes les r\u00E9gions'
  ),
  'tft.tournaments.allTiers': t6(
    'Alle Tiers', 'All Tiers',
    '\uBAA8\uB4E0 \uB4F1\uAE09', '\u6240\u6709\u7B49\u7EA7',
    'Todos los tiers', 'Tous les tiers'
  ),
  'tft.tournaments.allSets': t6(
    'Alle Sets', 'All Sets',
    '\uBAA8\uB4E0 \uC2DC\uC98C', '\u6240\u6709\u8D5B\u5B63',
    'Todos los sets', 'Tous les sets'
  ),
  'tft.tournaments.empty': t6(
    'Noch keine Tournaments. Komm in ein paar Tagen wieder.',
    'No tournaments yet. Check back in a few days.',
    '\uC544\uC9C1 \uD1A0\uB108\uBA3C\uD2B8\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.',
    '\u6682\u65E0\u8D5B\u4E8B\u6570\u636E\u3002',
    'Sin torneos todav\u00EDa.',
    'Pas encore de tournois.'
  ),
  'tft.tournaments.live': t6(
    'Live', 'Live',
    '\uB77C\uC774\uBE0C', '\u6B63\u5728\u8FDB\u884C',
    'En Vivo', 'En direct'
  ),
  'tft.tournaments.upcoming': t6(
    'Demn\u00E4chst', 'Upcoming',
    '\uC608\uC815', '\u5373\u5C06\u5F00\u59CB',
    'Pr\u00F3ximos', '\u00C0 venir'
  ),
  'tft.tournaments.past': t6(
    'Beendet', 'Past',
    '\uC885\uB8CC', '\u5DF2\u7ED3\u675F',
    'Pasados', 'Pass\u00E9s'
  ),
  'tft.tournaments.notFound': t6(
    'Tournament nicht gefunden.', 'Tournament not found.',
    '\uD1A0\uB108\uBA3C\uD2B8\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.', '\u672A\u627E\u5230\u8BE5\u8D5B\u4E8B\u3002',
    'Torneo no encontrado.', 'Tournoi introuvable.'
  ),
  'tft.tournaments.sourcedFrom': t6(
    'Quelle:', 'Source:',
    '\uCD9C\uCC98:', '\u6765\u6E90:',
    'Fuente:', 'Source :'
  ),
  'tft.tournaments.openOnLiquipedia': t6(
    'Auf Liquipedia ansehen',
    'Open on Liquipedia',
    'Liquipedia\uC5D0\uC11C \uBCF4\uAE30',
    '\u5728 Liquipedia \u4E0A\u67E5\u770B',
    'Ver en Liquipedia',
    'Voir sur Liquipedia'
  ),
  'tft.tournaments.liveStream': t6(
    'Live-Stream', 'Live Stream',
    '\uB77C\uC774\uBE0C \uBC29\uC1A1', '\u76F4\u64AD',
    'Transmisi\u00F3n en vivo', 'Stream en direct'
  ),
  'tft.tournaments.standings': t6(
    'Standings', 'Standings',
    '\uC21C\uC704', '\u6392\u540D',
    'Clasificaciones', 'Classement'
  ),
  'tft.tournaments.liveStandings': t6(
    'Live-Tabelle', 'Live standings',
    '\uC2E4\uC2DC\uAC04 \uC21C\uC704', '\u5B9E\u65F6\u6392\u540D',
    'Clasificaci\u00F3n en vivo', 'Classement en direct'
  ),
  'tft.tournaments.pointsTable': t6(
    'Punktetabelle', 'Points table',
    '\uC810\uC218\uD45C', '\u79EF\u5206\u699C',
    'Tabla de puntos', 'Tableau des points'
  ),
  'tft.tournaments.updatedAt': t6(
    'Stand {time}', 'Updated {time}',
    '{time} \uAE30\uC900', '\u66F4\u65B0\u4E8E {time}',
    'Actualizado {time}', 'Mis \u00E0 jour {time}'
  ),
  'tft.tournaments.colPoints': t6(
    'Punkte', 'Points',
    '\uC810\uC218', '\u79EF\u5206',
    'Puntos', 'Points'
  ),
  'tft.tournaments.colGames': t6(
    'Spiele', 'Games',
    '\uAC8C\uC784', '\u5C40\u6570',
    'Partidas', 'Parties'
  ),
  'tft.tournaments.standingsAfterEvent': t6(
    'Standings erscheinen nach Tournament-Ende.',
    'Standings appear after the tournament ends.',
    '\uD1A0\uB108\uBA3C\uD2B8 \uC885\uB8CC \uD6C4 \uC21C\uC704\uAC00 \uAC8C\uC2DC\uB429\uB2C8\uB2E4.',
    '\u6BD4\u8D5B\u7ED3\u675F\u540E\u5C06\u516C\u5E03\u6392\u540D\u3002',
    'Las clasificaciones aparecen tras el evento.',
    'Le classement appara\u00EEt apr\u00E8s le tournoi.'
  ),
  'tft.tournaments.noStandingsYet': t6(
    'Noch keine Standings importiert.',
    'No standings imported yet.',
    '\uC544\uC9C1 \uAC00\uC838\uC628 \uC21C\uC704\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.',
    '\u5C1A\u672A\u5BFC\u5165\u6392\u540D\u3002',
    'A\u00FAn no hay clasificaciones importadas.',
    'Pas encore de classement import\u00E9.'
  ),

  // \u2500 SideDrawer Past Section \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'drawer.past': t6(
    'Beendet', 'Past',
    '\uC885\uB8CC', '\u5DF2\u7ED3\u675F',
    'Pasados', 'Pass\u00E9s'
  ),
} as const;

export type TranslationKey = keyof typeof translations;

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
