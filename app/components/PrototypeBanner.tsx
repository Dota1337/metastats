'use client';
import { useI18n } from '../lib/i18n';

export default function PrototypeBanner() {
  const { t } = useI18n();
  return (
    <div className="bg-gradient-to-r from-[#c89b3c]/20 via-[#c89b3c]/10 to-[#c89b3c]/20 border-b border-[#c89b3c]/30 py-2.5 px-4">
      <div className="max-w-5xl mx-auto flex items-start sm:items-center gap-2.5 justify-center">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#c89b3c] animate-pulse flex-shrink-0 mt-1.5 sm:mt-0" aria-hidden="true" />
        <div className="text-xs sm:text-sm text-[#f0e6d2] text-left sm:text-center">
          <div>
            <strong className="text-[#c89b3c]">{t('banner.label')}</strong>
            <span className="text-[#c89b3c] mx-1.5">·</span>
            {t('banner.text')}
          </div>
          <div className="text-[11px] sm:text-xs text-[#c89b3c]/70 mt-0.5">
            {t('banner.subtext')}
          </div>
        </div>
      </div>
    </div>
  );
}
