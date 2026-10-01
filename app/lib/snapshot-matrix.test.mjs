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
  isValidMetaPulseDiff,
  metaPulseDiffPath,
  META_PULSE_DIFF_BUCKETS,
  META_PULSE_DIFF_MAX_AGE_MS,
  META_PULSE_DIFF_CLOSED_MAX_AGE_MS,
  metaPulseVelocityWindow,
  metaPulseVelocityPath,
  isValidMetaPulseVelocity,
  META_PULSE_VELOCITY_SHIFTS,
  META_PULSE_VELOCITY_MAX_AGE_MS,
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

// Meta-Pulse-Patchvergleich: Route und Box-Skript muessen denselben Blob als
// gueltig ansehen. Faellt einer durch, rechnet die Route still live (16-20 s).
const MP_NOW = Date.parse('2026-10-01T10:00:00Z');
const MP_WANT = {
  set: 18, patch: '18.3', lastDay: '2026-09-30', totalMatches: 3_254_536,
  regions: ['euw1', 'kr', 'na1'], buckets: META_PULSE_DIFF_BUCKETS.master_plus, now: MP_NOW,
};
const MP_SNAP = {
  v: 1, generatedAt: new Date(MP_NOW - 30 * 60 * 1000).toISOString(), set: 18, patch: '18.3',
  lastDay: '2026-09-30', totalMatches: 3_254_536, regions: ['na1', 'euw1', 'kr'],
  buckets: [...META_PULSE_DIFF_BUCKETS.master_plus], minGames: 80,
  rows: [{ cluster_key: 'x', games: 100, sum_placement: 400, top4: 60, top1: 15, participants: 1000 }],
};

test('Meta-Pulse-Blob: passender Stand ist gueltig (Reihenfolge der Regionen egal)', () => {
  assert.equal(isValidMetaPulseDiff(MP_SNAP, MP_WANT), true);
  assert.equal(isValidMetaPulseDiff({ ...MP_SNAP, lastDay: '2026-10-01', totalMatches: 3_300_000 }, MP_WANT), true);
});

test('Meta-Pulse-Blob: falscher Patch, Set, Regionen, Raenge oder Mindestspiele fallen durch', () => {
  assert.equal(isValidMetaPulseDiff({ ...MP_SNAP, patch: '18.2' }, MP_WANT), false);
  assert.equal(isValidMetaPulseDiff({ ...MP_SNAP, set: 17 }, MP_WANT), false);
  assert.equal(isValidMetaPulseDiff({ ...MP_SNAP, regions: ['euw1', 'kr'] }, MP_WANT), false);
  assert.equal(isValidMetaPulseDiff({ ...MP_SNAP, buckets: [...META_PULSE_DIFF_BUCKETS.diamond_plus] }, MP_WANT), false);
  assert.equal(isValidMetaPulseDiff({ ...MP_SNAP, minGames: 50 }, MP_WANT), false);
});

test('Meta-Pulse-Blob: aelterer Datenstand, zu alt oder aus der Zukunft faellt durch', () => {
  assert.equal(isValidMetaPulseDiff({ ...MP_SNAP, lastDay: '2026-09-29' }, MP_WANT), false);
  assert.equal(isValidMetaPulseDiff({ ...MP_SNAP, totalMatches: 3_254_535 }, MP_WANT), false);
  assert.equal(isValidMetaPulseDiff({ ...MP_SNAP, generatedAt: new Date(MP_NOW - META_PULSE_DIFF_MAX_AGE_MS - 1).toISOString() }, MP_WANT), false);
  assert.equal(isValidMetaPulseDiff({ ...MP_SNAP, generatedAt: new Date(MP_NOW + 10 * 60 * 1000).toISOString() }, MP_WANT), false);
});

