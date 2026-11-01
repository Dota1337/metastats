// Standard-Stern der Seite „What to build" (Plan 01.11.2026): der haeufigste Stern
// ab 2★ der Unit. Eigene .mjs, weil der Explorer-Dienst mit derselben Regel
// vorrechnet (scripts/lib/explorer-unit-warm.mjs) — Regel an einer Stelle, sonst
// verfehlt das Vorrechnen die Abfrage der Seite.
//
// Warum nicht „alle Sterne": 1★-Bretter mit 3 Items sind fast immer verlorene
// Spiele und drehen Vergleiche (gemessen 01.11.: Draven, Giant Slayer 3,42 vor
// Deathblade 3,55 ueber alle Sterne, bei 2★ gleichauf 2,73 zu 2,72).

// Darunter ist der Stern keine Aussage; die Seite faellt auf „alle Sterne" zurueck.
export const TARGET_STAR_MIN_GAMES = 100;

/** rows: Units-Reiter mit Stern-Aufteilung (sub = Stern). null = alle Sterne. */
export function targetStarOf(rows, unitId) {
  let best = null;
  for (const r of rows ?? []) {
    if (r?.key !== unitId || (r.sub !== 2 && r.sub !== 3)) continue;
    if (!best || r.games > best.games) best = r;
  }
  return best && best.games >= TARGET_STAR_MIN_GAMES ? best.sub : null;
}
