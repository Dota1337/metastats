// TFT Plan-Ahead-Code generation. Riot's in-game Team Planner accepts a code
// of the shape "01" + 10 × 2-char hex slot + "TFTSet<N>" — the user can paste
// it into Settings → Game → Team Planner ("Plan Ahead") and the comp shows up
// as an in-game cheatsheet sidebar during a TFT match.
//
// Format (community-documented):
//   "01" + slot1..slot10 + "TFTSet" + setNumber
//   Each slot = 2-char uppercase hex of the champion's 1-based index in the
//   alphabetically sorted character_id list of that set. Empty slots = "00".
//
// Source: https://gist.github.com/xrr2016/22fa6e92278a2481f9026f6456b0afa4
// (Set 13 reference — format conserved through later sets; verify when
// Riot ships a new sorting convention).

import type { TftAssetsBundle } from './tft-cdragon';

// Cached alphabetical character_id list per (assets-bundle, set) so repeated
// generation on a stats page doesn't re-sort the whole champion roster.
const _sortedCache = new WeakMap<TftAssetsBundle, Map<number, string[]>>();

function getSortedChampionsForSet(assets: TftAssetsBundle, setNumber: number): string[] {
  let perBundle = _sortedCache.get(assets);
  if (!perBundle) {
    perBundle = new Map();
    _sortedCache.set(assets, perBundle);
  }
  const cached = perBundle.get(setNumber);
  if (cached) return cached;
  const prefix = `TFT${setNumber}_`;
  const sorted = Object.keys(assets.champions)
    .filter(id => id.startsWith(prefix))
    .sort();
  perBundle.set(setNumber, sorted);
  return sorted;
}

export interface PlanAheadResult {
  code: string;
  recognised: number;   // anzahl chars die in der sorted-list gefunden wurden
  total: number;        // angefragte slot-anzahl (vor padding)
}

// Generates a Plan-Ahead-Code from a list of character_ids (in the order the
// user wants them to appear in the in-game cheatsheet). Returns null when no
// assets bundle is provided yet. Champion IDs the bundle doesn't know about
// land as "00" slots so the user still gets a partial code instead of an
// outright failure.
export function buildPlanAheadCode(
  characterIds: string[],
  setNumber: number,
  assets: TftAssetsBundle | null,
): PlanAheadResult | null {
  if (!assets) return null;
  const sorted = getSortedChampionsForSet(assets, setNumber);
  const idToHex = new Map<string, string>();
  // Riot's indexing starts at 1 (slot "00" reserved as empty).
  for (let i = 0; i < sorted.length; i++) {
    idToHex.set(sorted[i], (i + 1).toString(16).padStart(2, '0').toUpperCase());
  }

  const requested = characterIds.slice(0, 10);
  const slots: string[] = [];
  let recognised = 0;
  for (const cid of requested) {
    const hex = idToHex.get(cid);
    if (hex) {
      slots.push(hex);
      recognised++;
    } else {
      slots.push('00');
    }
  }
  while (slots.length < 10) slots.push('00');

  return {
    code: '01' + slots.join('') + `TFTSet${setNumber}`,
    recognised,
    total: requested.length,
  };
}
