// Stufenplan, Rezepte und Shop-Abgleich fuer die angeheftete Comp.
// Reine Funktionen (plan.test.ts) — alles aus den Daten der Comp abgeleitet,
// keine festen Zeitplaene.
import type { CompanionComp, CompanionLookups } from '../../../../app/lib/companion-types.ts';
import type { OppBoard, OppUnit } from './boards.ts';

export type LevelPlan =
  | { kind: 'reroll'; level: number; targets: string[]; avgLevel: number | null }
  | { kind: 'fast8' | 'fast9'; avgLevel: number | null };

// Reroll-Stufe und Ziel-Units liefert der Server (rerollPlan in
// app/lib/companion-api.ts: Carry bis 3 Kosten, 3-Sterne-Anteil der Familie
// ab 0,55). Ohne diese Angabe: schnelles Leveln auf 8 oder 9.
export function levelPlan(comp: CompanionComp, _lookups?: CompanionLookups | null): LevelPlan {
  if (comp.reroll) {
    return { kind: 'reroll', level: comp.reroll.level, targets: comp.reroll.targets, avgLevel: comp.avgLevel };
  }
  return { kind: comp.avgLevel != null && comp.avgLevel >= 8.5 ? 'fast9' : 'fast8', avgLevel: comp.avgLevel };
}

// Stufen fuer den Aufstellungs-Umschalter: immer 7/8/9 (User 2026-10-07).
// Startstufe: Reroll-Comps 7, sonst 8.
export function boardLevels(plan: LevelPlan): { levels: number[]; start: number } {
  return { levels: [7, 8, 9], start: plan.kind === 'reroll' ? 7 : 8 };
}

// Nur Stufen mit Brett bekommen einen Reiter; leere fallen ganz weg.
export function shownLevels(levels: number[], has: (l: number) => boolean): number[] {
  return levels.filter(has);
}

// Tatsaechliche Startstufe, sobald bekannt ist, welche Stufen ein Brett haben:
// die erste ab der Wunsch-Startstufe mit Brett, sonst die erste mit Brett,
// sonst die Wunsch-Startstufe (dann zeigt die Seite die Gesamt-Aufstellung).
export function startLevel(levels: number[], start: number, has: (l: number) => boolean): number {
  return levels.find(l => l >= start && has(l)) ?? levels.find(has) ?? start;
}

export interface Recipe { item: string; parts: [string, string] }

// Rezepte der Items an den Item-Traegern, in Bau-Reihenfolge der Comp, ohne
// Doppelte. Items ohne 2-teiliges Rezept (Artefakte, Strahlende) fallen weg;
// Embleme aus Spatula oder Bratpfanne haben eines und bleiben drin.
export function compRecipes(comp: CompanionComp, lookups: CompanionLookups | null): Recipe[] {
  if (!lookups) return [];
  const seen = new Set<string>();
  const out: Recipe[] = [];
  for (const u of comp.units) {
    for (const it of u.items ?? []) {
      if (seen.has(it)) continue;
      seen.add(it);
      const r = lookups.items[it]?.recipe;
      if (r) out.push({ item: it, parts: r });
    }
  }
  return out;
}

export type RecipeGroupKind = 'items' | 'spatula' | 'pan';
export interface RecipeGroup { kind: RecipeGroupKind; recipes: Recipe[] }

// Gesamtliste der Rezepte in drei Bloecken: normale Items, alles mit Spatula
// (Embleme, Cape, Crown), alles mit Bratpfanne (Embleme, Shield). Erkannt am
// Bestandteil, nicht am Namen; Spatula geht vor. Je Block alphabetisch nach
// dem (englischen) Item-Namen. Leere Bloecke fallen weg.
export function groupRecipes(lookups: CompanionLookups | null): RecipeGroup[] {
  const groups: Record<RecipeGroupKind, Recipe[]> = { items: [], spatula: [], pan: [] };
  for (const [id, it] of Object.entries(lookups?.items ?? {})) {
    if (!it.recipe) continue;
    const parts = it.recipe.join(' ');
    const kind: RecipeGroupKind = /Spatula/i.test(parts) ? 'spatula' : /FryingPan/i.test(parts) ? 'pan' : 'items';
    groups[kind].push({ item: id, parts: it.recipe });
  }
  const name = (r: Recipe) => lookups?.items[r.item]?.name ?? r.item;
  return (['items', 'spatula', 'pan'] as const)
    .map(kind => ({ kind, recipes: groups[kind].sort((a, b) => name(a).localeCompare(name(b), 'en')) }))
    .filter(g => g.recipes.length > 0);
}

