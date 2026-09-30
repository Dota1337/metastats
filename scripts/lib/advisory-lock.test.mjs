// Vorfahrt-Marker der LoL-Riot-Sperre. Geprueft mit echten Kindprozessen, weil
// wantPending() gerade den Unterschied "eigener Prozess" vs. "fremder, lebender
// Prozess" ausmacht — ein Test im selben Prozess wuerde das nie sehen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { announceWant, clearWant, wantPending, tryAcquire, releaseLock } from './advisory-lock.mjs';

const LIB = pathToFileURL(join(import.meta.dirname, 'advisory-lock.mjs')).href;

function freshLock() {
  return join(mkdtempSync(join(tmpdir(), 'lol-lock-')), 'riot.lock');
}

// Kindprozess meldet sich an, sagt "ready" und wartet, bis er beendet wird.
function spawnWanter(lock) {
  const code = `import { announceWant } from ${JSON.stringify(LIB)};
announceWant(${JSON.stringify(lock)}); console.log('ready'); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve) => child.stdout.once('data', () => resolve(child)));
}

test('fremder lebender Wartender hat Vorrang', async () => {
  const lock = freshLock();
  assert.equal(wantPending(lock), false, 'ohne Marker kein Vorrang');
  const child = await spawnWanter(lock);
  try {
    assert.equal(wantPending(lock), true);
  } finally {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
  // Toter Prozess: Marker liegt noch, zaehlt aber nicht mehr.
  assert.equal(existsSync(`${lock}.want`), true);
  assert.equal(wantPending(lock), false, 'Marker eines toten Prozesses darf nicht blockieren');
});

test('eigener Marker blockiert nicht, clearWant raeumt nur den eigenen', async () => {
  const lock = freshLock();
  announceWant(lock);
  assert.equal(wantPending(lock), false, 'der Wartende selbst darf nicht vor sich selbst warten');
  clearWant(lock);
  assert.equal(existsSync(`${lock}.want`), false);

  // Fremder Marker: clearWant darf ihn nicht loeschen.
  writeFileSync(`${lock}.want`, '999999');
  clearWant(lock);
  assert.equal(existsSync(`${lock}.want`), true);
});

test('Marker aendert nichts an der Sperre selbst', () => {
  const lock = freshLock();
  announceWant(lock);
  assert.equal(tryAcquire(lock), true);
  assert.equal(tryAcquire(lock), false, 'zweites Nehmen im selben Prozess muss scheitern');
  releaseLock(lock);
  clearWant(lock);
});
