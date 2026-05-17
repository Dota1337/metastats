'use client';
import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftChampionTileUrl, tftIconUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';

// Visual comp-builder. TFT-standard 4×7 hex board:
//   Row 0 (back)  cells 0..6
//   Row 1         cells 7..13   (shifted right by half-cell)
//   Row 2         cells 14..20
//   Row 3 (front) cells 21..27  (shifted right)
//
// Interaction model — pure click, with optional HTML5 drag-and-drop on
// top:
//   • Click champion in palette → "picker" mode (cid selected)
//   • Click empty cell with picker active → place there + clear picker
//   • Click occupied cell with picker active → swap unit
//   • Click placed unit (no picker) → select cell, open item-picker
//   • Right-click placed unit → remove
//   • Click item in palette while a unit is selected → add (max 3)
//   • Click item-chip on selected unit → remove that item
//
// Persistence:
//   • URL ?b=<base64-json> always reflects current state — instant share
//   • "Save" stores into localStorage tft.savedComps[]
//   • "My comps" sidebar loads or deletes saved builds

const ROWS = 4;
const COLS = 7;
const MAX_UNITS = 10;
const MAX_ITEMS_PER_UNIT = 3;
const STORAGE_KEY = 'tft.savedComps';

interface Placement {
  cell: number;          // 0..27
  characterId: string;
  items: string[];       // up to 3 item apiNames
}

interface SavedComp {
  id: string;
  name: string;
  placements: Placement[];
  createdAt: number;
}

type ItemTab = 'completed' | 'components' | 'radiant' | 'artifacts' | 'emblems' | 'all';

interface ItemEntry {
  id: string;
  name: string;
  icon: string | null;
  category: ItemTab[];
}

function encodeState(placements: Placement[]): string {
  if (placements.length === 0) return '';
  try {
    const compact = placements.map(p => ({ c: p.cell, i: p.characterId, t: p.items }));
    return btoa(JSON.stringify(compact));
  } catch { return ''; }
}

