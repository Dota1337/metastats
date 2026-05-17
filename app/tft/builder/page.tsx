'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftChampionTileUrl, tftIconUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';

// Comp-Builder MVP. Click a champion in the palette to add it to the board
// (max 9 slots — TFT level cap). Click a board slot to remove it. Trait
// activations are computed live from the selected roster against the
// CommunityDragon asset bundle, breakpoint pills highlight when reached.
//
// State is encoded into the URL as a comma-separated character_id list so
// builds are shareable via copy-paste. No drag-and-drop yet — would need
// `react-dnd`/`dnd-kit` and 5-10× the code for a feature mainly used to
// reorder, not to add/remove.

const MAX_SLOTS = 9;

interface ChampionLite {
  characterId: string;
  name: string;
  cost: number;
  traits: string[];
}

export default function TftBuilderPage() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [board, setBoard] = useState<string[]>(() => {
    const raw = search.get('comp') || '';
    return raw ? raw.split(',').filter(Boolean).slice(0, MAX_SLOTS) : [];
  });
  const [costFilter, setCostFilter] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  // Sync board state to URL so builds stay shareable.
  useEffect(() => {
    const target = board.length > 0
      ? `${pathname}?comp=${encodeURIComponent(board.join(','))}`
      : pathname;
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== target) {
      router.replace(target, { scroll: false });
    }
  }, [board, pathname, router]);

  const champions = useMemo((): ChampionLite[] => {
    if (!assets) return [];
    return Object.entries(assets.champions)
      .filter(([id, c]: any) => /^TFT\d+_/.test(id) && c.name && (c.cost ?? 0) >= 1 && (c.cost ?? 0) <= 5)
      .map(([id, c]: any) => ({
        characterId: id,
        name: c.name,
        cost: c.cost ?? 1,
        traits: c.traits || [],
      }))
      .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  }, [assets]);

  const filteredChampions = useMemo(() => {
    return champions.filter(c => {
      if (costFilter != null && c.cost !== costFilter) return false;
      if (query && !c.name.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [champions, costFilter, query]);

  const activeTraits = useMemo(() => {
    if (!assets) return [] as { apiName: string; name: string; count: number; tiers: any[]; activeIdx: number | null; icon?: string }[];
    // Champions can list traits either by display name or apiName depending
    // on CommunityDragon set conventions, so we normalise to display name
    // before counting.
    const counts = new Map<string, number>();
    const seenPuuid = new Set<string>();
    for (const cid of board) {
      if (seenPuuid.has(cid)) continue;
      seenPuuid.add(cid);
      const champ: any = assets.champions[cid];
      if (!champ?.traits) continue;
      for (const tr of champ.traits) {
        // Resolve to display name via assets.traits lookup
        const meta: any = assets.traits[tr] || Object.values(assets.traits).find((m: any) => m.name === tr);
        const displayName = meta?.name || tr;
        counts.set(displayName, (counts.get(displayName) || 0) + 1);
      }
    }
    const out: { apiName: string; name: string; count: number; tiers: any[]; activeIdx: number | null; icon?: string }[] = [];
    for (const [displayName, count] of counts) {
      const traitEntry = Object.entries(assets.traits).find(([, m]: any) => m.name === displayName);
      if (!traitEntry) continue;
      const [apiName, meta]: any = traitEntry;
      const tiers = meta.tiers || [];
      let activeIdx: number | null = null;
      for (let i = tiers.length - 1; i >= 0; i--) {
        if (count >= (tiers[i].minUnits ?? 99)) { activeIdx = i; break; }
      }
      out.push({ apiName, name: displayName, count, tiers, activeIdx, icon: meta.icon });
    }
    return out.sort((a, b) => {
      const aActive = a.activeIdx ?? -1;
      const bActive = b.activeIdx ?? -1;
      if (aActive !== bActive) return bActive - aActive;
      return b.count - a.count;
    });
  }, [board, assets]);

  function addChampion(cid: string) {
    if (board.length >= MAX_SLOTS || board.includes(cid)) return;
    setBoard([...board, cid]);
  }

  function removeChampion(cid: string) {
    setBoard(board.filter(c => c !== cid));
  }

  function clearBoard() {
    setBoard([]);
  }

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <TftHero pageTitle={t('tft.builderTitle')} subtitle={t('tft.builderSubtitle')} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
          {/* Left column: board + champion palette */}
          <div>
            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[#a0b0c5] text-xs uppercase tracking-widest">
                  {t('tft.builderBoard')} · {board.length}/{MAX_SLOTS}
                </div>
                {board.length > 0 && (
                  <button
                    onClick={clearBoard}
                    className="text-[#7a8aa0] hover:text-[#e44040] text-xs"
                  >
                    {t('tft.builderClear')}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-9 gap-1.5">
                {Array.from({ length: MAX_SLOTS }).map((_, i) => {
                  const cid = board[i];
                  if (!cid) {
                    return (
                      <div key={i} className="aspect-square rounded border border-dashed border-[#1e2a3a] bg-[#0a0e1a]" />
                    );
                  }
                  const champ: any = assets?.champions[cid];
                  const url = tftChampionTileUrl(assets, champ);
                  return (
                    <button
                      key={cid}
                      onClick={() => removeChampion(cid)}
                      className="aspect-square rounded border-2 overflow-hidden hover:opacity-60 transition-opacity"
                      style={{ borderColor: costColorOf(champ?.cost ?? 1) }}
                      title={`${champ?.name || cid} — Klicken zum Entfernen`}
                    >
                      {url && <img src={url} alt={champ?.name || ''} className="w-full h-full object-cover" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4">
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCostFilter(null)}
                    className={`px-2.5 py-1 rounded text-xs ${costFilter == null ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#a0b0c5] hover:text-white'}`}
                  >
                    {t('tft.bucket.all')}
                  </button>
                  {[1, 2, 3, 4, 5].map(c => (
                    <button
                      key={c}
                      onClick={() => setCostFilter(c)}
                      className={`px-2.5 py-1 rounded text-xs ${costFilter === c ? 'text-white' : 'bg-[#141c2e] text-[#a0b0c5] hover:text-white'}`}
                      style={costFilter === c ? { backgroundColor: costColorOf(c) } : {}}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <input
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={t('tft.builderSearch')}
                  className="flex-1 min-w-[160px] bg-[#141c2e] border border-[#1e2a3a] rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[#7B61FF]/60"
                />
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5">
                {filteredChampions.map(c => {
                  const champ: any = assets?.champions[c.characterId];
                  const url = tftChampionTileUrl(assets, champ);
                  const inBoard = board.includes(c.characterId);
                  const full = board.length >= MAX_SLOTS && !inBoard;
                  return (
                    <button
                      key={c.characterId}
                      onClick={() => addChampion(c.characterId)}
                      disabled={inBoard || full}
                      className="aspect-square rounded border-2 overflow-hidden transition disabled:opacity-30"
                      style={{ borderColor: costColorOf(c.cost) }}
                      title={`${c.name} (${c.cost}-Cost)`}
                    >
                      {url && <img src={url} alt={c.name} className="w-full h-full object-cover" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right column: active-traits panel */}
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4 lg:sticky lg:top-4 lg:self-start">
            <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">
              {t('tft.builderTraits')}
            </div>
            {board.length === 0 ? (
              <div className="text-[#7a8aa0] text-xs">—</div>
            ) : (
              <div className="space-y-2">
                {activeTraits.map(tr => {
                  const tierIdx = tr.activeIdx;
                  const iconUrl = tftIconUrl(assets, tr.icon);
                  const tier = tierIdx != null ? tr.tiers[tierIdx] : null;
                  const styleColor = tier?.style === 5 ? '#c39bff'
                    : tier?.style === 4 ? '#e0c75a'
                    : tier?.style === 3 ? '#cfd6dc'
                    : tier?.style === 1 ? '#a07a4d'
                    : '#5a6a80';
                  return (
                    <div
                      key={tr.apiName}
                      className="flex items-center gap-2 p-1.5 rounded"
                      style={{ backgroundColor: tier ? `${styleColor}15` : 'transparent' }}
                    >
                      {iconUrl ? (
                        <img src={iconUrl} alt="" className="w-6 h-6 rounded" style={{ filter: tier ? 'none' : 'grayscale(1)' }} />
                      ) : (
                        <div className="w-6 h-6 rounded bg-[#1e2a3a]" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-xs truncate">{tr.name}</div>
                        <div className="flex items-center gap-0.5 mt-0.5">
                          {tr.tiers.map((tierDef: any, i: number) => (
                            <span
                              key={i}
                              className="text-[10px] tabular-nums px-1 rounded"
                              style={{
                                color: i === tierIdx ? '#fff' : '#5a6a80',
                                backgroundColor: i === tierIdx ? styleColor : 'transparent',
                              }}
                            >
                              {tierDef.minUnits}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="text-white tabular-nums text-sm" style={{ color: tier ? styleColor : '#7a8aa0' }}>
                        {tr.count}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </main>
  );
}

function costColorOf(cost: number) {
  return cost === 1 ? '#9aa6b2' : cost === 2 ? '#3a8' : cost === 3 ? '#3a8ddc' : cost === 4 ? '#c39bff' : '#e0c75a';
}