test('Meta-Pulse-Blob: abgeschlossener Patch bleibt 14 Tage gueltig, laufender nur 36 h', () => {
  const tenDaysOld = { ...MP_SNAP, generatedAt: new Date(MP_NOW - 10 * 24 * 60 * 60 * 1000).toISOString() };
  assert.equal(isValidMetaPulseDiff(tenDaysOld, { ...MP_WANT, closed: true }), true);
  assert.equal(isValidMetaPulseDiff(tenDaysOld, MP_WANT), false);
  assert.equal(isValidMetaPulseDiff(tenDaysOld, { ...MP_WANT, closed: false }), false);
  const tooOld = { ...MP_SNAP, generatedAt: new Date(MP_NOW - META_PULSE_DIFF_CLOSED_MAX_AGE_MS - 1).toISOString() };
  assert.equal(isValidMetaPulseDiff(tooOld, { ...MP_WANT, closed: true }), false);
  // auch abgeschlossen: aelterer Datenstand faellt durch
  assert.equal(isValidMetaPulseDiff({ ...tenDaysOld, lastDay: '2026-09-29' }, { ...MP_WANT, closed: true }), false);
});

test('Meta-Pulse-Blob: Muell wird abgelehnt statt zu werfen', () => {
  for (const bad of [null, undefined, 'x', 42, [], {}, { ...MP_SNAP, v: 2 }, { ...MP_SNAP, rows: null }, { ...MP_SNAP, generatedAt: 'kaputt' }]) {
    assert.equal(isValidMetaPulseDiff(bad, MP_WANT), false);
  }
});

test('Meta-Pulse-Blob: Pfad je Patch und Rang-Gruppe', () => {
  assert.equal(metaPulseDiffPath('18.3', 'master_plus'), 'tft/meta-pulse/diff/18.3/all__master_plus.json');
});

// Stand 2026-10-02: 18.3 seit 25.09., Daten bis 30.09. (2 Tage Rueckstand).
const V_TODAY = Math.floor(Date.parse('2026-10-02T12:00:00Z') / 86_400_000);
const V_SEL = { patch: '18.3', first_day: '2026-09-25', last_day: '2026-09-30' };
const vWin = (over = {}) => metaPulseVelocityWindow({
  sel: V_SEL, cmpLastDay: '2026-09-24', previousPatch: '18.2', selIdx: 0,
  requestedDays: 3, velocityShift: 3, latestOffsetDays: 2, todayNum: V_TODAY, ...over,
});

test('Velocity-Fenster: 6-Tage-Patch bleibt im Patch, Anker am letzten Datentag', () => {
  assert.deepEqual(vWin(), {
    mode: 'patch', effShift: 3, effDays: 3, velocityPatch: '18.3', anchorOffsetDays: 2, anchorDay: '2026-09-30',
  });
  // Abstand 14 schrumpft auf 5, dann bleibt nur 1 Tag ohne Ueberlappung.
  const w = vWin({ requestedDays: 7, velocityShift: 14 });
  assert.equal(w.effShift, 5);
  assert.equal(w.effDays, 1);
});

test('Velocity-Fenster: 1-Tage-Patch vergleicht mit dem Vorpatch, ohne Vorpatch bleibt die Wahl', () => {
  const sel = { patch: '18.4', first_day: '2026-09-30', last_day: '2026-09-30' };
  assert.deepEqual(vWin({ sel, cmpLastDay: '2026-09-29', previousPatch: '18.3' }), {
    mode: 'crossPatch', effShift: 1, effDays: 1, velocityPatch: null, anchorOffsetDays: 2, anchorDay: '2026-09-30',
  });
  const alone = vWin({ sel, cmpLastDay: '2026-09-29', previousPatch: null });
  assert.equal(alone.mode, 'patch');
  assert.equal(alone.effShift, 3);
  assert.equal(alone.effDays, 3);
});

test('Velocity-Fenster: aelterer Patch ankert an seinem letzten Tag', () => {
  const w = vWin({ sel: { patch: '18.2', first_day: '2026-09-10', last_day: '2026-09-24' }, selIdx: 1, cmpLastDay: '2026-09-09' });
  assert.equal(w.anchorOffsetDays, 8);
  assert.equal(w.anchorDay, '2026-09-24');
});

