// Stand einer laufenden Partie und die Entscheidung, ob ein Neustart der App
// (Absturz, Update, relaunch) die Partie fortsetzt. Reine Funktionen
// (match-state.test.ts).
//
// Overwolf meldet nach einem Neustart nicht immer dieselbe sessionId, und
// 28164 liefert keine Spiel-Kennung (Log 07.-09.10.). Deshalb zwei Wege:
// - gleiche sessionId → fortsetzen
// - sonst Fingerabdruck: Stand hoechstens 5 min alt, Stufe nicht rueckwaerts,
//   mindestens 5 der Spielernamen gleich. Bis die Spielerliste da ist, wird
//   gewartet (hoechstens 3 min), dann frisch begonnen. Das gilt auch bei
//   verschiedener sessionId: Wiederverbinden nach einem Spielabsturz startet
//   einen neuen Spielprozess mit neuer Kennung, ist aber dieselbe Partie.
// Startet die App dreimal in 2 Minuten, wird nicht fortgesetzt — sonst setzt
// ein Stand, der den Absturz ausloest, sich endlos fort.
import type { Live, RosterRow } from './store.ts';
import type { OverlayName } from './windows.ts';
import { stageToRound } from './gep.ts';

export interface MatchSnapshot {
  sessionId: string | null;
  classId: number | null;
  startedAt: number;          // Beginn der Partie (eine Partie im Spielverlauf, nicht zwei)
  updatedAt: number;          // letzter Schreibstand
  stage: string | null;
  roster: RosterRow[];
  pvp: Record<string, string>;
  queueId: number | null;
  dismissed: OverlayName[];
  submitted: boolean;         // Brett-Paket dieser Partie ist schon raus
  mainHandled: boolean;       // Hauptfenster wurde zum Spielstart schon gesetzt (kein zweiter Umzug)
  wasTft: boolean;
  placement: number | null;
  matchId: string | null;
  handle: string | null;
  starts: number[];           // Starts der App waehrend dieser Partie (Absturz-Schleife)
}

export const RESUME_MAX_AGE_MS = 5 * 60_000;
export const RESUME_WAIT_MS = 3 * 60_000;
export const RESUME_MIN_NAMES = 5;
export const CRASH_WINDOW_MS = 2 * 60_000;
export const CRASH_MAX_STARTS = 3;

// Felder von ms.live, die zu einer Partie gehoeren, im Ausgangszustand. Jeder
// Pfad (Spielstart, Spielende, frischer Beginn nach Neustart) nimmt diese eine
// Quelle — sonst bleibt beim naechsten neuen Feld irgendwo ein alter Wert stehen.
export type MatchFields = Omit<Live, 'updatedAt'>;
export function emptyMatchState(): MatchFields {
  return {
    inTft: false, level: null, shop: [], shopVisible: false, opponent: null, stage: null,
    roster: [], lobby: null, startedAt: null, moving: false,
    roundKind: null, pvp: {}, queueId: null, dismissed: [], myUnits: [], wasTft: false,
  };
}

// Starts innerhalb des Absturz-Fensters, einschliesslich des jetzigen.
export function recentStarts(prev: number[] | null | undefined, now: number): number[] {
  return [...(prev ?? []).filter(t => Number.isFinite(t) && now - t < CRASH_WINDOW_MS && t <= now), now];
}

export interface ResumeContext {
  now: number;
  seenAt: number;              // wann diese App-Instanz die Partie zuerst gesehen hat
  sessionId: string | null;
  classId: number | null;
  names: string[];             // Spielernamen der laufenden Partie (leer bis zur ersten Liste)
  stage: string | null;
  starts: number[];            // aus recentStarts
}

export type ResumeDecision = { verdict: 'resume' | 'fresh' | 'wait'; reason: string };

const norm = (n: string) => n.trim().toLowerCase();

export function decideResume(snap: MatchSnapshot | null | undefined, c: ResumeContext): ResumeDecision {
  if (!snap) return { verdict: 'fresh', reason: 'no snapshot' };
  if (c.starts.length >= CRASH_MAX_STARTS) return { verdict: 'fresh', reason: 'crash loop' };
  if (snap.classId != null && c.classId != null && snap.classId !== c.classId) return { verdict: 'fresh', reason: 'other game' };
  if (c.sessionId && snap.sessionId && c.sessionId === snap.sessionId) return { verdict: 'resume', reason: 'same session' };
  if (c.seenAt - snap.updatedAt > RESUME_MAX_AGE_MS) return { verdict: 'fresh', reason: 'too old' };
  const now = stageToRound(c.stage);
  const was = stageToRound(snap.stage);
  if (now != null && was != null && now < was) return { verdict: 'fresh', reason: 'stage back' };
  const theirs = new Set(snap.roster.map(r => norm(r.name)));
  const mine = new Set(c.names.map(norm));
  if (mine.size < RESUME_MIN_NAMES || theirs.size < RESUME_MIN_NAMES) {
    return c.now - c.seenAt > RESUME_WAIT_MS
      ? { verdict: 'fresh', reason: 'no roster' }
      : { verdict: 'wait', reason: 'roster pending' };
  }
  let same = 0;
  for (const n of mine) if (theirs.has(n)) same++;
  return same >= RESUME_MIN_NAMES
    ? { verdict: 'resume', reason: `roster ${same}/${mine.size}` }
    : { verdict: 'fresh', reason: `roster ${same}/${mine.size}` };
}

// Alten Stand in den neuen einrechnen: was seit dem Neustart schon gesehen
// wurde, bleibt.
export function resumedFields(snap: MatchSnapshot): Pick<Live, 'roster' | 'pvp' | 'dismissed' | 'startedAt' | 'wasTft'> {
  return {
    roster: snap.roster ?? [],
    pvp: snap.pvp ?? {},
    dismissed: snap.dismissed ?? [],
    startedAt: snap.startedAt,
    wasTft: snap.wasTft,
  };
}
