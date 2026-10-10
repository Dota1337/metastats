// Brett-Beobachtungen einer Partie. Overwolf meldet das Brett bei jeder
// kleinen Aenderung neu; gespeichert wird je Runde (und je Gegner) nur EIN
// Stand. Eigenes Brett: der letzte — die Aufstellung, mit der gekaempft wurde.
// Gegner-Brett: der groesste, denn Overwolf liefert es stueckweise (gemessen
// auf 28164: Stufe 6 im Schnitt 6,06 Units beim Gegner gegen 8,79 beim eigenen
// Brett). Vorher wurde jede Meldung angehaengt: Pakete wuchsen stark, und ueber
// 5.000 Eintraege schneidet der Server die spaeten Runden ab.
import type { BoardPiece } from './gep.ts';

export interface Observation { round: number; kind: 'own' | 'opp'; cell: number; unit: string; level: number; items: string[] }

export type Boards = Map<string, Observation[]>;

export function recordBoard(boards: Boards, kind: 'own' | 'opp', round: number, opponent: string | null, pieces: BoardPiece[]): void {
  const key = `${kind}|${round}|${kind === 'opp' ? opponent || '' : ''}`;
  if (kind === 'opp' && (boards.get(key)?.length ?? 0) > pieces.length) return;
  boards.set(key, pieces.map(p => ({ round, kind, ...p })));
}

export function flattenBoards(boards: Boards): Observation[] {
  return [...boards.values()].flat();
}

// Behelfs-Kennung, solange das Spiel keine Match-ID meldet. Der Backfill liest
// daraus nur die Startzeit (scripts/backfill-companion-placements.mjs); der
// Rest ist Zufall — bis 0.8.2 stand dort der Anfang des Riot-Namens.
export function liveMatchId(seedMs: number, rand: () => number = Math.random): string {
  const tail = Array.from({ length: 8 }, () => Math.floor(rand() * 16).toString(16)).join('');
  return `LIVE_${seedMs}_${tail}`;
}

// ---------- Eigene Spiele fuer den Spielverlauf ----------

export interface LocalRound { round: number; pieces: Array<{ cell: number; unit: string; level: number; items: string[] }> }

export interface LocalMatch {
  id: string;
  matchId: string | null;  // Kennung aus dem Spiel, falls gemeldet
  startedAt: number;
  endedAt: number;
  placement: number | null;
  rounds: LocalRound[];
}

// Eigene Bretter je Runde, aufsteigend. Felder kommen roh aus dem Spiel
// (cell_1..cell_28) und werden hier auf die Zaehlung des Servers gebracht:
// Feld = roh - 1, also Reihe * 7 + Spalte mit Reihe 0 = hinten.
export function ownRounds(boards: Boards): LocalRound[] {
  const out: LocalRound[] = [];
  for (const obs of boards.values()) {
    if (obs.length === 0 || obs[0].kind !== 'own') continue;
    out.push({
      round: obs[0].round,
      pieces: obs
        .filter(o => o.cell >= 1 && o.cell <= 28 && o.unit)
        .map(o => ({ cell: o.cell - 1, unit: o.unit, level: o.level, items: o.items })),
    });
  }
  return out.filter(r => r.pieces.length > 0).sort((a, b) => a.round - b.round);
}

// Welches gespeicherte eigene Spiel zu einem Spiel aus Riots Verlauf gehoert:
// gleiche Kennung, sonst Spielbeginn hoechstens 70 Minuten vor Riots Zeitpunkt
// (und nicht mehr als 10 Minuten danach) — das naechstgelegene gewinnt.
export function findLocalMatch(list: LocalMatch[], riot: { id: string; at: number }): LocalMatch | null {
  const byId = list.find(m => m.matchId && (riot.id === m.matchId || riot.id.endsWith(`_${m.matchId}`)));
  if (byId) return byId;
  let best: LocalMatch | null = null;
  for (const m of list) {
    const d = riot.at - m.startedAt;
    if (d < -10 * 60_000 || d > 70 * 60_000) continue;
    if (!best || Math.abs(d) < Math.abs(riot.at - best.startedAt)) best = m;
  }
  return best;
}
