// Adresse des TFT-Vergleichs: `p=Name#Tag` (alter Link, gemeinsame Region) und
// `p=Name#Tag@kr` (Server aus einem Vorschlag). Hin- und Rueckweg muessen
// verlustfrei sein, alte Links unveraendert gelten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCompareParam, compareParam } from './model.ts';

test('parseCompareParam: alter Link ohne Server', () => {
  assert.deepEqual(parseCompareParam('Dish Soap#UWU'), { text: 'Dish Soap#UWU', region: null });
  assert.deepEqual(parseCompareParam('  Dish Soap#UWU '), { text: 'Dish Soap#UWU', region: null });
  assert.deepEqual(parseCompareParam('Dish Soap'), { text: 'Dish Soap', region: null });
});

test('parseCompareParam: Server-Zusatz', () => {
  assert.deepEqual(parseCompareParam('Faker#KR1@kr'), { text: 'Faker#KR1', region: 'kr' });
  assert.deepEqual(parseCompareParam('X#KR 1@KR'), { text: 'X#KR 1', region: 'kr' });
  assert.deepEqual(parseCompareParam('Bob#EUW@eun1'), { text: 'Bob#EUW', region: 'eun1' });
});

test('parseCompareParam: unbekannter Zusatz bleibt Teil des Namens', () => {
  assert.deepEqual(parseCompareParam('a@b#EUW'), { text: 'a@b#EUW', region: null });
  assert.deepEqual(parseCompareParam('Bob#EUW@mars'), { text: 'Bob#EUW@mars', region: null });
  assert.deepEqual(parseCompareParam('@kr'), { text: '@kr', region: null });
});

test('compareParam: Rueckweg', () => {
  for (const f of [
    { text: 'Faker#KR1', region: 'kr' },
    { text: 'X#KR 1', region: 'kr' },
    { text: 'Dish Soap#UWU', region: null },
  ]) {
    assert.deepEqual(parseCompareParam(compareParam(f)), f);
  }
  assert.equal(compareParam({ text: ' Bob#EUW ', region: null }), 'Bob#EUW');
});
