// Win Share + Top 4 Share — market metric from MetaTFT that metastats lacked.
// Reads as: "X% of all Top-1 boards contain this entity" (Unit/Item/Comp).
// For Comps the sum across all rows is ~100% (each match has exactly one
// winner); for Units/Items the sum is up to 8× higher (8 units per board,
// up to 3 items per carrier).
//
// IMPORTANT semantic distinction (data-skeptic flagged this):
//   - Comp.winShare = comp.top1 / N_match  → 0-100% spread, sums to 100%
//   - Unit.winShare = unit.top1 / N_match  → 0-100% per unit, sums to ~800%
//   - Item top1 is structurally NOT available in `tft_daily_item_stats`
//     until migration 0042 (Phase A3) — items return null for winShare.
//
// `participants` is "total per-player observations in the filter set", and
// TFT has 8 players per match — so N_match = participants / 8.

export interface ShareInput {
  top1?: number | null;
  top4?: number | null;
  participants: number;
}

export interface Shares {
  winShare: number | null;
  top4Share: number | null;
}

// data-skeptic threshold: below 500 Top-1 instances (= 500 matches) the
// metric is too noisy to render. Per-entity gate of 20 top1 events keeps
// long-tail entries out of the tooltip.
const MIN_TOTAL_TOP1_MATCHES = 500;
const MIN_ENTITY_TOP1 = 20;
const MIN_ENTITY_TOP4 = 30;

export function computeShares(input: ShareInput): Shares {
  const nMatch = input.participants > 0 ? input.participants / 8 : 0;
  if (nMatch < MIN_TOTAL_TOP1_MATCHES) {
    return { winShare: null, top4Share: null };
  }
  const total_top1 = nMatch;
  const total_top4 = nMatch * 4;

  const winShare =
    input.top1 != null && input.top1 >= MIN_ENTITY_TOP1
      ? input.top1 / total_top1
      : null;
  const top4Share =
    input.top4 != null && input.top4 >= MIN_ENTITY_TOP4
      ? input.top4 / total_top4
      : null;
  return { winShare, top4Share };
}

// For comps the share semantics naturally sum to 100% across rows. Renders
// as "X% of wins"; for units/items as "X% of winning boards include this".
// The label differs by entity kind so the UI tooltip can match the math.
