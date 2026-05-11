import { NextRequest, NextResponse } from 'next/server';
import { calculateTftMarketValue } from '../../../lib/tft-marketvalue';
import { loadTftGraph } from '../../../lib/tft-stats-loader';
import { getRegionalRouting } from '../../../lib/regions';
import { processTftMatch } from '../../../lib/tft-match-processor';

// On-demand TFT market value computation for a single player.
// /api/tft/marktwert?name=Caps#EUW&region=euw1
//
// Master+ only — Iron–Diamond responds with rated:false and a reason.
// The leaderboard view (/tft/marktwert page) calls this for every player
// on the Master+ ladder when rendering the regional top list.

const TFT_RANKED_SOLO = 'RANKED_TFT';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name') || '';
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const apiKey = process.env.RIOT_API_KEY_TFT;
  if (!apiKey) {
    return NextResponse.json({ error: 'Riot API Key fehlt' }, { status: 503 });
  }
  const regional = getRegionalRouting(region);

  const decoded = decodeURIComponent(name);
  const [gameName, tagLineRaw] = decoded.split('#');
  if (!gameName) return NextResponse.json({ error: 'Kein Name angegeben' }, { status: 400 });
  const tagLine = (tagLineRaw || 'EUW').trim();

  // Resolve account
  const accRes = await fetch(`https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}?api_key=${apiKey}`);
  if (!accRes.ok) return NextResponse.json({ error: 'Spieler nicht gefunden' }, { status: 404 });
  const account = await accRes.json();
  const puuid = account.puuid;

  // Pull ranked entries + recent matches in parallel
  const [rankedRes, idsRes] = await Promise.all([
    fetch(`https://${region}.api.riotgames.com/tft/league/v1/by-puuid/${puuid}?api_key=${apiKey}`),
    fetch(`https://${regional}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuid}/ids?count=30&api_key=${apiKey}`),
  ]);
  const rankedAll = rankedRes.ok ? await rankedRes.json() : [];
  const matchIds: string[] = idsRes.ok ? await idsRes.json() : [];
  const ranked = Array.isArray(rankedAll) ? rankedAll.find((r: any) => r.queueType === TFT_RANKED_SOLO) || null : null;

  // Pull match details (limit to current set later via processor)
  const detailedRaw = await Promise.all(matchIds.slice(0, 30).map(async id => {
    const r = await fetch(`https://${regional}.api.riotgames.com/tft/match/v1/matches/${id}?api_key=${apiKey}`);
    return r.ok ? r.json() : null;
  }));
  const matches = detailedRaw
    .map(raw => raw && processTftMatch(raw))
    .filter((m): m is NonNullable<typeof m> => m != null && m.queueId === 1100);

  const selfMatches = matches.map(m => {
    const me = m.participants.find((p: any) => p.puuid === puuid);
    if (!me) return null;
    return {
      matchId: m.matchId,
      placement: me.placement,
      setNumber: m.setNumber,
      augments: me.augments,
      comp: classify(me),
      units: me.units.map((u: any) => ({ characterId: u.characterId, tier: u.tier, items: u.items })),
    };
  }).filter((m): m is NonNullable<typeof m> => m != null);

  const graph = loadTftGraph(region);

  const result = calculateTftMarketValue({
    ranked: ranked ? {
      tier: ranked.tier, rank: ranked.rank, leaguePoints: ranked.leaguePoints,
      wins: ranked.wins, losses: ranked.losses,
    } : null,
    matches: selfMatches,
    patchKnowledgeGraph: graph,
  });

  return NextResponse.json({
    summoner: { name: `${account.gameName}#${account.tagLine}`, puuid, tier: ranked?.tier, rank: ranked?.rank, lp: ranked?.leaguePoints ?? null },
    marketValue: result,
    region,
  });
}

// Same shape as scripts/lib/tft-build-aggregator.mjs#classifyComp but
// runs on the processed-match output rather than the raw DTO.
function classify(p: any) {
  const traits = (p.traits || []).filter((t: any) => (t.style ?? 0) > 0);
  if (traits.length === 0) return undefined;
  traits.sort((a: any, b: any) => {
    if ((b.style ?? 0) !== (a.style ?? 0)) return (b.style ?? 0) - (a.style ?? 0);
    if ((b.tierCurrent ?? 0) !== (a.tierCurrent ?? 0)) return (b.tierCurrent ?? 0) - (a.tierCurrent ?? 0);
    return (a.name || '').localeCompare(b.name || '');
  });
  const primary = traits[0];
  const ranked = [...(p.units || [])].sort((a: any, b: any) => {
    const aItems = (a.items || []).length, bItems = (b.items || []).length;
    if (bItems !== aItems) return bItems - aItems;
    if ((b.tier ?? 1) !== (a.tier ?? 1)) return (b.tier ?? 1) - (a.tier ?? 1);
    return (b.rarity ?? 0) - (a.rarity ?? 0);
  });
  const carry = ranked[0];
  if (!carry?.characterId) return undefined;
  return {
    clusterKey: `${primary.name}@${primary.tierCurrent ?? 0}_${carry.characterId}`,
    primaryTrait: primary.name,
    primaryTraitLevel: primary.tierCurrent ?? 0,
    carryUnit: carry.characterId,
    carryItems: (carry.items || []).filter(Boolean).sort(),
  };
}
