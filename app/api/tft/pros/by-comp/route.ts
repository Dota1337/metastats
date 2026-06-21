import { NextRequest, NextResponse } from 'next/server';
import { fetchHetznerProsByComp } from '../../../../lib/tft-hetzner-matches';
import { supabase } from '../../../../lib/supabase';
import { cachedJson, STATS_CACHE_CONTROL } from '../../../../lib/api-cache';

// /api/tft/pros/by-comp?family=<trait>__<carry>&set=17
// ODER /api/tft/pros/by-comp?cluster=<trait>@<level>_<carry>&set=17
//
// Reverse-Lookup: welche Pro-Player spielen diese Comp. Pulled Pro-Player-
// Liste (puuid + Name + Tag + Region) aus tft_pro_players, schickt puuids
// an Hetzner-Endpoint /pros-by-comp, joined Aggregat mit Pro-Names.
//
// Family-Mode (recommended) matched alle Sub-Cluster (Star/Augment/Level)
// der gleichen <trait>__<carry>-Familie. Cluster-Mode fuer exact-Match.
//
// Voraussetzung: Hetzner-Cache muss mit unifizierter Klassifikation re-
// klassifiziert sein. Siehe reference_tft_classification_bridge.md.

const PRO_CLASSIFICATIONS = ['streamer', 'tpc'];

interface ProRow {
  puuid: string;
  game_name: string | null;
  tag_line: string | null;
  region: string | null;
  classification: string | null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const family = searchParams.get('family');
  const cluster = searchParams.get('cluster');
  if (!family && !cluster) {
    return NextResponse.json({ error: 'family or cluster required' }, { status: 400 });
  }
  const setParam = searchParams.get('set');
  const setNumber = setParam && Number.isFinite(Number(setParam)) ? Number(setParam) : 17;
  const minGames = Math.max(1, Math.min(20, parseInt(searchParams.get('minGames') || '2', 10)));
  const topN = Math.max(1, Math.min(20, parseInt(searchParams.get('topN') || '8', 10)));

  // Pull Pro-Player-Liste aus Supabase (active = streamer + tpc).
  const { data: pros, error } = await supabase
    .from('tft_pro_players')
    .select('puuid,game_name,tag_line,region,classification')
    .in('classification', PRO_CLASSIFICATIONS)
    .not('puuid', 'is', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const proRows = (pros || []) as ProRow[];
  const puuids = proRows.map(r => r.puuid).filter((p): p is string => !!p);
  if (puuids.length === 0) {
    return cachedJson({ pros: [], totalGames: 0 });
  }

  let result;
  try {
    result = await fetchHetznerProsByComp({
      puuids,
      familyKey: family ?? undefined,
      clusterKey: cluster ?? undefined,
      setNumber,
      minGames,
      topN,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'hetzner_unreachable';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Join Aggregat mit Pro-Names.
  const proByPuuid = new Map(proRows.map(r => [r.puuid, r]));
  const enriched = result.pros.map(p => {
    const meta = proByPuuid.get(p.puuid);
    return {
      puuid: p.puuid,
      gameName: meta?.game_name ?? null,
      tagLine: meta?.tag_line ?? null,
      region: meta?.region ?? null,
      classification: meta?.classification ?? null,
      games: p.games,
      avgPlacement: p.avgPlacement,
      top4Rate: p.top4Rate,
      top1Rate: p.top1Rate,
    };
  });

  return cachedJson({ pros: enriched, totalGames: result.totalGames }, { cache: STATS_CACHE_CONTROL });
}
