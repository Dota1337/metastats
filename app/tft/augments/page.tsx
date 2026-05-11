'use client';
import { useEffect, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TierFilter, { type TierBucket } from '../../components/tft/TierFilter';
import EmptyData from '../../components/tft/EmptyData';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftIconUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';
import TftHero from '../../components/tft/TftHero';

interface AugRow {
  apiName: string;
  slot: number | null;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  pickRate: number | null;
}

const SLOT_LABELS: Record<string, string> = { all: 'Alle', '0': '2-1', '1': '3-2', '2': '4-2' };
const TIER_LABELS: Record<number, string> = { 1: 'Silver', 2: 'Gold', 3: 'Prismatic' };
const TIER_COLORS: Record<number, string> = { 1: '#9ab0bf', 2: '#e0c75a', 3: '#c39bff' };

export default function TftAugmentsPage() {
  const { t } = useI18n();
  const [bucket, setBucket] = useState<TierBucket>('master_plus');
  const [slot, setSlot] = useState<string>('all');
  const [rows, setRows] = useState<AugRow[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [patch, setPatch] = useState<string | undefined>(undefined);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => {
    const url = `/api/tft/augments?region=euw1&bucket=${bucket}${slot !== 'all' ? `&slot=${slot}` : ''}`;
    fetch(url).then(r => r.json())
      .then(d => { setHasData(!!d.hasData); setRows(d.augments || []); setPatch(d.patch); })
      .catch(() => { setHasData(false); setRows([]); });
  }, [bucket, slot]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="augments" />
      <TftHero pageTitle={t('nav.augments')} patch={patch} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        <div className="flex items-center justify-end mb-5">
          <TierFilter value={bucket} onChange={setBucket} />
        </div>

        <div className="flex flex-wrap gap-1 mb-4">
          <span className="text-[#4a5a70] text-xs self-center mr-2">{t('tft.slot')}:</span>
          {['all', '0', '1', '2'].map(s => (
            <button
              key={s}
              onClick={() => setSlot(s)}
              className={`px-3 py-1 rounded text-xs ${slot === s ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'}`}
            >
              {SLOT_LABELS[s] || s}
            </button>
          ))}
        </div>

        {hasData === false && <EmptyData />}
        {hasData && rows.length === 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#8a9bb0] text-sm">
            Set 17 enthält keine Augments — die Sektion füllt sich, sobald Riot das Augment-Feld in einem Set wieder ausliefert.
          </div>
        )}

        {hasData && rows.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
            <div className="hidden md:grid grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem_5rem] gap-2 px-4 py-2 text-[10px] uppercase text-[#4a5a70] bg-[#0a0e1a]">
              <div></div>
              <div>Augment</div>
              <div className="text-right">Tier</div>
              <div className="text-right">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.pickRate')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
            </div>
            {rows.map(r => {
              const meta = assets?.augments[r.apiName];
              const tierColor = TIER_COLORS[meta?.tier ?? 0] || '#4a5a70';
              const url = tftIconUrl(assets, meta?.icon);
              return (
                <div key={`${r.apiName}-${r.slot ?? 'all'}`}
                     className="grid grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem_5rem] gap-2 px-4 py-2 items-center text-xs border-t border-[#1e2a3a]">
                  {url ? (
                    <img src={url} alt={meta!.name} className="w-9 h-9 rounded border-2" style={{ borderColor: tierColor }} />
                  ) : (
                    <div className="w-9 h-9 rounded border-2 bg-[#1e2a3a] flex items-center justify-center text-[8px] text-[#4a5a70]" style={{ borderColor: tierColor }}>{prettyAug(r.apiName)}</div>
                  )}
                  <div className="text-white">{meta?.name || prettyAug(r.apiName)}</div>
                  <div className="text-right text-xs" style={{ color: tierColor }}>{TIER_LABELS[meta?.tier ?? 0] || '—'}</div>
                  <div className="text-right text-white">{r.avgPlacement?.toFixed(2) ?? '—'}</div>
                  <div className="text-right text-[#8a9bb0]">{r.pickRate != null ? `${(r.pickRate * 100).toFixed(1)}%` : '—'}</div>
                  <div className="text-right text-[#8a9bb0]">{r.top4Rate != null ? `${(r.top4Rate * 100).toFixed(1)}%` : '—'}</div>
                  <div className="text-right text-[#4a5a70]">{r.games}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function prettyAug(s: string) { return s.replace(/^TFT\d*_Augment_/, '').slice(0, 12); }
