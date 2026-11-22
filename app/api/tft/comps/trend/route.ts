import { NextRequest, NextResponse } from 'next/server';
import { callRpc, expandRegions, expandBuckets, resolveDataEnd, type PatchInfo } from '../../../../lib/tft-supabase-reader';
import { cachedJson, cacheControlForPatches, maybeRedirectByPatchAlias } from '../../../../lib/api-cache';
import { getAvailablePatches } from '../../../../lib/tft-supabase-reader';
import { selectFamilyMembers, familyKeyForMerge } from '../../../../lib/tft-comp-family-merge';
import { publicError } from '../../../../lib/public-error';
import {
  addDays, trendFileCovers, trendFileKey, trendFileUsableStale, trendFileValid, trendGroupFor, trendPoints,
} from '../../../../lib/comp-trend-files.mjs';

// /api/tft/comps/trend
//   ?slug=<cluster_key>&region=<group|exact>&bucket=<group|exact>&days=N
// Backs the Trends-Time-Series chart on /tft/comps/[slug]: 14/30-day per-day
// avg-place / top4-rate / top1-rate so the user sees the comp's movement
// within the patch, not just before/after.
//
// Seit 22.11.2026 zuerst aus den vorberechneten Dateien der Box
// (scripts/publish-comp-trends.mjs, Regeln in app/lib/comp-trend-files.mjs):
// die Abfrage brauchte kalt ~13 s, die Seite wartet 8 s. Gelesen wird genau die
// Datei zum Endtag der Anfrage. Live nur, wenn sie fehlt oder das Fenster nicht
// abdeckt; scheitert live, die Datei vom Vortag (echte Zahlen, endet einen Tag
// frueher, kurzer Cache). Notschalter COMP_TREND_BLOB=0.

interface DailyTrendRow {
  day: string;
  games: number | string;
  sum_placement: number | string;
  top4: number | string;
  top1: number | string;
}

const FILE_TIMEOUT_MS = 2500;
const FILE_TTL_MS = 10 * 60_000;
const MISS_TTL_MS = 60_000;
const PATCHES_BUDGET_MS = 1000;
// Notantwort aus der Datei vom Vortag: kurz halten, damit die Edge bald wieder
// den echten Stand holt.
const STALE_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=300';

// Form siehe buildTrendFile (app/lib/comp-trend-files.mjs); geprueft von trendFileValid.
type TrendFile = { v: number; endDay: string; firstDay: string; days: string[]; comps: Record<string, number[]> };
const fileCache = new Map<string, { at: number; file: TrendFile | null }>();
const fileInflight = new Map<string, Promise<TrendFile | null>>();

function blobBase(): string | null {
  const m = process.env.SNAPSHOT_MANIFEST_URL;
  if (!m) return null;
  try { return new URL(m).origin; } catch { return null; }
}