function decodeState(s: string): Placement[] {
  if (!s) return [];
  try {
    const json = JSON.parse(atob(s));
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
  } catch { return []; }
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
  const [placements, setPlacements] = useState<Placement[]>(() => decodeState(search.get('b') || ''));
  const [pickerChar, setPickerChar] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [costFilter, setCostFilter] = useState<number | null>(null);
  const [champQuery, setChampQuery] = useState('');
  const [itemTab, setItemTab] = useState<ItemTab>('completed');
  const [itemQuery, setItemQuery] = useState('');
  const [savedComps, setSavedComps] = useState<SavedComp[]>([]);
  const [shareToast, setShareToast] = useState(false);
  const dragRef = useRef<{ from: 'palette' | 'board'; payload: string | number } | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  // Load saved comps from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setSavedComps(arr);
      }
    } catch { /* ignore */ }
  }, []);

  // Persist URL on every state change
  useEffect(() => {
    const encoded = encodeState(placements);
    const target = encoded ? `${pathname}?b=${encoded}` : pathname;
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== target) {
      router.replace(target, { scroll: false });
    }
  }, [placements, pathname, router]);

  // Build champion list (cost 1-5)
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

  // Build item list with category tagging
  const items = useMemo<ItemEntry[]>(() => {
    if (!assets) return [];
    const out: ItemEntry[] = [];
    for (const [id, item] of Object.entries(assets.items)) {
      if (/Augment/i.test(id)) continue;
      if (!/^TFT(_|17_|Set\d+_)?Item/i.test(id)) continue;
      // Junk filters
      if (/Grant|Anvil|Orbs|Loot|Debug|Tutorial|Tactician|TheStar/i.test(id)) continue;
      if (!item.name) continue;
      const hasComp = !!(item.composition && item.composition.length === 2);
      const cats = categorizeItem(id, item.name);
      // Only flag as "completed" / "components" if it has the right shape
      if (hasComp && !cats.includes('emblems') && !cats.includes('artifacts') && !cats.includes('radiant')) {
        cats.push('completed');
      }
      // Components heuristic: known basic-item ids
      if (/^TFT_Item_(BFSword|Bow|RodOfAges|RodOfTheJax|Tear|ChainVest|Cloak|GiantsBelt|SparringGloves|Spatula)/i.test(id)) {
        cats.push('components');
      }
      // Set17 special with no composition + not categorised elsewhere → bucket into "components" as fallback so they show somewhere
      if (cats.length === 1 /* only 'all' */) {
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

  // Trait calculation (same as before)
  const activeTraits = useMemo(() => {
    if (!assets) return [] as { apiName: string; name: string; count: number; tiers: any[]; activeIdx: number | null; icon?: string | null }[];
    const counts = new Map<string, number>();
    const seen = new Set<string>();
    for (const p of placements) {
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
  }, [placements, assets]);

  // ----- Mutations -----
  const placementByCell = useMemo(() => {
    const m = new Map<number, Placement>();
    for (const p of placements) m.set(p.cell, p);
    return m;
  }, [placements]);

  const placeAt = useCallback((cell: number, cid: string) => {
    setPlacements(prev => {
      const existing = prev.find(p => p.cell === cell);
      // Same unit already there? noop.
      if (existing && existing.characterId === cid) return prev;
      // Unit already on the board at a different cell? move it instead of cloning.
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

  const removeAt = useCallback((cell: number) => {
    setPlacements(prev => prev.filter(p => p.cell !== cell));
    if (selectedCell === cell) setSelectedCell(null);
  }, [selectedCell]);

  const swapCells = useCallback((from: number, to: number) => {
    setPlacements(prev => {
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
    setPlacements(prev => prev.map(p => {
      if (p.cell !== selectedCell) return p;
      if (p.items.length >= MAX_ITEMS_PER_UNIT) return p;
      if (p.items.includes(itemId)) return p;
      return { ...p, items: [...p.items, itemId] };
    }));
  }, [selectedCell]);

  const removeItemFromSelected = useCallback((itemId: string) => {
    if (selectedCell == null) return;
    setPlacements(prev => prev.map(p => p.cell === selectedCell
      ? { ...p, items: p.items.filter(i => i !== itemId) }
      : p,
    ));
  }, [selectedCell]);

  function onCellClick(cell: number) {
    const occupied = placementByCell.get(cell);
    if (pickerChar) {
      placeAt(cell, pickerChar);
      setPickerChar(null);
      setSelectedCell(cell);
      return;
    }
    if (occupied) {
      setSelectedCell(prev => prev === cell ? null : cell);
    } else if (selectedCell != null) {
      // Move selected unit to empty cell
      swapCells(selectedCell, cell);
      setSelectedCell(cell);
    }
  }

  function onCellContextMenu(e: React.MouseEvent, cell: number) {
    e.preventDefault();
    removeAt(cell);
  }

  function onChampionPick(cid: string) {
    if (placements.some(p => p.characterId === cid)) {
      // Already on board — remove it.
      setPlacements(prev => prev.filter(p => p.characterId !== cid));
      return;
    }
    setPickerChar(prev => prev === cid ? null : cid);
  }

  function clearBoard() {
    setPlacements([]);
    setSelectedCell(null);
    setPickerChar(null);
  }

  // Drag & Drop
  function onDragStartChampion(e: React.DragEvent, cid: string) {
    dragRef.current = { from: 'palette', payload: cid };
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', cid);
  }
  function onDragStartBoard(e: React.DragEvent, cell: number) {
    dragRef.current = { from: 'board', payload: cell };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(cell));
  }
  function onDropCell(e: React.DragEvent, cell: number) {
    e.preventDefault();
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.from === 'palette') {
      placeAt(cell, String(drag.payload));
    } else if (drag.from === 'board') {
      const from = Number(drag.payload);
      if (from !== cell) swapCells(from, cell);
    }
    dragRef.current = null;
  }
  function onDragOver(e: React.DragEvent) { e.preventDefault(); }

  // Save / Load / Delete
  function saveCurrent() {
    const name = (typeof window !== 'undefined' && window.prompt(t('tft.builderSaveName'), '')) || '';
    if (!name.trim()) return;
    const entry: SavedComp = {
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      name: name.trim().slice(0, 60),
      placements,
      createdAt: Date.now(),
    };
    const next = [entry, ...savedComps].slice(0, 50);
    setSavedComps(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }
  function loadSaved(id: string) {
    const c = savedComps.find(s => s.id === id);
    if (!c) return;
    setPlacements(c.placements);
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
    const url = window.location.origin + window.location.pathname + (placements.length > 0 ? `?b=${encodeState(placements)}` : '');
    try {
      await navigator.clipboard.writeText(url);
      setShareToast(true);
      setTimeout(() => setShareToast(false), 1800);
    } catch { /* ignore */ }
  }

  // ----- Render helpers -----
  const selectedPlacement = selectedCell != null ? placementByCell.get(selectedCell) : undefined;

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <TftHero pageTitle={t('tft.builderTitle')} subtitle={t('tft.builderSubtitle')} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-2 pb-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
          {/* LEFT column: board + palette + items */}
          <div>
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="text-[#a0b0c5] text-xs uppercase tracking-widest">
                {t('tft.builderBoard')} · {placements.length}/{MAX_UNITS}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={saveCurrent}
                  disabled={placements.length === 0}
                  className="px-3 py-1.5 rounded text-xs bg-[#7B61FF] text-white hover:bg-[#9981FF] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {t('tft.builderSave')}
                </button>
                <button
                  onClick={copyShareLink}
                  disabled={placements.length === 0}
                  className="px-3 py-1.5 rounded text-xs bg-[#141c2e] text-[#a0b0c5] hover:text-white border border-[#1e2a3a] disabled:opacity-30 disabled:cursor-not-allowed relative"
                >
                  {shareToast ? t('tft.builderShareCopied') : t('tft.builderShare')}
                </button>
                {placements.length > 0 && (
                  <button
                    onClick={clearBoard}
                    className="px-3 py-1.5 rounded text-xs text-[#7a8aa0] hover:text-[#e44040] border border-transparent hover:border-[#e44040]/40"
                  >
                    {t('tft.builderClear')}
                  </button>
                )}
              </div>
            </div>

            {/* Hex board */}
            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4 mb-4">
              <div className="flex flex-col gap-1.5">
                {Array.from({ length: ROWS }).map((_, rowIdx) => (
                  <div
                    key={rowIdx}
                    className="flex gap-1.5 justify-center"
                    style={{ paddingLeft: rowIdx % 2 === 1 ? 'calc((100% / 7) / 2)' : '0' }}
                  >
                    {Array.from({ length: COLS }).map((__, colIdx) => {
                      const cell = rowIdx * COLS + colIdx;
                      const p = placementByCell.get(cell);
                      const isSelected = selectedCell === cell;
                      const champ: any = p && assets?.champions[p.characterId];
                      const url = champ ? tftChampionTileUrl(assets, champ) : null;
                      const cost = champ?.cost ?? 1;
                      return (
                        <button
                          key={cell}
                          draggable={!!p}
                          onClick={() => onCellClick(cell)}
                          onContextMenu={e => onCellContextMenu(e, cell)}
                          onDragStart={p ? (e => onDragStartBoard(e, cell)) : undefined}
                          onDragOver={onDragOver}
                          onDrop={e => onDropCell(e, cell)}
                          className="relative flex-1 aspect-square rounded-md overflow-hidden transition-all duration-150"
                          style={{
                            maxWidth: 'calc((100% - 9px) / 7)',
                            border: p
                              ? `2px solid ${isSelected ? '#a892ff' : costColorOf(cost)}`
                              : '1px dashed #233048',
                            backgroundColor: p ? '#0a0e1a' : pickerChar ? 'rgba(123,97,255,0.08)' : '#0a0e1a',
                            boxShadow: isSelected ? '0 0 0 2px rgba(168,146,255,0.35)' : 'none',
                          }}
                          title={p ? `${champ?.name || p.characterId}` : `Cell ${cell}`}
                        >
                          {url && (
                            <img src={url} alt={champ?.name || ''} className="w-full h-full object-cover pointer-events-none" />
                          )}
                          {p && p.items.length > 0 && (
                            <div className="absolute bottom-0.5 left-0.5 right-0.5 flex gap-0.5 pointer-events-none">
                              {p.items.map((iid) => {
                                const item = assets?.items[iid];
                                const iurl = tftIconUrl(assets, item?.icon);
                                return (
                                  <div key={iid} className="w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-sm overflow-hidden border border-black/60 bg-[#0a0e1a]">
                                    {iurl && <img src={iurl} alt="" className="w-full h-full object-cover" />}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Champion palette */}
            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4 mb-4">
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
              <div className="grid grid-cols-[repeat(auto-fill,minmax(60px,1fr))] gap-1.5">
                {filteredChampions.map(c => {
                  const champ: any = assets?.champions[c.characterId];
                  const url = tftChampionTileUrl(assets, champ);
                  const onBoard = placements.some(p => p.characterId === c.characterId);
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

            {/* Items palette — only useful when a unit is selected */}
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
              <div className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1.5 max-h-[280px] overflow-y-auto pr-1">
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

          {/* RIGHT column: selected unit info + active traits + saved comps */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
            {/* Selected unit panel */}
            {selectedPlacement && (
              <div className="bg-[#0d1526] border border-[#a892ff]/40 rounded-lg p-4">
                <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-2">
                  {t('tft.builderUnitItems')}
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

            {/* Active traits */}
            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4">
              <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">
                {t('tft.builderTraits')}
              </div>
              {placements.length === 0 ? (
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

            {/* My comps */}
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
                        <span className="text-[#5a6a80] ml-1.5">({c.placements.length})</span>
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
