import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOL_BUILDS_MAX_SKIP_MS, RANG_SUMMEN_WINDOW_MS, patchRowsHash, shouldSkipWrite } from './lol-builds-skip.mjs';

const rows = [
  [1, 'TOP', 'DIAMOND', 'total', '', 0, 50, 26],
  [1, 'TOP', 'DIAMOND', 'item', '3078', 1, 20, 11],
  [2, 'MIDDLE', 'MASTER', 'total', '', 0, 30, 14],
];

test('Fingerabdruck haengt nicht an der Reihenfolge, aber an jedem Wert', () => {
  const h = patchRowsHash(rows);
  assert.equal(h, patchRowsHash([rows[2], rows[0], rows[1]]));
  assert.notEqual(h, patchRowsHash([rows[0], rows[1]]));
  const changed = rows.map((r) => [...r]);
  changed[1][7] = 12;
  assert.notEqual(h, patchRowsHash(changed));
  assert.notEqual(patchRowsHash([[1, 'TOP', 'x', 'y', '1', 0, 2, 3]]), patchRowsHash([[1, 'TOP', 'x', 'y', 1, 0, 2, 3]]));
});

test('Auslassen nur bei gleichem Inhalt und juengerem Schreiben', () => {
  const now = Date.parse('2026-11-23T06:20:00Z');
  const h = patchRowsHash(rows);
  const at = (ms) => new Date(now - ms).toISOString();
  assert.equal(shouldSkipWrite({ hash: h, writtenAt: at(6 * 3_600_000) }, h, now), true);
  assert.equal(shouldSkipWrite({ hash: h, writtenAt: at(LOL_BUILDS_MAX_SKIP_MS) }, h, now), false, 'nach 20 h doch schreiben');
  assert.equal(shouldSkipWrite({ hash: 'anders', writtenAt: at(60_000) }, h, now), false);
  assert.equal(shouldSkipWrite(undefined, h, now), false);
  assert.equal(shouldSkipWrite({ hash: h, writtenAt: 'kaputt' }, h, now), false);
  assert.equal(shouldSkipWrite({ hash: h, writtenAt: at(-3_600_000) }, h, now), false, 'Zeit in der Zukunft');
});

test('Pflicht-Schreiben bleibt innerhalb des Vertrags lol-builds/rang-summen (+ ein 6-h-Takt)', () => {
  assert.ok(LOL_BUILDS_MAX_SKIP_MS + 6 * 3_600_000 < RANG_SUMMEN_WINDOW_MS);
});
