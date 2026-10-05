// Tests fuer die Vertraege patch-axis, lol-patch-shift und box-main
// (scripts/lib/contracts.mjs). Nur die reinen Auswertungen — DB und Netz
// werden in den Pruefern selbst angefasst, die hier nicht laufen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyArming, checkContract, evaluatePatchAxis, evaluateLolPatchShift, combineLolPatchShift,
  evaluateBoxMain, deployPathsFrom, globToRegExp, inDeployPaths,
} from './contracts.mjs';
import { patchForDay } from './tft-patch-day.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Terminplan wie in public/tft-set.json am 2026-10-05 (Set 18 + erster Set-19-Termin).
const META = {
  setNumber: 18,
  latestPatch: '18.3',
  patchStarts: [
    { set: 18, patch: '18.1', from_day: '2026-08-26' },
    { set: 18, patch: '18.2', from_day: '2026-09-10' },
    { set: 18, patch: '18.3', from_day: '2026-09-23' },
    { set: 18, patch: '18.4', from_day: '2026-10-07' },
    { set: 18, patch: '18.5', from_day: '2026-10-21' },
    { set: 19, patch: '19.1', from_day: '2026-12-01' },
  ],
  patchCuts: [
    { set: 18, patch: '18.1b', base: '18.1', from_day: '2026-09-01' },
    { set: 18, patch: '18.2b', base: '18.2', from_day: '2026-09-14' },
    { set: 18, patch: '18.3b', base: '18.3', from_day: '2026-09-24' },
  ],
};
const expect18 = (d) => patchForDay(d, META, 18);
const days = (from, to) => {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
};
const rows = (from, to, patch, n = 100, set = META.setNumber) => days(from, to).map((day) => ({ day, set_number: set, patch, n }));

// ---- armed:false ------------------------------------------------------------

test('armed:false macht jedes Ergebnis zu skipped, Befund bleibt lesbar', () => {
  const res = { id: 'x', owner: 'o', status: 'broken', detail: '2 Tage falsch' };
  const s = applyArming({ armed: false }, res);
  assert.equal(s.status, 'skipped');
  assert.match(s.detail, /^nicht scharf \(Beobachtung\) — waere broken: 2 Tage falsch$/);
  assert.equal(applyArming({}, res), res);
  assert.equal(applyArming({ armed: true }, res), res);
});

test('Box-Vertraege ausserhalb der Box: skipped, ohne DB oder Netz', async () => {
  for (const type of ['lol-patch-shift', 'box-main']) {
    const r = await checkContract({ id: `t/${type}`, owner: 'o', type, backend: 'hetzner', repo: 'a/b' });
    assert.equal(r.status, 'skipped', type);
  }
});

// ---- patch-axis -------------------------------------------------------------

test('patch-axis: gemessener Stand vom 05.10. ist rot an genau den falschen Tagen', () => {
  // node scratchpad/probe-patch-axis.mjs, 2026-10-05 19:58 UTC, Fenster 21.09.–04.10.
  const rowsByTable = {
    tft_daily_crawl_meta: [...rows('2026-09-21', '2026-09-24', '18.2b', 9), ...rows('2026-09-25', '2026-10-04', '18.3b', 9)],
    tft_daily_comp_outcome: [
      ...rows('2026-09-28', '2026-10-02', '18.3', 9000),
      { day: '2026-10-03', set_number: 18, patch: '18.3', n: 9308 },
      { day: '2026-10-03', set_number: 18, patch: '18.3b', n: 1834 },
      { day: '2026-10-04', set_number: 18, patch: '18.3b', n: 9333 },
    ],
  };
  const v = evaluatePatchAxis({ rowsByTable, set: 18, expect: expect18 });
  assert.equal(v.status, 'broken');
  assert.match(v.detail, /^8 Tabellen-Tag\(e\) mit falschem Patch-Namen/);
  assert.match(v.detail, /tft_daily_crawl_meta: 2026-09-23 18\.2b statt 18\.3 \(9 Zeilen\), 2026-09-24 18\.2b statt 18\.3b \(9 Zeilen\)/);
  assert.match(v.detail, /tft_daily_comp_outcome: 2026-09-28…2026-10-03 18\.3 statt 18\.3b \(54308 Zeilen\)/);
  assert.ok(!v.detail.includes('2026-09-21'), '18.2b am 21./22.09. ist richtig');
  assert.ok(!v.detail.includes('2026-10-04'));
});

