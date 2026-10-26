// Antwort des Box-Endpunkts /player-scoring (scripts/lib/tft-player-scoring.mjs
// scorePlayer + tft-player-scoring-endpoint.mjs). Werte 0–100, 50 = typisch
// unter den Bezugsspielern; null = zu wenige Spiele oder keine Bezugswerte.

export type ScoringMain = 'results' | 'board' | 'range' | 'economy' | 'ceiling' | 'tempo';

export interface ScoringMetric {
  id: string;
  main: ScoringMain;
  /** gesetzt bei der Nur-bekannte-Lobby-Fassung eines Unterwerts (z. B. '5.1k' → '5.1') */
  variantOf: string | null;
  value: number | null;
  lo: number | null;
  hi: number | null;
  n: number;
  minN: number;
  /** 200 Bootstrap-Wiederholungen, gleiche Reihenfolge fuer alle Unterwerte */
  reps: (number | null)[] | null;
}

export interface ScoringGame {
  matchId: string;
  gameMs: number;
  placement: number;
  family: string | null;
  carry: string | null;
  known: boolean;
  E: number | null;
  R: number | null;
  C: number | null;
  X: number | null;
  scores: Record<string, number | null>;
  overall: number | null;
}

export interface PlayerScoring {
  available: true;
  version: number;
  set: number;
  populationAt: string;
  damageAvailable: boolean;
  elimAvailable: boolean;
  lobbyModel: boolean;
  games: number;
  knownGames: number;
  refreshing: boolean;
  metrics: ScoringMetric[];
  recent: ScoringGame[];
}

export type PlayerScoringResponse = PlayerScoring | { available: false; reason?: string };
