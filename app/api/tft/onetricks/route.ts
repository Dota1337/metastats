import { NextRequest, NextResponse } from 'next/server';
// Service-role client: the marketvalue RPC + 80-player match-cache read are
// too heavy for the public anon role's short statement_timeout (they 500'd
// with 57014). This runs server-side only, so bypassing RLS is fine.
import { supabaseAdmin as supabase } from '../../../lib/supabase';

// /api/tft/onetricks?region=euw1&minShare=0.6
//
// High-Elo players whose top-2 comps make up ≥ minShare of their last N
// classifiable games. Reads marketvalue top-N + their match cache.

interface CachedMatch {
  units: { character_id?: string; tier?: number; rarity?: number; itemNames?: string[] }[];
  traits: { name?: string; tier_current?: number; style?: number }[];
  placement: number;
}

function classifyComp(m: CachedMatch): string | null {
  const traits = (m.traits || []).filter(t => (t.style ?? 0) > 0);
  if (traits.length === 0) return null;
  traits.sort((a, b) => {
    if ((b.style ?? 0) !== (a.style ?? 0)) return (b.style ?? 0) - (a.style ?? 0);
    if ((b.tier_current ?? 0) !== (a.tier_current ?? 0)) return (b.tier_current ?? 0) - (a.tier_current ?? 0);
    return (a.name || '').localeCompare(b.name || '');
  });
  const primary = traits[0];
  const units = m.units || [];
  if (units.length === 0) return null;
  const ranked = [...units].sort((a, b) => {
    const ai = (a.itemNames || []).length;
    const bi = (b.itemNames || []).length;
    if (bi !== ai) return bi - ai;
    if ((b.tier ?? 1) !== (a.tier ?? 1)) return (b.tier ?? 1) - (a.tier ?? 1);
    return (b.rarity ?? 0) - (a.rarity ?? 0);
  });
  const carry = ranked[0];
  if (!carry?.character_id) return null;
  return `${primary.name}@${primary.tier_current ?? 0}_${carry.character_id}`;
}

const TOP_PLAYERS = 80;
const MIN_GAMES = 8;
const STANDARD_RANKED_QUEUE = 1100;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const minShare = Math.max(0.4, Math.min(1, parseFloat(searchParams.get('minShare') || '0.6')));
  const setParam = searchParams.get('set');
  const setNumber = setParam ? Number(setParam) : null;

  const { data: mvData, error: mvErr } = await supabase.rpc('get_tft_latest_marketvalues', {
    p_region: region,
    p_limit: TOP_PLAYERS,
  });
  if (mvErr) return NextResponse.json({ error: mvErr.message }, { status: 500 });
  const candidates = (mvData || []) as Array<{ puuid: string; game_name: string | null; tag_line: string | null; tier: string; final_value: number }>;
  if (candidates.length === 0) {
    return NextResponse.json({ region, count: 0, onetricks: [] });
  }

  const puuids = candidates.map(c => c.puuid);
  let q = supabase
    .from('tft_player_match_cache')
    .select('puuid, units, traits, placement, set_number, queue_id, game_datetime')
    .in('puuid', puuids)
    .eq('queue_id', STANDARD_RANKED_QUEUE)
    .order('game_datetime', { ascending: false })
    .limit(puuids.length * 50);
  if (setNumber != null) q = q.eq('set_number', setNumber);
  const { data: matches, error: mErr } = await q;
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const perPuuid = new Map<string, Map<string, { games: number; sumPlacement: number }>>();
  for (const row of (matches || []) as Array<CachedMatch & { puuid: string }>) {
    const cluster = classifyComp(row);
    if (!cluster) continue;
    let m = perPuuid.get(row.puuid);
    if (!m) { m = new Map(); perPuuid.set(row.puuid, m); }
    const e = m.get(cluster) || { games: 0, sumPlacement: 0 };
    e.games++;
    e.sumPlacement += (row.placement || 9);
    m.set(cluster, e);
  }

  const onetricks: any[] = [];
  for (const cand of candidates) {
    const m = perPuuid.get(cand.puuid);
    if (!m) continue;
    let total = 0;
    for (const e of m.values()) total += e.games;
    if (total < MIN_GAMES) continue;
    const sorted = [...m.entries()].sort((a, b) => b[1].games - a[1].games);
    const top1 = sorted[0];
    const top2 = sorted[1];
    const top1Share = top1 ? top1[1].games / total : 0;
    const top2Share = top1Share + (top2 ? top2[1].games / total : 0);
    if (top2Share < minShare) continue;
    onetricks.push({
      puuid: cand.puuid,
      gameName: cand.game_name,
      tagLine: cand.tag_line,
      tier: cand.tier,
      finalValue: cand.final_value,
      totalGames: total,
      top1Share,
      top2Share,
      signatureComps: [top1, top2].filter(Boolean).map(([cluster, e]) => ({
        clusterKey: cluster,
        games: e.games,
        share: e.games / total,
        avgPlacement: e.games > 0 ? e.sumPlacement / e.games : null,
      })),
    });
  }
  onetricks.sort((a, b) => b.top2Share - a.top2Share);

  return NextResponse.json({ region, count: onetricks.length, onetricks });
}
