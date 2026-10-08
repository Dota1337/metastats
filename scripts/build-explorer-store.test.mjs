import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleRanges, addDays, daysBetween, buildWindow, dayPatchRows, diffDayPatch, decideMode, lockIsStale, rawSql, filesFor,
  SCRIPT_VERSION,
} from './build-explorer-store.mjs';

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

// ---------------------------------------------------------------------------
// Teil-Aufbau (seit 2026-10-08)

test('addDays / daysBetween: Monats- und Jahreswechsel', () => {
  assert.equal(addDays('2026-10-01', -1), '2026-09-30');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-10-01', '2026-10-08'), 7);
  assert.equal(daysBetween('2026-10-08', '2026-10-01'), -7);
});

test('buildWindow: Stichtag, Fenster, Frostgrenze, Lesegrenzen', () => {
  const w = buildWindow({ asof: '2026-10-08', days: 45 });
  assert.equal(w.n, '2026-10-08');
  assert.equal(w.w, '2026-08-24');
  assert.equal(w.f, '2026-10-01');
  assert.equal(w.wMs, Date.parse('2026-08-24T00:00:00Z'));
  assert.equal(w.endMs, Date.parse('2026-10-09T00:00:00Z'));
  assert.equal(buildWindow({ days: 10, now: Date.parse('2026-10-08T23:59:00Z') }).n, '2026-10-08');
  assert.throws(() => buildWindow({ asof: '08.10.2026', days: 45 }));
  assert.throws(() => buildWindow({ asof: '2026-10-08', days: 0 }));
});

test('dayPatchRows: Wechseltag, Gleichstand, Tag ohne Bereich', () => {
  const ranges = [
    { patch: '18.3', from: '2026-09-23', to: '2026-09-24' },
    { patch: '18.3b', from: '2026-09-24', to: OPEN },
    { patch: '18.9', from: '2026-09-26', to: '2026-09-26' },
    { patch: '18.10', from: '2026-09-26', to: '2026-09-26' },
  ];
  assert.deepEqual(dayPatchRows(ranges, '2026-09-22', '2026-09-26'), [
    { pday: '2026-09-22', patch: null, edge: false },
    { pday: '2026-09-23', patch: '18.3', edge: false },
    { pday: '2026-09-24', patch: '18.3b', edge: true },
    { pday: '2026-09-25', patch: '18.3b', edge: false },
    // drei Bereiche: spaetester Start gewinnt, bei gleichem Start der groessere Text
    { pday: '2026-09-26', patch: '18.9', edge: true },
  ]);
});

test('diffDayPatch: nur gemeinsame Tage, Patch oder Wechseltag geaendert', () => {
  const prev = [
    { pday: '2026-10-01', patch: '18.3b', edge: false },
    { pday: '2026-10-06', patch: '18.3b', edge: false },
    { pday: '2026-10-07', patch: '18.3b', edge: false },
  ];
  const curRows = [
    { pday: '2026-10-06', patch: '18.3b', edge: false },
    { pday: '2026-10-07', patch: '18.4', edge: true },
    { pday: '2026-10-08', patch: '18.4', edge: false },
  ];
  assert.deepEqual(diffDayPatch(prev, curRows), ['2026-10-07']);
  assert.deepEqual(diffDayPatch([{ pday: '2026-10-07', patch: null, edge: false }], [{ pday: '2026-10-07', patch: '18.4', edge: false }]), ['2026-10-07']);
  assert.deepEqual(diffDayPatch(prev, prev), []);
});

// Ausgangslage: gueltige Datei, Vollaufbau vor 2 Tagen, nichts geaendert.
const HASHES = { aliases: 'a', thresholds: 't', set: '18', days: '45' };
const okPrev = (over = {}) => ({
  kind: 'ok',
  meta: {
    watermarkMs: 1, scriptVersion: SCRIPT_VERSION, duckdbVersion: 'v1.5.0', hashes: { ...HASHES },
    nTupUpd: 100, lastFullMs: 5000, lastFullDay: '2026-10-06', nDay: '2026-10-07', nextBid: 10, testRun: false,
    ...over,
  },
});
const cur = (over = {}) => ({
  scriptVersion: SCRIPT_VERSION, duckdbVersion: 'v1.5.0', hashes: { ...HASHES }, nTupUpd: 100, testRun: false, n: '2026-10-08', ...over,
});
const decide = (o = {}) => decideMode({ prev: okPrev(), cur: cur(), f: '2026-10-01', todayUtc: '2026-10-08', ...o });

test('decideMode: nichts geaendert → Teil-Aufbau', () => {
  assert.deepEqual(decide(), { mode: 'delta', reasons: [] });
});

test('decideMode: jeder Pflichtgrund → Vollaufbau', () => {
  const cases = [
    { full: true },
    { marker: true },
    { prev: { kind: 'none' } },
    { prev: { kind: 'unreadable', error: 'kaputt' } },
    { prev: { kind: 'legacy' } },
    { prev: okPrev({ watermarkMs: null }) },
    { prev: okPrev({ nextBid: null }) },
    { prev: okPrev({ scriptVersion: SCRIPT_VERSION - 1 }) },
    { prev: okPrev({ duckdbVersion: 'v1.4.0' }) },
    { prev: okPrev({ hashes: { ...HASHES, thresholds: 'alt' } }) },
    { prev: okPrev({ hashes: null }) },
    { prev: okPrev({ nTupUpd: null }) },
    { cur: cur({ nTupUpd: null }) },
    { cur: cur({ nTupUpd: 101 }) },
    { prev: okPrev({ testRun: true }) },
    { patchChanged: ['2026-09-30'] },
    { cur: cur({ n: '2026-10-06' }) },
  ];
  for (const c of cases) {
    const r = decide(c);
    assert.equal(r.mode, 'full', JSON.stringify(c));
    assert.ok(r.reasons.length >= 1, JSON.stringify(c));
  }
});

