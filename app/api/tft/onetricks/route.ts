import { NextRequest, NextResponse } from 'next/server';
import { getAvailablePatches } from '../../../lib/tft-supabase-reader';
import { fetchHetznerPlayerMatches, fetchHetznerMarketvaluePool } from '../../../lib/tft-hetzner-matches';
import { cachedJson, STATS_CACHE_CONTROL } from '../../../lib/api-cache';
import { classifyComp } from '../../../lib/tft-classify-comp';

// /api/tft/onetricks?region=euw1&minShare=0.6
//
// High-Elo players whose top-2 comps make up ≥ minShare of their last N
// classifiable games. Klassifikation via unifizierte Library
// (app/lib/tft-classify-comp.ts == scripts/lib/tft-classify-comp.mjs).

interface CachedMatch {
  units: { character_id?: string; characterId?: string; tier?: number; rarity?: number; items?: string[]; itemNames?: string[] }[];
  traits: { name?: string; tier_current?: number; style?: number; num_units?: number }[];
  augments?: string[];
  level?: number;
  placement: number;
}

// Pool: pull the Master+ pool via the Hetzner refresh-api. The Supabase
// RPC has a hard 1000-row PostgREST cap which only covers Challenger + GM
// in big regions — Master (the largest tier) is silently truncated. We go
// through Hetzner to get the full Master+ list (5k+ in EUW), then cap the
// match call at 1000 puuids to keep latency around 5–10s (1000 × 50 ≈
// 50k matches, ~17 s DB + transfer with full 2000-cap; halving the input
// roughly halves both).
const TOP_PLAYERS = 1000;
const MIN_GAMES_FLEX = 8;       // Pfad A — Top-2 ≥ minShareTop2
const MIN_GAMES_TIGHT = 50;     // Pfad B — Top-1 ≥ minShareTop1 (über die letzten 50)
const MIN_TOP1_SHARE_DEFAULT = 0.5;
const MIN_TOP2_SHARE_DEFAULT = 0.6;
const MASTER_PLUS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);
const STANDARD_RANKED_QUEUE = 1100;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const minShareTop2 = Math.max(0.3, Math.min(1, parseFloat(searchParams.get('minShareTop2') || searchParams.get('minShare') || String(MIN_TOP2_SHARE_DEFAULT))));
  const minShareTop1 = Math.max(0.3, Math.min(1, parseFloat(searchParams.get('minShareTop1') || String(MIN_TOP1_SHARE_DEFAULT))));
  const setParam = searchParams.get('set');
  let setNumber = setParam && Number.isFinite(Number(setParam)) ? Number(setParam) : null;
  if (setNumber == null) {
    // Default to the current set. Without a set_number filter the cache read
    // scans every set's matches for 300 players and order-by-datetime sorts
    // the lot → 10s+ and intermittent statement timeouts. Pinning the set
    // lets the (puuid, set_number, queue_id, game_datetime) index serve rows
    // in order.
    const patches = await getAvailablePatches();
    setNumber = patches[0]?.set_number ?? null;
  }

  // Pool fetch via Hetzner (bypasses PostgREST 1000-row cap so Master tier
  // is actually represented). Already tier-filtered server-side.
  let candidates: Array<{ puuid: string; game_name: string | null; tag_line: string | null; tier: string; final_value: number }> = [];
  try {
    const pool = await fetchHetznerMarketvaluePool({
      region,
      tiers: [...MASTER_PLUS],
      limit: TOP_PLAYERS,
    });
    candidates = pool.map(p => ({
      puuid: p.puuid,
      game_name: p.gameName,
      tag_line: p.tagLine,
      tier: p.tier,
      final_value: p.finalValue,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'hetzner_pool_unreachable';
    return NextResponse.json({ error: message }, { status: 502 });
  }
  if (candidates.length === 0) {
    return cachedJson({ region, count: 0, onetricks: [] });
  }

  const puuids = candidates.map(c => c.puuid);
  // Route through the Hetzner refresh-api — the Set-17 match cache lives
  // on the Hetzner box, Supabase only has Set-15-era leftovers.
  let matches: any[] = [];
  try {
    matches = await fetchHetznerPlayerMatches({
      puuids,
      setNumber: setNumber ?? undefined,
      queueId: STANDARD_RANKED_QUEUE,
      limitPerPuuid: 50,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'hetzner_unreachable';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const perPuuid = new Map<string, Map<string, { games: number; sumPlacement: number }>>();
  for (const row of (matches || []) as Array<CachedMatch & { puuid: string }>) {
    const cls = classifyComp({
      traits: row.traits,
      units: row.units,
      augments: row.augments,
      level: row.level,
    }, { withAugmentSuffix: false });
    if (!cls) continue;
    let m = perPuuid.get(row.puuid);
    if (!m) { m = new Map(); perPuuid.set(row.puuid, m); }
    const e = m.get(cls.clusterKey) || { games: 0, sumPlacement: 0 };
    e.games++;
    e.sumPlacement += (row.placement || 9);
    m.set(cls.clusterKey, e);
  }

  const onetricks: any[] = [];
  for (const cand of candidates) {
    const m = perPuuid.get(cand.puuid);
    if (!m) continue;
    let total = 0;
    for (const e of m.values()) total += e.games;
    if (total < MIN_GAMES_FLEX) continue;
    const sorted = [...m.entries()].sort((a, b) => b[1].games - a[1].games);
    const top1 = sorted[0];
    const top2 = sorted[1];
    const top1Share = top1 ? top1[1].games / total : 0;
    const top2Share = top1Share + (top2 ? top2[1].games / total : 0);

    // Two qualification paths:
    //   pathA (flex) — top-2 comps add up to ≥ minShareTop2 of all classified games
    //   pathB (tight) — top-1 comp ≥ minShareTop1 over the last ≥50 games (limit_per_puuid).
    //                   matches are already capped at the 50 latest by the Hetzner query,
    //                   so total === 50 means the player has played ≥50 Set-17 ranked games
    //                   and we're looking at exactly the last 50.
    const qualifiesFlex = top2Share >= minShareTop2;
    const qualifiesTight = total >= MIN_GAMES_TIGHT && top1Share >= minShareTop1;
    if (!qualifiesFlex && !qualifiesTight) continue;

    onetricks.push({
      puuid: cand.puuid,
      gameName: cand.game_name,
      tagLine: cand.tag_line,
      tier: cand.tier,
      finalValue: cand.final_value,
      totalGames: total,
      top1Share,
      top2Share,
      kind: qualifiesTight ? 'tight' : 'flex',
      signatureComps: [top1, top2].filter(Boolean).map(([cluster, e]) => ({
        clusterKey: cluster,
        games: e.games,
        share: e.games / total,
        avgPlacement: e.games > 0 ? e.sumPlacement / e.games : null,
      })),
    });
  }
  // Sort by top-1 share first (tight onetricks bubble up), then by top-2 share
  // as the flex tiebreaker. Both metrics make the ranking intuitive: the most
  // committed onetrick is on top.
  onetricks.sort((a, b) => (b.top1Share - a.top1Share) || (b.top2Share - a.top2Share));

  // Onetricks-Daten ändern sich nur durch den Daily-Crawl (Marktwert-Pool +
  // Match-Cache). 6h s-maxage + 24h SWR ist konservativ — selbst nach Cold-Miss
  // ist die Response unter ~3s (Hetzner-Pool + 1000 Puuids × Match-Cache).
  return new NextResponse(JSON.stringify({ region, count: onetricks.length, onetricks }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': STATS_CACHE_CONTROL },
  });
}
