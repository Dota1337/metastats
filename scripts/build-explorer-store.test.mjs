import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleRanges, addDays, daysBetween, buildWindow, dayPatchRows, diffDayPatch, decideMode, scanAlarm, lockIsStale, rawSql, filesFor,
  SCRIPT_VERSION, inFullWindow, buildCodeHash, CODE_FILES,
  diskGate, spillCapBytes, CYCLE_REASON, DISK_FULL_FACTOR, DISK_DELTA_FACTOR, DISK_FIRST_BYTES, DISK_SPILL_MIN_BYTES,
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
  scriptVersion: SCRIPT_VERSION, duckdbVersion: 'v1.5.0', hashes: { ...HASHES }, nTupUpd: 100, testRun: false, n: '2026-10-08',
  code: 'c1', ...over,
});
// Start 20 Uhr UTC = im Abendfenster.
const decide = (o = {}) => decideMode({ prev: okPrev(), cur: cur(), f: '2026-10-01', hourUtc: 20, ...o });

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

test('decideMode: mit diesem Code gescheiterter Vollaufbau — Pflicht → skip, Turnus → Teil-Aufbau, --full setzt durch', () => {
  // Stempel vom Vortag: die Sperre haengt am Code, nicht am Tag (Tages-Timer → sonst jede Nacht ein Versuch).
  const stamp = { day: '2026-10-07', startedMs: 9000, code: 'c1' };
  const skip = decide({ stamp, cur: cur({ nTupUpd: 101 }) });
  assert.equal(skip.mode, 'skip');
  assert.equal(skip.blocked, true);
  assert.ok(skip.reasons.some((r) => r.includes('nicht fertig')));
  const turn = decide({ stamp, prev: okPrev({ lastFullDay: '2026-10-01' }) });
  assert.equal(turn.mode, 'delta');
  assert.equal(turn.blocked, true);
  assert.equal(decide({ stamp, full: true }).mode, 'full');
  // Vollaufbau nach dem Stempel fertig geworden → nicht gesperrt
  assert.equal(decide({ stamp, prev: okPrev({ lastFullMs: 9500 }), cur: cur({ nTupUpd: 101 }) }).mode, 'full');
  // neuer Code → neuer Versuch; Stempel ohne Code (alte Form) sperrt nicht
  assert.equal(decide({ stamp, cur: cur({ nTupUpd: 101, code: 'c2' }) }).mode, 'full');
  assert.equal(decide({ stamp: { day: '2026-10-08', startedMs: 9000 }, cur: cur({ nTupUpd: 101 }) }).mode, 'full');
  // ohne vorige Datei: Pflicht + gleicher Code → skip
  assert.equal(decide({ stamp, prev: { kind: 'none' } }).mode, 'skip');
  // nicht gesperrt → kein blocked-Feld
  assert.equal(decide().blocked, undefined);
});

test('decideMode: Wochen-Turnus nur im Abendfenster, Pflichtgruende jederzeit', () => {
  const due = { prev: okPrev({ lastFullDay: '2026-10-01' }) };
  for (const h of [17, 19, 23]) assert.deepEqual(decide({ ...due, hourUtc: h }), { mode: 'full', reasons: ['Wochen-Vollaufbau'] }, `h=${h}`);
  for (const h of [0, 1, 2, 16, undefined]) {
    const r = decide({ ...due, hourUtc: h });
    assert.equal(r.mode, 'delta', `h=${h}`);
    assert.ok(r.reasons[0].includes('ausserhalb'), `h=${h}`);
  }
  assert.equal(decide({ cur: cur({ nTupUpd: 101 }), hourUtc: 1 }).mode, 'full');
  assert.equal(decide({ full: true, hourUtc: 1 }).mode, 'full');
  assert.equal(inFullWindow(24), false);
  assert.equal(inFullWindow(17), true);
});

test('buildCodeHash: haengt an jedem Bau-Skript', () => {
  const files = Object.fromEntries(CODE_FILES.map((f) => [f, `inhalt ${f}`]));
  const h = buildCodeHash((f) => files[f]);
  assert.match(h, /^[0-9a-f]{12}$/);
  for (const f of CODE_FILES) {
    assert.notEqual(buildCodeHash((g) => (g === f ? `${files[g]}!` : files[g])), h, f);
  }
  assert.match(buildCodeHash(), /^[0-9a-f]{12}$/);
});

