/**
 * Tests fuer die Vorpatch-Regel F7(c): „previous" = der juengste fruehere
 * Patch mit mindestens PREVIOUS_PATCH_MIN_DAYS Datentagen.
 *
 * Warum: Patch 18.3 hat nach der Umbenennung nur einen Datentag (23.09.).
 * Mit patches[1] verglichen Seite, Vorab-Rechnung und Meta-Pulse gegen diesen
 * einen Tag. Die Datenlage unten ist die nach der Umbenennung
 * (23.09. → 18.3, 24.09. → 18.3b), Stand 05.10.2026.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  previousPatchOf,
  patchDayCount,
  PREVIOUS_PATCH_MIN_DAYS,
  VELOCITY_IN_PATCH_MIN_DAYS,
  compPrecomputeJobs,
  metaPulseVelocityWindow,
} from './snapshot-matrix.ts';

const DAY_MS = 86_400_000;
const TODAY = new Date('2026-10-05T08:30:00Z');
const TODAY_NUM = Math.floor(TODAY.getTime() / DAY_MS);

// Neuester zuerst, wie get_tft_available_patches sie liefert.
const AFTER_FIX = [
  { patch: '18.3b', set_number: 18, first_day: '2026-09-24', last_day: '2026-10-04', total_matches: 4_000_000 },
  { patch: '18.3', set_number: 18, first_day: '2026-09-23', last_day: '2026-09-23', total_matches: 300_000 },
  { patch: '18.2b', set_number: 18, first_day: '2026-09-14', last_day: '2026-09-22', total_matches: 3_000_000 },
  { patch: '18.2', set_number: 18, first_day: '2026-09-10', last_day: '2026-09-13', total_matches: 1_500_000 },
];

test('Konstanten: Vorpatch ab 3 Tagen, Velocity im Patch ab 2 Tagen', () => {
  assert.equal(PREVIOUS_PATCH_MIN_DAYS, 3);
  assert.equal(VELOCITY_IN_PATCH_MIN_DAYS, 2);
});

test('patchDayCount: Kalenderspanne inklusive beider Enden', () => {
  assert.equal(patchDayCount(AFTER_FIX[1]), 1);
  assert.equal(patchDayCount(AFTER_FIX[2]), 9);
  assert.equal(patchDayCount({ first_day: '2026-09-10', last_day: '2026-09-12' }), 3);
  // Zeitstempel statt reinem Tag schaden nicht.
  assert.equal(patchDayCount({ first_day: '2026-09-10T00:00:00Z', last_day: '2026-09-12T00:00:00Z' }), 3);
});

test('patchDayCount: fehlende oder kaputte Tage zaehlen 0', () => {
  assert.equal(patchDayCount(null), 0);
  assert.equal(patchDayCount(undefined), 0);
  assert.equal(patchDayCount({ first_day: null, last_day: '2026-09-12' }), 0);
  assert.equal(patchDayCount({ first_day: '2026-09-12', last_day: '2026-09-10' }), 0);
  assert.equal(patchDayCount({ first_day: 'kaputt', last_day: '2026-09-10' }), 0);
});

test('previousPatchOf: Vorpatch zu kurz → der naechste mit genug Tagen', () => {
  // 18.3 hat 1 Tag und wird uebersprungen.
  assert.equal(previousPatchOf(AFTER_FIX, '18.3b')?.patch, '18.2b');
  // Wer 18.3 direkt waehlt, vergleicht ebenfalls mit 18.2b.
  assert.equal(previousPatchOf(AFTER_FIX, '18.3')?.patch, '18.2b');
  // 18.2 hat 4 Tage (10.-13.09.) → regulaerer Vorpatch.
  assert.equal(previousPatchOf(AFTER_FIX, '18.2b')?.patch, '18.2');
});

test('previousPatchOf: Grenze genau bei 3 Tagen', () => {
  const list = [
    { patch: 'b', first_day: '2026-09-10', last_day: '2026-09-20' },
    { patch: 'drei', first_day: '2026-09-07', last_day: '2026-09-09' },
    { patch: 'zwei', first_day: '2026-09-05', last_day: '2026-09-06' },
  ];
  assert.equal(previousPatchOf(list, 'b')?.patch, 'drei');
  assert.equal(previousPatchOf(list, 'drei'), null, 'nur ein 2-Tage-Patch danach → keiner');
  assert.equal(previousPatchOf(list, 'b', 4), null, 'eigene Schwelle greift');
});

test('previousPatchOf: kein Vorpatch → null, kein Rueckfall auf den Nachbarn', () => {
  assert.equal(previousPatchOf(AFTER_FIX, '18.2'), null, 'letzter Eintrag');
  assert.equal(previousPatchOf(AFTER_FIX.slice(0, 2), '18.3b'), null, 'nur ein Kurz-Patch dahinter');
  assert.equal(previousPatchOf([], '18.3b'), null);
  assert.equal(previousPatchOf(AFTER_FIX, null), null);
  assert.equal(previousPatchOf(AFTER_FIX, undefined), null);
  assert.equal(previousPatchOf(AFTER_FIX, '99.9'), null, 'unbekannter Patch');
});

test('previousPatchOf: Setwechsel — der Helfer kennt kein Set, der Aufrufer prueft', () => {
  const list = [
    { patch: '19.1', set_number: 19, first_day: '2026-12-01', last_day: '2026-12-05' },
    { patch: '18.6', set_number: 18, first_day: '2026-11-10', last_day: '2026-11-30' },
  ];
  const prev = previousPatchOf(list, '19.1');
  assert.equal(prev?.patch, '18.6');
  assert.notEqual(prev?.set_number, list[0].set_number);
  // Vorab-Rechnung: nur der laufende Set-Patch bekommt Eintraege.
  const jobs = compPrecomputeJobs({ patches: list, setNumber: 19, today: new Date('2026-12-06T08:00:00Z') });
  assert.equal(jobs.filter(j => j.patchKey === '18.6').length, 0);
  assert.ok(jobs.some(j => j.patchKey === '19.1'));
});

test('compPrecomputeJobs: rechnet den neuesten Patch und den Vorpatch, nicht den Kurz-Patch', () => {
  const jobs = compPrecomputeJobs({ patches: AFTER_FIX, setNumber: 18, today: TODAY });
  const keys = new Set(jobs.map(j => j.patchKey));
  assert.ok(keys.has(''), 'aktuell ungefiltert');
  assert.ok(keys.has('18.3b'));
  assert.ok(keys.has('18.2b'), 'Vorpatch nach der Regel');
  assert.ok(!keys.has('18.3'), 'Eintags-Patch wird nicht vorgerechnet');
  assert.ok(!keys.has('18.2'));
  assert.ok(jobs.filter(j => j.patchKey === '18.2b').every(j => j.patchFirstDay === '2026-09-14'));
});

test('compPrecomputeJobs: ohne Vorpatch nur aktuell + neuester Patch', () => {
  const jobs = compPrecomputeJobs({ patches: AFTER_FIX.slice(0, 2), setNumber: 18, today: TODAY });
  assert.deepEqual([...new Set(jobs.map(j => j.patchKey))].sort(), ['', '18.3b']);
});

test('Meta-Pulse: gewaehlter Eintags-Patch vergleicht ueber die Grenze mit dem Vorpatch nach der Regel', () => {
  const sel = AFTER_FIX[1];
  const cmp = previousPatchOf(AFTER_FIX, sel.patch);
  const w = metaPulseVelocityWindow({
    sel, cmpLastDay: cmp?.last_day, previousPatch: cmp?.patch ?? null,
    selIdx: 1, requestedDays: 3, velocityShift: 3, latestOffsetDays: 1, todayNum: TODAY_NUM,
  });
  assert.equal(w.mode, 'crossPatch');
  assert.equal(w.effShift, 1, '23.09. gegen 22.09. (letzter Tag von 18.2b)');
  assert.equal(w.effDays, 1);
});

test('Meta-Pulse: Patch mit 2 Tagen bleibt im Patch', () => {
  const sel = { patch: 'x', first_day: '2026-10-03', last_day: '2026-10-04' };
  const w = metaPulseVelocityWindow({
    sel, cmpLastDay: '2026-10-02', previousPatch: 'y',
    selIdx: 0, requestedDays: 3, velocityShift: 3, latestOffsetDays: 1, todayNum: TODAY_NUM,
  });
  assert.equal(w.mode, 'patch');
  assert.equal(w.effShift, 1);
});
