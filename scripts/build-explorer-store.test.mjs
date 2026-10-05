import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleRanges } from './build-explorer-store.mjs';

// Ausschnitt aus public/tft-set.json (Stand 2026-10-05), fest eingefroren,
// damit der Test nicht mit jedem Terminplan-Lauf kippt.
const at = '2026-10-05T00:56:50.541Z';
const META = {
  setNumber: 18,
  setStartDate: '2026-08-26',
  latestPatch: '18.3',
  patchStarts: [
    { set: 17, patch: '17.9', from_day: '2026-08-12', seen_at: at },
    { set: 18, patch: '18.1', from_day: '2026-08-26', seen_at: at },
    { set: 18, patch: '18.2', from_day: '2026-09-10', seen_at: at },
    { set: 18, patch: '18.3', from_day: '2026-09-23', seen_at: at },
    { set: 18, patch: '18.4', from_day: '2026-10-07', seen_at: at },
    { set: 19, patch: '19.1', from_day: '2026-12-01', seen_at: at },
  ],
  patchCuts: [
    { set: 18, patch: '18.1b', base: '18.1', from_day: '2026-09-01' },
    { set: 18, patch: '18.2b', base: '18.2', from_day: '2026-09-14' },
    { set: 18, patch: '18.3b', base: '18.3', from_day: '2026-09-24' },
  ],
};

const OPEN = '2999-12-31';

test('scheduleRanges: drei B-Patches ohne Abbruch, Basis-Tage dazwischen bleiben', () => {
  assert.deepEqual(scheduleRanges(META, 18, '2026-10-05'), [
    { patch: '18.1', from: '2026-08-26', to: '2026-08-31' },
    { patch: '18.1b', from: '2026-09-01', to: '2026-09-09' },
    { patch: '18.2', from: '2026-09-10', to: '2026-09-13' },
    { patch: '18.2b', from: '2026-09-14', to: '2026-09-22' },
    { patch: '18.3', from: '2026-09-23', to: '2026-09-23' },
    { patch: '18.3b', from: '2026-09-24', to: OPEN },
  ]);
});

test('scheduleRanges: Patch ab seinem Go-Live-Tag dabei, der Vorgaenger endet am Vortag', () => {
  const r = scheduleRanges(META, 18, '2026-10-07');
  assert.deepEqual(r.slice(-2), [
    { patch: '18.3b', from: '2026-09-24', to: '2026-10-06' },
    { patch: '18.4', from: '2026-10-07', to: OPEN },
  ]);
});

test('scheduleRanges: kuenftige Patches fehlen, der juengste gestartete ist offen', () => {
  const r = scheduleRanges(META, 18, '2026-10-06');
  assert.equal(r.some((x) => x.patch === '18.4'), false);
  assert.equal(r.at(-1).patch, '18.3b');
  assert.equal(r.at(-1).to, OPEN);
});

test('scheduleRanges: vor dem Set-Start oder ohne Terminplan leer', () => {
  assert.deepEqual(scheduleRanges(META, 18, '2026-08-25'), []);
  assert.deepEqual(scheduleRanges(META, 20, '2026-10-05'), []);
  assert.deepEqual(scheduleRanges({ setNumber: 18 }, 18, '2026-10-05'), []);
});

test('scheduleRanges: keine Ueberlappung, also kein Tag mit zwei Patches', () => {
  const r = scheduleRanges(META, 18, '2026-10-07');
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].to < r[i].from, `${r[i - 1].patch} / ${r[i].patch}`);
});
