// Single source of truth für den Tempo-/Archetyp-Descriptor einer Comp.
//
// Vorher: CompRow hatte `descriptorTag()` mit carryStar-Reroll-Precedence +
// Roll-Level (1c→5, 2c→6, 3c→7, 4c→8). Comp-Detail-Page hatte ein eigenes
// `tempoLabel()` mit nur avgLevel-Schwellen, ohne Roll-Level. Ergebnis: für
// `Samira*3` (3-Cost Reroll) zeigte die Liste „Slow Roll Lvl 7", die Detail-
// Seite „Slow Roll" oder „Balanced" je nach avgLevel — Drift, falsch.
//
// Konsolidierung 2026-06-20: alle Render-Sites importieren von hier.

// Mappt Carry-Cost auf das typische Roll-Level einer Reroll-Comp:
// 1-Cost rollt typisch auf Lvl 5 (5-3-Reroll), 2-Cost auf 6, 3-Cost auf 7,
// 4-Cost (selten als Reroll) auf 8.
export function rerollLevelForCost(cost: number): number {
  if (cost <= 1) return 5;
  return cost + 4;
}

export interface DescriptorOpts {
  avgLevel?: number | null;
  top1Rate?: number | null;
  top4Rate?: number | null;
  carryCost?: number;
  carryItemRate?: number;
  carryStar?: number;
}

export interface CompDescriptor {
  label: string;
  color: string;
}

// Single primary descriptor per comp, like tactics.tools' "Items Dep / Fast 8
// / Consistent / High WR". Priority order matters: tempo wins over difficulty,
// win-rate wins over consistency. Pros want one quick label to recognise the
// archetype, not a stack of competing tags.
export function descriptorTag(opts: DescriptorOpts): CompDescriptor | null {
  const { avgLevel, top1Rate, top4Rate, carryCost, carryItemRate, carryStar } = opts;
  // Reroll-Cluster (3★-Carry im Key) hat Vorrang vor avg-Level. Nach dem
  // 3★-Hit leveln die Spieler oft auf 8-9 weiter — der Cluster bleibt aber
  // strategisch eine Slow-Roll-Comp und sollte nicht als Fast-8 verkauft
  // werden. Label inkludiert das Roll-Level, damit man sofort sieht ob das
  // eine 2-Cost-(Lvl 6), 3-Cost-(Lvl 7) oder 1-Cost-(Lvl 5)-Reroll ist.
  if (carryStar === 3 && carryCost != null && carryCost > 0) {
    return { label: `Slow Roll Lvl ${rerollLevelForCost(carryCost)}`, color: '#3a8ddc' };
  }
  if (avgLevel != null) {
    if (avgLevel >= 8.5) return { label: 'Fast 8', color: '#e0c75a' };
    if (avgLevel <= 7.0) return { label: 'Reroll', color: '#3a8ddc' };
  }
  if (carryCost != null && carryCost >= 4 && (carryItemRate ?? 0) > 0.55) {
    return { label: 'Items Dep', color: '#c39bff' };
  }
  if ((top1Rate ?? 0) > 0.18) return { label: 'High WR', color: '#3ecf8e' };
  if ((top4Rate ?? 0) > 0.65) return { label: 'Consistent', color: '#3a8ddc' };
  return null;
}
