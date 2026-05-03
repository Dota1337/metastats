'use client';
import { useI18n } from '../../lib/i18n';

export default function EmptyData({ note }: { note?: string }) {
  const { t } = useI18n();
  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-8 text-center">
      <div className="inline-block px-3 py-1 rounded-full bg-[#7B61FF]/15 text-[#7B61FF] text-xs uppercase tracking-widest mb-3">
        TFT
      </div>
      <p className="text-[#8a9bb0] text-sm">{note || t('tft.noDataYet')}</p>
    </div>
  );
}
