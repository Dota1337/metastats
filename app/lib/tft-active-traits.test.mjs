// Aktive Traits einer Comp (tft-active-traits.ts). Anlass 27.10.2026: der
// Hinweis „noch N für nächste Stufe“ sprang zum naechsthoeheren Style statt
// zur naechsten Schwelle — Elderwood 7 zeigte „noch 4“ statt „noch 2“, Riftbeast
// 7–9 und Inferno 5–6 gar nichts (15 von 122 Zustaenden in Set 18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeActiveTraits } from './tft-active-traits.ts';

// Stufen wie Set 18 (Bundle-Styles 1/3/4/5/6), auf das Noetige gekuerzt.
const TIERS = {
  Elderwood: [[3, 1], [5, 3], [7, 5], [9, 5], [11, 6]],
  Riftbeast: [[3, 1], [5, 3], [7, 5], [10, 5]],
  Hunter: [[2, 1], [3, 3], [4, 3], [5, 5]],
};
const bundle = {
  champions: Object.fromEntries(
    Object.keys(TIERS).flatMap((name) =>
      Array.from({ length: 11 }, (_, i) => [`${name}${i}`, { name: `${name}${i}`, traits: [name] }]),
    ),
  ),
  traits: Object.fromEntries(
    Object.entries(TIERS).map(([name, tiers]) => [
      `T_${name}`,
      { name, icon: null, tiers: tiers.map(([minUnits, style]) => ({ minUnits, style })) },
    ]),
  ),
};
const units = (name, n) => Array.from({ length: n }, (_, i) => ({ characterId: `${name}${i}` }));
const hint = (name, n) => {
  const [t] = computeActiveTraits(units(name, n), '', bundle);
  return t.nextStyleMinUnits == null ? null : t.nextStyleMinUnits - t.count;
};

test('naechste Stufe = naechste Schwelle, auch bei gleichem Style', () => {
  assert.equal(hint('Elderwood', 7), 2);
  assert.equal(hint('Elderwood', 8), 1);
  assert.equal(hint('Elderwood', 9), 2);
  assert.equal(hint('Hunter', 3), 1);
});

test('letzte Schwelle gleichen Styles wird noch angezeigt, ganz oben nichts mehr', () => {
  assert.equal(hint('Riftbeast', 7), 3);
  assert.equal(hint('Riftbeast', 9), 1);
  assert.equal(hint('Riftbeast', 10), null);
  assert.equal(hint('Elderwood', 11), null);
});

test('Stufe und Farbe bleiben am hoechsten erreichten Style', () => {
  const [e7] = computeActiveTraits(units('Elderwood', 7), '', bundle);
  assert.equal(e7.style, 5);
  assert.equal(e7.tier, 'gold');
  assert.equal(e7.minUnits, 7);
  const [e9] = computeActiveTraits(units('Elderwood', 9), '', bundle);
  assert.equal(e9.minUnits, 9);
  assert.equal(e9.tier, 'gold');
});
