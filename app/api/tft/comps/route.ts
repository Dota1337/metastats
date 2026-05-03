import { NextRequest, NextResponse } from 'next/server';
import { loadTftStats, loadTftGraph, normalizeBucket } from '../../../lib/tft-stats-loader';

// /api/tft/comps?source=data|editorial|all&region=&bucket=
// Stage 4 wires up the schema + filter so the editorial branch is ready to
// activate later — we currently always return the data branch and an empty
// editorial list. When pro-curated comps go live, the editorial branch reads
// from supabase (table tft_comps_editorial) using the same shape.

const VALID_SOURCES = new Set(['data', 'editorial', 'all']);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const bucket = normalizeBucket(searchParams.get('bucket'));
  const sourceRaw = (searchParams.get('source') || 'data').toLowerCase();
  const source = VALID_SOURCES.has(sourceRaw) ? sourceRaw : 'data';
  const slug = searchParams.get('slug'); // optional: detail view
  const minGames = Math.max(0, parseInt(searchParams.get('minGames') || '30', 10));

  const dataComps: any[] = [];
  let stats: any = null;
  if (source === 'data' || source === 'all') {
    stats = loadTftStats(region);
    if (stats?.byComp) {
      // Total participants in this bucket = total comp-games. We compute it
      // once and reuse for pick rates so each row carries `playRate` directly.
      let bucketParticipants = 0;
      for (const buckets of Object.values<any>(stats.byComp)) {
        const b = buckets[bucket] || buckets.all;
        if (b) bucketParticipants += b.games;
      }

      for (const [clusterKey, buckets] of Object.entries<any>(stats.byComp)) {
        const b = buckets[bucket] || buckets.all;
        if (!b) continue;
        // Apply sample threshold so the long-tail of cluster keys (5–10 games)
        // doesn't pollute the tier list with statistically meaningless entries.
        if (b.games < minGames) continue;
        dataComps.push({
          source: 'data',
          slug: clusterKey,
          clusterKey,
          games: b.games,
          avgPlacement: b.games > 0 ? b.sumPlacement / b.games : null,
          top4Rate: b.games > 0 ? b.top4 / b.games : null,
          top1Rate: b.games > 0 ? b.top1 / b.games : null,
          // pickRate = % of all comp-games in this bucket that picked this cluster
          pickRate: bucketParticipants > 0 ? b.games / bucketParticipants : null,
          typicalUnits: b.typicalUnits || [],
          typicalAugments: b.typicalAugments || [],
          carryItems: b.carryItems || [],
        });
      }
      dataComps.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));
    }
  }

  // Editorial branch is intentionally empty for now (no supabase rows yet).
  // The shape is locked so the frontend toggle works the moment we flip on.
  const editorialComps: any[] = [];

  // Detail view: enrich with KG counters
  if (slug) {
    const all = [...dataComps, ...editorialComps];
    const comp = all.find(c => c.slug === slug);
    if (!comp) return NextResponse.json({ region, bucket, hasData: false, comp: null });

    const graph = loadTftGraph(region);
    const counters = graph?.edges?.compCounter || [];
    // "What this comp beats" — outgoing edges where a = this comp
    const beats = counters.filter((e: any) => e.a === slug)
      .sort((a: any, b: any) => b.aWinRate - a.aWinRate)
      .slice(0, 5);
    // "What beats this comp" — outgoing edges where b = this comp
    const losesTo = counters.filter((e: any) => e.b === slug)
      .sort((a: any, b: any) => b.aWinRate - a.aWinRate)
      .slice(0, 5);

    return NextResponse.json({
      region, bucket,
      hasData: true,
      comp: { ...comp, counters: { beats, losesTo } },
    });
  }

  return NextResponse.json({
    region, bucket, source,
    hasData: dataComps.length > 0 || editorialComps.length > 0,
    set: stats?.set,
    setName: stats?.setName,
    patch: stats?.patch,
    matchesAnalyzed: stats?.matchesAnalyzed ?? null,
    minGames,
    comps: source === 'editorial' ? editorialComps
         : source === 'all' ? [...editorialComps, ...dataComps]
         : dataComps,
  });
}
