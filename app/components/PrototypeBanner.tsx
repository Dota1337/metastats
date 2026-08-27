'use client';
import { useI18n } from '../lib/i18n';
import { usePathname } from 'next/navigation';
import { detectGameFromPath } from '../lib/games';

export default function PrototypeBanner() {
  const { t } = useI18n();
  const pathname = usePathname();
  // Internal-Ops-Dashboard läuft full-screen, der Prototyp-Banner würde die
  // 3D-Scene anschneiden.
  if (pathname?.startsWith('/internal')) return null;
  // Eigenes data-game, weil das Banner im Root-Layout oberhalb des Ankers aus
  // app/tft/layout.tsx liegt und Custom-Properties nur abwärts vererben.
  return (
    <div className="proto-banner py-2.5 px-4" data-game={detectGameFromPath(pathname || '/')}>
      <div className="max-w-5xl mx-auto flex items-start sm:items-center gap-2.5 justify-center">
        <span className="proto-banner-dot inline-block w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0 mt-1.5 sm:mt-0" aria-hidden="true" />
        <div className="text-xs sm:text-sm text-fg-primary text-left sm:text-center">
          <div>
            <strong className="proto-banner-accent">{t('banner.label')}</strong>
            <span className="proto-banner-sep mx-1.5">·</span>
            {t('banner.text')}
          </div>
          <div className="proto-banner-sub text-[11px] sm:text-xs mt-0.5">
            {t('banner.subtext')}
          </div>
        </div>
      </div>
    </div>
  );
}
