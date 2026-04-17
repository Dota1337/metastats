'use client';
import { useEffect } from 'react';
import { useI18n } from './lib/i18n';

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    console.error('[app error]', error);
  }, [error]);

  return (
    <main className="min-h-screen bg-[#0e1525] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="text-red-400 text-6xl mb-3">⚠</div>
        <h1 className="text-white text-xl font-semibold mb-2">{t('error.crashTitle')}</h1>
        <p className="text-[#8a9bb0] text-sm mb-6">{t('error.crashText')}</p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <button
            onClick={reset}
            className="bg-[#c89b3c] hover:bg-[#d4a94a] text-[#0a0e1a] text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors"
          >
            {t('error.retry')}
          </button>
          <a href="/" className="border border-[#2a3a50] hover:border-[#c89b3c] text-[#8a9bb0] hover:text-white text-sm px-6 py-2.5 rounded-lg transition-colors">
            {t('notFound.home')}
          </a>
        </div>
        {error.digest && (
          <div className="mt-6 text-[#4a5a70] text-[10px] font-mono">Error ID: {error.digest}</div>
        )}
      </div>
    </main>
  );
}
