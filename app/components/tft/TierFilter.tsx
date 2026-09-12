'use client';
import { useI18n, type TranslationKey } from '../../lib/i18n';

import { legacyTftBucket } from '../../lib/rank-groups';

export type TierBucket = 'all' | 'master_plus' | 'grandmaster_plus' | 'diamond' | 'challenger';

// Einzel-Master und Einzel-Grandmaster gibt es nicht mehr (2026-09-13).
const OPTIONS: { value: TierBucket; key: string }[] = [
  { value: 'all',              key: 'tft.bucket.all' },
  { value: 'master_plus',      key: 'tft.bucket.master_plus' },
  { value: 'grandmaster_plus', key: 'tft.bucket.grandmaster_plus' },
  { value: 'diamond',          key: 'tft.bucket.diamond' },
  { value: 'challenger',       key: 'tft.bucket.challenger' },
];

/** ?bucket= aus der URL lesen; alte Werte master/grandmaster auf die Gruppe biegen. */
export function tierBucketFromParam(raw: string | null | undefined, fallback: TierBucket = 'master_plus'): TierBucket {
  if (!raw) return fallback;
  const v = legacyTftBucket(raw.toLowerCase());
  return OPTIONS.some(o => o.value === v) ? (v as TierBucket) : fallback;
}

export default function TierFilter({ value, onChange }: { value: TierBucket; onChange: (v: TierBucket) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-1">
      {OPTIONS.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            value === o.value
              ? 'bg-accent text-white'
              : 'bg-surface-raised text-fg-secondary hover:text-white'
          }`}
        >
          {t(o.key as TranslationKey)}
        </button>
      ))}
    </div>
  );
}
