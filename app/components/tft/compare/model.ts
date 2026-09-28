// Gemeinsames Datenmodell fuer /tft/compare (2-4 Spieler).
//
// Die Spielerfarben stehen nur hier. Jeder Block faerbt ueber den Index des
// Spielers, damit Kopfkarte, Balken, Linien und Radar dieselbe Farbe tragen.

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 2;

export const PLAYER_COLORS = [
  'var(--accent-tft)',
  'var(--pos-win)',
  'var(--gold-earnings)',
  'var(--series-blue)',
] as const;

export interface CompareExtras {
  recent: { id: string; p: number; t: number; lvl: number }[];
  stddev: number;
  bestTop4Streak: number;
  avgLastRound: number;
  levelDist: { le7: number; l8: number; l9: number; l10: number };
  traits: { name: string; games: number; share: number; avgPlacement: number | null }[];
  units: { characterId: string; games: number; share: number; avgPlacement: number | null; star3Rate: number }[];
  rank: { tier: string; rank: string; lp: number } | null;
}

export interface SeasonAggregate {
  sampleSize: number;
  bottom4Rate: number;
  placementStddev: number;
  bestTop4Streak: number;
  uniqueComps: number;
  dominantShare: number;
  metaPickShare: number;
  itemSlamScore: number;
}

export interface SeasonRankRow {
  set_number: number;
  set_label: string | null;
  peak_tier: string | null;
  peak_division: string | null;
  peak_lp: number | null;
}

export interface AgentSignal { signal: string; z: number | null; available: boolean }

export interface ComparePlayer {
  name: string;
  puuid: string;
  tier: string | null;
  rank: string | null;
  lp: number | null;
  marketValue: number | null;
  rated: boolean;
  multiplier: number | null;
  agents: AgentSignal[];
  // null = Statistiken noch nicht geladen
  stats: {
    totalMatches: number;
    avgPlacement: number;
    top4Rate: number;
    top1Rate: number;
    placementDistribution: number[];
    statsSource: 'live' | 'season_aggregate';
    seasonAggregate: SeasonAggregate | null;
    seasonRanks: SeasonRankRow[];
    extras: CompareExtras | null;
  } | null;
}

export type Slot = ComparePlayer | { error: string } | null;

export function isPlayer(s: Slot): s is ComparePlayer {
  return !!s && !('error' in s);
}

export interface HistoryPoint {
  date: string;
  tier: string | null;
  rank: string | null;
  lp: number | null;
  finalValue: number | null;
}

// Rang als fortlaufende Zahl: je Stufe 400 Punkte (4 Divisionen zu 100 LP).
// Ab Master teilen sich Master/GM/Challenger eine LP-Leiter, deshalb zaehlt
// dort nur noch LP auf den Master-Sockel.
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const DIVS: Record<string, number> = { IV: 0, III: 1, II: 2, I: 3 };
export const MASTER_BASE = TIERS.length * 400;

export function rankScore(tier: string | null | undefined, div: string | null | undefined, lp: number | null | undefined): number | null {
  if (!tier) return null;
  const t = tier.toUpperCase();
  if (t === 'MASTER' || t === 'GRANDMASTER' || t === 'CHALLENGER') return MASTER_BASE + (lp ?? 0);
  const i = TIERS.indexOf(t);
  if (i < 0) return null;
  return i * 400 + (DIVS[(div || 'IV').toUpperCase()] ?? 0) * 100 + (lp ?? 0);
}

export function shortName(name: string): string {
  return name.split('#')[0];
}

// Live-Rang aus player-stats, sonst der Tagesstand aus dem Marktwert.
export function currentRank(p: ComparePlayer): { tier: string | null; rank: string | null; lp: number | null } {
  const live = p.stats?.extras?.rank;
  if (live) return { tier: live.tier, rank: live.rank, lp: live.lp };
  return { tier: p.tier, rank: p.rank, lp: p.lp };
}