test('Velocity-Fenster: Tage 1-7 x Abstand fallen beim 6-Tage-Patch auf 7 Fenster', () => {
  const keys = new Set();
  for (let d = 1; d <= 7; d++) for (const v of META_PULSE_VELOCITY_SHIFTS) {
    keys.add(metaPulseVelocityPath('18.3', 'master_plus', vWin({ requestedDays: d, velocityShift: v })));
  }
  assert.equal(keys.size, 7);
  assert.ok(keys.has('tft/meta-pulse/velocity/18.3/all__master_plus__patch_a2026-09-30_d3_s3.json'));
});

const V_NOW = Date.parse('2026-10-02T12:00:00Z');
const V_WANT = {
  set: 18, patch: '18.3', comparePatch: '18.2', lastDay: '2026-09-30', totalMatches: 3_254_536,
  compareTotalMatches: 5_000_000, regions: ['euw1', 'kr'], buckets: [...META_PULSE_DIFF_BUCKETS.master_plus],
  window: vWin(), now: V_NOW,
};
const V_SNAP = {
  v: 1, generatedAt: new Date(V_NOW - 30 * 60 * 1000).toISOString(), set: 18, patch: '18.3', comparePatch: '18.2',
  lastDay: '2026-09-30', totalMatches: 3_254_536, compareTotalMatches: 5_000_000, regions: ['kr', 'euw1'],
  buckets: [...META_PULSE_DIFF_BUCKETS.master_plus], minGames: 100, mode: 'patch', anchorDay: '2026-09-30',
  effDays: 3, effShift: 3,
  rows: [{ cluster_key: 'x', games_now: 200, games_prev: 150, sum_placement_now: 800, sum_placement_prev: 700 }],
};

test('Velocity-Blob: passender Stand ist gueltig', () => {
  assert.equal(isValidMetaPulseVelocity(V_SNAP, V_WANT), true);
});

test('Velocity-Blob: anderes Fenster, Anker, Vorpatch oder weniger Spiele fallen durch', () => {
  assert.equal(isValidMetaPulseVelocity({ ...V_SNAP, effDays: 2 }, V_WANT), false);
  assert.equal(isValidMetaPulseVelocity({ ...V_SNAP, effShift: 2 }, V_WANT), false);
  assert.equal(isValidMetaPulseVelocity({ ...V_SNAP, anchorDay: '2026-09-29' }, V_WANT), false);
  assert.equal(isValidMetaPulseVelocity({ ...V_SNAP, mode: 'crossPatch' }, V_WANT), false);
  assert.equal(isValidMetaPulseVelocity({ ...V_SNAP, comparePatch: null }, V_WANT), false);
  assert.equal(isValidMetaPulseVelocity({ ...V_SNAP, totalMatches: 3_254_535 }, V_WANT), false);
  assert.equal(isValidMetaPulseVelocity({ ...V_SNAP, minGames: 30 }, V_WANT), false);
  assert.equal(isValidMetaPulseVelocity({ ...V_SNAP, generatedAt: new Date(V_NOW - META_PULSE_VELOCITY_MAX_AGE_MS - 1).toISOString() }, V_WANT), false);
});

test('Velocity-Blob: im Vorpatch-Modus zaehlt auch die Spielzahl des Vorpatches', () => {
  const w = { ...V_WANT.window, mode: 'crossPatch', effDays: 1, effShift: 1, velocityPatch: null };
  const want = { ...V_WANT, window: w };
  const snap = { ...V_SNAP, mode: 'crossPatch', effDays: 1, effShift: 1 };
  assert.equal(isValidMetaPulseVelocity(snap, want), true);
  assert.equal(isValidMetaPulseVelocity({ ...snap, compareTotalMatches: 4_999_999 }, want), false);
});

test('Velocity-Blob: Muell wird abgelehnt statt zu werfen', () => {
  for (const bad of [null, undefined, 'x', 42, [], {}, { ...V_SNAP, v: 2 }, { ...V_SNAP, rows: null }, { ...V_SNAP, generatedAt: 'kaputt' }]) {
    assert.equal(isValidMetaPulseVelocity(bad, V_WANT), false);
  }
});
