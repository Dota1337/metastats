// Riot hat den Aufbau der Mid-Patch-Abschnitte ab 18.2 geaendert (Datum als
// h4, frei benannte Kategorien). Die Ueberschriften der echten Seiten 18.1–18.3
// liegen in scripts/fixtures/tft-bpatch-notes.json (Stand 2026-10-04).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMidpatch, cutsFor, categoryKind } from './detect-tft-bpatches.mjs';

const notes = JSON.parse(readFileSync(new URL('./fixtures/tft-bpatch-notes.json', import.meta.url), 'utf8'));
const cuts = base => cutsFor(18, base, parseMidpatch(notes[base].body, notes[base].publishIso), 'x', 'now')
  .map(c => `${c.patch} ${c.from_day}`);

test('echte Seiten ergeben die richtigen Schnitte', () => {
  assert.deepEqual(cuts('18.1'), ['18.1b 2026-09-01']);
  assert.deepEqual(cuts('18.2'), ['18.2b 2026-09-14']);
  // 28.09. ist nur Fliesstext (Augment abgeschaltet) — kein eigener Schnitt.
  assert.deepEqual(cuts('18.3'), ['18.3b 2026-09-24']);
});

test('Kategorien nach Wortregel', () => {
  assert.equal(categoryKind('18.3 B PATCH BALANCE CHANGES'), 'balance');
  assert.equal(categoryKind('18.2 CHAMPION TARGETING'), 'balance');
  assert.equal(categoryKind('AUGMENTS TEMPORARILY DISABLED'), 'balance');
  assert.equal(categoryKind('WISPS'), 'balance');
  assert.equal(categoryKind('CHAMPION BUG FIXES'), 'other');
  assert.equal(categoryKind('PERFORMANCE/STABILITY BUG FIXES'), 'other');
  assert.equal(categoryKind('NEW ARENA'), 'unknown');
});

test('unbekannte Kategorie bricht ab', () => {
  const body = '<h2 id="patch-midpatch-updates">X</h2><h4>OCTOBER 2ND</h4><h4>NEW ARENA</h4>';
  assert.throws(() => parseMidpatch(body, '2026-09-30T00:00:00Z'), /Unbekannte Kategorie/);
});

test('Kategorie ohne Datum bricht weiter ab', () => {
  const body = '<h2 id="patch-midpatch-updates">X</h2><h4>UNITS</h4>';
  assert.throws(() => parseMidpatch(body, '2026-09-30T00:00:00Z'), /ohne Datums-Ueberschrift/);
});
