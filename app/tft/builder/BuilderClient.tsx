'use client';
import { useEffect, useLayoutEffect, useMemo, useState, useRef, useCallback } from 'react';
import { TRAIT_STYLE_COLOR } from '../../lib/tft-trait-style';
import { withAlpha } from '../../lib/color';
import { CURRENT_SET } from '../../lib/current-set';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftChampionTileUrl, tftIconUrl, tftPlayableChampions, tftTraitIdPrefix, formatTftDesc, type TftAssetsBundle } from '../../lib/tft-cdragon';
import { buildPlanAheadCode } from '../../lib/tft-plan-ahead-code';
import { HEX_CLIP, costColor, starColor as starColorOf } from '../../lib/tft-ui';
import { isElderwoodPlant, plantAllowance, plantName, plantRules, plantStar, trimPlants, type PlantRules } from '../../lib/tft-elderwood-plants';
import { loadItemTexts, itemTextFor, type ItemTexts, type ItemTextView } from '../../lib/tft-item-texts';
import { MAX_ITEMS_PER_UNIT, RETIRED_ITEM_IDS, boardTraitCounts, emblemTraitOf, itemBlock, itemTeamSize, slotsUsed, teamLimit, teamSlotsUsed } from '../../lib/tft-builder-items';
import type { StarLevel } from '../../lib/tft-public-comps';
import ItemStatLine from '../../components/tft/ItemStatLine';

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
// Brettgrenze: teamLimit (tft-builder-items.ts) — 10 plus Tactician-Items und
// Riftbeast 10; belegt werden Plaetze (teamSlotsUsed, Elder Dragon 2).
const STORAGE_KEY = 'tft.savedComps';

// Miss Fortune (Set 17) has a "Choose Trait" placeholder that resolves to
// Challenger / Replicator / Conduit depending on the chosen Stance. The three
// "Stance" items live in the asset bundle but are never picked from the items
// palette — they're selected via the inline picker in the unit detail panel.
// Set-gebunden: den "Choose Trait"-Platzhalter gab es nur in Set 17. Ab Set 18
// existiert die Unit nicht mehr im Bundle — ohne dieses Gate blieben die
// Set-17-IDs als toter Vergleichswert im Set-18-Builder stehen.
const MF_CHAR_ID: string | null = CURRENT_SET === 17 ? 'TFT17_MissFortune' : null;
const MF_CHOOSE_TRAIT = 'Choose Trait';
const MF_STANCE_ITEMS: Record<MfStance, string> = {
  AS: 'TFT17_Item_MissFortuneUniqueASTraitStance',
  Flex: 'TFT17_Item_MissFortuneUniqueFlexTraitStance',
  Mana: 'TFT17_Item_MissFortuneUniqueManaTraitStance',
};
const MF_STANCE_TRAITS: Record<MfStance, string> = {
  AS: 'Challenger',
  Flex: 'Replicator',
  Mana: 'Conduit',
};
const STANCE_ITEM_IDS = new Set(Object.values(MF_STANCE_ITEMS));


type Team = 'own' | 'opp';
type MfStance = 'AS' | 'Flex' | 'Mana';
// 1-star is implicit (undefined) so we don't bloat URLs / saved comps with the
// default. 4-star exists in Set 17 via Sona's command mods and Aurelion Sol
// quest rewards — kept as an explicit option even though it's rare.
// StarLevel (2 | 3 | 4) kommt aus tft-public-comps.ts, die Galerie nutzt ihn mit.

interface Placement {
  cell: number;
  characterId: string;
  items: string[];
  stance?: MfStance;
  star?: StarLevel;
}

// MF "Choose Trait" zaehlt ueber die gewaehlte Haltung, ohne Haltung fuer
// keine Synergie.
function resolveMfTrait(p: Placement, rawTrait: string): string | null {
  if (p.characterId !== MF_CHAR_ID || rawTrait !== MF_CHOOSE_TRAIT) return rawTrait;
  return p.stance ? MF_STANCE_TRAITS[p.stance] : null;
}

// Elderwood-Pflanzen (tft-elderwood-plants.ts): Zahl und Stern folgen der
// Elderwood-Stufe des Bretts; Pflanzen selbst tragen keine Synergie.
function elderwoodOnBoard(bundle: TftAssetsBundle | null, rules: PlantRules, ps: Placement[]): number {
  return boardTraitCounts(bundle, ps, resolveMfTrait).get(rules.traitName) || 0;
}

// Sinkt die Stufe, fallen ueberzaehlige Pflanzen weg (wie im Spiel). Ohne
// Bundle bleibt alles stehen; dasselbe Array, wenn nichts wegfaellt.
function trimBoard(bundle: TftAssetsBundle | null, ps: Placement[]): Placement[] {
  const rules = plantRules(bundle);
  return rules ? trimPlants(ps, rules, elderwoodOnBoard(bundle, rules, ps)) : ps;
}

interface SavedComp {
  id: string;
  name: string;
  placements: Placement[];
  oppPlacements: Placement[];
  createdAt: number;
}

type ItemTab = 'completed' | 'radiant' | 'artifacts' | 'emblems';
const ITEM_TABS: ItemTab[] = ['completed', 'radiant', 'artifacts', 'emblems'];

// Ablegen mit Toleranz: Zielfeld ist der naechste Hex-Mittelpunkt, gemessen in
// Zellbreiten. Units/Felder bis 0,75 (ein Hex reicht bis 0,58 vom Mittelpunkt,
// damit zaehlen Luecken, Ecken und ein schmaler Rand ums Brett). Items gehen
// auf die naechste BESETZTE Zelle bis 0,8 — wer mitten auf ein leeres Nachbar-
// feld (Abstand 1,0) zielt, meint nicht die Unit daneben.
// Champion-Leiste: die ersten Kacheln sofort, der Rest erst beim Scrollen.
const TILES_EAGER = 24;

const SNAP_CELL = 0.75;
const SNAP_ITEM = 0.8;

interface ItemEntry {
  id: string;
  name: string;
  icon: string | null;
  category: ItemTab;
}

