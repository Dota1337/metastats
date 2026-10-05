// Tests fuer den Leser von Riots TFT-Patch-Terminplan (scripts/lib/tft-patch-schedule.mjs)
// und das taegliche Skript scripts/detect-tft-patch-schedule.mjs.
// Vorlage: scripts/fixtures/tft-patch-schedule.html — Auszug der echten Seite vom
// 2026-10-04: 25 Tabellenzeilen, ein Hinweis oben, dazu die JSON-Kopie der Tabelle.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDelayAlert, mergeSchedule, parseScheduleHtml } from './tft-patch-schedule.mjs';

const FIXTURE = readFileSync(new URL('../fixtures/tft-patch-schedule.html', import.meta.url), 'utf8');
const SCRIPT = fileURLToPath(new URL('../detect-tft-patch-schedule.mjs', import.meta.url));
const NOW = '2026-10-05T02:17:00.000Z';
const LATER = '2026-10-06T02:17:00.000Z';
const RENDERED_TABLE = /<table class="table--striped">[\s\S]*?<\/table>/;

function deepFreeze(o) {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

function page(rows, { head = ['Patch', 'Scheduled Date (Pacific Time)'], alerts = [] } = {}) {
  const th = head.map((h) => `<th>${h}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('\n');
  const al = alerts.map((a) => `<div role="alert"><p>${a}</p></div>`).join('');
  return `<html><body>${al}<table class="table--striped"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></body></html>`;
}

const SET18 = [
  ['TFT 18.1', 'August 26, 2026'],
  ['TFT 18.2', 'September 10, 2026'],
  ['TFT 18.3', 'September 23, 2026 (Thursday)'],
  ['TFT 18.4', 'October 7, 2026'],
  ['TFT 18.5', 'October 21, 2026'],
];
const withRow = (i, row) => SET18.map((r, j) => (j === i ? row : r));

const ROWS = parseScheduleHtml(FIXTURE).rows;
const row = (patch, from_day) => ({ set: Number(patch.split('.')[0]), patch, from_day });
const moved = (patch, from_day) => ROWS.map((r) => (r.patch === patch ? { ...r, from_day } : r));
const FILLED = deepFreeze(mergeSchedule(undefined, ROWS, '2026-10-05', NOW).starts);

// ---------- Seite lesen ----------

test('echte Seite: 24 Haupt-Patches in Reihenfolge, B-Patch uebersprungen', () => {
  const { rows, skipped } = parseScheduleHtml(FIXTURE);
  assert.deepEqual(rows.map((r) => r.patch), [
    '16.2', '16.3', '16.4', '16.5', '16.6', '16.7', '16.8',
    '17.1', '17.2', '17.3', '17.4', '17.5', '17.6', '17.7', '17.8', '17.9',
    '18.1', '18.2', '18.3', '18.4', '18.5', '18.6', '19.1', '19.2',
  ]);
  assert.deepEqual(rows[0], { set: 16, patch: '16.2', from_day: '2026-01-08' });
  assert.deepEqual(rows.find((r) => r.patch === '18.3'), { set: 18, patch: '18.3', from_day: '2026-09-23' });
  assert.deepEqual(rows.find((r) => r.patch === '18.4'), { set: 18, patch: '18.4', from_day: '2026-10-07' });
  assert.deepEqual(rows.at(-1), { set: 19, patch: '19.2', from_day: '2026-12-15' });
  for (const r of rows) assert.equal(r.set, Number(r.patch.split('.')[0]), r.patch);
  assert.deepEqual(skipped, [{ label: 'TFT 18.6B', date: 'November 11, 2026', reason: 'B-Patch — kommt aus den Patch-Notes' }]);
});

test('echte Seite: die JSON-Kopie der Tabelle wird nicht gelesen', () => {
  assert.ok(FIXTURE.includes('\\u003ctable class=\\\\\\"table--striped'), 'Vorlage ohne JSON-Kopie');
  assert.throws(() => parseScheduleHtml(FIXTURE.replace(RENDERED_TABLE, '')), /nicht gefunden/);
});

test('echte Seite: Hinweis oben mit festem Zeitpunkt statt "vor 1 Monat", keine Verschiebung', () => {
  const { alerts } = parseScheduleHtml(FIXTURE);
  assert.deepEqual(alerts, ['Temporarily Unavailable TFT Content · August 25, 2026 at 1:07 AM']);
  assert.equal(isDelayAlert(alerts[0]), false);
  // Am naechsten Tag steht "2 months ago" da — derselbe Hinweis, derselbe Text.
  const tomorrow = parseScheduleHtml(FIXTURE.replace('>1 month ago<', '>2 months ago<')).alerts;
  assert.deepEqual(tomorrow, alerts);
});

test('Seite ohne Hinweis: keine Hinweise', () => {
  assert.deepEqual(parseScheduleHtml(page(SET18)).alerts, []);
});

test('Sonderzeichen, Abkuerzungen und Zusaetze im Datum', () => {
  const { rows } = parseScheduleHtml(page([
    ['TFT&nbsp;18.1', 'Aug. 26, 2026'],
    ['TFT 18.2', 'Sept 10, 2026'],
    ['<strong>TFT 18.3</strong>', 'Sep 23rd, 2026 (Thursday)'],
    ['TFT 18.4', 'October&#160;7,&nbsp;2026'],
    ['TFT 18.5', '<span>October 21, 2026</span>'],
  ]));
  assert.deepEqual(rows, [
    row('18.1', '2026-08-26'), row('18.2', '2026-09-10'), row('18.3', '2026-09-23'),
    row('18.4', '2026-10-07'), row('18.5', '2026-10-21'),
  ]);
});

test('Zeilen ohne Datum und B-Patches werden uebersprungen, nicht geraten', () => {
  const { rows, skipped } = parseScheduleHtml(page([...SET18,
    ['TFT 18.5b', 'October 28, 2026'],
    ['TFT 18.6', 'TBD'],
    ['TFT 19.1', ''],
  ]));
  assert.equal(rows.length, 5);
  assert.deepEqual(skipped.map((s) => [s.label, s.reason]), [
    ['TFT 18.5b', 'B-Patch — kommt aus den Patch-Notes'],
    ['TFT 18.6', 'noch kein Datum'],
    ['TFT 19.1', 'noch kein Datum'],
  ]);
});

test('zusaetzliche Spalte stoert nicht', () => {
  const html = page(SET18.map((r) => [...r, 'Notiz']), { head: ['Patch', 'Scheduled Date', 'Notes'] });
  assert.equal(parseScheduleHtml(html).rows.length, 5);
});

test('kaputte Seiten werfen statt zu raten', () => {
  const cases = [
    ['', /leer/],
    ['<html><body><p>Wartung</p></body></html>', /nicht gefunden/],
    [page(SET18, { head: ['Patch', 'Release Date'] }), /nicht gefunden/],
    [page(withRow(4, ['TFT 18.5', 'October 21, 2026', 'x'])), /3 statt 2 Zellen/],
    [page(withRow(3, ['Patch 18.4', 'October 7, 2026'])), /Unbekannte Patch-Bezeichnung/],
    [page(withRow(0, ['TFT 18.0', 'August 26, 2026'])), /Unbekannte Patch-Bezeichnung/],
    [page(withRow(3, ['TFT 18.4', 'October 32, 2026'])), /Unlesbares Datum/],
    [page(withRow(3, ['TFT 18.4', 'Octember 7, 2026'])), /Unlesbares Datum/],
    [page(withRow(3, ['TFT 18.4', '2026-10-07'])), /Unlesbares Datum/],
    [page(SET18.slice(0, 4)), /zu kurz/],
    [page(withRow(3, ['TFT 18.4', 'September 22, 2026'])), /widerspruechlich/],
    [page(withRow(3, ['TFT 18.4', 'September 23, 2026'])), /widerspruechlich/],
    [page([...SET18, ['TFT 18.4', 'November 4, 2026']]), /doppelt/],
  ];
  for (const [html, re] of cases) assert.throws(() => parseScheduleHtml(html), re, String(re));
});

test('Verschiebungs-Hinweise erkennen', () => {
  assert.equal(isDelayAlert('Patch 18.4 has been delayed to October 8'), true);
  assert.equal(isDelayAlert('TFT Patch 18.4 is postponed'), true);
  assert.equal(isDelayAlert('Patch 18.4 has been rescheduled · October 6, 2026 at 3:00 PM'), true);
  assert.equal(isDelayAlert('Patch notes are live'), false);
  assert.equal(isDelayAlert('Ranked queue delayed in EUW'), false);
  assert.equal(isDelayAlert('Temporarily Unavailable TFT Content · August 25, 2026 at 1:07 AM'), false);
});

// ---------- Mit dem gespeicherten Stand zusammenfuehren ----------

test('Erstbefuellung: jede Zeile neu, mit Zeitstempel', () => {
  const { starts, changes, notes } = mergeSchedule(undefined, ROWS, '2026-10-05', NOW);
  assert.equal(starts.length, 24);
  assert.equal(changes.length, 24);
  assert.ok(changes.includes('18.4: neu ab 2026-10-07'));
  assert.deepEqual(notes, []);
  assert.deepEqual(starts.find((s) => s.patch === '18.4'), { set: 18, patch: '18.4', from_day: '2026-10-07', seen_at: NOW });
  assert.deepEqual(mergeSchedule([], ROWS, '2026-10-05', NOW).starts, starts);
});

test('zweiter Lauf ohne Aenderung: nichts neu, nichts veraendert', () => {
  const { starts, changes, notes } = mergeSchedule(FILLED, ROWS, '2026-10-06', LATER);
  assert.deepEqual(changes, []);
  assert.deepEqual(notes, []);
  assert.deepEqual(starts, FILLED);
});

test('Verschiebung in der Zukunft wird uebernommen, alter Termin bleibt sichtbar', () => {
  const { starts, changes } = mergeSchedule(FILLED, moved('18.4', '2026-10-08'), '2026-10-05', LATER);
  assert.deepEqual(changes, ['18.4: verschoben von 2026-10-07 auf 2026-10-08']);
  assert.deepEqual(starts.find((s) => s.patch === '18.4'),
    { set: 18, patch: '18.4', from_day: '2026-10-08', seen_at: LATER, previous_from_day: '2026-10-07' });
  assert.equal(FILLED.find((s) => s.patch === '18.4').from_day, '2026-10-07', 'Eingabe veraendert');
});

test('vergangener Termin wird nicht still geaendert', () => {
  assert.throws(() => mergeSchedule(FILLED, moved('18.3', '2026-09-24'), '2026-10-05', LATER), /vergangenen Termin/);
  assert.throws(() => mergeSchedule(FILLED, moved('18.4', '2026-10-08'), '2026-10-10', LATER), /vergangenen Termin/);
  assert.equal(mergeSchedule(FILLED, moved('18.4', '2026-10-08'), '2026-10-09', LATER).changes.length, 1);
  // auch nach vorn: ein spaeter Termin, der auf einen vergangenen Tag gezogen wird
  assert.throws(() => mergeSchedule(FILLED, moved('18.5', '2026-10-02'), '2026-10-05', LATER), /vergangenen Termin/);
});

test('von Hand festgesetzter Termin bleibt, mit Hinweis — auch in der Vergangenheit', () => {
  const pinned = FILLED.map((s) => (s.patch === '18.3' ? { ...s, from_day: '2026-09-24', pinned: true } : s));
  const { starts, changes, notes } = mergeSchedule(pinned, ROWS, '2026-10-20', LATER);
  assert.deepEqual(changes, []);
  assert.deepEqual(notes, ['18.3: von Hand auf 2026-09-24 festgesetzt, Riot nennt 2026-09-23']);
  assert.equal(starts.find((s) => s.patch === '18.3').from_day, '2026-09-24');
});

test('Patches, die von der Seite verschwinden, bleiben stehen', () => {
  const { starts, changes } = mergeSchedule(FILLED, ROWS.filter((r) => r.set >= 18), '2027-01-02', LATER);
  assert.deepEqual(changes, []);
  assert.deepEqual(starts, FILLED);
});

test('neuer Patch wird angehaengt', () => {
  const { starts, changes } = mergeSchedule(FILLED, [...ROWS, row('19.3', '2027-01-06')], '2026-12-20', LATER);
  assert.deepEqual(changes, ['19.3: neu ab 2027-01-06']);
  assert.deepEqual(starts.at(-1), { set: 19, patch: '19.3', from_day: '2027-01-06', seen_at: LATER });
});

test('unplausible Abstaende und Luecken werfen', () => {
  assert.throws(() => mergeSchedule([], moved('18.5', '2026-10-10'), '2026-10-05', NOW), /unplausibel/);
  assert.throws(() => mergeSchedule([], moved('19.2', '2027-02-15'), '2026-10-05', NOW), /unplausibel/);
  assert.throws(() => mergeSchedule([], ROWS.filter((r) => r.patch !== '18.5'), '2026-10-05', NOW), /Luecke/);
  assert.throws(() => mergeSchedule([], ROWS.filter((r) => r.patch !== '19.1'), '2026-10-05', NOW), /Luecke/);
});

test('kaputter gespeicherter Stand wirft', () => {
  assert.throws(() => mergeSchedule([...FILLED, { set: 18, patch: '18.x', from_day: 'bad' }], ROWS, '2026-10-05', NOW), /ungueltig/);
  assert.throws(() => mergeSchedule([...FILLED, { set: 17, patch: '18.7', from_day: '2026-11-18' }], ROWS, '2026-10-05', NOW), /ungueltig/);
  assert.throws(() => mergeSchedule({}, ROWS, '2026-10-05', NOW), /keine Liste/);
  assert.throws(() => mergeSchedule([], ROWS, '05.10.2026', NOW), /Ungueltiges Datum/);
});

// ---------- Das taegliche Skript ----------

const CUTS = [
  { set: 18, patch: '18.1b', base: '18.1', from_day: '2026-09-01' },
  { set: 18, patch: '18.2b', base: '18.2', from_day: '2026-09-14' },
  { set: 18, patch: '18.3b', base: '18.3', from_day: '2026-09-24' },
];

function sandbox(t, { html = FIXTURE, meta = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tft-schedule-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const htmlFile = join(dir, 'seite.html');
  const setFile = join(dir, 'tft-set.json');
  writeFileSync(htmlFile, html);
  writeFileSync(setFile, JSON.stringify({ setNumber: 18, setName: 'X', latestPatch: '18.3', foo: { bar: 1 }, patchCuts: CUTS, ...meta }, null, 2) + '\n');
  const run = (...extra) => spawnSync(process.execPath,
    [SCRIPT, '--file', htmlFile, '--today', '2026-10-05', '--set-file', setFile, ...extra], { encoding: 'utf8' });
  return { htmlFile, setFile, run, read: () => readFileSync(setFile, 'utf8') };
}

test('Skript: erster Lauf schreibt die Termine, laesst alles andere stehen', (t) => {
  const box = sandbox(t);
  const r = box.run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /geschrieben:/);
  const out = JSON.parse(box.read());
  assert.equal(out.patchStarts.length, 24);
  assert.deepEqual(out.foo, { bar: 1 });
  assert.deepEqual(out.patchCuts, CUTS);
  assert.equal(out.latestPatch, '18.3');
  assert.ok(!('patchScheduleAlerts' in out), 'Hinweis-Feld ohne Verschiebung angelegt');
});

test('Skript: zweiter Lauf aendert kein Byte', (t) => {
  const box = sandbox(t);
  assert.equal(box.run().status, 0);
  const before = box.read();
  const r = box.run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /unveraendert/);
  assert.equal(box.read(), before);
});

test('Skript: --dry-run schreibt nichts', (t) => {
  const box = sandbox(t);
  const before = box.read();
  const r = box.run('--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--dry-run: nichts geschrieben/);
  assert.equal(box.read(), before);
});

test('Skript: kaputte Seite → Exit 1, Datei unberuehrt', (t) => {
  const box = sandbox(t, { html: '<html><body>Wartung</body></html>' });
  const before = box.read();
  const r = box.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FAIL: Terminplan-Tabelle nicht gefunden/);
  assert.equal(box.read(), before);
});

test('Skript: B-Patch passt nicht zum Terminplan → Exit 1, Datei unberuehrt', (t) => {
  const cuts = CUTS.map((c) => (c.patch === '18.3b' ? { ...c, from_day: '2026-09-20' } : c));
  const box = sandbox(t, { meta: { patchCuts: cuts } });
  const before = box.read();
  const r = box.run();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FAIL: Terminplan passt nicht .*18\.3b/);
  assert.equal(box.read(), before);
});

test('Skript: neuer Verschiebungs-Hinweis → geschrieben, Exit 2, nur einmal', (t) => {
  const html = FIXTURE.replace('>Temporarily Unavailable TFT Content<', '>Patch 18.4 has been delayed to October 8<');
  const box = sandbox(t, { html });
  const first = box.run();
  assert.equal(first.status, 2, first.stderr);
  assert.match(first.stderr, /ACHTUNG: Riot meldet eine Patch-Verschiebung: Patch 18\.4 has been delayed/);
  const out = JSON.parse(box.read());
  assert.deepEqual(out.patchScheduleAlerts, ['Patch 18.4 has been delayed to October 8 · August 25, 2026 at 1:07 AM']);
  assert.equal(out.patchStarts.length, 24);

  const second = box.run();
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /unveraendert/);

  // Hinweis wieder weg: Feld wird geleert, kein Alarm
  writeFileSync(box.htmlFile, FIXTURE);
  const third = box.run();
  assert.equal(third.status, 0, third.stderr);
  assert.deepEqual(JSON.parse(box.read()).patchScheduleAlerts, []);
});
