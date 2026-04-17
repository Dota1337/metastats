import { cookies, headers } from 'next/headers';
import type { Lang } from './i18n';

const LANG_COOKIE = 'metastats-lang';
const VALID_LANGS: readonly Lang[] = ['de', 'en', 'ko', 'zh', 'es', 'fr'];

/**
 * Parse an Accept-Language header like "de-DE,de;q=0.9,en;q=0.8" into a ranked
 * list of primary-subtags, then pick the first one that we actually support.
 * Returns null if none match.
 */
function pickFromAcceptLanguage(header: string | null): Lang | null {
  if (!header) return null;
  const prefs = header
    .split(',')
    .map(part => {
      const [raw, ...params] = part.trim().split(';');
      const qParam = params.find(p => p.trim().startsWith('q='));
      const q = qParam ? parseFloat(qParam.split('=')[1]) : 1;
      return { tag: raw.trim().toLowerCase(), q: isNaN(q) ? 1 : q };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of prefs) {
    // "de-DE" → "de", "zh-Hans-CN" → "zh"
    const primary = tag.split('-')[0];
    if (VALID_LANGS.includes(primary as Lang)) return primary as Lang;
  }
  return null;
}

export async function getServerLang(): Promise<Lang> {
  try {
    // 1st preference: explicit cookie set by the user's language dropdown
    const store = await cookies();
    const saved = store.get(LANG_COOKIE)?.value as Lang | undefined;
    if (saved && VALID_LANGS.includes(saved)) return saved;

    // 2nd preference: browser Accept-Language on first visit
    const hdrs = await headers();
    const accept = hdrs.get('accept-language');
    const fromHeader = pickFromAcceptLanguage(accept);
    if (fromHeader) return fromHeader;
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
