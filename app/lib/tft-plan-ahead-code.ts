// TFT Plan-Ahead-Code generation. Riots in-game Team Planner nimmt einen Code
// entgegen, den der User unter Einstellungen -> Spiel -> Team Planner einfuegt;
// die Comp erscheint dann waehrend der Runde als Cheatsheet-Sidebar.
//
// Format v2 (gemessen 2026-08-27 gegen den ausgelieferten Encoder/Decoder von
// tactics.tools, chunks/5894-ca6660759a9af8fe.js):
//
//   "02" + 10 Slots a 3 Hex-Ziffern + "TFTSet<N>"      (Set 18: 40 Zeichen)
//
// Der Decoder dort prueft exakt: startsWith("02"), endsWith("tftset18"),
// length === 32 + "TFTSet18".length. Leerer Slot ist "000" und wandert ans
// Ende. Der 3-Hex-Wert pro Unit ist Riots `team_planner_code` aus CDragons
// tftchampions-teamplanner.json in Hex — er steht als `plannerCodes` im
// Asset-Bundle (scripts/fetch-tft-assets.mjs).
//
// ACHTUNG bei Set-Bumps: Praefix und Slot-Breite sind KEINE Konstanten der
// Ewigkeit. Set 13 lief noch mit "01" + 2 Hex und einem Alphabet-Index; genau
// dieser alte Pfad hat in Set 18 wortlos einen Leercode geliefert, weil kein
// Champion mehr den Praefix TFT18_ traegt. Bei jedem neuen Set gegen den
// Client-Encoder gegenpruefen, nicht gegen die Erinnerung.
const PLAN_AHEAD_FORMAT = '02';
const SLOT_HEX_WIDTH = 3;
const SLOT_COUNT = 10;
const EMPTY_SLOT = '0'.repeat(SLOT_HEX_WIDTH);

import type { TftAssetsBundle } from './tft-cdragon';

export interface PlanAheadResult {
  code: string;
  recognised: number;   // Units, fuer die ein Planner-Code vorlag
  total: number;        // angefragte Units (vor Padding)
}

// Baut einen Plan-Ahead-Code aus einer Liste von character_ids.
//
// Gibt `null` zurueck, wenn kein Bundle da ist, das Bundle keine
// `plannerCodes` fuehrt, oder keine einzige Unit aufgeloest werden konnte.
// Bewusst kein Teil-Erfolg mit lauter Leerslots: der Button meldet dann
// ehrlich "fehlgeschlagen", statt einen Code zu kopieren, der ingame nichts
// tut. Einzelne unbekannte Units (Neutral-Monster o.ae.) fallen dagegen still
// als Leerslot heraus — der Rest der Comp bleibt nutzbar.
export function buildPlanAheadCode(
  characterIds: string[],
  setNumber: number,
  assets: TftAssetsBundle | null,
): PlanAheadResult | null {
  const codes = assets?.plannerCodes;
  if (!codes) return null;

  const requested = characterIds.slice(0, SLOT_COUNT);
  const slots: string[] = [];
  const seen = new Set<string>();
  for (const cid of requested) {
    const hex = codes[cid];
    // Der Planner kennt kein Kopien-Konzept: eine Unit belegt genau einen Slot.
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    slots.push(hex.toLowerCase().padStart(SLOT_HEX_WIDTH, '0').slice(-SLOT_HEX_WIDTH));
  }
  if (slots.length === 0) return null;

  // Aufsteigend nach Code sortieren und die Leerslots hinten anhaengen — genau
  // das macht der gemessene tactics.tools-Encoder (er sortiert nach seinem
  // eigenen Listen-Index und haengt die "000" ans Ende). Ob der Riot-Client
  // ueberhaupt eine Reihenfolge erwartet, ist UNGEPRUEFT; die Sortierung sorgt
  // vor allem dafuer, dass dieselbe Comp immer denselben Code ergibt.
  slots.sort();
  while (slots.length < SLOT_COUNT) slots.push(EMPTY_SLOT);

  return {
    code: PLAN_AHEAD_FORMAT + slots.join('') + `TFTSet${setNumber}`,
    recognised: seen.size,
    total: requested.length,
  };
}
