'use client';
import { useEffect, useState, useMemo } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TierFilter, { type TierBucket } from '../../components/tft/TierFilter';
import EmptyData from '../../components/tft/EmptyData';
import { useI18n } from '../../lib/i18n';
import { loadTftChampions, loadTftSetMeta, type TftChampion } from '../../lib/tft-dd-assets';

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
  const [ddVersion, setDdVersion] = useState('');
  const [championMap, setChampionMap] = useState<Record<string, TftChampion>>({});
  const [costFilter, setCostFilter] = useState<number | null>(null);

  useEffect(() => {
    loadTftSetMeta().then(meta => { if (meta?.latestPatch) setDdVersion(meta.latestPatch); });
  }, []);
  useEffect(() => {
    if (!ddVersion) return;
    loadTftChampions(ddVersion).then(setChampionMap);
  }, [ddVersion]);

  useEffect(() => {
    fetch(`/api/tft/units?region=euw1&bucket=${bucket}`)
      .then(r => r.json())
      .then(d => { setHasData(!!d.hasData); setUnits(d.units || []); })
      .catch(() => { setHasData(false); setUnits([]); });
  }, [bucket]);

  const filtered = useMemo(() => {
    if (costFilter == null) return units;
    return units.filter(u => (championMap[u.characterId]?.cost ?? -1) === costFilter);
  }, [units, championMap, costFilter]);

  const totalGames = useMemo(() => units.reduce((s, u) => s + u.games, 0) / 8, [units]);
  // Pickrate denominator = total games (we count one unit-game per slot, divide by 8 because each match has 8 boards each with up to 9 units; rough).

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="units" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-5">
          <h1 className="text-white text-2xl font-medium">{t('nav.units')}</h1>
          <TierFilter value={bucket} onChange={setBucket} />
        </div>

        {/* Cost filter chips */}
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
              const ch = championMap[u.characterId];
              const cost = ch?.cost ?? 1;
              const costColor = costColorOf(cost);
              return (
                <a
                  key={u.characterId}
                  href={`/tft/units/${encodeURIComponent(u.characterId)}?bucket=${bucket}`}
                  className="grid grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem] gap-2 px-4 py-2 items-center text-xs hover:bg-white/5 border-t border-[#1e2a3a]"
                >
                  <div className="w-9 h-9 rounded border-2" style={{ borderColor: costColor }}>
                    {ddVersion && ch?.image?.full && (
                      <img
                        src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/tft-champion/${ch.image.full}`}
                        alt={ch.name}
                        className="w-full h-full object-cover rounded-sm"
                      />
                    )}
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
