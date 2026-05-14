'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TierFilter, { type TierBucket } from '../../../components/tft/TierFilter';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, type TftAssetsBundle } from '../../../lib/tft-cdragon';

// Per-augment detail page. Combines stage-stratified stats (slot 0=2-1, 1=3-2,
// 2=4-2) into one table so users can see at a glance: "Is this augment best
// taken in the 2-1 slot, or does it scale to 4-2?"

interface AugRow {
  apiName: string;
  slot: number | null;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  pickRate: number | null;
}

const SLOT_LABELS = ['2-1', '3-2', '4-2'] as const;
const TIER_LABELS: Record<number, string> = { 1: 'Silver', 2: 'Gold', 3: 'Prismatic' };
const TIER_COLORS: Record<number, string> = { 1: '#9ab0bf', 2: '#e0c75a', 3: '#c39bff' };

export default function TftAugmentDetailPage() {
  const { t } = useI18n();
  const params = useParams();
  const search = useSearchParams();
  const apiName = decodeURIComponent(String(params?.name || ''));
  const [bucket, setBucket] = useState<TierBucket>((search.get('bucket') as TierBucket) || 'master_plus');
  const [perSlot, setPerSlot] = useState<Record<number, AugRow | null>>({ 0: null, 1: null, 2: null });
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([0, 1, 2].map(slot =>
      fetch(`/api/tft/augments?region=all&bucket=${bucket}&slot=${slot}`)
        .then(r => r.ok ? r.json() : { augments: [] })
        .then(d => ({
          slot,
          row: ((d.augments || []) as AugRow[]).find(a => a.apiName === apiName) || null,
        }))
        .catch(() => ({ slot, row: null as AugRow | null }))
    )).then(results => {
      if (cancelled) return;
      const map: Record<number, AugRow | null> = { 0: null, 1: null, 2: null };
      for (const { slot, row } of results) map[slot] = row;
      setPerSlot(map);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [apiName, bucket]);

  const meta = assets?.augments[apiName];
  const tier = meta?.tier ?? 0;
  const tierColor = TIER_COLORS[tier] || '#7a8aa0';
  const iconUrl = tftIconUrl(assets, meta?.icon);

  // Best slot = slot with the lowest avg placement among those with data.
  const slotsWithData = [0, 1, 2].filter(s => perSlot[s] != null && (perSlot[s]?.games ?? 0) > 0);
  const bestSlot = slotsWithData.length === 0 ? null
    : slotsWithData.reduce((best, s) =>
        (perSlot[s]!.avgPlacement ?? 9) < (perSlot[best]!.avgPlacement ?? 9) ? s : best, slotsWithData[0]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="augments" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <a href="/tft/augments" className="text-[#7B61FF] text-xs hover:underline">← {t('nav.augments')}</a>

        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5 mt-2">
          <div className="flex items-start gap-4 flex-wrap">
            {iconUrl ? (
              <img src={iconUrl} alt={meta!.name} className="w-16 h-16 rounded-lg border-2" style={{ borderColor: tierColor }} />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-[#1e2a3a]" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-white text-2xl font-medium">{meta?.name || prettyAug(apiName)}</h1>
                {tier > 0 && (
                  <span
                    className="px-2 py-0.5 rounded text-[10px] uppercase tracking-widest"
                    style={{ backgroundColor: `${tierColor}20`, color: tierColor, border: `1px solid ${tierColor}55` }}
                  >
                    {TIER_LABELS[tier]}
                  </span>
                )}
              </div>
              {meta?.desc && <p className="text-[#a0b0c5] text-sm mt-2 leading-relaxed">{meta.desc}</p>}
            </div>
          </div>
        </div>

        <div className="flex justify-end mb-4">
          <TierFilter value={bucket} onChange={setBucket} />
        </div>

        {loading && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#a0b0c5] text-sm">
            {t('tft.loading')}
          </div>
        )}

        {!loading && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
            <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">{t('tft.augment.statsPerStage')}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[0, 1, 2].map(slot => {
                const row = perSlot[slot];
                const isBest = bestSlot === slot;
                return (
                  <div
                    key={slot}
                    className={`bg-[#141c2e] border rounded p-3 ${isBest ? 'border-[#7B61FF]/60' : 'border-[#1e2a3a]'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[#a0b0c5] text-[10px] uppercase tracking-widest">
                        {t('tft.augment.stage')} {SLOT_LABELS[slot]}
                      </span>
                      {isBest && (
                        <span className="text-[#7B61FF] text-[9px] uppercase tracking-widest">
                          {t('tft.augment.bestSlot')}
                        </span>
                      )}
                    </div>
                    {row && row.games > 0 ? (
                      <div className="space-y-1.5 text-xs">
                        <StatLine label={t('tft.avgPlacement')} value={row.avgPlacement?.toFixed(2) ?? '—'} accent />
                        <StatLine label={t('tft.top4')} value={row.top4Rate != null ? `${(row.top4Rate * 100).toFixed(1)}%` : '—'} />
                        <StatLine label={t('tft.pickRate')} value={row.pickRate != null ? `${(row.pickRate * 100).toFixed(2)}%` : '—'} />
                        <StatLine label={t('tft.gamesShort')} value={String(row.games)} />
                      </div>
                    ) : (
                      <div className="text-[#7a8aa0] text-xs py-2">{t('tft.augment.notOfferedHere')}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function StatLine({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-[#7a8aa0]">{label}</span>
      <span className={accent ? 'text-white font-medium' : 'text-[#a0b0c5]'}>{value}</span>
    </div>
  );
}

function prettyAug(s: string) { return s.replace(/^TFT\d+_Augment_/, '').replace(/([A-Z])/g, ' $1').trim(); }
