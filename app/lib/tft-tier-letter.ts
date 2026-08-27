// Tier-Letter (S/A/B/C/D) badge for Units/Items/Comps lists. Market standard
// across MetaTFT / MetaBot / op.gg / u.gg / tactics.tools — metastats was the
// only major TFT stats site without one. Score-formula calibrated against the
// snapshot live data so the distribution lands ~10/15/25/30/20%.
//
// score = (4.5 − avgPlacement) − max(0, log(pickRate / anchor)) × penalty
//
// The pickrate term dampens popular-but-mediocre entities. Items+Comps that
// players reach for first get a slight haircut so „Meta-Defining" stays
// reserved for actually strong entities. Sample-Gate (minGames) blocks
// 5-game-curiosities from landing in S.
//
// Cutoffs live in public/tft-tier-cutoffs.json so re-calibration after a set
// drop or major patch doesn't need a code redeploy. Set-specific overrides
// in perSet[<setNumber>] take precedence over the default block, und darin
// schlaegt scoreCutoffsByKind[<kind>] das globale scoreCutoffs.
//
// 5 tiers, not 6 — F was deliberately dropped after the classification-
// reviewer flagged a Community-Backlash risk; tactics.tools also runs
// S/A/B/C with red-coded last tier as "avoid".

export type TierLetter = 'S' | 'A' | 'B' | 'C' | 'D';
export type EntityKind = 'units' | 'items' | 'comps';

export interface TierCutoffsBundle {
  default: TierCutoffs;
  perSet?: Record<string, Partial<TierCutoffs>>;
}

export interface ScoreCutoffs { S: number; A: number; B: number; C: number }

export interface TierCutoffs {
  scoreCutoffs: ScoreCutoffs;
  // Optionale Cutoffs je Entitaetsklasse. Gemessen am 27.08.2026 ueber
  // euw1+na1+kr/7d: die Score-Streuung ist je Klasse strukturell verschieden
  // (Items liegen eng beisammen, Units breit), ein globales Set trifft die
  // Zielverteilung deshalb hoechstens fuer eine Klasse. Fehlt der Block, gilt
  // scoreCutoffs wie bisher.
  scoreCutoffsByKind?: Partial<Record<EntityKind, ScoreCutoffs>>;
  pickratePenalty: number;
  pickrateAnchor: number;
  minGames: { units: number; items: number; comps: number };
}

// Fallback identical to the JSON's `default` block — keeps the helper usable
// when the JSON is missing or fetch fails mid-render. Calibrated 2026-06-19.
const FALLBACK: TierCutoffs = {
  scoreCutoffs: { S: 0.40, A: 0.20, B: 0.00, C: -0.25 },
  pickratePenalty: 0.10,
  pickrateAnchor: 0.005,
  minGames: { units: 200, items: 150, comps: 50 },
};

let cached: TierCutoffsBundle | null = null;
let cacheLoaded = false;

async function loadCutoffs(): Promise<TierCutoffsBundle> {
  if (cacheLoaded) return cached ?? { default: FALLBACK };
  cacheLoaded = true;
  try {
    const res = await fetch('/tft-tier-cutoffs.json', { cache: 'force-cache' });
    if (res.ok) cached = await res.json();
  } catch {
    // Silent — fallback covers it.
  }
  return cached ?? { default: FALLBACK };
}

export function resolveCutoffs(bundle: TierCutoffsBundle, setNumber?: number | null): TierCutoffs {
  const base = bundle.default ?? FALLBACK;
  if (setNumber != null) {
    const override = bundle.perSet?.[String(setNumber)];
    if (override) {
      const byKind: Partial<Record<EntityKind, ScoreCutoffs>> = { ...(base.scoreCutoffsByKind || {}) };
      for (const [kind, block] of Object.entries(override.scoreCutoffsByKind || {})) {
        const k = kind as EntityKind;
        byKind[k] = { ...(byKind[k] || base.scoreCutoffs), ...(block || {}) };
      }
      return {
        scoreCutoffs: { ...base.scoreCutoffs, ...(override.scoreCutoffs || {}) },
        scoreCutoffsByKind: Object.keys(byKind).length ? byKind : undefined,
        pickratePenalty: override.pickratePenalty ?? base.pickratePenalty,
        pickrateAnchor: override.pickrateAnchor ?? base.pickrateAnchor,
        minGames: { ...base.minGames, ...(override.minGames || {}) },
      };
    }
  }
  return base;
}

export function tierScore(
  avgPlacement: number | null | undefined,
  pickRate: number | null | undefined,
  cutoffs: TierCutoffs,
): number | null {
  if (avgPlacement == null || pickRate == null) return null;
  const placeTerm = 4.5 - avgPlacement;
  // log(0) is -Infinity → max(0, …) neutralises, so 0-pickrate entities get
  // no penalty (their sample size is already handled by the minGames gate).
  const penalty =
    pickRate > 0
      ? Math.max(0, Math.log(pickRate / cutoffs.pickrateAnchor)) * cutoffs.pickratePenalty
      : 0;
  return placeTerm - penalty;
}

export function scoreToLetter(score: number | null, cutoffs: TierCutoffs): TierLetter | null {
  if (score == null) return null;
  if (score >= cutoffs.scoreCutoffs.S) return 'S';
  if (score >= cutoffs.scoreCutoffs.A) return 'A';
  if (score >= cutoffs.scoreCutoffs.B) return 'B';
  if (score >= cutoffs.scoreCutoffs.C) return 'C';
  return 'D';
}

interface TierInput {
  avgPlacement: number | null | undefined;
  pickRate: number | null | undefined;
  games: number;
}

/**
 * Async tier-letter resolver. Loads cutoffs on first call, then memoises.
 * Returns null when the entity is below the sample gate for its kind — UI
 * renders "—" instead of a misleading badge.
 */
export async function tierLetterOf(
  input: TierInput,
  kind: EntityKind,
  setNumber?: number | null,
): Promise<TierLetter | null> {
  const bundle = await loadCutoffs();
  const cutoffs = resolveCutoffs(bundle, setNumber);
  return tierLetterOfSync(input, kind, cutoffs);
}

/**
 * Synchronous variant for cases where the cutoffs bundle is already loaded
 * (loadTierCutoffs called upstream). Used by list pages that compute the
 * badge for many rows at once — avoids per-row async.
 */
export function tierLetterOfSync(
  input: TierInput,
  kind: EntityKind,
  cutoffs: TierCutoffs,
): TierLetter | null {
  if (input.games < cutoffs.minGames[kind]) return null;
  const perKind = cutoffs.scoreCutoffsByKind?.[kind];
  const effective = perKind ? { ...cutoffs, scoreCutoffs: perKind } : cutoffs;
  return scoreToLetter(tierScore(input.avgPlacement, input.pickRate, effective), effective);
}

export async function loadTierCutoffs(setNumber?: number | null): Promise<TierCutoffs> {
  const bundle = await loadCutoffs();
  return resolveCutoffs(bundle, setNumber);
}

// Roh-Hexe, bewusst: eine Rang-Leiter. Die Stufen muessen untereinander
// unterscheidbar bleiben und duerfen sich nicht mitbewegen, wenn die
// Text-Token fuer Lesbarkeit nachgezogen werden.
export const TIER_COLORS: Record<TierLetter, string> = {
  S: '#e0c75a',
  A: '#7B61FF',
  B: '#3a8ddc',
  C: '#9aa6b2',
  D: '#5a6a80',
};
