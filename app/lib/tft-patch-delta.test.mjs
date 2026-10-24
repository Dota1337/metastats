import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PATCH_DELTA_MIN_GAMES, patchDeltaPair, patchDeltaOptions, patchDeltaReady, patchDeltaQuery, buildPatchDeltaIndex, deltaFromSums,
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
  const young = [p('18.5', '2026-10-18', '2026-10-18'), ...PATCHES];
  assert.equal(patchDeltaPair(young, 'current'), null, 'nur der Starttag');
  const day2 = [p('18.5', '2026-10-17', '2026-10-18'), ...PATCHES];
  assert.deepEqual(patchDeltaPair(day2, 'current'), { patch: '18.5', prev: '18.4' }, 'ab dem ersten vollen Tag');
  assert.equal(patchDeltaPair(day2, 'current', { dataEnd: '2026-10-17' }), null, 'zweiter Tag noch nicht fuer alle Regionen fertig');
  assert.equal(patchDeltaPair(PATCHES, '18.2'), null);
  const setStart = [p('19.1', '2026-10-10', '2026-10-18', 99), ...PATCHES];
  assert.equal(patchDeltaPair(setStart, 'current'), null);
  assert.equal(patchDeltaPair([], 'current'), null);
  assert.equal(patchDeltaPair(PATCHES, '17.1'), null);
});

// Stand 24.10.2026: 18.5 hatte nur den Starttag, 18.5b laeuft.
const LIVE = [
  p('18.5b', '2026-10-22', '2026-10-23'),
  p('18.5', '2026-10-21', '2026-10-21'),
  p('18.4', '2026-10-07', '2026-10-20'),
  p('18.3b', '2026-09-24', '2026-10-06'),
];
// Zwischen-Patch nach laengerem Haupt-Patch (wie 18.2 → 18.2b).
const LONG_BASE = [
  p('18.2b', '2026-09-10', '2026-09-18'),
  p('18.2', '2026-09-06', '2026-09-09'),
  p('18.1b', '2026-08-30', '2026-09-05'),
  p('18.1', '2026-08-26', '2026-08-29'),
];

test('patchDeltaOptions: Zwischen-Patch am ersten Tag gegen den Vorpatch, Eintags-Haupt-Patch ohne eigene Wahl', () => {
  // dataEnd 22.10.: erst ein voller Tag, der Teil-Tag 21.10. liegt bei 18.5.
  assert.deepEqual(patchDeltaOptions(LIVE, 'current', '2026-10-22'), { prev: { patch: '18.5b', prev: '18.4' }, base: null });
  assert.deepEqual(patchDeltaOptions(LIVE, 'current'), { prev: { patch: '18.5b', prev: '18.4' }, base: null });
  // 18.5 direkt gewaehlt: nur sein Starttag, davor liegt der Vergleichs-Patch.
  assert.deepEqual(patchDeltaOptions(LIVE, '18.5'), { prev: null, base: null });
  assert.deepEqual(patchDeltaOptions(LIVE, 'previous'), { prev: { patch: '18.4', prev: '18.3b' }, base: null });
});

test('patchDeltaOptions: Haupt-Patch mit genug Tagen ist die zweite Wahl, Standard springt ueber die Familie', () => {
  assert.deepEqual(patchDeltaOptions(LONG_BASE, 'current'), {
    prev: { patch: '18.2b', prev: '18.1b' },
    base: { patch: '18.2b', prev: '18.2' },
  });
  assert.deepEqual(patchDeltaPair(LONG_BASE, 'current'), { patch: '18.2b', prev: '18.1b' });
  assert.deepEqual(patchDeltaPair(LONG_BASE, 'current', { vs: 'base' }), { patch: '18.2b', prev: '18.2' });
  assert.deepEqual(patchDeltaPair(LONG_BASE, 'current', { vs: 'base', prevOnly: true }), { patch: '18.2b', prev: '18.1b' });
  // Haupt-Patch selbst: kein Zwischen-Patch, nur der Vorpatch.
  assert.deepEqual(patchDeltaOptions(LONG_BASE, '18.2'), { prev: { patch: '18.2', prev: '18.1b' }, base: null });
});

