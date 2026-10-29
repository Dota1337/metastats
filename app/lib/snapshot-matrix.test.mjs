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
  metaPulseCompleteDay,
  fullDayComplete,
  dataWindow,
  addDays,
  transitionDataPatch,
  patchFilterCoversWindow,
  PATCH_DIFF_ENTITIES,
  PATCH_DIFF_RPC,
  PATCH_DIFF_COLUMNS,
  PATCH_DIFF_BUCKETS,
  PATCH_DIFF_CORE_BUCKETS,
  patchDiffPath,
  patchDiffWindowArgs,
  normalizePatchDiffRows,
  sumPatchDiffLevels,
  isValidPatchDiff,
  RUNNING_PATCH_GRACE_MS,
  compDeltaAssign,
  compFileAssigns,
  compFileWant,
  compMinRowGames,
  COMP_CLASSIC_MIN_ROW_GAMES,
} from './snapshot-matrix.ts';

const TODAY = new Date('2026-09-13T08:30:00Z');
const PATCHES = [
  { patch: '18.2', set_number: 18, first_day: '2026-09-10', last_day: '2026-09-11', total_matches: 1_130_000 },
  { patch: '18.1', set_number: 18, first_day: '2026-08-26', last_day: '2026-09-09', total_matches: 8_790_000 },
  { patch: '17.9', set_number: 17, first_day: '2026-08-12', last_day: '2026-08-26', total_matches: 900_000 },
];

test('Fenster: 2 Tage Rueckstand dehnen „Letzter Tag" bis zum letzten Datentag', () => {
  // day >= 13.09. - 2 = 11.09. → genau der letzte Datentag, nicht zwei.
  const r = listWindowDays({ requestedDays: 1, patchFilter: null, patchStartDay: '2026-09-10', latestDay: '2026-09-11', today: TODAY });
  assert.deepEqual(r, { days: 2, anchorOffsetDays: 2 });
});

test('Fenster: ohne Patch-Filter nie vor den Patch-Start (ab 10.09.)', () => {
  const r = listWindowDays({ requestedDays: 3, patchFilter: null, patchStartDay: '2026-09-10', latestDay: '2026-09-11', today: TODAY });
  assert.equal(r.days, 3);
  const seven = listWindowDays({ requestedDays: 7, patchFilter: null, patchStartDay: '2026-09-10', latestDay: '2026-09-11', today: TODAY });
  assert.equal(seven.days, 7);
});

test('Fenster: mit Patch-Filter wird nicht gekappt', () => {
  const r = listWindowDays({ requestedDays: 7, patchFilter: '18.2', patchStartDay: '2026-09-10', patchEndDay: '2026-09-11', latestDay: '2026-09-11', today: TODAY });
  assert.equal(r.days, 8);
});

