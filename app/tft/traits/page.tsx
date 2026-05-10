'use client';
import { useEffect, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TierFilter, { type TierBucket } from '../../components/tft/TierFilter';
import EmptyData from '../../components/tft/EmptyData';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftIconUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';
import TftHero from '../../components/tft/TftHero';

interface TraitRow {
  name: string;
  activation: number;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
}

export default function TftTraitsPage() {
  const { t } = useI18n();
  const [bucket, setBucket] = useState<TierBucket>('master_plus');
  const [rows, setRows] = useState<TraitRow[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => {
    fetch(`/api/tft/traits?region=euw1&bucket=${bucket}`)
      .then(r => r.json())
      .then(d => { setHasData(!!d.hasData); setRows(d.traits || []); })
      .catch(() => { setHasData(false); setRows([]); });
  }, [bucket]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="traits" />
      <TftHero compact pageTitle={t('nav.traits')} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-end mb-5">
          <TierFilter value={bucket} onChange={setBucket} />
        </div>

        {hasData === false && <EmptyData />}

        {hasData && rows.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
            <div className="hidden md:grid grid-cols-[3rem_1fr_4rem_5rem_5rem_5rem] gap-2 px-4 py-2 text-[10px] uppercase text-[#4a5a70] bg-[#0a0e1a]">
              <div></div>
              <div>{t('nav.traits')}</div>
              <div className="text-right">{t('tft.activation')}</div>
              <div className="text-right">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
            </div>
            {rows.map(r => {
              const meta = assets?.traits[r.name];
              const url = tftIconUrl(assets, meta?.icon);
              return (
                <div key={`${r.name}-${r.activation}`} className="grid grid-cols-[3rem_1fr_4rem_5rem_5rem_5rem] gap-2 px-4 py-2 items-center text-xs border-t border-[#1e2a3a]">
                  {url ? (
                    <img src={url} alt={meta!.name} className="w-9 h-9 rounded" />
                  ) : (
                    <div className="w-9 h-9 rounded bg-[#1e2a3a]" />
                  )}
                  <div className="text-white">{meta?.name || prettyTrait(r.name)}</div>
                  <div className="text-right text-[#7B61FF]">{r.activation}</div>
                  <div className="text-right text-white">{r.avgPlacement?.toFixed(2) ?? '—'}</div>
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

function prettyTrait(s: string) { return s.replace(/^TFT\d+_/, ''); }
