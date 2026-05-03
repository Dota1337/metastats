import { NextRequest, NextResponse } from 'next/server';
import { loadTftStats, normalizeBucket } from '../../../lib/tft-stats-loader';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const bucket = normalizeBucket(searchParams.get('bucket'));

  const stats = loadTftStats(region);
  if (!stats) return NextResponse.json({ region, bucket, hasData: false, traits: [], note: 'no crawl data yet' });

  // Each trait has multiple activation levels — emit a row per (trait, level)
  // so the frontend can show "Vanguard 4" and "Vanguard 6" as separate ranks.
  const list: any[] = [];
  for (const [name, levels] of Object.entries<any>(stats.byTrait || {})) {
    for (const [level, buckets] of Object.entries<any>(levels)) {
      const b = buckets[bucket] || buckets.all;
      if (!b) continue;
      list.push({
        name,
        activation: Number(level),
        games: b.games,
        avgPlacement: b.games > 0 ? b.sumPlacement / b.games : null,
        top4Rate: b.games > 0 ? b.top4 / b.games : null,
      });
    }
  }
  list.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));
  return NextResponse.json({
    region, bucket,
    set: stats.set, patch: stats.patch,
    hasData: true,
    traits: list,
  });
}
