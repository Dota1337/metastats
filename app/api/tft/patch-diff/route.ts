import { NextRequest, NextResponse } from 'next/server';
import { callRpc, getAvailablePatches, expandBuckets, expandRegions, resolveDataEnd, resolvePatchFromList, ALL_REGIONS, type PatchInfo } from '../../../lib/tft-supabase-reader';
import { cachedJson, STATS_CACHE_CONTROL_FRESH } from '../../../lib/api-cache';
import { patchDeltaReady } from '../../../lib/tft-patch-delta';
import {
  listKey,
  normalizePatchDiffRows,
  patchDiffWindowArgs,
  previousPatchOf,
  sumPatchDiffLevels,
  PATCH_DIFF_BUCKETS,
  PATCH_DIFF_MIN_GAMES,
  PATCH_DIFF_P_DAYS,
  compMinRowGames,
  type CompAssign,
  type CompPatchDays,
  type PatchDiffEntity,
  type PatchDiffRow,
} from '../../../lib/snapshot-matrix';
import { loadPatchDiff } from '../../../lib/meta-pulse-diff-snapshot';
import { compactDeltaRows, loadPatchDeltaBlobs } from '../../../lib/patch-delta-server';
import { compAssignForPair } from '../../../lib/comp-assign-server';
import { patchDiffEntries } from '../../../lib/tft-patch-winners';
import { publicError } from '../../../lib/public-error';

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

  // full=1: alle Zeilen beider Seiten fuer den Δ-Vergleich „vs Vorpatch" der
  // Listen (Comps/Units/Items/Traits). Alle Regionen NUR aus den Blobs der Box
  // — live liefen comp/item dort in den 20-s-Deckel (HTTP 502, perf-critic
  // 18.10.2026). Fehlt ein Blob: leer und kurz gecacht, die Liste steht trotzdem.
  const full = searchParams.get('full') === '1';

  try {
    const patches = await getAvailablePatches(180);
    if (patches.length === 0) {
      return cachedJson({ hasData: false, winners: [], losers: [], patches: [], reason: 'no_patches' });
    }
    // Nur real vorhandene Patches akzeptieren. Ein frei erfundener Wert
    // erzeugte sonst pro Aufruf eine eigene Abfrage samt eigenem Cache-Key.
    // „current"/„previous" zentral aufloesen (wie die Listen) — frueher fiel
    // „previous" hier still auf den neuesten Patch zurueck.
    const knownPatches = new Set(patches.map(p => p.patch));
    const patchParam = searchParams.get('patch');
    const prevParam = searchParams.get('prev');
    const resolved = patchParam ? await resolvePatchFromList(patches, patchParam) : null;
    if (full && patchParam && !(resolved && knownPatches.has(resolved))) {
      // Kurz gecacht: beim Patchwechsel kennt eine Instanz den neuen Patch
      // bis zu 6 h nicht (Patch-Liste je Instanz), die Edge soll das nicht festhalten.
      return cachedJson({ hasData: false, entity, reason: 'unknown_patch' }, { cache: STATS_CACHE_CONTROL_FRESH });
    }
    const currentPatch = resolved && knownPatches.has(resolved) ? resolved : patches[0].patch;
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

    const infoOf = (patch: string) => patches.find(p => p.patch === patch);
    const setNumber = infoOf(currentPatch)?.set_number ?? patches[0].set_number;
    // Unbekannte Region-Werte faengt expandRegions ab (sonst: eine eigene
    // Abfrage je erfundenem Wert).
    const regions = region ? expandRegions(region) : ALL_REGIONS;
    const allRegions = listKey(regions) === listKey(ALL_REGIONS);

    if (full) {
      return fullRows({
        entity, regions, allRegions, bucketParam, buckets, patches,
        current: infoOf(currentPatch), previous: infoOf(previousPatch),
      });
    }

    // Comps: beide Seiten in derselben Zaehlart (Comp-Katalog Phase 3,
    // compDeltaAssign); zaehlen sie verschieden, gibt es keinen Vergleich.
    let comp: { assign: CompAssign; days: Record<string, CompPatchDays> } | null = null;
    if (entity === 'comp') {
      const pair = await compAssignForPair(Number(setNumber), regions, currentPatch, previousPatch);
      if (!pair) throw new Error('Katalog-Tage nicht lesbar');
      if (!pair.assign) {
        return cachedJson({ hasData: false, currentPatch, previousPatch, entity, patches, winners: [], losers: [], reason: 'assign' });
      }
      comp = { assign: pair.assign, days: { [currentPatch]: pair.current, [previousPatch]: pair.previous } };
    }
    // Je Seite zuerst der vorgerechnete Blob (nur alle Regionen), sonst live.
    let fromBlob = 0;
    const side = async (patch: string): Promise<PatchDiffRow[]> => {
      const info = infoOf(patch);
      if (allRegions && info) {
        const rows = await loadPatchDiff({
          entity, regions, bucketLabel: bucketParam, buckets,
          patch: info, set: Number(setNumber), closed: patch !== patches[0].patch,
          ...(comp ? { assign: comp.assign, days: comp.days[patch] } : {}),
        });
        if (rows) { fromBlob++; return rows; }
      }
      return fetchEntityRows(entity, info ?? patch, setNumber, regions, buckets, LIVE_TIMEOUT_MS,
        comp ? { assign: comp.assign, days: comp.days[patch] } : undefined);
    };
    // Patch-Gewinner fragt nach der Eigenschaft, nicht nach ihrer Stufe.
    const [curr, prev] = (await Promise.all([side(currentPatch), side(previousPatch)])).map(sumPatchDiffLevels);
    // Dieselbe Rechnung wie die Startdaten der Seite (seo/page-start-tft.ts).
    const { sampleSize, winners, losers } = patchDiffEntries(curr, prev);

    const res = cachedJson({
      hasData: sampleSize > 0,
      currentPatch,
      previousPatch,
      entity,
      patches,
      sampleSize,
      winners,
      losers,
    });
    // Messung: kamen beide Seiten aus der Datei (blob), eine (mixed) oder keine?
    res.headers.set('x-snapshot', `patch-diff=${fromBlob === 2 ? 'blob' : fromBlob === 1 ? 'mixed' : 'live'}`);
    return res;
  } catch (e: any) {
    return NextResponse.json({ hasData: false, winners: [], losers: [], error: publicError('tft/patch-diff', e, 'stats_unavailable') }, { status: 502 });
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
const LIVE_RPC: Record<Entity, (args: Record<string, unknown>, ms: number) => Promise<RpcRows>> = {
  unit: (args, ms) => callRpc<RpcRows>('get_tft_unit_stats', args, ms),
  item: (args, ms) => callRpc<RpcRows>('get_tft_item_stats_list', args, ms),
  trait: (args, ms) => callRpc<RpcRows>('get_tft_trait_stats', args, ms),
  comp: (args, ms) => callRpc<RpcRows>('get_tft_comp_stats_for_diff', { ...args, p_min_games: PATCH_DIFF_MIN_GAMES }, ms),
};

const LIVE_TIMEOUT_MS = 20000;
// Δ-Vergleich der Listen, Einzelregion: dieselbe Grenze wie jede Besucher-
// Abfrage (tft-supabase-reader.ts RPC_TIMEOUT_MS) — live 0,3-2,8 s gemessen.
const FULL_LIVE_TIMEOUT_MS = 8000;

// Je Patch genau sein Fenster (erster bis letzter Tag, Migration 0095) —
// die alten 30 Tage ab heute schnitten aeltere Patches still ab.
async function fetchEntityRows(
  entity: Entity,
  patch: PatchInfo | string,
  setNumber: number | null,
  regions: string[],
  buckets: string[],
  timeoutMs: number,
  /** Nur Comps: Zaehlart beider Seiten (Migration 0102) und Tage dieser Seite (0107). */
  comp?: { assign: CompAssign; days?: CompPatchDays },
): Promise<PatchDiffRow[]> {
  const info = typeof patch === 'string' ? null : patch;
  const win = info ? patchDiffWindowArgs(info) : null;
  // Klassische Seite eines gemischten Patches: nur Zeilen ab 8 Spielen (0107).
  const minRow = entity === 'comp' && comp?.days ? compMinRowGames(comp.assign, comp.days) : null;
  const rows = await LIVE_RPC[entity]({
    p_regions: regions,
    p_buckets: buckets,
    ...(win ?? { p_days: PATCH_DIFF_P_DAYS }),
    p_patch: info ? info.patch : patch,
    p_set: setNumber,
    ...(entity === 'comp' && comp ? { p_assign: comp.assign } : {}),
    ...(minRow != null ? { p_min_row_games: minRow } : {}),
  }, timeoutMs);
  return normalizePatchDiffRows(entity, rows);
}

async function fullRows(o: {
  entity: Entity;
  regions: string[];
  allRegions: boolean;
  bucketParam: string;
  buckets: string[];
  patches: PatchInfo[];
  current: PatchInfo | undefined;
  previous: PatchInfo | undefined;
}): Promise<NextResponse> {
  const { entity, current, previous } = o;
  const head = { entity, currentPatch: current?.patch ?? null, previousPatch: previous?.patch ?? null };
  if (!current || !previous) return cachedJson({ hasData: false, ...head, reason: 'single_patch' });
  // Kein Vergleich ueber eine Set-Grenze und keiner vor dem ersten vollen Tag
  // (patchDeltaReady, dieselbe Regel wie die Filterleiste: der Starttag mischt
  // noch Spiele des alten Patches). „too_new" nur kurz gecacht — am Morgen des
  // ersten vollen Tags kippt die Antwort.
  if (Number(current.set_number) !== Number(previous.set_number)) {
    return cachedJson({ hasData: false, ...head, reason: 'cross_set' });
  }
  const dataEnd = await resolveDataEnd(null).catch(() => null);
  if (!patchDeltaReady(o.patches, current, previous, dataEnd)) {
    return cachedJson({ hasData: false, ...head, reason: 'too_new' }, { cache: STATS_CACHE_CONTROL_FRESH });
  }
  const set = Number(current.set_number);
  const source = o.allRegions ? 'blob' : 'live';
  // Comps vergleichen nur gleich gezaehlte Seiten (compDeltaAssign); 'assign'
  // = sie zaehlen verschieden, die Liste zeigt dann kein Δ.
  const noPair = () => cachedJson({ hasData: false, ...head, reason: 'assign' });
  let sides: [PatchDiffRow[], PatchDiffRow[]] | null = null;
  let assign: CompAssign | undefined;
  let compDays: [CompPatchDays, CompPatchDays] | null = null;
  try {
    if (o.allRegions) {
      if (!PATCH_DIFF_BUCKETS[o.bucketParam]) return cachedJson({ hasData: false, ...head, reason: 'bucket' });
      const blobs = await loadPatchDeltaBlobs({
        entity, regions: o.regions, bucketLabel: o.bucketParam,
        current, previous, newestPatch: o.patches[0].patch,
      });
      if (blobs?.kind === 'assign') return noPair();
      if (blobs) { sides = [blobs.current, blobs.previous]; assign = blobs.assign; }
    } else {
      if (entity === 'comp') {
        const pair = await compAssignForPair(set, o.regions, current.patch, previous.patch);
        if (!pair) throw new Error('Katalog-Tage nicht lesbar');
        if (!pair.assign) return noPair();
        assign = pair.assign;
        compDays = [pair.current, pair.previous];
      }
      sides = await Promise.all([current, previous].map((info, i) =>
        fetchEntityRows(entity, info, set, o.regions, o.buckets, FULL_LIVE_TIMEOUT_MS,
          assign ? { assign, days: compDays?.[i] } : undefined))) as [PatchDiffRow[], PatchDiffRow[]];
    }
  } catch {
    sides = null;
  }
  if (!sides) {
    const res = cachedJson({ hasData: false, ...head, reason: 'pending' }, { degraded: true });
    res.headers.set('x-snapshot', 'patch-diff=pending');
    return res;
  }
  const res = cachedJson({
    hasData: true,
    ...head,
    minGames: PATCH_DIFF_MIN_GAMES,
    ...(assign ? { assign } : {}),
    current: compactDeltaRows(sides[0]),
    previous: compactDeltaRows(sides[1]),
  });
  res.headers.set('x-snapshot', `patch-diff=${source}`);
  return res;
}
