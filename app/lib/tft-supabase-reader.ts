// Server-side reader for the Supabase-backed TFT daily stats. Wraps the
// Postgres RPC functions in supabase/migrations/0002_tft_stats_rpcs.sql with
// the filter parameter expansion the API routes need (region groups, bucket
// groups, patch resolution from "current"/"previous" to the actual string).
//
// All RPC calls use the service role key — this code runs on the server only.

import { ACTIVE_REGIONS, ACTIVE_REGIONS_WEST, ACTIVE_REGIONS_ASIA } from './active-regions';
import { CURRENT_SET } from './current-set';

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Re-exports unter alten Namen — Konsumenten aus den Stats-APIs greifen
// historisch auf ALL_REGIONS/WEST_REGIONS/ASIA_REGIONS zu. Single-Source liegt
// in app/lib/active-regions.ts (synchron mit scripts/lib/active-regions.mjs).
export const ALL_REGIONS = [...ACTIVE_REGIONS];
export const WEST_REGIONS = [...ACTIVE_REGIONS_WEST];
export const ASIA_REGIONS = [...ACTIVE_REGIONS_ASIA];

export const REGION_GROUPS: Record<string, string[]> = {
  all: ALL_REGIONS,
  west: WEST_REGIONS,
  asia: ASIA_REGIONS,
};

export const ALL_BUCKETS = [
  'bronze', 'silver', 'gold', 'platinum', 'emerald',
  'diamond', 'master', 'grandmaster', 'challenger',
];
export const BUCKET_GROUPS: Record<string, string[]> = {
  all: ALL_BUCKETS,
  master_plus: ['master', 'grandmaster', 'challenger'],
  // diamond_plus expands to diamond + master_plus tiers. War vor 2026-06-25
  // ein BUG: snapshot-matrix.ts hatte `diamond_plus` in PRIMARY_BUCKETS, aber
  // BUCKET_GROUPS hatte keinen Eintrag → expandBuckets() fiel zu ['diamond_plus']
  // durch → matched 0 Rows in tft_daily_comp_stats (kein `bucket='diamond_plus'`-
  // Row existiert in der DB) → 36 Permutationen schrieben hasData:false und
  // wurden als skipped behandelt → 502-Symptom bei Live-API-Calls auf
  // diamond_plus-Filter. Multi-Review 2026-06-25 (perf-critic F8 + data-skeptic
  // F8) konvergent. DB-Probe verifiziert: aggregiert = 16410 rows, 1097 clusters,
  // 719k games über 7d Set 17 → substantielle Daten verfügbar.
  diamond_plus: ['diamond', 'master', 'grandmaster', 'challenger'],
  // pro_pool is a synthetic bucket: rows are written by the aggregator
  // alongside tier-bucket rows when a TFT pro participated in the match.
  // Exposed as an identity group so callers can pass bucket=pro_pool and
  // get the Pro-only slice without naming convention awareness.
  pro_pool: ['pro_pool'],
};

export interface ResolvedFilters {
  regions: string[];     // exact platform routings, expanded from groups
  buckets: string[];     // exact bucket names
  days: number;          // 1-7 — already bumped to cover stale-data lag
  requestedDays: number; // 1-7 — raw user choice, pre-bump (use for Δ-windows)
  // patch (display): immer der konkrete Patch-String. Bei ?patch=current ist
  //   das `patches[0].patch`, dient nur der UI-Anzeige ("Patch 17.5 seit …").
  //   Wird AUCH als Cache-Key und Snapshot-Key benutzt.
  // patchFilter (RPC-Filter): null = keine Filterung → patchübergreifende
  //   Aggregation. Explicit Patch-String filtert die RPC auf diesen Patch.
  //   Default-View (current) hat patchFilter=null — der Default-User sieht
  //   aggregierte Daten und wird durch den Patch-Frische-Hinweis informiert.
  patch: string | null;
  patchFilter: string | null;
  patchStartDay: string | null;  // ISO-day des display-patch first_day, für UI-Hint
  setNumber: number | null;
  // true wenn der Bucket NICHT vom User gewaehlt wurde, sondern serverseitig
  // aus der Datenlage des laufenden Sets abgeleitet ist (resolveDefaultBucket).
  // Die UI spiegelt den gelieferten Bucket in den Dropdown, damit angezeigter
  // und tatsaechlich benutzter Rang uebereinstimmen.
  bucketAuto: boolean;
  regionLabel: string;   // raw filter value for display ('all','west','euw1',…)
  bucketLabel: string;   // raw filter value for display
  // Days between current_date and the latest available stats day. Velocity /
  // Δ-windows must anchor at (current_date - anchorOffsetDays), otherwise a
  // 1-day Δ-window over a 4-day-stale pipeline lands in an empty range.
  anchorOffsetDays: number;
}

