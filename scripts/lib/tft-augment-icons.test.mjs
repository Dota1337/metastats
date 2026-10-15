/**
 * Eigene Augment-Bilder (F3c): nur Platzhalter ersetzen, nur echte webp-Dateien
 * schreiben, gleiche Bilder verschiedener Familien blocken.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  placeholderDigit, augmentExtraIconPath, augmentFamilyKey,
  applyAugmentIconOverrides, fetchMissingAugmentIcons,
} from './tft-augment-icons.mjs';

const PH = n => `assets/maps/tft/icons/augments/hexcore/missing-t${n}.png`;
const webp = seed => {
  const b = Buffer.alloc(2048, seed);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBP', 8, 'latin1');
  return b;
};
const fakeFetch = images => async url => {
  const key = decodeURIComponent(url.split('/').pop());
  const buf = images[key];
  return buf
    ? { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) }
    : { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
};
const tempRoot = () => mkdtempSync(join(tmpdir(), 'aug-icons-'));
const quiet = () => {};

test('Platzhalter-Ziffer nur bei missing-t<n>', () => {
  assert.equal(placeholderDigit(PH(2)), '2');
  assert.equal(placeholderDigit('assets/maps/tft/icons/augments/hexcore/goldengamble_ii.tft_set13.png'), null);
  assert.equal(placeholderDigit('/tft-extra/augments/18/X.webp'), null);
  assert.equal(placeholderDigit(null), null);
});

test('Familie: +/++ und I/II/III am Ende zaehlen nicht', () => {
  assert.equal(augmentFamilyKey('Champ Delivery++'), 'champ delivery');
  assert.equal(augmentFamilyKey('Residual Magic +'), 'residual magic');
  assert.equal(augmentFamilyKey('Glass Cannon II'), 'glass cannon');
  assert.notEqual(augmentFamilyKey('Gain 21 Gold'), augmentFamilyKey('Gain Gold'));
});

test('Uebernahme nur bei Platzhalter UND vorhandener Datei', () => {
  const augments = {
    a: { name: 'A', icon: PH(2) },
    b: { name: 'B', icon: PH(1) },
    c: { name: 'C', icon: 'assets/real.png' },
  };
  const n = applyAugmentIconOverrides(augments, 18, { exists: f => f.endsWith('/a.webp') || f.endsWith('/c.webp') });
  assert.equal(n, 1);
  assert.equal(augments.a.icon, augmentExtraIconPath(18, 'a'));
  assert.equal(augments.b.icon, PH(1));
  assert.equal(augments.c.icon, 'assets/real.png');
});

test('laedt die passende Ziffer, schreibt webp, zweiter Lauf laedt nichts', async () => {
  const root = tempRoot();
  try {
    const augments = { DA_X: { name: 'X', tier: 2, icon: PH(1) } };
    const r = await fetchMissingAugmentIcons(augments, 18, { root, log: quiet, fetchImpl: fakeFetch({ 'DA_X2.png': webp(1) }) });
    assert.deepEqual(r.written, ['DA_X']);
    assert.ok(existsSync(`${root}/tft-extra/augments/18/DA_X.webp`));
    const again = await fetchMissingAugmentIcons(augments, 18, { root, log: quiet, fetchImpl: () => { throw new Error('kein Abruf erwartet'); } });
    assert.equal(again.checked, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('kein webp, zu klein oder Netzfehler: Platzhalter bleibt', async () => {
  const root = tempRoot();
  try {
    const png = Buffer.alloc(2048, 3);
    png.write('\x89PNG', 0, 'latin1');
    const small = webp(4).subarray(0, 100);
    const augments = {
      P: { name: 'P', tier: 1, icon: PH(1) },
      S: { name: 'S', tier: 1, icon: PH(1) },
      N: { name: 'N', tier: 1, icon: PH(1) },
    };
    const fetchImpl = async url => {
      if (url.includes('/N')) throw new Error('timeout');
      return fakeFetch({ 'P1.png': png, 'S1.png': small })(url);
    };
    const r = await fetchMissingAugmentIcons(augments, 18, { root, log: quiet, fetchImpl });
    assert.deepEqual(r.written, []);
    assert.deepEqual(r.failed.sort(), ['N', 'P', 'S']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('gleiches Bild: in einer Familie erlaubt, ueber Familien hinweg blockiert', async () => {
  const root = tempRoot();
  try {
    const augments = {
      CD: { name: 'Champ Delivery', tier: 1, icon: PH(1) },
      CDP: { name: 'Champ Delivery+', tier: 2, icon: PH(2) },
      FF: { name: 'Forge a Friend', tier: 1, icon: PH(1) },
      CC: { name: 'Construct a Companion', tier: 2, icon: PH(2) },
    };
    const r = await fetchMissingAugmentIcons(augments, 18, {
      root, log: quiet,
      fetchImpl: fakeFetch({ 'CD1.png': webp(5), 'CDP2.png': webp(5), 'FF1.png': webp(6), 'CC2.png': webp(6) }),
    });
    assert.deepEqual(r.written.sort(), ['CD', 'CDP']);
    assert.deepEqual(r.blocked.sort(), ['CC', 'FF']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('gleiches Bild wie eine schon vorhandene Datei einer anderen Familie: blockiert', async () => {
  const root = tempRoot();
  try {
    mkdirSync(`${root}/tft-extra/augments/18`, { recursive: true });
    writeFileSync(`${root}/tft-extra/augments/18/OLD.webp`, webp(7));
    const augments = { OLD: { name: 'Old', tier: 1, icon: PH(1) }, NEW: { name: 'New', tier: 1, icon: PH(1) } };
    const r = await fetchMissingAugmentIcons(augments, 18, { root, log: quiet, fetchImpl: fakeFetch({ 'NEW1.png': webp(7) }) });
    assert.equal(r.checked, 1);
    assert.deepEqual(r.blocked, ['NEW']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
