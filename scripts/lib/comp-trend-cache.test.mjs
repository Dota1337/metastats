import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_CACHE_AGE_MS, MAX_OLD_REFRESH, RECENT_DAYS,
  dayFingerprint, daysToLoad, pruneCache, readCache, stateDir, writeCache,
} from './comp-trend-cache.mjs';

const DAY = 86_400_000;
const days = Array.from({ length: 10 }, (_, i) => `2026-11-${String(10 + i).padStart(2, '0')}`);

test('stateDir: systemd-Variable zuerst, erster Eintrag', () => {
  assert.equal(stateDir({ STATE_DIRECTORY: '/var/lib/a:/var/lib/b' }), '/var/lib/a');
  assert.equal(stateDir({ COMP_TREND_STATE_DIR: '/x' }), '/x');
  assert.equal(stateDir({}), '/var/lib/metastats-comp-trend');
});

test('daysToLoad: fehlende, letzte Tage und geaenderte Abdruecke', () => {
  const now = Date.now();
  const fp = new Map(days.map((d) => [d, dayFingerprint(100, 1000)]));
  const cache = new Map(days.map((d) => [d, { fp: dayFingerprint(100, 1000), savedAt: now - DAY }]));
  assert.deepEqual([...daysToLoad(days, fp, cache, now)], days.slice(-RECENT_DAYS));
  cache.delete(days[0]);
  fp.set(days[2], dayFingerprint(100, 1001)); // Summe Spiele geaendert, Zeilenzahl gleich
  assert.deepEqual([...daysToLoad(days, fp, cache, now)].sort(), [days[0], days[2], ...days.slice(-RECENT_DAYS)].sort());
  // Tag ohne Zeilen in der DB, im Speicher noch mit Zeilen -> neu
  fp.delete(days[3]);
  assert.ok(daysToLoad(days, fp, cache, now).has(days[3]));
});

test('daysToLoad: alte Tage gestaffelt, aelteste zuerst', () => {
  const now = Date.now();
  const fp = new Map(days.map((d) => [d, dayFingerprint(1, 1)]));
  const cache = new Map(days.map((d, i) => [d, { fp: dayFingerprint(1, 1), savedAt: now - MAX_CACHE_AGE_MS - (100 - i) * 1000 }]));
  const load = [...daysToLoad(days, fp, cache, now)];
  const old = load.filter((d) => !days.slice(-RECENT_DAYS).includes(d));
  assert.deepEqual(old, days.slice(0, MAX_OLD_REFRESH));
  // Uhr zurueckgestellt (savedAt in der Zukunft) gilt als alt
  const future = new Map([[days[0], { fp: dayFingerprint(1, 1), savedAt: now + 3600_000 }]]);
  assert.ok(daysToLoad(days.slice(0, 5), fp, future, now).has(days[0]));
});

test('Ablage: schreiben, lesen, kaputte Dateien und Aufraeumen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'comp-trend-cache-'));
  try {
    writeCache(dir, days[0], 'x', [['euw1', 'master', 'A', 1, 2, 1, 0]]);
    writeCache(dir, days[1], 'y', []);
    writeFileSync(join(dir, `day-${days[2]}.json`), '{kaputt');
    writeFileSync(join(dir, `day-${days[3]}.json`), JSON.stringify({ day: days[4], fp: 'z', savedAt: 1, rows: [] }));
    writeFileSync(join(dir, `day-${days[5]}.json.1234`), 'rest');
    const c = readCache(dir, days);
    assert.deepEqual([...c.keys()], [days[0], days[1]]);
    assert.deepEqual(c.get(days[0]).rows, [['euw1', 'master', 'A', 1, 2, 1, 0]]);
    pruneCache(dir, new Set([days[1]]));
    assert.deepEqual(readdirSync(dir).sort(), [`day-${days[1]}.json`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
