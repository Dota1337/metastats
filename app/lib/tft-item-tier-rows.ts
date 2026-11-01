// Reihen der Items-Seite (User 01.11.2026, Aufbau wie die Tier-Ansicht der Comps,
// app/tft/comps/atlas/AtlasClient.tsx): S+ bis C, darunter eine Reihe ohne
// Buchstaben, nur wenn belegt. Reine Funktionen, damit die Regeln ohne Browser
// testbar sind. Grenzen stehen in tft-tier-letter.ts, nicht hier.
import { itemBucketOf } from './tft-item-bucket';
import { itemTakesTier, tierLetterOf, TIER_LETTERS, TIER_MIN_GAMES, type TierLetter } from './tft-tier-letter';
import { tftLabel, type TftAssetsBundle } from './tft-cdragon';
import type { Lang } from './lang-path';

export interface ItemRow {
  apiName: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  pickRate: number | null;
  topUsers: string[];
}

export const ITEM_SORTS = ['avg', 'top4', 'win', 'pick', 'games', 'velocity'] as const;
export type ItemSortBy = (typeof ITEM_SORTS)[number];

export function parseItemSort(v: string | null | undefined): ItemSortBy {
  return ITEM_SORTS.includes(v as ItemSortBy) ? (v as ItemSortBy) : 'avg';
}

