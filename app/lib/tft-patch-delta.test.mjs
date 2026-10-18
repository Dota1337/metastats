import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PATCH_DELTA_MIN_GAMES, patchDeltaPair, patchDeltaQuery, buildPatchDeltaIndex, deltaFromSums,
  patchDeltaOf, sumDeltaKeys, traitDeltaKey,
} from './tft-patch-delta.ts';

// Set-Nummern bewusst unecht (check-drift).
const p = (patch, first_day, last_day, set_number = 98) => ({ patch, set_number, first_day, last_day, total_matches: 1000 });
const PATCHES = [
  p('18.4', '2026-10-15', '2026-10-18'),
  p('18.3b', '2026-10-14', '2026-10-14'), // 1 Tag: zaehlt nicht als Vorpatch
  p('18.3', '2026-10-01', '2026-10-13'),
  p('18.2', '2026-09-17', '2026-09-30'),
];

test('patchDeltaPair: gewaehlter Patch gegen den Vorpatch mit genug Tagen', () => {
  assert.deepEqual(patchDeltaPair(PATCHES, 'current'), { patch: '18.4', prev: '18.3' });
  assert.deepEqual(patchDeltaPair(PATCHES, 'previous'), { patch: '18.3', prev: '18.2' });
  assert.deepEqual(patchDeltaPair(PATCHES, '18.3'), { patch: '18.3', prev: '18.2' });
});

test('patchDeltaPair: kein Paar bei zu jungem Patch, ohne Vorpatch oder ueber die Set-Grenze', () => {
  const young = [p('18.5', '2026-10-17', '2026-10-18'), ...PATCHES];
  assert.equal(patchDeltaPair(young, 'current'), null);
  assert.equal(patchDeltaPair(PATCHES, '18.2'), null);
  const setStart = [p('19.1', '2026-10-10', '2026-10-18', 99), ...PATCHES];
  assert.equal(patchDeltaPair(setStart, 'current'), null);
  assert.equal(patchDeltaPair([], 'current'), null);
  assert.equal(patchDeltaPair(PATCHES, '17.1'), null);
});

test('patchDeltaQuery: feste Reihenfolge, gleiche Ansicht = gleiche Adresse', () => {
  assert.equal(
    patchDeltaQuery('comp', 'master_plus', 'all', { patch: '18.4', prev: '18.3' }),
    '/api/tft/patch-diff?full=1&entity=comp&bucket=master_plus&region=all&patch=18.4&prev=18.3',
  );
});

test('deltaFromSums: Δ erst ab der Mindestmenge auf beiden Seiten', () => {
  const m = PATCH_DELTA_MIN_GAMES;
  assert.equal(m, 150);
  const d = deltaFromSums({ g: m, s: m * 4.0 }, { g: m, s: m * 4.25 }, true);
  assert.ok(Math.abs(d.deltaAvgPlace - -0.25) < 1e-9);
  assert.equal(d.isNew, false);
  const thin = deltaFromSums({ g: m, s: m * 4 }, { g: m - 1, s: (m - 1) * 4.5 }, true);
  assert.equal(thin.deltaAvgPlace, null);
  assert.equal(thin.avgPlacePrev, 4.5, 'Werte fuer den Tooltip bleiben');
  assert.equal(deltaFromSums(undefined, undefined, true), null);
});

test('deltaFromSums: NEU nur, wenn erlaubt und im Vorpatch gar nicht gespielt', () => {
  const now = { g: 200, s: 800 };
  assert.equal(deltaFromSums(now, undefined, true).isNew, true);
  assert.equal(deltaFromSums(now, undefined, false).isNew, false);
  assert.equal(deltaFromSums({ g: 100, s: 400 }, undefined, true).isNew, false);
});

test('buildPatchDeltaIndex: Antwort zu einem anderen Paar wird verworfen', () => {
  const pair = { patch: '18.4', prev: '18.3' };
  const res = { hasData: true, currentPatch: '18.4', previousPatch: '18.3', current: [{ k: 'A', g: 200, a: 4 }], previous: [{ k: 'A', g: 300, a: 4.5 }] };
  assert.ok(buildPatchDeltaIndex('unit', pair, res));
  assert.equal(buildPatchDeltaIndex('unit', pair, { ...res, previousPatch: '18.2' }), null);
  assert.equal(buildPatchDeltaIndex('unit', pair, { hasData: false, reason: 'pending' }), null);
  assert.equal(buildPatchDeltaIndex('unit', pair, null), null);
});

test('Traits: Δ je Stufe, nicht ueber alle Stufen gemischt', () => {
  const pair = { patch: '18.4', prev: '18.3' };
  const res = {
    hasData: true, currentPatch: '18.4', previousPatch: '18.3',
    current: [{ k: 'DA_T', l: 2, g: 400, a: 4.6 }, { k: 'DA_T', l: 4, g: 200, a: 3.0 }],
    previous: [{ k: 'DA_T', l: 2, g: 400, a: 4.4 }, { k: 'DA_T', l: 4, g: 200, a: 3.5 }],
  };
  const idx = buildPatchDeltaIndex('trait', pair, res);
  assert.ok(Math.abs(patchDeltaOf(idx, traitDeltaKey('DA_T', 2)).deltaAvgPlace - 0.2) < 1e-9);
  assert.ok(Math.abs(patchDeltaOf(idx, traitDeltaKey('DA_T', 4)).deltaAvgPlace - -0.5) < 1e-9);
  assert.equal(patchDeltaOf(idx, traitDeltaKey('DA_T', 6)), null);
});

test('Comps: Summe ueber mehrere Cluster, gewichtet nach Spielen, nie NEU', () => {
  const pair = { patch: '18.4', prev: '18.3' };
  const res = {
    hasData: true, currentPatch: '18.4', previousPatch: '18.3',
    current: [{ k: 'a', g: 100, a: 4 }, { k: 'b', g: 100, a: 3 }],
    previous: [{ k: 'a', g: 300, a: 4 }],
  };
  const idx = buildPatchDeltaIndex('comp', pair, res);
  const d = sumDeltaKeys(idx, ['a', 'b', 'a']);
  assert.equal(d.gamesNow, 200);
  assert.ok(Math.abs(d.deltaAvgPlace - -0.5) < 1e-9);
  assert.equal(sumDeltaKeys(idx, ['b']).isNew, false);
  assert.equal(patchDeltaOf(idx, 'b').isNew, false);
});
