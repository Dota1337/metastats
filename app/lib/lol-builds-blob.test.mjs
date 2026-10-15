/**
 * Datei je Champion fuer die Builds der LoL-Champion-Seite (lol-builds-blob.mjs).
 *
 * Der teure Fehler: eine fremde, alte oder halbe Datei wird gezeigt — dann
 * stehen falsche Zahlen im ersten HTML und Google merkt sie sich. Deshalb faellt
 * alles durch, was nicht exakt zum Champion und zur Standardansicht passt.
 *
 * Lauf: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  LOL_BUILDS_DEFAULT, LOL_BUILDS_MAX_AGE_MS, LOL_BUILDS_INDEX_PATH, isChampionKey, lolBuildsPath, isValidLolBuildsSnapshot,
} from './lol-builds-blob.mjs';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const role = () => ({
  games: 900, wins: 470,
  topBuilds: [], topBoots: [], topItems: [], topRunes: [], topKeystones: [], topSummoners: [],
  counters: { strongAgainst: [], weakAgainst: [] },
  itemVerdicts: {},
});
const snap = (over = {}) => ({
  championKey: '103', region: 'euw1', source: 'db', rank: 'EMERALD_PLUS', patch: '16.20',
  sampleSize: 900, hasBuilds: true, ddragonVersion: '16.20.1', matchesAnalyzed: 900,
  roles: { MIDDLE: role() }, builtAt: new Date(NOW - 3600_000).toISOString(), ...over,
});

test('gueltige Datei', () => {
  assert.equal(isValidLolBuildsSnapshot(snap(), '103', NOW), true);
  assert.equal(isValidLolBuildsSnapshot(snap(), 103, NOW), true);
});

test('fremder Champion, andere Ansicht, Repo-Datei: ungueltig', () => {
  assert.equal(isValidLolBuildsSnapshot(snap(), '157', NOW), false);
  assert.equal(isValidLolBuildsSnapshot(snap({ rank: 'DIAMOND_PLUS' }), '103', NOW), false);
  assert.equal(isValidLolBuildsSnapshot(snap({ region: 'kr' }), '103', NOW), false);
  assert.equal(isValidLolBuildsSnapshot(snap({ source: 'json', rank: null }), '103', NOW), false);
  assert.equal(isValidLolBuildsSnapshot(snap({ hasBuilds: false }), '103', NOW), false);
});

test('zu alt, aus der Zukunft, ohne Zeitstempel: ungueltig', () => {
  assert.equal(isValidLolBuildsSnapshot(snap({ builtAt: new Date(NOW - LOL_BUILDS_MAX_AGE_MS - 1000).toISOString() }), '103', NOW), false);
  assert.equal(isValidLolBuildsSnapshot(snap({ builtAt: new Date(NOW + 3600_000).toISOString() }), '103', NOW), false);
  assert.equal(isValidLolBuildsSnapshot(snap({ builtAt: undefined }), '103', NOW), false);
});

test('halbe Datei: ungueltig', () => {
  assert.equal(isValidLolBuildsSnapshot(null, '103', NOW), false);
  assert.equal(isValidLolBuildsSnapshot(snap({ roles: {} }), '103', NOW), false);
  assert.equal(isValidLolBuildsSnapshot(snap({ roles: { MIDDLE: { ...role(), topRunes: undefined } } }), '103', NOW), false);
  assert.equal(isValidLolBuildsSnapshot(snap({ roles: { MIDDLE: { ...role(), games: 0 } } }), '103', NOW), false);
  assert.equal(isValidLolBuildsSnapshot(snap({ ddragonVersion: '' }), '103', NOW), false);
});

test('Pfade nur fuer Zahl-Keys (Key landet im Blob-Pfad)', () => {
  assert.equal(lolBuildsPath('103'), 'lol/champion-builds/euw1/EMERALD_PLUS/103.json');
  assert.equal(LOL_BUILDS_INDEX_PATH, 'lol/champion-builds/euw1/EMERALD_PLUS/index.json');
  for (const bad of ['Ahri', '../x', '', '1/2']) {
    assert.equal(isChampionKey(bad), false);
    assert.throws(() => lolBuildsPath(bad));
  }
});

test('Standardansicht = Rang-Liste der Route', () => {
  // Die Route laesst nur diese Raenge zu (route.ts RANK_OPTIONS); ein Standard
  // ausserhalb haette nie eine Datei.
  const route = readFileSync(new URL('../api/champions/[id]/builds/route.ts', import.meta.url), 'utf8');
  assert.match(route, new RegExp(`'${LOL_BUILDS_DEFAULT.rank}'`));
  assert.match(route, new RegExp(`'${LOL_BUILDS_DEFAULT.region}'`));
});
