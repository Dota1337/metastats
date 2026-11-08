// Zeitfenster und Menge, mit denen die Rang-Stichprobe des LoL-Sammlers
// (scripts/collect-lol-matches.mjs, seedRankQueue) Match-IDs je Spieler holt.
//
// User-Entscheid 08.11.2026: 100 Spiele je Spieler (Riots Maximum, kostet
// denselben einen Abruf wie 20) und nur der neueste Patch — damit der neue
// Patch schneller auf 50.000 Matches kommt (NEWEST_PATCH_MIN_MATCHES,
// app/lib/lol-champion-stats-blob.mjs) und das Nachfuellen weniger Abrufe
// kostet (vorher 208–312 von 900 je Zyklus).
//
// Erst ab 24 h Patch-Alter in der Rohablage. Vorher gilt exakt das alte
// Verhalten (ab Vorpatch, 20 je Spieler): in den ersten Stunden haben die
// Spieler kaum Spiele im neuen Patch, leere Nachfuell-Runden beenden den
// Zyklus. Und 100 ab Vorpatch waere am Patch-Anfang schlechter als heute — die
// Warteschlange liefe fast nur mit Vorpatch-Spielen voll.

export const RANK_NEWEST_MIN_AGE_S = 24 * 3600;
export const RANK_IDS_NEWEST = 100;           // Riots Maximum; mehr bricht den Lauf ab
export const RANK_IDS_EARLY = 20;
export const RANK_FALLBACK_S = 28 * 86400;    // Rohablage leer: zwei Patches

const label = (p) => (p ? `${p.major}.${p.minor}` : '?');
const isStart = (t, nowSec) => Number.isFinite(t) && t > 0 && t <= nowSec;

/**
 * @param {{ newest: {major:number,minor:number}|null, prev: {major:number,minor:number}|null,
 *   newestStart: number|null, prevStart: number|null, nowSec: number }} o
 *   newestStart/prevStart = erstes Spiel des Patches in der Rohablage (Unix-Sekunden), null = keine Zeilen
 * @returns {{ startTime: number, count: number, patch: string, onlyNewest: boolean }}
 */
export function pickRankWindow({ newest, prev, newestStart, prevStart, nowSec }) {
  if (newest && isStart(newestStart, nowSec) && nowSec - newestStart >= RANK_NEWEST_MIN_AGE_S) {
    return { startTime: newestStart, count: RANK_IDS_NEWEST, patch: label(newest), onlyNewest: true };
  }
  const startTime = isStart(prevStart, nowSec) ? prevStart : nowSec - RANK_FALLBACK_S;
  return { startTime, count: RANK_IDS_EARLY, patch: label(prev), onlyNewest: false };
}