// Erlaubte Einzelwerte. Frueher reichten beide Expander unbekannte Strings
// unveraendert an die RPCs durch. Das ist keine Injection (die Werte gehen
// parametrisiert raus), aber jeder erfundene Wert erzeugt eine eigene
// DB-Abfrage und einen eigenen Cache-Key — ein Angreifer kann damit beliebig
// viele Abfragen am Cache vorbei ausloesen, die garantiert nichts finden.
const ALLOWED_BUCKET_VALUES = new Set([...ALL_BUCKETS, 'pro_pool']);
const ALLOWED_REGION_VALUES = new Set(ALL_REGIONS.map(r => r.toLowerCase()));

// Expand a filter param like "all" or "euw1,kr" into a flat region list.
export function expandRegions(param: string | null): string[] {
  if (!param || param === 'all') return REGION_GROUPS.all;
  if (REGION_GROUPS[param]) return REGION_GROUPS[param];
  const picked = param.split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => ALLOWED_REGION_VALUES.has(s));
  return picked.length > 0 ? picked : REGION_GROUPS.all;
}

export function expandBuckets(param: string | null): string[] {
  if (!param || param === 'all') return BUCKET_GROUPS.all;
  if (BUCKET_GROUPS[param]) return BUCKET_GROUPS[param];
  const picked = param.split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => ALLOWED_BUCKET_VALUES.has(s));
  return picked.length > 0 ? picked : BUCKET_GROUPS.master_plus;
}

export interface PatchInfo {
  patch: string;
  set_number: number;
  first_day: string;
  last_day: string;
  total_matches: number;
}

let _patchCache: { ts: number; rows: PatchInfo[] } | null = null;

// A freshly-released patch surfaces here on its first (usually partial) crawl
// day with only a few thousand games — far too thin for the comp view's
// per-cluster min-games threshold, so the page rendered "Noch keine Daten" for
// the ~1 partial day after every patch drop. Drop patches below this volume so
// "current"/"previous" + the patch dropdown resolve to the newest ESTABLISHED
// patch. total_matches = sum(comp games) from get_tft_available_patches; a full
// crawl day is ~250k while a partial patch-drop day is ~10k.
const PATCH_MIN_GAMES = 100_000;

// get_tft_available_patches scans the whole comp-stats day window (~148k rows)
// to derive ~3 patch rows: ~70ms warm but ~2.4s cold (after a crawl the fresh
// rows' visibility map isn't all-visible yet, so the index-only scan pays heap
// fetches). It runs before EVERY stats RPC and the result is identical for all
// callers and changes at most once a day, so we cache it module-wide for 6h —
// a warm instance pays the query at most once per window instead of every
// request. 6h staleness is harmless: a new patch is filtered by PATCH_MIN_GAMES
// until it has ~half a crawl day anyway, so it can't surface as "current" early.
const PATCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Negative-Cache für Cold-Lambda + RPC-down: 60 s statt 6 h. Damit erholt sich
// die Listing-Page schnell sobald Supabase wieder antwortet (statt 6h Stale-
// EmptyData wenn der Cold-Path während eines Outages stirbt).
const PATCH_NEGATIVE_CACHE_TTL_MS = 60 * 1000;
let _patchCacheNegativeTs = 0;

