// Hetzner-routed reads for the Set-17 per-match cache + peer baselines.
// The match-cache jsonb only lives on the Hetzner box (Supabase only has
// the marketvalue snapshots replicated, plus Set-15-era leftovers).
// Every endpoint that needs per-match jsonb (onetricks / coach / specialty
// / econ-score) routes through here instead of querying Supabase directly.
//
// On Hetzner the queries use the (puuid, set_number, queue_id, game_datetime)
// btree index + a ROW_NUMBER() window so each puuid gets up to limit_per_puuid
// recent matches — same semantic as the legacy .order().limit() pattern.

const HETZNER_URL = process.env.HETZNER_REFRESH_URL;
const TOKEN = process.env.REFRESH_API_TOKEN;

export interface HetznerMatchRow {
  puuid: string;
  matchId: string;
  region: string;
  setNumber: number;
  queueId: number;
  gameDatetime: number;
  placement: number;
  level: number;
  lastRound: number;
  totalDamage: number;
  goldLeft: number | null;
  playersEliminated: number;
  compClusterKey: string | null;
  carryUnit: string | null;
  units: Array<{ characterId?: string; character_id?: string; tier?: number; items?: string[]; itemNames?: string[] }>;
  traits: Array<{ name?: string; tier_current?: number; style?: number; num_units?: number }>;
  augments: any;
  carryItems: any;
}

interface PlayerMatchesOpts {
  puuids: string[];
  setNumber?: number;
  queueId?: number | null;       // null/undefined = no queue filter
  limitPerPuuid?: number;        // default 50
  limit?: number;                // overall hard cap, default puuids.length * limit_per_puuid
  signalTimeoutMs?: number;      // default 30s — the Hetzner side is fast (~70ms typical)
}

export async function fetchHetznerPlayerMatches(opts: PlayerMatchesOpts): Promise<HetznerMatchRow[]> {
  if (!HETZNER_URL || !TOKEN) throw new Error('hetzner_disabled');
  if (opts.puuids.length === 0) return [];
  const body = {
    puuids: opts.puuids,
    set_number: opts.setNumber,
    queue_id: opts.queueId ?? null,
    limit_per_puuid: opts.limitPerPuuid ?? 50,
    limit: opts.limit,
  };
  const res = await fetch(`${HETZNER_URL}/player-matches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.signalTimeoutMs ?? 30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`hetzner_player_matches ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data?.matches) ? data.matches as HetznerMatchRow[] : [];
}

export interface MarketvaluePoolPlayer {
  puuid: string;
  gameName: string | null;
  tagLine: string | null;
  tier: string;
  rank: string | null;
  lp: number | null;
  ladderRank: number | null;
  finalValue: number;
  snapshotDate: string;
}

interface MarketvaluePoolOpts {
  region: string;
  tiers?: string[];          // default: MASTER, GRANDMASTER, CHALLENGER
  limit?: number;            // default 3000
  signalTimeoutMs?: number;
}

export async function fetchHetznerMarketvaluePool(opts: MarketvaluePoolOpts): Promise<MarketvaluePoolPlayer[]> {
  if (!HETZNER_URL || !TOKEN) throw new Error('hetzner_disabled');
  const res = await fetch(`${HETZNER_URL}/marketvalue-pool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ region: opts.region, tiers: opts.tiers, limit: opts.limit }),
    signal: AbortSignal.timeout(opts.signalTimeoutMs ?? 15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`hetzner_mv_pool ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return Array.isArray(data?.players) ? data.players as MarketvaluePoolPlayer[] : [];
}

// Reverse-Lookup: welche Pros spielen eine bestimmte Comp. Family-Mode
// (recommended) ueber `<trait>__<carry>` matched alle Sub-Cluster (Level/Star/
// Augment) der gleichen Comp-Familie. Voraussetzung: Cache muss mit
// unifizierter Klassifikations-Lib re-klassifiziert sein.
export interface ProsByCompResult {
  puuid: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
}

interface ProsByCompOpts {
  puuids: string[];
  familyKey?: string;
  clusterKey?: string;
  setNumber?: number;
  minGames?: number;
  topN?: number;
  sinceMs?: number;
  signalTimeoutMs?: number;
}

export async function fetchHetznerProsByComp(opts: ProsByCompOpts): Promise<{ pros: ProsByCompResult[]; totalGames: number }> {
  if (!HETZNER_URL || !TOKEN) throw new Error('hetzner_disabled');
  if (opts.puuids.length === 0) return { pros: [], totalGames: 0 };
  if (!opts.familyKey && !opts.clusterKey) return { pros: [], totalGames: 0 };
  const body: Record<string, unknown> = {
    puuids: opts.puuids,
    set_number: opts.setNumber,
    min_games: opts.minGames ?? 2,
    top_n: opts.topN ?? 10,
  };
  if (opts.familyKey) body.family_key = opts.familyKey;
  if (opts.clusterKey) body.cluster_key = opts.clusterKey;
  if (opts.sinceMs) body.since_ms = opts.sinceMs;
  const res = await fetch(`${HETZNER_URL}/pros-by-comp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.signalTimeoutMs ?? 20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`hetzner_pros_by_comp ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    pros: Array.isArray(data?.pros) ? data.pros : [],
    totalGames: Number(data?.totalGames) || 0,
  };
}

interface PeerBaselineOpts {
  setNumber?: number;
  minPlacement?: number;
  limit?: number;
  signalTimeoutMs?: number;
}

export async function fetchHetznerPeerBaseline(opts: PeerBaselineOpts = {}): Promise<{ avgGoldLeft: number | null; sample: number }> {
  if (!HETZNER_URL || !TOKEN) throw new Error('hetzner_disabled');
  const res = await fetch(`${HETZNER_URL}/peer-baseline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      set_number: opts.setNumber,
      min_placement: opts.minPlacement ?? 5,
      limit: opts.limit ?? 2000,
    }),
    signal: AbortSignal.timeout(opts.signalTimeoutMs ?? 15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`hetzner_peer_baseline ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return { avgGoldLeft: data?.avgGoldLeft ?? null, sample: data?.sample ?? 0 };
}
