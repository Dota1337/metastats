import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  resolveFilters,
  callRpc,
  getAvailablePatches,
  mergeJsonbCountArrays,
  mergeJsonbCountDicts,
} from '../../../lib/tft-supabase-reader';
import { cachedJson, cacheControlForPatches, maybeRedirectByPatchAlias } from '../../../lib/api-cache';
import { isExcludedUnit, isExcludedItem, setContainsExcludedItem } from '../../../lib/tft-excluded';
import { lookupSnapshot } from '../../../lib/snapshot-lookup';

// Lazy + memoized champion-cost lookup pro Set. Wird vom Tempo-Klassifikator
// gebraucht, der Carry-Cost mit Peak-Level + 3-Star-Anteil in Beziehung setzt:
// 1-Cost-Reroll lebt auf Lvl 5, 2-Cost auf Lvl 6, 3-Cost auf Lvl 7. Ohne den
// Cost-Lookup würde jede Comp mit niedrigem Peak-Level fälschlich als Reroll
// klassifiziert (z.B. eine Lulu-Push-Comp auf Lvl 7 ist KEIN Reroll).
const costLookupCache = new Map<number, Map<string, number>>();
function loadChampionCostLookup(setNumber: number): Map<string, number> {
  const cached = costLookupCache.get(setNumber);
  if (cached) return cached;
  const fresh = new Map<string, number>();
  try {
    const file = path.join(process.cwd(), 'public', `tft-assets-${setNumber}.json`);
    const bundle = JSON.parse(readFileSync(file, 'utf8')) as { champions?: Record<string, { cost?: number }> };
    for (const [cid, c] of Object.entries(bundle.champions || {})) {
      if (typeof c?.cost === 'number') fresh.set(cid, c.cost);
    }
  } catch {
    // Bundle nicht vorhanden — Tempo-Klassifikator fällt auf reine
    // Peak-Level-Heuristik zurück.
  }
  costLookupCache.set(setNumber, fresh);
  return fresh;
}
function setNumberFromClusterKey(key: string): number | null {
  const m = /^TFT(\d+)_/.exec(key);
  return m ? Number(m[1]) : null;
}

// /api/tft/comps
// List view: returns aggregated comp clusters that match the filter set.
// Detail view (slug=…): looks up that specific cluster + its counter edges
//   from the comp-pair table.
// `source` param kept for backwards compatibility — only "data" is supported
// today; "editorial" stays as an empty list until that table exists.

const VALID_SOURCES = new Set(['data', 'editorial', 'all']);

interface CompRow {
  cluster_key: string;
  games: number;
  sum_placement: number;
  top4: number;
  top1: number;
  sum_level: number;
  sum_last_round: number;
  sum_players_eliminated: number;
  sum_gold_left: number;
  participants: number;
  typical_units_merged: any[][];
  typical_augments_merged: any[][];
  carry_items_merged: any[][];
  last_round_dist_merged: any[] | null;
  top4_by_round_merged: any[] | null;
  level_dist_merged: any[] | null;
  level_sum_last_round_merged: any[] | null;
  // W3-A: jsonb-agg of per-day carry_star_dist objects. Each daily row ships
  // { "1": {games, sumPlacement, top4, top1}, "2": …, "3": … } — array-merge
  // sums per star key here in the API.
  carry_star_dist_merged: any[] | null;
  // W4-B: jsonb-agg of per-day contested_dist objects. Same shape as
  // carry_star_dist but keys are contested-level (1=solo, 2=one rival, 3=2+).
  contested_dist_merged: any[] | null;
  // { bucket: { games, sum_placement } } from migration 0017 — for Skill-Cap.
  bucket_breakdown: Record<string, { games: number; sum_placement: number }> | null;
}

interface CompPairRow {
  a_key: string;
  b_key: string;
  games: number;
  a_better: number;
}

interface VelocityRow {
  cluster_key: string;
  games_now: number;
  games_prev: number;
  sum_placement_now: number;
  sum_placement_prev: number;
  top4_now: number;
  top4_prev: number;
  top1_now: number;
  top1_prev: number;
  participants_now: number;
  participants_prev: number;
}

interface CompVelocity {
  gamesNow: number;
  gamesPrev: number;
  avgPlaceNow: number | null;
  avgPlacePrev: number | null;
  deltaAvgPlace: number | null;
  pickRateNow: number | null;
  pickRatePrev: number | null;
  deltaPickRate: number | null;
  top4RateNow: number | null;
  top4RatePrev: number | null;
  deltaTop4Rate: number | null;
  // true when the cluster appeared in now-window but not in prev — usually
  // means "new comp" (post-patch surge) and shouldn't be ranked by Δ at all.
  isNew: boolean;
}

// Minimum games per window for Δ to be considered statistically meaningful.
// Below that, the row keeps its raw now/prev counts but Δs are nulled — UI
// then renders an "—" / "NEW" badge rather than misleading noise.
const VELOCITY_MIN_PREV_GAMES = 30;