export async function getAvailablePatches(days = 30): Promise<PatchInfo[]> {
  if (_patchCache && Date.now() - _patchCache.ts < PATCH_CACHE_TTL_MS) {
    return _patchCache.rows;
  }
  // Negative-Cache: wenn der letzte Call gerade fehlgeschlagen ist, NICHT
  // sofort wieder probieren — sonst blockiert jede Listing-Request 30-60s
  // bis zum nächsten Cloudflare-522. Für 60s leere Liste ausliefern, dann
  // Retry.
  if (_patchCacheNegativeTs && Date.now() - _patchCacheNegativeTs < PATCH_NEGATIVE_CACHE_TTL_MS) {
    return [];
  }
  try {
    const rows = (await callRpc<PatchInfo[]>('get_tft_available_patches', { p_days: days })) || [];
    // Never return empty: if every patch is below the floor (e.g. right after a
    // set launch) keep the raw list so the page still shows the best available.
    const established = rows.filter(r => Number(r.total_matches) >= PATCH_MIN_GAMES);
    _patchCache = { ts: Date.now(), rows: established.length > 0 ? established : rows };
    _patchCacheNegativeTs = 0;
    return _patchCache.rows;
  } catch (e) {
    // Stale-serve: a cold-buffer statement timeout on this pre-flight query must
    // not blank the patch dropdown or 502 the whole stats page. Fall back to the
    // last good list (even if expired) when we have one.
    if (_patchCache) return _patchCache.rows;
    // Cold-Lambda + RPC-down: KEIN throw mehr (code-analyzer-Verdict
    // 2026-06-21 — würde sonst alle 4 Listing-Routes mit EmptyData killen
    // weil sie getAvailablePatches als Pre-Flight aufrufen). Stattdessen
    // leere Liste + Negative-Cache. resolveFilters läuft mit patchFilter=
    // null durch → Stats-RPCs aggregieren patchübergreifend → User sieht
    // Daten statt EmptyData.
    console.error(
      '[tft] getAvailablePatches failed without cache, returning empty for 60s:',
      (e as Error).message,
    );
    _patchCacheNegativeTs = Date.now();
    return [];
  }
}

// "current" → newest patch, "previous" → second-newest, else literal string.
async function resolvePatch(param: string | null): Promise<string | null> {
  if (!param || param === 'any') return null;
  if (param === 'current') {
    const patches = await getAvailablePatches();
    return patches[0]?.patch ?? null;
  }
  if (param === 'previous') {
    const patches = await getAvailablePatches();
    return patches[1]?.patch ?? null;
  }
  return param;
}

// ---------------------------------------------------------------------------
// Default-Bucket aus der Datenlage des laufenden Sets
//
// Zum Set-Start wird die Ladder zurueckgesetzt. Gemessen 2026-08-27, einen Tag
// nach dem Set-18-Start: Set 18 hat 0 Games in diamond/master/grandmaster/
// challenger, aber ~400k in gold/silver/platinum/bronze. Der UI-Default
// `diamond_plus` wuerde damit LEERE Seiten liefern, sobald wir (richtigerweise)
// auf das laufende Set pinnen. Statt einer geratenen Karenzfrist fragen wir die
// tatsaechliche Verteilung ab und schalten den Default so lange auf `all` —
// und automatisch zurueck, sobald Diamond+ traegt.
//
// Nur der DEFAULT wird umgeschaltet. Wer im Dropdown bewusst Diamond+ waehlt,
// bekommt Diamond+ (und ggf. eine ehrlich leere Liste).
export const DEFAULT_BUCKET = 'diamond_plus';
export const DEFAULT_BUCKET_FALLBACK = 'all';

// Schwelle: darunter ist Diamond+ fuer das laufende Set nicht tragfaehig.
// 20k Games ueber 7 Tage liegt klar ueber dem Rauschen der ersten
// Diamond-Aufsteiger und weit unter einem normalen Set-Mittelfeld (Set 17
// hatte im selben Fenster 719k).
const DEFAULT_BUCKET_MIN_GAMES = 20_000;

// 6 h, analog zum Patch-Cache: die Antwort aendert sich hoechstens einmal
// taeglich (der Aggregator schreibt einmal pro Tag) und ist fuer alle Aufrufer
// identisch. Negativ-Cache 60 s, damit ein Supabase-Haenger nicht 6 h lang den
// Default festnagelt.
const BUCKET_COVERAGE_TTL_MS = 6 * 60 * 60 * 1000;
const BUCKET_COVERAGE_NEGATIVE_TTL_MS = 60 * 1000;
let _bucketCoverageCache: { ts: number; bucket: string } | null = null;
let _bucketCoverageNegativeTs = 0;

