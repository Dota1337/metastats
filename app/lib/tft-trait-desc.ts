// Render the Riot/CommunityDragon raw trait description into user-readable
// text. The raw `desc` field is a templated blob with `@VarName@` /
// `@VarName*100@` / `(@MinUnits@)` / `%i:iconName%` /
// `@TFTUnitProperty.trait:XYZ@` tokens that Riot's in-game tooltip system
// expands at render time. Without expansion the user sees gibberish like:
//   "Meeple attract Meeps... (@MinUnits@) @Meeps@ %i:set14AmpIcon%, @BonusHealth@..."
//
// Pattern observed across Set 17 traits:
//   - Optional general description (prose before the first "(@MinUnits@)")
//   - One block per tier, separated by "(@MinUnits@)", each substituted
//     with the matching tier's variables + minUnits
//   - Hot-path tokens we support:
//       @MinUnits@                      -> tier.minUnits
//       @VarName@                       -> tier.variables[VarName]
//       @VarName*100@                   -> tier.variables[VarName] * 100, rounded
//       %i:scaleHealth%/scaleAS/...     -> short word label (Health, AS, AD, …)
//       @TFTUnitProperty.trait:X_ItemN@ -> "a random TraitName item" (Riot's
//                                          random-item pool, resolved at
//                                          match-time in-engine)
//       @VarName@ where `VarName` is missing from variables but the tier has
//       a `{hashKey}` slot -> position-matched fallback (Riot's content
//       pipeline occasionally ships hashed variable names; the value lives
//       in the same slot index as the unresolved name in `desc`)

export interface RawTraitMeta {
  name: string;
  apiName?: string;
  desc?: string;
  tiers?: { minUnits: number; maxUnits?: number | null; style?: number; variables?: Record<string, unknown> }[];
}

export interface TierBreakpoint {
  minUnits: number;
  style?: number;
  text: string;
}

export interface RenderedTraitDesc {
  generalDesc: string | null;
  tiers: TierBreakpoint[];
}

// Riot's inline-icon tokens — `%i:scaleHealth%` etc. — are visual pictograms
// in the in-game tooltip. We can't render them as-is in plain text, so we
// map the well-known ones to short word labels. Anything unmapped is
// stripped silently.
const ICON_LABELS: Record<string, string> = {
  scaleHealth: 'Health',
  scaleAS:     'AS',
  scaleAD:     'AD',
  scaleAP:     'AP',
  scaleArmor:  'Armor',
  scaleMR:     'MR',
  scaleMana:   'Mana',
  scaleCrit:   'Crit',
  scaleDodge:  'Dodge',
  scaleHeal:   'Heal',
  scaleShield: 'Shield',
  // Set 14 amplifier icon reused in Set 17 for the Meeple trait's "Meeps"
  set14AmpIcon: 'Meeps',
};

function formatNumber(n: number): string {
  if (!isFinite(n)) return '';
  const rounded = Math.round(n * 100) / 100;
  return rounded % 1 === 0 ? String(rounded) : String(rounded);
}

// Build a fallback map for tiers whose `variables` contain hashed keys
// (`{1b889d1c}`) instead of the cleartext names referenced in `desc`.
//
// Strategy: collect every @VarName@ that appears in the full description and
// is NOT a cleartext key in this tier's variables. Map them positionally
// against the hashed keys present in the variables object. This works for
// the common case where the content pipeline failed to resolve N names and
// the tier has N hashed slots.
function buildHashFallback(tier: { variables?: Record<string, unknown> }, fullDesc: string): Map<string, unknown> | null {
  const variables = tier.variables || {};
  const hashedKeys = Object.keys(variables).filter(k => /^\{[0-9a-f]+\}$/.test(k));
  if (hashedKeys.length === 0) return null;

  const seen = new Set<string>();
  const unresolved: string[] = [];
  // First-appearance order matches Riot's own pipeline output order
  for (const m of fullDesc.matchAll(/@([A-Za-z][\w]*)(?:\*100)?@/g)) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    if (name === 'MinUnits') continue;
    if (name in variables) continue;
    unresolved.push(name);
  }
  if (unresolved.length === 0) return null;

  const map = new Map<string, unknown>();
  for (let i = 0; i < unresolved.length && i < hashedKeys.length; i++) {
    map.set(unresolved[i], variables[hashedKeys[i]]);
  }
  return map;
}

