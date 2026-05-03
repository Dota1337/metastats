import { NextRequest, NextResponse } from 'next/server';
import { loadTftStats, normalizeBucket } from '../../../lib/tft-stats-loader';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const bucket = normalizeBucket(searchParams.get('bucket'));
  const id = searchParams.get('id');

  const stats = loadTftStats(region);
  if (!stats) return NextResponse.json({ region, bucket, hasData: false, items: [], note: 'no crawl data yet' });

  if (id) {
    const buckets = stats.byItem?.[id];
    if (!buckets) return NextResponse.json({ region, bucket, hasData: true, item: null });
    const data = buckets[bucket] || buckets.all || null;
    if (!data) return NextResponse.json({ region, bucket, hasData: true, item: null });
    const avgPlacement = data.games > 0 ? data.sumPlacement / data.games : null;
    return NextResponse.json({
      region, bucket,
      set: stats.set, patch: stats.patch,
      hasData: true,
      item: {
        apiName: id,
        games: data.games,
        avgPlacement,
        top4Rate: data.games > 0 ? data.top4 / data.games : null,
        topUsers: (data.topUsers || []).map((u: any) => ({
          characterId: u.characterId,
          games: u.games,
          avgPlacement: u.games > 0 ? u.sumPlacement / u.games : null,
        })),
      },
    });
  }

  const items: any[] = [];
  for (const [apiName, buckets] of Object.entries<any>(stats.byItem || {})) {
    const b = buckets[bucket] || buckets.all;
    if (!b) continue;
    items.push({
      apiName,
      games: b.games,
      avgPlacement: b.games > 0 ? b.sumPlacement / b.games : null,
      top4Rate: b.games > 0 ? b.top4 / b.games : null,
    });
  }
  items.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));
  return NextResponse.json({
    region, bucket,
    set: stats.set, patch: stats.patch,
    hasData: true,
    items,
  });
}
