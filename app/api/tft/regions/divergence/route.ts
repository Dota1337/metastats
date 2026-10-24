import { NextRequest, NextResponse } from 'next/server';
import {
  callRpc, expandBuckets, BUCKET_GROUPS, getAvailablePatches, resolveDefaultBucket, resolveDataEnd,
} from '../../../../lib/tft-supabase-reader';
import { parsePatch, parseBoundedInt } from '../../../../lib/query-params';
import { CURRENT_SET } from '../../../../lib/current-set';
import { cachedJson } from '../../../../lib/api-cache';
import { previousPatchOf } from '../../../../lib/snapshot-matrix';
import { readRouteMirror, withSnapshotHeader } from '../../../../lib/route-mirror-read';
import { publicError } from '../../../../lib/public-error';

// W2-A: Region-Divergence — pro Comp den KR vs EU vs NA Vergleich.
// Default-Window 7 Tage: KR-Crawls ziehen oft mit Verzögerung nach, ein
// 3-Tage-Fenster blendet sie regelmäßig komplett aus. Seit Migration 0070
// zaehlt das Fenster ab dem juengsten Datentag (kr/euw1/na1), nicht ab heute.
//
// Output sortiert nach krAheadScore: positive Werte = KR spielt die Comp
// häufiger UND besser als EU. Ideal um „was spielt KR vor uns?" zu erkennen.
//
// Die 12 Ansichten der Seite (3/7/14 Tage × 4 Raenge, min 80, patch any) legt
// die Box alle 3 h als Datei ab (Route-Spiegel, app/lib/route-mirror.mjs).

interface RegionRow {
  cluster_key: string;
  games_kr: number;
  games_eu: number;
  games_na: number;
  avg_place_kr: number | null;
  avg_place_eu: number | null;
  avg_place_na: number | null;
  pickrate_kr: number | null;
  pickrate_eu: number | null;
  pickrate_na: number | null;
}

export async function GET(request: NextRequest) {
  const mirrored = await readRouteMirror('regions', request);
  if (mirrored) return withSnapshotHeader(cachedJson(mirrored), 'regions', true);

  const { searchParams } = new URL(request.url);
  const days = parseBoundedInt(searchParams.get('days'), { min: 1, max: 14, fallback: 7 });
  const minGames = parseBoundedInt(searchParams.get('min'), { min: 10, max: 100000, fallback: 100 });
  // Diese Route parst ihre Buckets bewusst selbst (kein resolveFilters), teilt
  // sich aber denselben Set-Start-Effekt: mit dem Set-Pin hat master_plus zum
  // Set-Start null Rows. Ohne Bucket-Angabe entscheidet deshalb die Datenlage.
  const bucketRaw = searchParams.get('bucket') || await resolveDefaultBucket();
  const buckets = expandBuckets(bucketRaw);
  // Label nur zurueckspiegeln, wenn es auch wirklich gegriffen hat — sonst
  // taucht ein erfundener Wert in der Antwort und im Cache-Key auf.
  const bucketLabel = Object.hasOwn(BUCKET_GROUPS, bucketRaw) ? bucketRaw : buckets.join(',');
  const patchParam = searchParams.get('patch') || 'any';
  let patch: string | null = null;
  if (patchParam === 'current' || patchParam === 'previous') {
    const patches = await getAvailablePatches();
    patch = patchParam === 'current'
      ? patches[0]?.patch ?? null
      : previousPatchOf(patches, patches[0]?.patch)?.patch ?? null;
    // Kein Vorpatch: leere Antwort. p_patch=null hiesse „ueber alle Patches".
    if (patchParam === 'previous' && !patch) {
      return cachedJson({ hasData: false, days, bucket: bucketLabel, minGames, patch: null, comps: [] });
    }
  } else if (patchParam !== 'any' && parsePatch(patchParam)) {
    // Nur Patches, die es in der Datenlage wirklich gibt. Die Formatpruefung
    // allein liesse noch ein paar tausend erfundene Werte durch, und jeder
    // davon waere eine eigene Abfrage.
    const patches = await getAvailablePatches();
    patch = patches.some(p => p.patch === patchParam) ? patchParam : null;
  }

  try {
    // Volle Tage (0095): das Fenster endet spaetestens am letzten
    // vollstaendigen Tag, die Funktion sucht darunter den juengsten Datentag.
    const dataEnd = await resolveDataEnd(searchParams.get('end')).catch(() => null);
    const rows = await callRpc<RegionRow[]>('get_tft_region_divergence', {
      p_buckets: buckets,
      p_set: CURRENT_SET,
      p_patch: patch,
      p_days: days,
      p_min_games: minGames,
      ...(dataEnd ? { p_end_day: dataEnd } : {}),
    }, 20000);

    // KR-Ahead score: weight pickrate-Δ higher than avg-place-Δ because the
    // pickrate gap is what makes a meta shift visible — avg-place difference
    // is small even when one region is clearly ahead. Multiplier of 1000
    // brings the two terms into the same order of magnitude.
    const enriched = rows.map(r => {
      const dPickEu = r.pickrate_kr != null && r.pickrate_eu != null ? r.pickrate_kr - r.pickrate_eu : null;
      const dPickNa = r.pickrate_kr != null && r.pickrate_na != null ? r.pickrate_kr - r.pickrate_na : null;
      const dPlaceEu = r.avg_place_kr != null && r.avg_place_eu != null ? r.avg_place_eu - r.avg_place_kr : null;
      const dPlaceNa = r.avg_place_kr != null && r.avg_place_na != null ? r.avg_place_na - r.avg_place_kr : null;
      const krAheadEu = dPickEu != null && dPlaceEu != null ? dPickEu * 1000 + dPlaceEu : null;
      const krAheadNa = dPickNa != null && dPlaceNa != null ? dPickNa * 1000 + dPlaceNa : null;
      return { ...r, dPickEu, dPickNa, dPlaceEu, dPlaceNa, krAheadEu, krAheadNa };
    });

    // Promote rows with at least one valid score so the page shows substance
    // instead of a sea of nulls. Pure-EU comps (no KR games) get sorted to
    // the bottom but stay listed so users can compare without surprises.
    enriched.sort((a, b) => {
      const sa = Math.max(a.krAheadEu ?? -1e9, a.krAheadNa ?? -1e9);
      const sb = Math.max(b.krAheadEu ?? -1e9, b.krAheadNa ?? -1e9);
      return sb - sa;
    });

    return withSnapshotHeader(cachedJson({
      hasData: enriched.length > 0,
      days,
      bucket: bucketLabel,
      minGames,
      patch,
      comps: enriched,
    }), 'regions', false);
  } catch (e: any) {
    return NextResponse.json({ hasData: false, comps: [], error: publicError('tft/regions/divergence', e, 'stats_unavailable') }, { status: 502 });
  }
}
