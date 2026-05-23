import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

// /api/tft/econ-score?puuid=X
// Sprint 5.4 — Econ-Discipline-Score. Compares the player's average
// gold_left at death against a peer baseline.

const STANDARD_RANKED_QUEUE = 1100;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid');
  if (!puuid) return NextResponse.json({ error: 'puuid required' }, { status: 400 });
  const setParam = searchParams.get('set');
  const setNumber = setParam ? Number(setParam) : null;

  let q = supabase
    .from('tft_player_match_cache')
    .select('gold_left, placement, level')
    .eq('puuid', puuid)
    .eq('queue_id', STANDARD_RANKED_QUEUE)
    .order('game_datetime', { ascending: false })
    .limit(100);
  if (setNumber != null) q = q.eq('set_number', setNumber);
  const { data: matches, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (matches || []) as { gold_left: number; placement: number; level: number }[];
  if (rows.length < 5) {
    return NextResponse.json({ puuid, hasData: false, reason: 'insufficient_samples', games: rows.length });
  }

  const sum = rows.reduce((s, r) => s + (r.gold_left || 0), 0);
  const avgGoldLeft = sum / rows.length;
  const bot4Rows = rows.filter(r => r.placement >= 5);
  const top4Rows = rows.filter(r => r.placement <= 4);
  const avgGoldLeftBot4 = bot4Rows.length > 0
    ? bot4Rows.reduce((s, r) => s + (r.gold_left || 0), 0) / bot4Rows.length
    : null;
  const avgGoldLeftTop4 = top4Rows.length > 0
    ? top4Rows.reduce((s, r) => s + (r.gold_left || 0), 0) / top4Rows.length
    : null;

  const { data: peerRows } = await supabase
    .from('tft_player_match_cache')
    .select('gold_left')
    .eq('queue_id', STANDARD_RANKED_QUEUE)
    .gte('placement', 5)
    .limit(2000);
  let peerAvgGoldLeft: number | null = null;
  if (peerRows && peerRows.length > 0) {
    const peerSum = peerRows.reduce((s, r: any) => s + (Number(r.gold_left) || 0), 0);
    peerAvgGoldLeft = peerSum / peerRows.length;
  }

  const score = peerAvgGoldLeft && peerAvgGoldLeft > 0
    ? Math.round(100 * (peerAvgGoldLeft / Math.max(1, avgGoldLeft)))
    : null;

  return NextResponse.json({
    puuid, hasData: true, games: rows.length,
    avgGoldLeft, avgGoldLeftBot4, avgGoldLeftTop4, peerAvgGoldLeft, score,
  });
}
