/**
 * Tests fuer das Tagesfenster und die vorab gerechneten Comp-Listen.
 *
 * Warum: Route (resolveFilters) und Box-Skript (precompute-comp-windows.mjs)
 * muessen fuer dieselbe Anfrage denselben Eintrag treffen. Rechnen sie das
 * Fenster verschieden, findet die Route nie etwas und rechnet wieder live —
 * ohne jede Meldung. Die Faelle unten sind die Datenlage vom 2026-09-13
 * (heute 13.09., letzter Tag 11.09., 18.2 seit 10.09., 18.1 26.08.-09.09.).
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listWindowDays,
  establishedPatches,
  compPrecomputeJobs,
  precomputedEntryUsable,
  listKey,
  COMP_PRECOMPUTE_BUCKETS,
  COMP_PRECOMPUTE_MAX_AGE_MS,
} from './snapshot-matrix.ts';

const TODAY = new Date('2026-09-13T08:30:00Z');
const PATCHES = [
  { patch: '18.2', set_number: 18, first_day: '2026-09-10', last_day: '2026-09-11', total_matches: 1_130_000 },
  { patch: '18.1', set_number: 18, first_day: '2026-08-26', last_day: '2026-09-09', total_matches: 8_790_000 },
  { patch: '17.9', set_number: 17, first_day: '2026-08-12', last_day: '2026-08-26', total_matches: 900_000 },
];

test('Fenster: 2 Tage Rueckstand dehnen „Letzter Tag" bis zum letzten Datentag', () => {
  const r = listWindowDays({ requestedDays: 1, patchFilter: null, patchStartDay: '2026-09-10', latestDay: '2026-09-11', today: TODAY });
  assert.deepEqual(r, { days: 3, anchorOffsetDays: 2 });
});

test('Fenster: ohne Patch-Filter nie vor den Patch-Start (4 Tage seit 10.09.)', () => {
  const r = listWindowDays({ requestedDays: 3, patchFilter: null, patchStartDay: '2026-09-10', latestDay: '2026-09-11', today: TODAY });
  assert.equal(r.days, 4);
  const seven = listWindowDays({ requestedDays: 7, patchFilter: null, patchStartDay: '2026-09-10', latestDay: '2026-09-11', today: TODAY });
  assert.equal(seven.days, 7);
});

test('Fenster: mit Patch-Filter wird nicht gekappt', () => {
  const r = listWindowDays({ requestedDays: 7, patchFilter: '18.1', patchStartDay: '2026-08-26', latestDay: '2026-09-11', today: TODAY });
  assert.equal(r.days, 9);
});

test('Fenster: frische Daten → keine Dehnung', () => {
  const r = listWindowDays({ requestedDays: 2, patchFilter: null, patchStartDay: '2026-09-10', latestDay: '2026-09-13', today: TODAY });
  assert.deepEqual(r, { days: 2, anchorOffsetDays: 0 });
});

test('Fenster: ohne letzten Tag bleibt die Wahl', () => {
  assert.deepEqual(
    listWindowDays({ requestedDays: 5, patchFilter: null, patchStartDay: null, latestDay: undefined, today: TODAY }),
    { days: 5, anchorOffsetDays: 0 },
  );
});

test('Patches: duenner Patch faellt raus, sind alle duenn bleibt die rohe Liste', () => {
  const thin = { patch: '18.3', set_number: 18, first_day: '2026-09-12', last_day: '2026-09-12', total_matches: 9000 };
  assert.deepEqual(establishedPatches([thin, ...PATCHES]).map(p => p.patch), ['18.2', '18.1', '17.9']);
  assert.deepEqual(establishedPatches([thin]), [thin]);
});

test('Jobs: data_start ist je Fall eindeutig und 18.2 faellt auf einen Eintrag je Gruppe zusammen', () => {
  const jobs = compPrecomputeJobs({ patches: PATCHES, setNumber: 18, today: TODAY });
  const groups = Object.keys(COMP_PRECOMPUTE_BUCKETS).length;
  const by = k => jobs.filter(j => j.patchKey === k);
  // 18.2 umfasst ab 3 Tagen den ganzen Patch → alle Stufen = data_start 10.09.
  assert.equal(by('18.2').length, groups);
  assert.ok(by('18.2').every(j => j.dataStart === '2026-09-10' && j.patchFirstDay === '2026-09-10'));
  // 17.9 ist ein anderes Set → kein Fall.
  assert.equal(by('17.9').length, 0);
  // aktuell ungefiltert: Stufen 2-4 werden auf 4 Tage gekappt (gleicher Eintrag), 1/5/6/7 einzeln.
  const cur = by('').filter(j => j.bucketLabel === 'all').map(j => j.dataStart).sort();
  assert.deepEqual(cur, ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10']);
  assert.ok(by('').every(j => j.patchFirstDay === null));
  const keys = jobs.map(j => `${j.patchKey}|${j.bucketLabel}|${j.dataStart}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('Jobs: data_start deckt sich mit der Lese-Funktion fuer jede Tagesstufe', () => {
  // Nachbau von get_tft_comp_list_precomputed: greatest(today - p_days, patch_first_day)
  const jobs = compPrecomputeJobs({ patches: PATCHES, setNumber: 18, today: TODAY });
  const cases = [
    { key: '', filter: null, start: '2026-09-10' },
    { key: '18.2', filter: '18.2', start: '2026-09-10' },
    { key: '18.1', filter: '18.1', start: '2026-08-26' },
  ];
  for (const c of cases) {
    for (let d = 1; d <= 7; d++) {
      const { days } = listWindowDays({ requestedDays: d, patchFilter: c.filter, patchStartDay: c.start, latestDay: '2026-09-11', today: TODAY });
      const ws = new Date(Date.UTC(2026, 8, 13) - days * 86_400_000).toISOString().slice(0, 10);
      const lookup = c.filter && c.start > ws ? c.start : ws;
      for (const b of Object.keys(COMP_PRECOMPUTE_BUCKETS)) {
        assert.ok(
          jobs.some(j => j.patchKey === c.key && j.bucketLabel === b && j.dataStart === lookup),
          `kein Eintrag fuer ${c.key || 'aktuell'}/${b}/${d}d (data_start ${lookup})`,
        );
      }
    }
  }
});

test('Gruppen: Raenge stimmen mit der Rang-Datei ueberein', async () => {
  const { BUCKET_GROUPS } = await import('./tft-supabase-reader.ts');
  for (const [label, tiers] of Object.entries(COMP_PRECOMPUTE_BUCKETS)) {
    assert.equal(listKey(tiers), listKey(BUCKET_GROUPS[label]), label);
  }
});

test('Eintrag: nur mit gleichem letzten Tag, frisch und niedriger Schwelle', () => {
  const now = Date.parse('2026-09-13T09:00:00Z');
  const e = { last_day: '2026-09-11', min_games: 30, computed_at: '2026-09-13T06:30:00Z' };
  const o = { latestDay: '2026-09-11', requestedMinGames: 30, now };
  assert.equal(precomputedEntryUsable(e, o), true);
  assert.equal(precomputedEntryUsable(e, { ...o, requestedMinGames: 490 }), true);
  assert.equal(precomputedEntryUsable(e, { ...o, requestedMinGames: 10 }), false);
  assert.equal(precomputedEntryUsable(e, { ...o, latestDay: '2026-09-12' }), false);
  assert.equal(precomputedEntryUsable({ ...e, computed_at: new Date(now - COMP_PRECOMPUTE_MAX_AGE_MS - 1).toISOString() }, o), false);
  assert.equal(precomputedEntryUsable(null, o), false);
  assert.equal(precomputedEntryUsable(e, { ...o, latestDay: undefined }), false);
});
