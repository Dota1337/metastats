// Convert a raw match-extracted patch label (Riot's game_version, e.g. "16.10")
// into the user-facing TFT patch label ("17.3"). The TFT crawler stores
// whatever it parsed from the match data, which is usually the LoL patch
// number — but the UI must show the TFT marketing patch users recognise
// from the in-game popup + the patch-notes page.
//
// The mapping is derived from tft-set.json:
//   { lolPatch: "16.10.1", latestPatch: "17.3", setNumber: 17, … }
// Given that anchor we can convert any LoL "X.Y" by offset arithmetic.

import tftSet from '../../public/tft-set.json';

interface SetMeta {
  setNumber: number;
  latestPatch?: string;
  lolPatch?: string;
}

const META: SetMeta = tftSet;

function parseBase(p: string | undefined | null): [number, number] | null {
  if (!p) return null;
  const m = String(p).match(/^(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

/**
 * Convert a stored patch label into the user-facing TFT label.
 *
 * Rules:
 *   - Input already in TFT-form (major === setNumber) → return as-is so
 *     B-patches like "17.2b" survive untouched
 *   - Input looks like a LoL patch (major !== setNumber) → arithmetic
 *     offset against the (lolPatch, latestPatch) anchor in tft-set.json
 *   - Input outside set window → return as-is (probably a Set 16 trailing
 *     match that hasn't expired from the crawl window yet)
 *   - Missing anchor → return as-is (degrade gracefully)
 */
export function tftPatchLabel(rawPatch: string | undefined | null): string {
  if (!rawPatch) return '';
  const setNumber = META.setNumber;
  if (!setNumber) return rawPatch;

  const input = parseBase(rawPatch);
  if (!input) return rawPatch;
  const [inMajor, inMinor] = input;

  // Already TFT-shaped — preserve any "b"/"c" hotfix suffix attached to the
  // raw label (e.g. "17.2b" should display as "17.2b", not "17.2").
  if (inMajor === setNumber) {
    const suffix = String(rawPatch).match(/^\d+\.\d+([a-z])/i)?.[1] || '';
    return `${inMajor}.${inMinor}${suffix}`;
  }

  // Need the anchor for the LoL→TFT offset
  const anchorLol = parseBase(META.lolPatch);
  const anchorTft = parseBase(META.latestPatch);
  if (!anchorLol || !anchorTft) return rawPatch;
  const [anchorLolMajor, anchorLolMinor] = anchorLol;
  const [, anchorTftMinor] = anchorTft;

  // LoL patches roll over at ~25 per major year, but in practice we only
  // need to handle (a) same-major delta and (b) one major back. So just
  // do straight arithmetic with a sanity bound.
  const lolDelta = (inMajor - anchorLolMajor) * 25 + (inMinor - anchorLolMinor);
  const tftMinor = anchorTftMinor + lolDelta;
  if (tftMinor < 1) return rawPatch;     // pre-launch / set-trailer
  if (tftMinor > 30) return rawPatch;    // implausible — keep raw rather than mislead

  return `${setNumber}.${tftMinor}`;
}

/**
 * The label your "current patch" display should use — exactly the value
 * shipped in tft-set.json, no derivation needed.
 */
export function currentTftPatch(): string | undefined {
  return META.latestPatch;
}
