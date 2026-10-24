// Vorwaermen der Unit-Detailseiten im Explorer-Dienst (Plan 19.10.2026, Teil A1):
// die drei Abfragen der Standardansicht — alle Regionen, Master+, neuester Patch,
// Builds/Items mit 3 Items — je Unit mit genug Brettern. Gleiche Form wie
// unitExplorerQueries + UNIT_DEFAULT_FILTERS in app/components/tft/unit/useUnitExplorer.ts;
// der Test legt beide nebeneinander (gleicher Schluessel = Treffer im Dienst).

import { COPLAY_MAX, coplayChosen, coplayPick } from '../../app/lib/tft-explorer-coplay.mjs';

// perf-critic 19.10.: 65 Units ueber 1.000 Brettern, je Abfrage ~4,5 s kalt.
export const UNIT_WARM_MIN_BOARDS = 1000;
// Obergrenze gegen Speicher: je Unit ~340 KB Antwort (gemessen Lux 19.10.).
export const UNIT_WARM_MAX_UNITS = 80;
// Rang der Seite ohne ?bucket= (tierBucketFromParam → master_plus).
const RANKS = ['CHALLENGER', 'GRANDMASTER', 'MASTER'];

/** Anfrage-Koerper in der Reihenfolge der Seite: Sterne, Items, Builds. */
export function unitWarmBodies(unitId) {
  const base = { region: 'all', ranks: RANKS, patches: ['latest'] };
  const unit = { id: unitId, n: 3, nx: 3 };
  return [
    { ...base, units: [{ id: unitId }], tab: 'units', split: 'star' },
    { ...base, units: [unit], tab: 'items', focus: unitId },
    { ...base, units: [unit], tab: 'builds', focus: unitId },
  ];
}

// Explorer-Auswahl einer Unit (Plan 19.10.2026, S1): Units-Reiter mit genau
// dieser Unit, alle Regionen/Raenge, neuester Patch — die Anfrage nach einem
// Klick auf einen Suchtreffer in der Standardansicht.
export function pickWarmBody(unitId) {
  return { region: 'all', ranks: [], patches: ['latest'], units: [{ id: unitId }], tab: 'units' };
}

// Danach Reiter Items (Plan 24.10.2026): die gesuchte Unit ist Traeger
// (followFocus), also die Items-Ansicht genau dieser Unit. ~34 KB je Antwort
// (Ahri live 24.10.), kalt 0,3–1,1 s.
export function pickItemsWarmBody(unitId) {
  return { ...pickWarmBody(unitId), tab: 'items', focus: unitId };
}

// Vorschlags-Paare (S6): die Seite laesst nur spielbare Units zu
// (tftPlayableChampions), der Dienst kennt die Liste nicht und rechnet deshalb
// ein paar Partner mehr — eine Obermenge der Seiten-Auswahl.
export const COPLAY_WARM_SLACK = 2;

/**
 * Paar-Anfragen zu einer Antwort im Units-Reiter: genau die Anfrage, die ein
 * Klick auf einen Vorschlag ausloest (Hauptliste + Partner). [] wenn die Seite
 * dort keine Vorschlaege zeigt oder der Partner nicht mehr hineinpasst.
 * q = kanonische Anfrage des Dienstes (normalizeQuery).
 */
export function coplayPairBodies(q, rows, { maxUnits, maxTotal }) {
  if (q.tab !== 'units' || q.split != null || q.focus != null) return [];
  if (!q.units.some(u => !u.x)) return [];
  const total = q.units.length + q.items.length + q.traits.length
    + q.groups.reduce((a, g) => a + g.units.length + g.items.length + g.traits.length, 0);
  if (q.units.length >= maxUnits || total >= maxTotal) return [];
  return coplayPick(rows, { chosen: coplayChosen(q), max: COPLAY_MAX + COPLAY_WARM_SLACK })
    .map(r => ({ ...q, units: [...q.units, { id: r.key }] }));
}

/** Units aus der Startansicht des Units-Reiters, meistgespielte zuerst. */
export function unitsToWarm(rows, { min = UNIT_WARM_MIN_BOARDS, max = UNIT_WARM_MAX_UNITS } = {}) {
  return (rows ?? [])
    .filter(r => r && r.sub == null && typeof r.key === 'string' && r.games >= min)
    .sort((a, b) => b.games - a.games || a.key.localeCompare(b.key))
    .slice(0, max)
    .map(r => r.key);
}
