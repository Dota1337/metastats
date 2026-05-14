import { NextRequest, NextResponse } from 'next/server';
import { calculateTftMarketValue } from '../../../lib/tft-marketvalue';
import { loadTftGraph } from '../../../lib/tft-stats-loader';
import { getRegionalRouting } from '../../../lib/regions';
import { processTftMatch } from '../../../lib/tft-match-processor';
import { supabase } from '../../../lib/supabase';

// /api/tft/marktwert?name=Caps#EUW&region=euw1
//
// Snapshot-first: tries to read the latest daily snapshot from Supabase
// (written by scripts/collect-tft-marketvalues.mjs). Falls back to a full
// live-calculation only when no snapshot exists yet (new climber, region
// with crawl not yet run, etc.).
//
// Master+ only — Iron–Diamond responds with rated:false.
//
// Optional ?live=1 query param forces a live re-calc even when a snapshot
// exists; used by the player-page hero when the user pulls-to-refresh.

const TFT_RANKED_SOLO = 'RANKED_TFT';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name') || '';
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const forceLive = searchParams.get('live') === '1';

  const decoded = decodeURIComponent(name);
  const [gameName, tagLineRaw] = decoded.split('#');
  if (!gameName) return NextResponse.json({ error: 'Kein Name angegeben' }, { status: 400 });
  const tagLine = (tagLineRaw || 'EUW').trim();

  const apiKey = process.env.RIOT_API_KEY_TFT;
  if (!apiKey) return NextResponse.json({ error: 'Riot API Key fehlt' }, { status: 503 });
  const regional = getRegionalRouting(region);

  // Resolve account first — we need the puuid both for the snapshot lookup
  // and (as a fallback) for the live calc. Account lookup is the only Riot
  // call that's strictly required in the snapshot-hit path.
  const accRes = await fetch(`https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}?api_key=${apiKey}`);
  if (!accRes.ok) return NextResponse.json({ error: 'Spieler nicht gefunden' }, { status: 404 });
  const account = await accRes.json();
  const puuid = account.puuid;

  // 1) Snapshot path — fast, no rate-limit cost.
  if (!forceLive) {
    const { data: snap } = await supabase
      .from('tft_player_marketvalue_snapshots')
      .select('tier, rank, lp, ladder_rank, base_value, multiplier, final_value, sample_size, damping, agents, snapshot_date')
      .eq('puuid', puuid)
      .eq('region', region)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (snap) {
      return NextResponse.json({
        summoner: { name: `${account.gameName}#${account.tagLine}`, puuid, tier: snap.tier, rank: snap.rank, lp: snap.lp },
        marketValue: {
          baseValue: snap.base_value,
          multiplier: Number(snap.multiplier),
          finalValue: snap.final_value,
          rated: true,
          sampleSize: snap.sample_size,
          damping: Number(snap.damping),
          agents: snap.agents || [],
        },
        source: 'snapshot',
        snapshotDate: snap.snapshot_date,
        region,
      });
    }
  }

  // 2) Live fallback — used when no snapshot exists or ?live=1.
  const [rankedRes, idsRes] = await Promise.all([
    fetch(`https://${region}.api.riotgames.com/tft/league/v1/by-puuid/${puuid}?api_key=${apiKey}`),
    fetch(`https://${regional}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuid}/ids?count=30&api_key=${apiKey}`),
  ]);
  const rankedAll = rankedRes.ok ? await rankedRes.json() : [];
  const matchIds: string[] = idsRes.ok ? await idsRes.json() : [];
  const ranked = Array.isArray(rankedAll) ? rankedAll.find((r: any) => r.queueType === TFT_RANKED_SOLO) || null : null;

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
      // Extra metrics for flexMastery / gameSense agents (snake_case in raw,
      // camelCase on processed match objects — try both)
      lastRound: me.last_round ?? me.lastRound ?? 0,
      goldLeft: typeof (me.gold_left ?? me.goldLeft) === 'number' ? (me.gold_left ?? me.goldLeft) : null,
      level: me.level ?? 0,
      totalDamage: me.total_damage_to_players ?? me.totalDamageToPlayers ?? 0,
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
    source: 'live',
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
