'use client';
import { useEffect } from 'react';
import { useI18n } from './i18n';

type TitleKey =
  | 'pageTitle.leaderboard'
  | 'pageTitle.champions'
  | 'pageTitle.marktwert'
  | 'pageTitle.compare'
  | 'pageTitle.teams'
  | 'pageTitle.ligen'
  | 'pageTitle.multiSearch';

/**
 * Sets document.title to `<translated page label> · metastats.gg` for the
 * current language. Used on client-rendered pages where Next.js generateMetadata
 * can't run (since the page is 'use client').
 */
export function usePageTitle(key: TitleKey | string) {
  const { t, lang } = useI18n();
  useEffect(() => {
    const label = (t as any)(key);
    if (label && label !== key) {
      document.title = `${label} · metastats.gg`;
    }
  }, [t, lang, key]);
}

export function useCustomPageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title) document.title = `${title} · metastats.gg`;
  }, [title]);
}
