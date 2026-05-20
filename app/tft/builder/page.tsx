'use client';
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftChampionTileUrl, tftIconUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';

// Visual comp-builder with TFT-standard 4×7 pointy-top hex board.
// Row layout (cell indices) — matches in-game player POV:
//   Row 0 (back)  cells 0..6                            → visual BOTTOM row
//   Row 1         cells 7..13   (shifted right by half) → 2nd from bottom
//   Row 2         cells 14..20                          → 2nd from top
//   Row 3 (front) cells 21..27 (shifted right)          → visual TOP row
//
// Cells are positioned absolutely; we flip the topPct so data-row 3
// (frontline) lands at the top of the board — what the player sees in-game.
// Stagger stays bound to the data-row index, so odd data-rows (1, 3) keep
// their half-cell right-shift, matching the in-game silhouette.
//
// Two boards (own + optional opponent) share the same cell coordinate
// space; placements are kept in separate arrays. URL ?b= encodes both,
// localStorage saved-comps store both.
//
// Hex cells use a clip-path polygon overlay. To get a visible "border"
// without losing the hex shape, we draw a colored outer layer and an
// inset dark inner layer — the gap acts as the border.

const ROWS = 4;
const COLS = 7;
const MAX_UNITS = 10;
const MAX_ITEMS_PER_UNIT = 3;
const STORAGE_KEY = 'tft.savedComps';
const HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';

type Team = 'own' | 'opp';

interface Placement {
  cell: number;
  characterId: string;
  items: string[];
}

interface SavedComp {
  id: string;
  name: string;
  placements: Placement[];
  oppPlacements: Placement[];
  createdAt: number;
}

type ItemTab = 'completed' | 'components' | 'radiant' | 'artifacts' | 'emblems' | 'all';

interface ItemEntry {
  id: string;
  name: string;
  icon: string | null;
  category: ItemTab[];
}

function encodeState(own: Placement[], opp: Placement[]): string {
  if (own.length === 0 && opp.length === 0) return '';
  try {
    const compact: any = { p: own.map(p => ({ c: p.cell, i: p.characterId, t: p.items })) };
    if (opp.length > 0) compact.o = opp.map(p => ({ c: p.cell, i: p.characterId, t: p.items }));
    return btoa(JSON.stringify(compact));
  } catch { return ''; }
}

function decodePlacementArray(json: any): Placement[] {
  if (!Array.isArray(json)) return [];
  return json
    .map((e: any): Placement | null => {
      if (typeof e !== 'object' || e == null) return null;
      const cell = Number(e.c);
      const cid = String(e.i || '');
      const items = Array.isArray(e.t) ? e.t.filter((x: any) => typeof x === 'string').slice(0, MAX_ITEMS_PER_UNIT) : [];
      if (!Number.isFinite(cell) || cell < 0 || cell >= ROWS * COLS) return null;
      if (!cid) return null;
      return { cell, characterId: cid, items };
    })
    .filter(Boolean) as Placement[];
}

function decodeState(s: string): { own: Placement[]; opp: Placement[] } {
  if (!s) return { own: [], opp: [] };
  try {
    const json = JSON.parse(atob(s));
    // Backward compatible: old encoding was a plain array of placements.
    if (Array.isArray(json)) return { own: decodePlacementArray(json), opp: [] };
    return { own: decodePlacementArray(json.p || []), opp: decodePlacementArray(json.o || []) };
  } catch { return { own: [], opp: [] }; }
}

function categorizeItem(id: string, name: string): ItemTab[] {
  const cats: ItemTab[] = ['all'];
  if (/Emblem/i.test(id) || /Emblem/i.test(name)) cats.push('emblems');
  else if (/Artifact/i.test(id)) cats.push('artifacts');
  else if (/Radiant/i.test(id)) cats.push('radiant');
  return cats;
}

