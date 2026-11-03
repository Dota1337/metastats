import { NextRequest, NextResponse } from 'next/server';
import { callRpc, getAvailablePatches, expandRegions, expandBuckets, ALL_REGIONS, type PatchInfo } from '../../../lib/tft-supabase-reader';
import { cachedJson } from '../../../lib/api-cache';
import {
  listKey,
  normalizePatchDiffRows,
  patchDiffWindowArgs,
  PATCH_DIFF_BUCKETS,
  type PatchDiffRow,
} from '../../../lib/snapshot-matrix';
import { loadPatchDiff } from '../../../lib/meta-pulse-diff-snapshot';
import { buildUnitTimeline, UNIT_HISTORY_CLOSED_MAX_AGE_MS, UNIT_HISTORY_MAX_PATCHES } from '../../../lib/tft-unit-history';

// /api/tft/unit-history?characterId=X&bucket=master_plus&region=all&patches=5
// Patch-Verlauf einer Unit (Ø-Platz, Top 4, Pickrate) ueber die letzten Patches.
//
// Alle Regionen nur aus den Dateien der Box (tft/patch-diff/*), kein Live-
// Rueckfall: ueber alle Regionen lief die Abfrage in die 8-s-Grenze, der Fehler
// wurde verschluckt und die leere Antwort 6 h gecacht (Karte fehlte seit Wochen,
// gefunden 03.11.2026). Fehlt eine Datei: weniger Punkte, kurz gecacht.
// Einzelregion live, je Patch genau sein Fenster (0,3-2,8 s, siehe patch-diff).
// Regionsgruppen und unbekannte Rang-Gruppen bietet die Seite nicht an, sie
// bleiben leer, statt je Wert eine Abfrage auszuloesen.

// Alle Units einer Region teilen sich dieselbe Abfrage je Patch und Rang-Gruppe:
// gleichzeitige Anfragen warten auf dieselbe, nach einem Fehler 60 s Ruhe.
const LIVE_RETRY_AFTER_MS = 60_000;
const liveInflight = new Map<string, Promise<PatchDiffRow[]>>();
const liveFailedAt = new Map<string, number>();

function liveRows(region: string, bucketLabel: string, buckets: string[], p: PatchInfo): Promise<PatchDiffRow[]> {
  const key = `${region}|${bucketLabel}|${p.patch}`;
  const running = liveInflight.get(key);
  if (running) return running;
  const failedAt = liveFailedAt.get(key);
  if (failedAt && Date.now() - failedAt < LIVE_RETRY_AFTER_MS) return Promise.reject(new Error('Pause nach Fehler'));
  const win = patchDiffWindowArgs(p);
  if (!win) return Promise.reject(new Error(`Patch ${p.patch} ohne Tage`));
  const run = callRpc<Record<string, unknown>[]>('get_tft_unit_stats', {
    p_regions: [region],
    p_buckets: buckets,
    ...win,
    p_patch: p.patch,
    p_set: p.set_number,
  })
    .then(rows => {
      liveFailedAt.delete(key);
      return normalizePatchDiffRows('unit', rows);
    })
    .catch((e: unknown) => {
      liveFailedAt.set(key, Date.now());
      throw e;
    })
    .finally(() => liveInflight.delete(key));
  liveInflight.set(key, run);
  return run;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const characterId = searchParams.get('characterId');
  if (!characterId) return NextResponse.json({ error: 'characterId required' }, { status: 400 });
  const wanted = parseInt(searchParams.get('patches') || '', 10);
  const patchCount = Math.max(2, Math.min(UNIT_HISTORY_MAX_PATCHES, wanted || UNIT_HISTORY_MAX_PATCHES));
  const bucket = searchParams.get('bucket') || 'master_plus';
  const regions = expandRegions(searchParams.get('region') || 'all');
  const allRegions = listKey(regions) === listKey(ALL_REGIONS);
  if (!Object.hasOwn(PATCH_DIFF_BUCKETS, bucket) || (!allRegions && regions.length !== 1)) {
    return cachedJson({ characterId, timeline: [] });
  }
  const buckets = expandBuckets(bucket);

  const allPatches = await getAvailablePatches(180);
  const patches = allPatches.slice(0, patchCount);
  // Leere Liste = Datenbank gerade nicht erreichbar: nicht 6 h festschreiben.
  if (patches.length === 0) return cachedJson({ characterId, timeline: [] }, { degraded: true });

  const rowsByPatch = await Promise.all(patches.map((p): Promise<PatchDiffRow[] | null> => (allRegions
    ? loadPatchDiff({
      entity: 'unit',
      regions,
      bucketLabel: bucket,
      buckets,
      patch: p,
      set: Number(p.set_number),
      closed: p.patch !== allPatches[0].patch,
      closedMaxAgeMs: UNIT_HISTORY_CLOSED_MAX_AGE_MS,
    })
    : liveRows(regions[0], bucket, buckets, p)
  ).catch(() => null)));

  const { timeline, missing } = buildUnitTimeline(characterId, patches, rowsByPatch);
  const res = cachedJson({ characterId, timeline }, { degraded: missing });
  res.headers.set('x-snapshot', `unit-history=${allRegions ? 'blob' : 'live'}${missing ? '-partial' : ''}`);
  return res;
}
