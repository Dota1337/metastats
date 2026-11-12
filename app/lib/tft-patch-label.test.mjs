import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tftPatchLabel } from './tft-patch-label.ts';
import fs from 'node:fs';

const meta = JSON.parse(fs.readFileSync(new URL('../../public/tft-set.json', import.meta.url), 'utf8'));

const setNumber = meta.setNumber;

// Regression 2026-08-26: Labels aus einem frueheren Set wurden als LoL-Patch
// missverstanden und per Offset-Arithmetik in die laufende Set umgerechnet —
// "17.9" wurde zu "18.18". Seit 12.11.2026 rechnet tftPatchLabel gar nicht mehr.
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

// "17.1" ist ab Januar 2027 auch ein LoL-Patch — zweiteilig ist das nicht von
// Set 17 zu unterscheiden. Die Datenbank traegt nur TFT-Namen, also bleibt alles stehen.
test('keine LoL-Umrechnung: Sets 16–19, Jahreswechsel-Nummern und LoL-Versionen bleiben roh', () => {
  for (const label of ['16.5', '16.23', '17.1', '17.9', '17.2b', '19.1', '19.2c', '15.24']) {
    assert.equal(tftPatchLabel(label), label, label);
  }
  for (const raw of ['16.23.1', '16.22.8348910+branch.releases-16-22.content.release', 'Unreal']) {
    assert.equal(tftPatchLabel(raw), raw, raw);
  }
});

test('Leere und unparsbare Eingaben degradieren sauber', () => {
  assert.equal(tftPatchLabel(''), '');
  assert.equal(tftPatchLabel(null), '');
  assert.equal(tftPatchLabel('kaputt'), 'kaputt');
});
