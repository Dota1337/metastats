// Konter-Listen fuer LoL-Champion-Seiten ("stark gegen" / "schwach gegen").
// Eine Regel fuer Datenbank-Weg (app/api/champions/[id]/builds/route.ts) und
// Datei-Weg (scripts/lib/build-aggregator.mjs).
//
// Gegner-Paare haben meist nur 5-30 Spiele. Nach roher Siegquote sortiert
// standen deshalb Zufallstreffer (5-0) oben, und beide Listen zeigten dieselben
// Gegner nur umgekehrt. Jetzt: Rangfolge nach geglaetteter Siegquote — die
// Rollen-Siegquote zaehlt wie `prior` gedachte Spiele mit. "Stark" nur, wenn
// die geglaettete Quote ueber der Rollenquote liegt, "schwach" nur darunter;
// damit kann kein Gegner in beiden Listen stehen. Angezeigt bleiben die echten
// Spiele/Niederlagen.

/**
 * @typedef {{ enemy: string, gamesAgainst: number, lossesAgainst: number }} CounterEntry
 */

/**
 * @param {CounterEntry[]} entries
 * @param {number} baseWr Siegquote des Champions in der Rolle (0..1)
 * @param {{ minGames?: number, prior?: number, top?: number }} [opts]
 * @returns {{ strongAgainst: CounterEntry[], weakAgainst: CounterEntry[] }}
 */
export function pickCounters(entries, baseWr, opts = {}) {
  const { minGames = 5, prior = 20, top = 5 } = opts;
  if (!Number.isFinite(baseWr)) return { strongAgainst: [], weakAgainst: [] };
  /** @type {Map<string, CounterEntry>} */
  const byEnemy = new Map();
  for (const e of entries) {
    if (!e || !(e.gamesAgainst >= minGames)) continue;
    const prev = byEnemy.get(e.enemy);
    if (!prev || e.gamesAgainst > prev.gamesAgainst) byEnemy.set(e.enemy, e);
  }
  const scored = [...byEnemy.values()].map(e => ({
    e,
    s: (e.gamesAgainst - e.lossesAgainst + prior * baseWr) / (e.gamesAgainst + prior),
  }));
  const strip = (/** @type {{ e: CounterEntry }} */ x) =>
    ({ enemy: x.e.enemy, gamesAgainst: x.e.gamesAgainst, lossesAgainst: x.e.lossesAgainst });
  return {
    strongAgainst: scored.filter(x => x.s > baseWr).sort((a, b) => b.s - a.s).slice(0, top).map(strip),
    weakAgainst: scored.filter(x => x.s < baseWr).sort((a, b) => a.s - b.s).slice(0, top).map(strip),
  };
}
