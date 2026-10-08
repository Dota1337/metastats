// Zeilen des Gegner-Overlays. Reine Rechnung (opponents.test.ts).
//
// Je Gegner mit erkannter Comp eine Zeile, sortiert nach Leben (wer vorn
// liegt, steht oben). Sobald die Spielerliste da ist, zaehlen nur Namen aus
// dieser Partie — gemerkte Bretter eines frueheren Spiels fallen so heraus.
// Ausgeschiedene bleiben drin (Leben 0, also unten).
import type { CompanionComp } from '../../../../app/lib/companion-types.ts';
import type { Live } from './store.ts';
import type { OppBoard } from './boards.ts';
import { recognizeComp, type OppRecognition } from './plan.ts';

export interface OppRow {
  name: string;        // "Name#Tag" wie vom Spiel gemeldet
  short: string;       // Name ohne Tag
  hp: number | null;
  next: boolean;       // naechster Gegner
  rec: OppRecognition;
  stage: string;       // Stufe, in der das Brett gesehen wurde ("4-2")
}

export function boardStage(b: OppBoard): string {
  return b.stage ?? `${Math.floor(b.round / 10)}-${b.round % 10}`;
}

export function opponentRows(live: Pick<Live, 'oppBoards' | 'roster' | 'opponent'>, comps: CompanionComp[]): OppRow[] {
  const hp = new Map(live.roster.map(r => [r.name, r.health]));
  const rows: OppRow[] = [];
  for (const [name, board] of Object.entries(live.oppBoards)) {
    if (hp.size > 0 && !hp.has(name)) continue;
    const rec = recognizeComp(board, comps);
    if (!rec) continue;
    rows.push({ name, short: name.split('#')[0], hp: hp.get(name) ?? null, next: name === live.opponent, rec, stage: boardStage(board) });
  }
  return rows.sort((a, b) => {
    if (a.hp !== b.hp) {
      if (a.hp == null) return 1;
      if (b.hp == null) return -1;
      return b.hp - a.hp;
    }
    return a.name.localeCompare(b.name);
  });
}
