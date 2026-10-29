import 'server-only';
// Δ-Vergleich „vs Vorpatch" (tft-patch-delta.ts), Server-Teil: beide Seiten aus
// den Dateien der Box lesen. Teilen sich /api/tft/patch-diff?full=1 (alle
// Regionen) und die Startdaten der Comp-Uebersicht (seo/initial-data.ts) — die
// Uebersicht zeigt ihre Pfeile so schon im ersten HTML, mit denselben Zahlen,
// die der Browser von der Route bekaeme.
import { loadPatchDiff } from './meta-pulse-diff-snapshot';
import { compAssignForPair } from './comp-assign-server';
import { PATCH_DIFF_BUCKETS, type CompAssign, type CompPatchDays, type PatchDiffEntity, type PatchDiffRow } from './snapshot-matrix';
import type { PatchInfo } from './tft-filters';
import type { PatchDeltaRow } from './tft-patch-delta';

/** Kompakte Zeile: Schluessel, (Trait-)Stufe, Spiele, Ø-Platz auf 4 Stellen. */
export const compactDeltaRows = (rows: readonly PatchDiffRow[]): PatchDeltaRow[] =>
  rows.filter(r => r.games > 0).map(r => ({
    k: r.key,
    ...(r.level != null ? { l: r.level } : {}),
    g: r.games,
    a: Math.round((r.sum_placement / r.games) * 10000) / 10000,
  }));

/** Beide Seiten; bei Comps mit ihrer Zaehlart. 'assign' = Comp-Seiten zaehlen
 *  verschieden (compDeltaAssign) → kein Vergleich. */
export type PatchDeltaBlobs =
  | { kind: 'rows'; current: PatchDiffRow[]; previous: PatchDiffRow[]; assign?: CompAssign }
  | { kind: 'assign' };

/**
 * Beide Patch-Seiten fuer alle Regionen aus den Dateien der Box. null, wenn
 * eine Seite fehlt oder (noch) nicht passt — z. B. Trait-Dateien von vor dem
 * 18.10.2026 ohne Stufe, die die Box erst stuendlich nach und nach ersetzt.
 * `current`/`previous` muessen aus get_tft_available_patches(180) stammen: die
 * Pruefung vergleicht letzten Tag und Matchzahl, und die 30-Tage-Liste schneidet
 * aeltere Patches ab. Comps: beide Seiten in derselben Zaehlart
 * (comp-assign-server.ts); sind die Katalog-Tage nicht lesbar → null.
 */
export async function loadPatchDeltaBlobs(o: {
  entity: PatchDiffEntity;
  regions: ReadonlyArray<string>;
  bucketLabel: string;
  current: PatchInfo;
  previous: PatchInfo;
  newestPatch: string;
}): Promise<PatchDeltaBlobs | null> {
  const buckets = PATCH_DIFF_BUCKETS[o.bucketLabel];
  if (!buckets) return null;
  const set = Number(o.current.set_number);
  let comp: { assign: CompAssign; days: [CompPatchDays, CompPatchDays] } | null = null;
  if (o.entity === 'comp') {
    const pair = await compAssignForPair(set, o.regions, o.current.patch, o.previous.patch);
    if (!pair) return null;
    if (!pair.assign) return { kind: 'assign' };
    comp = { assign: pair.assign, days: [pair.current, pair.previous] };
  }
  const [c, p] = await Promise.all([o.current, o.previous].map((info, i) => loadPatchDiff({
    entity: o.entity, regions: o.regions, bucketLabel: o.bucketLabel, buckets,
    patch: info, set, closed: info.patch !== o.newestPatch,
    ...(comp ? { assign: comp.assign, days: comp.days[i] } : {}),
  })));
  const usable = (rows: PatchDiffRow[] | null) =>
    rows && (o.entity !== 'trait' || rows.every(r => r.level != null)) ? rows : null;
  const cu = usable(c);
  const pu = usable(p);
  return cu && pu ? { kind: 'rows', current: cu, previous: pu, ...(comp ? { assign: comp.assign } : {}) } : null;
}
