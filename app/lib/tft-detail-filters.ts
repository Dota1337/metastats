// Filter der TFT-Detailseiten (Unit, Item, Trait), aus der Adresse gelesen.
// Eigenes Modul ohne 'use client': Server-Seite (Startdaten, SEO-Plan
// Schritt 5) und Browser muessen dieselben Werte bilden — sonst passt der
// Startdaten-Schluessel nicht und der Browser laedt trotzdem nach.
import { tierBucketFromParam, type TierBucket } from './tft-tier-bucket';
import { tftStatsBucket } from './rank-groups';
import { parseClusterKey } from './tft-cluster';
import type { TftAssetsBundle, TftItem } from './tft-cdragon';

interface ParamReader { get(name: string): string | null }

/** Unit-/Item-Detail: Rang (Auswahl auf der Seite), Region und Zeitraum aus der Liste (Standard wie dort). */
export interface DetailFilters { region: string; bucket: TierBucket; days: number }

export function detailFiltersFrom(sp: ParamReader): DetailFilters {
  return {
    region: sp.get('region') || 'all',
    bucket: tierBucketFromParam(sp.get('bucket')),
    days: Math.max(1, Math.min(7, parseInt(sp.get('days') || '3', 10) || 3)),
  };
}

/** Trait-Detail: kein Rang-Schalter, Rang und Region nur aus der Adresse. */
export interface TraitFilters { region: string; bucket: string }

export function traitFiltersFrom(sp: ParamReader): TraitFilters {
  return { region: sp.get('region') || 'all', bucket: tftStatsBucket(sp.get('bucket') || 'master_plus') };
}

/** Schluessel der gezeigten Daten: gleich → kein Abruf. */
export function detailKey(id: string, f: { region: string; bucket: string; days?: number }): string {
  return `${id}|${f.region}|${f.bucket}|${f.days ?? ''}`;
}

export interface TraitIds {
  /** Anzeigename (Liste und Units verlinken ihn). */
  display: string;
  /** Alle Kennungen mit diesem Anzeigenamen (Set 18: genau eine). */
  ids: string[];
  /** Kennung fuer /api/tft/trait-unitcount (nimmt genau eine). */
  unitCountName: string;
}

/**
 * Pfad der Trait-Seite → Kennungen (E4). Der Pfad ist je nach Herkunft die
 * Kennung (`DA_18_Elderwood`, Comp-Seiten) oder der Anzeigename (`Elderwood`,
 * Trait-Liste, Unit-Seiten). Die Statistik-Zeilen tragen die Kennung, die
 * Champion-Eintraege im Bundle den Anzeigenamen.
 */
export function traitIdsForParam(traits: TftAssetsBundle['traits'] | null | undefined, param: string): TraitIds {
  const direct = traits?.[param];
  const display = direct?.name || param;
  const ids = traits ? Object.keys(traits).filter(k => traits[k]?.name === display) : [];
  if (direct && !ids.includes(param)) ids.unshift(param);
  if (ids.length === 0) ids.push(param);
  return { display, ids, unitCountName: direct ? param : rootVariantId(ids) };
}

/**
 * Wurzel-Variante einer Trait-Familie (`TFT17_Stargazer` ohne Zusatz wie
 * `_Wolf`), sonst die erste — dieselbe Regel wie die Kopfzeile der Seite.
 */
function rootVariantId(ids: string[]): string {
  return ids.find(k => !/_\w+$/.test(k.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, ''))) || ids[0];
}

// ---------- Auswahl aus den Listen-Zeilen ----------
// Server (Startdaten) und Browser (nach einem Filterwechsel) waehlen hier
// dieselben Zeilen aus. Wichen sie ab, zeigte die Seite fuer denselben Filter
// je nach Weg andere Comps — und fragt die Startdaten nie neu ab.

interface CompRow {
  clusterKey?: string;
  typicalUnits?: { characterId?: string }[];
  carryItems?: { items?: string[] }[];
}

/** Unit-Detail: die ersten 6 Comps mit der Unit im typischen Board. */
export function compsWithUnit<T extends CompRow>(rows: T[], id: string): T[] {
  return rows.filter(c => (c.typicalUnits || []).some(u => u.characterId === id)).slice(0, 6);
}

/** Item-Detail: ALLE Comps, deren Carry-Items das Item enthalten (die Seite rechnet daraus Combos). */
export function compsWithItem<T extends CompRow>(rows: T[], id: string): T[] {
  return rows.filter(c => (c.carryItems || []).some(ci => (ci.items || []).includes(id)));
}

/**
 * Trait-Detail: die ersten 6 Comps, deren Haupt-Trait eine dieser Kennungen
 * ist (E4: exakter Treffer — vorher traf ein Praefix alle Traits des Sets).
 */
export function compsOfTrait<T extends CompRow>(rows: T[], ids: string[]): T[] {
  const idSet = new Set(ids);
  return rows.filter(c => idSet.has(parseClusterKey(c.clusterKey || '')?.trait ?? '')).slice(0, 6);
}

/**
 * Item-Detail, „gleiche Bauteile“: Items, die Riot im Set anbietet
 * (active.items) und mindestens eine Komponente teilen, die ersten 12 in
 * Bundle-Reihenfolge. Ohne `_Corrupted`-Doppel und ohne Items, deren Name
 * noch ein unaufgeloester CDragon-Schluessel ist.
 */
export function sharedComponentItems(
  items: TftAssetsBundle['items'],
  activeItems: string[] | undefined,
  id: string,
  composition: string[],
): [string, TftItem][] {
  if (composition.length === 0) return [];
  const active = new Set(activeItems ?? []);
  return Object.entries(items)
    .filter(([k, v]) =>
      k !== id &&
      active.has(k) &&
      !/Corrupted/i.test(k) &&
      !/^tft_item_name_/i.test(v.name || '') &&
      !!v.composition &&
      v.composition.some(c => composition.includes(c)),
    )
    .slice(0, 12);
}
