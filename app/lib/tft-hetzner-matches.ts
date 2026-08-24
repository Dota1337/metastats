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

// Bewusst auf wenige Spieler begrenzt. Dieser Endpunkt liefert die vollen
// Match-Rows inklusive der units/traits-jsonb — bei 1000 Spielern waren das
// gemessen 96,3 MB pro Aufruf, und genau daran ist /api/tft/onetricks
// haengengeblieben. Wer ein Aggregat ueber viele Spieler braucht, nimmt
// fetchHetznerPlayerCompHistogram: dort rechnet die Box und schickt nur das
// Ergebnis. Die verbleibenden Aufrufer (coach, econ-score, pros/specialty)
// fragen jeweils genau einen Spieler ab.
const PLAYER_MATCHES_MAX_PUUIDS = 25;

export async function fetchHetznerPlayerMatches(opts: PlayerMatchesOpts): Promise<HetznerMatchRow[]> {
  if (!HETZNER_URL || !TOKEN) throw new Error('hetzner_disabled');
  if (opts.puuids.length === 0) return [];
  if (opts.puuids.length > PLAYER_MATCHES_MAX_PUUIDS) {
    throw new Error(`hetzner_player_matches: ${opts.puuids.length} puuids uebersteigt das Limit von ${PLAYER_MATCHES_MAX_PUUIDS} — fuer Aggregate fetchHetznerPlayerCompHistogram nutzen`);
  }
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

// Comp-Histogramm pro Spieler: die Box liest die Match-Rows, klassifiziert sie
// und schickt nur die Zaehlung zurueck. Ersetzt das Muster "alle Rows ziehen und
// auf Vercel zaehlen" fuer /api/tft/onetricks.
//
// `clusters` steht in der Reihenfolge des ERSTEN Auftretens je Spieler, und die
// Box liest `ORDER BY req.ord, game_datetime DESC`. Wer danach stabil nach
// `games` sortiert, bekommt bei Gleichstand die zuletzt gespielte Comp zuerst —
// genau das Verhalten, das die Route vorher hatte. Diese Reihenfolge ist Teil
// des Vertrags, nicht Zufall.
export interface CompHistogramCluster {
  key: string;
  games: number;
  sumPlacement: number;
}

export interface CompHistogramPlayer {
  puuid: string;
  clusters: CompHistogramCluster[];
}

interface CompHistogramOpts {
  puuids: string[];
  setNumber?: number;
  queueId?: number | null;
  limitPerPuuid?: number;
  // 'live' (Default) klassifiziert die Cache-Rows auf der Box. 'column' nimmt
  // die gespeicherte Spalte comp_cluster_key — billiger, weicht aber in 7,37 %
  // der Zeilen ab (gemessen 2026-08-24, 5 Regionen / 50.000 Matches). Erst nach
  // dem Wurzelfix umschalten.
  source?: 'live' | 'column';
  signalTimeoutMs?: number;
}

export async function fetchHetznerPlayerCompHistogram(opts: CompHistogramOpts): Promise<{
  players: CompHistogramPlayer[];
  rows: number;
  unclassified: number;
}> {
  if (!HETZNER_URL || !TOKEN) throw new Error('hetzner_disabled');
  if (opts.puuids.length === 0) return { players: [], rows: 0, unclassified: 0 };
  const res = await fetch(`${HETZNER_URL}/player-comp-histogram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      puuids: opts.puuids,
      set_number: opts.setNumber,
      queue_id: opts.queueId ?? null,
      limit_per_puuid: opts.limitPerPuuid ?? 50,
      source: opts.source ?? 'live',
    }),
    // Die Antwort ist klein, aber der DB-Read bleibt der lange Pol: gemessen
    // 7-16 s warm/kalt fuer 1000 Spieler x 50 Matches auf einem Working Set,
    // das um ein Vielfaches groesser ist als der RAM der Box.
    signal: AbortSignal.timeout(opts.signalTimeoutMs ?? 45_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`hetzner_comp_histogram ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    players: Array.isArray(data?.players) ? data.players as CompHistogramPlayer[] : [],
    rows: Number(data?.rows) || 0,
    unclassified: Number(data?.unclassified) || 0,
  };
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
