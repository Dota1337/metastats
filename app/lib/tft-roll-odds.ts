// Reine Rechnung hinter /tft/tools/odds: wie wahrscheinlich eine bestimmte
// Einheit im Laden auftaucht und was sie im Schnitt kostet.
//
// Bewusst ohne React und ohne Dateizugriff, damit sie getestet werden kann —
// die Randfaelle dieser Funktion waren am 2026-09-25 der Grund fuer vier
// kaputte Anzeigen ("637,8 %", "Infinity%", "NaN%", "0.0 Rolls").
// Tests: app/lib/tft-roll-odds.test.mjs

import type { UniqueChampsPerCost, CostTier } from './tft-shop-pool';

export type { UniqueChampsPerCost, CostTier };

// [Kosten 1..5] in % pro Shop-Slot.
// Quelle: esportstales.com/teamfight-tactics/champion-pool-size-and-draw-chances
// ("Last Updated: August 27, 2026", Set 18 Enchanted Wilds), abgerufen
// 2026-09-25, Level 8 gegengeprueft ueber metatft.com/tables/shop-odds.
// Die Level 7/8/9 standen bis dahin auf Set-17-Werten — bei Level 8 waren das
// 24 % statt 30 % fuer 4-Kosten, also rund ein Viertel zu viele Rolls.
// Riot legt diese Tabelle nirgends maschinenlesbar ab; sie bleibt handgepflegt
// und muss bei jedem Set-Wechsel gegen die Quelle geprueft werden.
// Level 10 ist das Ende: hoehere Stufen sind nicht kaufbar (User 2026-09-25).
// Mehr als 10 Einheiten aufs Feld kommen ueber Spielmechaniken, nicht ueber
// gekaufte Erfahrung — eine Zeile 11 gehoert hier deshalb nicht hin.
export const SHOP_ODDS: Record<number, [number, number, number, number, number]> = {
  2:  [100,  0,  0,  0,  0],
  3:  [ 75, 25,  0,  0,  0],
  4:  [ 55, 30, 15,  0,  0],
  5:  [ 45, 33, 20,  2,  0],
  6:  [ 30, 40, 25,  5,  0],
  7:  [ 16, 30, 43, 10,  1],
  8:  [ 15, 20, 32, 30,  3],
  9:  [ 10, 17, 25, 33, 15],
  10: [  5, 10, 20, 40, 25],
};

// Kopien je Einheit in der gemeinsamen Tuete. Set 18 unveraendert gegenueber
// Set 17, geprueft an derselben esportstales-Quelle am 2026-09-25.
export const BAG_SIZE: Record<number, number> = { 1: 30, 2: 25, 3: 18, 4: 10, 5: 9 };

export const SHOP_SLOTS = 5;
export const ROLL_COST_GOLD = 2;

export const clampInt = (v: number, lo: number, hi: number): number =>
  !Number.isFinite(v) ? lo : Math.min(Math.max(Math.round(v), lo), Math.max(lo, hi));

export interface RollOddsInputs {
  cost: CostTier;
  level: number;
  copiesOwned: number;
  copiesContested: number; // Kopien der gesuchten Einheit bei Mitspielern
  othersOut: number;       // andere Einheiten derselben Kostenstufe, schon aus dem Pool
  uniqueChamps: UniqueChampsPerCost;
}

export interface RollOddsOutputs {
  totalPoolForCost: number;
  poolLeft: number;
  copiesLeft: number;
  pCostPerSlot: number;          // Chance auf irgendeine Einheit dieser Kosten pro Slot
  pSpecificPerSlot: number;      // Chance auf genau diese Einheit pro Slot
  pSpecificPerShop: number;      // Chance auf >=1 Exemplar in einem 5-Slot-Shop
  expectedRollsToNextHit: number;
  expectedGoldToNextHit: number;
  copiesTo2Star: number;
  copiesTo3Star: number;
  expectedRollsTo2Star: number | null;
  expectedRollsTo3Star: number | null;
  expectedGoldTo2Star: number | null;
  expectedGoldTo3Star: number | null;
}

/** Obergrenze fuer den Regler „andere Einheiten dieser Kosten schon weg". */
export function maxOthersOut(cost: CostTier, uniqueChamps: UniqueChampsPerCost): number {
  return Math.max(0, BAG_SIZE[cost] * (uniqueChamps[cost] || 0) - BAG_SIZE[cost]);
}

