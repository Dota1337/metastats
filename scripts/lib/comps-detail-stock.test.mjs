// Tests fuer den Detail-Vorrat je Comp-Familie (comps-detail-stock.mjs).
//
// Warum: die Regeln entscheiden, welcher Stand unter welchem Schluessel im
// Manifest steht. Ein Fehler hier sieht in der Seite nicht wie ein Fehler aus,
// sondern wie „andere Zahlen" oder ein fehlender Ergebnis-Block — und mit
// einem Stand je Familie traefe er alle Varianten der Familie zugleich.
//
// Lauf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPartialDetail, slugDetailKey, detailTargetKeys, carryKeysFor,
  assembleDetailEntries, carryAllDetailEntries, COMPLETE_BASE_MAX_AGE_MS,
} from './comps-detail-stock.mjs';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const PERM = { patch: 'current', region: 'all', days: 3, bucket: 'master_plus', minGames: 30, slug: 'TFT18_Solar@5_TFT18_Xayah', family: 'TFT18_Solar__TFT18_Xayah' };
const FAM_KEY = 'comps-detail/18.3/family/TFT18_Solar.TFT18_Xayah__all__3d__master_plus.json';
const KAYLE_KEY = 'comps-detail/18.3/family/TFT18_Solar.TFT18_Kayle__all__3d__master_plus.json';
const SLUG_KEY = 'comps-detail/18.3/TFT18_Solar_5_TFT18_Xayah__all__3d__master_plus.json';

const full = (extra = {}) => ({
  comp: {
    clusterKey: PERM.slug,
    outcome: { games: 1 },
    counters: { source: 'matchups' },
    mergedFamilies: ['TFT18_Solar__TFT18_Xayah', 'TFT18_Solar__TFT18_Kayle'],
    ...extra,
  },
});
const hoursAgo = h => new Date(NOW - h * 3600_000).toISOString();

test('lueckenhaft: ohne Ergebnis-Block, mit Paar-Rueckfall oder ganz ohne comp', () => {
  assert.equal(isPartialDetail(full()), false);
  assert.equal(isPartialDetail(full({ outcome: null })), true);
  assert.equal(isPartialDetail(full({ counters: { source: 'pairs' } })), true);
  assert.equal(isPartialDetail(full({ counters: undefined })), true);
  assert.equal(isPartialDetail({}), true);
  assert.equal(isPartialDetail(null), true);
});

test('Schluessel: Anker-Familie zuerst, jede zusammengelegte Familie und der Slug', () => {
  assert.equal(slugDetailKey(PERM, '18.3'), SLUG_KEY);
  const { blobKey, keys } = detailTargetKeys(PERM, '18.3', full());
  assert.equal(blobKey, FAM_KEY);
  assert.deepEqual(keys, [FAM_KEY, KAYLE_KEY, SLUG_KEY]);
});

test('lueckenhafter Stand landet im Blob unter eigenem Pfad, Schluessel bleiben gleich', () => {
  const { blobKey, keys } = detailTargetKeys(PERM, '18.3', full({ outcome: null }));
  assert.equal(blobKey, FAM_KEY.replace(/\.json$/, '.partial.json'));
  assert.deepEqual(keys, [FAM_KEY, KAYLE_KEY, SLUG_KEY]);
});

test('ohne mergedFamilies nur der Slug-Schluessel (alte Antwortform)', () => {
  const { blobKey, keys } = detailTargetKeys(PERM, '18.3', full({ mergedFamilies: undefined }));
  assert.equal(blobKey, SLUG_KEY);
  assert.deepEqual(keys, [SLUG_KEY]);
});

test('Fehlschlag traegt Slug- und Familien-Schluessel; ohne Familie nur den Slug', () => {
  assert.deepEqual(carryKeysFor(PERM, '18.3'), [SLUG_KEY, FAM_KEY]);
  assert.deepEqual(carryKeysFor({ ...PERM, family: null }, '18.3'), [SLUG_KEY]);
});

const fresh = (url, partial, keys = [FAM_KEY, KAYLE_KEY, SLUG_KEY]) => ({
  uploaded: true, keys, entry: { url, bytes: 10, builtAt: hoursAgo(0), partial },
});

test('frisch vollstaendig schlaegt alles, jeder Schluessel bekommt seinen eigenen key', () => {
  const base = { [FAM_KEY]: { key: FAM_KEY, url: 'alt', builtAt: hoursAgo(5), partial: false } };
  const { entries, carried } = assembleDetailEntries([fresh('neu', false)], base, NOW);
  assert.equal(carried, 0);
  assert.deepEqual(Object.keys(entries).sort(), [FAM_KEY, KAYLE_KEY, SLUG_KEY].sort());
  for (const [k, e] of Object.entries(entries)) {
    assert.equal(e.url, 'neu');
    assert.equal(e.key, k);
  }
});

