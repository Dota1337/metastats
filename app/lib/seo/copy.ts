import type { Metadata } from 'next';
import type { Lang } from '../i18n';
import { SITE_URL } from '../site';
import { CURRENT_SET } from '../current-set';

// Seitentitel und Beschreibungen fuer Suchmaschinen und Link-Vorschauen, je
// Seitentyp in den sechs Sprachen der Seite. Reine Daten + reine Funktionen —
// die Sprache waehlt app/lib/seo/metadata.ts (Server).
//
// Inhalt nur, was die Seite wirklich zeigt (je Seite gegen page.tsx geprueft,
// 14.10.2026). Neue Seite → Eintrag hier + layout.tsx mit pageMetadata().
// Platzhalter: {name} (Unit, Item, Comp, Spieler …), {set} (z. B. „Set 18").

export interface SeoText { title: string; description: string }
type Localized = Record<Lang, SeoText>;

function six(
  de: [string, string], en: [string, string], ko: [string, string],
  zh: [string, string], es: [string, string], fr: [string, string],
): Localized {
  const t = ([title, description]: [string, string]): SeoText => ({ title, description });
  return { de: t(de), en: t(en), ko: t(ko), zh: t(zh), es: t(es), fr: t(fr) };
}

/** Startseite und Rueckfall fuer Seiten ohne eigenen Eintrag. */
export const SITE_COPY: Localized = {
  de: {
    title: 'metastats.gg — League of Legends Statistiken & Marktwerte',
    description: 'Echtzeit League of Legends Statistiken, Match History, Champion-Daten und KI-gestützte Marktwertberechnung für alle Spieler.',
  },
  en: {
    title: 'metastats.gg — League of Legends Stats & Market Values',
    description: 'Real-time League of Legends statistics, match history, champion data and AI-powered market value calculation for every player.',
  },
  ko: {
    title: 'metastats.gg — 리그 오브 레전드 통계 & 시장 가치',
    description: '실시간 리그 오브 레전드 통계, 매치 기록, 챔피언 데이터 및 모든 플레이어를 위한 AI 기반 시장 가치 계산.',
  },
  zh: {
    title: 'metastats.gg — 英雄联盟数据与市场价值',
    description: '实时英雄联盟数据统计、比赛记录、英雄数据及面向所有玩家的AI市场价值计算。',
  },
  es: {
    title: 'metastats.gg — Estadísticas de League of Legends y Valores de Mercado',
    description: 'Estadísticas en tiempo real de League of Legends, historial de partidas, datos de campeones y cálculo de valor de mercado con IA para todos los jugadores.',
  },
  fr: {
    title: 'metastats.gg — Statistiques League of Legends & Valeurs Marché',
    description: 'Statistiques en temps réel de League of Legends, historique des matchs, données des champions et calcul de valeur marchande par IA pour tous les joueurs.',
  },
};