export function computeRollOdds(
  { cost, level, copiesOwned, copiesContested, othersOut, uniqueChamps }: RollOddsInputs,
): RollOddsOutputs {
  const odds = SHOP_ODDS[level] || SHOP_ODDS[8];
  const pCostPerSlot = (odds[cost - 1] || 0) / 100;
  const bagPerChamp = BAG_SIZE[cost];
  const uniqueAtCost = uniqueChamps[cost] || 0;
  const totalPoolForCost = bagPerChamp * uniqueAtCost;

  // Die Eingaben werden hier ein zweites Mal geklemmt. Die Oberflaeche klemmt
  // schon, aber ein ungeklemmter Wert erzeugt hier keinen kleinen Fehler,
  // sondern Anzeigen wie "637,8 %", "Infinity%" und "NaN%" — alle vier am
  // 2026-09-25 mit dem alten Stand reproduziert.
  const owned = clampInt(copiesOwned, 0, bagPerChamp);
  const contested = clampInt(copiesContested, 0, bagPerChamp - owned);
  const others = clampInt(othersOut, 0, Math.max(0, totalPoolForCost - bagPerChamp));

  const copiesLeft = Math.max(0, bagPerChamp - owned - contested);
  // Jede gekaufte Kopie verlaesst den gemeinsamen Pool — Zaehler UND Nenner
  // schrumpfen. Bis 2026-09-25 schrumpfte nur der Zaehler, die Seite war
  // dadurch systematisch zu pessimistisch.
  // Der Nenner kann nie kleiner werden als der Zaehler; das haelt den Bruch
  // unter 1 und damit die Wahrscheinlichkeit unter der Kosten-Chance.
  const poolLeft = Math.max(copiesLeft, totalPoolForCost - others - owned - contested);

  const pChampGivenCost = poolLeft > 0 ? copiesLeft / poolLeft : 0;
  const pSpecificPerSlot = Math.min(pCostPerSlot, pCostPerSlot * pChampGivenCost);
  const pSpecificPerShop = 1 - Math.pow(1 - pSpecificPerSlot, SHOP_SLOTS);
  // Ist keine Kopie mehr im Pool, ist die Erwartung unendlich — das ist die
  // richtige Aussage ("kommt nicht mehr"), nicht NaN.
  const expectedRollsToNextHit = pSpecificPerShop > 0 ? 1 / pSpecificPerShop : Infinity;
  const expectedGoldToNextHit = expectedRollsToNextHit * ROLL_COST_GOLD;

  const copiesTo2Star = Math.max(0, 3 - owned);
  const copiesTo3Star = Math.max(0, 9 - owned);

  // Jeder Treffer nimmt eine Kopie aus dem Pool: Zaehler und Nenner sinken
  // gemeinsam. Reicht der Pool nicht, gibt es keine Erwartung — null, nicht 0.
  function expectedRollsToHit(needed: number): number | null {
    if (needed === 0) return 0;
    let rolls = 0;
    let left = copiesLeft;
    let pool = poolLeft;
    for (let k = 0; k < needed; k++) {
      if (left <= 0 || pool <= 0) return null;
      const pSlot = Math.min(pCostPerSlot, pCostPerSlot * (left / pool));
      const pShop = 1 - Math.pow(1 - pSlot, SHOP_SLOTS);
      if (!(pShop > 0)) return null;
      rolls += 1 / pShop;
      left -= 1;
      pool -= 1;
    }
    return rolls;
  }
  const r2 = expectedRollsToHit(copiesTo2Star);
  const r3 = expectedRollsToHit(copiesTo3Star);

  return {
    totalPoolForCost,
    poolLeft,
    copiesLeft,
    pCostPerSlot,
    pSpecificPerSlot,
    pSpecificPerShop,
    expectedRollsToNextHit,
    expectedGoldToNextHit,
    copiesTo2Star,
    copiesTo3Star,
    expectedRollsTo2Star: r2,
    expectedRollsTo3Star: r3,
    expectedGoldTo2Star: r2 == null ? null : r2 * ROLL_COST_GOLD,
    expectedGoldTo3Star: r3 == null ? null : r3 * ROLL_COST_GOLD,
  };
}
