import 'server-only';
// Katalog-Tage je Patch (Comp-Katalog Phase 3, Migration 0102): daraus waehlen
// Patch-Vergleich und Meta Pulse die Zaehlart beider Seiten (compDeltaAssign in
// snapshot-matrix.ts — dieselbe Regel rechnet die Box). Kleine Abfrage auf
// tft_daily_crawl_meta, 10 min je Set und Regionen gemerkt: ein Marker kommt
// einmal am Tag je Region dazu, und eine Katalog-Datei mit mehr Tagen als
// gemerkt gilt trotzdem (compMarkedBehind prueft nur „zu wenige“).
import { callRpc } from './tft-supabase-reader';
import { compDeltaAssign, listKey, type CompAssign } from './snapshot-matrix';

const TTL_MS = 10 * 60 * 1000;
const ERROR_TTL_MS = 60 * 1000;
const cache = new Map<string, { at: number; ttl: number; value: Promise<Map<string, number> | null> }>();

/** Katalog-Tage (Region×Tage) je Patch-Label; null bei Fehler. */
export function compMarkedDays(set: number, regions: ReadonlyArray<string>): Promise<Map<string, number> | null> {
  const key = `${set}|${listKey(regions)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const entry = { at: Date.now(), ttl: TTL_MS, value: null as unknown as Promise<Map<string, number> | null> };
  entry.value = callRpc<{ patch: string; marked_days: number }[]>('get_tft_comp_marked_days', { p_set: set, p_regions: [...regions] })
    .then(rows => new Map((Array.isArray(rows) ? rows : []).map(r => [String(r.patch), Number(r.marked_days) || 0])))
    .catch(() => { entry.ttl = ERROR_TTL_MS; return null; });
  cache.set(key, entry);
  if (cache.size > 64) cache.delete(cache.keys().next().value as string);
  return entry.value;
}

export interface CompAssignPair {
  /** null = kein Vergleich (die Seiten zaehlen verschieden). */
  assign: CompAssign | null;
  markedCurrent: number;
  markedPrevious: number;
}

/** Zaehlart eines Comp-Vergleichs; null, wenn die Katalog-Tage nicht lesbar sind. */
export async function compAssignForPair(
  set: number,
  regions: ReadonlyArray<string>,
  current: string,
  previous: string,
): Promise<CompAssignPair | null> {
  const marked = await compMarkedDays(set, regions);
  if (!marked) return null;
  const markedCurrent = marked.get(current) ?? 0;
  const markedPrevious = marked.get(previous) ?? 0;
  return { assign: compDeltaAssign(markedCurrent, markedPrevious), markedCurrent, markedPrevious };
}
