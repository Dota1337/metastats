import { NextRequest, NextResponse } from 'next/server';
import { computeBaseValue } from '../../../lib/tft-marketvalue/base-value';
import { extractRawMetrics, scoreSkill, type CompMetaEntry } from '../../../lib/tft-marketvalue/skill-score';
import { getRegionalRouting, parseRegion } from '../../../lib/regions';
import { processTftMatch } from '../../../lib/tft-match-processor';
import { supabase } from '../../../lib/supabase';
import { classifyComp as classifyCompUnified } from '../../../lib/tft-classify-comp';

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
  const region = parseRegion(searchParams.get('region'), { fallback: 'euw1' });
  const forceLive = searchParams.get('live') === '1';
  if (!region) {
    return NextResponse.json(
      { error: 'Ungültige Region' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

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
        summoner: { name: `${account.gameName}#${account.tagLine}`, puuid, tier: snap.tier, rank: snap.rank, lp: snap.lp, ladderRank: snap.ladder_rank ?? null },
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
      comp: classify(me, m.setNumber),
      units: me.units.map((u: any) => ({ characterId: u.characterId, tier: u.tier, items: u.items })),
      // Extra metrics for flexMastery / gameSense agents (snake_case in raw,
      // camelCase on processed match objects — try both)
      lastRound: me.last_round ?? me.lastRound ?? 0,
      goldLeft: typeof (me.gold_left ?? me.goldLeft) === 'number' ? (me.gold_left ?? me.goldLeft) : null,
      level: me.level ?? 0,
      totalDamage: me.total_damage_to_players ?? me.totalDamageToPlayers ?? 0,
    };
  }).filter((m): m is NonNullable<typeof m> => m != null);

  // Challenger base value uses the ladder-rank curve (130k..43k for the top
  // 150). Without it a Challenger drops onto the LP-only fallback (~12k, ~10x
  // too low). The live path has no apex-ladder context, so reuse the most
  // recent snapshot's persisted ladder_rank for this player.
  let ladderRank: number | undefined;
  if (ranked?.tier === 'CHALLENGER') {
    const { data: lr } = await supabase
      .from('tft_player_marketvalue_snapshots')
      .select('ladder_rank')
      .eq('puuid', puuid)
      .eq('region', region)
      .not('ladder_rank', 'is', null)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    ladderRank = lr?.ladder_rank ?? undefined;
  }

  // Base value from rank/LP (unchanged curve), then the population-relative
  // skill-score multiplier read from the batch-persisted population stats.
  const base = computeBaseValue(
    ranked ? { tier: ranked.tier, rank: ranked.rank, leaguePoints: ranked.leaguePoints, wins: ranked.wins, losses: ranked.losses } : null,
    ladderRank,
  );

  let marketValue: Record<string, unknown>;
  if (!base.rated) {
    marketValue = {
      baseValue: 0, multiplier: 1, finalValue: 0, rated: false,
      notRatedReason: base.notRatedReason, sampleSize: selfMatches.length, damping: 1, agents: [],
    };
  } else {
    const setNumber = selfMatches.reduce((mx, m) => Math.max(mx, m.setNumber || 0), 0);
    const setMatches = selfMatches.filter(m => m.setNumber === setNumber);
    const { data: ps } = await supabase
      .from('tft_mv_population_stats')
      .select('medians, expected_dmg, comp_meta')
      .eq('region', region).eq('set_number', setNumber).maybeSingle();

    let multiplier = 1, sampleSize = setMatches.length, damping = 1, signals: unknown[] = [];
    if (ps) {
      const compMeta = new Map<string, CompMetaEntry>(Object.entries((ps.comp_meta || {}) as Record<string, CompMetaEntry>));
      const raw = extractRawMetrics(setMatches as any, ranked ? { wins: ranked.wins, losses: ranked.losses } : null, compMeta);
      const sk = scoreSkill(raw, { medians: ps.medians, expectedDmg: ps.expected_dmg } as any);
      multiplier = sk.multiplier; sampleSize = sk.sampleSize; damping = sk.damping; signals = sk.signals;
    }
    marketValue = {
      baseValue: Math.round(base.baseValue), multiplier,
      finalValue: Math.round(base.baseValue * multiplier),
      rated: true, sampleSize, damping, agents: signals,
    };
  }

  return NextResponse.json({
    summoner: { name: `${account.gameName}#${account.tagLine}`, puuid, tier: ranked?.tier, rank: ranked?.rank, lp: ranked?.leaguePoints ?? null, ladderRank: ladderRank ?? null },
    marketValue,
    source: 'live',
    region,
  });
}

// Wrapper auf die unifizierte Klassifikations-Library. processed-match output
// nutzt camelCase (tierCurrent) — die Lib akzeptiert beide Casings.
function classify(p: any, setNumber?: number) {
  const result = classifyCompUnified(p, { withAugmentSuffix: false, currentSet: setNumber });
  if (!result) return undefined;
  return {
    clusterKey: result.clusterKey,
    primaryTrait: result.primaryTrait,
    primaryTraitLevel: result.primaryTraitLevel,
    carryUnit: result.carryUnit,
    carryItems: result.carryItems,
  };
}
