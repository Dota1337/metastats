// Weiterleitung: die Tagesregel liegt seit 12.11.2026 in app/lib/tft-patch-day.mjs
// (Box-Skripte und Spielseite teilen sie). Hier bleibt nur die LoL-Rechnung,
// die die App nicht braucht (detect-tft-set.mjs, Vertrag tft-patch/lol-verschiebung).

export * from '../../app/lib/tft-patch-day.mjs';
import { baseOf } from '../../app/lib/tft-patch-day.mjs';

// LoL-Patch, an dem jede Set "Minor 0" hat: LoL anchor.N+k = TFT set.k.
// Set 17 "Space Gods": TFT 17.1 = LoL 16.8 (Go-Live 2026-04-15).
// Set 18 "Enchanted Wilds": TFT 18.1 = LoL 16.17 (Go-Live 2026-08-26).
// Nur fuer Sets, deren Patches am selben Tag wie LoL kommen. Ab Set 19 nicht
// mehr (Riot: TFT 19.1 am 01.12.2026, LoL 26.24 am 09.12.2026) — dort KEINEN
// Wert raten; ohne Eintrag liefert lolPatchFor null und tft-set.json traegt
// lolPatch null (nur Diagnose). Den Patch-Namen bestimmt der Terminplan.
// Alte Eintraege nicht loeschen — Verlaufsseiten brauchen sie.
export const SET_LAUNCH_LOL = {
  17: '16.7',
  18: '16.16',
};

const LOL_PATCHES_PER_YEAR = 24;

/** TFT-Basis -> LoL-Patch derselben Woche ("18.3" -> "16.19"), sonst null. */
export function lolPatchFor(tftBase) {
  const b = baseOf(tftBase);
  if (!b) return null;
  const [set, minor] = b.split('.').map(Number);
  const anchor = SET_LAUNCH_LOL[set];
  if (!anchor || minor < 1) return null;
  const [aMaj, aMin] = anchor.split('.').map(Number);
  const total = aMin + minor;
  // LoL hat 24 Patches je Jahr (ddragon: 2021 und 2023–2025 je 24, 2022 nur 23).
  // Ueber die Jahresgrenze wird nicht geraten — den ersten Patch des neuen
  // Jahres kennt erst Riots Terminplan.
  return total <= LOL_PATCHES_PER_YEAR ? `${aMaj}.${total}` : null;
}

/** LoL-Version -> TFT-Basis der Set ("16.19.1", 18 -> "18.3"), sonst null. */
export function tftBaseFromLol(lolVersion, setNumber) {
  const anchor = SET_LAUNCH_LOL[setNumber];
  const m = String(lolVersion ?? '').match(/^(\d+)\.(\d+)/);
  if (!anchor || !m) return null;
  const [aMaj, aMin] = anchor.split('.').map(Number);
  // Nur innerhalb des Anker-Jahres, Gegenstueck zu lolPatchFor.
  if (Number(m[1]) !== aMaj) return null;
  const minor = Number(m[2]) - aMin;
  return minor >= 1 && Number(m[2]) <= LOL_PATCHES_PER_YEAR ? `${setNumber}.${minor}` : null;
}
