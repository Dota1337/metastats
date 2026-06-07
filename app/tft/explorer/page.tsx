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

type Mode = 'comps' | 'matches';

interface MatchSample {
  matchId: string;
  region: string;
  placement: number;
  level: number;
  lastRound: number;
  totalDamage: number;
  compClusterKey: string | null;
  carryUnit: string | null;
  gameDatetime: number;
  units: { characterId: string; tier: number; items: string[] }[];
}
interface MatchAggregate {
  avgPlacement: number;
  top4Rate: number;
  top1Rate: number;
  avgLevel: number;
  avgLastRound: number;
  avgDamage: number;
  regionDist: Record<string, number>;
}

export default function TftExplorerPage() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('comps');
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

  // Match-level state
  const [matchSample, setMatchSample] = useState<MatchSample[]>([]);
  const [matchAggregate, setMatchAggregate] = useState<MatchAggregate | null>(null);
  const [matchCount, setMatchCount] = useState<number>(0);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    if (mode !== 'comps') return;
    setLoading(true);
    fetch(`/api/tft/comps?region=${region}&bucket=${bucket}&days=${days}&patch=current&source=data`)
      .then(r => r.json())
      .then(d => setComps(d.comps || []))
      .catch(() => setComps([]))
      .finally(() => setLoading(false));
  }, [bucket, region, days, mode]);

  // Match-level query runs only when at least 1 unit is picked + button click.
  // Auto-trigger on unit/region/days change to keep it interactive but cap to
  // skip empty unit-selection (would scan everything).
  useEffect(() => {
    if (mode !== 'matches') return;
    if (units.length === 0) {
      setMatchSample([]); setMatchAggregate(null); setMatchCount(0); setMatchError(null);
      return;
    }
    setMatchLoading(true);
    setMatchError(null);
    fetch('/api/tft/explorer/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ units, region, days, limit: 5000 }),
    })
      .then(async r => {
        if (!r.ok) { throw new Error((await r.json()).error || `HTTP ${r.status}`); }
        return r.json();
      })
      .then(d => {
        setMatchSample(d.sample || []);
        setMatchAggregate(d.aggregate || null);
        setMatchCount(d.matchCount || 0);
      })
      .catch(err => {
        setMatchError(err.message || 'fail');
        setMatchSample([]); setMatchAggregate(null); setMatchCount(0);
      })
      .finally(() => setMatchLoading(false));
  }, [mode, units, region, days]);

  // Build sortable champion / item / trait lists from assets, gated by the
  // current set so we don't surface inactive units, augments (Riot-tabu),
  // or junk like recipes/components.
  // The asset keys ARE the api-IDs (e.g. champions['TFT17_Karma'] not
  // champions[i].characterId); the value-side `characterId` doesn't exist.
  const SET_PREFIX = `TFT${assets?.set ?? 17}_`;

  const unitOptions = useMemo(() => {
    if (!assets) return [] as { id: string; name: string; cost: number }[];
    return Object.entries(assets.champions)
      .filter(([id, c]) => {
        if (!id.startsWith(SET_PREFIX)) return false;
        const ch = c as any;
        if (!ch || ch.cost <= 0 || ch.cost > 5) return false;
        // Playable champions always have at least one trait. PvE summons
        // (Mini Black Hole, Apex Primordian, Enemy_*) and "FakeUnit" entries
        // have 0 traits — they sneak past the cost filter but shouldn't
        // appear in the playable-champion picker.
        if (!Array.isArray(ch.traits) || ch.traits.length === 0) return false;
        if (/Enemy_|FakeUnit|Minion|Summon/i.test(id)) return false;
        return true;
      })
      .map(([id, c]) => ({ id, name: (c as any).name as string, cost: (c as any).cost as number }))
      .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  }, [assets, SET_PREFIX]);

  const itemOptions = useMemo(() => {
    if (!assets) return [] as { id: string; name: string; icon: string | null }[];
    // Whitelist statt Blacklist — drei klare Kategorien:
    //   1. Normale Combat-Items   →  TFT_Item_<Name>          (Deathblade, Infinity Edge …)
    //   2. Artefakte              →  TFT_Item_Artifact_<Name> + TFT<set>_Item_Artifact_<Name>
    //   3. Radiant-Versionen      →  TFT<n>_Item_<Name>Radiant
    // Alles andere (Augments, Emblems, Spatulas, MarketOfferings, Hex-Buffs,
    // Loot-Orbs, Anvils, Trait-Emblems, Debug-Items, Set-Mechanik-Mods,
    // Tactician-Items, Tome-Items) fällt explizit raus.
    const JUNK_NAME = /^@|^tft_item_name_|@[A-Za-z]+@/i;
    return Object.entries(assets.items)
      .filter(([id, meta]) => {
        const name = (meta as any)?.name;
        if (!name || JUNK_NAME.test(name)) return false;
        // Artefakte aus jedem Set
        if (/^TFT(\d+)?_Item_Artifact_/.test(id)) return true;
        // Radiant-Items (TFT5_Item_*Radiant, TFT17_Item_*_Radiant)
        if (/^TFT\d+_Item_.*Radiant$/.test(id)) return true;
        // Normale Combat-Items: TFT_Item_<Name> ohne Junk-Suffix
        if (id.startsWith('TFT_Item_')) {
          if (/Grant|Anvil|Offering|Orb|Mod|Spat|Augment|Tome|Refund|Tactician|Choice|Test|Debug|Hex|Emblem|TestDummy|Crit|Capsule|Crown/i.test(id)) return false;
          if (/component|recipe/i.test(name)) return false;
          return true;
        }
        return false;
      })
      .map(([id, meta]) => ({ id, name: (meta as any).name as string, icon: (meta as any).icon || null }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [assets]);

  const traitOptions = useMemo(() => {
    if (!assets) return [] as { id: string; name: string }[];
    return Object.entries(assets.traits)
      .filter(([id, meta]) => id.startsWith(SET_PREFIX) && (meta as any)?.name)
      .map(([id, meta]) => ({ id, name: (meta as any).name as string }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [assets, SET_PREFIX]);

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
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5 flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-white text-xl font-medium">{t('tft.explorer.title')}</h1>
          <div className="flex gap-1 bg-[#141c2e] border border-[#1e2a3a] rounded p-1">
            {(['comps', 'matches'] as Mode[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1 text-xs rounded ${mode === m ? 'bg-[#7B61FF] text-white' : 'text-[#a0b0c5] hover:text-white'}`}
              >
                {t(`tft.explorer.mode.${m}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Filter rail (left) + results (right). Sticky rail with its own
            inner scroll so the user doesn't have to scroll past 200+ comps
            to reach the trait picker. The max-h leaves ~5rem at the top for
            the Nav + a small bottom gap so the rail never bleeds off-screen. */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* Filter rail */}
          <div className="space-y-3 lg:sticky lg:top-4 self-start lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto lg:pr-1 lg:[scrollbar-gutter:stable]">
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
            {mode === 'comps' && (
              <>
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
              </>
            )}

            {mode === 'matches' && (
              <>
                {units.length === 0 && (
                  <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-6 text-center text-[#7a8aa0] text-sm">
                    {t('tft.explorer.matches.pickUnits')}
                  </div>
                )}

                {units.length > 0 && matchLoading && (
                  <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-6 text-center text-[#7a8aa0] text-sm">
                    {t('tft.explorer.matches.loading')}
                  </div>
                )}

                {matchError && (
                  <div className="bg-[#0d1526] border border-[#7B61FF]/40 rounded-lg p-3 text-[#a0b0c5] text-sm">
                    {matchError}
                  </div>
                )}

                {units.length > 0 && !matchLoading && matchAggregate && (
                  <>
                    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <BigStat label={t('tft.avgPlacement')} value={matchAggregate.avgPlacement.toFixed(2)} />
                        <BigStat label={t('tft.top4')} value={`${(matchAggregate.top4Rate * 100).toFixed(1)}%`} accent="#3ecf8e" />
                        <BigStat label={t('tft.top1')} value={`${(matchAggregate.top1Rate * 100).toFixed(1)}%`} accent="#e0c75a" />
                        <BigStat label={t('tft.explorer.matches.count')} value={matchCount.toLocaleString('de-DE')} />
                      </div>
                      <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-[#1e2a3a]">
                        <Stat label={t('tft.explorer.matches.avgLevel')} value={matchAggregate.avgLevel.toFixed(1)} />
                        <Stat label={t('tft.explorer.matches.avgLastRound')} value={matchAggregate.avgLastRound.toFixed(1)} />
                        <Stat label={t('tft.explorer.matches.avgDamage')} value={matchAggregate.avgDamage.toFixed(0)} />
                      </div>
                    </div>

                    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg overflow-hidden">
                      <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest px-3 py-2 border-b border-[#1e2a3a]">
                        {t('tft.explorer.matches.recent')}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px] tabular-nums">
                          <thead className="text-[#7a8aa0]">
                            <tr className="border-b border-[#1e2a3a]">
                              <th className="text-left px-2 py-1.5 font-normal">#</th>
                              <th className="text-left px-2 py-1.5 font-normal">{t('tft.filter.region')}</th>
                              <th className="text-left px-2 py-1.5 font-normal">{t('tft.explorer.matches.lvl')}</th>
                              <th className="text-left px-2 py-1.5 font-normal">{t('tft.explorer.matches.board')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {matchSample.map(m => (
                              <tr key={m.matchId} className="border-b border-[#1e2a3a]/50 last:border-0">
                                <td className="px-2 py-1.5 text-white">{m.placement}</td>
                                <td className="px-2 py-1.5 text-[#a0b0c5] uppercase">{m.region}</td>
                                <td className="px-2 py-1.5 text-[#a0b0c5]">{m.level}</td>
                                <td className="px-2 py-1.5">
                                  <div className="flex gap-0.5 flex-wrap">
                                    {m.units.slice(0, 9).map(u => {
                                      const ch = assets?.champions[u.characterId];
                                      const url = tftChampionTileUrl(assets, ch);
                                      const isCarry = u.characterId === m.carryUnit;
                                      return url ? (
                                        <a
                                          key={u.characterId}
                                          href={`/tft/units/${encodeURIComponent(u.characterId)}`}
                                          className="block"
                                          title={`${ch?.name || u.characterId} ★${u.tier}`}
                                        >
                                          <img
                                            src={url}
                                            alt={ch?.name || u.characterId}
                                            className="w-6 h-6 rounded object-cover"
                                            style={{ border: `1.5px solid ${isCarry ? '#c39bff' : ((ch as any)?.cost ? costColorOf((ch as any).cost) : '#1e2a3a')}` }}
                                          />
                                        </a>
                                      ) : null;
                                    })}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}

                {units.length > 0 && !matchLoading && !matchAggregate && !matchError && (
                  <EmptyData />
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </main>
  );
}

function BigStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-[#141c2e] border border-[#1e2a3a] rounded p-2.5">
      <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest">{label}</div>
      <div className="text-lg font-medium tabular-nums" style={{ color: accent || '#ffffff' }}>{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest">{label}</div>
      <div className="text-sm text-white font-medium tabular-nums">{value}</div>
    </div>
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
      <div className="max-h-40 overflow-y-auto space-y-0.5">
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
