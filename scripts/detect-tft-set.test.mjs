/**
 * detect-tft-set.mjs als Ganzes: Set-Gate, Patch aus Riots Terminplan,
 * Rueckfall auf ddragon, und dass fremde Schluessel in tft-set.json
 * ueberleben. Laeuft ohne Netz — CDragon und ddragon kommen als Argument.
 *
 * Als Prozess statt als Import, weil genau das zaehlt, was das Skript
 * hinterlaesst: die Datei, GITHUB_OUTPUT und der Exit-Code.
 *
 * Anlass: ddragon meldete den LoL-Patch zwei Tage nach dem TFT-Go-Live, so
 * landeten der 23. und 24.09.2026 als 18.2b statt 18.3 / 18.3b in der Datenbank.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./detect-tft-set.mjs', import.meta.url));
const SEEN = '2026-10-05T00:56:50.541Z';
const CD18 = { setData: [{ number: 18, mutator: 'TFTSet18' }, { number: 17, mutator: 'TFTSet17' }, { number: 18, mutator: 'TFTSet18_TURBO' }] };
const CD19 = { setData: [...CD18.setData, { number: 19, mutator: 'TFTSet19' }] };

const START = (patch, from_day) => ({ set: Number(patch.split('.')[0]), patch, from_day, seen_at: SEEN });
const CUT = (patch, base, from_day) => ({
  set: Number(base.split('.')[0]), patch, base, from_day, source: 'patch-notes', detected_at: SEEN,
});
const STARTS = [
  START('18.1', '2026-08-26'), START('18.2', '2026-09-10'), START('18.3', '2026-09-23'),
  START('18.4', '2026-10-07'), START('18.5', '2026-10-21'), START('18.6', '2026-11-04'),
  START('19.1', '2026-12-01'), START('19.2', '2026-12-15'),
];
const CUTS = [CUT('18.1b', '18.1', '2026-09-01'), CUT('18.2b', '18.2', '2026-09-14'), CUT('18.3b', '18.3', '2026-09-24')];

// Spiegel der echten Datei (Stand 2026-10-05) plus ein Schluessel, den kein
// Skript kennt — der muss genauso ueberleben wie patchStarts.
function stored(over = {}) {
  return {
    setNumber: 18, setName: 'Enchanted Wilds', mutator: 'TFTSet18',
    latestPatch: '18.3', lolPatch: '16.19.1', patchOverride: null,
    detectedAt: '2026-08-26T14:08:32.809Z', lastCheckedAt: '2026-10-03T06:22:39.215Z',
    history: [{ setNumber: 17, setName: 'Space Gods', mutator: 'TFTSet17', endedAt: '2026-08-26T14:08:32.809Z' }],
    setStartDate: '2026-08-26', setEndDate: null,
    patchCuts: CUTS, patchStarts: STARTS, patchScheduleAlerts: [], fremdesFeld: { bleibt: true },
    ...over,
  };
}

function run(meta, { now, ddragon = '16.19.1', cd = CD18, extra = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'detect-tft-set-'));
  try {
    const file = join(dir, 'tft-set.json');
    const cdFile = join(dir, 'cd.json');
    const outFile = join(dir, 'gh-output.txt');
    const before = meta === null ? null : JSON.stringify(meta, null, 2) + '\n';
    if (before !== null) writeFileSync(file, before);
    writeFileSync(cdFile, JSON.stringify(cd));
    writeFileSync(outFile, '');
    const env = { ...process.env, GITHUB_OUTPUT: outFile };
    delete env.SET_BUMP_ALLOWED_AFTER;
    const args = [SCRIPT, '--set-file', file, '--cdragon-file', cdFile, '--now', now, '--ddragon-version', ddragon, ...extra];
    const r = spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8' });
    let raw = null;
    try { raw = readFileSync(file, 'utf8'); } catch { /* keine Datei */ }
    const outputs = readFileSync(outFile, 'utf8').split('\n').filter(Boolean);
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, before, raw, json: raw ? JSON.parse(raw) : null, outputs };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const out = (r, key) => r.outputs.filter((l) => l.startsWith(key + '=')).map((l) => l.slice(key.length + 1));

test('Sammeltag 10-05: 18.3 aus dem Terminplan, fremde Schluessel bleiben', () => {
  const r = run(stored(), { now: '2026-10-05T10:00:00Z' });
  assert.equal(r.status, 0, r.stderr);
  const j = r.json;
  assert.equal(j.latestPatch, '18.3');
  assert.equal(j.lolPatch, '16.19');
  assert.equal(j.ddragonVersion, '16.19.1');
  assert.equal(j.patchOverride, null);
  assert.deepEqual(j.patchStarts, STARTS);
  assert.deepEqual(j.patchCuts, CUTS);
  assert.deepEqual(j.patchScheduleAlerts, []);
  assert.deepEqual(j.fremdesFeld, { bleibt: true });
  assert.equal(j.lastCheckedAt, '2026-10-05T10:00:00.000Z');
  assert.equal(j.detectedAt, '2026-08-26T14:08:32.809Z');
  assert.equal(j.setStartDate, '2026-08-26');
  assert.deepEqual(j.history, stored().history);
  assert.deepEqual(out(r, 'set-changed'), ['false']);
  assert.deepEqual(out(r, 'set-bump-gated'), []);
});

