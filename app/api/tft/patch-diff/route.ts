import { NextRequest, NextResponse } from 'next/server';
import { callRpc, getAvailablePatches, expandBuckets, expandRegions, ALL_REGIONS } from '../../../lib/tft-supabase-reader';
import { cachedJson } from '../../../lib/api-cache';
import {
  listKey,
  normalizePatchDiffRows,
  previousPatchOf,
  PATCH_DIFF_MIN_GAMES,
  PATCH_DIFF_P_DAYS,
  type PatchDiffEntity,
  type PatchDiffRow,
} from '../../../lib/snapshot-matrix';
import { loadPatchDiff } from '../../../lib/meta-pulse-diff-snapshot';

// /api/tft/patch-diff?patch=17.2&prev=17.1&entity=unit|item|trait
//
// Returns each entity's avg-placement / pick-rate / top4 delta between the
// two patches. The diff is computed in-process from two RPC calls (one per
// patch) rather than a SQL JOIN — keeps the existing RPCs reusable and the
// payload small.
//
// `prev` defaults to the Vorpatch of `patch` nach previousPatchOf
// (snapshot-matrix.ts): der juengste fruehere Patch mit genug Datentagen,
// ein Kurz-Patch wird uebersprungen. Gibt es keinen, liefern wir leere
// `winners` / `losers` (reason 'single_patch') statt eines Fehlers.
//
// Alle Regionen: die Rohzeilen je Patch rechnet die Box vor
// (scripts/publish-meta-pulse-diffs.mjs, tft/patch-diff/*). Fehlt ein Blob
// oder ist er veraltet, rechnet diese Seite live wie bisher.

type Entity = PatchDiffEntity;

interface DiffEntry {
  key: string;
  currentGames: number;
  previousGames: number;
  currentAvgPlacement: number;
  previousAvgPlacement: number;
  deltaAvgPlacement: number;        // negative = better in current patch
  currentPickRate: number;
  previousPickRate: number;
  deltaPickRate: number;
  currentTop4Rate: number;
  previousTop4Rate: number;
  deltaTop4Rate: number;
}

