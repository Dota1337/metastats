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
import { patchForDay, startsFor } from './tft-patch-day.mjs';
import { currentWindowDay } from './tft-crawl-window.mjs';

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
 * Patch eines einzelnen Spiels, aus Spielzeit und Riots Terminplan.
 *
 * Riots game_version traegt seit Set 18 keine Nummer mehr, also gilt dieselbe
 * Tagesregel wie bei den Sammlern: Sammeltag = Spielzeit − 5 h (Fenster ab
 * 05:00 UTC), Name per patchForDay mit der Set des Spiels. Leer, wenn die Zeit
 * oder Set fehlt, der Terminplan den Tag nicht kennt (Rueckfall) oder die Set
 * an dem Tag schon abgeloest war (Revival-Spiele laufen nicht nach dem Plan).
 */
export function tftPatchForGame(gameMs: number | null | undefined, setNumber: number | null | undefined): string {
  if (typeof gameMs !== 'number' || !Number.isFinite(gameMs) || gameMs <= 0) return '';
  const set = Number(setNumber);
  if (!Number.isInteger(set) || set <= 0) return '';
  const day = currentWindowDay(new Date(gameMs));
  const r = patchForDay(day, tftSet, set);
  if (r.source === 'fallback' || !r.patch) return '';
  const next = startsFor(tftSet, set + 1)[0];
  if (next && next.from_day <= day) return '';
  return r.patch;
}

/**
 * The label your "current patch" display should use — exactly the value
 * shipped in tft-set.json, no derivation needed.
 */
export function currentTftPatch(): string | undefined {
  return META.latestPatch;
}