function deriveVelocity(v: VelocityRow): CompVelocity {
  const gn = Number(v.games_now);
  const gp = Number(v.games_prev);
  const pn = Number(v.participants_now);
  const pp = Number(v.participants_prev);
  const avgN = gn > 0 ? Number(v.sum_placement_now) / gn : null;
  const avgP = gp > 0 ? Number(v.sum_placement_prev) / gp : null;
  const pickN = pn > 0 ? gn / pn : null;
  const pickP = pp > 0 ? gp / pp : null;
  const t4N = gn > 0 ? Number(v.top4_now) / gn : null;
  const t4P = gp > 0 ? Number(v.top4_prev) / gp : null;
  const canDelta = gp >= VELOCITY_MIN_PREV_GAMES && gn >= VELOCITY_MIN_PREV_GAMES;
  return {
    gamesNow: gn,
    gamesPrev: gp,
    avgPlaceNow: avgN,
    avgPlacePrev: avgP,
    deltaAvgPlace: canDelta && avgN != null && avgP != null ? avgN - avgP : null,
    pickRateNow: pickN,
    pickRatePrev: pickP,
    deltaPickRate: canDelta && pickN != null && pickP != null ? pickN - pickP : null,
    top4RateNow: t4N,
    top4RatePrev: t4P,
    deltaTop4Rate: canDelta && t4N != null && t4P != null ? t4N - t4P : null,
    isNew: gp < 5 && gn >= 30,
  };
}

interface CounterEdge {
  opponent: string;   // cluster_key of the other comp
  games: number;
  winRate: number;    // this comp's win-rate vs `opponent` (0–1)
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sourceRaw = (searchParams.get('source') || 'data').toLowerCase();
  const source = VALID_SOURCES.has(sourceRaw) ? sourceRaw : 'data';
  const slug = searchParams.get('slug');
  // minGames-Default skaliert mit dem Tagesfenster: 70 Games/Tag, gecappt bei
  // 14 Tagen (max 980). Heißt: Last Day ≥70, 3 Days ≥210, 7 Days ≥490, 14 Days
  // ≥980. Filtert verrauschte Sub-Cluster mit nur 1-2 Spielen/Tag raus, ohne
  // dass etablierte Comps verschwinden. User-Override via ?minGames= bleibt
  // möglich (z.B. Debug-Views oder explorative Filter).
  const requestedDaysForMin = Math.max(1, Math.min(14, parseInt(searchParams.get('days') || '3', 10)));
  const defaultMinGames = 70 * requestedDaysForMin;
  const minGamesParam = searchParams.get('minGames');
  const minGames = minGamesParam != null
    ? Math.max(0, parseInt(minGamesParam, 10))
    : defaultMinGames;

