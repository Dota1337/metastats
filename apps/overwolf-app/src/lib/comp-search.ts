// Comp-Auswahl im Spiel: Suche und Reihenfolge. Reine Rechnung
// (comp-search.test.ts).
//
// Gesucht wird in Comp-Name, Trait, Units und Carries — englische Namen und
// Kennungen. Augmente werden nie durchsucht (Riot-Regeln, keine Augment-Daten).
// Reihenfolge: Comps mit mindestens 2 Treffern auf dem eigenen Brett zuerst
// (2-Sterne-Units zaehlen doppelt), danach nach Tier.
import type { CompanionComp, CompanionLookups } from '../../../../app/lib/companion-types.ts';
import type { OppBoard } from './boards.ts';
import { recognizeComp } from './plan.ts';

export const BOARD_MIN_SCORE = 2;
const TIER_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const tierRank = (t: string | null) => (t != null && t in TIER_ORDER ? TIER_ORDER[t] : 9);

export function searchText(c: CompanionComp, lk: CompanionLookups | null): string {
  const ids = [...new Set([...c.units.map(u => u.id), ...c.carries])];
  const parts = [c.name, c.trait, lk?.traits[c.trait]?.name ?? '', ...ids, ...ids.map(id => lk?.champions[id]?.name ?? '')];
  return parts.join(' ').toLowerCase();
}

// Jedes Wort der Suche muss irgendwo vorkommen.
export function matchesQuery(c: CompanionComp, q: string, lk: CompanionLookups | null): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = searchText(c, lk);
  return words.every(w => text.includes(w));
}

export function boardScore(c: CompanionComp, mine: Array<{ id: string; star: number }>): { score: number; onBoard: string[] } {
  const best = new Map<string, number>();
  for (const u of mine) best.set(u.id, Math.max(best.get(u.id) ?? 0, u.star || 1));
  const onBoard = [...new Set(c.units.map(u => u.id))].filter(id => best.has(id));
  return { score: onBoard.reduce((s, id) => s + (best.get(id)! >= 2 ? 2 : 1), 0), onBoard };
}

export interface PickerRow { comp: CompanionComp; score: number; onBoard: string[] }

export function rankComps(comps: CompanionComp[], mine: Array<{ id: string; star: number }>, q: string, lk: CompanionLookups | null): PickerRow[] {
  const rows = comps
    .filter(c => matchesQuery(c, q, lk))
    .map(c => ({ comp: c, ...boardScore(c, mine) }));
  const byTier = (a: PickerRow, b: PickerRow) =>
    tierRank(a.comp.tier) - tierRank(b.comp.tier) || (a.comp.avg ?? 9) - (b.comp.avg ?? 9);
  return rows.sort((a, b) => {
    const ah = a.score >= BOARD_MIN_SCORE;
    const bh = b.score >= BOARD_MIN_SCORE;
    if (ah !== bh) return ah ? -1 : 1;
    if (ah && a.score !== b.score) return b.score - a.score;
    return byTier(a, b);
  });
}

// Wie viele Gegner spielen sichtbar dieselben Carries (erkannte Comp)?
export function contestCount(c: CompanionComp, oppBoards: Record<string, OppBoard>, comps: CompanionComp[]): number {
  const mine = new Set(c.carries);
  let n = 0;
  for (const board of Object.values(oppBoards)) {
    const rec = recognizeComp(board, comps);
    if (rec && rec.carries.some(u => mine.has(u.unit))) n++;
  }
  return n;
}