test('patch-axis: alles nach Terminplan = ok, mit Zahl der Tabellen-Tage', () => {
  const rowsByTable = {
    a: [...rows('2026-09-20', '2026-09-22', '18.2b'), ...rows('2026-09-23', '2026-09-23', '18.3'), ...rows('2026-09-24', '2026-10-04', '18.3b')],
  };
  const v = evaluatePatchAxis({ rowsByTable, set: 18, expect: expect18 });
  assert.equal(v.status, 'ok');
  assert.match(v.detail, /^15 Tabellen-Tage/);
});

test('patch-axis: Tage ohne Vertrauen und fremde Set werden uebersprungen, nicht gewertet', () => {
  // Terminplan endet am 07.10. -> danach beyondSchedule = kein Vertrauen
  const short = { ...META, patchStarts: META.patchStarts.filter((s) => s.from_day <= '2026-10-07') };
  const rowsByTable = {
    a: [
      ...rows('2026-10-08', '2026-10-09', 'Unsinn'),
      { day: '2026-10-08', set_number: 17, patch: '17.9', n: 5 },
    ],
  };
  const v = evaluatePatchAxis({ rowsByTable, set: 18, expect: (d) => patchForDay(d, short, 18) });
  assert.equal(v.status, 'skipped');
  assert.match(v.detail, /2 Tag\(e\) ohne verlaesslichen Terminplan/);
  assert.match(v.detail, /5 Zeilen aus anderem Set/);
});

test('patch-axis: keine Zeilen = skipped, kaputter Terminplan = skipped', () => {
  assert.equal(evaluatePatchAxis({ rowsByTable: { a: [] }, set: 18, expect: expect18 }).status, 'skipped');
  // B-Patch vor seinem Go-live -> scheduleProblems -> jeder Tag ohne Vertrauen
  const broken = { ...META, patchCuts: [{ set: 18, patch: '18.3b', base: '18.3', from_day: '2026-09-20' }] };
  const v = evaluatePatchAxis({ rowsByTable: { a: rows('2026-09-25', '2026-09-26', '18.2') }, set: 18, expect: (d) => patchForDay(d, broken, 18) });
  assert.equal(v.status, 'skipped');
});

test('patch-axis: leerer Name zaehlt als falsch', () => {
  const v = evaluatePatchAxis({ rowsByTable: { a: [{ day: '2026-09-30', set_number: 18, patch: null, n: 3 }] }, set: 18, expect: expect18 });
  assert.equal(v.status, 'broken');
  assert.match(v.detail, /2026-09-30 \(leer\) statt 18\.3b/);
});

// ---- lol-patch-shift ---------------------------------------------------------

const START_183 = { patch: '18.3', from_day: '2026-09-23' };
const lolRows = (spec) => spec.flatMap(([day, ...pairs]) => {
  const out = [];
  for (let i = 0; i < pairs.length; i += 2) out.push({ day, patch: pairs[i], matches: pairs[i + 1] });
  return out;
});

test('lol-patch-shift: gemessener Wechsel 16.18 -> 16.19 am 23.09. = ok', () => {
  // ssh ... psql < scratchpad/probe-lol-days.sql, EUW Solo/Duo, Fenstertage
  const rows = lolRows([['2026-09-22', '16.18', 1933], ['2026-09-23', '16.19', 2121], ['2026-09-24', '16.19', 2500]]);
  const v = evaluateLolPatchShift({ start: START_183, lol: '16.19', rows, lastDay: '2026-09-26' });
  assert.equal(v.state, 'ok');
  assert.match(v.text, /ab 2026-09-23 in der Mehrheit \(100 %\)/);
});