  try {
    // Plan E — Per-Patch-Cache-Key. Lade die patches einmalig vorne und
    // redirecte ?patch=current|previous auf den konkreten Patch-String, damit
    // der Edge-Cache patch-spezifisch buckets statt einen langen 6h-Eintrag
    // unter dem Alias zu halten der bei Patch-Wechsel stale wird. Der Aufruf
    // ist gratis: resolveFilters() unten ruft `getAvailablePatches()` eh auf
    // und die Funktion cached process-weit für 6h (siehe _patchCache).
    const patches = await getAvailablePatches();
    const redirect = maybeRedirectByPatchAlias(request, patches);
    if (redirect) return redirect;
    // Plan B — Patch-Changed-Boost: in den ersten 4h nach Patch-Drop liefere
    // ein 5min-TTL statt 6h, damit das thin Pre-Patch-Sample nicht 6h lang
    // den Cache prägt. Hilfsfunktion liest patches[0].first_day.
    const cacheControl = cacheControlForPatches(patches);

    const filters = await resolveFilters(searchParams);

    // Detail view: full metrics (death-curve, comp-DNA, matchups) for the one
    // matched cluster only. These are heavy per row — entropy, variance and
    // several jsonb-dict merges — and the list never reads them, so we don't
    // compute them for every cluster (see baseComp vs enrichComp below).
    // The full RPC aggregates all 7 jsonb columns; only the detail path needs
    // the 4 detail-only ones, so the list path below uses the lean variant.
    if (slug) {
      const rows = await callRpc<CompRow[]>('get_tft_comp_stats', {
        p_regions: filters.regions,
        p_buckets: filters.buckets,
        p_days: filters.days,
        p_patch: filters.patch,
        p_set: filters.setNumber,
        p_min_games: minGames,
      });
      const participants = rows[0]?.participants || 0;
      let row = rows.find(r => r.cluster_key === slug);
      let aliasedFrom: string | null = null;
      // Core-Comp Consolidation: 1-3 unit / activation-level Varianten einer
      // Comp sind keine eigenständigen Comps (User-Vorgabe). Wenn der exakte
      // slug im aktuellen Window keine Daten hat, suchen wir nach Geschwistern
      // mit identischem Trait-Root UND Carry — also `<trait>@<x>_<carry>` für
      // alle x — und nehmen den mit den meisten Games. Der Fallback gilt nur
      // wenn die ähnliche Variante ≥ 50 Spiele hat; sonst echt "noch keine
      // Daten" und nicht aufdrängen.
      if (!row) {
        const m = /^(.+)@(\d+)_(.+)$/.exec(slug);
        if (m) {
          const sameCore = rows
            .filter(r => {
              const rm = /^(.+)@(\d+)_(.+)$/.exec(r.cluster_key);
              return rm && rm[1] === m[1] && rm[3] === m[3] && Number(r.games) >= 50;
            })
            .sort((a, b) => Number(b.games) - Number(a.games));
          if (sameCore.length > 0) {
            row = sameCore[0];
            aliasedFrom = slug;
          }
        }
      }
      if (!row) return cachedJson({ filters, hasData: false, comp: null }, { cache: cacheControl });
      // Stale UniqueTrait-Mega-Cluster aus pre-Fix-Daten ausblenden — siehe
      // isUniqueTraitClusterKey-Kommentar oben.
      if (isUniqueTraitClusterKey(row.cluster_key)) {
        return cachedJson({ filters, hasData: false, comp: null }, { cache: cacheControl });
      }
      const comp = { ...baseComp(row, participants), ...enrichComp(row), aliasedFrom };

      // Counter edges — single RPC for the same region/day/patch window.
      const pairs = await callRpc<CompPairRow[]>('get_tft_comp_pairs', {
        p_regions: filters.regions,
        p_days: filters.days,
        p_patch: filters.patch,
        p_set: filters.setNumber,
        p_min_games: 10,
      });
      const beats: CounterEdge[] = [];
      const losesTo: CounterEdge[] = [];
      const even: CounterEdge[] = [];
      for (const p of pairs) {
        if (p.a_key !== slug && p.b_key !== slug) continue;
        // Pre-Fix-UniqueTrait-Gegner aus den Counter-Listen halten — sie
        // verzerren das Matchup-Bild bis die alten DB-Rows aus dem Window fallen.
        const opponent = p.a_key === slug ? p.b_key : p.a_key;
        if (isUniqueTraitClusterKey(opponent)) continue;
        const aWinRate = p.games > 0 ? Number(p.a_better) / Number(p.games) : 0.5;
        // Normalize so winRate is always THIS comp's win-rate vs the opponent,
        // regardless of which side it sits on in the sorted (a_key,b_key) pair.
        const selfIsA = p.a_key === slug;
        const edge: CounterEdge = {
          opponent: selfIsA ? p.b_key : p.a_key,
          games: Number(p.games),
          winRate: selfIsA ? aWinRate : 1 - aWinRate,
        };
        if (edge.winRate >= 0.55) beats.push(edge);
        else if (edge.winRate <= 0.45) losesTo.push(edge);
        else even.push(edge);   // 45–55% band — the near-even matchups
      }
      beats.sort((a, b) => b.winRate - a.winRate);
      losesTo.sort((a, b) => a.winRate - b.winRate);
      // Even matchups ranked by sample size — the most-played coin-flips are
      // the most decision-relevant.
      even.sort((a, b) => b.games - a.games);

      return cachedJson({
        filters,
        hasData: true,
        comp: {
          ...comp,
          counters: {
            beats: beats.slice(0, 5),
            losesTo: losesTo.slice(0, 5),
            even: even.slice(0, 5),
          },
        },
      }, { cache: cacheControl });
    }

    // List view: lean RPC — aggregates only the 3 jsonb columns the list
    // renders (typical_units / augments / carry_items), skipping the 4
    // detail-only jsonb_agg merges. Measured ~12x faster cold (1847ms→152ms)
    // since the heavy detail jsonb is never detoasted or aggregated here.
    //
    // Optional velocity layer (W1-A): with ?velocity=N we fire a second RPC
    // in parallel and merge Δs (avg-place, pickrate, top4) into each row so
    // the listing can sort/visualise "what shifted in the last N days". N is
    // the shift between now-window (last `days` days) and prev-window.
    const velocityShift = Math.max(0, parseInt(searchParams.get('velocity') || '0', 10));
    const wantVelocity = velocityShift > 0;

    // Snapshot-Pfad: wenn das vorgerenderte Manifest einen passenden Eintrag
    // hat, liefern wir den Blob direkt. Spart den Supabase-RPC-Roundtrip + die
    // jsonb-Merges (Vercel-Blob fetch ~30-80ms vs. 150-3000ms RPC). Wir
    // überspringen den Snapshot wenn der Caller velocity oder source=editorial
    // verlangt — beides ist nicht im Bundle.
    if (source === 'data' && velocityShift === 0) {
      const hit = await lookupSnapshot('comps', {
        patch: filters.patch,
        region: filters.regionLabel,
        days: filters.requestedDays,
        bucket: filters.bucketLabel,
        minGames,
      });
      if (hit) {
        const resp = cachedJson(hit.payload, { cache: cacheControl });
        resp.headers.set('x-snapshot', hit.tag);
        return resp;
      }
    }

    const [rows, velocityRows] = await Promise.all([
      callRpc<CompRow[]>('get_tft_comp_stats_list', {
        p_regions: filters.regions,
        p_buckets: filters.buckets,
        p_days: filters.days,
        p_patch: filters.patch,
        p_set: filters.setNumber,
        p_min_games: minGames,
      }),
      wantVelocity
        ? callRpc<VelocityRow[]>('get_tft_comp_velocity', {
            p_regions: filters.regions,
            p_buckets: filters.buckets,
            p_set: filters.setNumber,
            p_patch: filters.patch,
            // Use the user-requested window size (not the stale-bumped one) so
            // "Letzter Tag + Δ vs vor 3 Tagen" really compares 1d vs 1d shifted
            // by 3d. The bump on filters.days is a fallback for the main list
            // when the pipeline is days behind — for Δ-comparisons it would
            // collapse the semantics ("1d" suddenly meaning "5d").
            p_days: filters.requestedDays,
            p_shift_days: velocityShift,
            // Anchor both windows at the last available stats day; otherwise
            // a 1d window on a 4d-stale pipeline lands in an empty range.
            p_anchor_offset_days: filters.anchorOffsetDays,
            // Allow newer entries with only a current-window sample to surface
            // as "NEW" rather than being filtered out for lacking a baseline.
            p_min_games: Math.max(10, Math.floor(minGames / 3)),
          }).catch(() => [] as VelocityRow[])
        : Promise.resolve([] as VelocityRow[]),
    ]);

    const participants = rows[0]?.participants || 0;
    const velocityByKey = new Map<string, VelocityRow>();
    for (const v of velocityRows) velocityByKey.set(v.cluster_key, v);

    const dataComps = rows
      .filter(r => !isUniqueTraitClusterKey(r.cluster_key))
      .map(r => {
        const base = baseComp(r, participants);
        const v = velocityByKey.get(r.cluster_key);
        if (!v) return base;
        return { ...base, velocity: deriveVelocity(v) };
      });
    dataComps.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));

    return cachedJson({
      hasData: dataComps.length > 0,
      filters: {
        region: filters.regionLabel,
        bucket: filters.bucketLabel,
        days: filters.days,
        requestedDays: filters.requestedDays,
        patch: filters.patch,
        set: filters.setNumber,
        velocityShift: wantVelocity ? velocityShift : null,
        anchorOffsetDays: filters.anchorOffsetDays,
      },
      patches,
      minGames,
      source,
      comps: source === 'editorial' ? [] : dataComps,
    }, { cache: cacheControl });
  } catch (e: any) {
    return NextResponse.json({ hasData: false, comps: [], error: e.message }, { status: 502 });
  }
}

