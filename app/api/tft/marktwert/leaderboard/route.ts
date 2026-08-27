import { CURRENT_SET } from '../../../../lib/current-set';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { cachedJson } from '../../../../lib/api-cache';

// /api/tft/marktwert/leaderboard?region=euw1&limit=100&tier=CHALLENGER
//
// Returns the latest snapshot per player in a region, ordered by final_value
// desc. Calls the get_tft_latest_marketvalues RPC (sub-100ms typical).
//
// Optional tier filter does a single-table-scan post-filter on the RPC
// output. Cheap because the result set is at most 100 rows.
//
// Der Filter greift fuer JEDES uebergebene Tier, nicht nur fuer eine
// Whitelist. Vorher stand hier ein VALID_TIERS-Set aus Master/GM/Challenger;
// ein Aufruf mit z.B. tier=BRONZE fiel dadurch ungefiltert durch und lieferte
// die Master-Top-500 zurueck — die Rangliste haette unter Diamant fremde
// Marktwerte angezeigt. Snapshots existieren ohnehin nur ab Diamant
// aufwaerts (gemessen 2026-08-27), darunter ist die leere Liste die richtige
// Antwort.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const limit = Math.max(1, Math.min(500, parseInt(searchParams.get('limit') || '100', 10)));
  const tier = (searchParams.get('tier') || '').toUpperCase();

  // Over-fetch when filtering by tier so we still return ~`limit` rows after
  // the post-filter trims the non-matching tiers.
  const fetchLimit = tier ? limit * 4 : limit;

  const { data, error } = await supabaseAdmin.rpc('get_tft_latest_marketvalues', {
    p_region: region,
    p_limit: fetchLimit,
    // Nur das laufende Set: die Snapshots reichen ueber Set-Grenzen hinweg,
    // die neueste Zeile eines Spielers kann sonst aus dem alten Set stammen.
    p_set: CURRENT_SET,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let players = (data || []).map((row: any) => ({
    puuid: row.puuid,
    gameName: row.game_name,
    tagLine: row.tag_line,
    tier: row.tier,
    rank: row.rank,
    lp: row.lp,
    ladderRank: row.ladder_rank,
    baseValue: row.base_value,
    multiplier: Number(row.multiplier),
    finalValue: row.final_value,
    sampleSize: row.sample_size,
    snapshotDate: row.snapshot_date,
  }));

  if (tier) {
    players = players.filter((p: any) => p.tier === tier);
  }
  players = players.slice(0, limit);

  return cachedJson({ region, limit, count: players.length, players });
}
