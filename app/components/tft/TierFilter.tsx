'use client';
import { useI18n, type TranslationKey } from '../../lib/i18n';

import { tftStatsBucket } from '../../lib/rank-groups';

export type TierBucket = 'all' | 'challenger' | 'grandmaster_plus' | 'master_plus' | 'diamond_plus' | 'emerald_plus' | 'platinum_plus';

// Rangfolge von oben, Einzel-Master/-GM/-Diamond/-Emerald/-Platinum gibt es
// nicht mehr (2026-09-13). Alle X+-Gruppen stehen in DETAIL_BUCKETS
// (app/lib/snapshot-matrix.ts), sonst liefe die Detailseite live in den Abbruch.
const OPTIONS: { value: TierBucket; key: string }[] = [
  { value: 'all',              key: 'tft.bucket.all' },
  { value: 'challenger',       key: 'tft.bucket.challenger' },
  { value: 'grandmaster_plus', key: 'tft.bucket.grandmaster_plus' },
  { value: 'master_plus',      key: 'tft.bucket.master_plus' },
  { value: 'diamond_plus',     key: 'tft.bucket.diamond_plus' },
  { value: 'emerald_plus',     key: 'tft.bucket.emerald_plus' },
  { value: 'platinum_plus',    key: 'tft.bucket.platinum_plus' },
];

/** ?bucket= aus der URL lesen; alte Einzelraenge (master, diamond …) auf die Gruppe biegen. */
export function tierBucketFromParam(raw: string | null | undefined, fallback: TierBucket = 'master_plus'): TierBucket {
  if (!raw) return fallback;
  const v = tftStatsBucket(raw.toLowerCase());
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