test('lol-patch-shift: LoL schon am Vortag in der Mehrheit = warn', () => {
  const rows = lolRows([['2026-09-22', '16.18', 400, '16.19', 900], ['2026-09-23', '16.19', 2000]]);
  const v = evaluateLolPatchShift({ start: START_183, lol: '16.19', rows, lastDay: '2026-09-26' });
  assert.equal(v.state, 'warn');
  assert.match(v.text, /schon am 2026-09-22/);
});

test('lol-patch-shift: Mehrheit erst einen Tag spaeter = warn mit Tag', () => {
  const rows = lolRows([
    ['2026-09-22', '16.18', 1900], ['2026-09-23', '16.18', 1500, '16.19', 300], ['2026-09-24', '16.19', 2000],
  ]);
  const v = evaluateLolPatchShift({ start: START_183, lol: '16.19', rows, lastDay: '2026-09-26' });
  assert.equal(v.state, 'warn');
  assert.match(v.text, /erst am 2026-09-24 in der Mehrheit .*dort 17 %/);
});

test('lol-patch-shift: bis zum letzten Tag keine Mehrheit = warn', () => {
  const rows = lolRows([['2026-09-22', '16.18', 1900], ['2026-09-23', '16.18', 1900], ['2026-09-24', '16.18', 1900]]);
  const v = evaluateLolPatchShift({ start: START_183, lol: '16.19', rows, lastDay: '2026-09-24' });
  assert.equal(v.state, 'warn');
  assert.match(v.text, /nur 0 %, bis 2026-09-24 keine Mehrheit/);
});

test('lol-patch-shift: zu wenige Spiele am Vortag oder Go-live = unbekannt, nicht gruen', () => {
  const thinPrev = lolRows([['2026-09-22', '16.18', 120], ['2026-09-23', '16.19', 2000]]);
  assert.equal(evaluateLolPatchShift({ start: START_183, lol: '16.19', rows: thinPrev, lastDay: '2026-09-26' }).state, 'unknown');
  const thinLive = lolRows([['2026-09-22', '16.18', 2000], ['2026-09-23', '16.19', 250]]);
  const v = evaluateLolPatchShift({ start: START_183, lol: '16.19', rows: thinLive, lastDay: '2026-09-26' });
  assert.equal(v.state, 'unknown');
  assert.match(v.text, /Go-live-Tag 2026-09-23 unvollstaendig \(250 Spiele\)/);
  assert.equal(evaluateLolPatchShift({ start: START_183, lol: '16.19', rows: [], lastDay: '2026-09-26' }).state, 'unknown');
});

test('lol-patch-shift: Zusammenfassung — gelb gewinnt, nur Unbekanntes = skipped', () => {
  assert.equal(combineLolPatchShift([{ state: 'ok', text: 'a' }, { state: 'warn', text: 'b' }]).detail, 'b');
  assert.equal(combineLolPatchShift([{ state: 'ok', text: 'a' }, { state: 'unknown', text: 'c' }]).status, 'ok');
  const s = combineLolPatchShift([{ state: 'unknown', text: 'c' }]);
  assert.equal(s.status, 'skipped');
  assert.match(s.detail, /^keine Daten — c$/);
});

// ---- box-main ---------------------------------------------------------------

const NOW = Date.parse('2026-10-05T23:00:00Z');
const PATHS = deployPathsFrom(readFileSync(resolve(ROOT, '.github', 'workflows', 'deploy-hetzner.yml'), 'utf8'));
const commit = (iso) => ({ commit: { committer: { date: iso } } });

test('Deploy-Pfade kommen aus dem echten Workflow', () => {
  assert.ok(PATHS.includes('scripts/**'));
  assert.ok(PATHS.includes('infra/contracts.json'));
  assert.ok(!PATHS.some((p) => p.includes('branches')));
});

