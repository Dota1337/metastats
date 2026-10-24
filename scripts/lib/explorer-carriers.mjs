// „Beste Traeger von {Item}" im Data Explorer (Plan 24.10.2026): Units, die
// das Item selbst tragen. Nur die Standardansicht — genau dieses Item, alle
// Regionen und Raenge, neuester Patch. Dort liegen die Zahlen schon fest
// bereit: die Items-Ansicht je Unit (pickItemsWarmBody, warmUnits im Dienst),
// Zeile = das Item. Mit weiteren Filtern rechnet der Dienst nichts: am
// Patch-Ende brachen die Teilabfragen nach 15 s ab (18.4, Messung 24.10.).
// Die Seite schickt genau carriersBody (carriersServiceBody in
// app/lib/tft-explorer-query.ts, der Test legt beide nebeneinander).

import { normalizeQuery } from './explorer-normalize.mjs';
import { pickItemsWarmBody, unitsToWarm } from './explorer-unit-warm.mjs';

export const carriersBody = (itemId) => ({ items: [{ id: itemId }], patches: ['latest'], tab: 'carriers', focus: itemId });

// Startansichten, aus denen die Antwort liest: Units (welche Units
// vorgewaermt sind, unitsToWarm) und Items (Bretter mit dem Item = refGames).
export const CARRIERS_START = {
  units: { tab: 'units', patches: ['latest'] },
  items: { tab: 'items', patches: ['latest'] },
};

/** q kanonisch, „neuester Patch" schon aufgeloest: ist das die Standardansicht seines Fokus-Items? */
export function isCarriersDefault(q, latestPatch) {
  if (q?.tab !== 'carriers' || !q.focus || !latestPatch) return false;
  const want = normalizeQuery(carriersBody(q.focus));
  want.patches = [latestPatch];
  return JSON.stringify(want) === JSON.stringify(q);
}

/**
 * Antwort aus den bereitliegenden Ansichten; get(body) = Antwort zu dieser
 * Anfrage oder undefined. null = Vorrat unvollstaendig — nie eine Teil-Liste.
 * Zeilen ohne Δ: die Items-Ansicht misst sie gegen die Bretter der Unit, das
 * bedeutet hier nichts. Meistgespielte zuerst; Schwellen und Reihenfolge der
 * Zeile setzt die Seite (carrierPick in app/lib/tft-explorer-coplay.mjs).
 */
export function carrierRows(itemId, get) {
  const ids = unitsToWarm(get(CARRIERS_START.units)?.rows);
  const items = get(CARRIERS_START.items);
  if (!ids.length || !items?.rows) return null;
  const rows = [];
  for (const id of ids) {
    const res = get(pickItemsWarmBody(id));
    if (!res?.rows) return null;
    const r = res.rows.find(x => x.key === itemId && x.sub == null);
    if (r) rows.push({ key: id, games: r.games, matches: r.matches, avg: r.avg, top4: r.top4, top1: r.top1, half: r.half });
  }
  rows.sort((a, b) => b.games - a.games || a.key.localeCompare(b.key));
  return { rows, refGames: items.rows.find(x => x.key === itemId && x.sub == null)?.games ?? 0 };
}
