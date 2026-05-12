// Server-side reader for the Supabase-backed TFT daily stats. Wraps the
// Postgres RPC functions in supabase/migrations/0002_tft_stats_rpcs.sql with
// the filter parameter expansion the API routes need (region groups, bucket
// groups, patch resolution from "current"/"previous" to the actual string).
//
// All RPC calls use the service role key — this code runs on the server only.

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Riot's 17 platform routings. Used for the "all" region group.
export const ALL_REGIONS = [
  'euw1', 'kr', 'na1', 'eun1', 'br1', 'jp1', 'oc1',
  'la1', 'la2', 'tr1', 'ru', 'me1', 'ph2', 'sg2', 'th2', 'tw2', 'vn2',
];
// Visual / cultural groupings — Western servers play a more individual-comp
// meta, Asian servers lean into the strongest comp first. Splitting them
// produces stats that are easier to interpret for players who only play
// one region.
export const WEST_REGIONS = [
  'euw1', 'eun1', 'na1', 'br1', 'la1', 'la2', 'tr1', 'ru', 'me1',
];
export const ASIA_REGIONS = ['kr', 'jp1', 'oc1', 'ph2', 'sg2', 'th2', 'tw2', 'vn2'];

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
  days: number;          // 1-7
  patch: string | null;  // null = no filter (any), else exact patch string
  setNumber: number | null;
  regionLabel: string;   // raw filter value for display ('all','west','euw1',…)
  bucketLabel: string;   // raw filter value for display
}

// Expand a filter param like "all" or "euw1,kr" into a flat region list.
function expandRegions(param: string | null): string[] {
  if (!param || param === 'all') return REGION_GROUPS.all;
  if (REGION_GROUPS[param]) return REGION_GROUPS[param];
  return param.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function expandBuckets(param: string | null): string[] {
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

export async function getAvailablePatches(days = 30): Promise<PatchInfo[]> {
  // 5-min in-process cache. Patches don't change mid-day.
  if (_patchCache && Date.now() - _patchCache.ts < 5 * 60 * 1000) {
    return _patchCache.rows;
  }
  const rows = await callRpc<PatchInfo[]>('get_tft_available_patches', { p_days: days });
  _patchCache = { ts: Date.now(), rows: rows || [] };
  return _patchCache.rows;
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
  const days = Math.max(1, Math.min(7, parseInt(searchParams.get('days') || '3', 10)));
  const patchParam = searchParams.get('patch') || 'current';
  const setParam = searchParams.get('set');

  const regions = expandRegions(regionLabel);
  const buckets = expandBuckets(bucketLabel);
  const patch = await resolvePatch(patchParam);
  const setNumber = setParam ? parseInt(setParam, 10) : null;

  return { regions, buckets, days, patch, setNumber, regionLabel, bucketLabel };
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

// Merge a list of jsonb arrays (e.g. typical_units snippets from multiple
// daily rows of the same cluster) into a single sorted top-N by count.
// Each input array has the shape [{ <keyName>: …, count, … }, …].
export function mergeJsonbCountArrays<K extends string>(
  arrays: any[],
  keyName: K,
  topN: number,
): Array<{ [k in K]: string } & { count: number; sumPlacement?: number; games?: number }> {
  const merged = new Map<string, { count: number; sumPlacement: number; games: number }>();
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const e of arr) {
      const key = e?.[keyName];
      if (!key) continue;
      const cur = merged.get(key) || { count: 0, sumPlacement: 0, games: 0 };
      cur.count += Number(e.count ?? e.games ?? 0);
      cur.sumPlacement += Number(e.sumPlacement ?? e.sum_placement ?? 0);
      cur.games += Number(e.games ?? 0);
      merged.set(key, cur);
    }
  }
  return [...merged.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, topN)
    .map(([key, v]) => ({ [keyName]: key, ...v } as any));
}
