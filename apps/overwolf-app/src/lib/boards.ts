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

// ---------- Gegner-Bretter fuer das Gegner-Overlay ----------

export interface OppUnit { unit: string; level: number }
// round: Stufe×10+Runde, in der das Brett gesehen wurde; stage: dieselbe Angabe
// als "4-2", falls das Spiel sie gemeldet hat.
export interface OppBoard { units: OppUnit[]; round: number; stage: string | null }

// Jede Unit einmal, mit dem hoechsten Stern, den sie auf dem Brett hat.
export function toOppBoard(pieces: BoardPiece[], round: number, stage: string | null): OppBoard {
  const best = new Map<string, number>();
  for (const p of pieces) {
    if (!p.unit) continue;
    best.set(p.unit, Math.max(best.get(p.unit) ?? 0, p.level || 1));
  }
  const units = [...best].map(([unit, level]) => ({ unit, level })).sort((a, b) => a.unit.localeCompare(b.unit));
  return { units, round, stage };
}

// Neues Teilbrett in das gemerkte Brett eines Gegners einrechnen.
// - gleiche Runde: Vereinigung, je Unit der hoechste Stern (Teilstuecke derselben Aufstellung)
// - spaetere Runde: ersetzt nur, wenn sie mindestens so viele Units zeigt —
//   sonst ist es meist ein Teilbrett, und das aeltere, vollstaendigere bleibt
//   (mit seiner aelteren Stage, die das Overlay mit anzeigt)
// - fruehere Runde: wird ignoriert
export function mergeOppBoard(prev: OppBoard | null | undefined, next: OppBoard): OppBoard {
  if (!prev || prev.units.length === 0) return next;
  if (next.units.length === 0 || next.round < prev.round) return prev;
  if (next.round === prev.round) {
    const best = new Map(prev.units.map(u => [u.unit, u.level]));
    for (const u of next.units) best.set(u.unit, Math.max(best.get(u.unit) ?? 0, u.level));
    const units = [...best].map(([unit, level]) => ({ unit, level })).sort((a, b) => a.unit.localeCompare(b.unit));
    return { units, round: prev.round, stage: prev.stage ?? next.stage };
  }
  return next.units.length >= prev.units.length ? next : prev;
}

export function sameOppBoard(a: OppBoard | null | undefined, b: OppBoard | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.round === b.round && a.stage === b.stage && a.units.length === b.units.length
    && a.units.every((u, i) => u.unit === b.units[i].unit && u.level === b.units[i].level);
}

export function flattenBoards(boards: Boards): Observation[] {
  return [...boards.values()].flat();
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