test('scanAlarm: nur im Teil-Aufbau ueber 600 s, nie im Vollaufbau', () => {
  assert.equal(scanAlarm({ mode: 'delta', scanS: 601 }), 'Postgres-Lesen 601 s (Grenze 600 s)');
  assert.equal(scanAlarm({ mode: 'delta', scanS: 600 }), null);
  assert.equal(scanAlarm({ mode: 'full', scanS: 989.6 }), null);
  assert.equal(scanAlarm({ mode: 'full', scanS: 6001 }), null);
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

test('diskGate: genug Platz → Entscheidung bleibt, mit Bedarf', () => {
  const G = 2 ** 30;
  const r = diskGate({ decision: { mode: 'full', reasons: [CYCLE_REASON] }, freeBytes: 117 * G, prevBytes: 4.33 * G, reserveBytes: 10 * G });
  assert.equal(r.mode, 'full');
  assert.equal(r.disk.needBytes, 10 * G + Math.ceil(4.33 * G * DISK_FULL_FACTOR));
  assert.equal(r.diskAlarm, undefined);
  const d = diskGate({ decision: { mode: 'delta', reasons: [] }, freeBytes: 27 * G, prevBytes: 4.33 * G, reserveBytes: 10 * G });
  assert.deepEqual([d.mode, d.disk.needBytes], ['delta', 10 * G + Math.ceil(4.33 * G * DISK_DELTA_FACTOR)]);
});

test('diskGate: 17.10. (27 GB frei) — Wochen-Turnus wird Teil-Aufbau, Pflicht wird skip, ohne Stempel-Folgen', () => {
  const G = 2 ** 30;
  const base = { freeBytes: 27 * G, prevBytes: 4.33 * G, reserveBytes: 10 * G };
  const cyc = diskGate({ ...base, decision: { mode: 'full', reasons: [CYCLE_REASON] } });
  assert.equal(cyc.mode, 'delta');
  assert.ok(cyc.diskAlarm.includes('zu wenig Platz fuer Vollaufbau'));
  assert.ok(cyc.reasons[0].startsWith(`${CYCLE_REASON} faellig, aber zu wenig Platz`));
  assert.equal(cyc.diskSkip, undefined);
  const must = diskGate({ ...base, decision: { mode: 'full', reasons: ['--full'] } });
  assert.deepEqual([must.mode, must.diskSkip], ['skip', true]);
  // Turnus, aber auch fuer den Teil-Aufbau zu wenig → skip
  const tight = diskGate({ ...base, freeBytes: 15 * G, decision: { mode: 'full', reasons: [CYCLE_REASON] } });
  assert.deepEqual([tight.mode, tight.diskSkip], ['skip', true]);
  const delta = diskGate({ ...base, freeBytes: 15 * G, decision: { mode: 'delta', reasons: [] } });
  assert.deepEqual([delta.mode, delta.diskSkip], ['skip', true]);
  assert.ok(delta.diskAlarm.includes('Teil-Aufbau'));
});

test('diskGate: skip bleibt skip, unbekannter Platz prueft nicht, ohne vorige Datei gilt DISK_FIRST_BYTES', () => {
  const G = 2 ** 30;
  const skip = { mode: 'skip', reasons: ['x'], blocked: true };
  assert.deepEqual(diskGate({ decision: skip, freeBytes: 1, prevBytes: 0, reserveBytes: G }), { ...skip, disk: null });
  assert.equal(diskGate({ decision: { mode: 'full', reasons: ['--full'] }, freeBytes: null, prevBytes: 0, reserveBytes: G }).mode, 'full');
  const first = diskGate({ decision: { mode: 'full', reasons: ['keine vorige Datei'] }, freeBytes: 45 * G, prevBytes: 0, reserveBytes: 10 * G });
  assert.deepEqual([first.mode, first.disk.needBytes], ['skip', 10 * G + DISK_FIRST_BYTES]);
  assert.equal(diskGate({ decision: { mode: 'full', reasons: ['keine vorige Datei'] }, freeBytes: 60 * G, prevBytes: 0, reserveBytes: 10 * G }).mode, 'full');
});

test('spillCapBytes: Rest nach Reserve und Arbeitsdatei, nie unter dem Mindestwert', () => {
  const G = 2 ** 30;
  assert.equal(spillCapBytes({ mode: 'full', freeBytes: 117 * G, prevBytes: 4 * G, reserveBytes: 10 * G }), 79 * G);
  assert.equal(spillCapBytes({ mode: 'delta', freeBytes: 117 * G, prevBytes: 4 * G, reserveBytes: 10 * G }), 99 * G);
  assert.equal(spillCapBytes({ mode: 'full', freeBytes: 30 * G, prevBytes: 4 * G, reserveBytes: 10 * G }), DISK_SPILL_MIN_BYTES);
});