test('vollstaendiger Vorlauf (≤ 48 h) schlaegt frische Luecke — je Schluessel', () => {
  const base = {
    [FAM_KEY]: { key: FAM_KEY, url: 'alt-voll', builtAt: hoursAgo(20), partial: false },
    // Kayle-Schluessel: Vorlauf ohne partial-Feld (vor E2 gebaut) zaehlt nicht als vollstaendig.
    [KAYLE_KEY]: { key: KAYLE_KEY, url: 'alt-unbekannt', builtAt: hoursAgo(20) },
  };
  const { entries } = assembleDetailEntries([fresh('neu-luecke', true)], base, NOW);
  assert.equal(entries[FAM_KEY].url, 'alt-voll');
  assert.equal(entries[KAYLE_KEY].url, 'neu-luecke');
  assert.equal(entries[SLUG_KEY].url, 'neu-luecke');
});

test('zu alter vollstaendiger Vorlauf verliert gegen frische Luecke', () => {
  const tooOld = COMPLETE_BASE_MAX_AGE_MS / 3600_000 + 1;
  const base = { [FAM_KEY]: { key: FAM_KEY, url: 'alt', builtAt: hoursAgo(tooOld), partial: false } };
  const { entries } = assembleDetailEntries([fresh('neu-luecke', true)], base, NOW);
  assert.equal(entries[FAM_KEY].url, 'neu-luecke');
});

test('zwei Ziele derselben Familie: vollstaendig schlaegt lueckenhaft, bei Gleichstand der erste', () => {
  const a = fresh('a-luecke', true, [FAM_KEY]);
  const b = fresh('b-voll', false, [FAM_KEY]);
  const c = fresh('c-voll', false, [FAM_KEY]);
  assert.equal(assembleDetailEntries([a, b, c], {}, NOW).entries[FAM_KEY].url, 'b-voll');
});

test('Fehlschlag: Vorlauf des Ziels samt Eintraegen derselben URL, aber nur in leere Schluessel', () => {
  const OTHER_SLUG = 'comps-detail/18.3/TFT18_Solar_5_TFT18_Kayle__all__3d__master_plus.json';
  const base = {
    [SLUG_KEY]: { key: SLUG_KEY, url: 'u1', builtAt: hoursAgo(10), partial: false },
    [FAM_KEY]: { key: FAM_KEY, url: 'u1', builtAt: hoursAgo(10), partial: false },
    [KAYLE_KEY]: { key: KAYLE_KEY, url: 'u1', builtAt: hoursAgo(10), partial: false },
    [OTHER_SLUG]: { key: OTHER_SLUG, url: 'u1', builtAt: hoursAgo(10), partial: false },
    'comps-detail/18.3/fremd.json': { url: 'u2', builtAt: hoursAgo(10) },
    'comps/18.3/all__3d__diamond_plus__mg0.json': { url: 'u1' },
  };
  // Ein anderes Ziel hat den Kayle-Schluessel in diesem Lauf frisch beschrieben.
  const results = [
    fresh('neu-kayle', false, [KAYLE_KEY]),
    { error: true, carryKeys: carryKeysFor(PERM, '18.3') },
  ];
  const { entries, carried } = assembleDetailEntries(results, base, NOW);
  assert.equal(entries[KAYLE_KEY].url, 'neu-kayle');
  assert.equal(entries[SLUG_KEY].url, 'u1');
  assert.equal(entries[FAM_KEY].url, 'u1');
  assert.equal(entries[OTHER_SLUG].url, 'u1');
  assert.equal(entries['comps-detail/18.3/fremd.json'], undefined);
  assert.equal(entries['comps/18.3/all__3d__diamond_plus__mg0.json'], undefined);
  assert.equal(carried, 3);
});

test('Fehlschlag ohne Vorlauf und uebersprungene Ergebnisse erzeugen nichts', () => {
  const { entries, carried } = assembleDetailEntries(
    [{ error: true, carryKeys: [SLUG_KEY] }, { skipped: true }, undefined], {}, NOW,
  );
  assert.deepEqual(entries, {});
  assert.equal(carried, 0);
});

test('Lauf ohne Ziele traegt alle Detail-Eintraege des Vorlaufs, sonst nichts', () => {
  const base = {
    [FAM_KEY]: { url: 'a' },
    [SLUG_KEY]: { url: 'a' },
    'comps/18.3/x.json': { url: 'b' },
  };
  assert.deepEqual(Object.keys(carryAllDetailEntries(base)).sort(), [FAM_KEY, SLUG_KEY].sort());
});
