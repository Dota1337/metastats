// User-facing TFT patch label for a stored patch name.
//
// Seit 06.10.2026 benennen die Sammler jeden Tag nach Riots TFT-Terminplan
// (patchForDay in scripts/lib/tft-patch-day.mjs), die Datenbank traegt also
// nur noch TFT-Namen ("18.5c", "17.9"). Riots game_version hat seit Set 18
// keine Nummer mehr ("TFT Unreal Version ?.?.?.?").
//
// Die fruehere Umrechnung LoL → TFT per Offset gegen lolPatch/latestPatch ist
// am 12.11.2026 entfallen: kein Aufrufer lieferte mehr LoL-Nummern, zweiteilige
// LoL- und TFT-Namen sind nicht unterscheidbar ("17.1" = LoL Januar 2027 oder
// Set 17), und TFT und LoL patchen ab Set 19 nicht mehr am selben Tag. Die
// LoL-Rechnung lebt nur noch in scripts/lib/tft-patch-day.mjs.

import tftSet from '../../public/tft-set.json';

interface SetMeta {
  setNumber: number;
  latestPatch?: string;
}

const META: SetMeta = tftSet;

/**
 * Normalise a stored patch label for display.
 *
 *   - Label of the running set → "set.minor" plus a "b"/"c" hotfix suffix
 *     ("18.5c" stays "18.5c")
 *   - Everything else (earlier sets, "Unreal", LoL versions) → unchanged
 */
export function tftPatchLabel(rawPatch: string | undefined | null): string {
  if (!rawPatch) return '';
  const setNumber = META.setNumber;
  if (!setNumber) return rawPatch;

  const m = String(rawPatch).match(/^(\d+)\.(\d+)([a-z])?/i);
  if (!m || Number(m[1]) !== setNumber) return rawPatch;
  return `${Number(m[1])}.${Number(m[2])}${m[3] || ''}`;
}

/**
 * The label your "current patch" display should use — exactly the value
 * shipped in tft-set.json, no derivation needed.
 */
export function currentTftPatch(): string | undefined {
  return META.latestPatch;
}
