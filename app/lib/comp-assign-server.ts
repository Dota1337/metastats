import 'server-only';
// Tage je Patch und Zaehlart (Comp-Katalog Phase 3, Migration 0102; klassische
// Tage seit 0107): daraus waehlen Patch-Vergleich und Meta Pulse die Zaehlart
// beider Seiten (compDeltaSides in snapshot-matrix.ts — die Fassungen je Patch
// rechnet die Box). Kleine Abfrage auf tft_daily_crawl_meta, 10 min je Set und Regionen
// gemerkt: ein Marker kommt einmal am Tag je Region dazu, und eine Katalog-Datei
// mit mehr Tagen als gemerkt gilt trotzdem (compMarkedBehind prueft nur „zu wenige“).
import { callRpc } from './tft-supabase-reader';
import { compDeltaSides, listKey, type CompAssign, type CompPatchDays } from './snapshot-matrix';

const TTL_MS = 10 * 60 * 1000;
const ERROR_TTL_MS = 60 * 1000;
const cache = new Map<string, { at: number; ttl: number; value: Promise<Map<string, CompPatchDays> | null> }>();

/** Ohne Eintrag: keine Tage bekannt (compDeltaAssign behandelt das wie klassisch). */
export const NO_COMP_DAYS: CompPatchDays = { marked: 0, classic: 0 };

/** Katalog- und klassische Tage (Region×Tage) je Patch-Label; null bei Fehler. */
export function compMarkedDays(set: number, regions: ReadonlyArray<string>): Promise<Map<string, CompPatchDays> | null> {
  const key = `${set}|${listKey(regions)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const entry = { at: Date.now(), ttl: TTL_MS, value: null as unknown as Promise<Map<string, CompPatchDays> | null> };
  entry.value = callRpc<{ patch: string; marked_days: number; region_days: number }[]>('get_tft_comp_marked_days', { p_set: set, p_regions: [...regions] })
    .then(rows => new Map((Array.isArray(rows) ? rows : []).map(r => {
      const marked = Number(r.marked_days) || 0;
      return [String(r.patch), { marked, classic: Math.max(0, (Number(r.region_days) || 0) - marked) }];
    })))
    .catch(() => { entry.ttl = ERROR_TTL_MS; return null; });
  cache.set(key, entry);
  if (cache.size > 64) cache.delete(cache.keys().next().value as string);
  return entry.value;
}

/** Ein Patch, den eine Vergleichs-Seite liest, mit seinen Tagen. */
export interface CompSide {
  patch: string;
  days: CompPatchDays;
}

export interface CompAssignPair {
  /** null = kein Vergleich (auch die Patch-Familien haben nichts Gleiches). */
  assign: CompAssign | null;
  current: CompSide[];
  previous: CompSide[];
}

/**
 * Zaehlart eines Comp-Vergleichs und die Patches je Seite (compDeltaSides); null,
 * wenn die Tage nicht lesbar sind.
 */
export async function compAssignForPair(
  set: number,
  regions: ReadonlyArray<string>,
  current: string,
  previous: string,
): Promise<CompAssignPair | null> {
  const days = await compMarkedDays(set, regions);
  if (!days) return null;
  const sides = compDeltaSides(days, current, previous);
  if (!sides) return { assign: null, current: [], previous: [] };
  const withDays = (list: string[]) => list.map(patch => ({ patch, days: days.get(patch) ?? NO_COMP_DAYS }));
  return { assign: sides.assign, current: withDays(sides.current), previous: withDays(sides.previous) };
}
