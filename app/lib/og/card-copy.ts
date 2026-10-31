// Texte der drei festen Vorschaubilder je Sprache. Eigene kleine Datei: i18n.tsx
// (466 KB, 'use client') gehoert nicht in ein Bild. Begriffe wie im Woerterbuch
// (nav.units, nav.proTeams …) und in seo/copy.ts (Marktwert-Titel).
import { LANGS, isLang, type Lang } from '../lang-path';

export const OG_CARDS = ['lol', 'tft', 'marktwert'] as const;
export type OgCard = (typeof OG_CARDS)[number];

export function isOgCard(v: unknown): v is OgCard {
  return typeof v === 'string' && (OG_CARDS as readonly string[]).includes(v);
}

export { LANGS as OG_LANGS, isLang as isOgLang };

/** Adresse des Bildes. Die Sprache steht im Pfad: Next nennt Bild-Adressen ohne Vorsatz. */
export function ogCardPath(lang: Lang, card: OgCard): string {
  return `/og/${lang}/${card}`;
}

type CardText = { subtitle: string; pills: string[] };

export const CARD_COPY: Record<Lang, { lol: CardText; tft: CardText; marktwert: CardText & { word: string } }> = {
  de: {
    lol: { subtitle: 'League of Legends · Stats · KI-Marktwerte', pills: ['Rangliste', 'Champions', 'Pro Teams', 'Marktanalyse'] },
    tft: { subtitle: 'Teamfight Tactics · Comps · Marktwerte', pills: ['Comps', 'Units', 'Items', 'Pro-Marktwerte'] },
    marktwert: { word: 'Marktwerte', subtitle: 'KI-Marktwert · 6 Signale · Diamond II+', pills: ['Top-Movers', 'Sparklines', 'Pro-Teams', 'Patch-Timeline'] },
  },
  en: {
    lol: { subtitle: 'League of Legends · Stats · AI Market Values', pills: ['Leaderboard', 'Champions', 'Pro Teams', 'Market Intelligence'] },
    tft: { subtitle: 'Teamfight Tactics · Comps · Market Values', pills: ['Comps', 'Units', 'Items', 'Pro Market Values'] },
    marktwert: { word: 'Market Values', subtitle: 'AI Market Value · 6 Signals · Diamond II+', pills: ['Top Movers', 'Sparklines', 'Pro Teams', 'Patch Timeline'] },
  },
  ko: {
    lol: { subtitle: '리그 오브 레전드 · 통계 · AI 시장 가치', pills: ['리더보드', '챔피언', '프로팀', '시장 분석'] },
    tft: { subtitle: '전략적 팀 전투 · 조합 · 시장 가치', pills: ['조합', '유닛', '아이템', '프로 시장 가치'] },
    marktwert: { word: '시장 가치', subtitle: 'AI 시장 가치 · 6가지 신호 · 다이아몬드 II+', pills: ['최대 변동', '추세 그래프', '프로팀', '패치 타임라인'] },
  },
  zh: {
    lol: { subtitle: '英雄联盟 · 数据 · AI 市场价值', pills: ['排行榜', '英雄', '职业战队', '市场分析'] },
    tft: { subtitle: '云顶之弈 · 阵容 · 市场价值', pills: ['阵容', '单位', '装备', '职业选手市场价值'] },
    marktwert: { word: '市场价值', subtitle: 'AI 市场价值 · 6 项信号 · 钻石 II+', pills: ['最大涨跌', '走势图', '职业战队', '版本时间线'] },
  },
  es: {
    lol: { subtitle: 'League of Legends · Stats · Valores de mercado', pills: ['Clasificación', 'Campeones', 'Equipos Pro', 'Análisis de mercado'] },
    tft: { subtitle: 'Teamfight Tactics · Comps · Valores de mercado', pills: ['Comps', 'Unidades', 'Ítems', 'Valores de pros'] },
    marktwert: { word: 'Valores de mercado', subtitle: 'Valor de mercado IA · 6 señales · Diamante II+', pills: ['Mayores cambios', 'Tendencias', 'Equipos Pro', 'Parches'] },
  },
  fr: {
    lol: { subtitle: 'League of Legends · Stats · Valeurs marchandes', pills: ['Classement', 'Champions', 'Équipes Pro', 'Analyse du marché'] },
    tft: { subtitle: 'Teamfight Tactics · Comps · Valeurs marchandes', pills: ['Comps', 'Unités', 'Objets', 'Valeurs des pros'] },
    marktwert: { word: 'Valeurs marchandes', subtitle: 'Valeur marchande IA · 6 signaux · Diamant II+', pills: ['Plus fortes variations', 'Tendances', 'Équipes Pro', 'Patchs'] },
  },
};