test('Glob-Regeln wie bei GitHub', () => {
  assert.ok(globToRegExp('scripts/**').test('scripts/lib/contracts.mjs'));
  assert.ok(globToRegExp('public/tft-graph-*.json').test('public/tft-graph-18.json'));
  assert.ok(!globToRegExp('public/tft-graph-*.json').test('public/tft-graph-18/x.json'));
  assert.ok(!globToRegExp('public/tft-set.json').test('public/tft-setxjson'));
  assert.ok(inDeployPaths('scripts/a.mjs', ['scripts/**']));
  assert.ok(!inDeployPaths('scripts/a.md', ['scripts/**', '!scripts/*.md']));
  assert.ok(!inDeployPaths('public/pro-teams.json', PATHS));
});

test('box-main: gleich = ok, dahinter nur mit Bot-Dateien = ok', () => {
  assert.equal(evaluateBoxMain({ compare: { ahead_by: 0, behind_by: 0 }, deployPaths: PATHS, now: NOW }).status, 'ok');
  // gemessen: gh api repos/Dota1337/metastats/compare/8ac8c8a...main (2 Bot-Commits)
  const bot = {
    ahead_by: 2, behind_by: 0,
    commits: [commit('2026-10-05T04:10:00Z'), commit('2026-10-05T06:00:00Z')],
    files: [{ filename: 'public/pro-teams.json' }, { filename: 'public/tft-metatft-euw-18.json' }],
  };
  const v = evaluateBoxMain({ compare: bot, deployPaths: PATHS, now: NOW });
  assert.equal(v.status, 'ok');
  assert.match(v.detail, /keiner davon in den Deploy-Pfaden/);
});

test('box-main: Deploy-Datei seit Stunden nicht ausgerollt = warn, frisch = ok', () => {
  const cmp = (iso) => ({ ahead_by: 1, behind_by: 0, commits: [commit(iso)], files: [{ filename: 'scripts/lib/contracts.mjs' }] });
  const old = evaluateBoxMain({ compare: cmp('2026-10-05T18:00:00Z'), deployPaths: PATHS, now: NOW });
  assert.equal(old.status, 'warn');
  assert.match(old.detail, /1 Commit\(s\), davon 1 Datei\(en\) in den Deploy-Pfaden, juengster Commit vor 5 h/);
  const fresh = evaluateBoxMain({ compare: cmp('2026-10-05T22:30:00Z'), deployPaths: PATHS, now: NOW });
  assert.equal(fresh.status, 'ok');
  assert.match(fresh.detail, /vor 30 min — Deploy vermutlich unterwegs/);
});

test('box-main: umbenannte Datei zaehlt ueber den alten Pfad', () => {
  const cmp = { ahead_by: 1, behind_by: 0, commits: [commit('2026-10-04T00:00:00Z')], files: [{ filename: 'docs/x.mjs', previous_filename: 'scripts/x.mjs' }] };
  assert.equal(evaluateBoxMain({ compare: cmp, deployPaths: PATHS, now: NOW }).status, 'warn');
});

test('box-main: gekuerzte Liste, lokale Aenderung, fremder Commit, unbekannter Stand = warn', () => {
  const cut = { ahead_by: 300, behind_by: 0, commits: [commit('2026-10-01T00:00:00Z')], files: [] };
  assert.match(evaluateBoxMain({ compare: cut, deployPaths: PATHS, now: NOW }).detail, /gekuerzt/);
  assert.equal(evaluateBoxMain({ compare: { ahead_by: 0, behind_by: 0 }, dirty: true, now: NOW }).status, 'warn');
  assert.equal(evaluateBoxMain({ compare: { ahead_by: 0, behind_by: 1 }, now: NOW }).status, 'warn');
  assert.equal(evaluateBoxMain({ compare: { notFound: true }, now: NOW }).status, 'warn');
});

test('box-main: ohne Pfadliste zaehlt jede Datei, ohne Datum kein Absturz', () => {
  const cmp = { ahead_by: 1, behind_by: 0, commits: [{ commit: {} }], files: [{ filename: 'public/pro-teams.json' }] };
  const v = evaluateBoxMain({ compare: cmp, deployPaths: [], now: NOW });
  assert.equal(v.status, 'warn');
  assert.match(v.detail, /juengster Commit unbekannt/);
});
