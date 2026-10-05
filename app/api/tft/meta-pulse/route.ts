import { NextRequest, NextResponse } from 'next/server';
import {
  resolveFilters,
  callRpc,
  getAvailablePatches,
  getCrawlMetaDays,
} from '../../../lib/tft-supabase-reader';
import { cachedJson, maybeRedirectByPatchAlias } from '../../../lib/api-cache';
import { CURRENT_SET } from '../../../lib/current-set';
import { loadMetaPulseDiff, loadMetaPulseVelocity } from '../../../lib/meta-pulse-diff-snapshot';
import {
  META_PULSE_COMPLETE_LOOKBACK_DAYS,
  META_PULSE_DIFF_MIN_GAMES,
  META_PULSE_VELOCITY_DEFAULT_SHIFT,
  metaPulseCompleteDay,
  META_PULSE_VELOCITY_MIN_GAMES,
  META_PULSE_VELOCITY_SHIFTS,
  metaPulseVelocityWindow,
  previousPatchOf,
  type MetaPulseVelocityRow,
} from '../../../lib/snapshot-matrix';

// Drei Datenbank-Abfragen parallel.
export const maxDuration = 60;

// W5: Meta-Pulse — die „ich öffne metastats vor jeder Ranked-Session"-Page.
// Aggregiert die wichtigsten Pro-Signale in einer Server-Action:
//   • Velocity-Trending — was bewegt sich am stärksten in den letzten 3 Tagen
//   • Patch-Movers      — was hat der aktuelle Patch bewegt
// Eine Roundtrip statt 4 — die UI rendert alles ohne weitere Cascade.
//
// 1h-TTL (statt 6h wie sonst), damit die Page tatsächlich „aktuell" wirkt.

type VelocityRow = MetaPulseVelocityRow;

interface CompStatsRow {
  cluster_key: string;
  games: number;
  sum_placement: number;
  top4: number;
  top1: number;
  participants: number;
}

interface PatchDiffRow {
  key: string;
  currentGames: number;
  previousGames: number;
  currentAvgPlacement: number;
  previousAvgPlacement: number;
  deltaAvgPlacement: number;
  currentPickRate: number;
  previousPickRate: number;
  deltaPickRate: number;
  currentTop4Rate: number;
  previousTop4Rate: number;
  deltaTop4Rate: number;
}

