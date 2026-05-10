'use client';
import { useEffect, useState, useMemo } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TierFilter, { type TierBucket } from '../../components/tft/TierFilter';
import EmptyData from '../../components/tft/EmptyData';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftIconUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';
import TftHero from '../../components/tft/TftHero';

interface UnitRow {
  characterId: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
}

export default function TftUnitsPage() {
  const { t } = useI18n();
  const [bucket, setBucket] = useState<TierBucket>('master_plus');
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [costFilter, setCostFilter] = useState<number | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => {
    fetch(`/api/tft/units?region=euw1&bucket=${bucket}`)
      .then(r => r.json())
      .then(d => { setHasData(!!d.hasData); setUnits(d.units || []); })
      .catch(() => { setHasData(false); setUnits([]); });
  }, [bucket]);

  const filtered = useMemo(() => {
    if (costFilter == null) return units;
    return units.filter(u => (assets?.champions[u.characterId]?.cost ?? -1) === costFilter);
  }, [units, assets, costFilter]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="units" />
      <TftHero pageTitle={t('nav.units')} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-end mb-5">
          <TierFilter value={bucket} onChange={setBucket} />
        </div>

        <div className="flex flex-wrap gap-1 mb-4">
          <button
            onClick={() => setCostFilter(null)}
            className={`px-3 py-1 rounded text-xs ${costFilter == null ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'}`}
          >
            {t('tft.bucket.all')}
          </button>
          {[1, 2, 3, 4, 5].map(c => (
            <button
              key={c}
              onClick={() => setCostFilter(c)}
              className={`px-3 py-1 rounded text-xs ${costFilter === c ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'}`}
            >
              {c}-Cost
            </button>
          ))}
        </div>

        {hasData === false && <EmptyData />}

        {hasData && filtered.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
            <div className="hidden md:grid grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem] gap-2 px-4 py-2 text-[10px] uppercase text-[#4a5a70] bg-[#0a0e1a]">
              <div></div>
              <div>Champion</div>
              <div className="text-right">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.top1')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
            </div>
            {filtered.map(u => {
              const ch = assets?.champions[u.characterId];
              const cost = ch?.cost ?? 1;
              const costColor = costColorOf(cost);
              const url = tftIconUrl(assets, ch?.icon);
              return (
                <a
                  key={u.characterId}
                  href={`/tft/units/${encodeURIComponent(u.characterId)}?bucket=${bucket}`}
                  className="grid grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem] gap-2 px-4 py-2 items-center text-xs hover:bg-white/5 border-t border-[#1e2a3a]"
                >
                  <div className="w-9 h-9 rounded border-2 overflow-hidden" style={{ borderColor: costColor }}>
                    {url && <img src={url} alt={ch!.name} className="w-full h-full object-cover" />}
                  </div>
                  <div className="text-white">{ch?.name || prettyCharId(u.characterId)}</div>
                  <div className="text-right text-white">{u.avgPlacement?.toFixed(2) ?? '—'}</div>
                  <div className="text-right text-[#8a9bb0]">{u.top4Rate != null ? `${(u.top4Rate * 100).toFixed(1)}%` : '—'}</div>
                  <div className="text-right text-[#8a9bb0]">{u.top1Rate != null ? `${(u.top1Rate * 100).toFixed(1)}%` : '—'}</div>
                  <div className="text-right text-[#4a5a70]">{u.games}</div>
                </a>
              );
            })}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function costColorOf(cost: number) {
  return cost === 1 ? '#9aa6b2' : cost === 2 ? '#3a8' : cost === 3 ? '#3a8ddc' : cost === 4 ? '#c39bff' : '#e0c75a';
}
function prettyCharId(id: string) {
  return id.replace(/^TFT\d+_/, '');
}
