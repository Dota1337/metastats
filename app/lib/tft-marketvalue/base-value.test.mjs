// Die Grundwert-Kurve steht zweimal: einmal fuer die Seite (TS), einmal fuer
// die Box-Skripte (MJS). Laufen sie auseinander, zeigt die Seite andere Werte,
// als die Tageswerte speichern. Dieser Test vergleicht beide und haelt die
// Stuetzwerte fest, die der User vorgegeben hat (2026-10-04).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBaseValue as tsBase } from './base-value.ts';
import { computeBaseValue as mjsBase } from '../../../scripts/lib/tft-marketvalue.mjs';

const chall = (lp = 1000) => ({ tier: 'CHALLENGER', rank: 'I', leaguePoints: lp });

test('Stuetzwerte der Challenger-Kurve', () => {
  assert.equal(tsBase(chall(), 1).baseValue, 130000);
  assert.equal(tsBase(chall(), 100).baseValue, 60000);
  assert.equal(tsBase(chall(), 200).baseValue, 45000);
  assert.equal(tsBase(chall(), 300).baseValue, 30000);
  assert.equal(tsBase(chall(), 301).baseValue, 30000);
  assert.equal(tsBase(chall(), 7302).baseValue, 30000);
  assert.equal(tsBase(chall(), undefined).baseValue, 30000);
  assert.equal(tsBase(chall(0), undefined).baseValue, 30000);
});

test('Kurve faellt mit jedem Platz', () => {
  for (let r = 2; r <= 300; r++) {
    assert.ok(tsBase(chall(), r).baseValue < tsBase(chall(), r - 1).baseValue, `Platz ${r}`);
  }
});

test('TS und MJS liefern dieselben Grundwerte', () => {
  const cases = [];
  for (let r = 1; r <= 600; r++) cases.push([chall(), r]);
  cases.push([chall(), undefined], [chall(), 0]);
  for (const lp of [0, 50, 100]) {
    cases.push([{ tier: 'DIAMOND', rank: 'II', leaguePoints: lp }], [{ tier: 'DIAMOND', rank: 'I', leaguePoints: lp }]);
  }
  for (const lp of [0, 100, 200, 400, 900]) {
    cases.push([{ tier: 'MASTER', rank: 'I', leaguePoints: lp }], [{ tier: 'GRANDMASTER', rank: 'I', leaguePoints: lp }]);
  }
  cases.push([{ tier: 'DIAMOND', rank: 'III', leaguePoints: 50 }], [null]);
  for (const [ranked, rank] of cases) {
    assert.deepEqual(mjsBase(ranked, rank), tsBase(ranked, rank), JSON.stringify([ranked, rank]));
  }
});

test('Grandmaster bleibt unveraendert (Obergrenze 12.000)', () => {
  assert.equal(tsBase({ tier: 'GRANDMASTER', rank: 'I', leaguePoints: 400 }).baseValue, 12000);
  assert.equal(tsBase({ tier: 'GRANDMASTER', rank: 'I', leaguePoints: 0 }).baseValue, 4000);
});
