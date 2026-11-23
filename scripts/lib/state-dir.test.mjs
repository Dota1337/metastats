import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listFiles, ownStateDir, readJsonOrNull, removeFiles, writeJsonAtomic } from './state-dir.mjs';

test('ownStateDir: nur der Eintrag mit genau diesem Namen', () => {
  assert.equal(ownStateDir('metastats-mv-sync', { STATE_DIRECTORY: '/var/lib/metastats-mv-sync' }), '/var/lib/metastats-mv-sync');
  assert.equal(ownStateDir('metastats-mv-sync', { STATE_DIRECTORY: '/var/lib/a:/var/lib/metastats-mv-sync/' }), '/var/lib/metastats-mv-sync/');
  // Kind einer anderen Unit (crawl-all-regions) erbt deren Ordner → kein Zustand.
  assert.equal(ownStateDir('metastats-mv-sync', { STATE_DIRECTORY: '/var/lib/metastats-crawler' }), null);
  assert.equal(ownStateDir('metastats-mv-sync', { STATE_DIRECTORY: '/var/lib/metastats-mv-sync-old' }), null);
  assert.equal(ownStateDir('metastats-mv-sync', {}), null);
});

test('writeJsonAtomic + readJsonOrNull: Runde, kaputte Datei, unmoeglicher Pfad', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-dir-'));
  const p = join(dir, 'a.json');
  assert.equal(writeJsonAtomic(p, { x: 1 }), true);
  assert.deepEqual(readJsonOrNull(p), { x: 1 });
  assert.deepEqual(readdirSync(dir), ['a.json'], 'keine tmp-Reste');
  writeFileSync(join(dir, 'kaputt.json'), '{nicht json');
  assert.equal(readJsonOrNull(join(dir, 'kaputt.json')), null);
  assert.equal(readJsonOrNull(join(dir, 'fehlt.json')), null);
  // Elternpfad ist eine Datei → kein Wurf, false + Grund.
  let reason = null;
  assert.equal(writeJsonAtomic(join(p, 'unter-datei.json'), {}, (e) => { reason = e; }), false);
  assert.ok(reason instanceof Error);
});

test('listFiles + removeFiles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'state-dir-'));
  for (const f of ['pending-2-1.json', 'pending-1-1.json', 'other.json']) writeFileSync(join(dir, f), '{}');
  const files = listFiles(dir, /^pending-/);
  assert.deepEqual(files.map((f) => f.slice(dir.length + 1)), ['pending-1-1.json', 'pending-2-1.json']);
  assert.deepEqual(listFiles(join(dir, 'fehlt'), /./), []);
  assert.equal(removeFiles([...files, join(dir, 'schon-weg.json')]), 2);
  assert.deepEqual(readdirSync(dir), ['other.json']);
});
