import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { componentsFromBundle, readComponents, componentsHash } from './explorer-components.mjs';

const bundle = {
  active: { items: ['A_Sword_Bow', 'A_Bow_Rod', 'A_Emblem', 'A_Trio'] },
  items: {
    A_Sword_Bow: { composition: ['C_Sword', 'C_Bow'] },
    A_Bow_Rod: { composition: ['C_Bow', 'C_Rod'] },
    A_Emblem: { composition: [] },
    A_Trio: { composition: ['C_X', 'C_Y', 'C_Z'] },
    A_Inactive: { composition: ['C_Old', 'C_Bow'] },
  },
};

test('Komponenten: nur Zweier-Rezepturen aktiver Items, sortiert, ohne Doppelte', () => {
  assert.deepEqual(componentsFromBundle(bundle), ['C_Bow', 'C_Rod', 'C_Sword']);
  assert.deepEqual(componentsFromBundle({}), []);
  assert.deepEqual(componentsFromBundle(null), []);
});

test('Komponenten-Hash haengt nicht an der Reihenfolge, wohl am Inhalt', () => {
  assert.equal(componentsHash(['b', 'a']), componentsHash(['a', 'b']));
  assert.notEqual(componentsHash(['a', 'b']), componentsHash(['a', 'c']));
  assert.match(componentsHash([]), /^[0-9a-f]{16}$/);
});

test('readComponents liest das Bundle unter public/ und meldet Fehler statt zu werfen', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expl-comp-'));
  try {
    fs.mkdirSync(path.join(root, 'public'));
    fs.writeFileSync(path.join(root, 'public/tft-assets-99.json'), JSON.stringify(bundle));
    const logs = [];
    assert.deepEqual(readComponents(root, 99, m => logs.push(m)), ['C_Bow', 'C_Rod', 'C_Sword']);
    assert.equal(logs.length, 0);
    assert.deepEqual(readComponents(root, 98, m => logs.push(m)), []);
    assert.match(logs[0], /nicht lesbar/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