export const PAGE_COPY = {
  // ---------------- League of Legends ----------------
  'lol.leaderboard': six(
    ['LoL Rangliste – Challenger bis Iron nach Region', 'League-of-Legends-Rangliste für 17 Regionen: LP, Siege und Niederlagen, Winrate und KI-Marktwert der Spieler, filterbar nach Rang und Division.'],
    ['LoL Leaderboard – Challenger to Iron by Region', 'League of Legends ranked leaderboard for 17 regions: LP, wins and losses, winrate and AI market value per player, filterable by tier and division.'],
    ['LoL 리더보드 – 지역별 챌린저부터 아이언까지', '17개 지역의 리그 오브 레전드 랭크 리더보드: 플레이어별 LP, 승패, 승률, AI 시장 가치. 티어와 디비전으로 필터링.'],
    ['英雄联盟排行榜 – 各地区王者至黑铁', '覆盖17个地区的英雄联盟排位排行榜：每位玩家的LP、胜负场、胜率与AI市场价值，可按段位和分段筛选。'],
    ['Clasificación de LoL – de Challenger a Hierro por región', 'Clasificación de League of Legends en 17 regiones: LP, victorias y derrotas, winrate y valor de mercado por IA de cada jugador, filtrable por liga y división.'],
    ['Classement LoL – de Challenger à Fer par région', 'Classement League of Legends sur 17 régions : LP, victoires et défaites, winrate et valeur marchande IA de chaque joueur, filtrable par rang et division.'],
  ),
  'lol.champions': six(
    ['LoL Champion-Statistiken – Winrate, Pickrate & Banrate', 'Alle League-of-Legends-Champions mit Winrate, Pickrate, Banrate, KDA und Spielzahl – filterbar nach Rolle, Rang und Region.'],
    ['LoL Champion Stats – Win Rate, Pick Rate & Ban Rate', 'Every League of Legends champion with win rate, pick rate, ban rate, KDA and games played – filter by role, rank and region.'],
    ['LoL 챔피언 통계 – 승률, 픽률, 밴률', '모든 리그 오브 레전드 챔피언의 승률, 픽률, 밴률, KDA, 게임 수 – 포지션, 티어, 지역별 필터.'],
    ['英雄联盟英雄数据 – 胜率、选取率与禁用率', '所有英雄联盟英雄的胜率、选取率、禁用率、KDA与场次，可按位置、段位和地区筛选。'],
    ['Estadísticas de campeones de LoL – winrate, pickrate y banrate', 'Todos los campeones de League of Legends con winrate, pickrate, banrate, KDA y partidas, filtrables por rol, rango y región.'],
    ['Stats des champions LoL – winrate, pickrate et banrate', 'Tous les champions de League of Legends avec winrate, pickrate, banrate, KDA et parties jouées, filtrables par rôle, rang et région.'],
  ),
  'lol.champion': six(
    ['{name} Build & Runen – LoL Champion-Guide', '{name} in League of Legends: Builds und Runen aus Ranked-Spielen nach Region und Rang, dazu Grundwerte, Fähigkeiten, Tipps, Skins und Lore.'],
    ['{name} Build & Runes – LoL Champion Guide', '{name} in League of Legends: builds and runes from ranked games by region and rank, plus base stats, abilities, tips, skins and lore.'],
    ['{name} 빌드 & 룬 – LoL 챔피언 가이드', '리그 오브 레전드 {name}: 지역·티어별 랭크 게임 빌드와 룬, 기본 능력치, 스킬, 팁, 스킨, 배경 이야기.'],
    ['{name} 出装与符文 – 英雄联盟英雄攻略', '英雄联盟 {name}：按地区和段位统计的排位出装与符文，以及基础属性、技能、技巧、皮肤和背景故事。'],
    ['{name}: build y runas – guía de campeón de LoL', '{name} en League of Legends: builds y runas de partidas clasificatorias por región y rango, además de estadísticas base, habilidades, consejos, skins e historia.'],
    ['{name} : build et runes – guide de champion LoL', '{name} dans League of Legends : builds et runes issus des parties classées par région et rang, plus statistiques de base, compétences, conseils, skins et histoire.'],
  ),
  'lol.marktwert': six(
    ['LoL Marktwerte – KI-Bewertung der Spieler', 'KI-berechnete Marktwerte für League-of-Legends-Spieler: Top 25, Gewinner und Verlierer der Woche, Durchschnitt je Rang und Transfer-Radar, nach Region und Elo.'],
    ['LoL Market Values – AI Player Valuations', 'AI-calculated market values for League of Legends players: top 25, weekly gainers and losers, averages per tier and transfer radar, by region and elo.'],
    ['LoL 시장 가치 – AI 플레이어 평가', 'AI로 산정한 리그 오브 레전드 플레이어 시장 가치: 상위 25명, 주간 상승·하락, 티어별 평균, 이적 레이더. 지역과 엘로별.'],
    ['英雄联盟市场价值 – AI玩家估值', '由AI计算的英雄联盟玩家市场价值：前25名、每周涨跌榜、各段位平均值与转会雷达，可按地区和分段筛选。'],
    ['Valores de mercado de LoL – valoración de jugadores con IA', 'Valores de mercado calculados por IA para jugadores de League of Legends: top 25, subidas y bajadas semanales, media por liga y radar de fichajes, por región y elo.'],
    ['Valeurs marchandes LoL – évaluation des joueurs par IA', 'Valeurs marchandes calculées par IA pour les joueurs de League of Legends : top 25, hausses et baisses de la semaine, moyenne par rang et radar des transferts, par région et elo.'],
  ),
  'lol.teams': six(
    ['LoL Pro-Teams – Kader, Titel & Preisgeld', 'Professionelle League-of-Legends-Teams aus KR, CN, EU, NA und weiteren Regionen mit Spielern, Staff, Titeln und Preisgeld.'],
    ['LoL Pro Teams – Rosters, Titles & Prize Money', 'Professional League of Legends teams from KR, CN, EU, NA and more regions with players, staff, titles and prize money.'],
    ['LoL 프로팀 – 로스터, 우승, 상금', 'KR, CN, EU, NA 등 여러 지역의 리그 오브 레전드 프로팀: 선수, 스태프, 우승 기록, 상금.'],
    ['英雄联盟职业战队 – 阵容、冠军与奖金', '来自KR、CN、EU、NA等地区的英雄联盟职业战队：选手、教练组、冠军头衔与奖金。'],
    ['Equipos pro de LoL – plantillas, títulos y premios', 'Equipos profesionales de League of Legends de KR, CN, EU, NA y otras regiones con jugadores, staff, títulos y premios.'],
    ['Équipes pro LoL – effectifs, titres et gains', 'Équipes professionnelles de League of Legends de KR, CN, EU, NA et d\'autres régions avec joueurs, staff, titres et gains.'],
  ),
  'lol.team': six(
    ['{name} – LoL Team, Kader & Turniere', '{name}: aktueller Kader, Ersatzspieler und Staff, Titel, Preisgeld und Turnierhistorie mit Platzierungen.'],
    ['{name} – LoL Team, Roster & Tournaments', '{name}: current roster, substitutes and staff, titles, prize money and tournament history with placements.'],
    ['{name} – LoL 팀, 로스터 & 대회', '{name}: 현재 로스터, 후보 선수와 스태프, 우승, 상금, 순위가 포함된 대회 기록.'],
    ['{name} – 英雄联盟战队、阵容与赛事', '{name}：当前阵容、替补与教练组、冠军头衔、奖金及含名次的赛事记录。'],
    ['{name} – equipo de LoL, plantilla y torneos', '{name}: plantilla actual, suplentes y staff, títulos, premios e historial de torneos con posiciones.'],
    ['{name} – équipe LoL, effectif et tournois', '{name} : effectif actuel, remplaçants et staff, titres, gains et historique des tournois avec classements.'],
  ),
  'lol.ligen': six(
    ['LoL Ligen & Wettbewerbe – Spielplan, Tabellen & Ergebnisse', 'League-of-Legends-E-Sport im Überblick: Kalender nach Woche und Monat, alle Ligen, Tabellen, kommende Spiele und Ergebnisse.'],
    ['LoL Leagues & Competitions – Schedule, Standings & Results', 'League of Legends esports at a glance: weekly and monthly calendar, all leagues, standings, upcoming matches and results.'],
    ['LoL 리그 & 대회 – 일정, 순위, 결과', '리그 오브 레전드 e스포츠 한눈에 보기: 주간·월간 일정, 모든 리그, 순위표, 예정 경기와 결과.'],
    ['英雄联盟联赛与赛事 – 赛程、积分榜与结果', '英雄联盟电竞一览：按周和月的赛程、所有联赛、积分榜、即将进行的比赛与赛果。'],
    ['Ligas y competiciones de LoL – calendario, clasificación y resultados', 'Los esports de League of Legends de un vistazo: calendario semanal y mensual, todas las ligas, clasificaciones, próximos partidos y resultados.'],
    ['Ligues et compétitions LoL – calendrier, classements et résultats', 'L\'esport League of Legends en un coup d\'œil : calendrier hebdomadaire et mensuel, toutes les ligues, classements, matchs à venir et résultats.'],
  ),
  'lol.compare': six(
    ['LoL Spielervergleich – zwei Spieler im direkten Duell', 'Zwei League-of-Legends-Spieler direkt vergleichen: Rang, Winrate, KDA, CS und Schaden pro Minute, Vision, Marktwert, Form und Champion-Pool.'],
    ['LoL Player Comparison – Head-to-Head', 'Compare two League of Legends players head-to-head: rank, winrate, KDA, CS and damage per minute, vision, market value, form and champion pool.'],
    ['LoL 선수 비교 – 1대1 비교', '리그 오브 레전드 플레이어 두 명을 직접 비교: 티어, 승률, KDA, 분당 CS와 피해량, 시야, 시장 가치, 최근 폼, 챔피언 폭.'],
    ['英雄联盟选手对比 – 正面对决', '直接对比两名英雄联盟玩家：段位、胜率、KDA、每分钟补刀与伤害、视野、市场价值、近期状态与英雄池。'],
    ['Comparación de jugadores de LoL – cara a cara', 'Compara a dos jugadores de League of Legends cara a cara: rango, winrate, KDA, CS y daño por minuto, visión, valor de mercado, forma y campeones.'],
    ['Comparaison de joueurs LoL – face à face', 'Comparez deux joueurs de League of Legends face à face : rang, winrate, KDA, CS et dégâts par minute, vision, valeur marchande, forme et pool de champions.'],
  ),
  'lol.player': six(
    ['{name} – LoL Profil, Match History & Marktwert', 'League-of-Legends-Profil von {name}: Rang, Winrate, KDA, KI-Marktwert mit Verlauf, Champion-Statistiken, Meisterschaft und Match History.'],
    ['{name} – LoL Profile, Match History & Market Value', 'League of Legends profile of {name}: rank, winrate, KDA, AI market value with history, champion stats, mastery and match history.'],
    ['{name} – LoL 프로필, 매치 기록 & 시장 가치', '{name}의 리그 오브 레전드 프로필: 티어, 승률, KDA, AI 시장 가치와 추이, 챔피언 통계, 숙련도, 매치 기록.'],
    ['{name} – 英雄联盟资料、比赛记录与市场价值', '{name} 的英雄联盟资料：段位、胜率、KDA、AI市场价值及走势、英雄数据、熟练度与比赛记录。'],
    ['{name} – perfil de LoL, historial y valor de mercado', 'Perfil de League of Legends de {name}: rango, winrate, KDA, valor de mercado por IA con evolución, estadísticas de campeones, maestría e historial de partidas.'],
    ['{name} – profil LoL, historique et valeur marchande', 'Profil League of Legends de {name} : rang, winrate, KDA, valeur marchande IA avec historique, stats des champions, maîtrise et historique des matchs.'],
  ),
  'legal.imprint': six(
    ['Impressum', 'Impressum von metastats.gg: Anbieter, Kontakt, verantwortliche Person, Haftungsausschluss, Riot-Games-Hinweis und Urheberrecht.'],
    ['Imprint', 'Legal notice of metastats.gg: provider, contact, responsible person, disclaimer, Riot Games notice and copyright.'],
    ['법적 고지', 'metastats.gg 법적 고지: 운영자, 연락처, 책임자, 면책 조항, Riot Games 고지, 저작권.'],
    ['法律声明', 'metastats.gg 法律声明：运营方、联系方式、负责人、免责声明、Riot Games 声明与版权。'],
    ['Aviso legal', 'Aviso legal de metastats.gg: proveedor, contacto, responsable, exención de responsabilidad, aviso de Riot Games y derechos de autor.'],
    ['Mentions légales', 'Mentions légales de metastats.gg : éditeur, contact, responsable, avertissement, mention Riot Games et droits d\'auteur.'],
  ),
  'legal.privacy': six(
    ['Datenschutzerklärung', 'Datenschutzerklärung von metastats.gg: welche Daten erhoben werden, Auftragsverarbeiter, Cookies, Speicherdauer und deine Rechte.'],
    ['Privacy Policy', 'Privacy policy of metastats.gg: what data is collected, processors, cookies, retention and your rights.'],
    ['개인정보처리방침', 'metastats.gg 개인정보처리방침: 수집하는 데이터, 처리 위탁업체, 쿠키, 보관 기간, 이용자 권리.'],
    ['隐私政策', 'metastats.gg 隐私政策：收集的数据、数据处理方、Cookie、保存期限及你的权利。'],
    ['Política de privacidad', 'Política de privacidad de metastats.gg: qué datos se recogen, encargados del tratamiento, cookies, conservación y tus derechos.'],
    ['Politique de confidentialité', 'Politique de confidentialité de metastats.gg : données collectées, sous-traitants, cookies, durée de conservation et vos droits.'],
  ),

  // ---------------- Teamfight Tactics ----------------
  'tft.comps': six(
    ['TFT Comps Tier-Liste – beste Teams in {set}', 'Die meistgespielten Teamfight-Tactics-Comps aus Ranked-Spielen mit Tier, Ø-Platzierung, Top-4-Rate, Winrate und Pickrate – nach Patch, Rang und Region.'],
    ['TFT Comps Tier List – Best Team Comps in {set}', 'The most played Teamfight Tactics comps from ranked games with tier, average placement, top 4 rate, win rate and pick rate – by patch, rank and region.'],
    ['TFT 조합 티어 리스트 – {set} 최고의 조합', '랭크 게임에서 가장 많이 플레이된 전략적 팀 전투 조합: 티어, 평균 순위, 4등 안 비율, 승률, 픽률 – 패치, 티어, 지역별.'],
    ['云顶之弈阵容排行 – {set} 最强阵容', '排位对局中最常用的云顶之弈阵容：评级、平均名次、前四率、胜率与选取率，可按版本、段位和地区筛选。'],
    ['Tier list de comps de TFT – mejores equipos de {set}', 'Las comps de Teamfight Tactics más jugadas en clasificatorias con tier, posición media, tasa de top 4, winrate y pickrate, por parche, rango y región.'],
    ['Tier list des compos TFT – meilleures compos de {set}', 'Les compos Teamfight Tactics les plus jouées en classée avec tier, placement moyen, taux de top 4, winrate et pickrate, par patch, rang et région.'],
  ),
  'tft.comps.atlas': six(
    ['TFT Comps Übersicht – Meta nach Carry-Kosten', 'Alle aktuellen Teamfight-Tactics-Comps auf einen Blick, geordnet nach den Kosten des Haupt-Carrys, mit Ø-Platzierung und Trend.'],
    ['TFT Comps Overview – Meta by Carry Cost', 'Every current Teamfight Tactics comp at a glance, grouped by the cost of the main carry, with average placement and trend.'],
    ['TFT 조합 개요 – 캐리 코스트별 메타', '현재 전략적 팀 전투의 모든 조합을 한눈에: 메인 캐리 코스트별로 정리, 평균 순위와 추세 포함.'],
    ['云顶之弈阵容总览 – 按主C费用划分的Meta', '一览所有当前云顶之弈阵容，按主C费用分组，附平均名次与趋势。'],
    ['Resumen de comps de TFT – meta por coste del carry', 'Todas las comps actuales de Teamfight Tactics de un vistazo, agrupadas por el coste del carry principal, con posición media y tendencia.'],
    ['Aperçu des compos TFT – méta par coût du carry', 'Toutes les compos Teamfight Tactics actuelles en un coup d\'œil, regroupées par coût du carry principal, avec placement moyen et tendance.'],
  ),
  'tft.comps.community': six(
    ['TFT Community-Comps – Teams der Spieler', 'Von Spielern im Comp-Builder erstellte Teamfight-Tactics-Comps mit Units, Items, Aufrufen und Upvotes – sortiert nach Top oder Neu.'],
    ['TFT Community Comps – Player-Made Teams', 'Teamfight Tactics comps built by players in the comp builder, with units, items, views and upvotes – sorted by top or newest.'],
    ['TFT 커뮤니티 조합 – 플레이어가 만든 조합', '플레이어가 조합 빌더로 만든 전략적 팀 전투 조합: 유닛, 아이템, 조회수, 추천 – 인기순 또는 최신순.'],
    ['云顶之弈社区阵容 – 玩家自建阵容', '玩家在阵容构建器中创建的云顶之弈阵容，含单位、装备、浏览量与点赞，可按热门或最新排序。'],
    ['Comps de la comunidad de TFT – equipos de jugadores', 'Comps de Teamfight Tactics creadas por jugadores en el editor, con unidades, ítems, visitas y votos, ordenadas por populares o recientes.'],
    ['Compos communauté TFT – équipes des joueurs', 'Compos Teamfight Tactics créées par les joueurs dans l\'éditeur, avec unités, objets, vues et votes, triées par popularité ou nouveauté.'],
  ),
  'tft.comps.compare': six(
    ['TFT Comp-Vergleich – zwei Comps im Duell', 'Zwei Teamfight-Tactics-Comps direkt vergleichen: Urteil, Aufstellung, direktes Duell, Bauteile, Risiko, Platzierungsverteilung und Verlauf über 7 Tage.'],
    ['TFT Comp Comparison – Two Comps Head-to-Head', 'Compare two Teamfight Tactics comps directly: verdict, boards, head-to-head duel, components, risk, placement distribution and 7-day trend.'],
    ['TFT 조합 비교 – 두 조합의 맞대결', '전략적 팀 전투 조합 두 개를 직접 비교: 결론, 배치, 맞대결, 아이템 재료, 위험도, 순위 분포, 7일 추세.'],
    ['云顶之弈阵容对比 – 两套阵容正面较量', '直接对比两套云顶之弈阵容：结论、站位、对位、装备散件、风险、名次分布与7天走势。'],
    ['Comparación de comps de TFT – dos comps cara a cara', 'Compara dos comps de Teamfight Tactics: veredicto, tableros, duelo directo, componentes, riesgo, distribución de posiciones y tendencia de 7 días.'],
    ['Comparaison de compos TFT – deux compos face à face', 'Comparez deux compos Teamfight Tactics : verdict, plateaux, duel direct, composants, risque, répartition des placements et tendance sur 7 jours.'],
  ),
  'tft.comp': six(
    ['{name} – TFT Comp Guide: Aufstellung & Items', '{name} in Teamfight Tactics: Aufstellung mit Core- und Flex-Units, Positionierung, Items je Unit, Leveln, Gegner-Duelle und Ø-Platzierung aus Ranked-Spielen.'],
    ['{name} – TFT Comp Guide: Board & Items', '{name} in Teamfight Tactics: board with core and flex units, positioning, items per unit, leveling, matchups and average placement from ranked games.'],
    ['{name} – TFT 조합 공략: 배치 & 아이템', '전략적 팀 전투 {name}: 코어·플렉스 유닛 배치, 포지셔닝, 유닛별 아이템, 레벨업, 상대 조합과 랭크 게임 평균 순위.'],
    ['{name} – 云顶之弈阵容攻略：站位与装备', '云顶之弈 {name}：核心与灵活单位站位、各单位装备、升级节奏、对位阵容以及排位平均名次。'],
    ['{name} – guía de comp de TFT: tablero e ítems', '{name} en Teamfight Tactics: tablero con unidades core y flex, posicionamiento, ítems por unidad, niveles, enfrentamientos y posición media en clasificatorias.'],
    ['{name} – guide de compo TFT : plateau et objets', '{name} dans Teamfight Tactics : plateau avec unités core et flex, placement, objets par unité, montée de niveau, confrontations et placement moyen en classée.'],
  ),
  'tft.units': six(
    ['TFT Units Tier-Liste {set} – Stats & beste Items', 'Alle Teamfight-Tactics-Units mit Tier, besten Items, Ø-Platzierung, Pickrate, Top-4-Rate und Winrate – filterbar nach Kosten, Trait, Patch, Rang und Region.'],
    ['TFT Units Tier List {set} – Stats & Best Items', 'Every Teamfight Tactics unit with tier, best items, average placement, pick rate, top 4 rate and win rate – filter by cost, trait, patch, rank and region.'],
    ['TFT 유닛 티어 리스트 {set} – 통계 & 추천 아이템', '모든 전략적 팀 전투 유닛의 티어, 추천 아이템, 평균 순위, 픽률, 4등 안 비율, 승률 – 코스트, 시너지, 패치, 티어, 지역별 필터.'],
    ['云顶之弈单位排行 {set} – 数据与最佳装备', '所有云顶之弈单位的评级、最佳装备、平均名次、选取率、前四率与胜率，可按费用、羁绊、版本、段位和地区筛选。'],
    ['Tier list de unidades de TFT {set} – stats y mejores ítems', 'Todas las unidades de Teamfight Tactics con tier, mejores ítems, posición media, pickrate, tasa de top 4 y winrate, filtrables por coste, sinergia, parche, rango y región.'],
    ['Tier list des unités TFT {set} – stats et meilleurs objets', 'Toutes les unités Teamfight Tactics avec tier, meilleurs objets, placement moyen, pickrate, taux de top 4 et winrate, filtrables par coût, synergie, patch, rang et région.'],
  ),
  'tft.unit': six(
    ['{name} – TFT Unit Build, Items & Stats', '{name} in Teamfight Tactics: beste Item-Builds nach Sternstufe, Ø-Platzierung, Top-4- und Winrate, Verlauf über die letzten Patches und Comps mit {name}.'],
    ['{name} – TFT Unit Build, Items & Stats', '{name} in Teamfight Tactics: best item builds by star level, average placement, top 4 and win rate, trend over recent patches and comps with {name}.'],
    ['{name} – TFT 유닛 빌드, 아이템 & 통계', '전략적 팀 전투 {name}: 별 등급별 최고 아이템 빌드, 평균 순위, 4등 안 비율과 승률, 최근 패치 추이, {name} 포함 조합.'],
    ['{name} – 云顶之弈单位出装、装备与数据', '云顶之弈 {name}：按星级的最佳出装、平均名次、前四率与胜率、近期版本走势以及含 {name} 的阵容。'],
    ['{name} – build, ítems y stats de TFT', '{name} en Teamfight Tactics: mejores builds de ítems por nivel de estrella, posición media, tasa de top 4 y winrate, evolución en los últimos parches y comps con {name}.'],
    ['{name} – build, objets et stats TFT', '{name} dans Teamfight Tactics : meilleurs builds d\'objets par niveau d\'étoile, placement moyen, taux de top 4 et winrate, évolution sur les derniers patchs et compos avec {name}.'],
  ),
  'tft.items': six(
    ['TFT Items Tier-Liste {set} – Stats & beste Träger', 'Alle Teamfight-Tactics-Items mit Tier, besten Trägern, Ø-Platzierung, Pickrate, Top-4-Rate und Winrate – Standard-Items, Artefakte, Embleme und strahlende Items.'],
    ['TFT Items Tier List {set} – Stats & Best Carriers', 'Every Teamfight Tactics item with tier, best carriers, average placement, pick rate, top 4 rate and win rate – standard items, artifacts, emblems and radiant items.'],
    ['TFT 아이템 티어 리스트 {set} – 통계 & 추천 유닛', '모든 전략적 팀 전투 아이템의 티어, 추천 착용 유닛, 평균 순위, 픽률, 4등 안 비율, 승률 – 일반, 유물, 상징, 찬란한 아이템.'],
    ['云顶之弈装备排行 {set} – 数据与最佳携带者', '所有云顶之弈装备的评级、最佳携带单位、平均名次、选取率、前四率与胜率，含普通装备、神器、纹章与光明装备。'],
    ['Tier list de ítems de TFT {set} – stats y mejores portadores', 'Todos los ítems de Teamfight Tactics con tier, mejores portadores, posición media, pickrate, tasa de top 4 y winrate: ítems estándar, artefactos, emblemas y radiantes.'],
    ['Tier list des objets TFT {set} – stats et meilleurs porteurs', 'Tous les objets Teamfight Tactics avec tier, meilleurs porteurs, placement moyen, pickrate, taux de top 4 et winrate : objets standard, artefacts, emblèmes et radieux.'],
  ),
  'tft.item': six(
    ['{name} – TFT Item: Rezept, Träger & Stats', '{name} in Teamfight Tactics: Beschreibung und Rezept, Ø-Platzierung und Top-4-Rate, beste Träger, Comps mit dem Item und starke Item-Kombinationen.'],
    ['{name} – TFT Item: Recipe, Carriers & Stats', '{name} in Teamfight Tactics: description and recipe, average placement and top 4 rate, best carriers, comps using the item and strong item combos.'],
    ['{name} – TFT 아이템: 조합법, 착용 유닛 & 통계', '전략적 팀 전투 {name}: 설명과 조합법, 평균 순위와 4등 안 비율, 추천 착용 유닛, 이 아이템을 쓰는 조합, 좋은 아이템 조합.'],
    ['{name} – 云顶之弈装备：合成、携带者与数据', '云顶之弈 {name}：说明与合成配方、平均名次与前四率、最佳携带单位、使用该装备的阵容及强力装备组合。'],
    ['{name} – ítem de TFT: receta, portadores y stats', '{name} en Teamfight Tactics: descripción y receta, posición media y tasa de top 4, mejores portadores, comps que lo usan y combinaciones de ítems fuertes.'],
    ['{name} – objet TFT : recette, porteurs et stats', '{name} dans Teamfight Tactics : description et recette, placement moyen et taux de top 4, meilleurs porteurs, compos qui l\'utilisent et combinaisons d\'objets fortes.'],
  ),
  'tft.traits': six(
    ['TFT Traits & Synergien {set} – Stufen & Stats', 'Alle Teamfight-Tactics-Traits mit Aktivierungsstufen, bester Stufe, Ø-Platzierung, Pickrate und Top-4-Rate – nach Patch, Rang und Region.'],
    ['TFT Traits {set} – Breakpoints & Stats', 'Every Teamfight Tactics trait with breakpoints, best activation level, average placement, pick rate and top 4 rate – by patch, rank and region.'],
    ['TFT 시너지 {set} – 단계 & 통계', '모든 전략적 팀 전투 시너지의 활성 단계, 최고 단계, 평균 순위, 픽률, 4등 안 비율 – 패치, 티어, 지역별.'],
    ['云顶之弈羁绊 {set} – 层级与数据', '所有云顶之弈羁绊的激活层级、最佳层级、平均名次、选取率与前四率，可按版本、段位和地区筛选。'],
    ['Sinergias de TFT {set} – niveles y stats', 'Todas las sinergias de Teamfight Tactics con niveles de activación, mejor nivel, posición media, pickrate y tasa de top 4, por parche, rango y región.'],
    ['Synergies TFT {set} – paliers et stats', 'Toutes les synergies Teamfight Tactics avec paliers d\'activation, meilleur palier, placement moyen, pickrate et taux de top 4, par patch, rang et région.'],
  ),
  'tft.trait': six(
    ['{name} – TFT Trait: Stufen, Units & Comps', '{name} in Teamfight Tactics: Beschreibung und Aktivierungsstufen, Stats je Stufe, beste Units und Comps mit {name}.'],
    ['{name} – TFT Trait: Breakpoints, Units & Comps', '{name} in Teamfight Tactics: description and breakpoints, stats per tier, best units and comps with {name}.'],
    ['{name} – TFT 시너지: 단계, 유닛 & 조합', '전략적 팀 전투 {name}: 설명과 활성 단계, 단계별 통계, 최고 유닛과 {name} 조합.'],
    ['{name} – 云顶之弈羁绊：层级、单位与阵容', '云顶之弈 {name}：说明与激活层级、各层级数据、最佳单位及含 {name} 的阵容。'],
    ['{name} – sinergia de TFT: niveles, unidades y comps', '{name} en Teamfight Tactics: descripción y niveles de activación, stats por nivel, mejores unidades y comps con {name}.'],
    ['{name} – synergie TFT : paliers, unités et compos', '{name} dans Teamfight Tactics : description et paliers d\'activation, stats par palier, meilleures unités et compos avec {name}.'],
  ),
  'tft.augments': six(
    ['TFT Augments {set} – alle Augments mit Stufe & Stage', 'Nachschlagewerk aller Teamfight-Tactics-Augments: Name, Stufe, mögliche Stages (2-1, 3-2, 4-2) und Beschreibung, filterbar und durchsuchbar.'],
    ['TFT Augments {set} – Every Augment by Tier & Stage', 'Reference of every Teamfight Tactics augment: name, tier, possible stages (2-1, 3-2, 4-2) and description, filterable and searchable.'],
    ['TFT 증강 {set} – 등급 & 스테이지별 전체 증강', '전략적 팀 전투 모든 증강 목록: 이름, 등급, 등장 가능 스테이지(2-1, 3-2, 4-2), 설명. 필터와 검색 지원.'],
    ['云顶之弈强化符文 {set} – 按等级与阶段的全部符文', '云顶之弈全部强化符文资料：名称、等级、可出现阶段（2-1、3-2、4-2）及说明，支持筛选与搜索。'],
    ['Aumentos de TFT {set} – todos por tier y fase', 'Referencia de todos los aumentos de Teamfight Tactics: nombre, tier, fases posibles (2-1, 3-2, 4-2) y descripción, con filtros y búsqueda.'],
    ['Augments TFT {set} – tous les augments par palier et étape', 'Référence de tous les augments Teamfight Tactics : nom, palier, étapes possibles (2-1, 3-2, 4-2) et description, filtrables et consultables.'],
  ),
  'tft.augment': six(
    ['{name} – TFT Augment: Wirkung & Stages', '{name} in Teamfight Tactics: Stufe, Beschreibung, Stages, in denen das Augment erscheinen kann, und Comps, die es spielen.'],
    ['{name} – TFT Augment: Effect & Stages', '{name} in Teamfight Tactics: tier, description, the stages it can appear in and comps that play it.'],
    ['{name} – TFT 증강: 효과 & 스테이지', '전략적 팀 전투 {name}: 등급, 설명, 등장 가능한 스테이지와 이 증강을 쓰는 조합.'],
    ['{name} – 云顶之弈强化符文：效果与阶段', '云顶之弈 {name}：等级、说明、可出现的阶段以及使用它的阵容。'],
    ['{name} – aumento de TFT: efecto y fases', '{name} en Teamfight Tactics: tier, descripción, fases en las que puede aparecer y comps que lo juegan.'],
    ['{name} – augment TFT : effet et étapes', '{name} dans Teamfight Tactics : palier, description, étapes où il peut apparaître et compos qui le jouent.'],
  ),
  'tft.leaderboard': six(
    ['TFT Rangliste – Challenger bis Iron weltweit & nach Region', 'Teamfight-Tactics-Rangliste weltweit und für 15 Regionen: LP, Spiele, Top-4-Rate und Marktwert der Spieler, filterbar nach Rang und Division.'],
    ['TFT Leaderboard – Challenger to Iron, Worldwide & by Region', 'Teamfight Tactics ranked leaderboard worldwide and for 15 regions: LP, games, top 4 rate and market value per player, filterable by tier and division.'],
    ['TFT 리더보드 – 전 세계 및 지역별 챌린저부터 아이언까지', '전 세계 및 15개 지역의 전략적 팀 전투 랭크 리더보드: 플레이어별 LP, 게임 수, 4등 안 비율, 시장 가치. 티어와 디비전으로 필터링.'],
    ['云顶之弈排行榜 – 全球及各地区王者至黑铁', '全球及15个地区的云顶之弈排位排行榜：每位玩家的LP、场次、前四率与市场价值，可按段位和分段筛选。'],
    ['Clasificación de TFT – de Challenger a Hierro, mundial y por región', 'Clasificación de Teamfight Tactics mundial y en 15 regiones: LP, partidas, tasa de top 4 y valor de mercado de cada jugador, filtrable por liga y división.'],
    ['Classement TFT – de Challenger à Fer, mondial et par région', 'Classement Teamfight Tactics mondial et sur 15 régions : LP, parties, taux de top 4 et valeur marchande de chaque joueur, filtrable par rang et division.'],
  ),
  'tft.marktwert': six(
    ['TFT Marktwerte – Wert der Master+-Spieler', 'Marktwerte der Teamfight-Tactics-Spieler ab Master: Top-Liste mit LP, Multiplikator und 14-Tage-Trend, größte Bewegungen und Verteilung, nach Region und Rang.'],
    ['TFT Market Values – Master+ Player Valuations', 'Market values of Teamfight Tactics players from Master up: top list with LP, multiplier and 14-day trend, biggest movers and distribution, by region and rank.'],
    ['TFT 시장 가치 – 마스터+ 플레이어 평가', '마스터 이상 전략적 팀 전투 플레이어의 시장 가치: LP, 배수, 14일 추세가 포함된 상위 목록, 최대 변동, 분포 – 지역과 티어별.'],
    ['云顶之弈市场价值 – 大师+玩家估值', '大师及以上云顶之弈玩家的市场价值：含LP、倍率与14天走势的排行、最大涨跌及分布，可按地区和段位筛选。'],
    ['Valores de mercado de TFT – jugadores Master+', 'Valores de mercado de los jugadores de Teamfight Tactics desde Master: ranking con LP, multiplicador y tendencia de 14 días, mayores movimientos y distribución, por región y rango.'],
    ['Valeurs marchandes TFT – joueurs Master+', 'Valeurs marchandes des joueurs Teamfight Tactics à partir de Master : classement avec LP, multiplicateur et tendance sur 14 jours, plus fortes variations et répartition, par région et rang.'],
  ),
  'tft.marktwert.methodik': six(
    ['Wie wird der TFT-Marktwert berechnet?', 'Die Berechnung des TFT-Marktwerts erklärt: Grundwert, z-Score, die sechs gewichteten Signale, Multiplikator und ein durchgerechnetes Beispiel.'],
    ['How Is the TFT Market Value Calculated?', 'The TFT market value explained: base value, z-score, the six weighted signals, multiplier and a worked example.'],
    ['TFT 시장 가치는 어떻게 계산되나요?', 'TFT 시장 가치 산정 방식: 기본값, z-점수, 가중치가 적용된 6가지 신호, 배수, 계산 예시.'],
    ['云顶之弈市场价值如何计算？', '云顶之弈市场价值计算说明：基础值、z分数、六项加权信号、倍率及完整示例。'],
    ['¿Cómo se calcula el valor de mercado de TFT?', 'El valor de mercado de TFT explicado: valor base, puntuación z, las seis señales ponderadas, multiplicador y un ejemplo completo.'],
    ['Comment la valeur marchande TFT est-elle calculée ?', 'La valeur marchande TFT expliquée : valeur de base, score z, les six signaux pondérés, multiplicateur et un exemple détaillé.'],
  ),
  'tft.rising': six(
    ['TFT Aufsteiger – größte LP-Gewinne', 'Teamfight-Tactics-Spieler mit den größten LP-Gewinnen der letzten 1, 3 oder 5 Tage je Region – mit Rang vorher und nachher, Spielen, Ø-Platzierung und Lieblings-Comp.'],
    ['TFT Rising Players – Biggest LP Gains', 'Teamfight Tactics players with the biggest LP gains over the last 1, 3 or 5 days per region – with rank before and after, games, average placement and top comp.'],
    ['TFT 급상승 플레이어 – 최대 LP 상승', '지역별 최근 1·3·5일 동안 LP가 가장 많이 오른 전략적 팀 전투 플레이어: 이전·현재 티어, 게임 수, 평균 순위, 주력 조합.'],
    ['云顶之弈上升最快的玩家 – LP涨幅最大', '各地区最近1、3或5天LP涨幅最大的云顶之弈玩家：前后段位、场次、平均名次与常用阵容。'],
    ['Jugadores en ascenso de TFT – mayores subidas de LP', 'Jugadores de Teamfight Tactics con las mayores subidas de LP en los últimos 1, 3 o 5 días por región, con rango antes y después, partidas, posición media y comp principal.'],
    ['Joueurs en progression TFT – plus gros gains de LP', 'Joueurs Teamfight Tactics avec les plus gros gains de LP sur les 1, 3 ou 5 derniers jours par région, avec rang avant et après, parties, placement moyen et compo principale.'],
  ),
  'tft.patch': six(
    ['TFT Patch-Übersicht – alle Patches & Patch Notes', 'Alle Teamfight-Tactics-Patches der letzten Monate mit Set, Zeitraum, Anzahl ausgewerteter Spiele und Link zu den offiziellen Patch Notes.'],
    ['TFT Patch Overview – All Patches & Patch Notes', 'Every Teamfight Tactics patch of recent months with set, date range, number of analyzed games and a link to the official patch notes.'],
    ['TFT 패치 개요 – 전체 패치 & 패치 노트', '최근 몇 달간 전략적 팀 전투의 모든 패치: 세트, 기간, 분석된 게임 수, 공식 패치 노트 링크.'],
    ['云顶之弈版本概览 – 全部版本与更新公告', '近几个月所有云顶之弈版本：所属赛季、时间范围、分析对局数及官方更新公告链接。'],
    ['Resumen de parches de TFT – todos los parches y notas', 'Todos los parches de Teamfight Tactics de los últimos meses con set, fechas, número de partidas analizadas y enlace a las notas oficiales.'],
    ['Aperçu des patchs TFT – tous les patchs et notes', 'Tous les patchs Teamfight Tactics des derniers mois avec set, période, nombre de parties analysées et lien vers les notes officielles.'],
  ),
  'tft.patchVersion': six(
    ['TFT Patch {name} – Änderungen, Gewinner & Verlierer', 'Teamfight-Tactics-Patch {name}: alle Änderungen und welche Units, Items, Traits und Comps gegenüber dem Vorpatch gewonnen oder verloren haben.'],
    ['TFT Patch {name} – Changes, Winners & Losers', 'Teamfight Tactics patch {name}: every change and which units, items, traits and comps gained or lost compared to the previous patch.'],
    ['TFT 패치 {name} – 변경 사항, 승자 & 패자', '전략적 팀 전투 {name} 패치: 모든 변경 사항과 이전 패치 대비 강해지거나 약해진 유닛, 아이템, 시너지, 조합.'],
    ['云顶之弈 {name} 版本 – 改动、赢家与输家', '云顶之弈 {name} 版本：全部改动，以及与上一版本相比变强或变弱的单位、装备、羁绊和阵容。'],
    ['Parche {name} de TFT – cambios, ganadores y perdedores', 'Parche {name} de Teamfight Tactics: todos los cambios y qué unidades, ítems, sinergias y comps ganaron o perdieron frente al parche anterior.'],
    ['Patch {name} TFT – changements, gagnants et perdants', 'Patch {name} de Teamfight Tactics : tous les changements et les unités, objets, synergies et compos gagnantes ou perdantes par rapport au patch précédent.'],
  ),
  'tft.patchWinners': six(
    ['TFT Patch-Gewinner & -Verlierer', 'Welche Teamfight-Tactics-Units, Items, Traits und Comps im letzten Patch besser oder schlechter platzieren – Ø-Platzierung vorher und nachher, Pickrate und Veränderung.'],
    ['TFT Patch Winners & Losers', 'Which Teamfight Tactics units, items, traits and comps place better or worse on the latest patch – average placement before and after, pick rate and change.'],
    ['TFT 패치 승자 & 패자', '최신 패치에서 순위가 오르거나 떨어진 전략적 팀 전투 유닛, 아이템, 시너지, 조합: 이전·이후 평균 순위, 픽률, 변화량.'],
    ['云顶之弈版本赢家与输家', '最新版本中名次变好或变差的云顶之弈单位、装备、羁绊与阵容：前后平均名次、选取率与变化。'],
    ['Ganadores y perdedores del parche de TFT', 'Qué unidades, ítems, sinergias y comps de Teamfight Tactics quedan mejor o peor en el último parche: posición media antes y después, pickrate y cambio.'],
    ['Gagnants et perdants du patch TFT', 'Quelles unités, objets, synergies et compos Teamfight Tactics se placent mieux ou moins bien au dernier patch : placement moyen avant et après, pickrate et variation.'],
  ),
  'tft.metaPulse': six(
    ['TFT Meta Pulse – Aufsteiger, Gewinner & Verlierer', 'Der Puls der Teamfight-Tactics-Meta: aufsteigende Comps, Patch-Gewinner und -Verlierer mit Ø-Platzierung und Veränderung, dazu der Vergleich der Regionen.'],
    ['TFT Meta Pulse – Rising Comps, Winners & Losers', 'The pulse of the Teamfight Tactics meta: rising comps, patch winners and losers with average placement and change, plus a region comparison.'],
    ['TFT 메타 펄스 – 상승 조합, 승자 & 패자', '전략적 팀 전투 메타의 흐름: 상승 중인 조합, 패치 승자와 패자의 평균 순위와 변화량, 지역 비교.'],
    ['云顶之弈Meta脉搏 – 上升阵容、赢家与输家', '云顶之弈Meta动向：上升阵容、版本赢家与输家的平均名次与变化，以及地区对比。'],
    ['Meta Pulse de TFT – comps en alza, ganadores y perdedores', 'El pulso del meta de Teamfight Tactics: comps en alza, ganadores y perdedores del parche con posición media y cambio, más una comparación por regiones.'],
    ['Pouls de la méta TFT – compos en hausse, gagnants et perdants', 'Le pouls de la méta Teamfight Tactics : compos en hausse, gagnants et perdants du patch avec placement moyen et variation, plus une comparaison des régions.'],
  ),
  'tft.regions': six(
    ['TFT Regionen-Meta – KR, EUW und NA im Vergleich', 'Welche Teamfight-Tactics-Comps in Korea, Europa West und Nordamerika unterschiedlich gut laufen: Ø-Platzierung, Pickrate und Spiele je Region.'],
    ['TFT Region Meta – KR, EUW and NA Compared', 'Which Teamfight Tactics comps perform differently in Korea, Europe West and North America: average placement, pick rate and games per region.'],
    ['TFT 지역별 메타 – KR, EUW, NA 비교', '한국, 유럽 서부, 북미에서 성적이 다른 전략적 팀 전투 조합: 지역별 평균 순위, 픽률, 게임 수.'],
    ['云顶之弈地区Meta – KR、EUW与NA对比', '在韩国、欧洲西部和北美表现不同的云顶之弈阵容：各地区平均名次、选取率与场次。'],
    ['Meta por región de TFT – KR, EUW y NA comparadas', 'Qué comps de Teamfight Tactics rinden distinto en Corea, Europa Oeste y Norteamérica: posición media, pickrate y partidas por región.'],
    ['Méta par région TFT – KR, EUW et NA comparées', 'Quelles compos Teamfight Tactics performent différemment en Corée, Europe Ouest et Amérique du Nord : placement moyen, pickrate et parties par région.'],
  ),
  'tft.tournaments': six(
    ['TFT Turniere – Live, kommende & vergangene Events', 'Teamfight-Tactics-Turniere aus aller Welt: live, kommend und vergangen, mit Tier, Region, Datum, Format, Teilnehmern und Preisgeld.'],
    ['TFT Tournaments – Live, Upcoming & Past Events', 'Teamfight Tactics tournaments worldwide: live, upcoming and past, with tier, region, dates, format, participants and prize pool.'],
    ['TFT 토너먼트 – 진행 중, 예정, 지난 대회', '전 세계 전략적 팀 전투 대회: 진행 중, 예정, 종료된 대회의 등급, 지역, 날짜, 방식, 참가자, 상금.'],
    ['云顶之弈赛事 – 进行中、即将开始与已结束', '全球云顶之弈赛事：进行中、即将开始和已结束的赛事，含级别、地区、日期、赛制、参赛者与奖金。'],
    ['Torneos de TFT – en directo, próximos y pasados', 'Torneos de Teamfight Tactics de todo el mundo: en directo, próximos y pasados, con tier, región, fechas, formato, participantes y premios.'],
    ['Tournois TFT – en direct, à venir et passés', 'Tournois Teamfight Tactics du monde entier : en direct, à venir et passés, avec tier, région, dates, format, participants et cagnotte.'],
  ),
  'tft.tournament': six(
    ['{name} – TFT Turnier: Ergebnisse & Tabelle', '{name} in Teamfight Tactics: Region, Datum, Format und Preisgeld, Live-Punktetabelle und Endplatzierungen mit Spielern, Teams und Preisgeld.'],
    ['{name} – TFT Tournament: Results & Standings', '{name} in Teamfight Tactics: region, dates, format and prize pool, live points table and final standings with players, teams and prize money.'],
    ['{name} – TFT 토너먼트: 결과 & 순위', '전략적 팀 전투 {name}: 지역, 날짜, 방식, 상금, 실시간 점수표와 선수·팀·상금이 포함된 최종 순위.'],
    ['{name} – 云顶之弈赛事：结果与积分榜', '云顶之弈 {name}：地区、日期、赛制与奖金，实时积分榜及含选手、战队与奖金的最终排名。'],
    ['{name} – torneo de TFT: resultados y clasificación', '{name} de Teamfight Tactics: región, fechas, formato y premios, tabla de puntos en directo y clasificación final con jugadores, equipos y premios.'],
    ['{name} – tournoi TFT : résultats et classement', '{name} de Teamfight Tactics : région, dates, format et cagnotte, tableau des points en direct et classement final avec joueurs, équipes et gains.'],
  ),
  'tft.builder': six(
    ['TFT Comp-Builder – Team planen & teilen', 'Interaktiver Teamfight-Tactics-Team-Planer: Units auf dem Hex-Brett platzieren, Items und Sternstufen setzen, Synergien live sehen, speichern und per Link teilen.'],
    ['TFT Comp Builder – Plan & Share Your Team', 'Interactive Teamfight Tactics team planner: place units on the hex board, set items and star levels, see traits live, save and share via link.'],
    ['TFT 조합 빌더 – 조합 계획 & 공유', '전략적 팀 전투 조합 계획 도구: 육각 보드에 유닛 배치, 아이템과 별 등급 설정, 시너지 실시간 확인, 저장 및 링크 공유.'],
    ['云顶之弈阵容构建器 – 规划并分享阵容', '交互式云顶之弈阵容规划工具：在六边形棋盘上摆放单位，设置装备和星级，实时查看羁绊，保存并通过链接分享。'],
    ['Editor de comps de TFT – planifica y comparte tu equipo', 'Planificador interactivo de Teamfight Tactics: coloca unidades en el tablero hexagonal, elige ítems y estrellas, ve las sinergias en directo, guarda y comparte por enlace.'],
    ['Éditeur de compos TFT – planifie et partage ton équipe', 'Planificateur interactif Teamfight Tactics : place des unités sur le plateau hexagonal, choisis objets et étoiles, vois les synergies en direct, enregistre et partage par lien.'],
  ),
  'tft.compare': six(
    ['TFT Spielervergleich – bis zu 4 Spieler', 'Bis zu vier Teamfight-Tactics-Spieler vergleichen: Rang, Platzierungen, Form, Marktwert mit Verlauf, gemeinsame Lobbys, Traits, Units und Spielstil.'],
    ['TFT Player Comparison – Up to 4 Players', 'Compare up to four Teamfight Tactics players: rank, placements, form, market value history, shared lobbies, traits, units and playstyle.'],
    ['TFT 플레이어 비교 – 최대 4명', '전략적 팀 전투 플레이어를 최대 4명까지 비교: 티어, 순위, 폼, 시장 가치 추이, 같은 로비 기록, 시너지, 유닛, 플레이 스타일.'],
    ['云顶之弈玩家对比 – 最多4名玩家', '最多对比四名云顶之弈玩家：段位、名次、状态、市场价值走势、同局记录、羁绊、单位与打法风格。'],
    ['Comparación de jugadores de TFT – hasta 4 jugadores', 'Compara hasta cuatro jugadores de Teamfight Tactics: rango, posiciones, forma, evolución del valor de mercado, lobbies compartidos, sinergias, unidades y estilo de juego.'],
    ['Comparaison de joueurs TFT – jusqu\'à 4 joueurs', 'Comparez jusqu\'à quatre joueurs Teamfight Tactics : rang, placements, forme, historique de la valeur marchande, lobbys communs, synergies, unités et style de jeu.'],
  ),
  'tft.explorer': six(
    ['TFT Daten-Explorer – eigene Auswertungen', 'Teamfight-Tactics-Spiele selbst auswerten: Patch, Region und Rang wählen, Units, Items und Traits ein- oder ausschließen und Ø-Platzierung samt Verteilung sehen.'],
    ['TFT Data Explorer – Build Your Own Stats', 'Analyze Teamfight Tactics games yourself: pick patch, region and rank, include or exclude units, items and traits and see average placement and its distribution.'],
    ['TFT 데이터 탐색기 – 직접 만드는 통계', '전략적 팀 전투 게임을 직접 분석: 패치, 지역, 티어 선택, 유닛·아이템·시너지 포함 또는 제외, 평균 순위와 분포 확인.'],
    ['云顶之弈数据探索 – 自定义统计', '自行分析云顶之弈对局：选择版本、地区和段位，包含或排除单位、装备与羁绊，查看平均名次及其分布。'],
    ['Explorador de datos de TFT – crea tus propias stats', 'Analiza partidas de Teamfight Tactics: elige parche, región y rango, incluye o excluye unidades, ítems y sinergias y ve la posición media y su distribución.'],
    ['Explorateur de données TFT – tes propres stats', 'Analyse toi-même les parties Teamfight Tactics : choisis patch, région et rang, inclus ou exclus unités, objets et synergies et vois le placement moyen et sa répartition.'],
  ),
  'tft.odds': six(
    ['TFT Roll-Wahrscheinlichkeiten – Rechner', 'Rechner für Teamfight-Tactics-Shop-Chancen: Wahrscheinlichkeit je Shop, erwartete Rolls und Gold bis zum nächsten Treffer, 2★ und 3★, dazu die Shop-Odds je Level.'],
    ['TFT Roll Odds Calculator', 'Calculator for Teamfight Tactics shop odds: chance per shop, expected rolls and gold to your next hit, 2★ and 3★, plus shop odds per level.'],
    ['TFT 롤 확률 계산기', '전략적 팀 전투 상점 확률 계산기: 상점당 확률, 다음 등장·2성·3성까지 예상 리롤 횟수와 골드, 레벨별 상점 확률.'],
    ['云顶之弈刷新概率计算器', '云顶之弈商店概率计算器：每次刷新的概率、到下一次命中、2星和3星所需的预计刷新次数与金币，以及各等级商店概率。'],
    ['Calculadora de probabilidades de TFT', 'Calculadora de probabilidades de tienda de Teamfight Tactics: probabilidad por tienda, rolls y oro esperados hasta el siguiente acierto, 2★ y 3★, más las probabilidades por nivel.'],
    ['Calculatrice de probabilités TFT', 'Calculatrice des probabilités de boutique Teamfight Tactics : chance par boutique, rolls et or attendus jusqu\'au prochain tirage, 2★ et 3★, plus les probabilités par niveau.'],
  ),
  'tft.tables': six(
    ['TFT Loot-Tabellen & Wisps', 'Nachschlagetabellen für Teamfight Tactics: Loot-Tabellen, Coven und Wisps mit Stufe, Modus und Kategorie, inklusive Quellenangabe.'],
    ['TFT Loot Tables & Wisps', 'Reference tables for Teamfight Tactics: loot tables, coven and wisps by tier, mode and category, with the data source linked.'],
    ['TFT 전리품 표 & 위습', '전략적 팀 전투 참고 표: 전리품 표, 코븐, 위습을 등급·모드·분류별로 정리, 데이터 출처 포함.'],
    ['云顶之弈战利品表与小精灵', '云顶之弈参考表：按等级、模式和类别整理的战利品表、Coven与小精灵，并附数据来源。'],
    ['Tablas de botín y Wisps de TFT', 'Tablas de referencia de Teamfight Tactics: botín, coven y wisps por tier, modo y categoría, con la fuente de datos enlazada.'],
    ['Tables de butin & Wisps TFT', 'Tables de référence Teamfight Tactics : butin, coven et wisps par palier, mode et catégorie, avec la source des données.'],
  ),
  'tft.saved': six(
    ['Gespeicherte TFT Comps & Spieler', 'Deine gespeicherten Teamfight-Tactics-Comps und Spieler auf einen Blick.'],
    ['Saved TFT Comps & Players', 'Your saved Teamfight Tactics comps and players at a glance.'],
    ['저장된 TFT 조합 & 플레이어', '저장한 전략적 팀 전투 조합과 플레이어를 한눈에.'],
    ['已收藏的云顶之弈阵容与玩家', '一览你收藏的云顶之弈阵容与玩家。'],
    ['Comps y jugadores de TFT guardados', 'Tus comps y jugadores de Teamfight Tactics guardados de un vistazo.'],
    ['Compos et joueurs TFT enregistrés', 'Tes compos et joueurs Teamfight Tactics enregistrés en un coup d\'œil.'],
  ),
  'tft.match': six(
    ['TFT Match-Details', 'Ein Teamfight-Tactics-Spiel im Detail: alle acht Spieler nach Platzierung mit Level, Stage, Gold, Traits, Units und Items.'],
    ['TFT Match Details', 'A Teamfight Tactics match in detail: all eight players by placement with level, stage, gold, traits, units and items.'],
    ['TFT 매치 상세', '전략적 팀 전투 한 판 상세: 순위별 8명 플레이어의 레벨, 스테이지, 골드, 시너지, 유닛, 아이템.'],
    ['云顶之弈比赛详情', '云顶之弈单局详情：按名次排列的全部八名玩家及其等级、阶段、金币、羁绊、单位与装备。'],
    ['Detalles de partida de TFT', 'Una partida de Teamfight Tactics en detalle: los ocho jugadores por posición con nivel, fase, oro, sinergias, unidades e ítems.'],
    ['Détails du match TFT', 'Une partie Teamfight Tactics en détail : les huit joueurs par placement avec niveau, étape, or, synergies, unités et objets.'],
  ),
  'tft.player': six(
    ['{name} – TFT Profil, Rang & Match-Verlauf', 'Teamfight-Tactics-Profil von {name}: Rang, Marktwert, Saison-Stats mit Ø-Platzierung, Top-4- und Winrate, meistgespielte Units und Match-Verlauf.'],
    ['{name} – TFT Profile, Rank & Match History', 'Teamfight Tactics profile of {name}: rank, market value, season stats with average placement, top 4 and win rate, most played units and match history.'],
    ['{name} – TFT 프로필, 티어 & 매치 기록', '{name}의 전략적 팀 전투 프로필: 티어, 시장 가치, 평균 순위·4등 안 비율·승률 등 시즌 통계, 많이 쓴 유닛, 매치 기록.'],
    ['{name} – 云顶之弈资料、段位与比赛记录', '{name} 的云顶之弈资料：段位、市场价值、含平均名次、前四率与胜率的赛季数据、常用单位及比赛记录。'],
    ['{name} – perfil de TFT, rango e historial', 'Perfil de Teamfight Tactics de {name}: rango, valor de mercado, stats de temporada con posición media, tasa de top 4 y winrate, unidades más usadas e historial de partidas.'],
    ['{name} – profil TFT, rang et historique', 'Profil Teamfight Tactics de {name} : rang, valeur marchande, stats de saison avec placement moyen, taux de top 4 et winrate, unités les plus jouées et historique des matchs.'],
  ),
} satisfies Record<string, Localized>;

