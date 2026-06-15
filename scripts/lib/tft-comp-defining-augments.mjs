// Kuratierte Liste von Augments, die die Spielweise einer Comp so stark
// prägen, dass sie als eigenständige Sub-Cluster geführt werden sollten.
// Hero-Augments sind NICHT hier — sie wirken bereits via carryFromAugments
// in classifyComp als Carry-Picker.
//
// Auswahlkriterium: das Augment ändert den Win-Plan (Reroll-Incentive,
// 2-Cost-Stacking, spezifischer Cap-Out-Pfad) oder erzwingt eine
// signifikant andere Item-/Level-Strategie. Reine Stat-Buff-Augments
// (z.B. Component Crafting, Wandering Trainer) sind KEIN comp-definer.
//
// Mapping: Augment-ApiName → Kurzform-Slug, der als Cluster-Key-Suffix
// `~<slug>` an den base-Key gehängt wird. Slug wird auch im UI als
// Comp-Variant-Label verwendet (lookup via assets.items[apiName].name
// für den lesbaren Namen).
//
// Bei neuen Sets: Liste anhand `desc`-Inspektion erweitern, NICHT raten
// — Fehlinterpretation von TwoTanky (2-Copy-Reroll-Augment statt
// Tank-Item-Build) 2026-06-15 war Folge genau dieser Faulheit.
export const COMP_DEFINING_AUGMENTS = new Map([
  // Two Tanky — fielding 2 copies of a champ grants +500 HP each; 3-star
  // gibt extra 2-star copy. Klassisches Reroll-Incentive-Augment.
  ['TFT_Augment_TwoTanky', 'TwoTanky'],
  // Two Much Value — Reroll bonus pro unique 2-cost champion gefieldet.
  // Stark in 2-Cost-Reroll-Comps.
  ['TFT_Augment_TwoMuchValue', 'TwoMuchValue'],
  // Two Trick — gewährt 2-Star copies von 1-/2-Cost champs; jumpstartet
  // Low-Cost-Reroll-Strategien.
  ['TFT_Augment_TwoTrick', 'TwoTrick'],
]);

/**
 * Sucht in einer Augments-Liste das erste comp-definierende Augment und
 * returnt seinen Slug — oder null wenn keines getroffen wurde. Reihenfolge
 * entspricht der ursprünglichen Riot-Reihenfolge (Augment 1-1 zuerst).
 */
export function compDefiningAugmentSlug(augments) {
  if (!Array.isArray(augments)) return null;
  for (const a of augments) {
    if (!a) continue;
    const slug = COMP_DEFINING_AUGMENTS.get(a);
    if (slug) return slug;
  }
  return null;
}
