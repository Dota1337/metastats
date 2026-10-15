// Uebergabe des Endtags E von der Vorab-Rechnung an den Publisher.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isIsoDay, readDataEndHandoff, writeDataEndHandoff } from './data-end-handoff.mjs';

const dir = mkdtempSync(join(tmpdir(), 'data-end-test-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const file = name => join(dir, name);
const HOUR = 3600 * 1000;

test('isIsoDay: nur echte Kalendertage', () => {
  assert.equal(isIsoDay('2026-10-14'), true);
  for (const s of ['2026-02-30', '2026-13-01', '14.10.2026', '2026-10-14T00:00:00Z', '', null, undefined, 20261014]) {
    assert.equal(isIsoDay(s), false, String(s));
  }
});

test('geschrieben und frisch gelesen: der Tag', () => {
  const p = file('a.json');
  assert.equal(writeDataEndHandoff('2026-10-14', p), true);
  assert.equal(readDataEndHandoff(p), '2026-10-14');
});

test('bewusst ohne Endtag: null bleibt null (nicht undefined)', () => {
  const p = file('b.json');
  writeDataEndHandoff(null, p);
  assert.equal(readDataEndHandoff(p), null);
  writeDataEndHandoff('kaputt', p);
  assert.equal(readDataEndHandoff(p), null);
});

test('fehlende Datei → undefined (Publisher bestimmt selbst)', () => {
  assert.equal(readDataEndHandoff(file('gibt-es-nicht.json')), undefined);
});

test('aelter als 6 h oder aus der Zukunft → undefined', () => {
  const p = file('c.json');
  const now = Date.parse('2026-10-15T20:00:00Z');
  writeFileSync(p, JSON.stringify({ dataEnd: '2026-10-14', at: new Date(now - 7 * HOUR).toISOString() }));
  assert.equal(readDataEndHandoff(p, now), undefined);
  writeFileSync(p, JSON.stringify({ dataEnd: '2026-10-14', at: new Date(now - 5 * HOUR).toISOString() }));
  assert.equal(readDataEndHandoff(p, now), '2026-10-14');
  writeFileSync(p, JSON.stringify({ dataEnd: '2026-10-14', at: new Date(now + 2 * HOUR).toISOString() }));
  assert.equal(readDataEndHandoff(p, now), undefined);
});

test('kaputter Inhalt → undefined', () => {
  const p = file('d.json');
  writeFileSync(p, '{nicht json');
  assert.equal(readDataEndHandoff(p), undefined);
  writeFileSync(p, JSON.stringify({ dataEnd: '2026-10-14' }));
  assert.equal(readDataEndHandoff(p), undefined);
  writeFileSync(p, JSON.stringify({ dataEnd: '14.10.2026', at: new Date().toISOString() }));
  assert.equal(readDataEndHandoff(p), undefined);
});

test('Schreibfehler wird gemeldet, nicht geworfen', () => {
  assert.equal(writeDataEndHandoff('2026-10-14', join(dir, 'fehlt', 'x.json')), false);
});
