'use client';
import { useI18n } from './lib/i18n';
import Nav from './components/Nav';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <main className="min-h-screen bg-[#0e1525] flex flex-col">
      <Nav />
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <div className="text-[#c89b3c] text-[120px] sm:text-[160px] font-bold leading-none tracking-tight">404</div>
          <div className="w-16 h-0.5 bg-gradient-to-r from-transparent via-[#c89b3c] to-transparent mx-auto my-4" />
          <h1 className="text-white text-xl sm:text-2xl font-semibold mb-3">{t('notFound.title')}</h1>
          <p className="text-[#8a9bb0] text-sm mb-8">{t('notFound.text')}</p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <a href="/" className="bg-[#c89b3c] hover:bg-[#d4a94a] text-[#0a0e1a] text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors">
              {t('notFound.home')}
            </a>
            <a href="/leaderboard" className="border border-[#2a3a50] hover:border-[#c89b3c] text-[#8a9bb0] hover:text-white text-sm px-6 py-2.5 rounded-lg transition-colors">
              {t('nav.leaderboard')}
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
