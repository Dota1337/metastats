import { NextRequest, NextResponse } from 'next/server';
import { callRpc, getAvailablePatches, REGION_GROUPS, BUCKET_GROUPS } from '../../../lib/tft-supabase-reader';

// /api/tft/unit-history?characterId=X&patches=5&bucket=master_plus
// Per-unit avg_placement / pick_rate / top4 across last N patches.

interface UnitRow {
  character_id: string;
  games: number;
  sum_placement: number;
  top4: number;
  top1: number;
  participants: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const characterId = searchParams.get('characterId');
  if (!characterId) return NextResponse.json({ error: 'characterId required' }, { status: 400 });
  const patchCount = Math.max(2, Math.min(10, parseInt(searchParams.get('patches') || '5', 10)));
  const bucket = searchParams.get('bucket') || 'master_plus';
  const regionParam = searchParams.get('region') || 'all';
  const regions = REGION_GROUPS[regionParam] || REGION_GROUPS.all;
  // Expand group names ('master_plus','all') to the real bucket values — the
  // RPC matches bucket = ANY(...) and no row is literally tagged 'master_plus',
  // so passing the group name returned 0 rows → empty timeline → missing chart.
  const buckets = BUCKET_GROUPS[bucket] || [bucket];

  const allPatches = await getAvailablePatches(180);
  const patches = allPatches.slice(0, patchCount);
  if (patches.length === 0) return NextResponse.json({ characterId, timeline: [] });

  const timeline: any[] = [];
  for (const p of patches) {
    try {
      const rows = await callRpc<UnitRow[]>('get_tft_unit_stats', {
        p_regions: regions,
        p_buckets: buckets,
        p_days: 30,
        p_patch: p.patch,
        p_set: p.set_number,
      });
      const row = rows.find(r => r.character_id === characterId);
      const participants = rows[0]?.participants || 0;
      if (row && row.games > 0) {
        timeline.push({
          patch: p.patch,
          firstDay: p.first_day,
          games: Number(row.games),
          avgPlacement: Number(row.sum_placement) / Number(row.games),
          top4Rate: Number(row.top4) / Number(row.games),
          top1Rate: Number(row.top1) / Number(row.games),
          pickRate: participants > 0 ? Number(row.games) / Number(participants) : null,
        });
      }
    } catch {
    }
  }
  // Oldest patch left, newest right. Sort explicitly by first_day instead of
  // relying on the RPC's order — Riot's raw game_version strings don't sort
  // chronologically (e.g. "17.2" predates "16.10"), so a number-based order
  // would put patches in the wrong place on the x-axis.
  timeline.sort((a, b) => (a.firstDay < b.firstDay ? -1 : a.firstDay > b.firstDay ? 1 : 0));
  return NextResponse.json({ characterId, timeline });
}
