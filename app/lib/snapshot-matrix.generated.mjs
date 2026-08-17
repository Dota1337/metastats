// AUTO-GENERATED from app/lib/snapshot-matrix.ts — DO NOT EDIT.
// Regenerate via `npm run build:snapshot-matrix`.
// Architektur-Pattern: TS-SoT, MJS auto-generiert (Multi-Review 2026-06-25,
// Option C). Konsumiert von scripts/publish-snapshot-bundle.mjs.
// Memory: reference_dual_module_patterns.md.

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
// Hot-Path Filter-Achsen: die UI-Defaults plus die häufigsten Switch-Operationen.
// patch=current ist immer dabei; patch=previous nur für Stats-Endpoints, weil
// die Velocity / Patch-Diff-Surfaces den Vergleich brauchen.
//
// Exported damit publish-snapshot-bundle.mjs sie via auto-generated
// snapshot-matrix.generated.mjs (siehe scripts/build-snapshot-matrix.mjs)
// importieren kann — Single-Source-of-Truth ohne Drift-Risiko zwischen
// TS-Konsumenten (Vercel-Routes) und MJS-Konsumenten (Hetzner-Publisher).
// Multi-Review-Verdict 2026-06-25: Option C (TS-SoT + tsc-Generate).
export const PRIMARY_REGIONS = ['all', 'west', 'asia', 'euw1', 'na1', 'kr'];
export const SECONDARY_REGIONS = ['eun1', 'br1', 'sg2', 'jp1', 'tw2'];
export const PRIMARY_DAYS = [1, 3, 7];
export const PRIMARY_BUCKETS = ['master_plus', 'all', 'diamond_plus'];
// Detail-Permutationen-Achsen (publish-snapshot-bundle.mjs Detail-Welle).
// Vor 2026-06-25 lebten diese NUR im Publisher (echte Drift) — wandern jetzt
// in den SoT damit TS-Layer auch davon weiß und potentielle Detail-Lookup-
// Validation auf publizierte Achsen möglich wird (YAGNI: nicht jetzt einbauen).
//
// Achsen-Revision 2026-08-17 (perf-critic + data-skeptic, alles live gemessen):
//   - Regionen: `west`/`asia` sind aus dem Detail-Dropdown NICHT waehlbar
//     (page.tsx REGIONS) und belegten trotzdem die Haelfte der Blobs. Ersetzt
//     durch die erreichbaren Top-Regionen.
//   - Days: die Detail-Page fetcht fix `days=14`, der Reader klemmt auf 7
//     (tft-supabase-reader.ts) — 1d/3d waren unerreichbarer Ballast.
//   - Patches: `previous` × 1d lieferte `hasData:false` (kein Key), und der
//     Vorgaenger-Patch faellt binnen Tagen komplett aus dem 7d-Fenster.
//   - Buckets: `diamond_plus` ist der API/UI-Default und hatte 0 von 523
//     Detail-Keys — genau der gemeldete „Keine Daten"-Fall.
//   - minGames: MUSS 30 sein (= was die Page fragt). Mit 490 publiziert
//     verschiebt sich die Family-Aggregation messbar (12.812 → 12.402 Spiele,
//     5 → 3 Member) und der Snapshot ankert teilweise auf einer ANDEREN Comp.
export const DETAIL_REGIONS = ['all', 'euw1', 'na1', 'kr'];
export const DETAIL_DAYS = [7];
export const DETAIL_PATCHES = ['current'];
export const DETAIL_BUCKETS = ['master_plus', 'diamond_plus'];
export const DETAIL_MIN_GAMES = 30;
export const DETAIL_TOP_N = 30;
export function buildListMatrix(opts) {
    const out = [];
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
export const compsMinGames = (days) => 70 * Math.min(days, 14);
export const SNAPSHOT_MATRIX = {
    // /api/tft/comps default in der UI: bucket=diamond_plus, region=all, days=3.
    // minGames für comps = compsMinGames(days) = 70×min(days,14) (Route-Default,
    // comps/route.ts) — NICHT 30. Skaliert mit dem Window gegen noisy comps.
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
    // /api/tft/units default: bucket=diamond_plus, region=all, days=3.
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
    //
    // /api/tft/comps?slug=… (Detail-Pfad) ist in der Matrix mit leerer
    // permutations-Liste, weil Top-N-Slugs erst zur Laufzeit aus dem
    // Listing-Snapshot-Output extrahiert werden (perf-critic Phase 2). Der
    // Publisher iteriert in einer 2. Phase ueber listingPayload.comps[0..30]
    // und produziert pro slug × Default-Achse (region × days × patch ×
    // bucket=master_plus × variant=family) ~24 Permutationen.
    'comps-detail': {
        apiPath: '/api/tft/comps',
        permutations: [],
    },
};
// Stabiler, dateisystem-sicherer Lookup-Key. ResolvedPatch (z.B. "17.5") statt
// 'current'/'previous'-Alias, damit ein neuer Patch automatisch einen neuen Key
// kriegt und stale Snapshots nicht versehentlich verwendet werden.
export function snapshotKey(endpoint, p) {
    const patch = p.patch.replace(/[^A-Za-z0-9._-]/g, '_');
    const region = p.region.replace(/[^a-z0-9]/gi, '_');
    const bucket = p.bucket.replace(/[^a-z0-9_]/gi, '_');
    if (endpoint === 'comps-detail') {
        const slugSafe = (p.slug || '').replace(/[^A-Za-z0-9._-]/g, '_');
        return `${endpoint}/${patch}/${slugSafe}__${region}__${p.days}d__${bucket}.json`;
    }
    return `${endpoint}/${patch}/${region}__${p.days}d__${bucket}__mg${p.minGames}.json`;
}
// Stable canonical form for matching incoming requests against the matrix.
export function normalizeSnapshotRequest(p) {
    if (!p.patch)
        return null;
    return {
        patch: p.patch,
        region: p.region || 'all',
        days: p.days,
        bucket: p.bucket || 'master_plus',
        minGames: p.minGames,
        slug: p.slug,
    };
}
