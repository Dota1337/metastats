// Shared type definitions for the TFT marketvalue pipeline.

export interface TftRanked {
  tier: string;          // IRON .. CHALLENGER
  rank?: string;          // I/II/III/IV (apex tiers leave this empty)
  leaguePoints: number;
  wins: number;
  losses: number;
}

export interface TftMatchSnapshot {
  matchId: string;
  placement: number;     // 1..8
  setNumber?: number;
  augments: string[];
  comp?: {
    clusterKey: string;
    primaryTrait: string;
    primaryTraitLevel: number;
    carryUnit: string;
    carryItems: string[];
  };
  units: { characterId: string; tier: number; items: string[] }[];
}

export interface AgentScore {
  agent: string;
  multiplier: number;
  delta: number;        // multiplier - 1, signed contribution
  notes: { label: string; impact: number; detail?: string }[];
}

export interface MarketValueBreakdown {
  baseValue: number;
  multiplier: number;
  finalValue: number;
  rated: boolean;
  notRatedReason?: string;
  agents: AgentScore[];
  sampleSize: number;
  damping: number;       // 0.5 / 0.8 / 1.0
}
