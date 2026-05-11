import { NextRequest, NextResponse } from 'next/server';
import { getRegionalRouting } from '../../../lib/regions';
import { processTftMatch } from '../../../lib/tft-match-processor';

// Resolves a list of TFT match IDs (or a puuid + range) into processed
// summaries. Defaults to the standard ranked queue (1100); other queues are
// out of scope for the first iteration but kept as an explicit override so
// later stages can opt in without changing the contract.

const STANDARD_RANKED_QUEUE = 1100;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const apiKey = process.env.RIOT_API_KEY_TFT;
  if (!apiKey) {
    return NextResponse.json({ error: 'Riot API Key fehlt', code: 'no_key' }, { status: 503 });
  }
  const regional = getRegionalRouting(region);

  // Two ways to call: explicit `ids=A,B,C` OR `puuid=X&start=0&count=10`.
  const idsParam = searchParams.get('ids');
  const puuid = searchParams.get('puuid');
  const start = parseInt(searchParams.get('start') || '0', 10);
  const count = Math.min(parseInt(searchParams.get('count') || '10', 10), 30);
  const queueOverride = searchParams.get('queue');

  let ids: string[] = [];
  if (idsParam) {
    ids = idsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 30);
  } else if (puuid) {
    const url = `https://${regional}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}&api_key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ matches: [], error: `match list HTTP ${res.status}` }, { status: 502 });
    ids = await res.json();
  } else {
    return NextResponse.json({ error: 'Either `ids` or `puuid` is required' }, { status: 400 });
  }

  if (ids.length === 0) {
    return NextResponse.json({ matches: [], region });
  }

  // Pull match details in parallel batches of 10 (well within dev key budget)
  const batchSize = 10;
  const summaries: any[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async id => {
      const res = await fetch(`https://${regional}.api.riotgames.com/tft/match/v1/matches/${id}?api_key=${apiKey}`);
      return res.ok ? res.json() : null;
    }));
    for (const raw of results) {
      const summary = processTftMatch(raw);
      if (!summary) continue;
      // Filter to standard ranked unless overridden
      const wantQueue = queueOverride ? Number(queueOverride) : STANDARD_RANKED_QUEUE;
      if (queueOverride !== 'all' && summary.queueId !== wantQueue) continue;
      summaries.push(summary);
    }
  }

  // Resolve riot IDs (gameName#tag) for every participant in one parallel batch
  // — without these the match detail UI can only show puuids. We tolerate
  // partial failures (rate limit on individual lookups) by leaving the field
  // null for participants we couldn't resolve.
  const allPuuids = new Set<string>();
  for (const s of summaries) for (const p of s.participants) allPuuids.add(p.puuid);
  const idMap: Record<string, string> = {};
  await Promise.all([...allPuuids].map(async pp => {
    try {
      const res = await fetch(`https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${pp}?api_key=${apiKey}`);
      if (!res.ok) return;
      const a = await res.json();
      idMap[pp] = `${a.gameName}#${a.tagLine}`;
    } catch {}
  }));
  for (const s of summaries) {
    for (const p of s.participants) p.riotIdName = idMap[p.puuid] || null;
  }

  return NextResponse.json({ matches: summaries, region });
}
