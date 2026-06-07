import { NextRequest, NextResponse } from 'next/server';
import { getAvailablePatches } from '../../../lib/tft-supabase-reader';
import { fetchHetznerPlayerMatches, fetchHetznerPeerBaseline } from '../../../lib/tft-hetzner-matches';

// /api/tft/econ-score?puuid=X
// Sprint 5.4 — Econ-Discipline-Score. Compares the player's average
// gold_left at death against a peer baseline.

const STANDARD_RANKED_QUEUE = 1100;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid');
  if (!puuid) return NextResponse.json({ error: 'puuid required' }, { status: 400 });
  const setParam = searchParams.get('set');
  // Default to the current set so BOTH the player and peer queries stay
  // set-scoped — the peer query without set_number scans the whole cache and
  // 57014-times out. NaN-guard a malformed ?set.
  let setNumber = setParam && Number.isFinite(Number(setParam)) ? Number(setParam) : null;
  if (setNumber == null) {
    const patches = await getAvailablePatches();
    setNumber = patches[0]?.set_number ?? null;
  }

  // Match cache lives on Hetzner — route through refresh-api.
  let rows: { goldLeft: number; placement: number; level: number }[] = [];
  try {
    const matches = await fetchHetznerPlayerMatches({
      puuids: [puuid],
      setNumber: setNumber ?? undefined,
      queueId: STANDARD_RANKED_QUEUE,
      limitPerPuuid: 100,
    });
    rows = matches.map(m => ({ goldLeft: m.goldLeft ?? 0, placement: m.placement, level: m.level }));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'hetzner_unreachable';
    return NextResponse.json({ error: message }, { status: 502 });
  }
  if (rows.length < 5) {
    return NextResponse.json({ puuid, hasData: false, reason: 'insufficient_samples', games: rows.length });
  }

  const sum = rows.reduce((s, r) => s + (r.goldLeft || 0), 0);
  const avgGoldLeft = sum / rows.length;
  const bot4Rows = rows.filter(r => r.placement >= 5);
  const top4Rows = rows.filter(r => r.placement <= 4);
  const avgGoldLeftBot4 = bot4Rows.length > 0
    ? bot4Rows.reduce((s, r) => s + (r.goldLeft || 0), 0) / bot4Rows.length
    : null;
  const avgGoldLeftTop4 = top4Rows.length > 0
    ? top4Rows.reduce((s, r) => s + (r.goldLeft || 0), 0) / top4Rows.length
    : null;

  // Peer baseline: global Set-N mean gold_left for placement>=5 players,
  // computed on Hetzner (Supabase doesn't have the per-match jsonb cache).
  let peerAvgGoldLeft: number | null = null;
  try {
    const peer = await fetchHetznerPeerBaseline({
      setNumber: setNumber ?? undefined,
      minPlacement: 5,
      limit: 2000,
    });
    peerAvgGoldLeft = peer.avgGoldLeft;
  } catch {
    // Non-fatal: score will be null, the player-side stats still render.
  }

  const score = peerAvgGoldLeft && peerAvgGoldLeft > 0
    ? Math.round(100 * (peerAvgGoldLeft / Math.max(1, avgGoldLeft)))
    : null;

  return NextResponse.json({
    puuid, hasData: true, games: rows.length,
    avgGoldLeft, avgGoldLeftBot4, avgGoldLeftTop4, peerAvgGoldLeft, score,
  });
}