test('Go-Live 18.4 gehoert zum Sammeltag 10-07, der um 05:00 UTC beginnt — ddragon hin oder her', () => {
  // ddragon steht noch auf 16.19.1: genau der Fall vom 23./24.09.
  const after = run(stored(), { now: '2026-10-07T06:00:00Z' });
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.json.latestPatch, '18.4');
  assert.equal(after.json.lolPatch, '16.20');
  assert.match(after.stdout, /hinkt/);
  const night = run(stored(), { now: '2026-10-07T04:00:00Z' });
  assert.equal(night.status, 0, night.stderr);
  assert.equal(night.json.latestPatch, '18.3');
});

test('ohne Terminplan rechnet es mit frischem ddragon, nie mit dem alten latestPatch', () => {
  const meta = stored({ patchStarts: [], latestPatch: '18.1' });
  const a = run(meta, { now: '2026-10-05T10:00:00Z', ddragon: '16.19.1' });
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.json.latestPatch, '18.3');
  assert.deepEqual(a.json.patchStarts, []);
  assert.match(a.stderr, /Rueckfall auf ddragon/);
  assert.doesNotMatch(a.stderr, /weder Terminplan|Rueckfall auf latestPatch/);
  const b = run(meta, { now: '2026-10-05T10:00:00Z', ddragon: '16.20.1' });
  assert.equal(b.status, 0, b.stderr);
  assert.equal(b.json.latestPatch, '18.4');
});

test('ohne Terminplan und ohne ddragon: Abbruch, Datei unberuehrt', () => {
  const r = run(stored({ patchStarts: [] }), { now: '2026-10-05T10:00:00Z', ddragon: '' });
  assert.equal(r.status, 1);
  assert.equal(r.raw, r.before);
  assert.match(r.stderr, /ddragon nicht erreichbar/);
});

test('Set ohne Termin und ohne LoL-Anker: Abbruch statt geratenem Patch', () => {
  const meta = stored({
    setNumber: 19, setName: 'Set 19', mutator: 'TFTSet19', latestPatch: '19.1',
    patchStarts: STARTS.filter((s) => s.set !== 19), patchCuts: [],
  });
  const r = run(meta, { now: '2026-12-10T10:00:00Z', cd: CD19 });
  assert.equal(r.status, 1);
  assert.equal(r.raw, r.before);
  assert.match(r.stderr, /SET_LAUNCH_LOL/);
});

test('Set-Wechsel am Go-Live-Tag von 19.1: Historie neu, Override und B-Patches geraeumt', () => {
  const r = run(stored({ patchOverride: '18.6b' }), { now: '2026-12-01T06:00:00Z', cd: CD19 });
  assert.equal(r.status, 0, r.stderr);
  const j = r.json;
  assert.equal(j.setNumber, 19);
  assert.equal(j.mutator, 'TFTSet19');
  assert.equal(j.setName, 'Set 19');
  assert.equal(j.latestPatch, '19.1');
  assert.equal(j.lolPatch, null);
  assert.equal(j.patchOverride, null);
  assert.deepEqual(j.patchCuts, []);
  assert.equal(j.detectedAt, '2026-12-01T06:00:00.000Z');
  assert.equal(j.setStartDate, '2026-12-01');
  assert.equal(j.setEndDate, null);
  assert.equal(j.history.length, 2);
  assert.deepEqual(j.history[0], { setNumber: 18, setName: 'Enchanted Wilds', mutator: 'TFTSet18', endedAt: '2026-12-01T06:00:00.000Z' });
  assert.deepEqual(j.patchStarts, STARTS);
  assert.deepEqual(j.fremdesFeld, { bleibt: true });
  assert.deepEqual(out(r, 'set-changed'), ['true']);
  assert.deepEqual(out(r, 'previous-set'), ['18']);
  assert.deepEqual(out(r, 'new-set'), ['19']);
  assert.match(r.stderr, /kein LoL-Anker/);
});

