// Item-Regeln des Comp-Builders: was darf auf eine Unit, und welche Synergie
// gibt ein Emblem. Eigene Datei statt page.tsx, damit die Regeln testbar sind
// (tft-builder-items.test.mjs).
//
// Quellen:
// - unique / slots kommen aus public/tft-item-texts-{set}.json (Riots Text
//   "Unique - only 1 per champion" bzw. "[Consumes 3 item slots.]", beim Holen
//   in scripts/refresh-item-texts.mjs ausgelesen).
// - Emblem → Synergie ueber den Anzeigenamen ("Ravager Emblem" → Synergie
//   "Ravager"). NICHT ueber die ID: DA_18_EmblemSlayer heisst "Ravager Emblem",
//   und bei FloraFatalis/Juggernaut/Primal bricht das ID-Schema (Synergie
//   DA_FloraFatalis18 usw.) — gemessen 18.10.2026, 20 von 20 ueber den Namen.

import type { TftAssetsBundle } from './tft-cdragon';
import type { ItemTexts } from './tft-item-texts';

export const MAX_ITEMS_PER_UNIT = 3;

// Altlasten im Radiant-Reiter: stehen in active.items (fetch-tft-assets nimmt
// TFT5_*Radiant und RadiantVirtue ohne Spielnachweis auf), kommen aber in
// 16,24 Mio Set-18-Brettern des Data Explorers nicht vor (< 5 Bretter,
// gemessen 18.10.2026). Die uebrigen Reste (Phantom-Emblem, Artifactinate)
// fallen ueber die Regeln unten ohne Liste raus.
export const RETIRED_ITEM_IDS: ReadonlySet<string> = new Set([
  'TFT5_Item_ZzRotPortalRadiant',
  'TFT_Item_RadiantVirtue',
]);

// Rueckfall, falls die Textdatei fehlt (gleiches Muster wie
// THIEFS_GLOVES_RE in scripts/lib/tft-build-aggregator.mjs).
const THIEFS_GLOVES_RE = /thiefsgloves/i;

const traitNamesCache = new WeakMap<object, Set<string>>();
function traitNames(bundle: TftAssetsBundle): Set<string> {
  let s = traitNamesCache.get(bundle);
  if (!s) {
    s = new Set(Object.values(bundle.traits || {}).map((t: any) => String(t?.name || '')).filter(Boolean));
    traitNamesCache.set(bundle, s);
  }
  return s;
}

// Anzeigename der Synergie, die ein Emblem gibt; null fuer alles andere.
// Ein "Emblem" ohne passende Synergie im Bundle (Phantom Emblem, eine
// Set-18-Mechanik) ist kein ausruestbares Emblem.
export function emblemTraitOf(bundle: TftAssetsBundle | null, itemId: string): string | null {
  const name = bundle?.items?.[itemId]?.name;
  if (!bundle || !name || !/ Emblem$/.test(name)) return null;
  const trait = name.slice(0, -' Emblem'.length);
  return traitNames(bundle).has(trait) ? trait : null;
}

// Anzeigenamen der eigenen Synergien einer Unit. Im Bundle stehen sie je nach
// Set als Name oder als Kennung — beides wird auf den Namen gebracht.
export function championTraitNames(bundle: TftAssetsBundle | null, characterId: string): string[] {
  const champ: any = bundle?.champions?.[characterId];
  if (!bundle || !Array.isArray(champ?.traits)) return [];
  return champ.traits.map((t: string) => (bundle.traits as any)?.[t]?.name || t);
}

export function itemSlots(texts: ItemTexts | null, itemId: string): number {
  const s = texts?.items?.[itemId]?.slots;
  if (typeof s === 'number' && s > 0) return s;
  return THIEFS_GLOVES_RE.test(itemId) ? MAX_ITEMS_PER_UNIT : 1;
}

export function slotsUsed(texts: ItemTexts | null, items: readonly string[]): number {
  return items.reduce((n, id) => n + itemSlots(texts, id), 0);
}

export type ItemBlock = 'full' | 'unique' | 'emblem' | null;

// Warum ein Item NICHT auf die Unit darf; null = erlaubt.
//   full   — Plaetze belegt (Thief's Gloves zaehlt 3, passt also nur auf eine leere Unit)
//   unique — "nur 1 pro Champion" und schon drauf
//   emblem — die Unit hat die Synergie schon (eigene oder durch ein Emblem)
export function itemBlock(
  bundle: TftAssetsBundle | null,
  texts: ItemTexts | null,
  unit: { characterId: string; items: readonly string[] },
  itemId: string,
): ItemBlock {
  if (slotsUsed(texts, unit.items) + itemSlots(texts, itemId) > MAX_ITEMS_PER_UNIT) return 'full';
  if (texts?.items?.[itemId]?.unique && unit.items.includes(itemId)) return 'unique';
  const trait = emblemTraitOf(bundle, itemId);
  if (trait) {
    if (championTraitNames(bundle, unit.characterId).includes(trait)) return 'emblem';
    if (unit.items.some(id => emblemTraitOf(bundle, id) === trait)) return 'emblem';
  }
  return null;
}
