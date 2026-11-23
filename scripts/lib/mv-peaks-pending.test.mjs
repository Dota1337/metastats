import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HEARTBEAT_MAX_AGE_MS, PENDING_MAX_PLAYERS, WINDOW_EVERY_MS, decidePeaksMode, readHeartbeat, readPending,
  readWindowMark, writeHeartbeat, writePending, writeWindowMark,
} from './mv-peaks-pending.mjs';

const H = 3_600_000;
const NOW = Date.parse('2026-11-23T03:15:00Z');
const iso = (ms) => new Date(ms).toISOString();
const base = (over = {}) => ({
  enabled: true,
  stateDir: '/var/lib/metastats-mv-sync',
  heartbeat: { at: iso(NOW - 2 * H) },
  windowMark: { at: iso(NOW - 6 * H), set: 18 },
  set: 18,
  pending: { files: ['f1'], puuids: new Set(['a', 'b']), bad: 0 },
  now: NOW,
  ...over,
});

test('Normalfall: nur Warteliste', () => {
  const d = decidePeaksMode(base());
  assert.equal(d.mode, 'pending');
  assert.match(d.reason, /2 Spieler aus 1/);
});

test('leere Warteliste → uebersprungen', () => {
  assert.equal(decidePeaksMode(base({ pending: { files: ['f'], puuids: new Set(), bad: 0 } })).mode, 'skip');
  assert.equal(decidePeaksMode(base({ pending: { files: [], puuids: new Set(), bad: 0 } })).mode, 'skip');
});

test('jede Stoerung der Absprache → Fenster wie bisher', () => {
  const cases = {
    'Schalter aus': base({ enabled: false }),
    'kein Ordner': base({ stateDir: null }),
    'kein Herzschlag': base({ heartbeat: null }),
    'Herzschlag alt': base({ heartbeat: { at: iso(NOW - HEARTBEAT_MAX_AGE_MS - 1) } }),
    'Herzschlag unlesbar': base({ heartbeat: { at: 'quatsch' } }),
    'nie Fenster gelaufen': base({ windowMark: null }),
    'Fenster faellig': base({ windowMark: { at: iso(NOW - WINDOW_EVERY_MS), set: 18 } }),
    'Set gewechselt': base({ windowMark: { at: iso(NOW - H), set: 17 } }),
    'kaputte Datei': base({ pending: { files: ['f'], puuids: new Set(['a']), bad: 1 } }),
    'zu gross': base({ pending: { files: ['f'], puuids: new Set(Array.from({ length: PENDING_MAX_PLAYERS + 1 }, (_, i) => `p${i}`)), bad: 0 } }),
    'keine Liste gelesen': base({ pending: null }),
  };
  for (const [name, input] of Object.entries(cases)) {
    assert.equal(decidePeaksMode(input).mode, 'window', name);
  }
});

test('Dateien: Warteliste, Herzschlag, Fenster-Marke — Runde und kaputte Liste', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mv-pending-'));
  assert.equal(writePending(dir, new Set(['a', 'b']), { now: 1000, pid: 7 }), true);
  assert.equal(writePending(dir, ['b', 'c', '', null], { now: 2000, pid: 7 }), true);
  assert.equal(writePending(dir, [], { now: 3000, pid: 7 }), true, 'leere Liste wird geschrieben');
  writeFileSync(join(dir, 'pending-4000-7.json.7.tmp'), 'halb'); // halbe tmp-Datei zaehlt nicht
  let r = readPending(dir);
  assert.equal(r.files.length, 3);
  assert.deepEqual([...r.puuids].sort(), ['a', 'b', 'c']);
  assert.equal(r.bad, 0);
  writeFileSync(join(dir, 'pending-5000-7.json'), '{kaputt');
  r = readPending(dir);
  assert.equal(r.bad, 1);
  writeHeartbeat(dir, { complete: true }, { now: NOW });
  assert.equal(readHeartbeat(dir).at, iso(NOW));
  writeWindowMark(dir, 18, { now: NOW });
  assert.deepEqual(readWindowMark(dir), { v: 1, at: iso(NOW), set: 18 });
  assert.deepEqual(readPending(join(dir, 'fehlt')), { files: [], puuids: new Set(), bad: 0 });
});