export async function resolveDefaultBucket(): Promise<string> {
  if (_bucketCoverageCache && Date.now() - _bucketCoverageCache.ts < BUCKET_COVERAGE_TTL_MS) {
    return _bucketCoverageCache.bucket;
  }
  if (_bucketCoverageNegativeTs
      && Date.now() - _bucketCoverageNegativeTs < BUCKET_COVERAGE_NEGATIVE_TTL_MS) {
    return _bucketCoverageCache?.bucket ?? DEFAULT_BUCKET;
  }
  try {
    const rows = (await callRpc<Array<{ bucket: string; games: number | string }>>(
      'get_tft_set_bucket_coverage', { p_set: CURRENT_SET, p_days: 7 },
    )) || [];
    const tiers = new Set(BUCKET_GROUPS[DEFAULT_BUCKET]);
    let games = 0;
    for (const r of rows) if (tiers.has(r.bucket)) games += Number(r.games) || 0;
    const bucket = games >= DEFAULT_BUCKET_MIN_GAMES ? DEFAULT_BUCKET : DEFAULT_BUCKET_FALLBACK;
    _bucketCoverageCache = { ts: Date.now(), bucket };
    _bucketCoverageNegativeTs = 0;
    return bucket;
  } catch (e) {
    if (_bucketCoverageCache) return _bucketCoverageCache.bucket;
    console.error('[tft] get_tft_set_bucket_coverage failed:', (e as Error).message);
    _bucketCoverageNegativeTs = Date.now();
    return DEFAULT_BUCKET;
  }
}

export async function resolveFilters(searchParams: URLSearchParams): Promise<ResolvedFilters> {
  const regionLabel = searchParams.get('region') || 'all';
  // C3 (2026-07-04): single-tier `diamond` has no snapshot coverage and was the
  // highest-traffic 521-causer on the heavy detoast RPCs. diamond_plus is its
  // strict superset (diamond+master+GM+chall) and IS snapshot-covered. Coerce
  // centrally here so a direct ?bucket=diamond API hit — not just the removed
  // dropdown option — resolves onto the snapshot. Only the resolveFilters-fed
  // stats routes are affected; regions/patch parse bucket independently and keep
  // single-tier diamond.
  // bucketAuto: die UI sendet `bucketAuto=1` solange der Rang-Filter nicht vom
  // User gesetzt wurde. Dann (und nur dann) entscheidet der Server anhand der
  // Datenlage des laufenden Sets. Ein direkter API-Hit ohne ?bucket zaehlt
  // ebenfalls als "nicht gewaehlt".
  const bucketAuto = !searchParams.has('bucket') || searchParams.get('bucketAuto') === '1';
  const rawBucket = bucketAuto
    ? await resolveDefaultBucket()
    : (searchParams.get('bucket') || DEFAULT_BUCKET);
  const bucketLabel = rawBucket === 'diamond' ? DEFAULT_BUCKET : rawBucket;
  const requestedDays = Math.max(1, Math.min(7, parseInt(searchParams.get('days') || '3', 10)));
  const patchParam = searchParams.get('patch') || 'current';
  const setParam = searchParams.get('set');

  const regions = expandRegions(regionLabel);
  const buckets = expandBuckets(bucketLabel);
  const patches = await getAvailablePatches();
  // patch (display) = der konkrete Patch-String (für UI + Cache-Key).
  // patchFilter (RPC) = null wenn ?patch=current (patchübergreifend aggregieren)
  //   oder ?patch=any, sonst der explizite Patch-String.
  const patch = await resolvePatchFromList(patches, patchParam);
  const patchFilter = (patchParam === 'current' || patchParam === 'any') ? null : patch;
  const patchStartDay = patches.find(p => p.patch === patch)?.first_day ?? null;
  // Set-Pin (2026-08-27): ohne diesen Default lief `p_set` als null in JEDE
  // Stats-RPC — die Antworten mischten das laufende Set mit dem vorherigen
  // (gemessen: Units/Items/Traits/Comps lieferten reine Set-17-Listen, weil
  // Set 17 im Fenster noch das groessere Volumen hatte). `?set=any` bleibt als
  // bewusstes Opt-out fuer setuebergreifende Auswertung.
  const setNumber = setParam === 'any'
    ? null
    : (setParam ? parseInt(setParam, 10) : CURRENT_SET);

  // Stale-Data-Bump: während des Erstfills läuft der daily-Aggregator nicht,
  // also kann der letzte Stats-Tag mehrere Tage hinter `current_date` liegen.
  // Wenn der User „Letzter Tag" (days=1) wählt und die letzten Stats von vor
  // 2 Tagen sind, würde die RPC ein leeres Fenster sehen (day > today-1d
  // bei latest=today-2d). Wir expandieren das Fenster minimal so weit, dass
  // der letzte verfügbare Stats-Tag drin liegt. Keine Stille — die Page zeigt
  // weiter die User-gewählte Granularität, aber mit verschobener Range.
  const latestDay = patches[0]?.last_day;
  let days = requestedDays;
  let anchorOffsetDays = 0;
  if (latestDay) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const latest = new Date(latestDay + 'T00:00:00Z');
    const staleness = Math.max(0, Math.floor((today.getTime() - latest.getTime()) / 86_400_000));
    // RPC-Filter ist `day > current_date - p_days::interval`. Wir brauchen
    // p_days >= staleness + 1 damit der letzte Stats-Tag im Fenster ist.
    if (staleness >= 1) days = Math.max(days, staleness + requestedDays);
    anchorOffsetDays = staleness;
  }

  return {
    regions, buckets, days, requestedDays,
    patch, patchFilter, patchStartDay,
    setNumber, bucketAuto, regionLabel, bucketLabel, anchorOffsetDays,
  };
}

