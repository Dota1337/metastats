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
  trendAnchorOffsetDays,
  PATCH_DIFF_ENTITIES,
  PATCH_DIFF_RPC,
  PATCH_DIFF_COLUMNS,
  PATCH_DIFF_BUCKETS,
  patchDiffPath,
  normalizePatchDiffRows,
  isValidPatchDiff,
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

// Trend-Anker der Listen (Comps/Items/Units/Traits), Datenlage 01.10. 15:00 UTC:
// 18.3 seit 25.09., neuester Tag 30.09. (Teil-Tag), vollstaendig bis 29.09.
test('Trend-Anker: endet am letzten vollstaendigen Tag, nie am Teil-Tag', () => {
  const newest = { patch: '18.3', first_day: '2026-09-25', last_day: '2026-09-30' };
  const todayNum = Math.floor(at('2026-10-01T15:00:00Z') / 86_400_000);
  const base = { baseOffset: 1, completeDay: '2026-09-29', newest, patchFilter: null, todayNum };
  assert.equal(trendAnchorOffsetDays(base), 2);
  assert.equal(trendAnchorOffsetDays({ ...base, patchFilter: '18.3' }), 2);
  // Aelterer Patch explizit gewaehlt: unveraendert.
  assert.equal(trendAnchorOffsetDays({ ...base, patchFilter: '18.2' }), 1);
  // Alles vollstaendig oder keine Aussage: unveraendert.
  assert.equal(trendAnchorOffsetDays({ ...base, completeDay: '2026-09-30' }), 1);
  assert.equal(trendAnchorOffsetDays({ ...base, completeDay: null }), 1);
  assert.equal(trendAnchorOffsetDays({ ...base, newest: undefined }), 1);
  // Erster Teil-Tag eines neuen Patches: nicht in den Vorpatch zurueck (wie Meta-Pulse).
  assert.equal(trendAnchorOffsetDays({ ...base, newest: { ...newest, first_day: '2026-09-30' } }), 1);
  // Nie kleiner als der bisherige Anker (Pipeline-Rueckstand).
  assert.equal(trendAnchorOffsetDays({ ...base, baseOffset: 4 }), 4);
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
    [...src.matchAll(/^\s*(unit|item|trait|comp): args => callRpc<RpcRows>\('([a-z0-9_]+)'/gm)].map(m => [m[1], m[2]]),
  );
  assert.deepEqual(live, { ...PATCH_DIFF_RPC });
});

test('Patch-Diff: Zeilen werden einheitlich, Eigenschaften ueber Stufen zusammengezaehlt', () => {
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
    normalizePatchDiffRows('trait', [
      { name: 'TFT18_Mage', activation: 3, games: 100, sum_placement: 450, top4: 50, participants: 9000 },
      { name: 'TFT18_Mage', activation: 5, games: 40, sum_placement: 120, top4: 30, participants: 9000 },
      { name: 'TFT18_Tank', activation: 2, games: 60, sum_placement: 270, top4: 28, participants: 9000 },
    ]),
    [
      { key: 'TFT18_Mage', games: 140, sum_placement: 570, top4: 80, participants: 9000 },
      { key: 'TFT18_Tank', games: 60, sum_placement: 270, top4: 28, participants: 9000 },
    ],
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

test('Patch-Diff-Blob: Muell wird abgelehnt statt zu werfen', () => {
  for (const bad of [null, undefined, 'x', 42, [], {}, { ...PD_SNAP, v: 2 }, { ...PD_SNAP, rows: null }, { ...PD_SNAP, generatedAt: 'kaputt' }]) {
    assert.equal(isValidPatchDiff(bad, PD_WANT), false);
  }
});
