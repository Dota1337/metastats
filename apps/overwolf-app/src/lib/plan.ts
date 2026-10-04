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
