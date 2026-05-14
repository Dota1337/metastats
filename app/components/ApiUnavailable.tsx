'use client';
import { useI18n } from '../lib/i18n';

interface Props {
  onRetry?: () => void;
  compact?: boolean;
}

export default function ApiUnavailable({ onRetry, compact = false }: Props) {
  const { t } = useI18n();
  return (
    <div className={`glass rounded-xl ${compact ? 'p-4' : 'p-6'} text-center`}>
      <div className="inline-flex items-center gap-2 text-[#c89b3c] text-xs uppercase tracking-widest mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[#c89b3c] animate-pulse" aria-hidden="true" />
        Beta
      </div>
      <p className="text-[#a0b0c5] text-sm leading-relaxed max-w-md mx-auto">
        {t('error.featureUnavailable')}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 text-[#c89b3c] hover:text-[#d4a94a] text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#c89b3c] focus-visible:outline-offset-2 rounded px-2 py-1 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {t('error.retry')}
        </button>
      )}
    </div>
  );
}