test('vor dem Go-Live von 19.1 haelt das Gate Set 18, auch nachts vor 05:00 UTC', () => {
  for (const now of ['2026-11-30T10:00:00Z', '2026-12-01T04:00:00Z']) {
    const r = run(stored(), { now, cd: CD19 });
    assert.equal(r.status, 0, `${now}: ${r.stderr}`);
    assert.equal(r.json.setNumber, 18, now);
    assert.equal(r.json.latestPatch, '18.6', now);
    assert.equal(r.json.lolPatch, '16.22', now);
    assert.deepEqual(out(r, 'set-bump-gated'), ['19'], now);
    assert.deepEqual(out(r, 'set-changed'), ['false'], now);
  }
});

test('verschiebt Riot 19.1 nach hinten, wartet das Gate auf den Terminplan', () => {
  const starts = STARTS.map((s) => (s.patch === '19.1' ? { ...s, from_day: '2026-12-03' } : s));
  const r = run(stored({ patchStarts: starts }), { now: '2026-12-02T10:00:00Z', cd: CD19 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.setNumber, 18);
  assert.equal(r.json.latestPatch, '18.6');
  assert.deepEqual(out(r, 'set-bump-gated'), ['19']);
});

test('zieht Riot 19.1 vor, haelt die Konstante und warnt laut', () => {
  const starts = STARTS.map((s) => (s.patch === '19.1' ? { ...s, from_day: '2026-11-25' } : s));
  const r = run(stored({ patchStarts: starts }), { now: '2026-11-28T10:00:00Z', cd: CD19 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.setNumber, 18);
  assert.deepEqual(out(r, 'set-bump-gated'), ['19']);
  assert.match(r.stderr, /vorgezogen/);
});

test('zweiter Lauf zur selben Uhrzeit aendert kein Byte', () => {
  const first = run(stored(), { now: '2026-10-05T10:00:00Z' });
  assert.equal(first.status, 0, first.stderr);
  const second = run(first.json, { now: '2026-10-05T10:00:00Z' });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.raw, first.raw);
});

test('patchOverride bleibt und bestimmt latestPatch; passt er nicht zum Terminplan, warnt es', () => {
  const r = run(stored({ patchOverride: '18.3b' }), { now: '2026-10-05T10:00:00Z' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.latestPatch, '18.3b');
  assert.equal(r.json.lolPatch, '16.19');
  assert.equal(r.json.patchOverride, '18.3b');
  assert.doesNotMatch(r.stderr, /patchOverride/);
  const stale = run(stored({ patchOverride: '18.2b' }), { now: '2026-10-05T10:00:00Z' });
  assert.equal(stale.status, 0, stale.stderr);
  assert.equal(stale.json.latestPatch, '18.2b');
  assert.match(stale.stderr, /patchOverride 18\.2b passt nicht/);
});

test('ungueltiges --now: Abbruch, Datei unberuehrt', () => {
  const r = run(stored(), { now: 'kein-datum' });
  assert.equal(r.status, 1);
  assert.equal(r.raw, r.before);
  assert.match(r.stderr, /--now ungueltig/);
});

test('--dry-run rechnet, schreibt aber nichts', () => {
  const r = run(stored(), { now: '2026-10-07T06:00:00Z', extra: ['--dry-run'] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.raw, r.before);
  assert.match(r.stdout, /TFT 18\.4/);
});

test('Gate haelt, aber das alte Set fehlt in CDragon: Abbruch', () => {
  const r = run(stored(), { now: '2026-11-30T10:00:00Z', cd: { setData: [{ number: 19, mutator: 'TFTSet19' }] } });
  assert.equal(r.status, 1);
  assert.equal(r.raw, r.before);
  assert.match(r.stderr, /Gate kann nicht halten/);
});

test('nur Nebenmodi in CDragon: Abbruch', () => {
  const r = run(stored(), { now: '2026-10-05T10:00:00Z', cd: { setData: [{ number: 18, mutator: 'TFTSet18_TURBO' }] } });
  assert.equal(r.status, 1);
  assert.equal(r.raw, r.before);
  assert.match(r.stderr, /no live set/);
});

test('CDragon zeigt nur ein aelteres Set: Abbruch statt Rueckwaerts-Wechsel', () => {
  const r = run(stored(), { now: '2026-10-05T10:00:00Z', cd: { setData: [{ number: 17, mutator: 'TFTSet17' }] } });
  assert.equal(r.status, 1);
  assert.equal(r.raw, r.before);
  assert.match(r.stderr, /hoechstens Set 17/);
});

test('ohne gespeicherte Datei: neu angelegt, Patch aus ddragon', () => {
  const r = run(null, { now: '2026-10-05T10:00:00Z' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.json.setNumber, 18);
  assert.equal(r.json.latestPatch, '18.3');
  assert.equal(r.json.lolPatch, '16.19');
  assert.deepEqual(r.json.history, []);
  assert.deepEqual(out(r, 'set-changed'), ['false']);
});
