// Stufenplan, Rezepte und Shop-Abgleich fuer die angeheftete Comp.
// Reine Funktionen (plan.test.ts) — alles aus den Daten der Comp abgeleitet,
// keine festen Zeitplaene.
import type { CompanionComp, CompanionLookups } from '../../../../app/lib/companion-types.ts';

export type LevelPlan =
  | { kind: 'reroll'; level: number; targets: string[]; avgLevel: number | null }
  | { kind: 'fast8' | 'fast9'; avgLevel: number | null };

// Reroll-Comps bleiben auf der Stufe, auf der ihre 3-Sterne-Unit am haeufigsten
// im Shop steht: 1-Kosten auf 5, 2-Kosten auf 6, 3-Kosten auf 7.
const REROLL_LEVEL: Record<number, number> = { 1: 5, 2: 6, 3: 7 };

export function levelPlan(comp: CompanionComp, lookups: CompanionLookups | null): LevelPlan {
  const costOf = (id: string) => lookups?.champions[id]?.cost ?? 99;
  const rerollTargets = comp.units.filter(u => u.star3 && costOf(u.id) <= 3);
  if (rerollTargets.length > 0) {
    const cost = Math.min(...rerollTargets.map(u => costOf(u.id)));
    return {
      kind: 'reroll',
      level: REROLL_LEVEL[cost],
      targets: rerollTargets.filter(u => costOf(u.id) === cost).map(u => u.id),
      avgLevel: comp.avgLevel,
    };
  }
  return { kind: comp.avgLevel != null && comp.avgLevel >= 8.5 ? 'fast9' : 'fast8', avgLevel: comp.avgLevel };
}

export interface Recipe { item: string; parts: [string, string] }

// Rezepte der Items an den Item-Traegern, ohne Doppelte. Items ohne
// 2-teiliges Rezept (Embleme aus Spatula, Artefakte) fallen weg.
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

// Welche Shop-Plaetze eine Unit der Comp zeigen.
export function shopMatches(shop: Array<string | null>, comp: CompanionComp | null): boolean[] {
  const ids = new Set((comp?.units ?? []).map(u => u.id));
  return [0, 1, 2, 3, 4].map(i => {
    const s = shop[i];
    return !!s && ids.has(s);
  });
}