const MIN_GAMES = PATCH_DIFF_MIN_GAMES;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const entity = (searchParams.get('entity') || 'unit').toLowerCase() as Entity;
  if (!['unit', 'item', 'trait', 'comp'].includes(entity)) {
    return NextResponse.json({ error: 'invalid entity' }, { status: 400 });
  }
  const region = searchParams.get('region');
  const bucketParam = searchParams.get('bucket') || 'master_plus';
  // Expand group names ('master_plus','all','pro_pool') to the real bucket
  // values stored in the stats tables — the RPC matches bucket = ANY(...),
  // and there are no rows literally tagged 'master_plus'.
  const buckets = expandBuckets(bucketParam);

  try {
    const patches = await getAvailablePatches(180);
    if (patches.length === 0) {
      return cachedJson({ hasData: false, winners: [], losers: [], patches: [], reason: 'no_patches' });
    }
    // Nur real vorhandene Patches akzeptieren. Ein frei erfundener Wert
    // erzeugte sonst pro Aufruf eine eigene Abfrage samt eigenem Cache-Key.
    const knownPatches = new Set(patches.map(p => p.patch));
    const patchParam = searchParams.get('patch');
    const prevParam = searchParams.get('prev');
    const currentPatch = patchParam && knownPatches.has(patchParam) ? patchParam : patches[0].patch;
    const previousPatch = prevParam && knownPatches.has(prevParam)
      ? prevParam
      : (previousPatchOf(patches, currentPatch)?.patch ?? null);
    if (!previousPatch || currentPatch === previousPatch) {
      // Single-patch state — the pipeline hasn't accumulated a previous
      // version yet. Return the current entity stats so the UI can show
      // them as a "current only" baseline.
      return cachedJson({
        hasData: false, winners: [], losers: [],
        patches, currentPatch, previousPatch: null, reason: 'single_patch',
      });
    }

    const setNumber = patches.find(p => p.patch === currentPatch)?.set_number
                    ?? patches[0].set_number;
    // Unbekannte Region-Werte faengt expandRegions ab (sonst: eine eigene
    // Abfrage je erfundenem Wert).
    const regions = region ? expandRegions(region) : ALL_REGIONS;
    const allRegions = listKey(regions) === listKey(ALL_REGIONS);

    // Je Seite zuerst der vorgerechnete Blob (nur alle Regionen), sonst live.
    const side = async (patch: string): Promise<PatchDiffRow[]> => {
      const info = patches.find(p => p.patch === patch);
      if (allRegions && info) {
        const rows = await loadPatchDiff({
          entity, regions, bucketLabel: bucketParam, buckets,
          patch: info, set: Number(setNumber), closed: patch !== patches[0].patch,
        });
        if (rows) return rows;
      }
      return fetchEntityRows(entity, patch, setNumber, regions, buckets);
    };
    const [curr, prev] = await Promise.all([side(currentPatch), side(previousPatch)]);

    const prevMap = new Map(prev.map(r => [r.key, r]));
    const diffs: DiffEntry[] = [];
    for (const c of curr) {
      const p = prevMap.get(c.key);
      if (!p) continue;
      if (c.games < MIN_GAMES || p.games < MIN_GAMES) continue;
      const cAvg = c.sum_placement / c.games;
      const pAvg = p.sum_placement / p.games;
      const cPick = c.participants > 0 ? c.games / c.participants : 0;
      const pPick = p.participants > 0 ? p.games / p.participants : 0;
      const cTop4 = c.top4 / c.games;
      const pTop4 = p.top4 / p.games;
      diffs.push({
        key: c.key,
        currentGames: c.games,
        previousGames: p.games,
        currentAvgPlacement: cAvg,
        previousAvgPlacement: pAvg,
        deltaAvgPlacement: cAvg - pAvg,
        currentPickRate: cPick,
        previousPickRate: pPick,
        deltaPickRate: cPick - pPick,
        currentTop4Rate: cTop4,
        previousTop4Rate: pTop4,
        deltaTop4Rate: cTop4 - pTop4,
      });
    }

    // Winners = avg placement got better (lower) by the largest amount.
    // Losers = avg placement got worse (higher).
    const winners = [...diffs].sort((a, b) => a.deltaAvgPlacement - b.deltaAvgPlacement).slice(0, 15);
    const losers  = [...diffs].sort((a, b) => b.deltaAvgPlacement - a.deltaAvgPlacement).slice(0, 15);

    return cachedJson({
      hasData: diffs.length > 0,
      currentPatch,
      previousPatch,
      entity,
      patches,
      sampleSize: diffs.length,
      winners,
      losers,
    });
  } catch (e: any) {
    return NextResponse.json({ hasData: false, winners: [], losers: [], error: e.message }, { status: 502 });
  }
}

// Zusammenlegen der Zeilen teilt sich die Route mit der Box (snapshot-matrix.ts).
// Funktionsnamen im Klartext, damit die Schnittstellen-Karte
// (scripts/build-api-map.mjs) die Kanten sieht; snapshot-matrix.test.mjs haelt
// sie gleich mit PATCH_DIFF_RPC, mit dem die Box rechnet. Item nutzt die
// schlanke RPC (Migration 0028), Comp die reine Zahlen-RPC (Migration 0035) —
// die vollen Varianten liefen bei 30 Tagen in den Timeout bzw. trugen 10 MB
// jsonb je Aufruf.
type RpcRows = Record<string, unknown>[];
const LIVE_RPC: Record<Entity, (args: Record<string, unknown>) => Promise<RpcRows>> = {
  unit: args => callRpc<RpcRows>('get_tft_unit_stats', args, 20000),
  item: args => callRpc<RpcRows>('get_tft_item_stats_list', args, 20000),
  trait: args => callRpc<RpcRows>('get_tft_trait_stats', args, 20000),
  comp: args => callRpc<RpcRows>('get_tft_comp_stats_for_diff', { ...args, p_min_games: PATCH_DIFF_MIN_GAMES }, 20000),
};

async function fetchEntityRows(
  entity: Entity,
  patch: string,
  setNumber: number | null,
  regions: string[],
  buckets: string[],
): Promise<PatchDiffRow[]> {
  const rows = await LIVE_RPC[entity]({
    p_regions: regions,
    p_buckets: buckets,
    p_days: PATCH_DIFF_P_DAYS,
    p_patch: patch,
    p_set: setNumber,
  });
  return normalizePatchDiffRows(entity, rows);
}
