// Vorwaermen der Unit-Detailseiten im Explorer-Dienst (Plan 19.10.2026, Teil A1):
// die drei Abfragen der Standardansicht — alle Regionen, Master+, neuester Patch,
// Builds/Items mit 3 Items — je Unit mit genug Brettern. Gleiche Form wie
// unitExplorerQueries + UNIT_DEFAULT_FILTERS in app/components/tft/unit/useUnitExplorer.ts;
// der Test legt beide nebeneinander (gleicher Schluessel = Treffer im Dienst).

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

/** Units aus der Startansicht des Units-Reiters, meistgespielte zuerst. */
export function unitsToWarm(rows, { min = UNIT_WARM_MIN_BOARDS, max = UNIT_WARM_MAX_UNITS } = {}) {
  return (rows ?? [])
    .filter(r => r && r.sub == null && typeof r.key === 'string' && r.games >= min)
    .sort((a, b) => b.games - a.games || a.key.localeCompare(b.key))
    .slice(0, max)
    .map(r => r.key);
}
