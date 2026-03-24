'use client';
import { useI18n } from '../lib/i18n';

interface NavProps {
  active?: 'search' | 'leaderboard' | 'champions' | 'marktwert';
}

export default function Nav({ active }: NavProps) {
  const { lang, setLang, t } = useI18n();

  const linkClass = (key: NavProps['active']) =>
    key === active ? 'text-white text-sm' : 'text-[#8a9bb0] text-sm hover:text-white';

  return (
    <nav className="bg-[#0a0e1a] border-b border-[#1e2a3a] px-6 py-3 flex items-center justify-between">
      <a href="/" className="text-[#c89b3c] text-lg font-medium">
        meta<span className="text-white">stats</span>.gg
      </a>
      <div className="flex items-center gap-6">
        <a href="/" className={linkClass('search')}>{t('nav.search')}</a>
        <a href="/leaderboard" className={linkClass('leaderboard')}>{t('nav.leaderboard')}</a>
        <a href="/champions" className={linkClass('champions')}>{t('nav.champions')}</a>
        <a href="/marktwert" className={linkClass('marktwert')}>{t('nav.marketvalue')}</a>
        <button
          onClick={() => setLang(lang === 'de' ? 'en' : 'de')}
          className="flex items-center gap-1 bg-[#141c2e] border border-[#2a3a50] rounded px-2 py-1 text-xs font-medium text-[#8a9bb0] hover:text-white hover:border-[#c89b3c] transition-colors"
          title={lang === 'de' ? 'Switch to English' : 'Auf Deutsch wechseln'}
        >
          <span className={lang === 'de' ? 'text-white' : 'text-[#4a5a70]'}>DE</span>
          <span className="text-[#4a5a70]">/</span>
          <span className={lang === 'en' ? 'text-white' : 'text-[#4a5a70]'}>EN</span>
        </button>
      </div>
    </nav>
  );
}
