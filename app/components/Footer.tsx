'use client';
import { useState } from 'react';
import { useI18n, LANGUAGES } from '../lib/i18n';

// Footer with legal links, language switch, and a disclaimer. Replaces the
// one-line "metastats.gg · disclaimer" stub that was on every page. Kept
// compact (single bar) so it doesn't dominate above-the-fold on short pages.

export default function Footer() {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const current = LANGUAGES.find(l => l.code === lang) || LANGUAGES[0];

  return (
    <footer className="mt-12 pt-6 pb-8 border-t border-[#1e2a3a]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-[#7a8aa0]">
        <div className="flex items-center gap-3">
          <span className="text-[#a0b0c5] font-medium">metastats.gg</span>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">{t('footer.disclaimer')}</span>
        </div>

        <nav className="flex items-center gap-4 justify-center" aria-label="legal links">
          <a href="/impressum" className="hover:text-white transition">{t('legal.imprint')}</a>
          <a href="/datenschutz" className="hover:text-white transition">{t('legal.privacy')}</a>
        </nav>

        <div className="flex items-center sm:justify-end relative">
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5 hover:text-white transition"
            aria-expanded={open}
            aria-haspopup="menu"
          >
            <img src={current.flagUrl} alt="" className="w-5 h-auto rounded-sm" />
            <span>{current.label}</span>
            <span className="text-[10px]">{open ? '▲' : '▼'}</span>
          </button>
          {open && (
            <div className="absolute right-0 bottom-full mb-1 z-30 bg-[#0d1526] border border-[#1e2a3a] rounded-lg shadow-lg min-w-[160px] py-1">
              {LANGUAGES.map(l => (
                <button
                  key={l.code}
                  onClick={() => { setLang(l.code); setOpen(false); }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/5 ${l.code === lang ? 'text-white' : 'text-[#a0b0c5]'}`}
                >
                  <img src={l.flagUrl} alt="" className="w-5 h-auto rounded-sm" />
                  <span>{l.label}</span>
                  {l.code === lang && <span className="ml-auto text-[#7B61FF]">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="sm:hidden mt-3 px-4 text-center text-[10px] text-[#7a8aa0]">
        {t('footer.disclaimer')}
      </div>
    </footer>
  );
}
