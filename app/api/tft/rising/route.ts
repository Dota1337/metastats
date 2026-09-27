import { NextRequest, NextResponse } from 'next/server';
import { fetchHetznerRising } from '../../../lib/tft-hetzner-matches';
import type { RisingPlayer } from '../../../lib/tft-hetzner-matches';
import { cachedJson, SLOW_CACHE_CONTROL } from '../../../lib/api-cache';
import { ACTIVE_REGIONS } from '../../../lib/active-regions';
import { supabaseAdmin } from '../../../lib/supabase';

// /api/tft/rising?days=1|3|5&region=all|euw1|…
//
// Aufsteiger nach MetaTFT-Logik. Rechnet komplett auf der Hetzner-Box
// (/rising, scripts/lib/tft-rising.mjs); hier kommen nur die Namen dazu —
// das Namensverzeichnis liegt allein auf Supabase.
//
// Die Rangliste wird einmal am Tag gesammelt, eine Stunde Edge-Frische reicht.
export const maxDuration = 60;

const DAYS = new Set([1, 3, 5]);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = Number(searchParams.get('days') || '1');
  const region = (searchParams.get('region') || 'all').toLowerCase();
  if (!DAYS.has(days)) return NextResponse.json({ error: 'invalid_days' }, { status: 400 });
  if (region !== 'all' && !ACTIVE_REGIONS.includes(region)) {
    return NextResponse.json({ error: 'invalid_region' }, { status: 400 });
  }

  let data;
  try {
    data = await fetchHetznerRising({ days, region });
  } catch {
    return cachedJson({ hasData: false, days, region, endDay: null, players: [] }, { degraded: true });
  }
  if (!data.hasData) return cachedJson(data, { degraded: true });

  const names = new Map<string, { gameName: string; tagLine: string }>();
  try {
    const { data: rows } = await supabaseAdmin
      .from('tft_player_names')
      .select('puuid, game_name, tag_line')
      .in('puuid', data.players.map(p => p.puuid));
    for (const r of rows ?? []) {
      if (r.game_name && r.tag_line) names.set(r.puuid, { gameName: r.game_name, tagLine: r.tag_line });
    }
  } catch {
    // Ohne Namen bleibt die Liste brauchbar; die Karte zeigt dann "—".
  }
  const players: RisingPlayer[] = data.players.map(p => ({
    ...p,
    gameName: names.get(p.puuid)?.gameName ?? null,
    tagLine: names.get(p.puuid)?.tagLine ?? null,
  }));
  return cachedJson({ ...data, players }, { cache: SLOW_CACHE_CONTROL });
}
