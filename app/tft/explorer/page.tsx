'use client';
import { useEffect, useMemo, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import EmptyData from '../../components/tft/EmptyData';
import CompCard from '../../components/tft/CompCard';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftChampionTileUrl, tftIconUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';
import { costColor as costColorOf } from '../../lib/tft-ui';
import TierFilter, { type TierBucket } from '../../components/tft/TierFilter';

// Data Explorer: cross-cut the comp dataset by champion(s), item(s), trait(s)
// + tier/region/days/patch. Client-side filtering against the existing
// /api/tft/comps endpoint — no new backend until we know which filter
// combos users actually want indexed.

interface Comp {
  source?: 'data' | 'editorial';
  slug: string;
  clusterKey: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  pickRate?: number | null;
  typicalUnits: { characterId: string; count: number | unknown; topItems?: { apiName: string; count: number | unknown }[] }[];
  typicalAugments: { apiName: string; count: number | unknown }[];
  carryItems: { items: string[]; count: number | unknown }[];
}

type SortKey = 'avg' | 'top4' | 'top1' | 'games';

function parseTrait(key: string): string | null {
  const m = /^(.+)@\d+_.+$/.exec(key);
  return m ? m[1] : null;
}

function compMatches(comp: Comp, units: string[], items: string[], traits: string[]): boolean {
  if (units.length > 0) {
    const compUnits = new Set((comp.typicalUnits || []).map(u => u.characterId));
    for (const u of units) if (!compUnits.has(u)) return false;
  }
  if (items.length > 0) {
    const compItems = new Set<string>();
    for (const set of (comp.carryItems || [])) for (const it of set.items) compItems.add(it);
    for (const u of (comp.typicalUnits || [])) for (const it of (u.topItems || [])) compItems.add(it.apiName);
    for (const i of items) if (!compItems.has(i)) return false;
  }
  if (traits.length > 0) {
    const compTrait = parseTrait(comp.clusterKey);
    if (!compTrait) return false;
    for (const tr of traits) if (compTrait !== tr) return false;
  }
  return true;
}

export default function TftExplorerPage() {
  const { t } = useI18n();
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [comps, setComps] = useState<Comp[]>([]);
  const [loading, setLoading] = useState(false);
  const [bucket, setBucket] = useState<TierBucket>('master_plus');
  const [region, setRegion] = useState('all');
  const [days, setDays] = useState(3);

  const [units, setUnits] = useState<string[]>([]);
  const [items, setItems] = useState<string[]>([]);
  const [traits, setTraits] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>('avg');
  const [minGames, setMinGames] = useState(50);

  const [unitQuery, setUnitQuery] = useState('');
  const [itemQuery, setItemQuery] = useState('');
  const [traitQuery, setTraitQuery] = useState('');

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/tft/comps?region=${region}&bucket=${bucket}&days=${days}&patch=current&source=data`)
      .then(r => r.json())
      .then(d => setComps(d.comps || []))
      .catch(() => setComps([]))
      .finally(() => setLoading(false));
  }, [bucket, region, days]);

  // Build sortable champion / item / trait lists from assets, gated by current
  // set so we don't surface inactive units.
  const unitOptions = useMemo(() => {
    if (!assets) return [] as { id: string; name: string; cost: number }[];
    return Object.values(assets.champions)
      .filter(c => c && (c as any).cost > 0 && (c as any).cost <= 5)
      .map(c => ({ id: (c as any).characterId, name: (c as any).name, cost: (c as any).cost }))
      .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  }, [assets]);

  const itemOptions = useMemo(() => {
    if (!assets) return [] as { id: string; name: string; icon: string | null }[];
    return Object.entries(assets.items)
      .map(([id, meta]) => ({ id, name: (meta as any).name as string, icon: (meta as any).icon || null }))
      .filter(x => x.name && !/component|recipe/i.test(x.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [assets]);

  const traitOptions = useMemo(() => {
    if (!assets) return [] as { id: string; name: string }[];
    return Object.entries(assets.traits)
      .map(([id, meta]) => ({ id, name: (meta as any).name as string }))
      .filter(x => x.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [assets]);

  const filtered = useMemo(() => {
    const result = comps.filter(c => c.games >= minGames && compMatches(c, units, items, traits));
    result.sort((a, b) => {
      switch (sortBy) {
        case 'avg':   return (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9);
        case 'top4':  return (b.top4Rate ?? 0) - (a.top4Rate ?? 0);
        case 'top1':  return (b.top1Rate ?? 0) - (a.top1Rate ?? 0);
        case 'games': return b.games - a.games;
        default:      return 0;
      }
    });
    return result;
  }, [comps, units, items, traits, sortBy, minGames]);

  const aggregate = useMemo(() => {
    if (filtered.length === 0) return null;
    const totalGames = filtered.reduce((s, c) => s + c.games, 0);
    if (totalGames === 0) return null;
    const wAvg = filtered.reduce((s, c) => s + (c.avgPlacement ?? 0) * c.games, 0) / totalGames;
    const wTop4 = filtered.reduce((s, c) => s + (c.top4Rate ?? 0) * c.games, 0) / totalGames;
    const wTop1 = filtered.reduce((s, c) => s + (c.top1Rate ?? 0) * c.games, 0) / totalGames;
    return { compCount: filtered.length, totalGames, wAvg, wTop4, wTop1 };
  }, [filtered]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="explorer" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5">
          <h1 className="text-white text-xl font-medium">{t('tft.explorer.title')}</h1>
        </div>

        {/* Filter rail (left) + results (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* Filter rail */}
          <div className="space-y-3 lg:sticky lg:top-4 self-start">
            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-3 space-y-3">
              <div>
                <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest mb-1.5">{t('tft.filter.bucket')}</div>
                <TierFilter value={bucket} onChange={setBucket} />
              </div>
              <div>
                <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest mb-1.5">{t('tft.filter.region')}</div>
                <select
                  value={region}
                  onChange={e => setRegion(e.target.value)}
                  className="w-full bg-[#141c2e] border border-[#1e2a3a] rounded text-white text-sm px-2 py-1.5"
                >
                  <option value="all">{t('tft.filter.allRegions')}</option>
                  <option value="euw1">EUW</option>
                  <option value="na1">NA</option>
                  <option value="kr">KR</option>
                  <option value="eun1">EUNE</option>
                  <option value="tr1">TR</option>
                  <option value="br1">BR</option>
                </select>
              </div>
              <div>
                <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest mb-1.5">{t('tft.filter.days')}</div>
                <div className="flex gap-1">
                  {[1, 3, 7].map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDays(d)}
                      className={`flex-1 py-1.5 text-xs rounded border ${days === d ? 'bg-[#7B61FF]/20 border-[#7B61FF] text-white' : 'bg-[#141c2e] border-[#1e2a3a] text-[#a0b0c5]'}`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest mb-1.5">{t('tft.explorer.minGames')}</div>
                <input
                  type="number" min={0} value={minGames}
                  onChange={e => setMinGames(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-[#141c2e] border border-[#1e2a3a] rounded text-white text-sm px-2 py-1.5 tabular-nums"
                />
              </div>
            </div>

            <FilterPicker
              title={t('tft.explorer.units')}
              icon="champion"
              assets={assets}
              query={unitQuery}
              setQuery={setUnitQuery}
              options={unitOptions.filter(o => o.name.toLowerCase().includes(unitQuery.toLowerCase())).slice(0, 60)}
              selected={units}
              toggle={(id) => setUnits(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
              clear={() => setUnits([])}
            />

            <FilterPicker
              title={t('tft.explorer.items')}
              icon="item"
              assets={assets}
              query={itemQuery}
              setQuery={setItemQuery}
              options={itemOptions.filter(o => o.name.toLowerCase().includes(itemQuery.toLowerCase())).slice(0, 60)}
              selected={items}
              toggle={(id) => setItems(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
              clear={() => setItems([])}
            />

            <FilterPicker
              title={t('tft.explorer.traits')}
              icon="trait"
              assets={assets}
              query={traitQuery}
              setQuery={setTraitQuery}
              options={traitOptions.filter(o => o.name.toLowerCase().includes(traitQuery.toLowerCase())).slice(0, 60)}
              selected={traits}
              toggle={(id) => setTraits(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
              clear={() => setTraits([])}
            />
          </div>

          {/* Results */}
          <div className="space-y-3">
            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-3 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                {(['avg', 'top4', 'top1', 'games'] as SortKey[]).map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSortBy(k)}
                    className={`px-2.5 py-1 text-[11px] rounded border ${sortBy === k ? 'bg-[#7B61FF] border-[#7B61FF] text-white' : 'bg-[#141c2e] border-[#1e2a3a] text-[#a0b0c5]'}`}
                  >
                    {t(`tft.explorer.sort.${k}`)}
                  </button>
                ))}
              </div>
              {aggregate && (
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-[#7a8aa0]">{aggregate.compCount} comps</span>
                  <span className="text-white tabular-nums">Ø {aggregate.wAvg.toFixed(2)}</span>
                  <span className="text-[#3ecf8e] tabular-nums">{(aggregate.wTop4 * 100).toFixed(1)}% T4</span>
                  <span className="text-[#e0c75a] tabular-nums">{(aggregate.wTop1 * 100).toFixed(1)}% Win</span>
                </div>
              )}
            </div>

            {loading && <div className="text-[#7a8aa0] text-center py-8 text-sm">…</div>}
            {!loading && filtered.length === 0 && comps.length > 0 && (
              <EmptyData />
            )}
            {!loading && filtered.slice(0, 100).map((c, i) => (
              <CompCard
                key={c.slug}
                comp={c as any}
                rank={i + 1}
                assets={assets}
                href={`/tft/comps/${encodeURIComponent(c.slug)}?region=${region}&bucket=${bucket}`}
              />
            ))}
          </div>
        </div>
      </div>
      <Footer />
    </main>
  );
}

function FilterPicker({
  title, icon, assets, query, setQuery, options, selected, toggle, clear,
}: {
  title: string;
  icon: 'champion' | 'item' | 'trait';
  assets: TftAssetsBundle | null;
  query: string;
  setQuery: (q: string) => void;
  options: Array<{ id: string; name: string; cost?: number; icon?: string | null }>;
  selected: string[];
  toggle: (id: string) => void;
  clear: () => void;
}) {
  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest">{title}</div>
        {selected.length > 0 && (
          <button type="button" onClick={clear} className="text-[10px] text-[#7B61FF] hover:underline">
            × {selected.length}
          </button>
        )}
      </div>
      <input
        type="text" value={query} onChange={e => setQuery(e.target.value)}
        placeholder=""
        className="w-full bg-[#141c2e] border border-[#1e2a3a] rounded text-white text-xs px-2 py-1.5 mb-2"
      />
      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {options.map(o => {
          const active = selected.includes(o.id);
          let iconUrl: string | null = null;
          if (icon === 'champion' && assets) iconUrl = tftChampionTileUrl(assets, assets.champions[o.id]) || null;
          else if (icon === 'item' && assets) iconUrl = tftIconUrl(assets, (assets.items[o.id] as any)?.icon) || null;
          else if (icon === 'trait' && assets) iconUrl = tftIconUrl(assets, (assets.traits[o.id] as any)?.icon) || null;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => toggle(o.id)}
              className={`w-full flex items-center gap-2 px-1.5 py-1 rounded text-left ${active ? 'bg-[#7B61FF]/20' : 'hover:bg-[#141c2e]'}`}
            >
              {iconUrl ? (
                <img src={iconUrl} alt="" className="w-5 h-5 rounded object-cover flex-none" style={{ border: icon === 'champion' && o.cost ? `1px solid ${costColorOf(o.cost)}` : undefined }} />
              ) : (
                <div className="w-5 h-5 rounded bg-[#1e2a3a] flex-none" />
              )}
              <span className={`text-xs truncate ${active ? 'text-white' : 'text-[#a0b0c5]'}`}>{o.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