function substituteVars(
  text: string,
  tier: { minUnits: number; variables?: Record<string, unknown> },
  fullDesc: string,
  traitName?: string,
): string {
  let out = text;
  const hashFallback = buildHashFallback(tier, fullDesc);

  const lookupVar = (name: string): number | null => {
    const direct = tier.variables?.[name];
    if (typeof direct === 'number') return direct;
    const fromHash = hashFallback?.get(name);
    if (typeof fromHash === 'number') return fromHash;
    return null;
  };

  // 0a. Cross-trait random-item-pool reference. Riot's engine rolls a
  //     specific item from a trait pool at match start — we can't predict
  //     which, so we describe the pool. "Gain the @...Item1@" reads more
  //     naturally as "Gain a random Psionic item" so we consume an
  //     optional preceding article.
  out = out.replace(
    /(\b(?:the|a|an)\s+)?@TFTUnitProperty\.trait:[^@]*_Item\d+@/gi,
    () => `a random ${traitName || 'unique'} item`,
  );

  // 0b. Any other TFTUnitProperty reference (cross-unit/-item stats we
  //     can't resolve). Consume an adjacent % so "X%+Y%" defaults cleanly.
  out = out.replace(/@TFTUnitProperty\.[^@]*@%?/g, '');

  // 1. @VarName*100@ — explicit ×100 (used for percent values)
  out = out.replace(/@([A-Za-z][\w]*)\*100@/g, (_, name) => {
    const v = lookupVar(name);
    return v !== null ? String(Math.round(v * 100)) : '';
  });

  // 2. @MinUnits@ — universal, not in `variables`
  out = out.replace(/@MinUnits@/g, String(tier.minUnits));

  // 3. @VarName@ followed by %i:iconName% — the icon provides the label.
  out = out.replace(/@([A-Za-z][\w]*)@(\s*)%i:([\w]+)%/g, (_, name, _ws, icon) => {
    const v = lookupVar(name);
    if (v === null) return '';
    const label = ICON_LABELS[icon];
    return formatNumber(v) + (label ? ` ${label}` : '');
  });

  // 4. @VarName@ standalone — context in surrounding prose
  out = out.replace(/@([A-Za-z][\w]*)@/g, (_, name) => {
    const v = lookupVar(name);
    return v !== null ? formatNumber(v) : '';
  });

  // 5. Standalone %i:icon% — try the mapping, else strip
  out = out.replace(/%i:([\w]+)%/g, (_, icon) => ICON_LABELS[icon] || '');

  // 6. Any leftover @token@ we didn't recognise
  out = out.replace(/@[\w.:]+@/g, '');

  // Cleanup whitespace + orphan punctuation
  out = out.replace(/\s+/g, ' ')
           .replace(/\s+([,.;:])/g, '$1')
           .replace(/^[\s,]+/, '')
           .trim();

  return out;
}

export function renderTraitDesc(traitMeta: RawTraitMeta | null | undefined): RenderedTraitDesc {
  if (!traitMeta?.desc) return { generalDesc: null, tiers: [] };
  const tiers = traitMeta.tiers || [];
  const raw = traitMeta.desc;
  const traitName = traitMeta.name;

  const parts = raw.split(/\(@MinUnits@\)/);
  const generalRaw = parts[0]?.trim() ?? '';
  const generalDesc = generalRaw
    ? substituteVars(generalRaw, tiers[0] || { minUnits: 0, variables: {} }, raw, traitName)
    : null;

  const tierTexts: TierBreakpoint[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const tier = tiers[i];
    if (!tier) continue;
    const text = substituteVars(parts[i + 1] || '', tier, raw, traitName);
    if (!text) continue;
    tierTexts.push({ minUnits: tier.minUnits, style: tier.style, text });
  }

  return { generalDesc: generalDesc || null, tiers: tierTexts };
}

// Riot's trait-pool items are named "TFT{set}_Item_{TraitPrefix}_{ItemName}".
// For Psionic and similar random-pool traits we want to show the user the
// possible items underneath the synergy text. This helper extracts the pool
// from the full assets bundle given a trait's apiName.
export interface TraitItemPoolEntry { apiName: string; name: string }

export function findTraitItemPool(
  traitApiName: string | undefined,
  itemsBundle: Record<string, { name: string; desc?: string }> | undefined,
): TraitItemPoolEntry[] {
  if (!traitApiName || !itemsBundle) return [];
  // Strip the "TFT{N}_" prefix to get e.g. "PsyOps" from "TFT17_PsyOps".
  const prefixMatch = traitApiName.match(/^(TFT\d+)_(.+)$/);
  if (!prefixMatch) return [];
  const [, setPrefix, traitTail] = prefixMatch;
  const itemPrefix = `${setPrefix}_Item_${traitTail}_`;
  const pool: TraitItemPoolEntry[] = [];
  for (const [apiName, item] of Object.entries(itemsBundle)) {
    if (!apiName.startsWith(itemPrefix)) continue;
    if (apiName.endsWith('_Radiant')) continue;          // skip radiant variants
    if (/EmblemItem$/.test(apiName)) continue;           // skip trait emblem
    pool.push({ apiName, name: item.name });
  }
  pool.sort((a, b) => a.name.localeCompare(b.name));
  return pool;
}

