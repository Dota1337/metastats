// Texte der Overwolf-App (apps/overwolf-app), Namensraum companion.*.
//
// Reine Datei ohne React: i18n.tsx ist 'use client' und haelt sein
// Woerterbuch privat. Die Seite bindet diese Datei in i18n.tsx ein, die App
// bundelt sie direkt — beide lesen so dieselben Texte.
// Platzhalter {n} ersetzt der Aufrufer.

const t6 = (de: string, en: string, ko: string, zh: string, es: string, fr: string) => ({ de, en, ko, zh, es, fr });

export const COMPANION_TRANSLATIONS = {
  'companion.tab.comps': t6('Comps', 'Comps', '조합', '阵容', 'Composiciones', 'Compos'),
  'companion.tab.tools': t6('Werkzeuge', 'Tools', '도구', '工具', 'Herramientas', 'Outils'),
  'companion.tab.profile': t6('Profil', 'Profile', '프로필', '个人资料', 'Perfil', 'Profil'),
  'companion.tab.settings': t6('Einstellungen', 'Settings', '설정', '设置', 'Ajustes', 'Paramètres'),

  'companion.comps.search': t6('Comp suchen', 'Search comp', '조합 검색', '搜索阵容', 'Buscar composición', 'Chercher une compo'),
  'companion.comps.pin': t6('Anheften', 'Pin', '고정', '固定', 'Fijar', 'Épingler'),
  'companion.comps.unpin': t6('Lösen', 'Unpin', '고정 해제', '取消固定', 'Quitar', 'Détacher'),
  'companion.comps.games': t6('Spiele', 'Games', '게임', '场次', 'Partidas', 'Parties'),
  'companion.comps.avg': t6('Ø Platz', 'Avg place', '평균 순위', '平均名次', 'Posición media', 'Place moy.'),
  'companion.comps.top4': t6('Top 4', 'Top 4', '톱 4', '前四', 'Top 4', 'Top 4'),
  'companion.comps.win': t6('Sieg', 'Win', '1등', '吃鸡', 'Victoria', 'Victoire'),
  'companion.comps.open': t6('Auf metastats.gg öffnen', 'Open on metastats.gg', 'metastats.gg에서 열기', '在 metastats.gg 打开', 'Abrir en metastats.gg', 'Ouvrir sur metastats.gg'),

  'companion.tools.recipes': t6('Item-Rezepte', 'Item recipes', '아이템 조합법', '装备合成', 'Recetas de objetos', 'Recettes d’objets'),
  'companion.recipes.items': t6('Items', 'Items', '아이템', '装备', 'Objetos', 'Objets'),
  'companion.recipes.spatula': t6('Mit Spatula', 'With Spatula', '뒤집개 조합', '金铲铲合成', 'Con Espátula', 'Avec Spatule'),
  'companion.recipes.pan': t6('Mit Bratpfanne', 'With Frying Pan', '프라이팬 조합', '金锅锅合成', 'Con Sartén', 'Avec Poêle'),
  'companion.tools.odds': t6('Shop-Chancen', 'Shop odds', '상점 확률', '商店概率', 'Probabilidades de tienda', 'Probabilités de boutique'),
  'companion.tools.level': t6('Stufe', 'Level', '레벨', '等级', 'Nivel', 'Niveau'),
  'companion.tools.levelPlan': t6('Stufenplan', 'Level plan', '레벨 계획', '升级计划', 'Plan de niveles', 'Plan de niveaux'),
  'companion.tools.copies': t6('Kopien je Unit', 'Copies per unit', '유닛당 개수', '每个弈子数量', 'Copias por unidad', 'Exemplaires par unité'),
  'companion.tools.cost': t6('Kosten', 'Cost', '비용', '费用', 'Coste', 'Coût'),

  'companion.plan.reroll': t6('Auf Stufe {n} bleiben und rollen', 'Stay on level {n} and roll', '{n}레벨에서 리롤', '停在 {n} 级刷新', 'Quédate en nivel {n} y rolea', 'Restez niveau {n} et rollez'),
  'companion.plan.fast8': t6('Schnell auf Stufe 8', 'Fast to level 8', '빠르게 8레벨', '速升 8 级', 'Rápido a nivel 8', 'Rapide niveau 8'),
  'companion.plan.fast9': t6('Schnell auf Stufe 9', 'Fast to level 9', '빠르게 9레벨', '速升 9 级', 'Rápido a nivel 9', 'Rapide niveau 9'),
  'companion.plan.avgLevel': t6('Ø Endstufe', 'Avg final level', '평균 최종 레벨', '平均最终等级', 'Nivel final medio', 'Niveau final moy.'),
  'companion.plan.threeStar': t6('3-Sterne-Ziel', '3-star target', '3성 목표', '三星目标', 'Objetivo 3 estrellas', 'Objectif 3 étoiles'),

  'companion.profile.placeholder': t6('Name#Tag', 'Name#Tag', '이름#태그', '名称#标签', 'Nombre#Tag', 'Nom#Tag'),
  'companion.profile.search': t6('Suchen', 'Search', '검색', '搜索', 'Buscar', 'Rechercher'),
  'companion.profile.notFound': t6('Spieler nicht gefunden', 'Player not found', '플레이어를 찾을 수 없음', '未找到玩家', 'Jugador no encontrado', 'Joueur introuvable'),
  'companion.profile.unranked': t6('Ohne Rang', 'Unranked', '랭크 없음', '无段位', 'Sin clasificar', 'Non classé'),
  'companion.profile.place': t6('Platz', 'Place', '순위', '名次', 'Puesto', 'Place'),
  'companion.profile.me': t6('Ich', 'Me', '나', '我', 'Yo', 'Moi'),

  'companion.settings.pinned': t6('Comp-Overlay im Spiel', 'In-game comp overlay', '게임 내 조합 오버레이', '游戏内阵容浮窗', 'Superposición de composición', 'Superposition de compo en jeu'),
  'companion.settings.shop': t6('Shop-Markierung', 'Shop highlight', '상점 강조', '商店高亮', 'Resaltar tienda', 'Surbrillance boutique'),
  'companion.settings.matchups': t6('Nächster Gegner', 'Next opponent', '다음 상대', '下一个对手', 'Próximo rival', 'Prochain adversaire'),
  'companion.settings.share': t6('Brett-Daten anonym teilen', 'Share board data anonymously', '보드 데이터 익명 공유', '匿名分享棋盘数据', 'Compartir datos del tablero de forma anónima', 'Partager les données du plateau anonymement'),
  'companion.settings.language': t6('Sprache', 'Language', '언어', '语言', 'Idioma', 'Langue'),
  'companion.settings.hotkey': t6('Fenster ein/aus', 'Show/hide window', '창 표시/숨기기', '显示/隐藏窗口', 'Mostrar/ocultar ventana', 'Afficher/masquer la fenêtre'),
  'companion.settings.region': t6('Region der Daten', 'Data region', '데이터 지역', '数据区域', 'Región de datos', 'Région des données'),
  'companion.settings.allRegions': t6('Alle Regionen', 'All regions', '모든 지역', '所有区域', 'Todas las regiones', 'Toutes les régions'),
  'companion.settings.west': t6('Westen', 'West', '서부', '西部', 'Oeste', 'Ouest'),
  'companion.settings.asia': t6('Asien', 'Asia', '아시아', '亚洲', 'Asia', 'Asie'),

  'companion.overlay.nextOpponent': t6('Nächster Gegner', 'Next opponent', '다음 상대', '下一个对手', 'Próximo rival', 'Prochain adversaire'),
  'companion.common.retry': t6('Erneut laden', 'Reload', '다시 불러오기', '重新加载', 'Recargar', 'Recharger'),
  'companion.common.offline': t6('Keine Verbindung zu metastats.gg', 'No connection to metastats.gg', 'metastats.gg에 연결할 수 없음', '无法连接 metastats.gg', 'Sin conexión con metastats.gg', 'Pas de connexion à metastats.gg'),
} as const;

export type CompanionTranslationKey = keyof typeof COMPANION_TRANSLATIONS;