// Knoepfe der Items-Seite (User 01.11.2026). Wie tft-item-bucket, aber Traenke
// bekommen einen eigenen Knopf (auch die Radiant-Traenke), und was dort „other"
// heisst, zaehlt als normales Item, damit nichts nur unter „Alle" auftaucht.
export const ITEM_KINDS = ['standard', 'radiant', 'emblem', 'artifact', 'potion'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export function itemKindOf(apiName: string, assets: TftAssetsBundle | null): ItemKind {
  if (/Potion/i.test(apiName)) return 'potion';
  const bucket = itemBucketOf(apiName, assets);
  return bucket === 'other' ? 'standard' : bucket;
}

export function parseItemType(v: string | null | undefined): ItemKind | null {
  return ITEM_KINDS.includes(v as ItemKind) ? (v as ItemKind) : null;
}

/** Augment-Embleme tragen Namen und Bild des echten Emblems, ihre Werte waeren
 *  eine Augment-Statistik (feedback_no_augment_stats). Gleiche Regel wie
 *  isCompEmblem in tft-comp-outcome.ts. Komponenten sowie Tactician's Crown, Shield
 *  und Cape stehen nicht auf der Seite (User 01.11.2026), ihre Detailseiten bleiben
 *  erreichbar. Die TFT_Item_-Namen sind dieselben Items unter alter Kennung. */
const HIDDEN_ITEMS = new Set([
  'DA_TacticiansCrown', 'DA_TacticiansShield', 'DA_TacticiansCape',
  'TFT_Item_ForceOfNature', 'TFT_Item_TacticiansScepter', 'TFT_Item_TacticiansRing',
]);

export function isListedItem(apiName: string, assets?: TftAssetsBundle | null): boolean {
  if (/Emblem.*Augment/i.test(apiName) || /_Component_/i.test(apiName) || HIDDEN_ITEMS.has(apiName)) return false;
  return !assets?.items[apiName]?.tags?.includes('component');
}

/** Item-Art und Suche, wie vorher in der Tabelle. */
export function filterItems(
  items: readonly ItemRow[],
  { type, search, assets, lang }: { type: ItemKind | null; search: string; assets: TftAssetsBundle | null; lang: Lang },
): ItemRow[] {
  const q = search.trim().toLowerCase();
  return items.filter(it => {
    if (!isListedItem(it.apiName, assets)) return false;
    if (type && itemKindOf(it.apiName, assets) !== type) return false;
    if (!q) return true;
    const meta = assets?.items[it.apiName];
    return (meta?.name || '').toLowerCase().includes(q)
      || (tftLabel(meta, lang) || '').toLowerCase().includes(q)
      || it.apiName.toLowerCase().includes(q);
  });
}

export function itemTierLetter(it: ItemRow, assets: TftAssetsBundle | null): TierLetter | null {
  if (!itemTakesTier(it.apiName, assets?.items[it.apiName]?.tags)) return null;
  return tierLetterOf({ avgPlacement: it.avgPlacement, games: it.games }, 'items');
}

// Ohne Wert ans Ende, Gleichstand nach Kennung: sonst springen Kacheln zwischen
// zwei Abrufen.
function compare(a: ItemRow, b: ItemRow, sort: ItemSortBy, deltaOf?: (apiName: string) => number | null): number {
  const value = (r: ItemRow): number | null => {
    switch (sort) {
      case 'top4': return r.top4Rate == null ? null : -r.top4Rate;
      case 'win': return r.top1Rate == null ? null : -r.top1Rate;
      case 'pick': return r.pickRate == null ? null : -r.pickRate;
      case 'games': return -r.games;
      // Staerkste Verbesserung zuerst (niedrigerer Ø-Platz ist besser).
      case 'velocity': return deltaOf ? deltaOf(r.apiName) : null;
      default: return r.avgPlacement;
    }
  };
  const av = value(a);
  const bv = value(b);
  if (av == null && bv == null) return a.apiName.localeCompare(b.apiName);
  if (av == null) return 1;
  if (bv == null) return -1;
  return av - bv || a.apiName.localeCompare(b.apiName);
}

// Reihe ohne Buchstaben: Traenke, dann zu wenig Spiele, jeweils nach Spielen. Nach
// Ø stuende die Health Potion vorn — genau der Fall, wegen dem Traenke keinen
// Buchstaben haben.
function unratedBlock(it: ItemRow): number {
  if (/Potion/i.test(it.apiName)) return 0;
  return it.games >= TIER_MIN_GAMES.items ? 1 : 2;
}

export interface ItemTierRow {
  tier: TierLetter | null;
  items: ItemRow[];
}

export function groupItemsByTier(
  items: readonly ItemRow[],
  { assets, sort, deltaOf }: { assets: TftAssetsBundle | null; sort: ItemSortBy; deltaOf?: (apiName: string) => number | null },
): ItemTierRow[] {
  const byTier = new Map<TierLetter | null, ItemRow[]>();
  for (const it of items) {
    const tier = itemTierLetter(it, assets);
    const list = byTier.get(tier);
    if (list) list.push(it);
    else byTier.set(tier, [it]);
  }
  const rows: ItemTierRow[] = [];
  for (const tier of [...TIER_LETTERS, null]) {
    const list = byTier.get(tier);
    if (!list?.length) continue;
    list.sort(tier
      ? (a, b) => compare(a, b, sort, deltaOf)
      : (a, b) => unratedBlock(a) - unratedBlock(b) || b.games - a.games || a.apiName.localeCompare(b.apiName));
    rows.push({ tier, items: list });
  }
  return rows;
}

/** Platzverteilung aus den vorhandenen Werten. null, wenn ein Wert fehlt: dann
 *  keine Balken statt eines vorgetaeuschten 0 %. */
export function placementBlocks(it: Pick<ItemRow, 'top4Rate' | 'top1Rate'>): { first: number; second: number; third: number } | null {
  if (it.top1Rate == null || it.top4Rate == null) return null;
  return { first: it.top1Rate, second: Math.max(0, it.top4Rate - it.top1Rate), third: Math.max(0, 1 - it.top4Rate) };
}

/** Weitere Adress-Parameter der Seite, nur bei Abweichung vom Standard. */
export function itemExtraQuery({ item, sort, type }: { item: string | null; sort: ItemSortBy; type: ItemKind | null }): string {
  return `${item ? `&item=${encodeURIComponent(item)}` : ''}${sort !== 'avg' ? `&sort=${sort}` : ''}${type ? `&type=${type}` : ''}`;
}