// Variant of resolvePatch that takes the patch-list as input (avoids a second
// getAvailablePatches roundtrip when the caller already has them).
async function resolvePatchFromList(patches: PatchInfo[], param: string): Promise<string | null> {
  if (param === 'current') return patches[0]?.patch ?? null;
  if (param === 'previous') return patches[1]?.patch ?? null;
  return param;
}

// Default-Timeout für ALLE Supabase-RPC-Calls. Ohne AbortSignal hängt der
// fetch ggf. > 60s bis Vercel die Function killt → 502 für den User.
// 8 s ist großzügig genug für Cold-Buffer-Scans (typische Stats-RPCs laufen
// 200-1500ms warm) aber harmlos gegen Cloudflare-522 Edge-Hänger.
const RPC_TIMEOUT_MS = 8000;

export async function callRpc<T = any>(
  fn: string,
  args: Record<string, unknown>,
  timeoutMs = RPC_TIMEOUT_MS,
): Promise<T> {
  if (!SUPA_URL || !SUPA_KEY) throw new Error('Supabase env vars missing');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`RPC ${fn} failed: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  } catch (e) {
    if ((e as any)?.name === 'AbortError') {
      throw new Error(`RPC ${fn} timeout after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Merge a list of jsonb dicts (key -> int) by summing values per key.
// Used for last_round_dist / top4_by_round which the RPC ships as
// jsonb_agg([{ "22": 14, ...}, { "22": 9, "23": 4, ...}]).
export function mergeJsonbCountDicts(dicts: any[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of dicts || []) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) continue;
    for (const [k, v] of Object.entries(d)) {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      out[k] = (out[k] || 0) + n;
    }
  }
  return out;
}

