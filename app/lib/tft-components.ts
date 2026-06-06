// W1-B: Komponent-Priorität pro Comp.
//
// Deterministic mapping `crafted item → 2 components` aus dem CDragon
// Asset-Bundle. Wird genutzt um aus den Top-Item-Sets einer Comp eine
// Bauteil-Priorisierung abzuleiten — Pro-Frage „welches Bauteil greife ich
// im Carousel zuerst?" beantwortet sich aus den finalen Items + Recipes.
//
// Wichtige Eigenschaft: KEIN Stats-Crawl, KEIN Recipe-Override, rein aus
// public/tft-assets.json — bricht nicht, wenn Riot Itemrezepte ändert
// (das Bundle wird ohnehin per fetch-tft-assets.mjs aktualisiert).

import type { TftAssetsBundle } from './tft-cdragon';

export interface ComponentAggregate {
  component: string;     // component apiName, z.B. "TFT_Item_BFSword"
  weight: number;        // 0-1 normalisierter Anteil über alle Top-Item-Sets
  fromItems: string[];   // crafted items, die dieses Bauteil brauchen (sortiert nach count)
}

// Carry-Item-Sets, wie sie von /api/tft/comps in `carryItems` ankommen.
// Jeder Eintrag = ein konkretes 3-Item-Set + wie oft beobachtet.
export interface CarryItemSet {
  items: string[];   // 1-3 item apiNames
  count: number;
}

// Lookup: ist `apiName` ein Basis-Bauteil? Die Component-Tabelle ist klein
// (~10 Einträge pro Set + Tutorial-Duplikate); ein einmaliges Set reicht.
let _componentSetCache: WeakMap<TftAssetsBundle, Set<string>> | null = null;
function componentSet(assets: TftAssetsBundle): Set<string> {
  if (!_componentSetCache) _componentSetCache = new WeakMap();
  let s = _componentSetCache.get(assets);
  if (!s) {
    s = new Set<string>();
    for (const [apiName, it] of Object.entries(assets.items)) {
      if (Array.isArray(it.tags) && it.tags.includes('component')) s.add(apiName);
    }
    _componentSetCache.set(assets, s);
  }
  return s;
}

// Helper: returns the 2 components a crafted item needs, or null if the item
// isn't craftable (component itself, augment-like, radiant, etc).
export function componentsForItem(apiName: string, assets: TftAssetsBundle): [string, string] | null {
  const item = assets.items[apiName];
  if (!item) return null;
  const comp = item.composition;
  if (!Array.isArray(comp) || comp.length !== 2) return null;
  return [comp[0], comp[1]];
}

// Main aggregator: takes the comp's top item-sets (per-carry) and rolls up
// every needed component, weighted by how often each item-set appeared.
//
// Returns components sorted by weight desc, top N. Each entry carries the
// items that contributed (UI uses this in the tooltip: "verbaut in BT, IE").
export function aggregateComponents(
  itemSets: CarryItemSet[],
  assets: TftAssetsBundle | null,
  topN = 6,
): ComponentAggregate[] {
  if (!assets || !Array.isArray(itemSets) || itemSets.length === 0) return [];
  const components = componentSet(assets);
  const totals = new Map<string, { weight: number; fromItems: Map<string, number> }>();
  let grandTotal = 0;
  for (const set of itemSets) {
    const w = Number(set?.count) || 0;
    if (w <= 0 || !Array.isArray(set.items)) continue;
    for (const item of set.items) {
      // Component used directly (some carries equip raw Spatula etc.)
      if (components.has(item)) {
        addContribution(totals, item, item, w);
        grandTotal += w;
        continue;
      }
      const recipe = componentsForItem(item, assets);
      if (!recipe) continue;
      addContribution(totals, recipe[0], item, w);
      addContribution(totals, recipe[1], item, w);
      grandTotal += 2 * w;  // each crafted item contributes to 2 components
    }
  }
  if (grandTotal <= 0) return [];
  const rows: ComponentAggregate[] = [];
  for (const [comp, v] of totals) {
    const itemsSorted = [...v.fromItems.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    rows.push({ component: comp, weight: v.weight / grandTotal, fromItems: itemsSorted });
  }
  rows.sort((a, b) => b.weight - a.weight);
  return rows.slice(0, topN);
}

function addContribution(
  totals: Map<string, { weight: number; fromItems: Map<string, number> }>,
  component: string,
  fromItem: string,
  weight: number,
) {
  let entry = totals.get(component);
  if (!entry) {
    entry = { weight: 0, fromItems: new Map() };
    totals.set(component, entry);
  }
  entry.weight += weight;
  entry.fromItems.set(fromItem, (entry.fromItems.get(fromItem) || 0) + weight);
}
