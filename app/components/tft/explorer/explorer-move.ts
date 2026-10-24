// Ziehen & Ablegen der gewaehlten Bausteine (Plan 24.10.2026, W3). Reine
// Funktion: neue Anfrage oder null, wenn die Ablage nicht geht. null statt
// still kuerzen — parseExplorerParams wuerfe Doppelte und Ueberzaehlige beim
// Rundweg ueber die Adresse stumm weg, der Baustein waere einfach verschwunden.
// Eine Ablage = eine Umformung = ein setQuery.
import {
  EXPLORER_LIMITS, filterCount, groupSize,
  type ExplorerQuery, type FilterGroup, type ItemFilter, type TraitFilter, type UnitFilter,
} from '../../../lib/tft-explorer-query';

/** Hauptliste oder Kasten g. */
export type Where = 'main' | number;
export type ChipKind = 'units' | 'items' | 'traits';

export type DragSrc =
  /** Baustein-Chip (Unit, Item, Synergie). */
  | { kind: ChipKind; id: string; from: Where }
  /** Item-Bild an einem Unit-Chip; index, weil ein Item zweimal an der Unit stehen darf. */
  | { kind: 'unitItem'; unit: string; from: Where; index: number };

export type DropTarget =
  /** Auf einen Unit-Chip: Items haengen sich an, alles andere landet in seinem Kasten. */
  | { kind: 'unit'; id: string; at: Where }
  /** Freie Flaeche der Hauptzeile oder eines Kastens (auch Item-/Synergie-Chips darin). */
  | { kind: 'zone'; at: Where };

/** Spielregel je Item an einer Unit (itemFitsUnit). */
export type Fits = (unitId: string, itemId: string, carried: string[]) => boolean;

type Box = { units: UnitFilter[]; items: ItemFilter[]; traits: TraitFilter[] };
type Entry = { id: string; x?: boolean };

const LIMIT: Record<ChipKind, number> = { units: EXPLORER_LIMITS.units, items: EXPLORER_LIMITS.items, traits: EXPLORER_LIMITS.traits };
const MAX_UNIT_ITEMS = 3;

const listOf = (b: Box, k: ChipKind) => b[k] as Entry[];
const setList = (b: Box, k: ChipKind, l: Entry[]) => { (b as Record<ChipKind, Entry[]>)[k] = l; };

export function moveFilter(q: ExplorerQuery, src: DragSrc, target: DropTarget, fits?: Fits): ExplorerQuery | null {
  const main: Box = { units: [...q.units], items: [...q.items], traits: [...q.traits] };
  const groups: FilterGroup[] = q.groups.map(g => ({ ...g, units: [...g.units], items: [...g.items], traits: [...g.traits] }));
  // „keins davon"-Kaesten (nur aus alten Links) sind weder Quelle noch Ziel.
  const boxAt = (w: Where): Box | null => (w === 'main' ? main : groups[w]?.m === 'any' ? groups[w] : null);
  const from = boxAt(src.from);
  const to = boxAt(target.at);
  if (!from || !to) return null;
  // Platz fuer ein weiteres Glied im Ziel?
  const room = (k: ChipKind) => (target.at === 'main' ? listOf(to, k).length < LIMIT[k] : groupSize(to as FilterGroup) < EXPLORER_LIMITS.groupMembers);

  // Item an die Unit am Ziel haengen; null, wenn sie es nicht tragen kann.
  const attach = (itemId: string): boolean => {
    if (target.kind !== 'unit') return false;
    const u = to.units.find(x => x.id === target.id);
    if (!u || u.x) return false;
    const it = u.it ?? [];
    if (it.length >= MAX_UNIT_ITEMS || (u.nx != null && it.length + 1 > u.nx) || (u.nit ?? []).includes(itemId)) return false;
    if (fits && !fits(u.id, itemId, it)) return false;
    to.units = to.units.map(x => (x === u ? { ...x, it: [...it, itemId] } : x));
    return true;
  };

  if (src.kind === 'unitItem') {
    const s = from.units.find(u => u.id === src.unit);
    const itemId = s?.it?.[src.index];
    if (!s || s.x || !itemId) return null;
    if (target.kind === 'unit' && target.id === src.unit && target.at === src.from) return null;
    const it = (s.it ?? []).filter((_, i) => i !== src.index);
    const stripped: UnitFilter = { ...s, it };
    if (!it.length) delete stripped.it;
    if (target.kind === 'zone') {
      // Aufs Brett: wird eigenes Item der Hauptzeile bzw. Glied des Kastens.
      if (to.items.some(i => i.id === itemId) || !room('items') || filterCount(q) >= EXPLORER_LIMITS.total) return null;
      from.units = from.units.map(u => (u === s ? stripped : u));
      to.items = [...to.items, { id: itemId }];
    } else {
      from.units = from.units.map(u => (u === s ? stripped : u));
      if (!attach(itemId)) return null;
    }
  } else {
    const f = listOf(from, src.kind).find(x => x.id === src.id);
    if (!f || f.x) return null;
    if (src.kind === 'items' && target.kind === 'unit') {
      // Brett-Item an eine Unit: „≥2 auf dem Brett" faellt dabei weg.
      from.items = from.items.filter(i => i !== f);
      if (!attach(src.id)) return null;
    } else {
      if (target.at === src.from) return null;
      if (listOf(to, src.kind).some(x => x.id === src.id) || !room(src.kind)) return null;
      setList(from, src.kind, listOf(from, src.kind).filter(x => x !== f));
      setList(to, src.kind, [...listOf(to, src.kind), f]);
    }
  }

  return {
    ...q,
    units: main.units, items: main.items, traits: main.traits,
    // Leer gewordene Kaesten fallen weg (die Nummern danach ruecken auf).
    groups: groups.filter(g => groupSize(g) > 0),
  };
}
