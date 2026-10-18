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
import { BOARD_CELLS, MAX_ITEMS_PER_UNIT } from './tft-board';

export { BOARD_CELLS, MAX_ITEMS_PER_UNIT };

// Brettgrenze: 10 Plaetze auf Stufe 10, je Tactician-Item (+1 maximale
// Teamgroesse, Crown/Cape/Shield) ein Platz mehr. Jedes Item zaehlt einzeln,
// auch zwei gleiche auf einer Unit — die Items tragen keinen Vermerk "Unique -
// only 1 per champion" (Textdatei). Eine Obergrenze nennt keine Quelle,
// also gilt die echte Brettgroesse (BOARD_CELLS).
export const TEAM_SIZE_BASE = 10;

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
// Rueckfall fuer teamSize, eng gefasst: das Bundle hat 14 Tactician-Kennungen,
// darunter das Augment DA_TacticiansKitchen (node-Probe 18.10.2026).
const TACTICIAN_RE = /Tacticians(?:Cape|Crown|Shield)$/;

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

// Zusaetzliche Brettplaetze durch ein Item ("+1 maximum team size").
export function itemTeamSize(texts: ItemTexts | null, itemId: string): number {
  const n = texts?.items?.[itemId]?.teamSize;
  if (typeof n === 'number' && n > 0) return n;
  return TACTICIAN_RE.test(itemId) ? 1 : 0;
}

export interface BoardUnit { characterId: string; items: readonly string[] }
// Uebersetzt einen Platzhalter-Trait (Set 17: Miss Fortunes Haltung); null =
// der Platz zaehlt fuer keine Synergie.
export type TraitResolver<P extends BoardUnit> = (p: P, rawTrait: string) => string | null;

// Sonderregeln aus Trait-Texten, Set 18: "Elder Dragon takes up 2 team slots
// and grants +2 to the Riftbeast trait." Gilt nur fuer die Unit mit diesem
// Namen UND dieser Synergie — TFT_ElderDragon heisst gleich, hat aber keine.
// "+2" heisst "zaehlt als 2", nicht 1 + 2: in 17 von 17 Elder-Brettern aus 30
// EUW-Spielen (Riot, 18.10.2026) war Riftbeast num_units = Riftbeast-Units + 1,
// Units = Stufe − 1. Nur Trait-Texte: "team slot" steht auch im Augment The
// Golden Dragon und bei den Set-17-Mechas, beides bildet der Builder nicht ab.
const SLOTS_RE = /^\s*(.+?) takes up (\d+) team slots?/i;
const GRANTS_RE = /grants \+(\d+) to the (.+?) trait/i;

interface UnitRule { slots: number; traits: Map<string, number> }
const unitRulesCache = new WeakMap<object, Map<string, UnitRule>>();
function unitRules(bundle: TftAssetsBundle): Map<string, UnitRule> {
  let m = unitRulesCache.get(bundle);
  if (m) return m;
  m = new Map();
  const names = traitNames(bundle);
  for (const t of Object.values(bundle.traits || {}) as any[]) {
    const desc = String(t?.desc || '');
    const hit = desc.match(SLOTS_RE);
    if (!hit || !t?.name) continue;
    const grant = desc.match(GRANTS_RE);
    for (const [cid, c] of Object.entries(bundle.champions || {}) as [string, any][]) {
      if (c?.name !== hit[1].trim() || !championTraitNames(bundle, cid).includes(t.name)) continue;
      const traits = new Map<string, number>();
      if (grant && names.has(grant[2])) traits.set(grant[2], Number(grant[1]));
      m.set(cid, { slots: Math.max(1, Number(hit[2])), traits });
    }
  }
  unitRulesCache.set(bundle, m);
  return m;
}

// Brettplaetze einer Unit (Standard 1, Elder Dragon 2).
export function unitTeamSlots(bundle: TftAssetsBundle | null, characterId: string): number {
  return (bundle && unitRules(bundle).get(characterId)?.slots) || 1;
}

