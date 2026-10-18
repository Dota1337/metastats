// Δ-Vergleich der Statistik-Listen (Comps, Units, Items, Traits): der ganze
// gewaehlte Patch gegen den ganzen Vorpatch, unabhaengig vom Tage-Filter
// (User 18.10.2026: „nicht mehr die Tage, sondern nur noch den Vergleich zu dem
// vorherigen Patch"). Die Zahlen liefert /api/tft/patch-diff?full=1 — fuer alle
// Regionen aus den Dateien der Box (scripts/publish-meta-pulse-diffs.mjs),
// dieselben wie bei Patch-Gewinner.
//
// Ohne 'use client': die Server-Seite der Uebersicht rechnet das Patch-Paar mit
// derselben Funktion wie der Browser (seo/initial-data.ts), sonst fragte der
// Browser nach dem ersten Zeichnen ein anderes Paar ab und die Pfeile sprangen.
import { previousPatchOf, patchDayCount, PREVIOUS_PATCH_MIN_DAYS } from './snapshot-matrix';
import type { PatchInfo } from './tft-filters';

// Ab so vielen Spielen je Patch-Seite zeigt eine Zeile ein Δ, darunter „—"
// (User 18.10.2026: „reduziere die Mindestmenge auf 150 Spiele").
export const PATCH_DELTA_MIN_GAMES = 150;

export type PatchDeltaEntity = 'unit' | 'item' | 'trait' | 'comp';

/** Kompakte Zeile der Route: Schluessel, Trait-Stufe, Spiele, Ø-Platz. */
export interface PatchDeltaRow { k: string; l?: number; g: number; a: number }

export interface PatchDeltaResponse {
  hasData: boolean;
  reason?: string;
  currentPatch?: string | null;
  previousPatch?: string | null;
  current?: PatchDeltaRow[];
  previous?: PatchDeltaRow[];
}

/** Startdaten der Server-Seite: Antwort samt der Adresse, fuer die sie gilt. */
export interface PatchDeltaStart { url: string; res: PatchDeltaResponse }

/** Δ einer Zeile. deltaAvgPlace = jetzt − vorher (negativ = besser), null
 *  unter PATCH_DELTA_MIN_GAMES auf einer der beiden Seiten. */
export interface PatchDelta {
  deltaAvgPlace: number | null;
  avgPlaceNow: number | null;
  avgPlacePrev: number | null;
  gamesNow: number;
  gamesPrev: number;
  isNew: boolean;
}

export interface PatchDeltaPair { patch: string; prev: string }

/**
 * Welcher Patch gegen welchen: der gewaehlte (current = neuester, previous wie
 * die Listen nach previousPatchOf, sonst der genannte) gegen seinen Vorpatch.
 * null, wenn es keinen Vergleich gibt — der gewaehlte hat weniger als
 * PREVIOUS_PATCH_MIN_DAYS Datentage, es gibt keinen Vorpatch oder er liegt im
 * alten Set (Set-Start: ehrlich leer, User-Entscheid O3). Die Filterleiste
 * blendet die Option dann aus.
 */
export function patchDeltaPair(patches: readonly PatchInfo[], patchFilter: string): PatchDeltaPair | null {
  const newest = patches[0];
  if (!newest) return null;
  const selected = patchFilter === 'current' ? newest
    : patchFilter === 'previous' ? previousPatchOf(patches, newest.patch)
    : patches.find(p => p.patch === patchFilter) ?? null;
  if (!selected || patchDayCount(selected) < PREVIOUS_PATCH_MIN_DAYS) return null;
  const prev = previousPatchOf(patches, selected.patch);
  if (!prev || Number(prev.set_number) !== Number(selected.set_number)) return null;
  return { patch: selected.patch, prev: prev.patch };
}

/** Adresse der Abfrage — feste Reihenfolge, Region immer dabei: gleiche
 *  Ansicht = gleicher Edge-Cache-Schluessel. */
export function patchDeltaQuery(entity: PatchDeltaEntity, bucket: string, region: string, pair: PatchDeltaPair): string {
  const sp = new URLSearchParams({ full: '1', entity, bucket, region, patch: pair.patch, prev: pair.prev });
  return `/api/tft/patch-diff?${sp.toString()}`;
}

/** Summe einer Seite: Spiele und Σ Platz (a × g). */
export interface PatchDeltaSum { g: number; s: number }

