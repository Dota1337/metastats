'use client';
import { useI18n } from '../../lib/i18n';

export type TierBucket = 'all' | 'master_plus' | 'diamond' | 'master' | 'grandmaster' | 'challenger';

const OPTIONS: { value: TierBucket; key: string }[] = [
  { value: 'all',          key: 'tft.bucket.all' },
  { value: 'master_plus',  key: 'tft.bucket.master_plus' },
  { value: 'diamond',      key: 'tft.bucket.diamond' },
  { value: 'master',       key: 'tft.bucket.master' },
  { value: 'grandmaster',  key: 'tft.bucket.grandmaster' },
  { value: 'challenger',   key: 'tft.bucket.challenger' },
];

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
              ? 'bg-[#7B61FF] text-white'
              : 'bg-[#141c2e] text-[#a0b0c5] hover:text-white'
          }`}
        >
          {t(o.key as any)}
        </button>
      ))}
    </div>
  );
}
