// Merge-Basis-Wache. Vorfall 2026-08-19: `--endpoint comps-detail` ohne
// SNAPSHOT_MANIFEST_URL hat das Manifest von 700 auf 240 Eintraege gekuerzt —
// alles, was der Teil-Lauf nicht selbst publiziert hat, war weg.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBaseError, patchFingerprint, reusableEntry, REUSE_MAX_AGE_MS } from './publish-snapshot-bundle.mjs';

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

// Wiederverwendung beendeter Patches (2026-10-02). Auflage des Users: keine
// Daten der letzten Tage verlieren — jede Abweichung muss neu rechnen.
const now = Date.parse('2026-10-02T03:00:00Z');
const patches = { current: '18.3', previous: '18.2' };
const key = 'tft/comps/18.2/all__diamond_plus__3d.json';
const fp = patchFingerprint({ first_day: '2026-09-10', last_day: '2026-09-23', total_matches: 123456 });
const reuseArgs = {
  alias: 'previous', key, patches, fingerprints: { '18.2': fp },
  oldManifest: { patches, fingerprints: { '18.2': fp } },
  baseEntries: { [key]: { key, url: 'https://blob/x.json', builtAt: '2026-10-01T03:00:00Z' } },
  now,
};

test('Fingerabdruck braucht Tage und Spielzahl', () => {
  assert.equal(fp, '2026-09-10|2026-09-23|123456');
  assert.equal(patchFingerprint({ first_day: '2026-09-10', last_day: '2026-09-23' }), null);
  assert.equal(patchFingerprint(null), null);
});

test('unveraenderter Vorpatch wird wiederverwendet', () => {
  assert.equal(reusableEntry(reuseArgs).url, 'https://blob/x.json');
});

test('laufender Patch wird nie wiederverwendet', () => {
  assert.equal(reusableEntry({ ...reuseArgs, alias: 'current' }), null);
});

test('Nachzuegler-Spiele erzwingen Neuberechnung', () => {
  const fp2 = patchFingerprint({ first_day: '2026-09-10', last_day: '2026-09-23', total_matches: 123457 });
  assert.equal(reusableEntry({ ...reuseArgs, fingerprints: { '18.2': fp2 } }), null);
});

test('Patchwechsel erzwingt Neuberechnung', () => {
  assert.equal(reusableEntry({ ...reuseArgs, oldManifest: { ...reuseArgs.oldManifest, patches: { current: '18.2', previous: '18.1' } } }), null);
});

test('fehlender Abdruck oder Eintrag rechnet neu', () => {
  assert.equal(reusableEntry({ ...reuseArgs, fingerprints: {} }), null);
  assert.equal(reusableEntry({ ...reuseArgs, oldManifest: { patches } }), null);
  assert.equal(reusableEntry({ ...reuseArgs, baseEntries: {} }), null);
});

test('zu alter Eintrag wird neu gebaut', () => {
  const old = new Date(now - REUSE_MAX_AGE_MS - 1000).toISOString();
  assert.equal(reusableEntry({ ...reuseArgs, baseEntries: { [key]: { key, url: 'u', builtAt: old } } }), null);
});

test('nach dem Bau umbenannter Vorpatch wird neu gerechnet', () => {
  assert.equal(reusableEntry({ ...reuseArgs, relabeledAt: { '18.2': '2026-10-01T08:30:00Z' } }), null);
  assert.equal(reusableEntry({ ...reuseArgs, relabeledAt: { '18.2': '2026-10-01T03:00:00Z' } }), null, 'gleiche Sekunde zaehlt als danach');
});

test('Umbenennung vor dem Bau oder an anderem Patch stoert nicht', () => {
  assert.equal(reusableEntry({ ...reuseArgs, relabeledAt: { '18.2': '2026-09-30T08:30:00Z' } }).url, 'https://blob/x.json');
  assert.equal(reusableEntry({ ...reuseArgs, relabeledAt: { '18.3': '2026-10-01T08:30:00Z' } }).url, 'https://blob/x.json');
});

test('fehlende oder kaputte Markerangaben aendern nichts', () => {
  for (const relabeledAt of [undefined, null, {}, { '18.2': 'kein-datum' }]) {
    assert.equal(reusableEntry({ ...reuseArgs, relabeledAt }).url, 'https://blob/x.json', String(relabeledAt));
  }
});
