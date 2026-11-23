// LoL-Builds (aggregate-lol-builds.mjs): einen Patch nicht neu nach Supabase
// schreiben, wenn sein Ergebnis gleich geblieben ist.
//
// Anlass (gemessen 23.11.2026): der abgeschlossene Patch 16.22 kam alle 6 h mit
// denselben 1.025.285 Teilnehmern und 365.356 Zeilen heraus und wurde trotzdem
// jedes Mal geloescht und neu eingefuegt — auf Supabase 11,7 Mio. Inserts und
// 11,6 Mio. Deletes, 6,1 GB WAL in 5,2 Tagen.
//
// Spaetestens nach LOL_BUILDS_MAX_SKIP_MS wird doch geschrieben: der Vertrag
// lol-builds/rang-summen (infra/contracts.json) zaehlt updated_at der letzten
// 2 Tage, die Zeilen muessen also mindestens einmal am Tag frisch sein.

import { createHash } from 'node:crypto';

export const LOL_BUILDS_MAX_SKIP_MS = 20 * 3_600_000;
// Obergrenze, die der Vertrag traegt (windowDays 2) — der Test haelt den Abstand.
export const RANG_SUMMEN_WINDOW_MS = 48 * 3_600_000;

/**
 * Fingerabdruck der Ergebniszeilen eines Patches. Sortiert, weil der
 * Lesezeiger ohne ORDER BY liest und prune() in Map-Reihenfolge ausgibt.
 */
export function patchRowsHash(rows) {
  const lines = rows.map((r) => JSON.stringify(r));
  lines.sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** true = gleicher Inhalt und zuletzt vor weniger als maxMs geschrieben. */
export function shouldSkipWrite(entry, hash, now = Date.now(), maxMs = LOL_BUILDS_MAX_SKIP_MS) {
  if (!entry || typeof entry.hash !== 'string' || entry.hash !== hash) return false;
  const t = Date.parse(entry.writtenAt);
  if (!Number.isFinite(t) || t > now) return false;
  return now - t < maxMs;
}
