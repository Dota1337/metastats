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
// emerald_plus / platinum_plus seit 2026-09-13: live gerechnet liefen beide auf
// "alle Regionen × 7 Tage" nach 8,2 s in den Abbruch (502).
export const PRIMARY_BUCKETS = ['master_plus', 'all', 'diamond_plus', 'emerald_plus', 'platinum_plus'];
// Detail-Permutationen-Achsen (publish-snapshot-bundle.mjs Detail-Welle).
// Vor 2026-06-25 lebten diese NUR im Publisher (echte Drift) — wandern jetzt
// in den SoT damit TS-Layer auch davon weiß und potentielle Detail-Lookup-
// Validation auf publizierte Achsen möglich wird (YAGNI: nicht jetzt einbauen).
//
// Achsen-Revision 2026-08-17 (perf-critic + data-skeptic, alles live gemessen):
//   - Regionen: `west`/`asia` sind aus dem Detail-Dropdown NICHT waehlbar
//     (page.tsx REGIONS) und belegten trotzdem die Haelfte der Blobs. Ersetzt
//     durch die erreichbaren Top-Regionen.
//   - Days: seit 2026-09-13 uebernimmt die Detail-Page das Zeitfenster der
//     Liste (1/3/7 Tage, Default 3) statt fix 14 → alle drei vorrendern.
//   - Patches: `previous` × 1d lieferte `hasData:false` (kein Key), und der
//     Vorgaenger-Patch faellt binnen Tagen komplett aus dem 7d-Fenster.
//   - Buckets: `diamond_plus` ist der API/UI-Default und hatte 0 von 523
//     Detail-Keys — genau der gemeldete „Keine Daten"-Fall.
//   - minGames: MUSS 30 sein (= was die Page fragt). Mit 490 publiziert
//     verschiebt sich die Family-Aggregation messbar (12.812 → 12.402 Spiele,
//     5 → 3 Member) und der Snapshot ankert teilweise auf einer ANDEREN Comp.
export const DETAIL_REGIONS = ['all', 'euw1', 'na1', 'kr'];
export const DETAIL_DAYS = [1, 3, 7];
export const DETAIL_PATCHES = ['current'];
export const DETAIL_BUCKETS = ['master_plus', 'diamond_plus', 'emerald_plus', 'platinum_plus'];
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
// ---------------------------------------------------------------------------
// Tagesfenster der Listen-Abfragen
//
// Steht hier (und nicht im Reader), weil zwei Seiten dasselbe Fenster rechnen
// muessen: die Route (tft-supabase-reader.ts resolveFilters) und das Box-Skript
// scripts/precompute-comp-windows.mjs, das ueber die generierte .mjs liest.
// Rechnen beide verschieden, findet die Route ihre Vorab-Liste nie.
//
// Stale-Data-Bump: liegt der letzte Stats-Tag hinter `current_date`, wuerde
// „Letzter Tag" ein leeres Fenster sehen. Das Fenster wird so weit gedehnt, dass
// der letzte verfuegbare Tag drin liegt (RPC-Filter `day >= current_date - p_days`).
// Ohne Patch-Filter darf die Dehnung nicht vor den Start des Patches reichen —
// sonst mischt „Letzter Tag" nach einem Ausfall Tage des Vorpatches hinein.
const DAY_MS = 86_400_000;
function utcMidnight(d) {
    const t = new Date(d.getTime());
    t.setUTCHours(0, 0, 0, 0);
    return t;
}
export function listWindowDays(o) {
    let days = o.requestedDays;
    let anchorOffsetDays = 0;
    if (o.latestDay) {
        const today = utcMidnight(o.today);
        const latest = new Date(o.latestDay + 'T00:00:00Z');
        const staleness = Math.max(0, Math.floor((today.getTime() - latest.getTime()) / DAY_MS));
        if (staleness >= 1)
            days = Math.max(days, staleness + o.requestedDays);
        if (o.patchFilter == null && o.patchStartDay && days > o.requestedDays) {
            const start = new Date(o.patchStartDay + 'T00:00:00Z');
            const sinceStart = Math.floor((today.getTime() - start.getTime()) / DAY_MS) + 1;
            if (sinceStart >= 1)
                days = Math.max(o.requestedDays, Math.min(days, sinceStart));
        }
        anchorOffsetDays = staleness;
    }
    return { days, anchorOffsetDays };
}
// Ein frisch erschienener Patch taucht am ersten (Teil-)Tag mit wenigen tausend
// Spielen auf — viel zu duenn fuer die Comp-Liste. Darunter zaehlt er nicht als
// „current". Sind alle darunter (Set-Start), bleibt die rohe Liste.
export const PATCH_MIN_GAMES = 100_000;
export function establishedPatches(rows, min = PATCH_MIN_GAMES) {
    const established = rows.filter(r => Number(r.total_matches) >= min);
    return established.length > 0 ? established : rows;
}
// ---------------------------------------------------------------------------
// Vorab berechnete Comp-Listen (Plan D, 2026-09-13, Migration 0070)
//
// Gemessen von der Box (Region „alle", Mindestspiele 30): alle 16-21 s,
// Platin+ bis 16 s, Smaragd+ bis 9,5 s, Diamant+ bis 7 s, Meister+ bis 4 s bei
// 7 Tagen. Besucher haben 8 s, der Publisher 20 s. Diese fuenf Gruppen rechnet
// scripts/precompute-comp-windows.mjs vor jedem Publisher-Lauf vor.
//
// Die Raenge stehen hier doppelt zu rank-groups.ts, weil diese Datei allein
// von tsc uebersetzt wird und nichts importieren darf. Drift ist ungefaehrlich:
// die Route vergleicht die sortierten Listen und rechnet bei Abweichung live.
const LADDER_UP = [
    'bronze', 'silver', 'gold', 'platinum', 'emerald',
    'diamond', 'master', 'grandmaster', 'challenger',
];
const plusFrom = (floor) => LADDER_UP.slice(LADDER_UP.indexOf(floor));
export const COMP_PRECOMPUTE_BUCKETS = {
    all: LADDER_UP,
    platinum_plus: plusFrom('platinum'),
    emerald_plus: plusFrom('emerald'),
    diamond_plus: plusFrom('diamond'),
    master_plus: plusFrom('master'),
};
export const COMP_PRECOMPUTE_REGION = 'all';
// = ADAPTIVE_FLOOR der Route: die Comps-Seite fragt ohne ?minGames und damit
// mit 30. Jede hoehere Schwelle bedient die Route durch Nachfiltern.
export const COMP_PRECOMPUTE_MIN_GAMES = 30;
// Ein Eintrag, der aelter ist, gilt als verwaist (Publisher laeuft nicht mehr).
export const COMP_PRECOMPUTE_MAX_AGE_MS = 72 * 60 * 60 * 1000;
/** Sortiert + kommagetrennt — Schluessel fuer Regionen und Raenge. */
export function listKey(values) {
    return [...values].sort().join(',');
}
function isoDay(d) {
    return d.toISOString().slice(0, 10);
}
// Alle Kombinationen, die das Box-Skript rechnet: aktuell ungefiltert plus die
// zwei neuesten etablierten Patches des laufenden Sets, je Gruppe und je
// Tagesstufe 1..7. Stufen mit gleichem data_start liefern dasselbe Ergebnis und
// erscheinen nur einmal.
export function compPrecomputeJobs(o) {
    const p = o.patches;
    if (p.length === 0)
        return [];
    const today = utcMidnight(o.today);
    const latestDay = p[0].last_day;
    const cases = [
        { patchKey: '', patchFilter: null, startDay: p[0].first_day },
    ];
    for (const x of p.slice(0, 2)) {
        if (Number(x.set_number) === o.setNumber) {
            cases.push({ patchKey: x.patch, patchFilter: x.patch, startDay: x.first_day });
        }
    }
    const out = [];
    const seen = new Set();
    for (const c of cases) {
        for (const [bucketLabel, tiers] of Object.entries(COMP_PRECOMPUTE_BUCKETS)) {
            for (let requestedDays = 1; requestedDays <= 7; requestedDays++) {
                const { days } = listWindowDays({
                    requestedDays, patchFilter: c.patchFilter, patchStartDay: c.startDay, latestDay, today,
                });
                const windowStart = isoDay(new Date(today.getTime() - days * DAY_MS));
                const dataStart = c.patchFilter && c.startDay > windowStart ? c.startDay : windowStart;
                const key = `${c.patchKey}|${bucketLabel}|${dataStart}`;
                if (seen.has(key))
                    continue;
                seen.add(key);
                out.push({
                    patchKey: c.patchKey,
                    patchFilter: c.patchFilter,
                    patchFirstDay: c.patchFilter ? c.startDay : null,
                    bucketLabel,
                    tiers,
                    days,
                    dataStart,
                });
            }
        }
    }
    return out;
}
// Darf die Route einen gefundenen Eintrag benutzen? Nur wenn er denselben
// letzten Datentag kennt wie die Route (sonst fehlt ein neuer Tag), nicht
// verwaist ist und mit hoechstens der angefragten Mindestspiele-Zahl gerechnet
// wurde (niedriger laesst sich nachfiltern, hoeher nicht).
export function precomputedEntryUsable(e, o) {
    if (!e || !o.latestDay)
        return false;
    if (String(e.last_day).slice(0, 10) !== o.latestDay.slice(0, 10))
        return false;
    const age = o.now - Date.parse(e.computed_at);
    if (!Number.isFinite(age) || age > COMP_PRECOMPUTE_MAX_AGE_MS)
        return false;
    return Number(e.min_games) <= o.requestedMinGames;
}