async function fetchTrendFile(key: string, regions: string[], buckets: string[]): Promise<TrendFile | null> {
  const base = blobBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/${key}`, { signal: AbortSignal.timeout(FILE_TIMEOUT_MS), cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    return trendFileValid(body, regions, buckets) ? (body as TrendFile) : null;
  } catch {
    return null; // Datei nicht erreichbar -> live
  }
}

/** Datei je Endtag + Gruppe, je Instanz zwischengespeichert, gleichzeitige Abrufe gebuendelt. */
async function loadTrendFile(endDay: string, region: string, bucket: string, regions: string[], buckets: string[]): Promise<TrendFile | null> {
  const key = trendFileKey(endDay, region, bucket);
  const hit = fileCache.get(key);
  if (hit && Date.now() - hit.at < (hit.file ? FILE_TTL_MS : MISS_TTL_MS)) return hit.file;
  const running = fileInflight.get(key);
  if (running) return running;
  const p = fetchTrendFile(key, regions, buckets)
    .then((file) => {
      fileCache.set(key, { at: Date.now(), file });
      return file;
    })
    .finally(() => fileInflight.delete(key));
  fileInflight.set(key, p);
  return p;
}

function toPoints(rows: DailyTrendRow[], dataEnd: string | null) {
  return rows.filter(r => !dataEnd || String(r.day).slice(0, 10) <= dataEnd).map(r => {
    const games = Number(r.games);
    const sumP = Number(r.sum_placement);
    const t4 = Number(r.top4);
    const t1 = Number(r.top1);
    return {
      day: r.day,
      games,
      avgPlacement: games > 0 ? sumP / games : null,
      top4Rate: games > 0 ? t4 / games : null,
      top1Rate: games > 0 ? t1 / games : null,
    };
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

  const regionParam = searchParams.get('region') || 'all';
  const bucketParam = searchParams.get('bucket') || 'diamond_plus';
  const days = Math.max(1, Math.min(60, parseInt(searchParams.get('days') || '14', 10)));
  // Family-Mode (Default für die Detail-Page-Trend-Linie): die RPC bekommt
  // ALLE Sub-Cluster der Family. ?variant=exact = Single-Slug-Sicht.
  const variantMode = searchParams.get('variant') === 'exact' ? 'exact' : 'family';
  // Optional: comma-separated Liste der Family-Slugs vom Detail-Page-Caller.
  // Spart Trend-Endpoint einen eigenen RPC-Roundtrip zur Family-Auflösung.
  const familySlugsParam = searchParams.get('familySlugs');
  const explicitFamilySlugs = familySlugsParam ? familySlugsParam.split(',').filter(Boolean) : null;

  try {
    // Die Patch-Liste ist nur fuer Weiterleitung und Cache-Dauer da. Haengt die
    // DB, darf sie den Datei-Weg nicht mitreissen: hoechstens 1 s, sonst ohne.
    const patches: PatchInfo[] = await Promise.race([
      getAvailablePatches().catch(() => [] as PatchInfo[]),
      new Promise<PatchInfo[]>((r) => setTimeout(() => r([]), PATCHES_BUDGET_MS)),
    ]);
    const redirect = patches.length > 0 ? maybeRedirectByPatchAlias(request, patches) : null;
    if (redirect) return redirect;
    const cacheControl = cacheControlForPatches(patches);

    const regions = expandRegions(regionParam);
    const buckets = expandBuckets(bucketParam);

    // Im Family-Mode: wenn der Caller explizite Family-Slugs übergibt, nutzen
    // wir die direkt. Sonst nimmt die RPC den Single-Slug-Pfad (Backward-
    // Compat) — Caller die Family-Slugs nicht kennen bekommen Single-Slug-
    // Sicht trotz ?variant=family.
    const useFamily = variantMode === 'family' && explicitFamilySlugs && explicitFamilySlugs.length > 1;
    // Bei Single-Slug-Family kein min-games-Floor (Backward-Compat); bei echter
    // Family wir wollen verrauschte Daily-Linien rauskippen (data-skeptic F4).
    const minGamesPerDay = useFamily ? 20 : 0;
    // Wie p_cluster_keys: im Family-Mode nur die Liste (trendPoints zaehlt jeden Slug einmal).
    const slugs = useFamily ? explicitFamilySlugs! : [slug];

    // Volle Tage: die Kurve endet am Endtag der Seite (&end=) bzw. am letzten
    // vollstaendigen Tag. Die Abfrage kennt keinen Endtag — sie holt um den
    // Abstand zu heute mehr Tage, die Tage danach fallen hier weg.
    const dataEnd = await resolveDataEnd(searchParams.get('end')).catch(() => null);

    const respond = (points: ReturnType<typeof toPoints>, source: string, cache: string, endDay = dataEnd) => {
      const res = cachedJson({
        hasData: points.length > 0,
        slug,
        region: regionParam,
        bucket: bucketParam,
        days,
        endDay,
        variantMode,
        familySize: useFamily ? explicitFamilySlugs!.length : 1,
        points,
      }, { cache });
      res.headers.set('x-snapshot', `comp-trend=${source}`);
      return res;
    };

    // Datei nur ueber die AUFGELOESTEN Listen waehlen (unbekannter Rang wird z. B.
    // zu master_plus) — so trifft sie genau das, was die Abfrage rechnen wuerde.
    const group = process.env.COMP_TREND_BLOB !== '0' && dataEnd ? trendGroupFor(regions, buckets) : null;
    if (group && dataEnd) {
      const file = await loadTrendFile(dataEnd, group.region, group.bucket, regions, buckets);
      if (file && trendFileCovers(file, days, dataEnd)) {
        const rows = trendPoints(file, { slugs, days, endDay: dataEnd, minGamesPerDay });
        return respond(toPoints(rows, dataEnd), 'blob', cacheControl);
      }
    }

    const endOffset = dataEnd
      ? Math.max(0, Math.round((Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z') - Date.parse(dataEnd + 'T00:00:00Z')) / 86_400_000))
      : 0;
    let rows: DailyTrendRow[];
    try {
      rows = await callRpc<DailyTrendRow[]>('get_tft_comp_daily_trend', {
        p_cluster_key: slug,
        p_regions: regions,
        p_buckets: buckets,
        p_days: days + endOffset,
        p_cluster_keys: useFamily ? explicitFamilySlugs : null,
        p_min_games_per_day: minGamesPerDay,
      });
    } catch (e) {
      if (group && dataEnd) {
        const prev = await loadTrendFile(addDays(dataEnd, -1), group.region, group.bucket, regions, buckets);
        if (prev && trendFileUsableStale(prev, dataEnd)) {
          // Echte Zahlen der Datei, gemeldet mit IHREM Endtag (endet frueher als die Seite).
          const stale = trendPoints(prev, { slugs, days, endDay: dataEnd, minGamesPerDay });
          return respond(toPoints(stale, dataEnd), 'blob-stale', STALE_CACHE_CONTROL, prev.endDay);
        }
      }
      throw e;
    }
    return respond(toPoints(rows || [], dataEnd), 'live', cacheControl);
  } catch (e: any) {
    return NextResponse.json({ hasData: false, points: [], error: publicError('tft/comps/trend', e, 'stats_unavailable') }, { status: 502 });
  }
}
