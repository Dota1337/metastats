import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStopAt, msUntilUtc } from './stop-at.mjs';

const MIN = 60_000;

test('parseStopAt: gueltige Uhrzeiten', () => {
  assert.deepEqual(parseStopAt('05:15'), { h: 5, min: 15 });
  assert.deepEqual(parseStopAt('00:00'), { h: 0, min: 0 });
  assert.deepEqual(parseStopAt('23:59'), { h: 23, min: 59 });
});

test('parseStopAt: ungueltig ergibt null', () => {
  for (const s of ['5:15', '24:00', '05:60', '0515', 'abc', '', undefined, null, '05:15:00']) {
    assert.equal(parseStopAt(s), null, String(s));
  }
});

test('msUntilUtc: Start am Abend endet am naechsten Morgen', () => {
  const now = new Date('2026-10-05T17:09:00Z');
  assert.equal(msUntilUtc({ h: 5, min: 15 }, now), (12 * 60 + 6) * MIN);
});

test('msUntilUtc: Start in der Nacht endet am selben Morgen', () => {
  const now = new Date('2026-10-06T02:00:00Z');
  assert.equal(msUntilUtc({ h: 5, min: 15 }, now), (3 * 60 + 15) * MIN);
});

test('msUntilUtc: Start nach der Grenze zielt auf morgen', () => {
  const now = new Date('2026-10-06T05:20:00Z');
  assert.equal(msUntilUtc({ h: 5, min: 15 }, now), (24 * 60 - 5) * MIN);
});

test('msUntilUtc: genau auf der Grenze zielt auf morgen', () => {
  const now = new Date('2026-10-06T05:15:00Z');
  assert.equal(msUntilUtc({ h: 5, min: 15 }, now), 24 * 60 * MIN);
});

test('msUntilUtc: ueber den Monatswechsel', () => {
  const now = new Date('2026-10-31T22:00:00Z');
  assert.equal(msUntilUtc({ h: 5, min: 15 }, now), (7 * 60 + 15) * MIN);
});
