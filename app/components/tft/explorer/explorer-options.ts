import {
  tftChampionTileUrl, tftIconUrl, tftPlayableChampions, tftTraitDisplayName, tftTraitIdPrefix,
  type TftAssetsBundle,
} from '../../../lib/tft-cdragon';
import { itemBucketOf, type ItemBucket } from '../../../lib/tft-item-bucket';

// Auswahllisten und Anzeigenamen des Data Explorers, aus dem Asset-Bundle
// abgeleitet (dieselben Regeln wie die Unit-/Item-/Trait-Seiten).

export interface UnitOption { id: string; name: string; cost: number; img: string | null }
export interface ItemOption { id: string; name: string; bucket: ItemBucket; img: string | null }
export interface TraitOption { id: string; name: string; img: string | null; mins: number[] }

export interface ExplorerOptions {
  units: UnitOption[];
  items: ItemOption[];
  traits: TraitOption[];
  unitById: Map<string, UnitOption>;
  itemById: Map<string, ItemOption>;
  traitById: Map<string, TraitOption>;
}

// Platzhalter-Namen aus dem Bundle (nicht lokalisierte Rohschluessel).
const JUNK_NAME = /^@|^tft_item_name_|@[A-Za-z]+@/i;
const BUCKET_ORDER: ItemBucket[] = ['standard', 'emblem', 'artifact', 'radiant', 'other'];

export function buildExplorerOptions(assets: TftAssetsBundle | null): ExplorerOptions {
  const units: UnitOption[] = tftPlayableChampions(assets).map(({ id, champion }) => ({
    id, name: champion.name, cost: champion.cost, img: tftChampionTileUrl(assets, champion),
  }));

  const items: ItemOption[] = [];
  if (assets) {
    const active = new Set(assets.active?.items || []);
    for (const [id, meta] of Object.entries(assets.items)) {
      if (!active.has(id) || !meta?.name || JUNK_NAME.test(meta.name)) continue;
      const bucket = itemBucketOf(id, assets);
      // Komponenten (keine Rezeptur) sind kein fertiges Item.
      if (bucket === 'other' && !(meta.composition?.length)) continue;
      items.push({ id, name: meta.name, bucket, img: tftIconUrl(assets, meta.icon) });
    }
    items.sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) || a.name.localeCompare(b.name));
  }

  const traits: TraitOption[] = [];
  if (assets) {
    const prefix = tftTraitIdPrefix(assets);
    for (const [id, meta] of Object.entries(assets.traits)) {
      if (!meta?.name || (prefix && !id.startsWith(prefix))) continue;
      traits.push({
        id, name: tftTraitDisplayName(assets, id), img: tftIconUrl(assets, meta.icon),
        mins: (meta.tiers || []).map(x => Number(x.minUnits)).filter(Number.isFinite),
      });
    }
    traits.sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    units, items, traits,
    unitById: new Map(units.map(u => [u.id, u])),
    itemById: new Map(items.map(i => [i.id, i])),
    traitById: new Map(traits.map(t => [t.id, t])),
  };
}

// Namen auch fuer Kennungen, die nicht in den Auswahllisten stehen
// (z. B. Items aus einem aelteren Patch).
export function unitName(o: ExplorerOptions, assets: TftAssetsBundle | null, id: string): string {
  return o.unitById.get(id)?.name || assets?.champions[id]?.name || id;
}
export function itemName(o: ExplorerOptions, assets: TftAssetsBundle | null, id: string): string {
  return o.itemById.get(id)?.name || assets?.items[id]?.name || id;
}
export function traitName(o: ExplorerOptions, assets: TftAssetsBundle | null, id: string): string {
  return o.traitById.get(id)?.name || (assets ? tftTraitDisplayName(assets, id) : id);
}
export function unitImg(o: ExplorerOptions, assets: TftAssetsBundle | null, id: string): string | null {
  return o.unitById.get(id)?.img ?? (assets ? tftChampionTileUrl(assets, assets.champions[id]) : null);
}
export function itemImg(o: ExplorerOptions, assets: TftAssetsBundle | null, id: string): string | null {
  return o.itemById.get(id)?.img ?? (assets ? tftIconUrl(assets, assets.items[id]?.icon) : null);
}
export function traitImg(o: ExplorerOptions, assets: TftAssetsBundle | null, id: string): string | null {
  return o.traitById.get(id)?.img ?? (assets ? tftIconUrl(assets, assets.traits[id]?.icon) : null);
}
// Stufe (1-basiert) → benoetigte Units, z. B. Stufe 2 von [2,4,6] → 4.
export function traitMin(o: ExplorerOptions, assets: TftAssetsBundle | null, id: string, lvl: number): number | null {
  const mins = o.traitById.get(id)?.mins
    ?? (assets?.traits[id]?.tiers || []).map(x => Number(x.minUnits));
  const v = mins[lvl - 1];
  return Number.isFinite(v) ? v : null;
}

// Zahlen fuer Anzeige und CSV.
export const fmtAvg = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));
export const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
export const fmtDelta = (v: number | null | undefined) =>
  v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(2)}`;