export default function TftBuilderPage() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const initial = useMemo(() => decodeState(search.get('b') || ''), [search]);
  const [ownPlacements, setOwnPlacements] = useState<Placement[]>(initial.own);
  const [oppPlacements, setOppPlacements] = useState<Placement[]>(initial.opp);
  const [showOpponent, setShowOpponent] = useState<boolean>(initial.opp.length > 0);
  const [pickerChar, setPickerChar] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<Team>('own');
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [costFilter, setCostFilter] = useState<number | null>(null);
  const [champQuery, setChampQuery] = useState('');
  const [itemTab, setItemTab] = useState<ItemTab>('completed');
  const [itemQuery, setItemQuery] = useState('');
  const [savedComps, setSavedComps] = useState<SavedComp[]>([]);
  const [shareToast, setShareToast] = useState(false);
  const dragRef = useRef<{ from: 'palette' | 'board'; payload: string | number; fromTeam?: Team } | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          // migrate older saves that only stored a flat placements array
          const normalised: SavedComp[] = arr.map((c: any) => ({
            id: String(c.id || 'c_' + Math.random()),
            name: String(c.name || ''),
            placements: Array.isArray(c.placements) ? c.placements : [],
            oppPlacements: Array.isArray(c.oppPlacements) ? c.oppPlacements : [],
            createdAt: Number(c.createdAt || Date.now()),
          }));
          setSavedComps(normalised);
        }
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const encoded = encodeState(ownPlacements, oppPlacements);
    const target = encoded ? `${pathname}?b=${encoded}` : pathname;
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== target) {
      router.replace(target, { scroll: false });
    }
  }, [ownPlacements, oppPlacements, pathname, router]);

  const champions = useMemo(() => {
    if (!assets) return [] as { characterId: string; name: string; cost: number }[];
    return Object.entries(assets.champions)
      .filter(([id, c]: any) => /^TFT\d+_/.test(id) && c.name && (c.cost ?? 0) >= 1 && (c.cost ?? 0) <= 5)
      .map(([id, c]: any) => ({ characterId: id, name: c.name, cost: c.cost ?? 1 }))
      .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  }, [assets]);

  const filteredChampions = useMemo(() => {
    return champions.filter(c => {
      if (costFilter != null && c.cost !== costFilter) return false;
      if (champQuery && !c.name.toLowerCase().includes(champQuery.toLowerCase())) return false;
      return true;
    });
  }, [champions, costFilter, champQuery]);

  const items = useMemo<ItemEntry[]>(() => {
    if (!assets) return [];
    const out: ItemEntry[] = [];
    for (const [id, item] of Object.entries(assets.items)) {
      if (/Augment/i.test(id)) continue;
      if (!/^TFT(_|17_|Set\d+_)?Item/i.test(id)) continue;
      if (/Grant|Anvil|Orbs|Loot|Debug|Tutorial|Tactician|TheStar/i.test(id)) continue;
      if (!item.name) continue;
      const hasComp = !!(item.composition && item.composition.length === 2);
      const cats = categorizeItem(id, item.name);
      if (hasComp && !cats.includes('emblems') && !cats.includes('artifacts') && !cats.includes('radiant')) {
        cats.push('completed');
      }
      if (/^TFT_Item_(BFSword|Bow|RodOfAges|RodOfTheJax|Tear|ChainVest|Cloak|GiantsBelt|SparringGloves|Spatula)/i.test(id)) {
        cats.push('components');
      }
      if (cats.length === 1) {
        if (/^TFT17_Item_/i.test(id)) cats.push('artifacts');
      }
      out.push({ id, name: item.name, icon: item.icon, category: cats });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [assets]);

  const filteredItems = useMemo(() => {
    return items.filter(i => {
      if (!i.category.includes(itemTab)) return false;
      if (itemQuery && !i.name.toLowerCase().includes(itemQuery.toLowerCase())) return false;
      return true;
    });
  }, [items, itemTab, itemQuery]);

  // Traits are computed from own + opp boards combined? No — only the
  // own board's traits matter for the user's actual comp. Opp board is
  // a scenario sketch and irrelevant for own-trait activation.
  const activeTraits = useMemo(() => {
    if (!assets) return [] as { apiName: string; name: string; count: number; tiers: any[]; activeIdx: number | null; icon?: string | null }[];
    const counts = new Map<string, number>();
    const seen = new Set<string>();
    for (const p of ownPlacements) {
      if (seen.has(p.characterId)) continue;
      seen.add(p.characterId);
      const champ: any = assets.champions[p.characterId];
      if (!champ?.traits) continue;
      for (const tr of champ.traits) {
        const meta: any = assets.traits[tr] || Object.values(assets.traits).find((m: any) => m.name === tr);
        const displayName = meta?.name || tr;
        counts.set(displayName, (counts.get(displayName) || 0) + 1);
      }
    }
    const out: { apiName: string; name: string; count: number; tiers: any[]; activeIdx: number | null; icon?: string | null }[] = [];
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
  }, [ownPlacements, assets]);

  // ----- Helpers to read/write placements per team -----
  const placementsFor = (team: Team) => team === 'own' ? ownPlacements : oppPlacements;
  const setPlacementsFor = (team: Team, updater: (prev: Placement[]) => Placement[]) => {
    if (team === 'own') setOwnPlacements(updater);
    else setOppPlacements(updater);
  };

  const ownByCell = useMemo(() => {
    const m = new Map<number, Placement>();
    for (const p of ownPlacements) m.set(p.cell, p);
    return m;
  }, [ownPlacements]);
  const oppByCell = useMemo(() => {
    const m = new Map<number, Placement>();
    for (const p of oppPlacements) m.set(p.cell, p);
    return m;
  }, [oppPlacements]);
  const byCell = (team: Team) => team === 'own' ? ownByCell : oppByCell;

  const placeAt = useCallback((team: Team, cell: number, cid: string) => {
    setPlacementsFor(team, prev => {
      const existing = prev.find(p => p.cell === cell);
      if (existing && existing.characterId === cid) return prev;
      const existingElsewhere = prev.find(p => p.characterId === cid && p.cell !== cell);
      let next = prev.filter(p => p.cell !== cell);
      if (existingElsewhere) {
        next = next.filter(p => p.characterId !== cid);
        next.push({ cell, characterId: cid, items: existingElsewhere.items });
      } else {
        if (next.length >= MAX_UNITS && !existing) return prev;
        next.push({ cell, characterId: cid, items: [] });
      }
      return next;
    });
  }, []);

  const removeAt = useCallback((team: Team, cell: number) => {
    setPlacementsFor(team, prev => prev.filter(p => p.cell !== cell));
    if (selectedTeam === team && selectedCell === cell) setSelectedCell(null);
  }, [selectedTeam, selectedCell]);

  const swapWithinTeam = useCallback((team: Team, from: number, to: number) => {
    setPlacementsFor(team, prev => {
      const a = prev.find(p => p.cell === from);
      const b = prev.find(p => p.cell === to);
      if (!a) return prev;
      const next = prev.filter(p => p.cell !== from && p.cell !== to);
      next.push({ ...a, cell: to });
      if (b) next.push({ ...b, cell: from });
      return next;
    });
  }, []);

  const addItemToSelected = useCallback((itemId: string) => {
    if (selectedCell == null) return;
    setPlacementsFor(selectedTeam, prev => prev.map(p => {
      if (p.cell !== selectedCell) return p;
      if (p.items.length >= MAX_ITEMS_PER_UNIT) return p;
      if (p.items.includes(itemId)) return p;
      return { ...p, items: [...p.items, itemId] };
    }));
  }, [selectedCell, selectedTeam]);

  const removeItemFromSelected = useCallback((itemId: string) => {
    if (selectedCell == null) return;
    setPlacementsFor(selectedTeam, prev => prev.map(p => p.cell === selectedCell
      ? { ...p, items: p.items.filter(i => i !== itemId) }
      : p,
    ));
  }, [selectedCell, selectedTeam]);

  function onCellClick(team: Team, cell: number) {
    const occupied = byCell(team).get(cell);
    if (pickerChar) {
      placeAt(team, cell, pickerChar);
      setPickerChar(null);
      setSelectedTeam(team);
      setSelectedCell(cell);
      return;
    }
    if (occupied) {
      if (selectedTeam === team && selectedCell === cell) {
        setSelectedCell(null);
      } else {
        setSelectedTeam(team);
        setSelectedCell(cell);
      }
    } else if (selectedCell != null && selectedTeam === team) {
      swapWithinTeam(team, selectedCell, cell);
      setSelectedCell(cell);
    } else {
      setSelectedCell(null);
    }
  }

  function onCellContextMenu(e: React.MouseEvent, team: Team, cell: number) {
    e.preventDefault();
    removeAt(team, cell);
  }

  function onChampionPick(cid: string) {
    const onBoard = ownPlacements.some(p => p.characterId === cid) || oppPlacements.some(p => p.characterId === cid);
    if (onBoard && !pickerChar) {
      // Remove from whichever team it's on
      setOwnPlacements(prev => prev.filter(p => p.characterId !== cid));
      setOppPlacements(prev => prev.filter(p => p.characterId !== cid));
      return;
    }
    setPickerChar(prev => prev === cid ? null : cid);
  }

  function clearBoard(team?: Team) {
    if (!team) {
      setOwnPlacements([]); setOppPlacements([]);
    } else {
      setPlacementsFor(team, () => []);
    }
    setSelectedCell(null);
    setPickerChar(null);
  }

  function onDragStartChampion(e: React.DragEvent, cid: string) {
    dragRef.current = { from: 'palette', payload: cid };
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', cid);
  }
  function onDragStartBoard(e: React.DragEvent, team: Team, cell: number) {
    dragRef.current = { from: 'board', payload: cell, fromTeam: team };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(cell));
  }
  function onDropCell(e: React.DragEvent, team: Team, cell: number) {
    e.preventDefault();
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.from === 'palette') {
      placeAt(team, cell, String(drag.payload));
    } else if (drag.from === 'board') {
      const from = Number(drag.payload);
      const fromTeam = drag.fromTeam || 'own';
      if (fromTeam === team) {
        if (from !== cell) swapWithinTeam(team, from, cell);
      } else {
        // Move across teams: remove from source, place on target.
        const sourceP = placementsFor(fromTeam).find(p => p.cell === from);
        if (sourceP) {
          setPlacementsFor(fromTeam, prev => prev.filter(p => p.cell !== from));
          setPlacementsFor(team, prev => {
            const next = prev.filter(p => p.cell !== cell);
            if (next.length >= MAX_UNITS) return prev;
            next.push({ cell, characterId: sourceP.characterId, items: sourceP.items });
            return next;
          });
        }
      }
    }
    dragRef.current = null;
  }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); }

  function saveCurrent() {
    const name = (typeof window !== 'undefined' && window.prompt(t('tft.builderSaveName'), '')) || '';
    if (!name.trim()) return;
    const entry: SavedComp = {
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      name: name.trim().slice(0, 60),
      placements: ownPlacements,
      oppPlacements,
      createdAt: Date.now(),
    };
    const next = [entry, ...savedComps].slice(0, 50);
    setSavedComps(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }
  function loadSaved(id: string) {
    const c = savedComps.find(s => s.id === id);
    if (!c) return;
    setOwnPlacements(c.placements);
    setOppPlacements(c.oppPlacements || []);
    if ((c.oppPlacements || []).length > 0) setShowOpponent(true);
    setSelectedCell(null);
    setPickerChar(null);
  }
  function deleteSaved(id: string) {
    const next = savedComps.filter(s => s.id !== id);
    setSavedComps(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }
  async function copyShareLink() {
    if (typeof window === 'undefined') return;
    const enc = encodeState(ownPlacements, oppPlacements);
    const url = window.location.origin + window.location.pathname + (enc ? `?b=${enc}` : '');
    try {
      await navigator.clipboard.writeText(url);
      setShareToast(true);
      setTimeout(() => setShareToast(false), 1800);
    } catch { /* ignore */ }
  }

  const selectedPlacement = selectedCell != null ? byCell(selectedTeam).get(selectedCell) : undefined;

  // ----- Hex cell renderer -----
  function renderBoard(team: Team) {
    const isOwn = team === 'own';
    const byCellMap = byCell(team);
    return (
      <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[#a0b0c5] text-[10px] uppercase tracking-widest">
            {isOwn ? t('tft.builderOwn') : t('tft.builderOpponent')} · {placementsFor(team).length}/{MAX_UNITS}
          </div>
          {placementsFor(team).length > 0 && (
            <button
              onClick={() => clearBoard(team)}
              className="text-[#5a6a80] hover:text-[#e44040] text-[10px]"
            >
              {t('tft.builderClear')}
            </button>
          )}
        </div>
        {/* Hex math: 7 cells per row, odd rows shifted by half-cell to the
            RIGHT. To get the staggered silhouette on both sides (like the
            in-game board), each cell is sized as 1/7.5 of the container
            width — that way odd rows extend exactly half a cell past the
            right edge while even rows leave that same half-cell gap.
            Position absolutely on the container (NOT inside row-flex) so
            cell widths stay identical regardless of row offset. */}
        <div
          className="relative mx-auto"
          style={{
            maxWidth: '420px',
            width: '100%',
            aspectRatio: `${7.5} / ${ROWS * 1.1547}`,
          }}
        >
          {Array.from({ length: ROWS * COLS }).map((_, cellIdx) => {
            const rowIdx = Math.floor(cellIdx / COLS);
            const colIdx = cellIdx % COLS;
            const offset = rowIdx % 2 === 1 ? 0.5 : 0;
            const leftPct = ((colIdx + offset) / 7.5) * 100;
            // Flip vertically: data-row 3 (frontline) renders at the top of
            // the board — player POV matches in-game.
            const topPct = ((ROWS - 1 - rowIdx) / ROWS) * 100;
            const cell = cellIdx;
            const p = byCellMap.get(cell);
            const isSelected = selectedTeam === team && selectedCell === cell;
            const champ: any = p && assets?.champions[p.characterId];
            const url = champ ? tftChampionTileUrl(assets, champ) : null;
            const cost = champ?.cost ?? 1;
            const borderColor = isSelected
              ? '#a892ff'
              : p
                ? costColorOf(cost)
                : pickerChar
                  ? '#7B61FF55'
                  : '#1e2a3a';
            return (
              <div
                key={cell}
                className="absolute"
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  width: `${100 / 7.5}%`,
                  height: `${100 / ROWS}%`,
                  padding: '2px',
                }}
              >
                {/* outer border layer */}
                <div
                  className="absolute inset-0"
                  style={{
                    clipPath: HEX_CLIP,
                    backgroundColor: borderColor,
                    opacity: !p && !isSelected ? 0.6 : 1,
                  }}
                />
                {/* inner content */}
                <button
                  draggable={!!p}
                  onClick={() => onCellClick(team, cell)}
                  onContextMenu={e => onCellContextMenu(e, team, cell)}
                  onDragStart={p ? (e => onDragStartBoard(e, team, cell)) : undefined}
                  onDragOver={onDragOver}
                  onDrop={e => onDropCell(e, team, cell)}
                  className="absolute overflow-hidden transition-all duration-150 cursor-pointer"
                  style={{
                    top: '3px', left: '3px', right: '3px', bottom: '3px',
                    clipPath: HEX_CLIP,
                    backgroundColor: '#0a0e1a',
                  }}
                  title={p ? `${champ?.name || p.characterId}` : ''}
                >
                  {url && (
                    <img src={url} alt={champ?.name || ''} className="w-full h-full object-cover pointer-events-none" />
                  )}
                  {p && p.items.length > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 flex gap-0.5 justify-center pb-0.5 pointer-events-none">
                      {p.items.map((iid) => {
                        const item = assets?.items[iid];
                        const iurl = tftIconUrl(assets, item?.icon);
                        return (
                          <div key={iid} className="w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-sm overflow-hidden border border-black/70 bg-[#0a0e1a]">
                            {iurl && <img src={iurl} alt="" className="w-full h-full object-cover" />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <TftHero pageTitle={t('tft.builderTitle')} subtitle={t('tft.builderSubtitle')} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-2 pb-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
          {/* LEFT */}
          <div>
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="text-[#a0b0c5] text-xs uppercase tracking-widest">
                {t('tft.builderBoard')}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowOpponent(s => !s)}
                  className="px-3 py-1.5 rounded text-xs bg-[#141c2e] text-[#a0b0c5] hover:text-white border border-[#1e2a3a]"
                >
                  {showOpponent ? t('tft.builderHideOpponent') : t('tft.builderShowOpponent')}
                </button>
                <button
                  onClick={saveCurrent}
                  disabled={ownPlacements.length === 0 && oppPlacements.length === 0}
                  className="px-3 py-1.5 rounded text-xs bg-[#7B61FF] text-white hover:bg-[#9981FF] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {t('tft.builderSave')}
                </button>
                <button
                  onClick={copyShareLink}
                  disabled={ownPlacements.length === 0 && oppPlacements.length === 0}
                  className="px-3 py-1.5 rounded text-xs bg-[#141c2e] text-[#a0b0c5] hover:text-white border border-[#1e2a3a] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {shareToast ? t('tft.builderShareCopied') : t('tft.builderShare')}
                </button>
              </div>
            </div>

            {/* Opp board */}
            {showOpponent && (
              <div className="mb-3">
                {renderBoard('opp')}
              </div>
            )}
            {/* Own board */}
            {renderBoard('own')}

            {/* Champion palette */}
            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4 mt-4 mb-4">
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
                  value={champQuery}
                  onChange={e => setChampQuery(e.target.value)}
                  placeholder={t('tft.builderSearch')}
                  className="flex-1 min-w-[160px] bg-[#141c2e] border border-[#1e2a3a] rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[#7B61FF]/60"
                />
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(54px,1fr))] gap-1.5">
                {filteredChampions.map(c => {
                  const champ: any = assets?.champions[c.characterId];
                  const url = tftChampionTileUrl(assets, champ);
                  const onBoard = ownPlacements.some(p => p.characterId === c.characterId) || oppPlacements.some(p => p.characterId === c.characterId);
                  const isPicker = pickerChar === c.characterId;
                  return (
                    <button
                      key={c.characterId}
                      onClick={() => onChampionPick(c.characterId)}
                      draggable
                      onDragStart={(e) => onDragStartChampion(e, c.characterId)}
                      className="relative aspect-square rounded overflow-hidden transition-all"
                      style={{
                        border: `2px solid ${isPicker ? '#a892ff' : costColorOf(c.cost)}`,
                        boxShadow: isPicker ? '0 0 0 2px rgba(168,146,255,0.4)' : 'none',
                        opacity: onBoard && !isPicker ? 0.45 : 1,
                      }}
                      title={`${c.name} (${c.cost})`}
                    >
                      {url && <img src={url} alt={c.name} className="w-full h-full object-cover" />}
                      <span className="absolute bottom-0 left-0 right-0 text-[9px] text-center text-white bg-black/60 truncate px-0.5">
                        {c.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Items palette */}
            <div
              className="bg-[#0d1526] border rounded-lg p-4"
              style={{ borderColor: selectedPlacement ? '#a892ff66' : '#1e2a3a' }}
            >
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-1 flex-wrap">
                  {(['completed', 'components', 'radiant', 'artifacts', 'emblems', 'all'] as ItemTab[]).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setItemTab(tab)}
                      className={`px-2.5 py-1 rounded text-xs ${itemTab === tab ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#a0b0c5] hover:text-white'}`}
                    >
                      {t('tft.builderItems' + tab.charAt(0).toUpperCase() + tab.slice(1) as any) || tab}
                    </button>
                  ))}
                </div>
                <input
                  type="search"
                  value={itemQuery}
                  onChange={e => setItemQuery(e.target.value)}
                  placeholder={t('tft.builderItemsSearch')}
                  className="flex-1 min-w-[160px] bg-[#141c2e] border border-[#1e2a3a] rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[#7B61FF]/60"
                />
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(38px,1fr))] gap-1.5 max-h-[260px] overflow-y-auto pr-1">
                {filteredItems.map(item => {
                  const url = tftIconUrl(assets, item.icon);
                  const onSelectedUnit = selectedPlacement?.items.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      onClick={() => addItemToSelected(item.id)}
                      disabled={!selectedPlacement || (selectedPlacement.items.length >= MAX_ITEMS_PER_UNIT && !onSelectedUnit)}
                      className="aspect-square rounded overflow-hidden border border-[#1e2a3a] hover:border-[#a892ff] transition disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{ boxShadow: onSelectedUnit ? '0 0 0 2px #a892ff inset' : 'none' }}
                      title={item.name}
                    >
                      {url && <img src={url} alt={item.name} className="w-full h-full object-cover" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
            {selectedPlacement && (
              <div className="bg-[#0d1526] border border-[#a892ff]/40 rounded-lg p-4">
                <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-2">
                  {t('tft.builderUnitItems')}
                  <span className="ml-1 text-[#5a6a80] normal-case tracking-normal">
                    ({selectedTeam === 'own' ? t('tft.builderOwn') : t('tft.builderOpponent')})
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  {(() => {
                    const champ: any = assets?.champions[selectedPlacement.characterId];
                    const url = tftChampionTileUrl(assets, champ);
                    return (
                      <>
                        {url && <img src={url} alt={champ?.name || ''} className="w-10 h-10 rounded object-cover" style={{ border: `2px solid ${costColorOf(champ?.cost ?? 1)}` }} />}
                        <div className="text-white text-sm font-medium">{champ?.name || selectedPlacement.characterId}</div>
                      </>
                    );
                  })()}
                </div>
                <div className="flex gap-1.5">
                  {Array.from({ length: MAX_ITEMS_PER_UNIT }).map((_, slotIdx) => {
                    const iid = selectedPlacement.items[slotIdx];
                    const item = iid ? assets?.items[iid] : null;
                    const url = tftIconUrl(assets, item?.icon);
                    return (
                      <button
                        key={slotIdx}
                        onClick={() => iid && removeItemFromSelected(iid)}
                        className="flex-1 aspect-square rounded border border-[#1e2a3a] overflow-hidden bg-[#0a0e1a] hover:border-[#e44040]/60 transition"
                        title={item?.name || ''}
                      >
                        {url && <img src={url} alt={item?.name || ''} className="w-full h-full object-cover" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4">
              <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">
                {t('tft.builderTraits')}
              </div>
              {ownPlacements.length === 0 ? (
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
                        <div className="tabular-nums text-sm" style={{ color: tier ? styleColor : '#7a8aa0' }}>
                          {tr.count}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {savedComps.length > 0 && (
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4">
                <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">
                  {t('tft.builderMyComps')}
                </div>
                <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
                  {savedComps.map(c => (
                    <div key={c.id} className="flex items-center gap-2 p-1.5 rounded bg-[#0a0e1a]">
                      <button
                        onClick={() => loadSaved(c.id)}
                        className="flex-1 text-left text-white text-xs hover:text-[#a892ff] truncate"
                        title={c.name}
                      >
                        {c.name}
                        <span className="text-[#5a6a80] ml-1.5">({c.placements.length + (c.oppPlacements?.length || 0)})</span>
                      </button>
                      <button
                        onClick={() => deleteSaved(c.id)}
                        className="text-[#5a6a80] hover:text-[#e44040] text-xs px-1"
                        title={t('tft.builderDelete')}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
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
