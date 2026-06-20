// Server-side reader for the Supabase-backed TFT daily stats. Wraps the
// Postgres RPC functions in supabase/migrations/0002_tft_stats_rpcs.sql with
// the filter parameter expansion the API routes need (region groups, bucket
// groups, patch resolution from "current"/"previous" to the actual string).
//
// All RPC calls use the service role key — this code runs on the server only.

import { ACTIVE_REGIONS, ACTIVE_REGIONS_WEST, ACTIVE_REGIONS_ASIA } from './active-regions';

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
  regionLabel: string;   // raw filter value for display ('all','west','euw1',…)
  bucketLabel: string;   // raw filter value for display
  // Days between current_date and the latest available stats day. Velocity /
  // Δ-windows must anchor at (current_date - anchorOffsetDays), otherwise a
  // 1-day Δ-window over a 4-day-stale pipeline lands in an empty range.
  anchorOffsetDays: number;
}

// Expand a filter param like "all" or "euw1,kr" into a flat region list.
export function expandRegions(param: string | null): string[] {
  if (!param || param === 'all') return REGION_GROUPS.all;
  if (REGION_GROUPS[param]) return REGION_GROUPS[param];
  return param.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

export function expandBuckets(param: string | null): string[] {
  if (!param || param === 'all') return BUCKET_GROUPS.all;
  if (BUCKET_GROUPS[param]) return BUCKET_GROUPS[param];
  return param.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
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

export async function getAvailablePatches(days = 30): Promise<PatchInfo[]> {
  if (_patchCache && Date.now() - _patchCache.ts < PATCH_CACHE_TTL_MS) {
    return _patchCache.rows;
  }
  try {
    const rows = (await callRpc<PatchInfo[]>('get_tft_available_patches', { p_days: days })) || [];
    // Never return empty: if every patch is below the floor (e.g. right after a
    // set launch) keep the raw list so the page still shows the best available.
    const established = rows.filter(r => Number(r.total_matches) >= PATCH_MIN_GAMES);
    _patchCache = { ts: Date.now(), rows: established.length > 0 ? established : rows };
    return _patchCache.rows;
  } catch (e) {
    // Stale-serve: a cold-buffer statement timeout on this pre-flight query must
    // not blank the patch dropdown or 502 the whole stats page. Fall back to the
    // last good list (even if expired) when we have one; only propagate if we've
    // never successfully loaded patches.
    if (_patchCache) return _patchCache.rows;
    throw e;
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

export async function resolveFilters(searchParams: URLSearchParams): Promise<ResolvedFilters> {
  const regionLabel = searchParams.get('region') || 'all';
  const bucketLabel = searchParams.get('bucket') || 'diamond';
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
  const setNumber = setParam ? parseInt(setParam, 10) : null;

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
    setNumber, regionLabel, bucketLabel, anchorOffsetDays,
  };
}

// Variant of resolvePatch that takes the patch-list as input (avoids a second
// getAvailablePatches roundtrip when the caller already has them).
async function resolvePatchFromList(patches: PatchInfo[], param: string): Promise<string | null> {
  if (param === 'current') return patches[0]?.patch ?? null;
  if (param === 'previous') return patches[1]?.patch ?? null;
  return param;
}

export async function callRpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!SUPA_URL || !SUPA_KEY) throw new Error('Supabase env vars missing');
  const res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`RPC ${fn} failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
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
  type Bucket = {
    count: number; sumPlacement: number; games: number; carryItemGames: number;
    gamesWithUnit: number; gamesWithOutcome: number; top1: number; top4: number;
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
      };
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