// Cooccurrence-Threshold (≥40 %): Hybrid-Edge-Case-Units rausfiltern, die nur
// in einer Minderheit der Cluster-Spiele auftauchen. Beheben das Symptom, dass
// z.B. Gnar in 30 % der Meeple-Corki-Spiele die Top-9 + irreführende Items
// bringt. Der Carry aus dem clusterKey bleibt IMMER drin. Dieser Post-Filter
// greift auch auf ALTE Snapshots, bevor der nächste Aggregator-Lauf neue
// Daten mit demselben Threshold auf der Source-Seite schreibt.
function carryFromClusterKey(key: string): string | null {
  // Suffixe abknippen: *N (Star), ~<slug> (comp-definer Augment), #<sec>.
  const m = /^.+@\d+_([^#*~]+)(?:\*\d)?(?:~[A-Za-z]+)?(?:#.+)?$/.exec(key);
  return m ? m[1] : null;
}
function isUniqueTraitClusterKey(key: string): boolean {
  const m = /^(.+)@\d+_/.exec(key);
  return m ? /UniqueTrait$/.test(m[1]) : false;
}
function secondaryFromClusterKey(key: string): string | null {
  const m = /#(.+)$/.exec(key);
  return m ? m[1] : null;
}
function carryStarFromClusterKey(key: string): number {
  const m = /\*(\d)(?=[~#]|$)/.exec(key);
  return m ? Number(m[1]) : 2;
}
function augmentSlugFromClusterKey(key: string): string | null {
  // ~<Slug> direkt vor optional #<sec>. Default null.
  const m = /~([A-Za-z]+)(?=#|$)/.exec(key);
  return m ? m[1] : null;
}
function applyCooccurrenceFilter(
  units: Array<{ characterId: string; count: number } & Record<string, unknown>>,
  totalGames: number,
  carry: string | null,
  secondary: string | null = null,
) {
  const minCo = Math.max(1, Math.floor(totalGames * 0.40));
  return units.filter(
    u => (u.count || 0) >= minCo || u.characterId === carry || u.characterId === secondary,
  );
}

// Lean per-comp shape — base stats + the unit/augment/carry tiles that the
// comp LIST (CompRow) and landing CompCard render. No derived metrics.
function baseComp(r: CompRow, participants: number) {
  const carry = carryFromClusterKey(r.cluster_key);
  const secondary = secondaryFromClusterKey(r.cluster_key);
  const games = Number(r.games) || 0;
  return {
    source: 'data' as const,
    slug: r.cluster_key,
    clusterKey: r.cluster_key,
    games,
    avgPlacement: r.games > 0 ? Number(r.sum_placement) / Number(r.games) : null,
    top4Rate: r.games > 0 ? Number(r.top4) / Number(r.games) : null,
    top1Rate: r.games > 0 ? Number(r.top1) / Number(r.games) : null,
    pickRate: participants > 0 ? Number(r.games) / Number(participants) : null,
    avgLevel: r.games > 0 && r.sum_level ? Number(r.sum_level) / Number(r.games) : null,
    avgLastRound: r.games > 0 && r.sum_last_round ? Number(r.sum_last_round) / Number(r.games) : null,
    typicalUnits: applyCooccurrenceFilter(
      mergeJsonbCountArrays(r.typical_units_merged || [], 'characterId', 9, [
        { field: 'topItems', innerKey: 'apiName', topN: 3 },
      ])
        .filter(u => !isExcludedUnit((u as any).characterId))
        .map(u => {
          // Filter Thief's Gloves & Co. aus dem per-Unit Top-Items-Array.
          // mergeJsonbCountArrays cappte schon auf topN=3 — wenn ThG eins von
          // den dreien war, bleiben evtl. nur 2; das ist akzeptabel weil die
          // ehrlichste Antwort statt "Random Item draufknallen".
          const topItems = Array.isArray((u as any).topItems)
            ? (u as any).topItems.filter((it: any) => !isExcludedItem(it?.apiName))
            : (u as any).topItems;
          return { ...u, topItems };
        }) as Array<{ characterId: string; count: number } & Record<string, unknown>>,
      games,
      carry,
      secondary,
    ),
    typicalAugments: mergeJsonbCountArrays(r.typical_augments_merged || [], 'apiName', 6),
    carryItems: mergeCarryItems(r.carry_items_merged || []),
  };
}

// Detail-only derived metrics: Comp-DNA (flex / aggro / leveling / skill-cap)
// + the death-round histogram and survival→top4 curve. Heavy enough that we
// only run it for the single cluster a detail request asks for.
function enrichComp(r: CompRow) {
  const carry = carryFromClusterKey(r.cluster_key);
  const secondary = secondaryFromClusterKey(r.cluster_key);
  const games = Number(r.games) || 0;
  const typicalUnits = applyCooccurrenceFilter(
    mergeJsonbCountArrays(r.typical_units_merged || [], 'characterId', 9, [
      { field: 'topItems', innerKey: 'apiName', topN: 3 },
    ])
      .filter(u => !isExcludedUnit((u as any).characterId))
      .map(u => {
        const topItems = Array.isArray((u as any).topItems)
          ? (u as any).topItems.filter((it: any) => !isExcludedItem(it?.apiName))
          : (u as any).topItems;
        return { ...u, topItems };
      }) as Array<{ characterId: string; count: number } & Record<string, unknown>>,
    games,
    carry,
    secondary,
  );
  // Board-Composition: jeder Unit-Slot bekommt eine Kategorie aus seiner
  // Cooccurrence-Quote in dieser Comp:
  //   Core   ≥ 75 % — fast immer Pflicht
  //   Flex   50-75 % — situativ
  //   Tech   40-50 % — gezielter Konter / spätes Game
  // Ersetzt die alte Shannon-Entropy-Metrik, die durch den 40 %-Cooccurrence-
  // Pre-Filter eh fast immer 0.9-1.0 lag und damit keine sinnvolle Auflösung
  // mehr lieferte.
  const boardComposition = (() => {
    if (games <= 0 || typicalUnits.length === 0) return null;
    let core = 0, flex = 0, tech = 0;
    const slots = typicalUnits.map(u => {
      const co = (u.count || 0) / games;
      let kind: 'core' | 'flex' | 'tech';
      if (co >= 0.75) { core++; kind = 'core'; }
      else if (co >= 0.50) { flex++; kind = 'flex'; }
      else { tech++; kind = 'tech'; }
      return {
        characterId: (u as any).characterId,
        count: (u as any).count,
        cooccurrence: co,
        kind,
      };
    });
    return { core, flex, tech, slots };
  })();
  // Aggro-Index (Sprint 2.1): kills per game.
  const aggroIndex = r.games > 0 && r.sum_players_eliminated
    ? Number(r.sum_players_eliminated) / Number(r.games)
    : null;
  // Comp-Eco: avg gold left when the game ended. Low = spent out / all-in,
  // high = over-econ'd (or died early sitting on gold). Backfills from the
  // next crawl — null on pre-0024 rows so the UI just hides it.
  const avgGoldLeft = r.games > 0 && r.sum_gold_left
    ? Number(r.sum_gold_left) / Number(r.games)
    : null;
  // Leveling-Tempo-Curves (Sprint 2.2): per-final-level distribution +
  // avg death-round per level.
  const lvlGames = mergeJsonbCountDicts(r.level_dist_merged || []);
  const lvlSumRound = mergeJsonbCountDicts(r.level_sum_last_round_merged || []);
  const totalLevelGames = Object.values(lvlGames).reduce((s, n) => s + n, 0);
  const levelingTempo = Object.keys(lvlGames)
    .map(k => Number(k))
    .filter(n => Number.isFinite(n) && n >= 1 && n <= 11)
    .sort((a, b) => a - b)
    .map(level => {
      const g = lvlGames[String(level)] || 0;
      const sumRound = lvlSumRound[String(level)] || 0;
      return {
        level,
        games: g,
        share: totalLevelGames > 0 ? g / totalLevelGames : null,
        avgLastRound: g > 0 ? sumRound / g : null,
      };
    });
  // Tempo-Klassifikation — Peak-Level + Carry-Cost + 3-Star-Anteil in
  // Abhängigkeit zueinander setzen. tempoMeta wird VOLLSTÄNDIG erst nach
  // carryStarOutcome zusammengebaut (s.u.); hier nur die Level-Peak-Vorstufe.
  const tempoPeak = (() => {
    if (levelingTempo.length === 0) return null;
    const sorted = [...levelingTempo].sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
    const peak = sorted[0];
    if (!peak || peak.share == null) return null;
    return {
      peakLevel: peak.level,
      peakShare: peak.share,
      avgEndStage: peak.avgLastRound,
    };
  })();
  // Skill-Cap-Index (Sprint 2.3): spread of avgPlacement across rank-buckets
  // (only buckets with ≥ 20 games). Higher = execution-dependent.
  const buckets = r.bucket_breakdown || {};
  const bucketAvgs: { bucket: string; games: number; avgPlacement: number }[] = [];
  for (const [bk, v] of Object.entries(buckets)) {
    if (!v || (v as any).games < 20) continue;
    const games = Number((v as any).games);
    const sumP = Number((v as any).sum_placement);
    bucketAvgs.push({ bucket: bk, games, avgPlacement: sumP / games });
  }
  let skillCapIndex: number | null = null;
  let skillCapBuckets: typeof bucketAvgs = [];
  let skillCapCategory: 'consistent' | 'moderate' | 'high' | null = null;
  if (bucketAvgs.length >= 2) {
    const min = Math.min(...bucketAvgs.map(b => b.avgPlacement));
    const max = Math.max(...bucketAvgs.map(b => b.avgPlacement));
    skillCapIndex = max - min;
    skillCapCategory = skillCapIndex < 0.3 ? 'consistent'
      : skillCapIndex < 0.6 ? 'moderate'
      : 'high';
    skillCapBuckets = bucketAvgs.sort((a, b) => {
      const order = ['challenger','grandmaster','master','master_plus','diamond','emerald','platinum','gold','silver','bronze','iron','all','pro_pool'];
      return order.indexOf(a.bucket) - order.indexOf(b.bucket);
    });
  }
  // Death-round histogram + survival→top4 conditional.
  const roundGames = mergeJsonbCountDicts(r.last_round_dist_merged || []);
  const roundTop4 = mergeJsonbCountDicts(r.top4_by_round_merged || []);
  const totalGames = Number(r.games) || 0;
  const totalTop4 = Number(r.top4) || 0;
  const roundsSorted = Object.keys(roundGames)
    .map(k => Number(k))
    .filter(n => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  const roundHistogram = roundsSorted.map(round => ({
    round,
    games: roundGames[String(round)] || 0,
    top4: roundTop4[String(round)] || 0,
  }));
  // Survival curve: at each round r, P(top4 | last_round ≥ r).
  let cumGames = totalGames;
  let cumTop4 = totalTop4;
  const survivalToTop4 = roundsSorted.map(round => {
    const point = {
      round,
      atLeast: cumGames,
      top4Rate: cumGames > 0 ? cumTop4 / cumGames : null,
    } as { round: number; atLeast: number; top4Rate: number | null };
    cumGames -= (roundGames[String(round)] || 0);
    cumTop4 -= (roundTop4[String(round)] || 0);
    return point;
  });
  // Death-Story: Drei abgeleitete KPIs + 4-Phasen-Aggregation aus dem
  // 27-Round-Histogramm, damit die Detail-Page eine verständliche Story
  // statt einer dichten Composed-Chart zeigen kann.
  //
  // Stage-Round-Mapping (TFT-Konvention):
  //   Stage 1: rounds 1-3 (PvE) · Stage 2: 4-10 · Stage 3: 11-17
  //   Stage 4: 18-24 · Stage 5: 25-31 · Stage 6: 32-38 · Stage 7: 39-45
  //   Stage 8+: 46+
  //
  // Phase-Buckets:
  //   early = Stages 1-3 (round ≤ 17) — pre-level-7
  //   mid   = Stage 4   (18-24)       — Lvl 7-8 inflection
  //   late  = Stages 5-6 (25-38)       — Lvl 8-9 cap
  //   end   = Stage 7+ (≥ 39)          — top-2 fight
  const roundToPhase = (round: number): 'early' | 'mid' | 'late' | 'end' =>
    round <= 17 ? 'early' : round <= 24 ? 'mid' : round <= 38 ? 'late' : 'end';
  const phaseEndRound = { early: 17, mid: 24, late: 38, end: 99 } as const;
  type DeathPhase = 'early' | 'mid' | 'late' | 'end';
  const phaseAgg: Record<DeathPhase, { games: number; top4: number }> = {
    early: { games: 0, top4: 0 }, mid: { games: 0, top4: 0 },
    late: { games: 0, top4: 0 }, end: { games: 0, top4: 0 },
  };
  for (const h of roundHistogram) {
    const p = roundToPhase(h.round);
    phaseAgg[p].games += h.games;
    phaseAgg[p].top4 += h.top4;
  }
  // Cumulative survival at each round — re-derive separately from survivalToTop4
  // (which mutates cumGames in its build loop).
  const cumByRound = new Map<number, { atLeast: number; top4Rate: number | null }>();
  for (const s of survivalToTop4) {
    cumByRound.set(s.round, { atLeast: s.atLeast, top4Rate: s.top4Rate });
  }
  const survivalAt = (cutoff: number): { atLeast: number; top4Rate: number | null } | null => {
    // Größtes round ≤ cutoff aus den vorhandenen rounds nehmen.
    let best: { atLeast: number; top4Rate: number | null } | null = null;
    for (const round of roundsSorted) {
      if (round > cutoff) break;
      const v = cumByRound.get(round);
      if (v) best = v;
    }
    return best;
  };
  const phaseBreakdown = (['early', 'mid', 'late', 'end'] as DeathPhase[]).map(phase => {
    const pd = phaseAgg[phase];
    const survAfter = phase === 'end' ? null : survivalAt(phaseEndRound[phase] + 1);
    return {
      phase,
      games: pd.games,
      share: totalGames > 0 ? pd.games / totalGames : 0,
      top4InPhase: pd.games > 0 ? pd.top4 / pd.games : null,
      cumTop4AfterPhase: survAfter?.top4Rate ?? null,
      survivorsAfterPhase: survAfter?.atLeast ?? null,
    };
  });
  // Most-common death round = bin mit max games.
  const mostCommonEntry = roundHistogram.reduce<{ round: number; games: number; top4: number } | null>(
    (max, p) => p.games > (max?.games ?? 0) ? p : max, null,
  );
  const mostCommonRound = mostCommonEntry ? {
    round: mostCommonEntry.round,
    games: mostCommonEntry.games,
    share: totalGames > 0 ? mostCommonEntry.games / totalGames : 0,
    phase: roundToPhase(mostCommonEntry.round),
    top4Rate: mostCommonEntry.games > 0 ? mostCommonEntry.top4 / mostCommonEntry.games : null,
  } : null;
  // Top-4-Schwelle: erste round mit cum-Top-4-Rate ≥ 50 %.
  const top4ThresholdEntry = survivalToTop4.find(p => p.top4Rate != null && p.top4Rate >= 0.5) ?? null;
  // Stable: erste round mit cum-Top-4-Rate ≥ 90 %.
  const stableEntry = survivalToTop4.find(p => p.top4Rate != null && p.top4Rate >= 0.9) ?? null;
  const deathStory = {
    mostCommonRound,
    top4ThresholdRound: top4ThresholdEntry ? {
      round: top4ThresholdEntry.round,
      top4Rate: top4ThresholdEntry.top4Rate,
      atLeast: top4ThresholdEntry.atLeast,
      share: totalGames > 0 ? top4ThresholdEntry.atLeast / totalGames : 0,
    } : null,
    stableRound: stableEntry ? {
      round: stableEntry.round,
      top4Rate: stableEntry.top4Rate,
      atLeast: stableEntry.atLeast,
      share: totalGames > 0 ? stableEntry.atLeast / totalGames : 0,
    } : null,
    phaseBreakdown,
  };
  // W3-A: Carry-Star outcome — merge the per-day jsonb dicts into a per-star
  // summary (games, avgPlacement, top4Rate, top1Rate). Reroll comps show
  // dramatically better numbers at 3★ than at 2★; pros use the gap to decide
  // whether to slow-roll a level or push 8.
  const carryStarOutcome: { star: number; games: number; avgPlacement: number | null; top4Rate: number | null; top1Rate: number | null }[] = [];
  const csMerged: Record<string, { games: number; sumPlacement: number; top4: number; top1: number }> = {};
  for (const dayDict of (r.carry_star_dist_merged || [])) {
    if (!dayDict || typeof dayDict !== 'object' || Array.isArray(dayDict)) continue;
    for (const [star, e] of Object.entries(dayDict as Record<string, any>)) {
      if (!e || typeof e !== 'object') continue;
      const cur = csMerged[star] || { games: 0, sumPlacement: 0, top4: 0, top1: 0 };
      cur.games += Number(e.games ?? 0);
      cur.sumPlacement += Number(e.sumPlacement ?? e.sum_placement ?? 0);
      cur.top4 += Number(e.top4 ?? 0);
      cur.top1 += Number(e.top1 ?? 0);
      csMerged[star] = cur;
    }
  }
  for (const star of [1, 2, 3]) {
    const e = csMerged[String(star)];
    if (!e || e.games === 0) continue;
    carryStarOutcome.push({
      star,
      games: e.games,
      avgPlacement: e.sumPlacement / e.games,
      top4Rate: e.top4 / e.games,
      top1Rate: e.top1 / e.games,
    });
  }
  // Tempo-Vollkomposition: Peak-Level × Carry-Cost × 3-Star-Anteil. Die
  // ursprüngliche Heuristik "peak ≤ 7 = reroll" war zu naiv — ein 4-Cost-Push
  // mit Peak Lvl 7 wäre fälschlich Reroll geworden, ein 3-Cost-Reroll mit
  // Peak Lvl 6 (durch Pool-Kollision) auch.
  //
  // Riot Shop-Odds-Reroll-Tische:
  //   1-Cost  Reroll → Lvl 5  (75 % Pool)
  //   2-Cost  Reroll → Lvl 6  (50 % Pool)
  //   3-Cost  Reroll → Lvl 7  (40 % Pool)
  //   4-/5-Cost → kein Reroll (auf 9/10 cappen)
  //
  // Entscheidungsbaum:
  //   1. Wenn ≥40 % der Spiele 3-Star-Carry erreichen → klares Reroll-Signal,
  //      egal welcher Peak (Spieler hat genug investiert für die 3-Star).
  //   2. Sonst: Peak-Level mit Cost in Beziehung setzen.
  const tempoMeta = (() => {
    if (!tempoPeak) return null;
    const peakLevel = tempoPeak.peakLevel;
    const setNumber = setNumberFromClusterKey(r.cluster_key);
    const carryCost = setNumber != null
      ? loadChampionCostLookup(setNumber).get(carry || '') ?? null
      : null;
    const carryStar = carryStarFromClusterKey(r.cluster_key);
    const totalStarGames = carryStarOutcome.reduce((s, e) => s + e.games, 0);
    const threeStarShare = totalStarGames > 0
      ? (carryStarOutcome.find(e => e.star === 3)?.games ?? 0) / totalStarGames
      : 0;
    let category: 'reroll' | 'standard' | 'fast9' | 'capout';
    let rerollCost: number | null = null;
    // 3-Star-Sub-Cluster: per Definition Reroll-Variante, egal wie der Peak
    // aussieht — der Cluster trennt 3-Star-Boards explizit von 2-Star-Push.
    if (carryStar === 3 && carryCost != null && carryCost <= 3) {
      category = 'reroll';
      rerollCost = carryCost;
    } else if (threeStarShare >= 0.4 && carryCost != null && carryCost <= 3) {
      category = 'reroll';
      rerollCost = carryCost;
    } else if (peakLevel <= 5 && carryCost === 1) {
      category = 'reroll';
      rerollCost = 1;
    } else if (peakLevel === 6 && carryCost != null && carryCost <= 2) {
      category = 'reroll';
      rerollCost = carryCost;
    } else if (peakLevel === 7 && carryCost === 3) {
      category = 'reroll';
      rerollCost = 3;
    } else if (peakLevel <= 7) {
      category = 'standard';
    } else if (peakLevel === 8) {
      category = 'standard';
    } else if (peakLevel === 9) {
      category = 'fast9';
    } else {
      category = 'capout';
    }
    return {
      category,
      peakLevel,
      peakShare: tempoPeak.peakShare,
      avgEndStage: tempoPeak.avgEndStage,
      rerollCost,
      carryCost,
      carryStar,
      threeStarShare,
    };
  })();
  // W4-B: Contested-Distribution — per "how many lobby players forced this
  // comp" bucket {games, sumPlacement, top4, top1}. Solo = 1, one rival = 2,
  // 2+ rivals = 3 (capped to keep the UI from listing a long tail).
  const contestedOutcome: { contested: number; games: number; avgPlacement: number | null; top4Rate: number | null; top1Rate: number | null }[] = [];
  const cnMerged: Record<string, { games: number; sumPlacement: number; top4: number; top1: number }> = {};
  for (const dayDict of (r.contested_dist_merged || [])) {
    if (!dayDict || typeof dayDict !== 'object' || Array.isArray(dayDict)) continue;
    for (const [level, e] of Object.entries(dayDict as Record<string, any>)) {
      if (!e || typeof e !== 'object') continue;
      const cur = cnMerged[level] || { games: 0, sumPlacement: 0, top4: 0, top1: 0 };
      cur.games += Number(e.games ?? 0);
      cur.sumPlacement += Number(e.sumPlacement ?? e.sum_placement ?? 0);
      cur.top4 += Number(e.top4 ?? 0);
      cur.top1 += Number(e.top1 ?? 0);
      cnMerged[level] = cur;
    }
  }
  for (const lvl of [1, 2, 3]) {
    const e = cnMerged[String(lvl)];
    if (!e || e.games === 0) continue;
    contestedOutcome.push({
      contested: lvl,
      games: e.games,
      avgPlacement: e.sumPlacement / e.games,
      top4Rate: e.top4 / e.games,
      top1Rate: e.top1 / e.games,
    });
  }
  return {
    roundHistogram,
    survivalToTop4,
    aggroIndex,
    // Mathematischer Lobby-Durchschnitt für players_eliminated: 7 Mitspieler
    // verteilt auf 8 Plätze = 0.875 Eliminations pro Spieler im Schnitt.
    // Frontend zeigt das als Referenz, damit der 1.30-Wert nicht ohne Anker
    // dasteht.
    aggroLobbyAverage: 0.875,
    avgGoldLeft,
    deathStory,
    levelingTempo,
    tempoMeta,
    skillCapIndex,
    skillCapBuckets,
    skillCapCategory,
    boardComposition,
    carryStarOutcome,
    contestedOutcome,
  };
}

// Merge per-day carry-items lists ([{items:[…], count}, …]) into a single
// top-N by count. Key on the sorted-tuple representation of the items list.
// Sets, die ein excluded Item enthalten (z.B. Thief's Gloves), fliegen ganz
// raus — der Build ist dann mehr Zufalls-Snapshot als "Top-Build".
function mergeCarryItems(arrays: any[]): { items: string[]; count: number }[] {
  const map = new Map<string, { items: string[]; count: number }>();
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const e of arr) {
      const items = Array.isArray(e?.items) ? [...e.items].sort() : [];
      if (items.length === 0) continue;
      if (setContainsExcludedItem(items)) continue;
      const key = items.join('|');
      const cur = map.get(key) || { items, count: 0 };
      cur.count += Number(e.count ?? 0);
      map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 3);
}