// Allowed velocity shifts mirror StatsFilterBar; anything else collapses to
// the default so a stale URL can't produce a shape the SQL never tested.
const VELOCITY_SHIFTS = new Set(META_PULSE_VELOCITY_SHIFTS);
const DEFAULT_VELOCITY_SHIFT = META_PULSE_VELOCITY_DEFAULT_SHIFT;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filters = await resolveFilters(searchParams);
  const buckets = filters.buckets;

  // Δ-window: how far back the comparison reaches. User-controlled via the
  // same `velocity` param the Comps page uses, so a deep-link from one to
  // the other carries the selection over. 0 (=off) still produces the
  // "rising" list using the default shift, since the page IS the velocity
  // view — there's no "off" state here.
  const velocityRaw = parseInt(searchParams.get('velocity') || '0', 10);
  const velocityShift = VELOCITY_SHIFTS.has(velocityRaw) ? velocityRaw : DEFAULT_VELOCITY_SHIFT;

  try {
    // Tages-Eingang je Region parallel zur Patch-Liste (nur fuer den neuesten
    // Patch gebraucht). Fehler → null → Fenster wie bisher, Antwort degraded.
    const crawlMetaFrom = new Date(Date.now() - (META_PULSE_COMPLETE_LOOKBACK_DAYS + 2) * 86_400_000)
      .toISOString().slice(0, 10);
    const [patches, crawlMeta] = await Promise.all([
      getAvailablePatches(),
      getCrawlMetaDays(filters.regions, crawlMetaFrom).catch(() => null),
    ]);
    // Plan E: redirect ?patch=current|previous auf konkreten Patch.
    // Bei meta-pulse ignoriert der Backend-Code den patch-Param eh (rendert
    // immer latestPatch), aber HTTP-Cache-Key wird patch-spezifisch — bei
    // Patch-Wechsel kein stale Cache mehr. Kein Plan-B-Boost, weil die Route
    // schon explizit 1h-TTL gewählt hat (kürzer als alle anderen Stats-APIs).
    const redirect = maybeRedirectByPatchAlias(request, patches);
    if (redirect) return redirect;
    // Gewaehlter Patch (2026-09-13): ?patch=current → neuester, ein konkreter
    // Patch aus der Liste → dieser (?patch=previous kommt oben schon als
    // Redirect auf den konkreten Patch an). Unbekannte Werte → neuester.
    // Verglichen wird mit dem Vorpatch nach previousPatchOf (juengster
    // frueherer Patch mit genug Datentagen, ein Kurz-Patch wird
    // uebersprungen) — dieselbe Regel wie publish-meta-pulse-diffs.mjs.
    // currentPatch/previousPatch in der Antwort meinen genau dieses Paar.
    const patchParam = searchParams.get('patch') || 'current';
    const selIdx = Math.max(0, patchParam === 'current' || patchParam === 'any'
      ? 0 : patches.findIndex(p => p.patch === patchParam));
    const sel = patches[selIdx];
    const cmp = sel ? previousPatchOf(patches, sel.patch) ?? undefined : undefined;
    const currentPatch = sel?.patch ?? null;
    const setNumber = sel?.set_number ?? CURRENT_SET;
    // Vorpatch aus einem anderen Set: kein sinnvoller Vergleich → Patch-Kaesten leer.
    const previousPatch = cmp && cmp.set_number === setNumber ? cmp.patch : null;

    // Rising-Vergleichsfenster: gemeinsame Rechnung mit der Box (snapshot-matrix.ts).
    const DAY_MS = 86_400_000;
    const dayNum = (d?: string | null) => (d ? Math.floor(Date.parse(d) / DAY_MS) : NaN);
    const todayNum = Math.floor(Date.now() / DAY_MS);
    const completeDay = selIdx === 0 && crawlMeta
      ? metaPulseCompleteDay(crawlMeta.filter(r => Number(r.set_number) === Number(setNumber)), filters.regions, Date.now())
      : null;
    const win = metaPulseVelocityWindow({
      completeDay,
      sel,
      cmpLastDay: cmp?.last_day,
      previousPatch,
      selIdx,
      requestedDays: filters.requestedDays,
      velocityShift,
      latestOffsetDays: filters.anchorOffsetDays,
      todayNum,
    });
    const { mode: velocityMode, effShift, effDays } = win;
    // Diff-Fenster (RPC zaehlt ab current_date) je Patch ab dessen erstem Tag;
    // der Patch-Filter schneidet den Rest ab. Ein gemeinsames Fenster bis zum
    // Vorpatch-Start lieferte fuer den laufenden Patch dasselbe Ergebnis in
    // 17,5 statt 2,8 s (gemessen 2026-10-01, master_plus, alle Regionen).
    const windowFrom = (first: number) => (Number.isFinite(first) ? Math.min(90, Math.max(1, todayNum - first + 1)) : 30);
    const curDiffDays = windowFrom(dayNum(sel?.first_day));
    const diffDays = windowFrom(dayNum(cmp?.first_day));

    // Patch-Vergleich: vorgerechnet von der Box (nur region=all), sonst live.
    // Ein fehlgeschlagener Aufruf setzt `degraded` — die leere Liste darf dann
    // nicht eine Stunde in der Edge stehen bleiben.
    let degraded = selIdx === 0 && !crawlMeta;
    let snapshotHits = 0;
    let velocityHit = false;
    const diffRows = async (p: typeof sel | undefined, days: number): Promise<CompStatsRow[]> => {
      if (!p) return [];
      const pre = await loadMetaPulseDiff({
        patch: p,
        closed: p.patch !== patches[0]?.patch,
        regionLabel: filters.regionLabel,
        regions: filters.regions,
        bucketLabel: filters.bucketLabel,
        buckets,
      });
      if (pre) { snapshotHits++; return pre; }
      return callRpc<CompStatsRow[]>('get_tft_comp_stats_for_diff', {
        p_regions: filters.regions,
        p_buckets: buckets,
        p_days: days,
        p_patch: p.patch,
        p_set: setNumber,
        p_min_games: META_PULSE_DIFF_MIN_GAMES,
      }, 20000).catch(() => { degraded = true; return [] as CompStatsRow[]; });
    };

    // Fan out: alle drei Abfragen parallel. „KR voraus" ist seit 2026-09-28
    // raus — der Regionsvergleich auf der Seite laeuft ueber /api/tft/units.
    const [velocityRows, currentTopComps, prevTopComps] = await Promise.all([
      (async (): Promise<VelocityRow[]> => {
        // Velocity: vorgerechnet von der Box (nur region=all), sonst live.
        const pre = sel ? await loadMetaPulseVelocity({
          sel, cmp, previousPatch, window: win,
          regionLabel: filters.regionLabel, regions: filters.regions,
          bucketLabel: filters.bucketLabel, buckets,
        }) : null;
        if (pre) { velocityHit = true; return pre; }
        return callRpc<VelocityRow[]>('get_tft_comp_velocity', {
          p_regions: filters.regions,
          p_buckets: buckets,
          p_set: setNumber,
          // null nur im crossPatch-Modus: dann liegen die beiden Tage in
          // verschiedenen Patches (gemessen: Tage sind je Patch sauber getrennt).
          p_patch: win.velocityPatch,
          p_days: effDays,
          p_shift_days: effShift,
          p_anchor_offset_days: win.anchorOffsetDays,
          p_min_games: META_PULSE_VELOCITY_MIN_GAMES,
        }, 20000).catch(() => { degraded = true; return [] as VelocityRow[]; });
      })(),
      // Super-lean diff RPC (migration 0035) — scalar-only, drops the 10 MB
      // jsonb_agg payload the previous list-RPC carried for nothing here.
      previousPatch ? diffRows(sel, curDiffDays) : Promise.resolve([] as CompStatsRow[]),
      previousPatch ? diffRows(cmp, diffDays) : Promise.resolve([] as CompStatsRow[]),
    ]);

    // Velocity → Top Rising (most-improved avg-place over the comparison
    // window, with both windows above sample-size threshold).
    const rising = velocityRows
      // 100 pro Fenster: bei 30 lag der Zufallsfehler eines Δ bei ~0,6 Plaetzen.
      .filter(v => v.games_now >= 100 && v.games_prev >= 100)
      .map(v => ({
        clusterKey: v.cluster_key,
        deltaAvgPlace: v.sum_placement_now / v.games_now - v.sum_placement_prev / v.games_prev,
        avgPlaceNow: v.sum_placement_now / v.games_now,
        gamesNow: v.games_now,
      }))
      .filter(v => v.deltaAvgPlace < 0)
      .sort((a, b) => a.deltaAvgPlace - b.deltaAvgPlace)
      .slice(0, 5);

    // Patch movers — compute simple comp diff inline from the two RPC outputs.
    const prevMap = new Map(prevTopComps.map(r => [r.cluster_key, r]));
    const patchDiffs: PatchDiffRow[] = [];
    for (const c of currentTopComps) {
      const p = prevMap.get(c.cluster_key);
      if (!p || c.games < 80 || p.games < 80) continue;
      const cParts = Number(c.participants) || 1;
      const pParts = Number(p.participants) || 1;
      patchDiffs.push({
        key: c.cluster_key,
        currentGames: Number(c.games),
        previousGames: Number(p.games),
        currentAvgPlacement: Number(c.sum_placement) / Number(c.games),
        previousAvgPlacement: Number(p.sum_placement) / Number(p.games),
        deltaAvgPlacement: Number(c.sum_placement) / Number(c.games) - Number(p.sum_placement) / Number(p.games),
        currentPickRate: Number(c.games) / cParts,
        previousPickRate: Number(p.games) / pParts,
        deltaPickRate: Number(c.games) / cParts - Number(p.games) / pParts,
        currentTop4Rate: Number(c.top4) / Number(c.games),
        previousTop4Rate: Number(p.top4) / Number(p.games),
        deltaTop4Rate: Number(c.top4) / Number(c.games) - Number(p.top4) / Number(p.games),
      });
    }
    const patchWinners = patchDiffs.filter(d => d.deltaAvgPlacement < 0)
      .sort((a, b) => a.deltaAvgPlacement - b.deltaAvgPlacement).slice(0, 5);
    const patchLosers = patchDiffs.filter(d => d.deltaAvgPlacement > 0)
      .sort((a, b) => b.deltaAvgPlacement - a.deltaAvgPlacement).slice(0, 5);

    const res = cachedJson({
      hasData: true,
      currentPatch,
      previousPatch,
      // Gewaehlter Patch und sein Vergleichspatch (gleich currentPatch/previousPatch).
      selectedPatch: currentPatch,
      comparePatch: previousPatch,
      bucket: filters.bucketLabel,
      region: filters.regionLabel,
      requestedDays: filters.requestedDays,
      // Tatsaechlich genutzter Abstand (kann kleiner sein als gewaehlt).
      velocityShift: effShift,
      velocityDays: effDays,
      velocityMode,
      patches,
      rising,
      // Uebergang: noch offene alte Tabs lesen krAhead.length.
      krAhead: [],
      patchWinners,
      patchLosers,
      counts: {
        rising: rising.length,
        krAhead: 0,
        patchSampled: patchDiffs.length,
      },
    }, {
      // Shorter TTL than the rest of the stats APIs because Meta-Pulse is the
      // "what's hot right now" page — 6h staleness would defeat the purpose.
      cache: 'public, s-maxage=3600, stale-while-revalidate=21600',
      degraded,
    });
    // Welche Teile aus der Vorrechnung kamen (diff = Patch-Vergleiche, 0-2).
    res.headers.set('x-snapshot', `meta-pulse:diff=${snapshotHits},velocity=${velocityHit ? 1 : 0}`);
    return res;
  } catch (e: any) {
    return NextResponse.json({ hasData: false, error: e.message }, { status: 502 });
  }
}
