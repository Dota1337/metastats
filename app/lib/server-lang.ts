import { cookies } from 'next/headers';
import type { Lang } from './i18n';

const LANG_COOKIE = 'metastats-lang';
const VALID_LANGS: readonly Lang[] = ['de', 'en', 'ko', 'zh', 'es', 'fr'];

export async function getServerLang(): Promise<Lang> {
  try {
    const store = await cookies();
    const saved = store.get(LANG_COOKIE)?.value as Lang | undefined;
    if (saved && VALID_LANGS.includes(saved)) return saved;
  } catch {}
  return 'de';
}

const SEO_COPY: Record<Lang, { title: string; description: string }> = {
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

export function getSeoCopy(lang: Lang) {
  return SEO_COPY[lang] || SEO_COPY.de;
}
