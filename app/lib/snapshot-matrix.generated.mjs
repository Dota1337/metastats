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
    // Primary-Regionen + Primary-Buckets × 3 Days × 2 Patches = 180 Permutationen.
    comps: {
        apiPath: '/api/tft/comps',
        permutations: buildListMatrix({
            patches: ['current', 'previous'],
            regions: PRIMARY_REGIONS,
            days: PRIMARY_DAYS,
            buckets: PRIMARY_BUCKETS,
            // 0 = ohne ?minGames abrufen wie die Seite selbst: die Route waehlt dann
            // die angepasste Schwelle (seit 2026-10-02 in der Abfrage). Vorher war
            // der Payload fester gefiltert und Einzelregionen liefen live in die
            // 8-s-Grenze.
            minGames: 0,
        }).concat(
        // Region „alle" fuer die uebrigen Tagesfenster 2/4/5/6: live reisst die
        // Abfrage dort die 8-s-Grenze der Besucher (502 am 02./03.10.2026). Der
        // Publisher liest die Vorab-Liste (Migration 0070) mit 25 s Zeit.
        buildListMatrix({
            patches: ['current', 'previous'],
            regions: ['all'],
            days: [2, 4, 5, 6],
            buckets: PRIMARY_BUCKETS,
            minGames: 0,
        }).map(p => ({ ...p, optional: true }))),
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
    // Item-Bloecke der Unit- und Item-Detailseiten (0096, User 15.10.2026
    // „Standardansicht sofort"): EIN Stand mit allen Units und Items, nur fuer
    // die Standardansicht der Detailseiten (detailFiltersFrom: alle Regionen,
    // 3 Tage, Master+). Andere Filter rechnen live je id
    // (app/lib/tft-detail-builds.ts). optional: ein Fehlschlag traegt den
    // Vorlauf weiter und kippt den Nachtlauf nicht.
    'detail-builds': {
        apiPath: '/api/tft/detail-builds',
        permutations: [{ patch: 'current', region: 'all', days: 3, bucket: 'master_plus', minGames: 0, optional: true }],
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
// Detail-Vorrat je Comp-Familie (SEO-Plan Schritt 5b, E2): EIN Stand je
// Familie (`<trait>__<carry>`, familyKeyForMerge) statt je Slug — die
// Detail-Route antwortet fuer alle Mitglieds-Slugs gleich (bis auf
// aliasedFromFamily.anchorSlug), die Lese-Funktion app/lib/comp-detail-snapshot.ts
// prueft die Mitgliedschaft. Eigener Unterordner `family/`, damit Familien- und
// Slug-Schluessel nie zusammenfallen; `__` der Familie wird zu `.`, damit
// `__` weiter nur die Achsen trennt. Erstes Segment (Welle) bleibt
// `comps-detail` (Vertrag minPerWave). Bleibt import-frei: der Erzeuger
// uebersetzt nur diese Datei (build-snapshot-matrix.mjs).
export function compFamilySnapshotKey(p) {
    const patch = p.patch.replace(/[^A-Za-z0-9._-]/g, '_');
    const region = p.region.replace(/[^a-z0-9]/gi, '_');
    const bucket = p.bucket.replace(/[^a-z0-9_]/gi, '_');
    const family = p.family.replace(/__/g, '.').replace(/[^A-Za-z0-9._-]/g, '_');
    return `comps-detail/${patch}/family/${family}__${region}__${p.days}d__${bucket}.json`;
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
        const ended = o.patchFilter != null && o.patchEndDay != null && o.patchEndDay < o.latestDay;
        const anchor = ended ? new Date(o.patchEndDay + 'T00:00:00Z') : latest;
        const anchorStale = Math.max(0, Math.floor((today.getTime() - anchor.getTime()) / DAY_MS));
        // `day >= current_date - days` schliesst den Ankertag schon ein: N Tage bis
        // zum Anker brauchen days = Rueckstand + N - 1 (bis 2026-10-02 stand hier
        // + N, „3 Tage" las 4 Tage).
        if (anchorStale >= 1)
            days = Math.max(days, anchorStale + o.requestedDays - 1);
        if (o.patchFilter == null && o.patchStartDay && days > o.requestedDays) {
            const start = new Date(o.patchStartDay + 'T00:00:00Z');
            const sinceStart = Math.floor((today.getTime() - start.getTime()) / DAY_MS);
            if (sinceStart >= 1)
                days = Math.max(o.requestedDays, Math.min(days, sinceStart));
        }
        anchorOffsetDays = staleness;
    }
    return { days, anchorOffsetDays };
}
// ---------------------------------------------------------------------------
// Volle Tage (User 15.10.2026, Weg A2): „N Tage" heisst ueberall „die letzten
// N vollstaendigen Tage". Bis dahin lief jede Abfrage `day >= current_date -
// p_days` ohne Obergrenze und nahm ab dem Eingang der ersten Region (~08:14
// CEST) den halb gefuellten neuen Tag mit, waehrend der Vorrat vom Vorabend
// das alte Fenster zeigte (Azir Meister+/3 Tage: 6612 Vorrat vs 5439 live).
//
// Endtag E = letzter Tag, den alle lebenden Regionen geliefert haben
// (fullDayComplete). Das Fenster einer Anfrage rechnet dataWindow; die RPCs
// bekommen es als p_end_day + p_days (Migration 0095). Beides steht hier, weil
// Route, Vorab-Rechnung und Publisher dasselbe Fenster rechnen muessen.
const dayNum = (d) => Math.floor(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') / DAY_MS);
const numDay = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
/** ISO-Tag + n Tage (n darf negativ sein). */
export function addDays(day, n) {
    return numDay(dayNum(day) + n);
}
/**
 * Letzter vollstaendiger Tag: der neueste Tag D, fuer den JEDE lebende Region
 * eine fertige Zeile genau fuer D hat. Anders als metaPulseCompleteDay (nimmt
 * das Minimum der neuesten Tage) zaehlt eine Region mit Luecke am Tag D nicht
 * als geliefert — am 24.09. haette der 22.09. ohne euw1 sonst als vollstaendig
 * gegolten (data-skeptic F1). Lebend = neuester Tag >= Gesamtstand - 1;
 * ausgefallene Regionen halten den Tag nicht fest. Eine Zeile zaehlt erst nach
 * settleMs (finished_at wird vor den Comp-Zeilen geschrieben,
 * tft-supabase-writer.mjs). null = keine Aussage → altes Fenster.
 */
export function fullDayComplete(rows, regions, nowMs, settleMs = META_PULSE_COMPLETE_SETTLE_MS) {
    const wanted = new Set(regions);
    const daysBy = new Map();
    for (const r of rows) {
        if (!wanted.has(r.region) || !r.finished_at)
            continue;
        const fin = Date.parse(r.finished_at);
        if (!Number.isFinite(fin) || nowMs - fin < settleMs)
            continue;
        const n = dayNum(r.day);
        if (!Number.isFinite(n))
            continue;
        let s = daysBy.get(r.region);
        if (!s)
            daysBy.set(r.region, (s = new Set()));
        s.add(n);
    }
    if (daysBy.size === 0)
        return null;
    const newestBy = [...daysBy.values()].map(s => ({ s, newest: Math.max(...s) }));
    const newest = Math.max(...newestBy.map(x => x.newest));
    const alive = newestBy.filter(x => x.newest >= newest - 1);
    const floor = Math.min(...alive.map(x => Math.min(...x.s)));
    for (let d = Math.min(...alive.map(x => x.newest)); d >= floor; d--) {
        if (alive.every(x => x.s.has(d)))
            return numDay(d);
    }
    return null;
}
/**
 * Fenster einer Anfrage, endet am globalen Endtag `dataEnd`:
 *  - beendeter Patch (Filter, letzter Tag vor E) → endet an seinem letzten Tag;
 *  - Patch-Tag-Ausnahme (User 15.10.): hat der angezeigte bzw. gefilterte Patch
 *    noch keinen vollen Tag (erster Tag > E), zeigt die Seite seine Teildaten
 *    wie bisher → Ende = sein letzter Tag;
 *  - Start = Ende - N + 1, mit Patch-Filter nie vor dem Patch-Start.
 * `patch` ist die Zeile des gefilterten Patches bzw. ohne Filter die des
 * angezeigten aktuellen Patches (nur fuer die Ausnahme).
 */
export function dataWindow(o) {
    const n = Math.max(1, Math.floor(o.requestedDays) || 1);
    const e = dayNum(o.dataEnd);
    const first = o.patch ? dayNum(o.patch.first_day) : NaN;
    const last = o.patch ? dayNum(o.patch.last_day) : NaN;
    const known = Number.isFinite(first) && Number.isFinite(last) && first <= last;
    let end = e;
    if (known && first > e)
        end = last;
    else if (known && o.patchFilter != null && last < e)
        end = last;
    let start = end - n + 1;
    if (known && o.patchFilter != null && first > start)
        start = first;
    return { startDay: numDay(start), endDay: numDay(end), days: end - start + 1 };
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
// Vorpatch-Regel F7(c) (2026-10-05)
//
// „previous" = der juengste fruehere Patch mit mindestens
// PREVIOUS_PATCH_MIN_DAYS Datentagen. Ein Eintags-Patch (18.3: nur der 23.09.)
// taugt nicht als Vergleich und wird uebersprungen; direkt waehlbar bleibt er.
// Dieselbe Regel gilt im Leser (tft-supabase-reader.ts, api-cache.ts), in der
// Vorab-Rechnung (compPrecomputeJobs) und auf Meta-Pulse (Route und
// scripts/publish-meta-pulse-diffs.mjs) — sonst findet die Seite die
// vorgerechneten Eintraege nicht.
//
// Datentage = Kalenderspanne first_day..last_day aus get_tft_available_patches
// (Migration 0045, liest tft_daily_crawl_meta). Eine Zahl einzelner Tage
// liefert die RPC nicht; ein Ausfalltag mitten im Patch zaehlt also mit.
// Das Set prueft der Aufrufer — der Helfer kennt kein Set.
export const PREVIOUS_PATCH_MIN_DAYS = 3;
// Ab so vielen Tagen bleibt das Rising-Fenster auf Meta-Pulse im Patch
// (metaPulseVelocityWindow), darunter vergleicht es ueber die Patchgrenze.
export const VELOCITY_IN_PATCH_MIN_DAYS = 2;
export function patchDayCount(p) {
    if (!p?.first_day || !p?.last_day)
        return 0;
    const first = Date.parse(String(p.first_day).slice(0, 10) + 'T00:00:00Z');
    const last = Date.parse(String(p.last_day).slice(0, 10) + 'T00:00:00Z');
    if (!Number.isFinite(first) || !Number.isFinite(last) || last < first)
        return 0;
    return Math.round((last - first) / DAY_MS) + 1;
}
/**
 * Vorpatch von `refPatch` in einer Liste neuester-zuerst (wie
 * get_tft_available_patches sie liefert). null, wenn `refPatch` fehlt oder
 * kein frueherer Patch genug Tage hat — kein Rueckfall auf den Nachbarn.
 */
export function previousPatchOf(patches, refPatch, minDays = PREVIOUS_PATCH_MIN_DAYS) {
    if (!refPatch)
        return null;
    const idx = patches.findIndex(p => p.patch === refPatch);
    if (idx < 0)
        return null;
    for (let i = idx + 1; i < patches.length; i++) {
        if (patchDayCount(patches[i]) >= minDays)
            return patches[i];
    }
    return null;
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
// Alle Kombinationen, die das Box-Skript rechnet: aktuell ungefiltert plus der
// neueste etablierte Patch und sein Vorpatch nach previousPatchOf, beide nur
// aus dem laufenden Set, je Gruppe und je Tagesstufe 1..7. Ein uebersprungener
// Kurz-Patch ist nur direkt waehlbar und wird live gerechnet. Stufen mit
// gleichem data_start liefern dasselbe Ergebnis und erscheinen nur einmal.
export function compPrecomputeJobs(o) {
    const p = o.patches;
    if (p.length === 0)
        return [];
    const today = utcMidnight(o.today);
    const latestDay = p[0].last_day;
    const cases = [
        { patchKey: '', patchFilter: null, startDay: p[0].first_day, endDay: null },
    ];
    const prev = previousPatchOf(p, p[0].patch);
    for (const x of prev ? [p[0], prev] : [p[0]]) {
        if (Number(x.set_number) === o.setNumber) {
            cases.push({ patchKey: x.patch, patchFilter: x.patch, startDay: x.first_day, endDay: x.last_day });
        }
    }
    const out = [];
    const seen = new Set();
    for (const c of cases) {
        for (const [bucketLabel, tiers] of Object.entries(COMP_PRECOMPUTE_BUCKETS)) {
            for (let requestedDays = 1; requestedDays <= 7; requestedDays++) {
                let days;
                let dataStart;
                let windowEnd;
                if (o.dataEnd) {
                    // Ohne Filter gilt fuer die Patch-Tag-Ausnahme der angezeigte Patch p[0].
                    const row = c.patchFilter ? { first_day: c.startDay, last_day: c.endDay ?? latestDay } : p[0];
                    const w = dataWindow({ dataEnd: o.dataEnd, requestedDays, patchFilter: c.patchFilter, patch: row });
                    days = w.days;
                    dataStart = w.startDay;
                    windowEnd = w.endDay;
                }
                else {
                    ({ days } = listWindowDays({
                        requestedDays, patchFilter: c.patchFilter, patchStartDay: c.startDay, patchEndDay: c.endDay,
                        latestDay, today,
                    }));
                    const windowStart = isoDay(new Date(today.getTime() - days * DAY_MS));
                    dataStart = c.patchFilter && c.startDay > windowStart ? c.startDay : windowStart;
                    windowEnd = c.endDay && c.endDay < latestDay ? c.endDay : latestDay;
                }
                const key = `${c.patchKey}|${bucketLabel}|${dataStart}|${windowEnd}`;
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
                    windowEnd,
                    fullDay: !!o.dataEnd,
                });
            }
        }
    }
    return out;
}
// Darf die Route einen gefundenen Eintrag benutzen? Nur wenn er dasselbe
// Fenster-Ende hat wie die Route (mit endDay: window_end, Migration 0095;
// ohne: denselben letzten Datentag, sonst fehlt ein neuer Tag), nicht verwaist
// ist und mit hoechstens der angefragten Mindestspiele-Zahl gerechnet wurde
// (niedriger laesst sich nachfiltern, hoeher nicht).
export function precomputedEntryUsable(e, o) {
    if (!e)
        return false;
    if (o.endDay) {
        if (String(e.window_end ?? '').slice(0, 10) !== o.endDay.slice(0, 10))
            return false;
    }
    else {
        if (!o.latestDay)
            return false;
        if (String(e.last_day).slice(0, 10) !== o.latestDay.slice(0, 10))
            return false;
    }
    const age = o.now - Date.parse(e.computed_at);
    if (!Number.isFinite(age) || age > COMP_PRECOMPUTE_MAX_AGE_MS)
        return false;
    return Number(e.min_games) <= o.requestedMinGames;
}
// ---------------------------------------------------------------------------
// Meta-Pulse: vorgerechnete Patch-Vergleiche (2026-10-01)
// ---------------------------------------------------------------------------
// Der Patch-Vergleich ueber alle Regionen braucht live 7-20 s und laeuft dabei
// an den 20-s-Deckel der Datenbank. Die Box rechnet ihn stuendlich ueber eine
// direkte Verbindung (ohne diesen Deckel) vor: scripts/publish-meta-pulse-diffs.mjs.
// Ein Blob je (Patch, Rang-Gruppe), nur fuer region=all — Einzelregionen sind
// live billig. Die Route nimmt den Blob nur, wenn er zur Anfrage passt und
// mindestens so viele Spiele kennt wie ihre eigene Patch-Liste.
export const META_PULSE_DIFF_MIN_GAMES = 80;
export const META_PULSE_DIFF_MAX_AGE_MS = 36 * 60 * 60 * 1000;
// Abgeschlossene Patches (nicht der neueste der Liste) bekommen keine Spiele
// mehr dazu. Ihr Vergleich liest von der Platte (18.2: 23-45 s, 2026-10-01 kippte
// die DB nach wiederholten Laeufen) — deshalb rechnet die Box sie nur woechentlich.
export const META_PULSE_DIFF_CLOSED_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const META_PULSE_DIFF_BUCKETS = COMP_PRECOMPUTE_BUCKETS;
// Kulanz beim Lesen (2026-10-18). Die Box schreibt den laufenden Patch erst zur
// naechsten vollen Stunde neu, die Patch-Liste der Route kennt neue Spiele aber
// sofort (gemessen 18.10. 12:26 UTC: Datei 5.136.760, Liste 5.151.160) — tagsueber
// rechneten Patch-Gewinner und Meta Pulse deshalb fast immer live (10-20 s). Mit
// graceMs gilt eine junge Datei trotzdem, wenn sie hoechstens einen Kalendertag
// hinter der Liste liegt. NUR die Leser (meta-pulse-diff-snapshot.ts) uebergeben
// graceMs: die Box entscheidet mit denselben Pruefern, ob sie ueberspringen darf
// (publish-meta-pulse-diffs.mjs), und muss dabei streng bleiben.
export const RUNNING_PATCH_GRACE_MS = 2 * 60 * 60 * 1000;
function withinRunningGrace(s, wantLastDay, now, graceMs) {
    if (!graceMs || !(graceMs > 0))
        return false;
    const age = now - Date.parse(String(s.generatedAt));
    if (!Number.isFinite(age) || age < -5 * 60 * 1000 || age > graceMs)
        return false;
    const lag = dayNum(String(wantLastDay)) - dayNum(String(s.lastDay ?? ''));
    return Number.isFinite(lag) && lag <= 1;
}
export function metaPulseDiffPath(patch, bucketLabel) {
    return `tft/meta-pulse/diff/${patch}/all__${bucketLabel}.json`;
}
export function isValidMetaPulseDiff(snap, want) {
    if (!snap || typeof snap !== 'object')
        return false;
    const s = snap;
    if (s.v !== 1 || !Array.isArray(s.rows) || !Array.isArray(s.regions) || !Array.isArray(s.buckets))
        return false;
    if (Number(s.set) !== want.set || s.patch !== want.patch)
        return false;
    if (listKey(s.regions) !== listKey(want.regions) || listKey(s.buckets) !== listKey(want.buckets))
        return false;
    if (Number(s.minGames) !== META_PULSE_DIFF_MIN_GAMES)
        return false;
    // Kennt der Blob weniger Tage oder Spiele als die Patch-Liste der Route,
    // sind seither Daten dazugekommen → live rechnen (ausser Kulanz, s. o.).
    if (String(s.lastDay ?? '').slice(0, 10) < String(want.lastDay).slice(0, 10)
        || !(Number(s.totalMatches) >= Number(want.totalMatches))) {
        return !want.closed && withinRunningGrace(s, want.lastDay, want.now, want.graceMs);
    }
    const age = want.now - Date.parse(String(s.generatedAt));
    const maxAge = want.closed ? META_PULSE_DIFF_CLOSED_MAX_AGE_MS : META_PULSE_DIFF_MAX_AGE_MS;
    return Number.isFinite(age) && age >= -5 * 60 * 1000 && age <= maxAge;
}
// Reihenfolge = Rechenreihenfolge der Box: Items zuletzt (langsamste Abfrage).
export const PATCH_DIFF_ENTITIES = ['unit', 'trait', 'comp', 'item'];
export const PATCH_DIFF_RPC = {
    unit: 'get_tft_unit_stats',
    // Schlanke Variante (Migration 0028): die volle get_tft_item_stats laeuft bei
    // 30 Tagen in den Deckel.
    item: 'get_tft_item_stats_list',
    trait: 'get_tft_trait_stats',
    comp: 'get_tft_comp_stats_for_diff',
};
// Nur diese Spalten holt die Box (die Item-Funktion liefert sonst jsonb mit).
export const PATCH_DIFF_COLUMNS = {
    unit: ['character_id', 'games', 'sum_placement', 'top4', 'participants'],
    item: ['api_name', 'games', 'sum_placement', 'top4', 'total_item_slots'],
    // Stufe mit (seit 18.10.2026): der Δ-Vergleich der Traits-Liste gilt fuer
    // die gezeigte Stufe; Patch-Gewinner zaehlt sie per sumPatchDiffLevels zusammen.
    trait: ['name', 'activation', 'games', 'sum_placement', 'top4', 'participants'],
    comp: ['cluster_key', 'games', 'sum_placement', 'top4', 'participants'],
};
// Altes Fenster: die letzten 30 Tage ab heute. Schnitt still alles ab, was
// weiter zurueckliegt — ein abgeschlossener Patch schrumpfte so von Woche zu
// Woche (data-skeptic 18.10.2026: 18.2b noch mit 5 von 9 Tagen).
export const PATCH_DIFF_P_DAYS = 30;
// Neues Fenster (18.10.2026): genau der Patch, p_end_day = sein letzter Tag,
// p_days = seine Tage (Migration 0095). Blobs tragen dann window 'patch'.
// Alte Blobs (days 30, ohne window) gelten fuer Leser weiter, bis die Box sie
// ersetzt hat; die Box selbst verlangt das neue Fenster (requireWindow).
export const PATCH_DIFF_WINDOW = 'patch';
/** RPC-Fenster fuer genau einen Patch; null ohne brauchbare Tage. */
export function patchDiffWindowArgs(p) {
    const days = patchDayCount(p);
    return days >= 1 ? { p_days: days, p_end_day: String(p.last_day).slice(0, 10) } : null;
}
// Mindestspiele je Seite im Vergleich; die Comp-Funktion filtert selbst damit.
export const PATCH_DIFF_MIN_GAMES = 50;
export const PATCH_DIFF_MAX_AGE_MS = 36 * 60 * 60 * 1000;
export const PATCH_DIFF_CLOSED_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
// Die Rang-Auswahlen der Gewinner-Seite (all/diamond/master_plus/
// grandmaster_plus), der Patch-Seite (dazu challenger) und des Feeds
// (master_plus). Seit 18.10.2026 zusaetzlich jede Rang-Auswahl der
// Filterleiste (Δ-Vergleich „vs Vorpatch" auf Comps/Units/Items/Traits).
// Tests: muss expandBuckets() im Leser entsprechen, jede Option der
// Filterleiste muss hier stehen.
export const PATCH_DIFF_BUCKETS = {
    all: LADDER_UP,
    diamond: ['diamond'],
    master_plus: plusFrom('master'),
    grandmaster_plus: plusFrom('grandmaster'),
    challenger: ['challenger'],
    diamond_plus: plusFrom('diamond'),
    emerald_plus: plusFrom('emerald'),
    platinum_plus: plusFrom('platinum'),
    gold: ['gold'],
    silver: ['silver'],
    bronze: ['bronze'],
};
// Die Box rechnet diese Gruppen zuerst (fuer alle Arten und Patches), die
// uebrigen danach — eine Notbremse in den neuen haelt die alten nicht auf.
export const PATCH_DIFF_CORE_BUCKETS = ['all', 'diamond', 'master_plus', 'grandmaster_plus', 'challenger'];
export function patchDiffPath(patch, entity, bucketLabel) {
    return `tft/patch-diff/${patch}/${entity}/all__${bucketLabel}.json`;
}
// RPC-Zeilen → eine Zeile je Schluessel, bei Traits je Schluessel und Stufe.
// Teilnehmer = Gesamtzahl der ersten Zeile.
export function normalizePatchDiffRows(entity, rows) {
    if (entity === 'trait') {
        const participants = Number(rows[0]?.participants || 0);
        const byLevel = new Map();
        for (const r of rows) {
            const name = String(r.name);
            const level = Number(r.activation);
            const id = `${name}|${level}`;
            const cur = byLevel.get(id) || { key: name, level, games: 0, sum_placement: 0, top4: 0, participants };
            cur.games += Number(r.games);
            cur.sum_placement += Number(r.sum_placement);
            cur.top4 += Number(r.top4);
            byLevel.set(id, cur);
        }
        return [...byLevel.values()];
    }
    const keyField = entity === 'unit' ? 'character_id' : entity === 'item' ? 'api_name' : 'cluster_key';
    const participants = Number(rows[0]?.[entity === 'item' ? 'total_item_slots' : 'participants'] || 0);
    return rows.map(r => ({
        key: String(r[keyField]),
        games: Number(r.games),
        sum_placement: Number(r.sum_placement),
        top4: Number(r.top4),
        participants,
    }));
}
// Eine Zeile je Schluessel: Trait-Stufen zusammengezaehlt. Patch-Gewinner
// fragt „wurde die Eigenschaft gebufft/generft?" — nicht nach der Stufe.
// Zeilen ohne Stufe (alte Blobs, andere Arten) bleiben unveraendert.
export function sumPatchDiffLevels(rows) {
    const byKey = new Map();
    for (const r of rows) {
        const cur = byKey.get(r.key);
        if (!cur) {
            byKey.set(r.key, { key: r.key, games: r.games, sum_placement: r.sum_placement, top4: r.top4, participants: r.participants });
            continue;
        }
        cur.games += r.games;
        cur.sum_placement += r.sum_placement;
        cur.top4 += r.top4;
    }
    return [...byKey.values()];
}
// Laufender Patch: Blob muss mindestens den letzten Tag und die Spielzahl der
// Patch-Liste kennen und hoechstens 36 h alt sein. Abgeschlossener Patch: nur
// letzter Tag und 14 Tage — keine Spielzahl, weil Route (180-Tage-Liste) und
// Box (30-Tage-Liste) fuer alte Patches verschiedene Summen sehen (18.1b am
// 07.10.: 5.125.888 gegen 1.685.440). Set muss gleich sein → Vergleiche ueber
// eine Set-Grenze rechnet die Route live wie bisher.
export function isValidPatchDiff(snap, want) {
    if (!snap || typeof snap !== 'object')
        return false;
    const s = snap;
    if (s.v !== 1 || !Array.isArray(s.rows) || !Array.isArray(s.regions) || !Array.isArray(s.buckets))
        return false;
    if (s.entity !== want.entity || Number(s.set) !== want.set || s.patch !== want.patch)
        return false;
    if (listKey(s.regions) !== listKey(want.regions) || listKey(s.buckets) !== listKey(want.buckets))
        return false;
    if (s.window === PATCH_DIFF_WINDOW) {
        if (!(Number(s.days) >= 1))
            return false;
    }
    else if (want.requireWindow || Number(s.days) !== PATCH_DIFF_P_DAYS) {
        return false;
    }
    if (Number(s.minGames) !== PATCH_DIFF_MIN_GAMES)
        return false;
    if (String(s.lastDay ?? '').slice(0, 10) < String(want.lastDay).slice(0, 10)
        || (!want.closed && !(Number(s.totalMatches) >= Number(want.totalMatches)))) {
        return !want.closed && withinRunningGrace(s, want.lastDay, want.now, want.graceMs);
    }
    const age = want.now - Date.parse(String(s.generatedAt));
    const maxAge = want.closed ? PATCH_DIFF_CLOSED_MAX_AGE_MS : PATCH_DIFF_MAX_AGE_MS;
    return Number.isFinite(age) && age >= -5 * 60 * 1000 && age <= maxAge;
}
// ---------------------------------------------------------------------------
// Meta-Pulse: vorgerechnete Velocity („Aufsteiger", 2026-10-02)
// ---------------------------------------------------------------------------
// get_tft_comp_velocity ueber alle Regionen braucht kalt bis 12 s (Meister+,
// Abstand 3, gemessen 2026-10-02). Die Box rechnet sie im selben Lauf wie die
// Patch-Vergleiche vor. Route und Box nutzen dieselbe Fensterrechnung
// (metaPulseVelocityWindow), damit beide genau dieselben Fenster meinen.
// Schluessel ist das tatsaechlich genutzte Fenster mit absolutem Ankertag —
// so verschiebt sich nichts ueber Mitternacht, und alle Kombinationen aus
// Tagen 1-7 und Abstand 1/2/3/7/14 fallen auf wenige Blobs zusammen.
export const META_PULSE_VELOCITY_MIN_GAMES = 100;
export const META_PULSE_VELOCITY_SHIFTS = [1, 2, 3, 7, 14];
export const META_PULSE_VELOCITY_DEFAULT_SHIFT = 3;
export const META_PULSE_VELOCITY_MAX_AGE_MS = 36 * 60 * 60 * 1000;
// Rising-Vergleichsfenster an das Patch-Alter anpassen. Die Velocity-RPC
// filtert beide Fenster auf denselben Patch — bei einem 1-Tage-Patch waere
// das Vergleichsfenster leer und die Liste immer leer.
//   • Patch ≥2 Tage: im Patch bleiben, Fenster schrumpfen, ohne Ueberlappung.
//   • Patch 1 Tag: letzter Patch-Tag gegen letzten Tag des Vorpatches.
// Die RPC ankert an current_date − offset: fuer den neuesten Patch am
// Datenstand (latestOffsetDays aus listWindowDays), fuer aeltere an deren
// letztem Tag.
export function metaPulseVelocityWindow(o) {
    const dayNum = (d) => (d ? Math.floor(Date.parse(d) / DAY_MS) : NaN);
    const curFirst = dayNum(o.sel?.first_day);
    let curLast = dayNum(o.sel?.last_day);
    const prevLast = dayNum(o.cmpLastDay);
    let anchorOffsetDays = o.selIdx === 0 || !Number.isFinite(curLast)
        ? o.latestOffsetDays
        : Math.max(0, o.todayNum - curLast);
    // Neuester Tag erst teilweise da (Regionen treffen ueber den Tag verteilt
    // ein): Fenster am letzten vollstaendigen Tag enden lassen. Liegt der vor
    // dem Patch-Start, bleibt es beim neuesten Tag.
    const complete = dayNum(o.completeDay);
    if (o.selIdx === 0 && Number.isFinite(complete) && complete >= curFirst && complete < curLast) {
        curLast = complete;
        anchorOffsetDays = Math.max(0, o.todayNum - complete);
    }
    const patchDays = Number.isFinite(curFirst) && Number.isFinite(curLast) ? curLast - curFirst + 1 : 0;
    let mode = 'patch';
    let effShift = o.velocityShift;
    let effDays = o.requestedDays;
    let velocityPatch = o.sel?.patch ?? null;
    if (patchDays >= VELOCITY_IN_PATCH_MIN_DAYS) {
        effShift = Math.min(o.velocityShift, patchDays - 1);
        effDays = Math.max(1, Math.min(o.requestedDays, effShift, patchDays - effShift));
    }
    else if (o.previousPatch
        && Number.isFinite(curLast) && Number.isFinite(prevLast) && curLast > prevLast) {
        mode = 'crossPatch';
        effShift = curLast - prevLast;
        effDays = 1;
        velocityPatch = null;
    }
    const anchorDay = isoDay(new Date((o.todayNum - anchorOffsetDays) * DAY_MS));
    return { mode, effShift, effDays, velocityPatch, anchorOffsetDays, anchorDay };
}
// Letzter Tag, fuer den alle Regionen ihre Tageszahlen haben. Quelle:
// tft_daily_crawl_meta (region, day, finished_at) der letzten Tage, nur das
// gewaehlte Set, alle Buckets (die Bucket-Zahl je Region schwankt 8-10).
// Eine Zeile zaehlt erst nach META_PULSE_COMPLETE_SETTLE_MS — die Meta-Zeile
// wird vor den Comp-Zahlen geschrieben. Regionen, deren neuester Tag mehr als
// einen Tag hinter dem Gesamtstand liegt, gelten als ausgefallen und halten
// den Anker nicht fest. null = keine Aussage moeglich → bisheriges Verhalten.
export const META_PULSE_COMPLETE_SETTLE_MS = 10 * 60 * 1000;
/** Zeilen ab neuester Tag − 2 reichen (ausgefallen = neuester Tag < Gesamtstand − 1). */
export const META_PULSE_COMPLETE_LOOKBACK_DAYS = 2;
export function metaPulseCompleteDay(rows, regions, nowMs, 
// 0 fuer den Snapshot-Publisher: er startet erst nach dem kompletten
// Crawl-Lauf, die Wartezeit wuerde die letzte Region (vn2) ausschliessen.
settleMs = META_PULSE_COMPLETE_SETTLE_MS) {
    const wanted = new Set(regions);
    const latest = new Map();
    for (const r of rows) {
        if (!wanted.has(r.region) || !r.finished_at)
            continue;
        const fin = Date.parse(r.finished_at);
        if (!Number.isFinite(fin) || nowMs - fin < settleMs)
            continue;
        const day = String(r.day).slice(0, 10);
        const prev = latest.get(r.region);
        if (!prev || day > prev)
            latest.set(r.region, day);
    }
    if (latest.size === 0)
        return null;
    const toNum = (d) => Math.floor(Date.parse(d) / DAY_MS);
    const days = [...latest.values()];
    const newest = Math.max(...days.map(toNum));
    const alive = days.map(toNum).filter(n => n >= newest - 1);
    return isoDay(new Date(Math.min(...alive) * DAY_MS));
}
export function metaPulseVelocityPath(patch, bucketLabel, w) {
    return `tft/meta-pulse/velocity/${patch}/all__${bucketLabel}__${w.mode}_a${w.anchorDay}_d${w.effDays}_s${w.effShift}.json`;
}
export function isValidMetaPulseVelocity(snap, want) {
    if (!snap || typeof snap !== 'object')
        return false;
    const s = snap;
    if (s.v !== 1 || !Array.isArray(s.rows) || !Array.isArray(s.regions) || !Array.isArray(s.buckets))
        return false;
    if (Number(s.set) !== want.set || s.patch !== want.patch || (s.comparePatch ?? null) !== want.comparePatch)
        return false;
    if (listKey(s.regions) !== listKey(want.regions) || listKey(s.buckets) !== listKey(want.buckets))
        return false;
    if (Number(s.minGames) !== META_PULSE_VELOCITY_MIN_GAMES)
        return false;
    const w = want.window;
    if (s.mode !== w.mode || s.anchorDay !== w.anchorDay
        || Number(s.effDays) !== w.effDays || Number(s.effShift) !== w.effShift)
        return false;
    // Spaet eintreffende Regionen erhoehen die Spielzahl des Patches → live
    // rechnen (ausser Kulanz, s. RUNNING_PATCH_GRACE_MS).
    if (String(s.lastDay ?? '').slice(0, 10) < String(want.lastDay).slice(0, 10)
        || !(Number(s.totalMatches) >= Number(want.totalMatches))
        || (w.mode === 'crossPatch'
            && !(Number(s.compareTotalMatches) >= Number(want.compareTotalMatches ?? Infinity)))) {
        return withinRunningGrace(s, want.lastDay, want.now, want.graceMs);
    }
    const age = want.now - Date.parse(String(s.generatedAt));
    return Number.isFinite(age) && age >= -5 * 60 * 1000 && age <= META_PULSE_VELOCITY_MAX_AGE_MS;
}
