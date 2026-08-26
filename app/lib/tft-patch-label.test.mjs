import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tftPatchLabel } from './tft-patch-label.ts';
import fs from 'node:fs';

const meta = JSON.parse(fs.readFileSync(new URL('../../public/tft-set.json', import.meta.url), 'utf8'));

const setNumber = meta.setNumber;
const lolMajor = Number(String(meta.lolPatch).split('.')[0]);

// Regression 2026-08-26: Labels aus einem frueheren Set wurden als LoL-Patch
// missverstanden und per Offset-Arithmetik in die laufende Set umgerechnet —
// "17.9" wurde zu "18.18". Ein Major, der kein LoL-Major ist, ist bereits ein
// TFT-Label und muss unveraendert durchlaufen.
test('Labels frueherer Sets bleiben unveraendert', () => {
  for (const minor of [1, 5, 9]) {
    const older = `${setNumber - 1}.${minor}`;
    assert.equal(tftPatchLabel(older), older);
  }
  assert.equal(tftPatchLabel(`${setNumber - 1}.2b`), `${setNumber - 1}.2b`);
});

test('Labels der laufenden Set bleiben unveraendert, Suffix ueberlebt', () => {
  assert.equal(tftPatchLabel(`${setNumber}.3`), `${setNumber}.3`);
  assert.equal(tftPatchLabel(`${setNumber}.3b`), `${setNumber}.3b`);
});

test('LoL-Patch am Anker wird auf das aktuelle TFT-Label abgebildet', () => {
  const lolMinor = Number(String(meta.lolPatch).split('.')[1]);
  assert.equal(tftPatchLabel(`${lolMajor}.${lolMinor}`), meta.latestPatch);
});

test('Leere und unparsbare Eingaben degradieren sauber', () => {
  assert.equal(tftPatchLabel(''), '');
  assert.equal(tftPatchLabel(null), '');
  assert.equal(tftPatchLabel('kaputt'), 'kaputt');
});
