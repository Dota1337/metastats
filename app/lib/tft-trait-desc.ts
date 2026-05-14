// Render the Riot/CommunityDragon raw trait description into user-readable
// text. The raw `desc` field is a templated blob with `@VarName@` /
// `@VarName*100@` / `(@MinUnits@)` / `%i:iconName%` tokens that Riot's
// in-game tooltip system expands at render time. Without expansion the
// user sees gibberish like:
//   "Meeple attract Meeps... (@MinUnits@) @Meeps@ %i:set14AmpIcon%, @BonusHealth@..."
//
// Pattern observed across Set 17 traits:
//   - Optional general description (prose before the first "(@MinUnits@)")
//   - One block per tier, separated by "(@MinUnits@)", each substituted
//     with the matching tier's variables + minUnits
//   - Hot-path tokens we support:
//       @MinUnits@               -> tier.minUnits
//       @VarName@                -> tier.variables[VarName]
//       @VarName*100@            -> tier.variables[VarName] * 100, rounded
//       %i:anyIcon%              -> dropped (icons rendered separately, the
//                                  text reads fine without them)
//       @TFTUnitProperty.trait:X@-> "?" (cross-trait reference we can't resolve
//                                  client-side; rare and only mid-sentence)

export interface RawTraitMeta {
  name: string;
  desc?: string;
  // Riot can ship maxUnits as null for the open-ended top tier; we accept
  // either since the parser doesn't need maxUnits at all.
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
// map the well-known ones to short word labels.  Anything unmapped is
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
  // Riot stores floats with massive precision (0.15000000596046448).
  // Round to 2 decimals, drop trailing zeros.
  const rounded = Math.round(n * 100) / 100;
  return rounded % 1 === 0 ? String(rounded) : String(rounded);
}

function substituteVars(text: string, tier: { minUnits: number; variables?: Record<string, unknown> }): string {
  let out = text;

  // 0. Strip unresolvable cross-trait / cross-unit / cross-item references
  //    FIRST. The token pattern is `@TFTUnitProperty.something*100@` which
  //    overlaps with the generic `*100@` pattern and would otherwise leave
  //    debris. Also consume an adjacent `%` (Augment-value tokens almost
  //    always carry one). Result: "X%+8%" defaults cleanly to "8%".
  out = out.replace(/@TFTUnitProperty\.[^@]*@%?/g, '');

  // 1. @VarName*100@ — explicit ×100 (used for percent values)
  out = out.replace(/@([A-Za-z][\w]*)\*100@/g, (_, name) => {
    const v = tier.variables?.[name];
    return typeof v === 'number' ? String(Math.round(v * 100)) : '';
  });

  // 2. @MinUnits@ — universal, not in `variables`
  out = out.replace(/@MinUnits@/g, String(tier.minUnits));

  // 3. @VarName@ followed by %i:iconName% — the icon provides the label.
  //    Maps well to readable text: "@Meeps@ %i:set14AmpIcon%" → "2 Meeps".
  out = out.replace(/@([A-Za-z][\w]*)@(\s*)%i:([\w]+)%/g, (_, name, _ws, icon) => {
    const v = tier.variables?.[name];
    if (typeof v !== 'number') return '';
    const label = ICON_LABELS[icon];
    return formatNumber(v) + (label ? ` ${label}` : '');
  });

  // 4. @VarName@ standalone — context-bearing prose ("for @BurstDuration@
  //    seconds"); plain number substitution is enough.
  out = out.replace(/@([A-Za-z][\w]*)@/g, (_, name) => {
    const v = tier.variables?.[name];
    if (typeof v === 'number') return formatNumber(v);
    return '';
  });

  // 5. Standalone %i:icon% (no var attached) — try the mapping, else strip.
  out = out.replace(/%i:([\w]+)%/g, (_, icon) => ICON_LABELS[icon] || '');

  // 6. Any leftover @token@ we didn't recognise.
  out = out.replace(/@[\w.:]+@/g, '');

  // Normalise whitespace + clean up orphan punctuation left by token strips
  // (e.g. "  ,  " → ", ", " . " → ". ").
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

  // First "(@MinUnits@)" splits general-desc from per-tier blocks. If the desc
  // starts with "(@MinUnits@)" (e.g. Dark Star) the first part will be empty.
  const parts = raw.split(/\(@MinUnits@\)/);
  const generalRaw = parts[0]?.trim() ?? '';
  const generalDesc = generalRaw
    ? substituteVars(generalRaw, tiers[0] || { minUnits: 0, variables: {} })
    : null;

  const tierTexts: TierBreakpoint[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const tier = tiers[i];
    if (!tier) continue;
    const text = substituteVars(parts[i + 1] || '', tier);
    if (!text) continue;
    tierTexts.push({ minUnits: tier.minUnits, style: tier.style, text });
  }

  return { generalDesc: generalDesc || null, tiers: tierTexts };
}