// Welche Shop-Plaetze eine Unit der Comp zeigen.
export function shopMatches(shop: Array<string | null>, comp: CompanionComp | null): boolean[] {
  const ids = new Set((comp?.units ?? []).map(u => u.id));
  return [0, 1, 2, 3, 4].map(i => {
    const s = shop[i];
    return !!s && ids.has(s);
  });
}

// Comp eines Gegners aus seinem gesehenen Brett, in zwei Sicherheitsstufen.
//
// Treffer = verschiedene Units der Comp auf dem Brett, mindestens 5.
// - sicher: mindestens 2 Treffer Vorsprung vor der naechstbesten Comp UND
//   mindestens ein Carry dieser Comp steht auf dem Brett.
// - wahrscheinlich: alle Comps mit hoechstens einem Treffer weniger als die
//   beste teilen denselben Trait (Geschwister wie „Trait · A" und „Trait · B").
//   Gezeigt werden dann nur der Trait und die Carries dieser Comps, die
//   wirklich auf dem Brett stehen — nie ein Carry, den der Gegner nicht hat.
// - sonst nichts: verschiedene Traits gleichauf wird nicht geraten.
// Vor Ende Stufe 2 (Runde 2-5) sind Bretter Zwischenstaende, dann gibt es nichts.
// Die Liste fasst Sub-Cluster schon ueber members zusammen, eine Comp = ein Eintrag.
export const RECOGNIZE_MIN_HITS = 5;
export const RECOGNIZE_SURE_LEAD = 2;
export const RECOGNIZE_MIN_ROUND = 25;

export type OppRecognition =
  | { kind: 'sure'; comp: CompanionComp; carries: OppUnit[] }
  | { kind: 'likely'; trait: string; label: string; carries: OppUnit[] };

export function recognizeComp(board: OppBoard | null | undefined, comps: CompanionComp[]): OppRecognition | null {
  if (!board || board.round < RECOGNIZE_MIN_ROUND) return null;
  const onBoard = new Map(board.units.map(u => [u.unit, u.level]));
  if (onBoard.size < RECOGNIZE_MIN_HITS) return null;
  const scored = comps
    .map(c => ({ c, hits: new Set(c.units.map(u => u.id).filter(id => onBoard.has(id))).size }))
    .filter(x => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  const best = scored[0];
  if (!best || best.hits < RECOGNIZE_MIN_HITS) return null;
  const carriesOf = (cs: CompanionComp[]): OppUnit[] => {
    const ids = [...new Set(cs.flatMap(c => c.carries))].filter(id => onBoard.has(id));
    return ids.map(unit => ({ unit, level: onBoard.get(unit) ?? 1 }));
  };
  const second = scored[1]?.hits ?? 0;
  const sureCarries = carriesOf([best.c]);
  if (best.hits - second >= RECOGNIZE_SURE_LEAD && sureCarries.length > 0) {
    return { kind: 'sure', comp: best.c, carries: sureCarries };
  }
  const near = scored.filter(x => x.hits >= best.hits - 1).map(x => x.c);
  if (!near.every(c => c.trait === best.c.trait)) return null;
  return { kind: 'likely', trait: best.c.trait, label: traitLabel(best.c), carries: carriesOf(near) };
}

// Trait-Name, wie ihn der Server in den Comp-Namen schreibt („Trait · Carry").
export function traitLabel(c: CompanionComp): string {
  const i = c.name.indexOf(' · ');
  return i > 0 ? c.name.slice(0, i) : c.name;
}
