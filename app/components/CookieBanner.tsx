'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';

// Cookie consent banner. The site only sets one functional cookie
// (the language pref via LANG_COOKIE) which is essential under TTDSG §25
// Abs. 2 and doesn't strictly require consent — but a transparent banner
// is best practice. Choice is stored in localStorage so we don't pester
// the user on every visit.

const STORAGE_KEY = 'metastats-cookie-consent';

export default function CookieBanner() {
  const { t } = useI18n();
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setShow(true);
    } catch {
      // Private mode / storage disabled — don't show. Site still works
      // because the lang cookie path is set with a sensible default.
    }
  }, []);

  const persist = (value: 'accepted' | 'declined') => {
    try { localStorage.setItem(STORAGE_KEY, value); } catch {}
    setShow(false);
  };

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="cookie-banner-title"
      className="fixed bottom-3 left-3 right-3 sm:left-auto sm:right-3 sm:max-w-md z-50 bg-[#0d1526] border border-[#7B61FF]/40 rounded-lg shadow-xl p-4 text-sm"
    >
      <div id="cookie-banner-title" className="text-white font-medium mb-1.5">
        {t('cookie.title')}
      </div>
      <p className="text-[#8a9bb0] text-xs leading-relaxed mb-3">
        {t('cookie.body')}{' '}
        <a href="/datenschutz" className="text-[#7B61FF] hover:underline">
          {t('legal.privacy')}
        </a>
        .
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => persist('accepted')}
          className="flex-1 bg-[#7B61FF] hover:bg-[#7B61FF]/80 text-white text-xs px-3 py-2 rounded font-medium"
        >
          {t('cookie.accept')}
        </button>
        <button
          onClick={() => persist('declined')}
          className="flex-1 bg-[#141c2e] hover:bg-[#1e2a3a] text-[#8a9bb0] hover:text-white text-xs px-3 py-2 rounded"
        >
          {t('cookie.decline')}
        </button>
      </div>
    </div>
  );
}
