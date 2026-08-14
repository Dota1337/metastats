import { NextRequest, NextResponse } from 'next/server';
import { callRpc, expandBuckets, BUCKET_GROUPS, getAvailablePatches } from '../../../../lib/tft-supabase-reader';
import { parsePatch, parseBoundedInt } from '../../../../lib/query-params';
import { cachedJson } from '../../../../lib/api-cache';

// W2-A: Region-Divergence — pro Comp den KR vs EU vs NA Vergleich.
// Default-Window 7 Tage: KR-Crawls ziehen oft mit Verzögerung nach, ein
// 3-Tage-Fenster blendet sie regelmäßig komplett aus.
//
// Output sortiert nach krAheadScore: positive Werte = KR spielt die Comp
// häufiger UND besser als EU. Ideal um „was spielt KR vor uns?" zu erkennen.

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
  const { searchParams } = new URL(request.url);
  const days = Math.max(1, Math.min(14, parseInt(searchParams.get('days') || '7', 10)));
  const minGames = parseBoundedInt(searchParams.get('min'), { min: 10, max: 100000, fallback: 100 });
  const bucketRaw = searchParams.get('bucket') || 'master_plus';
  const buckets = expandBuckets(bucketRaw);
  // Label nur zurueckspiegeln, wenn es auch wirklich gegriffen hat — sonst
  // taucht ein erfundener Wert in der Antwort und im Cache-Key auf.
  const bucketLabel = BUCKET_GROUPS[bucketRaw] ? bucketRaw : buckets.join(',');
  const patchParam = searchParams.get('patch') || 'any';
  let patch: string | null = null;
  if (patchParam === 'current' || patchParam === 'previous') {
    const patches = await getAvailablePatches();
    patch = patchParam === 'current' ? patches[0]?.patch ?? null : patches[1]?.patch ?? null;
  } else if (patchParam !== 'any' && parsePatch(patchParam)) {
    // Nur Patches, die es in der Datenlage wirklich gibt. Die Formatpruefung
    // allein liesse noch ein paar tausend erfundene Werte durch, und jeder
    // davon waere eine eigene Abfrage.
    const patches = await getAvailablePatches();
    patch = patches.some(p => p.patch === patchParam) ? patchParam : null;
  }

  try {
    const rows = await callRpc<RegionRow[]>('get_tft_region_divergence', {
      p_buckets: buckets,
      p_set: 17,
      p_patch: patch,
      p_days: days,
      p_min_games: minGames,
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

    return cachedJson({
      hasData: enriched.length > 0,
      days,
      bucket: bucketLabel,
      minGames,
      patch,
      comps: enriched,
    });
  } catch (e: any) {
    return NextResponse.json({ hasData: false, comps: [], error: e.message }, { status: 502 });
  }
}