// Find all trait variants that share the same display name. Stargazer in
// Set 17 has 7 sub-variants (Wolf, Medallion, Huntress, Serpent, Shield,
// Fountain, Mountain) plus the generic root entry — collapsing them on
// the list view + detail view is much friendlier than 8 separate rows.
export interface TraitVariantRef {
  apiName: string;
  meta: RawTraitMeta & { icon?: string };
}

export function findTraitVariants(
  displayName: string,
  traitsBundle: Record<string, RawTraitMeta & { icon?: string }> | undefined,
): TraitVariantRef[] {
  if (!displayName || !traitsBundle) return [];
  const out: TraitVariantRef[] = [];
  for (const [apiName, meta] of Object.entries(traitsBundle)) {
    if (meta?.name === displayName) out.push({ apiName, meta });
  }
  return out;
}

// Pull "The Wolf" / "The Altar" out of the "This game: The Wolf." preamble
// that every Stargazer variant ships with. Returns null if the trait isn't
// in that format. Used to label the variant cards.
export function extractConstellationLabel(desc: string | undefined): string | null {
  if (!desc) return null;
  const m = desc.match(/This game:\s*(The [A-Z][A-Za-z]+)/);
  return m ? m[1] : null;
}

// Strip the shared "Stargazers chart a different constellation every game.
// This game: The X." preamble + the trailing "Stargazers in empowered hexes
// gain various bonuses" generic suffix. Returns the body that's unique to
// the variant. Used for the multi-variant cards.
export function stripStargazerPreamble(desc: string | undefined): string | undefined {
  if (!desc) return desc;
  return desc
    // Drop the shared preamble (everything up to the first ".")
    .replace(/^Stargazers chart a different constellation every game\.\s*/, '')
    // Drop "This game: The X." pointer
    .replace(/This game:\s*The [A-Z][A-Za-z]+\.?\s*/, '');
}

// Arbiter (Set 17 ADMIN trait) has two halves: a fixed list of Causes the
// player can pick, and a fixed list of Effects to pair them with. Riot
// ships each as a TFT17_FavoredCause_* / TFT17_FavoredEffect_* item with
// no name and a raw description. We surface them as two columns under the
// normal trait description.
export interface ArbiterOption { apiName: string; label: string; desc: string }

function arbiterLabelFromApiName(apiName: string, prefix: string): string {
  // "TFT17_FavoredCause_FallBelowXHealth" → "Fall Below X Health"
  return apiName
    .slice(prefix.length)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/X(?=[A-Z])/g, 'X ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findArbiterOptions(
  itemsBundle: Record<string, { name: string | null; desc?: string }> | undefined,
  traitMeta: RawTraitMeta | null | undefined,
): { causes: ArbiterOption[]; effects: ArbiterOption[] } {
  if (!itemsBundle) return { causes: [], effects: [] };
  // Use the first-tier variables for value substitution. Causes use them
  // directly (e.g. @NumAttacks@ → 3), Effects use a placeholder we can't
  // resolve and gets left blank — we mark it with "[scales with tier]".
  const tier = traitMeta?.tiers?.[0] ?? { minUnits: 0, variables: {} };
  const fullDesc = traitMeta?.desc ?? '';

  const causes: ArbiterOption[] = [];
  const effects: ArbiterOption[] = [];
  for (const [apiName, item] of Object.entries(itemsBundle)) {
    if (/_FavoredCause_/.test(apiName)) {
      const desc = substituteVars(item.desc || '', tier, fullDesc, traitMeta?.name)
        .replace(/[,;]\s*$/, '');
      causes.push({ apiName, label: arbiterLabelFromApiName(apiName, apiName.replace(/_FavoredCause_.*$/, '_FavoredCause_')), desc });
    } else if (/_FavoredEffect_/.test(apiName)) {
      // Effects reference an unresolvable cross-property amount —
      // substituteVars will strip it. Add a "scales with tier" suffix so
      // users know the magnitude depends on Arbiter activation level.
      let desc = substituteVars(item.desc || '', tier, fullDesc, traitMeta?.name)
        .replace(/\s+\./g, '.').trim();
      // Heuristic: if the desc lost a numeric placeholder (the cross-prop
      // ref was stripped to nothing), the sentence reads like "All Arbiters
      // gain Ability Power" — append "(scales with activation)" so the
      // intent is clear.
      if (!/\d/.test(desc)) desc = desc.replace(/\.?$/, ' (scales with activation).');
      effects.push({ apiName, label: arbiterLabelFromApiName(apiName, apiName.replace(/_FavoredEffect_.*$/, '_FavoredEffect_')), desc });
    }
  }
  // Sort alphabetically by the readable label for stable order
  causes.sort((a, b) => a.label.localeCompare(b.label));
  effects.sort((a, b) => a.label.localeCompare(b.label));
  return { causes, effects };
}
