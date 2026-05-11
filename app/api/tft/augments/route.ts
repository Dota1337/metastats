import { NextRequest, NextResponse } from 'next/server';
import { loadTftStats, normalizeBucket, bucketParticipants } from '../../../lib/tft-stats-loader';

// Augments are stratified by stage slot (0=2-1, 1=3-2, 2=4-2). Frontend can
// request a specific slot or all of them merged.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const bucket = normalizeBucket(searchParams.get('bucket'));
  const slot = searchParams.get('slot'); // '0' | '1' | '2' | null=all

  const stats = loadTftStats(region);
  if (!stats) return NextResponse.json({ region, bucket, hasData: false, augments: [], note: 'no crawl data yet' });

  // Pick rate for augments. Per slot: denominator is "participants in bucket"
  // (one augment per player per slot). When slot=null (all merged) we use
  // 3*participants since each player picks 3 augments total.
  const participants = bucketParticipants(stats, bucket);
  const denom = slot != null ? participants : participants * 3;

  const list: any[] = [];
  for (const [apiName, slotMap] of Object.entries<any>(stats.byAugment || {})) {
    if (slot != null) {
      const buckets = slotMap[slot];
      if (!buckets) continue;
      const b = buckets[bucket] || buckets.all;
      if (!b) continue;
      list.push({
        apiName, slot: Number(slot),
        games: b.games,
        avgPlacement: b.games > 0 ? b.sumPlacement / b.games : null,
        top4Rate: b.games > 0 ? b.top4 / b.games : null,
        pickRate: denom > 0 ? b.games / denom : null,
      });
    } else {
      // Merge across all slots for this augment
      let games = 0, sumP = 0, top4 = 0;
      for (const buckets of Object.values<any>(slotMap)) {
        const b = buckets[bucket] || buckets.all;
        if (!b) continue;
        games += b.games;
        sumP += b.sumPlacement;
        top4 += b.top4;
      }
      if (games === 0) continue;
      list.push({
        apiName, slot: null,
        games,
        avgPlacement: sumP / games,
        top4Rate: top4 / games,
        pickRate: denom > 0 ? games / denom : null,
      });
    }
  }
  list.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));
  return NextResponse.json({
    region, bucket,
    set: stats.set, patch: stats.patch,
    hasData: true,
    augments: list,
  });
}