export function teamSlotsUsed(bundle: TftAssetsBundle | null, placements: readonly { characterId: string }[]): number {
  let n = 0;
  for (const p of placements) n += unitTeamSlots(bundle, p.characterId);
  return n;
}

// Synergie-Zaehler eines Bretts (Anzeigename → Zahl) wie im Spiel: jeder
// Champion je Synergie nur einmal, auch wenn das Emblem auf der zweiten Kopie
// liegt (Riots num_units, Probe tft-domain-expert 18.10.2026); Embleme geben
// ihre Synergie dazu; Elder Dragon zaehlt fuer Riftbeast als 2.
export function boardTraitCounts<P extends BoardUnit>(
  bundle: TftAssetsBundle | null,
  placements: readonly P[],
  resolve?: TraitResolver<P>,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (!bundle) return counts;
  const emblemTraits = new Map<string, Set<string>>();
  for (const p of placements) {
    for (const iid of p.items) {
      const tr = emblemTraitOf(bundle, iid);
      if (!tr) continue;
      if (!emblemTraits.has(p.characterId)) emblemTraits.set(p.characterId, new Set());
      emblemTraits.get(p.characterId)!.add(tr);
    }
  }
  const rules = unitRules(bundle);
  const seen = new Set<string>();
  for (const p of placements) {
    if (seen.has(p.characterId)) continue;
    seen.add(p.characterId);
    const champ: any = bundle.champions?.[p.characterId];
    const names = new Set<string>();
    for (const rawTrait of champ?.traits || []) {
      const tr = resolve ? resolve(p, rawTrait) : rawTrait;
      if (!tr) continue;
      const meta: any = (bundle.traits as any)?.[tr] || Object.values(bundle.traits || {}).find((m: any) => m.name === tr);
      names.add(meta?.name || tr);
    }
    for (const tr of emblemTraits.get(p.characterId) || []) names.add(tr);
    const weights = rules.get(p.characterId)?.traits;
    for (const n of names) counts.set(n, (counts.get(n) || 0) + (weights?.get(n) ?? 1));
  }
  return counts;
}

// Brettplaetze durch aktive Synergie-Stufen (Riftbeast 10: +2). Nur Synergien,
// deren Text den Wert als Teamgroesse nennt ("+@TeamSize@ maximum team size").
const TEAM_SIZE_TEXT_RE = /\+@TeamSize@ max(?:imum)? team size/i;
export function traitTeamSize(bundle: TftAssetsBundle | null, counts: ReadonlyMap<string, number>): number {
  if (!bundle) return 0;
  let n = 0;
  for (const t of Object.values(bundle.traits || {}) as any[]) {
    if (!TEAM_SIZE_TEXT_RE.test(String(t?.desc || ''))) continue;
    const count = counts.get(t.name) || 0;
    const tiers: any[] = t.tiers || [];
    for (let i = tiers.length - 1; i >= 0; i--) {
      if (count < (tiers[i]?.minUnits ?? Infinity)) continue;
      const v = Number(tiers[i]?.variables?.TeamSize);
      if (v > 0) n += v;
      break;
    }
  }
  return n;
}

// Wie viele Plaetze ein Brett hat: Basis plus alle Tactician-Items und aktive
// Synergie-Stufen mit Teamgroesse auf diesem Brett, hoechstens die
// Brettgroesse. Ohne Bundle zaehlen nur die Items.
export function teamLimit<P extends BoardUnit>(
  texts: ItemTexts | null,
  placements: readonly P[],
  bundle: TftAssetsBundle | null = null,
  resolve?: TraitResolver<P>,
): number {
  let bonus = 0;
  for (const p of placements) for (const id of p.items) bonus += itemTeamSize(texts, id);
  bonus += traitTeamSize(bundle, boardTraitCounts(bundle, placements, resolve));
  return Math.min(BOARD_CELLS, TEAM_SIZE_BASE + bonus);
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
