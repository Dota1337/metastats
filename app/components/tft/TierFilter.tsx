'use client';
import { useI18n, type TranslationKey } from '../../lib/i18n';

import { TIER_BUCKETS, type TierBucket } from '../../lib/tft-tier-bucket';

// Werte und Lese-Regel liegen in lib/tft-tier-bucket.ts (auch fuer den Server).
export { tierBucketFromParam, type TierBucket } from '../../lib/tft-tier-bucket';

const OPTIONS: { value: TierBucket; key: string }[] = TIER_BUCKETS.map(value => ({ value, key: `tft.bucket.${value}` }));

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
