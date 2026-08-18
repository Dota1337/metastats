// Merge-Basis-Wache. Vorfall 2026-08-19: `--endpoint comps-detail` ohne
// SNAPSHOT_MANIFEST_URL hat das Manifest von 700 auf 240 Eintraege gekuerzt —
// alles, was der Teil-Lauf nicht selbst publiziert hat, war weg.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBaseError } from './publish-snapshot-bundle.mjs';

const base = { mergeMode: true, manifestUrlSet: true, baseEntryCount: 700, allowEmptyBase: false };

test('MERGE mit vorhandener Basis laeuft durch', () => {
  assert.equal(mergeBaseError(base), null);
});

test('MERGE ohne SNAPSHOT_MANIFEST_URL bricht ab', () => {
  const err = mergeBaseError({ ...base, manifestUrlSet: false, baseEntryCount: 0 });
  assert.match(err, /SNAPSHOT_MANIFEST_URL/);
});

test('MERGE mit leerer Basis bricht ab', () => {
  const err = mergeBaseError({ ...base, baseEntryCount: 0 });
  assert.match(err, /0 Eintraege/);
});

test('REPLACE laeuft auch ohne Basis — sonst waere der Wiederaufbau blockiert', () => {
  assert.equal(mergeBaseError({ ...base, mergeMode: false, manifestUrlSet: false, baseEntryCount: 0 }), null);
});

test('--allow-empty-base hebt beide Faelle auf', () => {
  assert.equal(mergeBaseError({ ...base, manifestUrlSet: false, baseEntryCount: 0, allowEmptyBase: true }), null);
  assert.equal(mergeBaseError({ ...base, baseEntryCount: 0, allowEmptyBase: true }), null);
});
