// Gegner-Tracker: wann man gegen wen zuletzt gekaempft hat und wer als
// naechstes eher nicht dran ist. Reine Rechnung (tracker.test.ts).
//
// Fakten: „dran“ (laufender Kampf), „vor N Runden“ (nur Spielerkaempfe),
// „noch nicht“. Vorhersage: Riot veroeffentlicht die Regel nicht (Wiki V9.16:
// derselbe Gegner zweimal hintereinander „should happen almost never“). Wie
// MetaTFT gelten die Gegner der letzten (Lebende − 4) Kampfrunden als
// „unwahrscheinlich“ — nie als „kann nicht“. Keine Vorhersage bei Double Up,
// bei hoechstens 3 Lebenden und bei unbekanntem Modus mit anderer Spielerzahl
// als 8. Jede Kampfrunde wird als „matchup check“ geloggt (beide Zaehlweisen),
// um die Regel an echten Spielen zu pruefen.
import type { RosterRow } from './store.ts';
import { QUEUE_DOUBLE_UP, stageToRound } from './gep.ts';

export type TrackStatus = 'now' | 'ago' | 'never' | 'unlikely';
export interface TrackRow { name: string; status: TrackStatus; roundsAgo: number | null; hp: number | null; dead: boolean }

export interface TrackInput {
  pvp: Record<string, string>;     // Stufe -> Gegner, nur Spielerkaempfe
  roster: RosterRow[];
  stage: string | null;
  roundKind: string | null;
  queueId: number | null;
  me: string | null;               // eigener Name (Name#Tag oder nur Name)
}

const norm = (n: string) => n.trim().toLowerCase();
const short = (n: string) => norm(n.split('#')[0]);

export function isMe(name: string, me: string | null): boolean {
  if (!me) return false;
  return me.includes('#') && name.includes('#') ? norm(name) === norm(me) : short(name) === short(me);
}

export const aliveOf = (roster: RosterRow[]) => roster.filter(r => r.health == null || r.health > 0).length;
export const lockCount = (alive: number) => Math.max(0, alive - 4);

export function predictionAllowed(queueId: number | null, rosterSize: number, alive: number): boolean {
  if (queueId === QUEUE_DOUBLE_UP) return false;
  if (alive <= 3) return false;
  if (queueId == null && rosterSize !== 8) return false;
  return true;
}

export function pvpStages(pvp: Record<string, string>): string[] {
  return Object.keys(pvp)
    .filter(s => stageToRound(s) != null)
    .sort((a, b) => stageToRound(a)! - stageToRound(b)!);
}

export function trackRows(i: TrackInput): { rows: TrackRow[]; predicted: boolean; lock: number } {
  const stages = pvpStages(i.pvp);
  const current = i.stage && i.roundKind === 'pvp' && i.pvp[i.stage] ? i.stage : null;
  // Bezugspunkt fuer „vor N Runden“: waehrend eines Kampfes der laufende,
  // sonst der letzte gespielte Kampf (= vor 1 Runde).
  const ref = current ? stages.indexOf(current) : stages.length;
  const names = i.roster.length
    ? i.roster.map(r => r.name)
    : [...new Set(Object.values(i.pvp))];
  const hp = new Map(i.roster.map(r => [norm(r.name), r.health]));
  const alive = aliveOf(i.roster);
  const predicted = predictionAllowed(i.queueId, i.roster.length, alive);
  const lock = predicted ? lockCount(alive) : 0;
  // Gesperrt fuer den naechsten noch nicht angesagten Kampf: Gegner der letzten
  // `lock` Kampfrunden, einschliesslich des laufenden.
  const recent = new Set(stages.slice(Math.max(0, stages.length - lock)).map(s => norm(i.pvp[s])));

  const rows: TrackRow[] = [];
  for (const name of names) {
    if (isMe(name, i.me)) continue;
    const h = hp.get(norm(name)) ?? null;
    const dead = h != null && h <= 0;
    let last = -1;
    for (let k = 0; k < stages.length; k++) if (norm(i.pvp[stages[k]]) === norm(name)) last = k;
    let status: TrackStatus;
    let roundsAgo: number | null = null;
    if (current && norm(i.pvp[current]) === norm(name)) status = 'now';
    else if (last < 0) status = 'never';
    else {
      roundsAgo = ref - last;
      status = !dead && lock > 0 && recent.has(norm(name)) ? 'unlikely' : 'ago';
    }
    rows.push({ name, status, roundsAgo, hp: h, dead });
  }
  return { rows, predicted, lock };
}

// Fortlaufende Nummer jeder Runde, alle Arten mitgezaehlt: Stufe 1 hat 4
// Runden (1-1..1-4), jede weitere 7 (x-1..x-7).
export function roundIndex(stage: string): number | null {
  const m = /^(\d+)-(\d+)$/.exec(stage);
  if (!m) return null;
  const s = Number(m[1]);
  const r = Number(m[2]);
  if (s < 1 || r < 1) return null;
  return s === 1 ? r - 1 : 4 + (s - 2) * 7 + (r - 1);
}

// Pruefung je Kampfrunde fuers Log: Wurde der tatsaechliche Gegner als
// „unwahrscheinlich“ gefuehrt? pvpOnly = letzte `lock` Kampfrunden; all =
// letzte `lock` Runden jeder Art (Karussell und Monster mitgezaehlt).
export interface MatchupCheck { stage: string; opponent: string; alive: number; lock: number; hitPvpOnly: boolean; hitAll: boolean }

export function matchupCheck(pvp: Record<string, string>, stage: string, alive: number): MatchupCheck | null {
  const opponent = pvp[stage];
  const cur = roundIndex(stage);
  if (!opponent || cur == null) return null;
  const lock = lockCount(alive);
  const before = pvpStages(pvp).filter(s => (roundIndex(s) ?? Infinity) < cur);
  const pvpOnly = new Set(before.slice(Math.max(0, before.length - lock)).map(s => norm(pvp[s])));
  const all = new Set(before.filter(s => cur - roundIndex(s)! <= lock).map(s => norm(pvp[s])));
  return { stage, opponent, alive, lock, hitPvpOnly: lock > 0 && pvpOnly.has(norm(opponent)), hitAll: lock > 0 && all.has(norm(opponent)) };
}
