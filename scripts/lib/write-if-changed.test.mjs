import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJsonIfChanged } from './write-if-changed.mjs';

test('nur der Zeitstempel anders: Datei bleibt unangetastet', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wic-'));
  try {
    const path = join(dir, 'a.json');
    assert.equal(writeJsonIfChanged(path, { a: 1, fetchedAt: 'x' }), true);
    const old = new Date('2020-01-01');
    utimesSync(path, old, old);
    assert.equal(writeJsonIfChanged(path, { a: 1, fetchedAt: 'y', scrapedAt: 'z' }), false);
    assert.equal(statSync(path).mtimeMs, old.getTime());
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).fetchedAt, 'x');

    assert.equal(writeJsonIfChanged(path, { a: 2, fetchedAt: 'y' }), true);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).a, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('kaputte alte Datei wird ueberschrieben, eigenes Format gilt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wic-'));
  try {
    const path = join(dir, 'b.json');
    writeFileSync(path, '{kaputt');
    assert.equal(writeJsonIfChanged(path, { a: 1 }, d => `${JSON.stringify(d, null, 2)}\n`), true);
    assert.equal(readFileSync(path, 'utf8'), '{\n  "a": 1\n}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
