import { NextRequest, NextResponse } from 'next/server';
import { loadTftStats, normalizeBucket, bucketParticipants } from '../../../lib/tft-stats-loader';

// Returns per-unit aggregated stats for a region+tier-bucket. The unit detail
// page calls this with ?id=TFT17_Vex&bucket=master_plus to render the
// item-builds section; the units list page calls without `id` to get a tier
// list across all units.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const bucket = normalizeBucket(searchParams.get('bucket'));
  const id = searchParams.get('id');

  const stats = loadTftStats(region);
  if (!stats) {
    return NextResponse.json({ region, bucket, hasData: false, units: [], note: 'no crawl data yet' });
  }

  if (id) {
    const buckets = stats.byUnit?.[id];
    if (!buckets) return NextResponse.json({ region, bucket, hasData: true, unit: null });
    const data = buckets[bucket] || buckets.all || null;
    if (!data) return NextResponse.json({ region, bucket, hasData: true, unit: null });
    const avgPlacement = data.games > 0 ? data.sumPlacement / data.games : null;
    return NextResponse.json({
      region, bucket,
      set: stats.set, patch: stats.patch,
      hasData: true,
      unit: {
        characterId: id,
        games: data.games,
        avgPlacement,
        top4Rate: data.games > 0 ? data.top4 / data.games : null,
        top1Rate: data.games > 0 ? data.top1 / data.games : null,
        topItems: (data.topItems || []).map((it: any) => ({
          item: it.item,
          games: it.games,
          avgPlacement: it.games > 0 ? it.sumPlacement / it.games : null,
          top4Rate: it.games > 0 ? it.top4 / it.games : null,
        })),
        topItemSets: (data.topItemSets || []).map((s: any) => ({
          items: s.items,
          games: s.games,
          avgPlacement: s.games > 0 ? s.sumPlacement / s.games : null,
          top4Rate: s.games > 0 ? s.top4 / s.games : null,
        })),
      },
    });
  }

  // Unit list — emit one entry per unit that has data in the requested bucket
  const participants = bucketParticipants(stats, bucket);
  const units: any[] = [];
  for (const [characterId, buckets] of Object.entries<any>(stats.byUnit || {})) {
    const b = buckets[bucket] || buckets.all;
    if (!b) continue;
    units.push({
      characterId,
      games: b.games,
      avgPlacement: b.games > 0 ? b.sumPlacement / b.games : null,
      top4Rate: b.games > 0 ? b.top4 / b.games : null,
      top1Rate: b.games > 0 ? b.top1 / b.games : null,
      pickRate: participants > 0 ? b.games / participants : null,
      // Top 3 items the unit gets carried with — inline preview for the list.
      topItems: (b.topItems || []).slice(0, 3).map((it: any) => it.item),
    });
  }
  units.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));
  return NextResponse.json({
    region, bucket,
    set: stats.set, patch: stats.patch,
    hasData: true,
    units,
  });
}