test('patchDeltaOptions: gegen den eigenen Haupt-Patch erst ab dem zweiten Tag', () => {
  const day1 = [p('18.2b', '2026-09-10', '2026-09-10'), ...LONG_BASE.slice(1)];
  assert.deepEqual(patchDeltaOptions(day1, 'current'), { prev: { patch: '18.2b', prev: '18.1b' }, base: null });
  const day2 = [p('18.2b', '2026-09-10', '2026-09-11'), ...LONG_BASE.slice(1)];
  assert.deepEqual(patchDeltaOptions(day2, 'current').base, { patch: '18.2b', prev: '18.2' });
});

test('patchDeltaOptions: neuer Haupt-Patch ab dem ersten vollen Tag', () => {
  const start = [p('18.6', '2026-11-04', '2026-11-04'), p('18.5b', '2026-10-22', '2026-11-03'), ...LIVE.slice(1)];
  assert.deepEqual(patchDeltaOptions(start, 'current'), { prev: null, base: null });
  const day2 = [p('18.6', '2026-11-04', '2026-11-05'), ...start.slice(1)];
  assert.deepEqual(patchDeltaOptions(day2, 'current').prev, { patch: '18.6', prev: '18.5b' });
  assert.deepEqual(patchDeltaOptions(day2, 'current', '2026-11-04'), { prev: null, base: null });
});

test('patchDeltaOptions: Set-Start, C-Patch, Eintags-Vorgaenger aus fremder Familie', () => {
  const setStart = [p('19.1b', '2026-12-05', '2026-12-10', 99), p('19.1', '2026-12-01', '2026-12-04', 99), ...LIVE];
  assert.deepEqual(patchDeltaOptions(setStart, 'current'), { prev: null, base: { patch: '19.1b', prev: '19.1' } });
  assert.deepEqual(patchDeltaPair(setStart, 'current'), { patch: '19.1b', prev: '19.1' });
  assert.equal(patchDeltaPair(setStart, 'current', { prevOnly: true }), null);
  const cPatch = [p('18.5c', '2026-10-30', '2026-11-02'), p('18.5b', '2026-10-22', '2026-10-29'), ...LIVE.slice(1)];
  assert.deepEqual(patchDeltaOptions(cPatch, 'current'), {
    prev: { patch: '18.5c', prev: '18.4' },
    base: { patch: '18.5c', prev: '18.5b' },
  });
  // Eintags-18.3 vor 18.3b: der Teil-Tag liegt bei 18.3, 18.3b am ersten Tag bereit.
  const oneDayBase = [p('18.3b', '2026-09-24', '2026-09-24'), p('18.3', '2026-09-23', '2026-09-23'), p('18.2b', '2026-09-10', '2026-09-22')];
  assert.deepEqual(patchDeltaOptions(oneDayBase, 'current').prev, { patch: '18.3b', prev: '18.2b' });
  // Kurzer fremder Patch davor (18.4b): der Starttag von 18.5 mischt dessen Spiele.
  const foreign = [p('18.5', '2026-10-21', '2026-10-21'), p('18.4b', '2026-10-19', '2026-10-20'), p('18.4', '2026-10-07', '2026-10-18')];
  assert.deepEqual(patchDeltaOptions(foreign, 'current'), { prev: null, base: null });
});

test('patchDeltaReady: ein voller Tag reicht nur mit dem Teil-Tag beim Vorgaenger derselben Familie', () => {
  const [b, base, prev] = LIVE;
  assert.equal(patchDeltaReady(LIVE, b, prev, '2026-10-22'), true);
  assert.equal(patchDeltaReady(LIVE, b, base, '2026-10-22'), false);
  assert.equal(patchDeltaReady(LIVE, b, base, '2026-10-23'), true);
  assert.equal(patchDeltaReady(LIVE, b, prev, '2026-10-21'), false, 'Endtag vor dem ersten Tag');
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
