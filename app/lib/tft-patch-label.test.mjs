import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tftPatchLabel, tftPatchForGame } from './tft-patch-label.ts';
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

// Spielseite: Riots game_version traegt seit Set 18 keine Nummer ("TFT Unreal
// Version ?.?.?.?"), der Patch kommt aus Spielzeit + Terminplan. Vergangene
// Termine aendert kein Bot mehr (PAST_GUARD), daher stabil.
const at = (iso) => Date.parse(iso);
test('Spiel-Patch: Sammeltag aus der Spielzeit, B-Patch-Schnitt inklusive', () => {
  assert.equal(tftPatchForGame(at('2026-11-05T12:00:00Z'), 18), '18.6');
  assert.equal(tftPatchForGame(at('2026-10-29T12:00:00Z'), 18), '18.5c');
  assert.equal(tftPatchForGame(at('2026-05-01T12:00:00Z'), 17), '17.2');
});
test('Spiel-Patch: vor 05:00 UTC zaehlt der Vortag (wie bei den Sammlern)', () => {
  // 04.11. ist Go-Live von 18.6; 04:59 UTC gehoert noch zum Sammeltag 03.11.
  assert.equal(tftPatchForGame(at('2026-11-04T04:59:00Z'), 18), '18.5c');
  assert.equal(tftPatchForGame(at('2026-11-04T05:00:00Z'), 18), '18.6');
});
test('Spiel-Patch: nie geraten — Revival, vor dem Plan, fehlende Werte', () => {
  assert.equal(tftPatchForGame(at('2026-11-05T12:00:00Z'), 16), '', 'Set 16 ist abgeloest');
  assert.equal(tftPatchForGame(at('2025-12-20T12:00:00Z'), 16), '', 'vor dem ersten Termin');
  assert.equal(tftPatchForGame(0, 18), '');
  assert.equal(tftPatchForGame(null, 18), '');
  assert.equal(tftPatchForGame(Number.NaN, 18), '');
  assert.equal(tftPatchForGame(at('2026-11-05T12:00:00Z'), null), '');
  assert.equal(tftPatchForGame(at('2026-11-05T12:00:00Z'), 0), '');
});
