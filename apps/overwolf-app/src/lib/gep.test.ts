import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jsonish, parseBoardPieces, parseShop, parseLevel, parseStage, stageToRound,
  parseOpponent, gameTimeToRound, isTftMode,
} from './gep.ts';

test('jsonish nimmt Objekt und JSON-Text, kaputter Text wird null', () => {
  assert.deepEqual(jsonish('{"a":1}'), { a: 1 });
  assert.deepEqual(jsonish({ a: 1 }), { a: 1 });
  assert.equal(jsonish('{kaputt'), null);
  assert.equal(jsonish(''), null);
});

test('parseBoardPieces liest cell_N mit Items und ueberspringt Fremdschluessel', () => {
  const raw = JSON.stringify({
    cell_3: { name: 'DA_18_Tristana', level: '2', item_1: 'A', item_2: '', item_3: 'C' },
    bench_1: { name: 'X' },
    cell_x: { name: 'Y' },
  });
  assert.deepEqual(parseBoardPieces(raw), [{ cell: 3, unit: 'DA_18_Tristana', level: 2, items: ['A', 'C'] }]);
  assert.deepEqual(parseBoardPieces(null), []);
});

test('parseShop liefert immer 5 Plaetze, gekaufte sind leer', () => {
  const shop = parseShop('{"slot_1":{"name":"A"},"slot_3":{"name":""},"slot_5":{"name":"E"},"slot_9":{"name":"Z"}}');
  assert.deepEqual(shop, ['A', null, null, null, 'E']);
  assert.deepEqual(parseShop('nicht json'), [null, null, null, null, null]);
});

test('parseLevel prueft den Bereich', () => {
  assert.equal(parseLevel('{"level":7}'), 7);
  assert.equal(parseLevel({ level: '9' }), 9);
  assert.equal(parseLevel({ level: 0 }), null);
  assert.equal(parseLevel({ level: 11 }), null);
  assert.equal(parseLevel(null), null);
});

test('Stufe und Runde', () => {
  assert.equal(parseStage('{"stage":"3-2","type":"PVP"}'), '3-2');
  assert.equal(parseStage({ stage: 'Carousel' }), null);
  assert.equal(stageToRound('3-2'), 32);
  assert.ok(stageToRound('4-1')! > stageToRound('3-7')!);
  assert.equal(stageToRound(null), null);
});

test('parseOpponent mit und ohne Tag', () => {
  assert.equal(parseOpponent('{"name":"Foo","tag_line":"EUW"}'), 'Foo#EUW');
  assert.equal(parseOpponent({ name: 'Bar' }), 'Bar');
  assert.equal(parseOpponent({}), null);
});

test('gameTimeToRound ist begrenzt und steigt', () => {
  assert.equal(gameTimeToRound(-5), 0);
  assert.equal(gameTimeToRound(NaN), 0);
  assert.equal(gameTimeToRound(70), 2);
  assert.equal(gameTimeToRound(99999), 60);
});

test('isTftMode unterscheidet TFT von Kluft', () => {
  assert.equal(isTftMode('TFT'), true);
  assert.equal(isTftMode('tft'), true);
  assert.equal(isTftMode('LOL'), false);
  assert.equal(isTftMode(''), null);
  assert.equal(isTftMode(undefined), null);
});
