// Definition der Snapshot-Matrix für die Stats-Endpoints.
//
// Phase 1: für jeden Hot-Path-Endpoint definieren wir die Filter-Permutationen,
// die der nightly Crawler-Hook als statisches JSON nach Vercel-Blob schreibt.
// Die Liste hier ist die Single-Source-Of-Truth — Publisher iteriert darüber,
// API-Routes erzeugen ihren Lookup-Key nach derselben Logik, das Manifest
// markiert verfügbare Snapshots.
//
// Trade-off: ~80 % der gemessenen Traffic-Combos abdecken, nicht jede
// theoretisch mögliche. Was nicht abgedeckt ist, fällt graceful auf den
// existierenden Live-Calc-Pfad zurück.

export type SnapshotEndpoint = 'comps' | 'units' | 'items' | 'traits';

export interface SnapshotPermutation {
  patch: 'current' | 'previous';   // alias-Form, der Publisher resolved
  region: string;                  // 'all' | 'west' | 'asia' | platform-routing
  days: number;                    // 1..7
  bucket: string;                  // 'master_plus' | 'all' | 'diamond_plus' | ...
  minGames: number;                // RPC-Threshold, identisch zu Route-Default
}

interface SnapshotEndpointSpec {
  apiPath: string;                 // /api/tft/<endpoint>
  permutations: SnapshotPermutation[];
}

// Hot-Path Filter-Achsen: die UI-Defaults plus die häufigsten Switch-Operationen.
// patch=current ist immer dabei; patch=previous nur für Stats-Endpoints, weil
// die Velocity / Patch-Diff-Surfaces den Vergleich brauchen.
const PRIMARY_REGIONS = ['all', 'west', 'asia', 'euw1', 'na1', 'kr'] as const;
const SECONDARY_REGIONS = ['eun1', 'br1', 'sg2', 'jp1', 'tw2'] as const;
const PRIMARY_DAYS = [1, 3, 7] as const;
const PRIMARY_BUCKETS = ['master_plus', 'all', 'diamond_plus'] as const;

function buildListMatrix(opts: {
  patches: Array<'current' | 'previous'>;
  regions: ReadonlyArray<string>;
  days: ReadonlyArray<number>;
  buckets: ReadonlyArray<string>;
  minGames: number | ((days: number) => number);
}): SnapshotPermutation[] {
  const out: SnapshotPermutation[] = [];
  for (const patch of opts.patches) {
    for (const region of opts.regions) {
      for (const days of opts.days) {
        for (const bucket of opts.buckets) {
          const minGames = typeof opts.minGames === 'function'
            ? opts.minGames(days)
            : opts.minGames;
          out.push({ patch, region, days, bucket, minGames });
        }
      }
    }
  }
  return out;
}

// Comp-Listing: minGames skaliert mit Tagesfenster (70 × days), gecappt bei
// 14 Tagen. Muss synchron bleiben mit dem Default in app/api/tft/comps/route.ts.
const compsMinGames = (days: number) => 70 * Math.min(days, 14);

export const SNAPSHOT_MATRIX: Record<SnapshotEndpoint, SnapshotEndpointSpec> = {
  // /api/tft/comps default in der UI: bucket=master_plus, region=all, days=3.
  // minGames=30 ist der Route-Default; weniger riskiert noisy comps.
  // Primary-Regionen + Primary-Buckets × 3 Days × 2 Patches = 108 Permutationen.
  comps: {
    apiPath: '/api/tft/comps',
    permutations: buildListMatrix({
      patches: ['current', 'previous'],
      regions: PRIMARY_REGIONS,
      days: PRIMARY_DAYS,
      buckets: PRIMARY_BUCKETS,
      minGames: compsMinGames,
    }),
  },
  // /api/tft/units default: bucket=diamond, region=euw1, days=3.
  // Units-Listing wird häufig pro Region angesehen → mehr Regionen rein.
  // 11 Regionen × 3 Days × 3 Buckets × 2 Patches = 198. Etwas reich, aber
  // /tft/units ist eine der meist-besuchten Pages.
  units: {
    apiPath: '/api/tft/units',
    permutations: buildListMatrix({
      patches: ['current', 'previous'],
      regions: [...PRIMARY_REGIONS, ...SECONDARY_REGIONS],
      days: PRIMARY_DAYS,
      buckets: PRIMARY_BUCKETS,
      minGames: 0,
    }),
  },
  // /api/tft/items: gleiche Filter-Achsen wie units.
  items: {
    apiPath: '/api/tft/items',
    permutations: buildListMatrix({
      patches: ['current', 'previous'],
      regions: [...PRIMARY_REGIONS, ...SECONDARY_REGIONS],
      days: PRIMARY_DAYS,
      buckets: PRIMARY_BUCKETS,
      minGames: 0,
    }),
  },
  // /api/tft/traits: kleinere Surfaces, nur Default-Achsen.
  traits: {
    apiPath: '/api/tft/traits',
    permutations: buildListMatrix({
      patches: ['current', 'previous'],
      regions: PRIMARY_REGIONS,
      days: PRIMARY_DAYS,
      buckets: PRIMARY_BUCKETS,
      minGames: 0,
    }),
  },
  // /api/tft/augments wird bewusst NICHT vorgerendert — die Route liefert
  // per Design `hasData:false` (Riot-Restriction auf Augment-Stats). Das
  // /tft/augments-Listing rendert aus dem statischen CDragon-Asset-Bundle.
};

// Stabiler, dateisystem-sicherer Lookup-Key. ResolvedPatch (z.B. "17.5") statt
// 'current'/'previous'-Alias, damit ein neuer Patch automatisch einen neuen Key
// kriegt und stale Snapshots nicht versehentlich verwendet werden.
export function snapshotKey(endpoint: SnapshotEndpoint, p: {
  patch: string;
  region: string;
  days: number;
  bucket: string;
  minGames: number;
}): string {
  const patch = p.patch.replace(/[^A-Za-z0-9._-]/g, '_');
  const region = p.region.replace(/[^a-z0-9]/gi, '_');
  const bucket = p.bucket.replace(/[^a-z0-9_]/gi, '_');
  return `${endpoint}/${patch}/${region}__${p.days}d__${bucket}__mg${p.minGames}.json`;
}

// Stable canonical form for matching incoming requests against the matrix.
export function normalizeSnapshotRequest(p: {
  patch: string | null;
  region: string;
  days: number;
  bucket: string;
  minGames: number;
}): { patch: string; region: string; days: number; bucket: string; minGames: number } | null {
  if (!p.patch) return null;
  return {
    patch: p.patch,
    region: p.region || 'all',
    days: p.days,
    bucket: p.bucket || 'master_plus',
    minGames: p.minGames,
  };
}