export type PageKey = keyof typeof PAGE_COPY;

function fill(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

/** Text einer Seite in einer Sprache, Platzhalter ersetzt. */
export function seoText(key: PageKey, lang: Lang, vars: Record<string, string> = {}): SeoText {
  const entry = PAGE_COPY[key][lang] ?? PAGE_COPY[key].de;
  const all = { set: `Set ${CURRENT_SET}`, ...vars };
  return { title: fill(entry.title, all), description: fill(entry.description, all) };
}

/** Text der Startseite (Rueckfall fuer alle Seiten ohne eigenen Eintrag). */
export function siteText(lang: Lang): SeoText {
  return SITE_COPY[lang] ?? SITE_COPY.de;
}

/**
 * Fertige Metadaten. `path` = Pfad ohne Query (canonical, og:url); null, wenn
 * die Seite ohne Query nicht dasselbe zeigt (Spieler, Matches haengen an
 * ?region=). Ein eigenes openGraph ersetzt das geerbte als Ganzes — ohne
 * `images` verschwaende das Vorschaubild (gemessen: /tft/rising hatte kein
 * og:image). Hat der Abschnitt eine eigene opengraph-image-Datei, gewinnt die
 * Datei. twitter ohne images: X nimmt dann das og:image.
 */
export function buildMetadata(text: SeoText, lang: Lang, path: string | null, game: 'lol' | 'tft'): Metadata {
  const title = `${text.title} · metastats.gg`;
  const description = text.description;
  const url = path ? `${SITE_URL}${path}` : undefined;
  const image = game === 'tft' ? '/tft/opengraph-image' : '/opengraph-image';
  return {
    title,
    description,
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: {
      title,
      description,
      siteName: 'metastats.gg',
      locale: lang,
      type: 'website',
      ...(url ? { url } : {}),
      images: [{ url: image, width: 1200, height: 630, alt: 'metastats.gg' }],
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}