function encodeState(own: Placement[], opp: Placement[]): string {
  if (own.length === 0 && opp.length === 0) return '';
  try {
    const pack = (p: Placement) => {
      const o: any = { c: p.cell, i: p.characterId, t: p.items };
      if (p.stance) o.s = p.stance;
      if (p.star && p.star > 1) o.l = p.star;
      return o;
    };
    const compact: any = { p: own.map(pack) };
    if (opp.length > 0) compact.o = opp.map(pack);
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
      const stance: MfStance | undefined = (e.s === 'AS' || e.s === 'Flex' || e.s === 'Mana') ? e.s : undefined;
      const star: StarLevel | undefined = (e.l === 2 || e.l === 3 || e.l === 4) ? e.l : undefined;
      if (!Number.isFinite(cell) || cell < 0 || cell >= ROWS * COLS) return null;
      if (!cid) return null;
      const out: Placement = { cell, characterId: cid, items };
      if (stance) out.stance = stance;
      if (star) out.star = star;
      return out;
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

// Sorts each whitelisted id into a builder tab. The whitelist itself comes
// from `assets.active.items` (curated server-side in fetch-tft-assets.mjs
// against the DB snapshots), so we only need pattern matching here — no
// hand-maintained deny-lists for retired items.
// Die Set-17-Reiter Psyonic/Anima sind seit Set 18 leer und entfallen.
// `emblemTrait`: Synergie, die das Emblem gibt (tft-builder-items.ts). Ein
// "Emblem" ohne Synergie im Bundle (Phantom Emblem, Set-18-Mechanik) ist
// nicht ausruestbar.
// `teamSizeItem`: Tactician's Crown/Cape/Shield — stehen am Ende des
// Embleme-Reiters, weil sie wie die Embleme aus dem Spatel gebaut werden
// (so auch tactics.tools: direkt hinter den Emblemen).
function categorizeItem(id: string, name: string, hasComp: boolean, emblemTrait: string | null, teamSizeItem: boolean): ItemTab | null {
  if (STANCE_ITEM_IDS.has(id)) return null;
  if (teamSizeItem) return 'emblems';
  if (/Emblem/i.test(id) || /Emblem/i.test(name)) return emblemTrait ? 'emblems' : null;
  // `_Artifact_` mit Unterstrichen wie itemBucketOf (tft-item-bucket.ts):
  // ohne sie faengt das Muster DA_Artifactinate18 — ein Verbrauchsgegenstand
  // ("Lose 3 components … Gain an Artifact anvil"), kein Artefakt.
  if (/_Artifact_/i.test(id)) return 'artifacts';
  // Set-agnostisch am Suffix statt am Namensanfang: Set 18 legt seine
  // Radiant-Gegenstaende als `DA_BloodthirsterRadiant` bzw.
  // `DA_AdaptiveHelm_Radiant` ab, der alte Filter auf `TFT5_Item_` liess sie
  // komplett aus der Palette fallen (gemessen 2026-09-08: 39 von 77 aktiven
  // Radiants).
  if (/Radiant$/i.test(id)) return 'radiant';
  // Cross-set artifact-style items (Ornn artifact augments, Shimmerscale loot,
  // Crown of Demacia) — already filtered to "currently rotated" by active.items.
  if (/^TFT[479]_Item_(Ornn|Shimmerscale|CrownOfDemacia)/i.test(id)) return 'artifacts';
  // Fertige Gegenstaende ueber die Form (zwei Bauteile), nicht ueber den
  // Namensanfang: Set 18 heisst `DA_Deathblade` statt `TFT_Item_Deathblade`,
  // damit rutschten 36 fertige Gegenstaende komplett aus der Palette.
  if (hasComp && !/Corrupted/i.test(id)) {
    if (/_Item_(BFSword|Bow|RodOfAges|RodOfTheJax|Tear|ChainVest|Cloak|GiantsBelt|SparringGloves|Spatula)$/i.test(id)) return null;
    if (/_Component_/i.test(id)) return null;
    return 'completed';
  }
  return null;
}

export default function BuilderClient({ initialAssets }: {
  /** Champion-Pool vom Server (seo/page-start-tft.ts): spielbare Champions + Traits, ohne Items. */
  initialAssets: TftAssetsBundle | null;
}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  // Bis das volle Bundle da ist, zeichnet der Ausschnitt vom Server die
  // Champion-Leiste. assetsRef bleibt bis dahin leer: trimBoard soll Pflanzen
  // nur mit dem vollen Bundle (inkl. Embleme) kuerzen, wie bisher.
  const [assets, setAssets] = useState<TftAssetsBundle | null>(initialAssets);
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
  const [publishState, setPublishState] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');
  const [planAheadState, setPlanAheadState] = useState<'idle' | 'ok' | 'err'>('idle');
  const dragRef = useRef<{ from: 'palette' | 'board' | 'item'; payload: string | number; fromTeam?: Team } | null>(null);
  const boardRefs = useRef<Record<Team, HTMLDivElement | null>>({ own: null, opp: null });
  const [dropTarget, setDropTarget] = useState<{ team: Team; cell: number } | null>(null);
  const [itemTexts, setItemTexts] = useState<ItemTexts | null>(null);
  // Item-Infokarte: Element-Rechteck des Items, ueber dem sie steht.
  const [infoItem, setInfoItem] = useState<{ id: string; rect: DOMRect; touch: boolean } | null>(null);
  const lastPointerRef = useRef<string>('mouse');

  // assetsRef: Brett-Aenderungen laufen in Updatern mit festen Abhaengigkeiten
  // und brauchen fuer trimBoard das aktuelle Bundle.
  const assetsRef = useRef<TftAssetsBundle | null>(null);
  // Ein Link kann vor dem Bundle geladen sein: Pflanzen mit dem Bundle nachziehen.
  useEffect(() => {
    loadTftAssets().then(a => {
      assetsRef.current = a;
      setAssets(a);
      setOwnPlacements(ps => trimBoard(a, ps));
      setOppPlacements(ps => trimBoard(a, ps));
    });
  }, []);
  useEffect(() => { loadItemTexts().then(setItemTexts); }, []);

  // Ziel-Hervorhebung endet mit jedem Ziehen, auch wenn ausserhalb losgelassen.
  useEffect(() => {
    const clear = () => { setDropTarget(null); dragRef.current = null; };
    document.addEventListener('dragend', clear);
    return () => document.removeEventListener('dragend', clear);
  }, []);

  // Infokarte: verschwindet beim Scrollen (sie steht fest am Bildschirm);
  // nach Antippen zusaetzlich nach 4 s oder beim naechsten Tippen woanders.
  useEffect(() => {
    if (!infoItem) return;
    const hide = () => setInfoItem(null);
    window.addEventListener('scroll', hide, { passive: true, capture: true });
    const timer = infoItem.touch ? setTimeout(hide, 4000) : null;
    if (infoItem.touch) document.addEventListener('pointerdown', hide);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('scroll', hide, { capture: true } as EventListenerOptions);
      document.removeEventListener('pointerdown', hide);
    };
  }, [infoItem]);

  // Maus: Karte beim Drueberfahren. Tastatur: beim Fokus. Finger: nach dem
  // Antippen (showInfoAfterTap), weil es dort kein Drueberfahren gibt.
  function infoHandlers(id: string) {
    return {
      onPointerDown: (e: React.PointerEvent) => { lastPointerRef.current = e.pointerType; },
      onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
        if (e.pointerType === 'mouse') setInfoItem({ id, rect: e.currentTarget.getBoundingClientRect(), touch: false });
      },
      onPointerLeave: (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse') setInfoItem(prev => (prev && prev.id === id && !prev.touch ? null : prev));
      },
      onFocus: (e: React.FocusEvent<HTMLElement>) => {
        if (lastPointerRef.current === 'mouse' && e.currentTarget.matches(':focus-visible')) {
          setInfoItem({ id, rect: e.currentTarget.getBoundingClientRect(), touch: false });
        }
      },
      onBlur: () => setInfoItem(prev => (prev && prev.id === id && !prev.touch ? null : prev)),
    };
  }
  function showInfoAfterTap(e: React.MouseEvent<HTMLElement>, id: string) {
    if (lastPointerRef.current === 'mouse') return;
    setInfoItem({ id, rect: e.currentTarget.getBoundingClientRect(), touch: true });
  }
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
    // Nur spielbare Einheiten des aktuellen Sets. Erkannt an der Form (Kosten
    // 1-5 + mindestens ein Merkmal), nicht am Namensanfang: Set 18 heisst
    // `DA_Amumu18`, ein Filter auf `TFT18_` liess den Picker leer.
    return tftPlayableChampions(assets)
      .map(({ id, champion }) => ({ characterId: id, name: champion.name, cost: champion.cost ?? 1 }));
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
    // Game-mechanic noise that lives in `assets.items` but isn't equippable
    // gear: Chosen tracking markers, augment "offerings", Graves trait
    // modules, consumables, Sona command mods, Favored cause/effect markers,
    // armory/cypher items. These leak into Riot's setData[N].items pool but
    // the player never carries them on a unit.
    const noiseRe = /^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?(MarketOffering_|GravesTrait_|ChampionItem|Consumable_|Favored|SonaUnique_|.*Selector|EkkoOffering_|CypherArmoryItem_)/i;
    const out: ItemEntry[] = [];
    const visit = (id: string, item: any) => {
      if (RETIRED_ITEM_IDS.has(id)) return;
      if (/Augment/i.test(id)) return;
      if (noiseRe.test(id)) return;
      // Tactician's Crown/Cape/Shield bleiben drin (+1 Brettplatz, teamLimit).
      if (/Grant|Anvil|Orbs|Loot|Debug|Tutorial|TheStar/i.test(id)) return;
      if (!item?.name) return;
      // Locale resolution failure = item is disabled in-game (Riot pulls the
      // localised string when an item leaves rotation). Belt-and-suspenders —
      // active.items should already exclude these.
      if (item.name.startsWith('tft_item_name_')) return;
      const hasComp = !!(item.composition && item.composition.length === 2);
      const cat = categorizeItem(id, item.name, hasComp, emblemTraitOf(assets, id), itemTeamSize(itemTexts, id) > 0);
      if (!cat) return;
      out.push({ id, name: item.name, icon: item.icon, category: cat });
    };
    const activeIds = assets.active?.items;
    if (activeIds && activeIds.length > 0) {
      // Crawler-curated whitelist (Riot's setData[N].items ∩ DB-snapshot for
      // universals + optimistic for set-specific / Set-5 legacy radiants).
      // See fetch-tft-assets.mjs#collectPlayedIds.
      for (const id of activeIds) {
        const item = assets.items[id];
        if (item) visit(id, item);
      }
    } else {
      // Fallback for asset bundles fetched before active.items shipped —
      // older deploys keep rendering until the next crawler run.
      const setPrefixRe = new RegExp(
        `^TFT_Item_|^TFT${assets.set}_(Item_|AnimaSquadItem_)|^TFT5_Item_.+Radiant$`,
        'i',
      );
      for (const [id, item] of Object.entries(assets.items)) {
        if (setPrefixRe.test(id)) visit(id, item);
      }
    }
    // Doppelte Anzeigenamen zusammenfuehren: Set 18 fuehrt jeden Radiant
    // zweimal, einmal in neuer Schreibweise (`DA_BloodthirsterRadiant`) und
    // einmal als Altlast aus Set 5 (`TFT5_Item_BloodthirsterRadiant`) — beide
    // mit demselben Namen und demselben Bild. Sichtbar bleibt der Eintrag des
    // aktuellen Sets. Set 17 hat keine solchen Paare, dort greift das nie.
    const prefix = tftTraitIdPrefix(assets);
    const byName = new Map<string, ItemEntry>();
    for (const entry of out) {
      const key = entry.category + '|' + entry.name;
      const kept = byName.get(key);
      if (!kept) { byName.set(key, entry); continue; }
      if (prefix && !kept.id.startsWith(prefix) && entry.id.startsWith(prefix)) byName.set(key, entry);
    }
    // Tactician-Items hinter die Embleme, sonst nach Name.
    const tail = (e: ItemEntry) => (itemTeamSize(itemTexts, e.id) > 0 ? 1 : 0);
    return [...byName.values()].sort((a, b) => tail(a) - tail(b) || a.name.localeCompare(b.name));
  }, [assets, itemTexts]);

  const filteredItems = useMemo(() => {
    return items.filter(i => {
      if (i.category !== itemTab) return false;
      if (itemQuery && !i.name.toLowerCase().includes(itemQuery.toLowerCase())) return false;
      return true;
    });
  }, [items, itemTab, itemQuery]);

  // Traits are computed from own + opp boards combined? No — only the
  // own board's traits matter for the user's actual comp. Opp board is
  // a scenario sketch and irrelevant for own-trait activation.
  const activeTraits = useMemo(() => {
    if (!assets) return [] as { apiName: string; name: string; count: number; tiers: any[]; activeIdx: number | null; icon?: string | null }[];
    // Zaehlung wie im Spiel (Embleme, je Champion einmal, Elder Dragon fuer
    // Riftbeast als 2): boardTraitCounts in tft-builder-items.ts.
    const counts = boardTraitCounts(assets, ownPlacements, resolveMfTrait);
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
    // Jede Brett-Aenderung kann die Elderwood-Stufe senken.
    const trimmed = (prev: Placement[]) => trimBoard(assetsRef.current, updater(prev));
    if (team === 'own') setOwnPlacements(trimmed);
    else setOppPlacements(trimmed);
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

  // Belegte Plaetze ueber der Grenze des Bretts; <= 0 = passt.
  const overLimit = useCallback((ps: Placement[]) =>
    teamSlotsUsed(assets, ps) - teamLimit(itemTexts, ps, assets, resolveMfTrait), [assets, itemTexts]);

  // Pflanze setzen: eine neue Kopie, solange die Stufe noch eine erlaubt, sonst
  // wandert die zuerst gesetzte (wie eine Unit, die schon steht). Bleibt sie
  // nach dem Nachziehen nicht stehen (Elderwood nicht aktiv, oder das ersetzte
  // Feld war eine Elderwood-Unit), passiert nichts.
  const placePlant = useCallback((prev: Placement[], cell: number, cid: string): Placement[] => {
    const bundle = assetsRef.current;
    const rules = plantRules(bundle);
    if (!rules) return prev;
    const next = prev.filter(p => p.cell !== cell);
    const allowed = plantAllowance(rules, elderwoodOnBoard(bundle, rules, next)).get(cid) || 0;
    const copies = next.filter(p => p.characterId === cid);
    // Beim Umsetzen behaelt die Kopie ihren Platz im Array — sie bleibt die
    // zuerst gesetzte und faellt beim Nachziehen zuletzt weg.
    const out = copies.length > 0 && copies.length >= allowed
      ? next.map(p => (p === copies[0] ? { ...p, cell } : p))
      : [...next, { cell, characterId: cid, items: [] }];
    const trimmed = trimBoard(bundle, out);
    if (!trimmed.some(p => p.cell === cell && p.characterId === cid)) return prev;
    if (overLimit(trimmed) > Math.max(0, overLimit(prev))) return prev;
    return trimmed;
  }, [overLimit]);

  const placeAt = useCallback((team: Team, cell: number, cid: string) => {
    setPlacementsFor(team, prev => {
      const existing = prev.find(p => p.cell === cell);
      if (existing && existing.characterId === cid) return prev;
      if (isElderwoodPlant(cid)) return placePlant(prev, cell, cid);
      const existingElsewhere = prev.find(p => p.characterId === cid && p.cell !== cell);
      let next = prev.filter(p => p.cell !== cell);
      if (existingElsewhere) {
        // Umsetzen: Items, Sterne und Haltung wandern mit.
        next = next.filter(p => p.characterId !== cid);
        next.push({ ...existingElsewhere, cell });
      } else {
        // Neue Unit und Ersetzen: geprueft am Brett danach (Elder Dragon belegt
        // 2 Plaetze, beim Ersetzen fallen die Items der alten Unit weg,
        // Riftbeast 10 gibt 2 dazu). Ein Brett, das schon drueber liegt (alter
        // Link), darf nicht weiter drueber.
        next.push({ cell, characterId: cid, items: [] });
        if (overLimit(next) > Math.max(0, overLimit(prev))) return prev;
      }
      return next;
    });
  }, [overLimit, placePlant]);

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

  // Gleiche Items duerfen mehrfach auf eine Unit; was nicht darf (voll,
  // "nur 1 pro Champion", Emblem fuer eine schon vorhandene Synergie, Thief's
  // Gloves nur auf eine leere Unit) entscheidet itemBlock.
  const addItemToSelected = useCallback((itemId: string) => {
    if (selectedCell == null) return;
    setPlacementsFor(selectedTeam, prev => prev.map(p => {
      if (p.cell !== selectedCell) return p;
      if (itemBlock(assets, itemTexts, p, itemId)) return p;
      return { ...p, items: [...p.items, itemId] };
    }));
  }, [selectedCell, selectedTeam, assets, itemTexts]);

  // Used by item drag-and-drop onto an arbitrary occupied cell (no selection
  // required). No-op if the cell is empty or the item may not go on the unit.
  const addItemToCell = useCallback((team: Team, cell: number, itemId: string) => {
    setPlacementsFor(team, prev => prev.map(p => {
      if (p.cell !== cell) return p;
      if (itemBlock(assets, itemTexts, p, itemId)) return p;
      return { ...p, items: [...p.items, itemId] };
    }));
  }, [assets, itemTexts]);

  const setStanceFor = useCallback((team: Team, cell: number, stance: MfStance | null) => {
    setPlacementsFor(team, prev => prev.map(p => {
      if (p.cell !== cell) return p;
      if (stance === null) {
        const { stance: _omit, ...rest } = p;
        return rest;
      }
      return { ...p, stance };
    }));
  }, []);

  const setStarFor = useCallback((team: Team, cell: number, star: StarLevel | null) => {
    setPlacementsFor(team, prev => prev.map(p => {
      if (p.cell !== cell) return p;
      if (star === null) {
        const { star: _omit, ...rest } = p;
        return rest;
      }
      return { ...p, star };
    }));
  }, []);

  // Per Platz, nicht per ID — sonst nimmt ein Klick alle gleichen Items mit.
  const removeItemFromSelected = useCallback((slotIdx: number) => {
    if (selectedCell == null) return;
    setPlacementsFor(selectedTeam, prev => prev.map(p => p.cell === selectedCell
      ? { ...p, items: p.items.filter((_, i) => i !== slotIdx) }
      : p,
    ));
  }, [selectedCell, selectedTeam]);

  // Naechste Zelle zum Zeigerpunkt (Bildschirm-Koordinaten) auf einem Brett.
  // `occupiedOnly`: nur Zellen mit Unit (Items). null = weiter weg als erlaubt.
  function nearestCell(team: Team, clientX: number, clientY: number, occupiedOnly: boolean): number | null {
    const el = boardRefs.current[team];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const cw = r.width / 7.5;
    const ch = r.height / ROWS;
    const occupied = byCell(team);
    let best: number | null = null;
    let bestD = Infinity;
    for (let cell = 0; cell < ROWS * COLS; cell++) {
      if (occupiedOnly && !occupied.has(cell)) continue;
      const row = Math.floor(cell / COLS);
      const col = cell % COLS;
      const cx = r.left + (col + (row % 2 === 1 ? 0.5 : 0) + 0.5) * cw;
      const cy = r.top + (ROWS - 1 - row + 0.5) * ch;
      const d = Math.hypot(clientX - cx, clientY - cy);
      // Gleichstand: die kleinere Zellnummer gewinnt (fest, kein Flackern).
      if (d < bestD - 0.01) { bestD = d; best = cell; }
    }
    return best != null && bestD <= (occupiedOnly ? SNAP_ITEM : SNAP_CELL) * cw ? best : null;
  }

  function dropTargetFor(team: Team, e: React.DragEvent): number | null {
    const drag = dragRef.current;
    if (!drag) return null;
    return nearestCell(team, e.clientX, e.clientY, drag.from === 'item');
  }

  function onBoardDragOver(e: React.DragEvent, team: Team) {
    const cell = dropTargetFor(team, e);
    if (cell != null) {
      e.preventDefault();
      e.dataTransfer.dropEffect = dragRef.current?.from === 'board' ? 'move' : 'copy';
    }
    setDropTarget(prev => {
      if (cell == null) return prev?.team === team ? null : prev;
      return prev?.team === team && prev.cell === cell ? prev : { team, cell };
    });
  }

  function onBoardDragLeave(e: React.DragEvent, team: Team) {
    // Nur beim echten Verlassen des Brett-Rahmens, nicht beim Wechsel auf ein Kind.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropTarget(prev => (prev?.team === team ? null : prev));
  }

  function onBoardDrop(e: React.DragEvent, team: Team) {
    const cell = dropTargetFor(team, e);
    setDropTarget(null);
    if (cell == null) { dragRef.current = null; return; }
    onDropCell(e, team, cell);
  }

  // Klick/Tippen neben ein Sechseck (Luecke, Ecke, Rand): naechstes Feld.
  // Treffer auf ein Sechseck laufen ueber den Knopf selbst (stopPropagation).
  function onBoardClick(e: React.MouseEvent, team: Team) {
    if ((e.target as HTMLElement).closest('button')) return;
    const cell = nearestCell(team, e.clientX, e.clientY, false);
    if (cell != null) onCellClick(team, cell);
  }

  function onBoardContextMenu(e: React.MouseEvent, team: Team) {
    const btn = (e.target as HTMLElement).closest('button');
    if (btn && btn.dataset.cell == null) return;
    const cell = nearestCell(team, e.clientX, e.clientY, true);
    if (cell == null) return;
    onCellContextMenu(e, team, cell);
  }

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
      setOwnPlacements(prev => trimBoard(assetsRef.current, prev.filter(p => p.characterId !== cid)));
      setOppPlacements(prev => trimBoard(assetsRef.current, prev.filter(p => p.characterId !== cid)));
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
  function onDragStartItem(e: React.DragEvent, itemId: string) {
    setInfoItem(null);
    dragRef.current = { from: 'item', payload: itemId };
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', itemId);
  }
  function onDropCell(e: React.DragEvent, team: Team, cell: number) {
    e.preventDefault();
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.from === 'item') {
      addItemToCell(team, cell, String(drag.payload));
      setSelectedTeam(team);
      setSelectedCell(cell);
    } else if (drag.from === 'palette') {
      placeAt(team, cell, String(drag.payload));
    } else if (drag.from === 'board') {
      const from = Number(drag.payload);
      const fromTeam = drag.fromTeam || 'own';
      if (fromTeam === team) {
        if (from !== cell) swapWithinTeam(team, from, cell);
      } else {
        // Move across teams: erst pruefen, ob das Ziel-Brett danach passt (die
        // ankommende Unit kann ein Tactician-Item tragen oder 2 Plaetze
        // belegen), dann von der Quelle loeschen — sonst ginge die Unit bei
        // vollem Ziel verloren. Items, Sterne und Haltung wandern mit.
        const sourceP = placementsFor(fromTeam).find(p => p.cell === from);
        const target = placementsFor(team);
        if (sourceP) {
          const after = [...target.filter(p => p.cell !== cell), { ...sourceP, cell }];
          // Eine Pflanze braucht die Elderwood-Stufe des Ziel-Bretts.
          const plantOk = !isElderwoodPlant(sourceP.characterId)
            || trimBoard(assets, after).some(p => p.cell === cell && p.characterId === sourceP.characterId);
          if (plantOk && overLimit(after) <= Math.max(0, overLimit(target))) {
            setPlacementsFor(fromTeam, prev => prev.filter(p => p.cell !== from));
            setPlacementsFor(team, prev => [...prev.filter(p => p.cell !== cell), { ...sourceP, cell }]);
          }
        }
      }
    }
    dragRef.current = null;
  }

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
    setOwnPlacements(trimBoard(assetsRef.current, c.placements));
    setOppPlacements(trimBoard(assetsRef.current, c.oppPlacements || []));
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

  // In-Game Plan-Ahead Code in den Clipboard kopieren. Nimmt die Champions
  // in der Placement-Reihenfolge des eigenen Boards — der Riot Team Planner
  // erwartet die Slots so sortiert wie der Spieler sie sehen will.
  async function copyPlanAheadCode() {
    if (!assets) return;
    // Riots Code hat fest 10 Plaetze (tft-plan-ahead-code.ts), das Brett mit
    // Tactician-Items bis zu 13 Units: Units mit Items zuerst, damit beim
    // Abschneiden eine Unit ohne Items wegfaellt statt eines Carrys.
    const ids = [...ownPlacements.filter(p => p.items.length > 0), ...ownPlacements.filter(p => p.items.length === 0)]
      .map(p => p.characterId);
    if (ids.length === 0) return;
    const result = buildPlanAheadCode(ids, assets.set, assets);
    if (!result || !result.code) {
      setPlanAheadState('err');
      setTimeout(() => setPlanAheadState('idle'), 1800);
      return;
    }
    try {
      await navigator.clipboard.writeText(result.code);
      setPlanAheadState('ok');
      setTimeout(() => setPlanAheadState('idle'), 1800);
    } catch {
      setPlanAheadState('err');
      setTimeout(() => setPlanAheadState('idle'), 1800);
    }
  }

  // Publish to community gallery — anonymous, cookie-tracked.
  async function publishToCommunity() {
    if (typeof window === 'undefined' || ownPlacements.length === 0) return;
    const name = window.prompt(t('tft.builderPublishName'), '') || '';
    if (!name.trim()) return;
    const handle = window.prompt(t('tft.builderPublishHandle'), '') || '';
    // Derive trait_label + carry_unit from active synergies + most-itemized unit
    // (nie eine Elderwood-Pflanze, auch wenn sie Items traegt).
    const carry = ownPlacements.filter(p => !isElderwoodPlant(p.characterId)).sort((a, b) =>
      (b.items?.length || 0) - (a.items?.length || 0),
    )[0]?.characterId || null;
    setPublishState('sending');
    try {
      const r = await fetch('/api/tft/comps/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim().slice(0, 60),
          authorHandle: handle.trim().slice(0, 24) || null,
          placements: ownPlacements,
          oppPlacements,
          carryUnit: carry,
        }),
      });
      if (r.ok) {
        setPublishState('ok');
        setTimeout(() => setPublishState('idle'), 2500);
      } else {
        const j = await r.json().catch(() => ({}));
        setPublishState('err');
        console.warn('publish failed:', j);
        setTimeout(() => setPublishState('idle'), 2500);
      }
    } catch {
      setPublishState('err');
      setTimeout(() => setPublishState('idle'), 2500);
    }
  }

  const selectedPlacement = selectedCell != null ? byCell(selectedTeam).get(selectedCell) : undefined;

  // ----- Hex cell renderer -----
  function renderBoard(team: Team) {
    const isOwn = team === 'own';
    const byCellMap = byCell(team);
    const ps = placementsFor(team);
    const rules = plantRules(assets);
    const elderwood = rules ? elderwoodOnBoard(assets, rules, ps) : 0;
    const allowance = rules ? plantAllowance(rules, elderwood) : new Map<string, number>();
    const plantStarLevel = rules ? plantStar(rules, elderwood) : 1;
    const ewIcon = rules ? tftIconUrl(assets, assets?.traits[rules.traitId]?.icon) : null;
    return (
      <div
        className="bg-surface-base border border-border-subtle rounded-lg p-3"
        onDragOver={e => onBoardDragOver(e, team)}
        onDragLeave={e => onBoardDragLeave(e, team)}
        onDrop={e => onBoardDrop(e, team)}
        onClick={e => onBoardClick(e, team)}
        onContextMenu={e => onBoardContextMenu(e, team)}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-2">
          <div className="text-fg-secondary text-[10px] uppercase tracking-widest">
            {isOwn ? t('tft.builderOwn') : t('tft.builderOpponent')} · {teamSlotsUsed(assets, ps)}/{teamLimit(itemTexts, ps, assets, resolveMfTrait)}
          </div>
          {/* Elderwood-Pflanzen ab der ersten Stufe: Ziehen oder Antippen +
              Feld. Die Zahl ist, was die Stufe noch erlaubt. */}
          {rules && allowance.size > 0 && (
            <div className="flex items-center gap-1.5">
              {ewIcon && <img src={ewIcon} alt="" className="w-4 h-4" />}
              <span className="text-fg-secondary text-[10px] uppercase tracking-widest">{rules.traitName}</span>
              {[...allowance].map(([id, n]) => {
                const left = Math.max(0, n - ps.filter(p => p.characterId === id).length);
                const name = plantName(id, lang) || id;
                const url = tftChampionTileUrl(assets, assets?.champions[id]);
                const isPicker = pickerChar === id;
                return (
                  <button
                    key={id}
                    draggable
                    onDragStart={e => onDragStartChampion(e, id)}
                    onClick={() => setPickerChar(prev => (prev === id ? null : id))}
                    aria-label={name}
                    title={name}
                    className="relative w-7 h-7 rounded overflow-hidden transition-all"
                    style={{
                      border: `2px solid ${isPicker ? '#a892ff' : costColor(0)}`,
                      boxShadow: isPicker ? '0 0 0 2px rgba(168,146,255,0.4)' : 'none',
                      opacity: left === 0 && !isPicker ? 0.45 : 1,
                    }}
                  >
                    {url && <img src={url} alt="" className="w-full h-full object-cover pointer-events-none" />}
                    <span className="absolute bottom-0 right-0 px-0.5 rounded-tl bg-black/75 text-white text-[9px] leading-none font-bold tabular-nums">
                      {left}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {ps.length > 0 && (
            <button
              onClick={() => clearBoard(team)}
              className="ml-auto text-fg-faint hover:text-pos-loss-text text-[10px]"
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
          ref={el => { boardRefs.current[team] = el; }}
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
            // Beim Ziehen leuchtet das Feld, auf dem losgelassen wuerde.
            const isDropTarget = dropTarget?.team === team && dropTarget.cell === cell;
            const champ: any = p && assets?.champions[p.characterId];
            const url = champ ? tftChampionTileUrl(assets, champ) : null;
            const cost = champ?.cost ?? 1;
            const isPlant = !!p && isElderwoodPlant(p.characterId);
            const unitName = p ? (isPlant && plantName(p.characterId, lang)) || champ?.name || p.characterId : '';
            // Pflanzen-Stern folgt der Stufe, nicht der Auswahl.
            const star = isPlant ? plantStarLevel : (p?.star ?? 1);
            const borderColor = isSelected || isDropTarget
              ? '#a892ff'
              : p
                ? costColor(cost)
                : pickerChar
                  ? '#7B61FF55'
                  : 'var(--border-subtle)';
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
                    opacity: !p && !isSelected && !isDropTarget ? 0.6 : 1,
                  }}
                />
                {/* inner content — Ablegen und Rechtsklick laufen ueber den
                    Brett-Rahmen (naechster Mittelpunkt), siehe onBoardDrop */}
                <button
                  data-cell={cell}
                  draggable={!!p}
                  onClick={e => { e.stopPropagation(); onCellClick(team, cell); }}
                  onDragStart={p ? (e => onDragStartBoard(e, team, cell)) : undefined}
                  className="absolute overflow-hidden transition-all duration-150 cursor-pointer"
                  style={{
                    top: '3px', left: '3px', right: '3px', bottom: '3px',
                    clipPath: HEX_CLIP,
                    backgroundColor: 'var(--surface-sunken)',
                  }}
                  title={unitName}
                >
                  {url && (
                    <img src={url} alt={unitName} className="w-full h-full object-cover pointer-events-none" />
                  )}
                </button>
                {/* Sterne und Items AUSSERHALB des Sechseck-Zuschnitts, sonst
                    schneidet die Spitze sie ab. Sterne als Pille auf der oberen
                    Spitze (4 % Hoehe), Items als Reihe auf der Unterkante
                    (74–98 %): so endet die Item-Reihe der Reihe darueber genau
                    an der Zellgrenze und beruehrt die Pille nicht. */}
                {p && star > 1 && (
                  <div
                    className="absolute left-1/2 -translate-x-1/2 z-10 pointer-events-none px-1 py-px rounded-full bg-black/80 text-[8px] sm:text-[9px] leading-none font-bold tracking-tight whitespace-nowrap"
                    style={{ top: '4%', color: starColorOf(star) }}
                  >
                    {'★'.repeat(star)}
                  </div>
                )}
                {p && p.items.length > 0 && (
                  <div className="absolute left-0 right-0 z-10 flex justify-center pointer-events-none" style={{ top: '74%', columnGap: '3%' }}>
                    {p.items.map((iid, idx) => {
                      const item = assets?.items[iid];
                      const iurl = tftIconUrl(assets, item?.icon);
                      return (
                        <div key={idx} className="rounded-sm overflow-hidden border border-black/80 bg-surface-sunken shadow" style={{ width: '28%', aspectRatio: '1 / 1' }}>
                          {iurl && <img src={iurl} alt="" className="w-full h-full object-cover" />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="comps" />
      <TftHero pageTitle={t('tft.builderTitle')} subtitle={t('tft.builderSubtitle')} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-2 pb-8">
        <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_300px] gap-4">
          {/* LEFT — Active traits + saved comps */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start order-2 lg:order-none">
            <div className="bg-surface-base border border-border-subtle rounded-lg p-4">
              <div className="text-fg-secondary text-xs uppercase tracking-widest mb-3">
                {t('tft.builderTraits')}
              </div>
              {ownPlacements.length === 0 ? (
                <div className="text-fg-muted text-xs">—</div>
              ) : (
                <div className="space-y-2">
                  {activeTraits.map(tr => {
                    const tierIdx = tr.activeIdx;
                    const iconUrl = tftIconUrl(assets, tr.icon);
                    const tier = tierIdx != null ? tr.tiers[tierIdx] : null;
                    const styleColor = (tier ? TRAIT_STYLE_COLOR[tier.style] : undefined) ?? 'var(--fg-faint)';
                    return (
                      <div
                        key={tr.apiName}
                        className="flex items-center gap-2 p-1.5 rounded"
                        style={{ backgroundColor: tier ? `${withAlpha(styleColor, 0x15)}` : 'transparent' }}
                      >
                        {iconUrl ? (
                          <img src={iconUrl} alt="" className="w-6 h-6 rounded" style={{ filter: tier ? 'none' : 'grayscale(1)' }} />
                        ) : (
                          <div className="w-6 h-6 rounded bg-surface-overlay" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-white text-xs truncate">{tr.name}</div>
                          <div className="flex items-center gap-0.5 mt-0.5">
                            {tr.tiers.map((tierDef: any, i: number) => (
                              <span
                                key={i}
                                className="text-[10px] tabular-nums px-1 rounded"
                                style={{
                                  color: i === tierIdx ? 'var(--fg-primary)' : 'var(--fg-faint)',
                                  backgroundColor: i === tierIdx ? styleColor : 'transparent',
                                }}
                              >
                                {tierDef.minUnits}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="tabular-nums text-sm" style={{ color: tier ? styleColor : 'var(--fg-muted)' }}>
                          {tr.count}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {savedComps.length > 0 && (
              <div className="bg-surface-base border border-border-subtle rounded-lg p-4">
                <div className="text-fg-secondary text-xs uppercase tracking-widest mb-3">
                  {t('tft.builderMyComps')}
                </div>
                <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
                  {savedComps.map(c => (
                    <div key={c.id} className="flex items-center gap-2 p-1.5 rounded bg-surface-sunken">
                      <button
                        onClick={() => loadSaved(c.id)}
                        className="flex-1 text-left text-white text-xs hover:text-[#a892ff] truncate"
                        title={c.name}
                      >
                        {c.name}
                        <span className="text-fg-faint ml-1.5">({c.placements.length + (c.oppPlacements?.length || 0)})</span>
                      </button>
                      <button
                        onClick={() => deleteSaved(c.id)}
                        className="text-fg-faint hover:text-pos-loss-text text-xs px-1"
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

          {/* CENTER — Boards + champion palette */}
          <div className="order-1 lg:order-none">
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="text-fg-secondary text-xs uppercase tracking-widest">
                {t('tft.builderBoard')}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowOpponent(s => !s)}
                  className="px-3 py-1.5 rounded text-xs bg-surface-raised text-fg-secondary hover:text-white border border-border-subtle"
                >
                  {showOpponent ? t('tft.builderHideOpponent') : t('tft.builderShowOpponent')}
                </button>
                <button
                  onClick={saveCurrent}
                  disabled={ownPlacements.length === 0 && oppPlacements.length === 0}
                  className="px-3 py-1.5 rounded text-xs bg-accent-fill text-white hover:bg-accent-fill-hover disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {t('tft.builderSave')}
                </button>
                <button
                  onClick={copyShareLink}
                  disabled={ownPlacements.length === 0 && oppPlacements.length === 0}
                  className="px-3 py-1.5 rounded text-xs bg-surface-raised text-fg-secondary hover:text-white border border-border-subtle disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {shareToast ? t('tft.builderShareCopied') : t('tft.builderShare')}
                </button>
                <button
                  onClick={copyPlanAheadCode}
                  disabled={ownPlacements.length === 0}
                  className={`px-3 py-1.5 rounded text-xs border disabled:opacity-30 disabled:cursor-not-allowed ${
                    planAheadState === 'ok'
                      ? 'bg-[#3ecf8e]/15 border-[#3ecf8e]/60 text-[#3ecf8e]'
                      : planAheadState === 'err'
                      ? 'bg-[#e44040]/15 border-[#e44040]/60 text-pos-loss-text'
                      : 'bg-surface-raised border-border-subtle text-fg-secondary hover:text-white'
                  }`}
                  title={t('tft.planAhead.copy')}
                >
                  {planAheadState === 'ok' ? '✓ ' + t('tft.planAhead.copied')
                    : planAheadState === 'err' ? t('tft.planAhead.failed')
                    : t('tft.planAhead.export')}
                </button>
                <button
                  onClick={publishToCommunity}
                  disabled={ownPlacements.length === 0 || publishState === 'sending'}
                  className="px-3 py-1.5 rounded text-xs bg-[#3ecf8e] text-surface-base hover:bg-[#5be0a3] disabled:opacity-30 disabled:cursor-not-allowed font-medium"
                  title={t('tft.builderPublishHint')}
                >
                  {publishState === 'sending' ? '…'
                    : publishState === 'ok' ? '✓ ' + t('tft.builderPublished')
                    : publishState === 'err' ? t('tft.builderPublishErr')
                    : t('tft.builderPublish')}
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
            <div className="bg-surface-base border border-border-subtle rounded-lg p-4 mt-4 mb-4">
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCostFilter(null)}
                    className={`px-2.5 py-1 rounded text-xs ${costFilter == null ? 'bg-accent-fill text-white' : 'bg-surface-raised text-fg-secondary hover:text-white'}`}
                  >
                    {t('tft.bucket.all')}
                  </button>
                  {[1, 2, 3, 4, 5].map(c => (
                    <button
                      key={c}
                      onClick={() => setCostFilter(c)}
                      className={`px-2.5 py-1 rounded text-xs ${costFilter === c ? 'text-white' : 'bg-surface-raised text-fg-secondary hover:text-white'}`}
                      style={costFilter === c ? { backgroundColor: costColor(c) } : {}}
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
                  className="flex-1 min-w-[160px] bg-surface-raised border border-border-subtle rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-accent-a60"
                />
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(54px,1fr))] gap-1.5">
                {filteredChampions.map((c, idx) => {
                  const champ: any = assets?.champions[c.characterId];
                  const url = tftChampionTileUrl(assets, champ);
                  const onBoard = ownPlacements.some(p => p.characterId === c.characterId) || oppPlacements.some(p => p.characterId === c.characterId);
                  const isPicker = pickerChar === c.characterId;
                  const traits = (champ?.traits || []).join(' · ');
                  const ability = champ?.ability;
                  const tooltip = [
                    `${c.name} (${c.cost})`,
                    traits || null,
                    ability?.name ? `\n${ability.name}` : null,
                    formatTftDesc(ability?.desc) || null,
                  ].filter(Boolean).join('\n');
                  return (
                    <button
                      key={c.characterId}
                      onClick={() => onChampionPick(c.characterId)}
                      draggable
                      onDragStart={(e) => onDragStartChampion(e, c.characterId)}
                      className="relative aspect-square rounded overflow-hidden transition-all"
                      style={{
                        border: `2px solid ${isPicker ? '#a892ff' : costColor(c.cost)}`,
                        boxShadow: isPicker ? '0 0 0 2px rgba(168,146,255,0.4)' : 'none',
                        opacity: onBoard && !isPicker ? 0.45 : 1,
                      }}
                      title={tooltip}
                    >
                      {url && <img src={url} alt={c.name} loading={idx < TILES_EAGER ? undefined : 'lazy'} className="w-full h-full object-cover" />}
                      <span className="absolute bottom-0 left-0 right-0 text-[9px] text-center text-white bg-black/60 truncate px-0.5">
                        {c.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {/* RIGHT — Selected unit (with MF stance picker) + items palette */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start order-3 lg:order-none">
            {selectedPlacement && (
              <div className="bg-surface-base border border-[#a892ff]/40 rounded-lg p-4">
                <div className="text-fg-secondary text-xs uppercase tracking-widest mb-2">
                  {t('tft.builderUnitItems')}
                  <span className="ml-1 text-fg-faint normal-case tracking-normal">
                    ({selectedTeam === 'own' ? t('tft.builderOwn') : t('tft.builderOpponent')})
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-3">
                  {(() => {
                    const champ: any = assets?.champions[selectedPlacement.characterId];
                    const url = tftChampionTileUrl(assets, champ);
                    return (
                      <>
                        {url && <img src={url} alt={champ?.name || ''} className="w-10 h-10 rounded object-cover" style={{ border: `2px solid ${costColor(champ?.cost ?? 1)}` }} />}
                        <div className="text-white text-sm font-medium">{plantName(selectedPlacement.characterId, lang) || champ?.name || selectedPlacement.characterId}</div>
                      </>
                    );
                  })()}
                </div>
                {/* Pflanzen: Stern kommt aus der Elderwood-Stufe, keine Auswahl. */}
                {!isElderwoodPlant(selectedPlacement.characterId) && <div className="mb-3">
                  <div className="text-fg-secondary text-[10px] uppercase tracking-widest mb-2">
                    {t('tft.builderStarLevel')}
                  </div>
                  <div className="flex gap-1.5">
                    {([1, 2, 3, 4] as const).map(n => {
                      const isActive = (selectedPlacement.star ?? 1) === n;
                      const color = starColorOf(n);
                      return (
                        <button
                          key={n}
                          onClick={() => setStarFor(selectedTeam, selectedPlacement.cell, n === 1 ? null : (n as StarLevel))}
                          className="flex-1 py-1.5 rounded text-xs font-bold transition border-2"
                          style={{
                            borderColor: isActive ? color : 'var(--border-subtle)',
                            backgroundColor: isActive ? `${withAlpha(color, 0x22)}` : 'var(--surface-sunken)',
                            color: isActive ? color : 'var(--fg-faint)',
                          }}
                        >
                          {n}★
                        </button>
                      );
                    })}
                  </div>
                </div>}
                <div className="flex gap-1.5">
                  {Array.from({ length: MAX_ITEMS_PER_UNIT }).map((_, slotIdx) => {
                    const iid = selectedPlacement.items[slotIdx];
                    const item = iid ? assets?.items[iid] : null;
                    const url = tftIconUrl(assets, item?.icon);
                    // Thief's Gloves belegt alle drei Plaetze: freie Plaetze dahinter gesperrt zeigen.
                    const lockedEmpty = !iid && slotsUsed(itemTexts, selectedPlacement.items) >= MAX_ITEMS_PER_UNIT;
                    return (
                      <button
                        key={slotIdx}
                        onClick={() => { if (iid) { removeItemFromSelected(slotIdx); setInfoItem(null); } }}
                        {...(iid ? infoHandlers(iid) : {})}
                        aria-label={item?.name || undefined}
                        className={`flex-1 aspect-square rounded border border-border-subtle overflow-hidden bg-surface-sunken hover:border-[#e44040]/60 transition ${lockedEmpty ? 'opacity-40' : ''}`}
                      >
                        {url && <img src={url} alt={item?.name || ''} className="w-full h-full object-cover" />}
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const champ: any = assets?.champions[selectedPlacement.characterId];
                  if (!champ?.ability?.name) return null;
                  return (
                    <div className="mt-3 pt-3 border-t border-border-subtle">
                      <div className="text-fg-secondary text-[10px] uppercase tracking-widest mb-1">
                        {t('tft.builderAbility')}
                      </div>
                      <div className="text-white text-xs font-medium mb-1">{champ.ability.name}</div>
                      {champ.ability.desc && (
                        <div className="text-[#cbd5e1] text-[11px] leading-relaxed whitespace-pre-line">{formatTftDesc(champ.ability.desc)}</div>
                      )}
                    </div>
                  );
                })()}
                {selectedPlacement.items.length > 0 && (() => {
                  // Jedes Item nur einmal beschreiben, auch wenn es doppelt drauf ist.
                  const equipped = [...new Set(selectedPlacement.items)]
                    .map(iid => {
                      const text = itemTextFor(itemTexts, iid, lang);
                      const raw = assets?.items[iid];
                      return {
                        id: iid,
                        name: text?.name || raw?.name || iid,
                        desc: text?.desc || formatTftDesc(raw?.desc),
                        stats: text?.stats || [],
                      };
                    })
                    .filter(x => x.desc || x.stats.length > 0);
                  if (equipped.length === 0) return null;
                  return (
                    <div className="mt-3 pt-3 border-t border-border-subtle space-y-2">
                      {equipped.map(x => (
                        <div key={x.id}>
                          <div className="text-white text-[11px] font-medium">{x.name}</div>
                          {x.stats.length > 0 && <ItemStatLine stats={x.stats} className="text-[10px]" />}
                          {x.desc && <div className="text-[#cbd5e1] text-[10px] leading-relaxed whitespace-pre-line">{x.desc}</div>}
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {selectedPlacement.characterId === MF_CHAR_ID && (
                  <div className="mt-3 pt-3 border-t border-border-subtle">
                    <div className="text-fg-secondary text-[10px] uppercase tracking-widest mb-2">
                      {t('tft.builderMfStance')}
                    </div>
                    <div className="flex gap-1.5">
                      {(['AS', 'Flex', 'Mana'] as MfStance[]).map(s => {
                        const itemId = MF_STANCE_ITEMS[s];
                        const stanceItem = assets?.items[itemId];
                        const iurl = tftIconUrl(assets, stanceItem?.icon);
                        const isActive = selectedPlacement.stance === s;
                        return (
                          <button
                            key={s}
                            onClick={() => setStanceFor(selectedTeam, selectedPlacement.cell, isActive ? null : s)}
                            className="flex-1 aspect-square rounded overflow-hidden transition"
                            style={{ border: `2px solid ${isActive ? '#a892ff' : 'var(--border-subtle)'}` }}
                            title={stanceItem?.name || s}
                          >
                            {iurl && <img src={iurl} alt={stanceItem?.name || ''} className="w-full h-full object-cover" />}
                          </button>
                        );
                      })}
                    </div>
                    {selectedPlacement.stance && (
                      <div className="text-[10px] text-[#a892ff] mt-1.5 text-center">
                        {assets?.items[MF_STANCE_ITEMS[selectedPlacement.stance]]?.name}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="bg-surface-base border border-border-subtle rounded-lg p-4">
              <div className="flex flex-wrap items-center gap-1 mb-3">
                {ITEM_TABS.map(tab => (
                  <button
                    key={tab}
                    onClick={() => setItemTab(tab)}
                    className={`px-2 py-1 rounded text-[11px] ${itemTab === tab ? 'bg-accent-fill text-white' : 'bg-surface-raised text-fg-secondary hover:text-white'}`}
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
                className="w-full bg-surface-raised border border-border-subtle rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-accent-a60 mb-3"
              />
              <div className="grid grid-cols-[repeat(auto-fill,minmax(34px,1fr))] gap-1.5 max-h-[440px] overflow-y-auto pr-1">
                {filteredItems.map(item => {
                  const url = tftIconUrl(assets, item.icon);
                  const onSelectedUnit = selectedPlacement?.items.includes(item.id);
                  // Gesperrt nur fuer die ausgewaehlte Unit; Ziehen auf eine
                  // andere Unit bleibt moeglich. Kein `disabled`, sonst
                  // erscheint die Infokarte beim Drueberfahren nicht.
                  const blocked = selectedPlacement ? itemBlock(assets, itemTexts, selectedPlacement, item.id) : null;
                  return (
                    <button
                      key={item.id}
                      draggable
                      onDragStart={(e) => onDragStartItem(e, item.id)}
                      onClick={e => { addItemToSelected(item.id); showInfoAfterTap(e, item.id); }}
                      {...infoHandlers(item.id)}
                      aria-disabled={blocked ? true : undefined}
                      aria-label={item.name}
                      className={`aspect-square rounded overflow-hidden border border-border-subtle hover:border-[#a892ff] transition cursor-grab active:cursor-grabbing ${blocked ? 'opacity-30' : ''}`}
                      style={{ boxShadow: onSelectedUnit ? '0 0 0 2px #a892ff inset' : 'none' }}
                    >
                      {url && <img src={url} alt={item.name} className="w-full h-full object-cover pointer-events-none" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
      {infoItem && (
        <ItemInfoCard
          id={infoItem.id}
          anchor={infoItem.rect}
          assets={assets}
          text={itemTextFor(itemTexts, infoItem.id, lang)}
        />
      )}
      <Footer />
    </main>
  );
}

// Infokarte zu einem Item: Name, Werte, Wirkung. Steht links neben dem Item
// (Item-Auswahl rechts am PC), sonst darunter bzw. darueber. Faengt keine
// Zeiger-Ereignisse, damit Ziehen und Klicken unberuehrt bleiben.
function ItemInfoCard({ id, anchor, assets, text }: {
  id: string;
  anchor: DOMRect;
  assets: TftAssetsBundle | null;
  text: ItemTextView | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const gap = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.left - gap - w;
    let top = anchor.top;
    if (left < gap) {
      left = Math.min(Math.max(gap, anchor.left + anchor.width / 2 - w / 2), vw - w - gap);
      top = anchor.bottom + gap;
      if (top + h > vh - gap) top = anchor.top - gap - h;
    }
    setPos({ left, top: Math.min(Math.max(gap, top), vh - h - gap) });
  }, [id, anchor]);
  const item = assets?.items[id];
  const icon = tftIconUrl(assets, item?.icon);
  return (
    <div
      ref={ref}
      role="tooltip"
      className="fixed z-50 w-64 max-w-[calc(100vw-16px)] pointer-events-none bg-surface-raised border border-border-subtle rounded-lg shadow-xl p-3"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      <div className="flex items-center gap-2">
        {icon && <img src={icon} alt="" className="w-7 h-7 rounded" />}
        <div className="text-white text-xs font-medium">{text?.name || item?.name || id}</div>
      </div>
      {text && text.stats.length > 0 && <ItemStatLine stats={text.stats} className="mt-2 text-[11px]" />}
      {text?.desc && <div className="mt-2 text-[11px] leading-relaxed text-[#cbd5e1] whitespace-pre-line">{text.desc}</div>}
    </div>
  );
}
