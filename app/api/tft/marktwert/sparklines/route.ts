import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabase';
import { cachedJson } from '../../../../lib/api-cache';

// /api/tft/marktwert/sparklines?region=euw1&limit=100&days=14
//
// Per-player final_value series for the leaderboard's top-N players (by latest
// value) in a region. The Top tab fetches this once per region and renders a
// small sparkline per row. Backed by get_tft_marketvalue_sparklines (0026) —
// snapshot data already exists, so it shows immediately.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const limit = Math.max(1, Math.min(200, parseInt(searchParams.get('limit') || '100', 10)));
  const days = Math.max(2, Math.min(60, parseInt(searchParams.get('days') || '14', 10)));

  const { data, error } = await supabaseAdmin.rpc('get_tft_marketvalue_sparklines', {
    p_region: region,
    p_limit: limit,
    p_days: days,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Flat rows (ordered puuid, date) → per-puuid series, oldest→newest.
  const series: Record<string, { date: string; value: number }[]> = {};
  for (const row of (data || []) as { puuid: string; snapshot_date: string; final_value: number }[]) {
    (series[row.puuid] ??= []).push({ date: row.snapshot_date, value: row.final_value });
  }

  return cachedJson({ region, count: Object.keys(series).length, series });
}
