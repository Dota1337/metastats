/**
 * Randfaelle des Roll-Rechners. Sie sind der Grund, warum die Rechnung
 * ueberhaupt aus der Oberflaeche herausgeloest wurde: der lokale
 * Entwicklungsserver hydriert in dieser Umgebung nicht (auch unveraenderte
 * Seiten wie /tft/comps bleiben tot), Durchklicken faellt also aus.
 *
 * Geprueft wird vor allem, dass NIE eine unsinnige Anzeige entstehen kann —
 * kein NaN, keine Wahrscheinlichkeit ueber 100 %, keine Erwartung von 0 Rolls
 * fuer etwas, das noch nicht erreicht ist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRollOdds, maxOthersOut, BAG_SIZE, SHOP_ODDS } from './tft-roll-odds.ts';

// Set 18, abgeleitet aus public/tft-assets-18.json (siehe app/lib/tft-shop-pool.ts).
const UNIQUE = { 1: 14, 2: 13, 3: 14, 4: 14, 5: 10 };

const base = (over = {}) => computeRollOdds({
  cost: 4, level: 8, copiesOwned: 0, copiesContested: 0, othersOut: 0,
  uniqueChamps: UNIQUE, ...over,
});

function assertSane(o, label) {
  for (const [k, v] of Object.entries(o)) {
    if (v === null) continue;
    assert.ok(!Number.isNaN(v), `${label}: ${k} ist NaN`);
  }
  for (const k of ['pCostPerSlot', 'pSpecificPerSlot', 'pSpecificPerShop']) {
    assert.ok(o[k] >= 0 && o[k] <= 1, `${label}: ${k} ausserhalb 0..1 (${o[k]})`);
  }
  assert.ok(o.poolLeft >= o.copiesLeft, `${label}: Nenner kleiner als Zaehler`);
}

test('voller Pool: Nenner ist die volle Tuete, Chance unter der Kosten-Chance', () => {
  const o = base();
  assert.equal(o.totalPoolForCost, BAG_SIZE[4] * UNIQUE[4]); // 140
  assert.equal(o.poolLeft, 140);
  assert.equal(o.copiesLeft, 10);
  assert.equal(o.pCostPerSlot, 0.30);
  // 30 % * 10/140 pro Slot, ueber 5 Slots
  assert.ok(Math.abs(o.pSpecificPerSlot - 0.3 * (10 / 140)) < 1e-12);
  assert.ok(Math.abs(o.pSpecificPerShop - (1 - (1 - 0.3 * (10 / 140)) ** 5)) < 1e-12);
  assertSane(o, 'voller Pool');
});

test('Regler „andere weg" hebt die Chance, weil der Nenner mitschrumpft', () => {
  const voll = base();
  const leer = base({ othersOut: maxOthersOut(4, UNIQUE) }); // 130
  assert.equal(maxOthersOut(4, UNIQUE), 130);
  assert.equal(leer.poolLeft, 10);
  assert.ok(leer.pSpecificPerShop > voll.pSpecificPerShop);
  // Nur noch die gesuchte Einheit im Pool → pro Slot die volle Kosten-Chance.
  assert.ok(Math.abs(leer.pSpecificPerSlot - 0.30) < 1e-12);
  assertSane(leer, 'andere weg');
});

test('eigene Kopien schrumpfen Zaehler UND Nenner', () => {
  const o = base({ copiesOwned: 4 });
  assert.equal(o.copiesLeft, 6);
  assert.equal(o.poolLeft, 136); // 140 - 4, nicht 140
  assertSane(o, 'eigene Kopien');
});

test('alle Kopien weg: Wahrscheinlichkeit 0, Erwartung unendlich statt NaN', () => {
  const o = base({ copiesOwned: 2, copiesContested: 8 });
  assert.equal(o.copiesLeft, 0);
  assert.equal(o.pSpecificPerSlot, 0);
  assert.equal(o.pSpecificPerShop, 0);
  assert.equal(o.expectedRollsToNextHit, Infinity);
  assert.equal(o.expectedGoldToNextHit, Infinity);
  assert.equal(o.expectedRollsTo2Star, null);
  assert.equal(o.expectedRollsTo3Star, null);
  assert.equal(o.expectedGoldTo2Star, null);
  assertSane(o, 'Pool leer');
});

test('erreichter Stern kostet 0 Rolls, offener Stern nie 0', () => {
  const drei = base({ copiesOwned: 3 });
  assert.equal(drei.copiesTo2Star, 0);
  assert.equal(drei.expectedRollsTo2Star, 0);
  assert.ok(drei.expectedRollsTo3Star > 0);
  const neun = base({ copiesOwned: 9 });
  assert.equal(neun.copiesTo3Star, 0);
  assert.equal(neun.expectedRollsTo3Star, 0);
});

test('3-Stern kostet mehr als 2-Stern, weil der Pool mitschrumpft', () => {
  const o = base();
  assert.ok(o.expectedRollsTo3Star > o.expectedRollsTo2Star);
  // 9 Kopien aus einer Tuete von 10: der letzte Treffer ist der teuerste,
  // die Summe liegt deutlich ueber dem Neunfachen des ersten.
  assert.ok(o.expectedRollsTo3Star > 9 * o.expectedRollsToNextHit);
});

test('ungeklemmte Eingaben koennen nichts kaputt machen', () => {
  const faelle = [
    { copiesOwned: 999 },
    { copiesContested: 999 },
    { othersOut: 99999 },
    { copiesOwned: -5, copiesContested: -5, othersOut: -5 },
    { copiesOwned: NaN },
    { othersOut: Infinity },
    { level: 99 },
    { copiesOwned: 7, copiesContested: 7 }, // Summe ueber der Tuete
  ];
  for (const f of faelle) assertSane(base(f), JSON.stringify(f));
});

test('jede Kostenstufe auf jedem Level bleibt plausibel', () => {
  for (const cost of [1, 2, 3, 4, 5]) {
    for (const level of Object.keys(SHOP_ODDS).map(Number)) {
      for (const othersOut of [0, 5, maxOthersOut(cost, UNIQUE)]) {
        assertSane(base({ cost, level, othersOut }), `cost ${cost} level ${level} others ${othersOut}`);
      }
    }
  }
});

test('Shop-Chancen ergeben je Level 100 Prozent', () => {
  for (const [lvl, odds] of Object.entries(SHOP_ODDS)) {
    assert.equal(odds.reduce((a, b) => a + b, 0), 100, `Level ${lvl}`);
  }
});
