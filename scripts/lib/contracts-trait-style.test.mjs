// Tests fuer den Vertrag trait-style-axis (scripts/lib/contracts.mjs). Nur die
// reine Bewertung; die Box-Abfrage laeuft nur auf der Box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTraitStyleAxis } from './contracts.mjs';

const EXPECTED = { 1: 1, 2: 3, 3: 4, 4: 5, 5: 6 };
const BUNDLE = { Elderwood: [1, 3, 5, 5, 6], Unique: [4], Eclipse: [] };
const tiersOf = (name) => BUNDLE[name];
const row = (name, tier, style, n) => ({ name, tier, style, n });

test('trait-style-axis: alles wie erwartet = gruen, Traits ohne Stufen zaehlen nicht', () => {
  const r = evaluateTraitStyleAxis({
    rows: [row('Elderwood', 1, 1, 400), row('Elderwood', 4, 4, 100), row('Unique', 1, 3, 100), row('Eclipse', 1, 6, 50)],
    tiersOf, expected: EXPECTED,
  });
  assert.equal(r.status, 'ok');
  assert.match(r.detail, /^600\/600 /);
});

test('trait-style-axis: Riot zaehlt um = rot, mit den haeufigsten Abweichungen', () => {
  // Riot zaehlt Silber ploetzlich als 3 (wie das Bundle) → Silber-Zeilen passen nicht mehr.
  const r = evaluateTraitStyleAxis({
    rows: [row('Elderwood', 1, 1, 500), row('Elderwood', 2, 3, 100)],
    tiersOf, expected: EXPECTED,
  });
  assert.equal(r.status, 'broken');
  assert.match(r.detail, /Riot 3 → Bundle 3: 100×/);
});

test('trait-style-axis: Stufe jenseits der Bundle-Stufen zaehlt als Abweichung', () => {
  const r = evaluateTraitStyleAxis({ rows: [row('Unique', 2, 4, 600)], tiersOf, expected: EXPECTED });
  assert.equal(r.status, 'broken');
  assert.match(r.detail, /keine Stufe/);
});

test('trait-style-axis: zu kleine Stichprobe = gelb, unbekannte Traits werden genannt', () => {
  const r = evaluateTraitStyleAxis({
    rows: [row('Elderwood', 1, 1, 10), row('NeuerTrait', 1, 1, 7)],
    tiersOf, expected: EXPECTED,
  });
  assert.equal(r.status, 'warn');
  assert.match(r.detail, /7 ohne Bundle-Eintrag/);
});