test('decideMode: Patch-Aenderung ab Frostgrenze bleibt Teil-Aufbau', () => {
  assert.equal(decide({ patchChanged: ['2026-10-01', '2026-10-07'] }).mode, 'delta');
});

test('decideMode: Testlauf auf Testlauf bleibt Teil-Aufbau, echter Lauf nach Testlauf voll', () => {
  assert.equal(decide({ prev: okPrev({ testRun: true }), cur: cur({ testRun: true }) }).mode, 'delta');
  assert.equal(decide({ prev: okPrev({ testRun: true }) }).mode, 'full');
});

test('decideMode: Wochen-Turnus nach 7 Tagen oder ohne Datum', () => {
  assert.equal(decide({ prev: okPrev({ lastFullDay: '2026-10-02' }) }).mode, 'delta');
  assert.deepEqual(decide({ prev: okPrev({ lastFullDay: '2026-10-01' }) }), { mode: 'full', reasons: ['Wochen-Vollaufbau'] });
  assert.equal(decide({ prev: okPrev({ lastFullDay: null }) }).mode, 'full');
});

test('decideMode: heute gescheiterter Vollaufbau — Pflicht → skip, Turnus → Teil-Aufbau, --full setzt durch', () => {
  const stamp = { day: '2026-10-08', startedMs: 9000 };
  const skip = decide({ stamp, cur: cur({ nTupUpd: 101 }) });
  assert.equal(skip.mode, 'skip');
  assert.ok(skip.reasons.some((r) => r.includes('nicht fertig')));
  assert.equal(decide({ stamp, prev: okPrev({ lastFullDay: '2026-10-01' }) }).mode, 'delta');
  assert.equal(decide({ stamp, full: true }).mode, 'full');
  // Vollaufbau nach dem Stempel fertig geworden → nicht gesperrt
  assert.equal(decide({ stamp, prev: okPrev({ lastFullMs: 9500 }), cur: cur({ nTupUpd: 101 }) }).mode, 'full');
  // Stempel von gestern sperrt nicht
  assert.equal(decide({ stamp: { day: '2026-10-07', startedMs: 9000 }, cur: cur({ nTupUpd: 101 }) }).mode, 'full');
  // ohne vorige Datei: Pflicht + Stempel von heute → skip
  assert.equal(decide({ stamp, prev: { kind: 'none' } }).mode, 'skip');
});

test('lockIsStale: Neustart, toter Prozess, fremder Prozess, lebender Lauf', () => {
  const env = (o = {}) => ({ bootId: 'b1', isAlive: () => true, cmdline: () => 'node scripts/build-explorer-store.mjs', ...o });
  const info = { pid: 42, bootId: 'b1', startedAt: 'x' };
  assert.equal(lockIsStale(info, env()), false);
  assert.equal(lockIsStale({ ...info, bootId: 'b0' }, env()), true);
  assert.equal(lockIsStale(info, env({ isAlive: () => false })), true);
  assert.equal(lockIsStale(info, env({ cmdline: () => 'sshd: root' })), true);
  assert.equal(lockIsStale(info, env({ cmdline: () => null })), false);
  assert.equal(lockIsStale(null, env()), true);
  assert.equal(lockIsStale({ pid: 'x' }, env()), true);
});

test('rawSql: Fenster immer, Ankunftszeit und Limit nur wenn gesetzt', () => {
  const base = rawSql({ setNumber: META.setNumber, wMs: 1000, endMs: 2000 });
  assert.match(base, new RegExp(`set_number = ${META.setNumber} and queue_id = 1100`));
  assert.match(base, /game_datetime >= 1000 and game_datetime < 2000/);
  assert.doesNotMatch(base, /fetched_at >=|fetched_at <|limit/);
  const d = rawSql({ setNumber: META.setNumber, wMs: 1000, endMs: 2000, sinceMs: 1_700_000_000_000, untilMs: 1_700_000_360_000, limit: 5 });
  assert.match(d, /fetched_at >= to_timestamp\(1700000000\)/);
  assert.match(d, /fetched_at < to_timestamp\(1700000360\)/);
  assert.match(d, /limit 5$/);
  assert.match(d, /extract\(epoch from fetched_at\) \* 1000\)::bigint as fetched_ms/);
});

test('filesFor: Live-Datei behaelt status.json, Testdatei bekommt eigene', () => {
  const live = filesFor('/x/explorer/explorer.duckdb');
  assert.equal(live.status.replace(/\\/g, '/'), '/x/explorer/status.json');
  assert.equal(live.lock, '/x/explorer/explorer.duckdb.lock');
  assert.equal(live.marker.replace(/\\/g, '/'), '/x/explorer/force-full');
  assert.equal(filesFor('/x/eq/f2.duckdb').status.replace(/\\/g, '/'), '/x/eq/f2.status.json');
});
