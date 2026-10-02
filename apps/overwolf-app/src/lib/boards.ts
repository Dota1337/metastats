// Brett-Beobachtungen einer Partie. Overwolf meldet das Brett bei jeder
// kleinen Aenderung neu; gespeichert wird je Runde (und je Gegner) nur der
// letzte Stand — das ist die Aufstellung, mit der gekaempft wurde. Vorher wurde
// jede Meldung angehaengt: Pakete wuchsen stark, und ueber 5.000 Eintraege
// schneidet der Server die spaeten Runden ab.
import type { BoardPiece } from './gep.ts';

export interface Observation { round: number; kind: 'own' | 'opp'; cell: number; unit: string; level: number; items: string[] }

export type Boards = Map<string, Observation[]>;

export function recordBoard(boards: Boards, kind: 'own' | 'opp', round: number, opponent: string | null, pieces: BoardPiece[]): void {
  const key = `${kind}|${round}|${kind === 'opp' ? opponent || '' : ''}`;
  boards.set(key, pieces.map(p => ({ round, kind, ...p })));
}

export function flattenBoards(boards: Boards): Observation[] {
  return [...boards.values()].flat();
}