// Merge a list of jsonb arrays (e.g. typical_units snippets from multiple
// daily rows of the same cluster) into a single sorted top-N by count.
// Each input array has the shape [{ <keyName>: …, count, … }, …].
// carryItemGames is summed when present — used by the comp UI to identify
// the actual DMG-carry among the typical units (highest carryItemGames/count
// ratio), which differs from the cluster_key carry (= unit with most items,
// often a tank).
//
// nestedArrays: optional list of nested-array fields to also merge per entry,
// e.g. { field: 'topItems', innerKey: 'apiName', topN: 3 } for items-per-unit
// inside a comp. Without this, the nested arrays are dropped during the merge.
export function mergeJsonbCountArrays<K extends string>(
  arrays: any[],
  keyName: K,
  topN: number,
  nestedArrays?: Array<{ field: string; innerKey: string; topN: number }>,
): Array<{ [k in K]: string } & { count: number; sumPlacement?: number; games?: number; carryItemGames?: number; [extra: string]: any }> {
  // Per-Element Outcome-Felder für Flex-Sektion (Detail-Page) — sowohl für
  // typical_units (gamesWithUnit) als auch typical_augments (count selbst ist
  // schon Pickrate-Nenner). gamesWithOutcome ist semantisch neutral und in
  // Lock-Step mit top1/top4 — alte JSONB-Rows ohne diese Felder addieren 0
  // zu Zähler UND Nenner → keine Verzerrung beim Merge.
  //
  // `multiplicity` ist als EINZIGES Feld hier ein Verhaeltnis, keine Summe:
  // der Aggregator schreibt 1 + dupGames/gamesWithUnit (tft-build-aggregator.mjs
  // :884). Aufsummieren waere sinnlos, ein ungewichtetes Mittel ueber die Tage
  // ebenso — ein Tag mit 6 Spielen wuerde so schwer wiegen wie einer mit 600.
  // Deshalb wird pro Eintrag dupGames = (multiplicity - 1) * gamesWithUnit
  // zurueckgerechnet, summiert und am Ende erneut geteilt. Das ist exakt die
  // Aggregator-Definition, nur ueber mehrere Tage statt ueber die Matches eines
  // Tages, und es ist idempotent: laeuft der Merge ueber eine bereits gemergte
  // Liste, kommt derselbe Wert wieder heraus.
  type Bucket = {
    count: number; sumPlacement: number; games: number; carryItemGames: number;
    gamesWithUnit: number; gamesWithOutcome: number; top1: number; top4: number;
    dupGames: number; star3Games: number;
    nested: Map<string, Map<string, number>>;
  };
  const merged = new Map<string, Bucket>();
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const e of arr) {
      const key = e?.[keyName];
      if (!key) continue;
      const cur: Bucket = merged.get(key) || {
        count: 0, sumPlacement: 0, games: 0, carryItemGames: 0,
        gamesWithUnit: 0, gamesWithOutcome: 0, top1: 0, top4: 0,
        dupGames: 0, star3Games: 0,
        nested: new Map(),
      };
      cur.count += Number(e.count ?? e.games ?? 0);
      cur.sumPlacement += Number(e.sumPlacement ?? e.sum_placement ?? 0);
      cur.games += Number(e.games ?? 0);
      cur.carryItemGames += Number(e.carryItemGames ?? e.carry_item_games ?? 0);
      cur.gamesWithUnit += Number(e.gamesWithUnit ?? e.games_with_unit ?? 0);
      // Lese-Alias `gamesWithUnitOutcome` für Backward-Compat mit pre-Phase-2-
      // Aggregator-Schreibseite (jetzt unified auf `gamesWithOutcome`).
      cur.gamesWithOutcome += Number(
        e.gamesWithOutcome ?? e.gamesWithUnitOutcome ?? e.games_with_outcome ?? e.games_with_unit_outcome ?? 0
      );
      cur.top1 += Number(e.top1 ?? 0);
      cur.top4 += Number(e.top4 ?? 0);
      // Alte JSONB-Rows kennen star3Games nicht → 0. Damit bleibt der Anteil
      // konservativ klein statt falsch gross, solange das Fenster noch alte
      // Tage enthaelt: lieber kein Stern als ein erfundener.
      cur.star3Games += Number(e.star3Games ?? e.star3_games ?? 0);
      const mult = Number(e.multiplicity ?? 1);
      if (mult > 1) {
        cur.dupGames += (mult - 1) * Number(e.gamesWithUnit ?? e.games_with_unit ?? 0);
      }
      if (nestedArrays) {
        for (const cfg of nestedArrays) {
          const inner = e[cfg.field];
          if (!Array.isArray(inner)) continue;
          const counter = cur.nested.get(cfg.field) || new Map<string, number>();
          for (const item of inner) {
            const ik = item?.[cfg.innerKey];
            if (!ik) continue;
            counter.set(ik, (counter.get(ik) || 0) + Number(item.count ?? item.games ?? 0));
          }
          cur.nested.set(cfg.field, counter);
        }
      }
      merged.set(key, cur);
    }
  }
  return [...merged.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, topN)
    .map(([key, v]) => {
      const out: any = {
        [keyName]: key, count: v.count, sumPlacement: v.sumPlacement, games: v.games, carryItemGames: v.carryItemGames,
        gamesWithUnit: v.gamesWithUnit, gamesWithOutcome: v.gamesWithOutcome, top1: v.top1, top4: v.top4,
        star3Games: v.star3Games,
      };
      // Nur setzen, wenn die Quelle ueberhaupt Doppel-Units gemeldet hat: bei
      // Augments/Items gibt es das Feld nicht, dort bliebe es ein konstantes
      // 1 in jedem Eintrag. Die Konsumenten lesen `multiplicity ?? 1`.
      // Mindestprobe 5 wie im Aggregator, hier aber auf der SUMME ueber alle
      // Tage — sonst faellt ein seltenes Doppel-Cluster dauerhaft auf 1,0.
      if (v.dupGames > 0 && v.gamesWithUnit >= 5) {
        out.multiplicity = 1 + v.dupGames / v.gamesWithUnit;
      }
      if (nestedArrays) {
        for (const cfg of nestedArrays) {
          const counter = v.nested.get(cfg.field);
          if (!counter || counter.size === 0) continue;
          out[cfg.field] = [...counter.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, cfg.topN)
            .map(([apiName, count]) => ({ [cfg.innerKey]: apiName, count }));
        }
      }
      return out;
    });
}