test('Fenster: abgelaufener Patch zaehlt ab seinem letzten Tag', () => {
  // 18.1 endet 09.09.: 3 Tage = 07.-09.09. → day >= 13.09. - 6. Vor dem Fix
  // lag das Fenster hinter dem Patch-Ende und die Liste war leer.
  const r3 = listWindowDays({ requestedDays: 3, patchFilter: '18.1', patchStartDay: '2026-08-26', patchEndDay: '2026-09-09', latestDay: '2026-09-11', today: TODAY });
  assert.equal(r3.days, 6);
  const r7 = listWindowDays({ requestedDays: 7, patchFilter: '18.1', patchStartDay: '2026-08-26', patchEndDay: '2026-09-09', latestDay: '2026-09-11', today: TODAY });
  assert.equal(r7.days, 10);
  // Anzeige-Versatz bleibt der Rueckstand des Datenstands, nicht des Patches.
  assert.equal(r7.anchorOffsetDays, 2);
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
  // 18.2: 1 Tag = 11.09., ab 2 Tagen der ganze Patch ab 10.09. → zwei Eintraege je Gruppe.
  assert.equal(by('18.2').length, 2 * groups);
  assert.ok(by('18.2').every(j => ['2026-09-10', '2026-09-11'].includes(j.dataStart) && j.patchFirstDay === '2026-09-10'));
  // 17.9 ist ein anderes Set → kein Fall.
  assert.equal(by('17.9').length, 0);
  // aktuell ungefiltert: Stufen 2-3 werden auf den Patch-Start gekappt (gleicher Eintrag), sonst einzeln.
  const cur = by('').filter(j => j.bucketLabel === 'all').map(j => j.dataStart).sort();
  assert.deepEqual(cur, ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']);
  assert.ok(by('').every(j => j.patchFirstDay === null));
  const keys = jobs.map(j => `${j.patchKey}|${j.bucketLabel}|${j.dataStart}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('Jobs: data_start deckt sich mit der Lese-Funktion fuer jede Tagesstufe', () => {
  // Nachbau von get_tft_comp_list_precomputed: greatest(today - p_days, patch_first_day)
  const jobs = compPrecomputeJobs({ patches: PATCHES, setNumber: 18, today: TODAY });
  const cases = [
    { key: '', filter: null, start: '2026-09-10', end: null },
    { key: '18.2', filter: '18.2', start: '2026-09-10', end: '2026-09-11' },
    { key: '18.1', filter: '18.1', start: '2026-08-26', end: '2026-09-09' },
  ];
  for (const c of cases) {
    for (let d = 1; d <= 7; d++) {
      const { days } = listWindowDays({ requestedDays: d, patchFilter: c.filter, patchStartDay: c.start, patchEndDay: c.end, latestDay: '2026-09-11', today: TODAY });
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

// Vollstaendiger Tag: echte Eingangszeiten vom 01.10. (Tag 30.09.: euw1 10:10,
// kr 14:20, vn2 21:34 UTC) und die euw1-Luecke vom 22.09.
const REG3 = ['euw1', 'kr', 'vn2'];
const metaRow = (region, day, finished_at) => ({ region, day, finished_at });
const FULL_29 = REG3.map(r => metaRow(r, '2026-09-29', '2026-09-30T22:00:00Z'));
const at = (iso) => Date.parse(iso);

test('Vollstaendiger Tag: Teil-Tag zaehlt erst, wenn alle Regionen da sind', () => {
  const rows = [...FULL_29, metaRow('euw1', '2026-09-30', '2026-10-01T10:10:19Z'), metaRow('kr', '2026-09-30', '2026-10-01T14:20:00Z')];
  assert.equal(metaPulseCompleteDay(rows, REG3, at('2026-10-01T15:00:00Z')), '2026-09-29');
  rows.push(metaRow('vn2', '2026-09-30', '2026-10-01T21:34:52Z'));
  // 10 Minuten nach der letzten Region noch nicht, danach schon.
  assert.equal(metaPulseCompleteDay(rows, REG3, at('2026-10-01T21:40:00Z')), '2026-09-29');
  assert.equal(metaPulseCompleteDay(rows, REG3, at('2026-10-01T21:45:00Z')), '2026-09-30');
  // Einzelregion: nur ihr eigener Stand zaehlt.
  assert.equal(metaPulseCompleteDay(rows.slice(0, 4), ['euw1'], at('2026-10-01T15:00:00Z')), '2026-09-30');
});

test('Vollstaendiger Tag: Luecke am Vortag und ausgefallene Region halten den Anker nicht fest', () => {
  // euw1 fehlt am 22.09., am 24.09. mittags ist der 23.09. nur fuer euw1 da.
  const gap = [
    metaRow('kr', '2026-09-21', '2026-09-22T15:00:00Z'), metaRow('vn2', '2026-09-21', '2026-09-22T21:00:00Z'), metaRow('euw1', '2026-09-21', '2026-09-22T10:00:00Z'),
    metaRow('kr', '2026-09-22', '2026-09-23T15:00:00Z'), metaRow('vn2', '2026-09-22', '2026-09-23T21:00:00Z'),
    metaRow('euw1', '2026-09-23', '2026-09-24T10:00:00Z'),
  ];
  assert.equal(metaPulseCompleteDay(gap, REG3, at('2026-09-24T12:00:00Z')), '2026-09-22');
  // vn2 haengt seit dem 28.09. → faellt raus.
  const dead = [...FULL_29.filter(r => r.region !== 'vn2'), metaRow('vn2', '2026-09-28', '2026-09-29T21:00:00Z'),
    metaRow('euw1', '2026-09-30', '2026-10-01T10:10:00Z'), metaRow('kr', '2026-09-30', '2026-10-01T14:20:00Z')];
  assert.equal(metaPulseCompleteDay(dead, REG3, at('2026-10-01T15:00:00Z')), '2026-09-30');
  // Keine (fertigen) Zeilen → keine Aussage.
  assert.equal(metaPulseCompleteDay([], REG3, at('2026-10-01T15:00:00Z')), null);
  assert.equal(metaPulseCompleteDay([metaRow('kr', '2026-09-30', null)], REG3, at('2026-10-01T15:00:00Z')), null);
});

test('Velocity-Fenster: endet am vollstaendigen Tag, nur fuer den neuesten Patch und nur innerhalb des Patches', () => {
  assert.deepEqual(vWin({ completeDay: '2026-09-29' }), {
    mode: 'patch', effShift: 3, effDays: 2, velocityPatch: '18.3', anchorOffsetDays: 3, anchorDay: '2026-09-29',
  });
  // Vollstaendig = neuester Tag → unveraendert.
  assert.deepEqual(vWin({ completeDay: '2026-09-30' }), vWin());
  // Aelterer Patch: keine Wirkung.
  const old = { sel: { patch: '18.2', first_day: '2026-09-10', last_day: '2026-09-24' }, selIdx: 1, cmpLastDay: '2026-09-09' };
  assert.deepEqual(vWin({ ...old, completeDay: '2026-09-23' }), vWin(old));
  // Neuer Patch, erster Tag erst teilweise da: vollstaendiger Tag liegt im
  // Vorpatch → bisheriges Verhalten (Vergleich mit dem Vorpatch).
  const fresh = { sel: { patch: '18.4', first_day: '2026-09-30', last_day: '2026-09-30' }, cmpLastDay: '2026-09-29', previousPatch: '18.3' };
  assert.deepEqual(vWin({ ...fresh, completeDay: '2026-09-29' }), vWin(fresh));
  // 2-Tage-Patch, zweiter Tag unvollstaendig → 1 Tag uebrig → Vergleich mit dem Vorpatch.
  const two = { sel: { patch: '18.4', first_day: '2026-09-29', last_day: '2026-09-30' }, cmpLastDay: '2026-09-28', previousPatch: '18.3' };
  assert.deepEqual(vWin({ ...two, completeDay: '2026-09-29' }), {
    mode: 'crossPatch', effShift: 1, effDays: 1, velocityPatch: null, anchorOffsetDays: 3, anchorDay: '2026-09-29',
  });
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

test('Vollstaendiger Tag: Publisher ohne Wartezeit zaehlt die letzte Region sofort', () => {
  const rows = [...FULL_29, ...REG3.map(r => metaRow(r, '2026-09-30', '2026-10-01T21:34:52Z'))];
  assert.equal(metaPulseCompleteDay(rows, REG3, at('2026-10-01T21:36:00Z')), '2026-09-29');
  assert.equal(metaPulseCompleteDay(rows, REG3, at('2026-10-01T21:36:00Z'), 0), '2026-09-30');
});

// Patch-Gewinner (/api/tft/patch-diff, RSS-Feed): Rohzeilen je Patch × Art × Rang.
test('Patch-Diff: Rang-Gruppen entsprechen expandBuckets() der Route', async () => {
  const { expandBuckets } = await import('./tft-supabase-reader.ts');
  for (const [label, tiers] of Object.entries(PATCH_DIFF_BUCKETS)) {
    assert.equal(listKey(tiers), listKey(expandBuckets(label)), label);
  }
});

test('Patch-Diff: Pfad, Reihenfolge (Items zuletzt), jede Art hat Funktion und Spalten', () => {
  assert.equal(patchDiffPath('18.3b', 'unit', 'master_plus'), 'tft/patch-diff/18.3b/unit/all__master_plus.json');
  assert.equal(PATCH_DIFF_ENTITIES.at(-1), 'item');
  assert.equal(new Set(PATCH_DIFF_ENTITIES).size, 4);
  for (const e of PATCH_DIFF_ENTITIES) {
    assert.ok(PATCH_DIFF_RPC[e], e);
    assert.ok(PATCH_DIFF_COLUMNS[e].includes('games'), e);
  }
});

test('Patch-Diff: Live-Rueckfall der Route ruft dieselben Funktionen wie die Box', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../api/tft/patch-diff/route.ts', import.meta.url), 'utf8');
  const live = Object.fromEntries(
    [...src.matchAll(/^\s*(unit|item|trait|comp): \(args, ms\) => callRpc<RpcRows>\('([a-z0-9_]+)'/gm)].map(m => [m[1], m[2]]),
  );
  assert.deepEqual(live, { ...PATCH_DIFF_RPC });
});

test('Patch-Diff: jede Rang-Auswahl der Filterleiste hat vorgerechnete Dateien (18.10.2026)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../components/tft/StatsFilterBar.tsx', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('const BUCKET_OPTIONS'), src.indexOf('];', src.indexOf('const BUCKET_OPTIONS')));
  const values = [...block.matchAll(/^\s*\{ value: '([a-z_]+)'/gm)].map(m => m[1]);
  assert.ok(values.length >= 10, `nur ${values.length} Optionen gefunden`);
  for (const v of values) assert.ok(PATCH_DIFF_BUCKETS[v], `Rang-Auswahl ${v} fehlt in PATCH_DIFF_BUCKETS`);
  // Kern-Gruppen zuerst, alle existieren.
  for (const l of PATCH_DIFF_CORE_BUCKETS) assert.ok(PATCH_DIFF_BUCKETS[l], l);
});

test('Patch-Diff: Fenster genau ueber den Patch (18.10.2026)', () => {
  assert.deepEqual(patchDiffWindowArgs({ first_day: '2026-09-14', last_day: '2026-09-22' }), { p_days: 9, p_end_day: '2026-09-22' });
  assert.deepEqual(patchDiffWindowArgs({ first_day: '2026-09-23', last_day: '2026-09-23' }), { p_days: 1, p_end_day: '2026-09-23' });
  assert.equal(patchDiffWindowArgs({ first_day: '2026-09-23', last_day: '2026-09-22' }), null);
  assert.equal(patchDiffWindowArgs({}), null);
});

test('Patch-Diff: Trait-Stufen bleiben getrennt, sumPatchDiffLevels zaehlt sie zusammen', () => {
  const rows = normalizePatchDiffRows('trait', [
    { name: 'TFT18_Mage', activation: 3, games: 100, sum_placement: 450, top4: 50, participants: 9000 },
    { name: 'TFT18_Mage', activation: 5, games: 40, sum_placement: 120, top4: 30, participants: 9000 },
    { name: 'TFT18_Tank', activation: 2, games: 60, sum_placement: 270, top4: 28, participants: 9000 },
  ]);
  assert.deepEqual(rows, [
    { key: 'TFT18_Mage', level: 3, games: 100, sum_placement: 450, top4: 50, participants: 9000 },
    { key: 'TFT18_Mage', level: 5, games: 40, sum_placement: 120, top4: 30, participants: 9000 },
    { key: 'TFT18_Tank', level: 2, games: 60, sum_placement: 270, top4: 28, participants: 9000 },
  ]);
  assert.deepEqual(sumPatchDiffLevels(rows), [
    { key: 'TFT18_Mage', games: 140, sum_placement: 570, top4: 80, participants: 9000 },
    { key: 'TFT18_Tank', games: 60, sum_placement: 270, top4: 28, participants: 9000 },
  ]);
  // Alte Blobs (Stufen schon summiert) und andere Arten bleiben unveraendert.
  const legacy = [{ key: 'TFT18_Mage', games: 140, sum_placement: 570, top4: 80, participants: 9000 }];
  assert.deepEqual(sumPatchDiffLevels(legacy), legacy);
});

test('Patch-Diff: Zeilen werden einheitlich', () => {
  assert.deepEqual(
    normalizePatchDiffRows('unit', [
      { character_id: 'TFT18_Ahri', games: '120', sum_placement: '480', top4: '60', participants: '9000' },
      { character_id: 'TFT18_Vi', games: 80, sum_placement: 360, top4: 35, participants: 9000 },
    ]),
    [
      { key: 'TFT18_Ahri', games: 120, sum_placement: 480, top4: 60, participants: 9000 },
      { key: 'TFT18_Vi', games: 80, sum_placement: 360, top4: 35, participants: 9000 },
    ],
  );
  assert.deepEqual(
    normalizePatchDiffRows('item', [{ api_name: 'TFT_Item_Bloodthirster', games: 70, sum_placement: 280, top4: 40, total_item_slots: 5000 }]),
    [{ key: 'TFT_Item_Bloodthirster', games: 70, sum_placement: 280, top4: 40, participants: 5000 }],
  );
  assert.deepEqual(
    normalizePatchDiffRows('comp', [{ cluster_key: 'mage@8_ahri', games: 55, sum_placement: 220, top4: 30, participants: 9000 }]),
    [{ key: 'mage@8_ahri', games: 55, sum_placement: 220, top4: 30, participants: 9000 }],
  );
  assert.deepEqual(normalizePatchDiffRows('unit', []), []);
});

const PD_REGIONS = ['euw1', 'na1', 'kr'];
const PD_SNAP = {
  v: 1,
  generatedAt: '2026-10-08T03:00:00Z',
  set: 18,
  patch: '18.3b',
  entity: 'unit',
  lastDay: '2026-10-07',
  totalMatches: 3_000_000,
  regions: PD_REGIONS,
  buckets: [...PATCH_DIFF_BUCKETS.master_plus],
  days: 30,
  minGames: 50,
  rows: [],
};
const PD_WANT = {
  set: 18,
  patch: '18.3b',
  entity: 'unit',
  lastDay: '2026-10-07',
  totalMatches: 2_990_000,
  regions: ['kr', 'na1', 'euw1'],
  buckets: [...PATCH_DIFF_BUCKETS.master_plus],
  now: at('2026-10-08T09:00:00Z'),
  closed: false,
};

test('Patch-Diff-Blob: passender laufender und abgeschlossener Patch wird angenommen', () => {
  assert.equal(isValidPatchDiff(PD_SNAP, PD_WANT), true);
  // Abgeschlossen: andere Summe (180- gegen 30-Tage-Liste) zaehlt nicht.
  assert.equal(isValidPatchDiff({ ...PD_SNAP, totalMatches: 1_685_440 }, { ...PD_WANT, totalMatches: 5_125_888, closed: true }), true);
  assert.equal(isValidPatchDiff({ ...PD_SNAP, generatedAt: '2026-09-28T09:00:00Z' }, { ...PD_WANT, closed: true }), true);
});

test('Patch-Diff-Blob: weniger Spiele, zu alt, falscher Ausschnitt oder Zukunft fallen durch', () => {
  assert.equal(isValidPatchDiff({ ...PD_SNAP, totalMatches: 2_000_000 }, PD_WANT), false);
  assert.equal(isValidPatchDiff({ ...PD_SNAP, generatedAt: '2026-10-06T20:00:00Z' }, PD_WANT), false); // 37 h
  assert.equal(isValidPatchDiff({ ...PD_SNAP, generatedAt: '2026-09-23T08:00:00Z' }, { ...PD_WANT, closed: true }), false); // 15 d
  assert.equal(isValidPatchDiff({ ...PD_SNAP, entity: 'item' }, PD_WANT), false);
  assert.equal(isValidPatchDiff({ ...PD_SNAP, set: 17 }, PD_WANT), false);
  assert.equal(isValidPatchDiff({ ...PD_SNAP, patch: '18.3' }, PD_WANT), false);
  assert.equal(isValidPatchDiff({ ...PD_SNAP, regions: ['euw1'] }, PD_WANT), false);
  assert.equal(isValidPatchDiff({ ...PD_SNAP, buckets: ['challenger'] }, PD_WANT), false);
  assert.equal(isValidPatchDiff({ ...PD_SNAP, days: 7 }, PD_WANT), false);
  assert.equal(isValidPatchDiff({ ...PD_SNAP, minGames: 30 }, PD_WANT), false);
  assert.equal(isValidPatchDiff({ ...PD_SNAP, lastDay: '2026-10-06' }, PD_WANT), false);
  assert.equal(isValidPatchDiff({ ...PD_SNAP, generatedAt: '2026-10-08T09:30:00Z' }, PD_WANT), false);
});

test('Kulanz: junge Datei des laufenden Patches gilt beim Lesen trotz neuer Spiele (18.10.2026)', () => {
  const G = RUNNING_PATCH_GRACE_MS;
  const behind = { ...PD_SNAP, totalMatches: 2_000_000, generatedAt: '2026-10-08T08:00:00Z' }; // 1 h alt
  assert.equal(isValidPatchDiff(behind, PD_WANT), false); // Box: streng
  assert.equal(isValidPatchDiff(behind, { ...PD_WANT, graceMs: G }), true); // Leser
  // Neuer Tag in der Liste, Datei einen Kalendertag dahinter: gilt; zwei Tage: nicht.
  assert.equal(isValidPatchDiff(behind, { ...PD_WANT, lastDay: '2026-10-08', graceMs: G }), true);
  assert.equal(isValidPatchDiff(behind, { ...PD_WANT, lastDay: '2026-10-09', graceMs: G }), false);
  // Aelter als die Kulanz, abgeschlossener Patch, Datei aus der Zukunft: nicht.
  assert.equal(isValidPatchDiff({ ...behind, generatedAt: '2026-10-08T06:59:00Z' }, { ...PD_WANT, graceMs: G }), false);
  assert.equal(isValidPatchDiff({ ...PD_SNAP, lastDay: '2026-10-06', generatedAt: '2026-10-08T08:00:00Z' }, { ...PD_WANT, closed: true, graceMs: G }), false);
  assert.equal(isValidPatchDiff({ ...behind, generatedAt: '2026-10-08T09:30:00Z' }, { ...PD_WANT, graceMs: G }), false);
  // Ausschnitt bleibt streng.
  assert.equal(isValidPatchDiff({ ...behind, entity: 'item' }, { ...PD_WANT, graceMs: G }), false);

  const mpBehind = { ...MP_SNAP, totalMatches: 3_200_000 };
  assert.equal(isValidMetaPulseDiff(mpBehind, MP_WANT), false);
  assert.equal(isValidMetaPulseDiff(mpBehind, { ...MP_WANT, graceMs: G }), true);
  assert.equal(isValidMetaPulseDiff(mpBehind, { ...MP_WANT, closed: true, graceMs: G }), false);

  const vBehind = { ...V_SNAP, totalMatches: 3_200_000 };
  assert.equal(isValidMetaPulseVelocity(vBehind, V_WANT), false);
  assert.equal(isValidMetaPulseVelocity(vBehind, { ...V_WANT, graceMs: G }), true);
  assert.equal(isValidMetaPulseVelocity({ ...vBehind, effDays: 2 }, { ...V_WANT, graceMs: G }), false);
});

test('Patch-Diff-Blob: Patch-Fenster neu, altes 30-Tage-Fenster nur noch fuer Leser (18.10.2026)', () => {
  const windowed = { ...PD_SNAP, days: 13, window: 'patch' };
  assert.equal(isValidPatchDiff(windowed, PD_WANT), true);
  assert.equal(isValidPatchDiff(windowed, { ...PD_WANT, requireWindow: true }), true);
  // Alter Blob: Leser nimmt ihn noch, die Box rechnet ihn neu.
  assert.equal(isValidPatchDiff(PD_SNAP, PD_WANT), true);
  assert.equal(isValidPatchDiff(PD_SNAP, { ...PD_WANT, requireWindow: true }), false);
  assert.equal(isValidPatchDiff({ ...windowed, days: 0 }, PD_WANT), false);
  assert.equal(isValidPatchDiff({ ...windowed, window: 'tage' }, PD_WANT), false);
});

test('Patch-Diff-Blob: Muell wird abgelehnt statt zu werfen', () => {
  for (const bad of [null, undefined, 'x', 42, [], {}, { ...PD_SNAP, v: 2 }, { ...PD_SNAP, rows: null }, { ...PD_SNAP, generatedAt: 'kaputt' }]) {
    assert.equal(isValidPatchDiff(bad, PD_WANT), false);
  }
});

// ---------------------------------------------------------------------------
// Volle Tage (User 15.10.2026): „N Tage" = die letzten N vollstaendigen Tage.

test('Volle Tage: Tag zaehlt erst, wenn alle Regionen ihn geliefert haben', () => {
  const rows = [...FULL_29, metaRow('euw1', '2026-09-30', '2026-10-01T10:10:19Z'), metaRow('kr', '2026-09-30', '2026-10-01T14:20:00Z')];
  assert.equal(fullDayComplete(rows, REG3, at('2026-10-01T15:00:00Z')), '2026-09-29');
  rows.push(metaRow('vn2', '2026-09-30', '2026-10-01T21:34:52Z'));
  assert.equal(fullDayComplete(rows, REG3, at('2026-10-01T21:40:00Z')), '2026-09-29');
  assert.equal(fullDayComplete(rows, REG3, at('2026-10-01T21:45:00Z')), '2026-09-30');
  // Publisher ohne Wartezeit.
  assert.equal(fullDayComplete(rows, REG3, at('2026-10-01T21:36:00Z'), 0), '2026-09-30');
  // Mehrere Zeilen je Region und Tag (eine je Rang) stoeren nicht.
  assert.equal(fullDayComplete([...rows, ...rows], REG3, at('2026-10-01T21:45:00Z')), '2026-09-30');
});

test('Volle Tage: Luecke einer Region macht den Tag nicht vollstaendig (data-skeptic F1)', () => {
  // euw1 fehlt am 22.09. — metaPulseCompleteDay nennt den 22.09., hier zaehlt erst der 21.09.
  const gap = [
    metaRow('kr', '2026-09-21', '2026-09-22T15:00:00Z'), metaRow('vn2', '2026-09-21', '2026-09-22T21:00:00Z'), metaRow('euw1', '2026-09-21', '2026-09-22T10:00:00Z'),
    metaRow('kr', '2026-09-22', '2026-09-23T15:00:00Z'), metaRow('vn2', '2026-09-22', '2026-09-23T21:00:00Z'),
    metaRow('euw1', '2026-09-23', '2026-09-24T10:00:00Z'),
  ];
  assert.equal(metaPulseCompleteDay(gap, REG3, at('2026-09-24T12:00:00Z')), '2026-09-22');
  assert.equal(fullDayComplete(gap, REG3, at('2026-09-24T12:00:00Z')), '2026-09-21');
  // Sobald alle den 23.09. haben, ist er der Endtag (der 22.09. bleibt eine Luecke im Fenster).
  const later = [...gap, metaRow('kr', '2026-09-23', '2026-09-24T15:00:00Z'), metaRow('vn2', '2026-09-23', '2026-09-24T21:00:00Z')];
  assert.equal(fullDayComplete(later, REG3, at('2026-09-24T22:00:00Z')), '2026-09-23');
  // Ausgefallene Region (vn2 seit 28.09.) haelt den Tag nicht fest.
  const dead = [...FULL_29.filter(r => r.region !== 'vn2'), metaRow('vn2', '2026-09-28', '2026-09-29T21:00:00Z'),
    metaRow('euw1', '2026-09-30', '2026-10-01T10:10:00Z'), metaRow('kr', '2026-09-30', '2026-10-01T14:20:00Z')];
  assert.equal(fullDayComplete(dead, REG3, at('2026-10-01T15:00:00Z')), '2026-09-30');
  // Keine (fertigen) Zeilen → keine Aussage.
  assert.equal(fullDayComplete([], REG3, at('2026-10-01T15:00:00Z')), null);
  assert.equal(fullDayComplete([metaRow('kr', '2026-09-30', null)], REG3, at('2026-10-01T15:00:00Z')), null);
});

// Datenlage 15.10.: 18.4 seit 08.10., neuester Tag 14.10. (halb), voll bis 13.10.
const P184 = { first_day: '2026-10-08', last_day: '2026-10-14' };

test('Fenster volle Tage: endet am Endtag, N Tage, ohne Filter nicht am Patch-Start gekappt', () => {
  assert.deepEqual(dataWindow({ dataEnd: '2026-10-13', requestedDays: 3, patchFilter: null, patch: P184 }),
    { startDay: '2026-10-11', endDay: '2026-10-13', days: 3 });
  assert.deepEqual(dataWindow({ dataEnd: '2026-10-13', requestedDays: 1, patchFilter: null, patch: P184 }),
    { startDay: '2026-10-13', endDay: '2026-10-13', days: 1 });
  assert.deepEqual(dataWindow({ dataEnd: '2026-10-13', requestedDays: 7, patchFilter: null, patch: P184 }),
    { startDay: '2026-10-07', endDay: '2026-10-13', days: 7 });
  // ?patch=any / kein Vorpatch: kein Patch bekannt → nur der Endtag zaehlt.
  assert.deepEqual(dataWindow({ dataEnd: '2026-10-13', requestedDays: 2, patchFilter: '__kein_vorpatch__', patch: undefined }),
    { startDay: '2026-10-12', endDay: '2026-10-13', days: 2 });
});

test('Fenster volle Tage: Patch-Filter kappt am Start, beendeter Patch endet an seinem letzten Tag', () => {
  assert.deepEqual(dataWindow({ dataEnd: '2026-10-13', requestedDays: 7, patchFilter: '18.4', patch: P184 }),
    { startDay: '2026-10-08', endDay: '2026-10-13', days: 6 });
  assert.deepEqual(dataWindow({ dataEnd: '2026-10-13', requestedDays: 3, patchFilter: '18.3', patch: { first_day: '2026-09-24', last_day: '2026-10-07' } }),
    { startDay: '2026-10-05', endDay: '2026-10-07', days: 3 });
});

test('Fenster volle Tage: neuer Patch ohne vollen Tag zeigt seine Teildaten (User 15.10.)', () => {
  const p185 = { first_day: '2026-10-21', last_day: '2026-10-21' };
  assert.deepEqual(dataWindow({ dataEnd: '2026-10-20', requestedDays: 3, patchFilter: null, patch: p185 }),
    { startDay: '2026-10-19', endDay: '2026-10-21', days: 3 });
  assert.deepEqual(dataWindow({ dataEnd: '2026-10-20', requestedDays: 3, patchFilter: '18.5', patch: p185 }),
    { startDay: '2026-10-21', endDay: '2026-10-21', days: 1 });
  // Sobald der erste Tag voll ist, gilt wieder der Endtag.
  assert.deepEqual(dataWindow({ dataEnd: '2026-10-21', requestedDays: 3, patchFilter: null, patch: { ...p185, last_day: '2026-10-22' } }),
    { startDay: '2026-10-19', endDay: '2026-10-21', days: 3 });
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('Jobs volle Tage: Fenster je Stufe wie dataWindow, Ende im Schluessel', () => {
  const dataEnd = '2026-09-11';
  const jobs = compPrecomputeJobs({ patches: PATCHES, setNumber: 18, today: TODAY, dataEnd });
  assert.ok(jobs.every(j => j.fullDay));
  const cases = [
    { key: '', filter: null, row: PATCHES[0] },
    { key: '18.2', filter: '18.2', row: PATCHES[0] },
    { key: '18.1', filter: '18.1', row: PATCHES[1] },
  ];
  for (const c of cases) {
    for (let d = 1; d <= 7; d++) {
      const w = dataWindow({ dataEnd, requestedDays: d, patchFilter: c.filter, patch: c.row });
      for (const b of Object.keys(COMP_PRECOMPUTE_BUCKETS)) {
        assert.ok(
          jobs.some(j => j.patchKey === c.key && j.bucketLabel === b && j.dataStart === w.startDay && j.windowEnd === w.endDay && j.days === w.days),
          `kein Eintrag fuer ${c.key || 'aktuell'}/${b}/${d}d (${w.startDay}..${w.endDay})`,
        );
      }
    }
  }
  const groups = Object.keys(COMP_PRECOMPUTE_BUCKETS).length;
  assert.equal(jobs.filter(j => j.patchKey === '').length, 7 * groups);
  assert.equal(jobs.filter(j => j.patchKey === '18.2').length, 2 * groups);
  assert.ok(jobs.filter(j => j.patchKey === '18.1').every(j => j.windowEnd === '2026-09-09'));
  const keys = jobs.map(j => `${j.patchKey}|${j.bucketLabel}|${j.dataStart}|${j.windowEnd}`);
  assert.equal(new Set(keys).size, keys.length);
  // Ohne Endtag: altes Fenster, Ende = letzter Datentag (beendeter Patch: sein letzter Tag).
  const legacy = compPrecomputeJobs({ patches: PATCHES, setNumber: 18, today: TODAY });
  assert.ok(legacy.every(j => !j.fullDay));
  assert.ok(legacy.filter(j => j.patchKey !== '18.1').every(j => j.windowEnd === '2026-09-11'));
  assert.ok(legacy.filter(j => j.patchKey === '18.1').every(j => j.windowEnd === '2026-09-09'));
});

test('Eintrag volle Tage: nur mit gleichem Fenster-Ende', () => {
  const now = Date.parse('2026-09-13T09:00:00Z');
  const e = { last_day: '2026-09-12', window_end: '2026-09-11', min_games: 30, computed_at: '2026-09-13T06:30:00Z' };
  const o = { latestDay: '2026-09-12', endDay: '2026-09-11', requestedMinGames: 30, now };
  assert.equal(precomputedEntryUsable(e, o), true);
  assert.equal(precomputedEntryUsable(e, { ...o, endDay: '2026-09-12' }), false);
  assert.equal(precomputedEntryUsable({ ...e, window_end: undefined }, o), false);
  assert.equal(precomputedEntryUsable(e, { ...o, requestedMinGames: 10 }), false);
  // Ohne endDay der bisherige Vergleich ueber last_day.
  assert.equal(precomputedEntryUsable(e, { ...o, endDay: null }), true);
  assert.equal(precomputedEntryUsable(e, { ...o, endDay: null, latestDay: '2026-09-11' }), false);
});

// Comp-Katalog Phase 3 (Migration 0102): Comps vergleichen nur gleich
// gezaehlte Patches. Route, Startdaten und Box muessen dieselbe Datei waehlen.
test('Zaehlart: Vergleich nur zwischen gleich gezaehlten Patches (D2 streng)', () => {
  const d = (marked, classic) => ({ marked, classic });
  assert.equal(compDeltaAssign(d(0, 0), d(0, 0)), 'classic'); // ohne Eintrag: klassisch wie vor 0107
  assert.equal(compDeltaAssign(d(0, 30), d(0, 210)), 'classic');
  assert.equal(compDeltaAssign(d(9, 0), d(140, 0)), 'catalog');
  // Beide mit Katalog-Tagen: Katalog gewinnt, auch wenn beide klassische haben.
  assert.equal(compDeltaAssign(d(9, 30), d(140, 20)), 'catalog');
  // Gemischter Patch (18.5b: 4 Katalog-, 2 klassische Tage) gegen rein klassischen (18.4).
  assert.equal(compDeltaAssign(d(60, 30), d(0, 210)), 'classic');
  // Neuer Patch nur Katalog gegen gemischten Vorpatch: Katalog.
  assert.equal(compDeltaAssign(d(15, 0), d(60, 30)), 'catalog');
  assert.equal(compDeltaAssign(d(9, 0), d(0, 210)), null); // nur Katalog gegen nur klassisch
  assert.equal(compDeltaAssign(d(0, 30), d(140, 0)), null); // Anlauf-Tage gegen reinen Katalog-Patch
  assert.equal(compDeltaAssign(d(9, 0), d(0, 0)), null);
  assert.deepEqual(compFileAssigns(d(0, 0)), ['classic']);
  assert.deepEqual(compFileAssigns(d(0, 210)), ['classic']);
  assert.deepEqual(compFileAssigns(d(1, 0)), ['catalog']);
  assert.deepEqual(compFileAssigns(d(60, 30)), ['catalog', 'classic']);
});

test('Zaehlart: Grenze 8 nur fuer die klassische Seite eines gemischten Patches', () => {
  const d = (marked, classic) => ({ marked, classic });
  assert.equal(compMinRowGames('classic', d(60, 30)), COMP_CLASSIC_MIN_ROW_GAMES);
  assert.equal(COMP_CLASSIC_MIN_ROW_GAMES, 8);
  assert.equal(compMinRowGames('classic', d(0, 210)), null);
  assert.equal(compMinRowGames('catalog', d(60, 30)), null);
  assert.deepEqual(compFileWant('classic', d(0, 210)), { assign: 'classic', markedDays: 0 });
  assert.deepEqual(compFileWant('catalog', d(60, 30)), { assign: 'catalog', markedDays: 60 });
  assert.deepEqual(compFileWant('classic', d(60, 30)), { assign: 'classic', markedDays: 60, classicDays: 30, minRowGames: 8 });
});

test('Zaehlart: klassische Fassung eines gemischten Patches gilt nur mit gleichen klassischen Tagen', () => {
  const d = { marked: 60, classic: 30 };
  // Meta Pulse: Patch waechst weiter (letzter Tag, Spiele) — die Datei bleibt gueltig.
  const mpWant = { ...MP_WANT, lastDay: '2026-10-05', totalMatches: 9_000_000, ...compFileWant('classic', d) };
  const mpFile = { ...MP_SNAP, assign: 'classic', markedDays: 40, classicDays: 30, minRowGames: 8 };
  assert.equal(isValidMetaPulseDiff(mpFile, mpWant), true);
  assert.equal(isValidMetaPulseDiff({ ...mpFile, classicDays: 29 }, mpWant), false);
  assert.equal(isValidMetaPulseDiff({ ...mpFile, minRowGames: undefined }, mpWant), false); // alte Datei ohne Grenze
  assert.equal(isValidMetaPulseDiff(MP_SNAP, mpWant), false);
  // 13 Tage alt: gilt noch (wie abgeschlossen), 15 Tage nicht.
  assert.equal(isValidMetaPulseDiff({ ...mpFile, generatedAt: new Date(MP_NOW - 13 * 86_400_000).toISOString() }, mpWant), true);
  assert.equal(isValidMetaPulseDiff({ ...mpFile, generatedAt: new Date(MP_NOW - 15 * 86_400_000).toISOString() }, mpWant), false);
  // Rein klassischer Patch: alte Datei ohne Grenze gilt weiter, eine mit Grenze nicht.
  const plain = { ...MP_WANT, ...compFileWant('classic', { marked: 0, classic: 210 }) };
  assert.equal(isValidMetaPulseDiff(MP_SNAP, plain), true);
  assert.equal(isValidMetaPulseDiff(mpFile, plain), false);
  // Patch-Gewinner (Comps) mit derselben Regel.
  const pdWant = { ...PD_WANT, entity: 'comp', lastDay: '2026-10-20', totalMatches: 9_000_000, ...compFileWant('classic', d) };
  const pdFile = { ...PD_SNAP, entity: 'comp', window: 'patch', days: 6, assign: 'classic', markedDays: 40, classicDays: 30, minRowGames: 8 };
  assert.equal(isValidPatchDiff(pdFile, pdWant), true);
  assert.equal(isValidPatchDiff({ ...pdFile, classicDays: 31 }, pdWant), false);
  assert.equal(isValidPatchDiff({ ...pdFile, minRowGames: undefined, classicDays: undefined }, pdWant), false);
  assert.equal(isValidPatchDiff(pdFile, { ...PD_WANT, entity: 'comp', assign: 'classic', markedDays: 0 }), false);
});

test('Zaehlart: Katalog-Dateien liegen in eigenem Ordner, nur Comps', () => {
  assert.equal(metaPulseDiffPath('18.5', 'all'), 'tft/meta-pulse/diff/18.5/all__all.json');
  assert.equal(metaPulseDiffPath('18.5', 'all', 'catalog'), 'tft/meta-pulse/diff/18.5/catalog/all__all.json');
  assert.equal(patchDiffPath('18.5', 'comp', 'all', 'catalog'), 'tft/patch-diff/18.5/comp/catalog/all__all.json');
  assert.equal(patchDiffPath('18.5', 'comp', 'all'), 'tft/patch-diff/18.5/comp/all__all.json');
  assert.equal(patchDiffPath('18.5', 'unit', 'all', 'catalog'), 'tft/patch-diff/18.5/unit/all__all.json');
});

test('Zaehlart: Datei ohne Feld gilt als klassisch, andere Zaehlart faellt durch', () => {
  const pdComp = { ...PD_SNAP, entity: 'comp' };
  const pdWant = { ...PD_WANT, entity: 'comp' };
  assert.equal(isValidPatchDiff(pdComp, pdWant), true);
  assert.equal(isValidPatchDiff(pdComp, { ...pdWant, assign: 'classic', markedDays: 0 }), true);
  assert.equal(isValidPatchDiff(pdComp, { ...pdWant, assign: 'catalog', markedDays: 9 }), false);
  assert.equal(isValidPatchDiff({ ...pdComp, assign: 'catalog', markedDays: 9 }, pdWant), false);
  assert.equal(isValidPatchDiff({ ...pdComp, assign: 'catalog', markedDays: 9 }, { ...pdWant, assign: 'catalog', markedDays: 9 }), true);
  // Units kennen keine Zaehlart.
  assert.equal(isValidPatchDiff({ ...PD_SNAP, assign: 'catalog' }, { ...PD_WANT, assign: 'classic' }), true);
  assert.equal(isValidMetaPulseDiff(MP_SNAP, { ...MP_WANT, assign: 'catalog', markedDays: 9 }), false);
  assert.equal(isValidMetaPulseDiff({ ...MP_SNAP, assign: 'catalog', markedDays: 9 }, { ...MP_WANT, assign: 'catalog', markedDays: 9 }), true);
});

test('Zaehlart: weniger Katalog-Tage als bekannt = veraltet (Kulanz wie bei Spielen)', () => {
  const G = RUNNING_PATCH_GRACE_MS;
  const cat = { ...MP_SNAP, assign: 'catalog', markedDays: 9 };
  const want = { ...MP_WANT, assign: 'catalog', markedDays: 18 };
  assert.equal(isValidMetaPulseDiff(cat, want), false);
  assert.equal(isValidMetaPulseDiff(cat, { ...want, graceMs: G }), true);
  assert.equal(isValidMetaPulseDiff(cat, { ...want, markedDays: 9 }), true);
  assert.equal(isValidMetaPulseVelocity({ ...V_SNAP, markedDays: 9 }, { ...V_WANT, markedDays: 18 }), false);
  assert.equal(isValidMetaPulseVelocity({ ...V_SNAP, markedDays: 18 }, { ...V_WANT, markedDays: 18 }), true);
  assert.equal(isValidMetaPulseVelocity(V_SNAP, V_WANT), true); // alte Datei ohne Feld, kein Katalog
});

// Uebergangszeit nach einem Patchwechsel (User 23./24.10.2026). Datenlage vom
// 24.10.: 18.5b ab 22.10., 18.5 nur 21.10.; Manifest noch auf 18.5, dataThrough 21.
const P_TRANS = [
  { patch: '18.5b', set_number: 18, first_day: '2026-10-22', last_day: '2026-10-24', total_matches: 421_032 },
  { patch: '18.5', set_number: 18, first_day: '2026-10-21', last_day: '2026-10-21', total_matches: 300_000 },
  { patch: '18.4', set_number: 18, first_day: '2026-10-07', last_day: '2026-10-20', total_matches: 4_000_000 },
];

test('Daten-Pin: current rechnet in der Uebergangszeit mit dem Patch des Manifests', () => {
  const base = { alias: 'current', livePatches: P_TRANS, manifestPatch: '18.5', setNumber: 18 };
  assert.equal(transitionDataPatch(base), '18.5');
  // Manifest hat den neuen Stand → kein Pin.
  assert.equal(transitionDataPatch({ ...base, manifestPatch: '18.5b' }), null);
  // Nur der Alias current — ein gewaehlter Patch und previous zeigen ihre echten Tage.
  assert.equal(transitionDataPatch({ ...base, alias: '18.5b' }), null);
  assert.equal(transitionDataPatch({ ...base, alias: 'previous' }), null);
  assert.equal(transitionDataPatch({ ...base, alias: 'any' }), null);
  // Patch fehlt in der Liste, anderes Set, set=any, kein Manifest → kein Pin.
  assert.equal(transitionDataPatch({ ...base, manifestPatch: '18.5x' }), null);
  assert.equal(transitionDataPatch({ ...base, setNumber: 19 }), null);
  assert.equal(transitionDataPatch({ ...base, setNumber: null }), null);
  assert.equal(transitionDataPatch({ ...base, manifestPatch: null }), null);
  assert.equal(transitionDataPatch({ ...base, livePatches: [] }), null);
  // set_number kommt aus der RPC teils als Text.
  assert.equal(transitionDataPatch({ ...base, livePatches: P_TRANS.map(p => ({ ...p, set_number: '18' })) }), '18.5');
});

test('Daten-Pin: Fenster aus der Manifest-Zeile endet am abgelegten Tag', () => {
  const row = p => P_TRANS.find(x => x.patch === p);
  // Mit Pin: 19.–21.10. wie der abgelegte Stand.
  assert.deepEqual(dataWindow({ dataEnd: '2026-10-21', requestedDays: 3, patchFilter: null, patch: row('18.5') }),
    { startDay: '2026-10-19', endDay: '2026-10-21', days: 3 });
  // Ohne Pin (der Fehler vom 23.10.): Patch-Tag-Ausnahme schiebt das Ende auf
  // den letzten Tag von 18.5b → kein Stand passt, alles laeuft live.
  assert.deepEqual(dataWindow({ dataEnd: '2026-10-21', requestedDays: 3, patchFilter: null, patch: row('18.5b') }),
    { startDay: '2026-10-22', endDay: '2026-10-24', days: 3 });
});

test('Patch-Filter aendert im Vorrats-Fenster nichts nur ohne fremde Tage', () => {
  const cov = (patchFilter, endDay, requestedDays, patches = P_TRANS) => patchFilterCoversWindow({ patchFilter, endDay, requestedDays, patches });
  // Live 24.10.: ?patch=18.5b, Endtag 22, 3 Tage → Vorrat ohne Filter zaehlt
  // 20.–22.10. (+ Endtag + 1) → 18.4 und 18.5 haben Tage darin → live rechnen.
  assert.equal(cov('18.5b', '2026-10-22', 3), false);
  assert.equal(cov('18.5b', '2026-10-22', 1), true, '22.–23.10. ganz in 18.5b');
  assert.equal(cov('18.5b', '2026-10-23', 2), true);
  assert.equal(cov('18.5b', '2026-10-24', 1), false, 'Endtag + 1 liegt hinter dem letzten Tag');
  assert.equal(cov('18.4', '2026-10-18', 3), true);
  assert.equal(cov('18.4', '2026-10-20', 3), false, 'Endtag + 1 = 21.10. gehoert zu 18.5');
  assert.equal(cov(null, '2026-10-22', 1), false);
  assert.equal(cov('18.5b', null, 1), false);
  assert.equal(cov('18.9', '2026-10-22', 1), false);
  // Unbekannte Grenzen eines anderen Patches zaehlen als Ueberschneidung.
  assert.equal(cov('18.5b', '2026-10-22', 1, [...P_TRANS, { patch: '18.6', first_day: '', last_day: '' }]), false);
});