export interface PatchDeltaIndex {
  entity: PatchDeltaEntity;
  pair: PatchDeltaPair;
  now: Map<string, PatchDeltaSum>;
  prev: Map<string, PatchDeltaSum>;
}

// Traits: je Stufe (O1 — das Δ gilt fuer die Stufe, die die Zeile zeigt).
export const traitDeltaKey = (name: string, level: number) => `${name}|${level}`;

function sumSide(entity: PatchDeltaEntity, rows: readonly PatchDeltaRow[]): Map<string, PatchDeltaSum> {
  const out = new Map<string, PatchDeltaSum>();
  for (const r of rows) {
    const g = Number(r.g);
    const a = Number(r.a);
    if (!(g > 0) || !Number.isFinite(a)) continue;
    const key = entity === 'trait' ? traitDeltaKey(r.k, Number(r.l)) : r.k;
    const cur = out.get(key) ?? { g: 0, s: 0 };
    cur.g += g;
    cur.s += a * g;
    out.set(key, cur);
  }
  return out;
}

/** null, wenn die Antwort keine Zahlen hat oder zu einem anderen Paar gehoert. */
export function buildPatchDeltaIndex(
  entity: PatchDeltaEntity,
  pair: PatchDeltaPair,
  res: PatchDeltaResponse | null | undefined,
): PatchDeltaIndex | null {
  if (!res?.hasData || !Array.isArray(res.current) || !Array.isArray(res.previous)) return null;
  if (res.currentPatch !== pair.patch || res.previousPatch !== pair.prev) return null;
  return { entity, pair, now: sumSide(entity, res.current), prev: sumSide(entity, res.previous) };
}

/** Δ aus den Summen beider Seiten. `allowNew`: „NEU", wenn die Zeile im
 *  Vorpatch fehlt (nicht bei Comps — Cluster entstehen und vergehen mit der
 *  Klassifikation, ein neuer Schluessel ist keine neue Comp). */
export function deltaFromSums(now: PatchDeltaSum | undefined, prev: PatchDeltaSum | undefined, allowNew: boolean): PatchDelta | null {
  const gNow = now?.g ?? 0;
  const gPrev = prev?.g ?? 0;
  if (gNow <= 0 && gPrev <= 0) return null;
  const avgNow = gNow > 0 ? now!.s / gNow : null;
  const avgPrev = gPrev > 0 ? prev!.s / gPrev : null;
  const enough = gNow >= PATCH_DELTA_MIN_GAMES && gPrev >= PATCH_DELTA_MIN_GAMES;
  return {
    deltaAvgPlace: enough && avgNow != null && avgPrev != null ? avgNow - avgPrev : null,
    avgPlaceNow: avgNow,
    avgPlacePrev: avgPrev,
    gamesNow: gNow,
    gamesPrev: gPrev,
    isNew: allowNew && gPrev <= 0 && gNow >= PATCH_DELTA_MIN_GAMES,
  };
}

/** Δ einer Unit / eines Items (Schluessel = characterId / apiName) bzw. einer
 *  Trait-Stufe (traitDeltaKey). */
export function patchDeltaOf(index: PatchDeltaIndex | null, key: string): PatchDelta | null {
  if (!index) return null;
  return deltaFromSums(index.now.get(key), index.prev.get(key), index.entity !== 'comp');
}

/** Summe ueber mehrere Comp-Cluster, jede Seite fuer sich (Σ Platz / Σ Spiele
 *  ueber alle passenden Zeilen, nicht nur Schluessel, die es auf beiden Seiten
 *  gibt). Die Box-Dateien fuehren Cluster erst ab PATCH_DIFF_MIN_GAMES (50)
 *  Spielen je Patch — der Rest einer Familie fehlt auf beiden Seiten gleich. */
export function sumDeltaKeys(index: PatchDeltaIndex, keys: Iterable<string>): PatchDelta | null {
  const now: PatchDeltaSum = { g: 0, s: 0 };
  const prev: PatchDeltaSum = { g: 0, s: 0 };
  for (const k of new Set(keys)) {
    const n = index.now.get(k);
    const p = index.prev.get(k);
    if (n) { now.g += n.g; now.s += n.s; }
    if (p) { prev.g += p.g; prev.s += p.s; }
  }
  return deltaFromSums(now, prev, false);
}
