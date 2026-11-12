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
import { confirmCandidates, confirmStarts, isDelayAlert, mergeSchedule, parseScheduleHtml, patchVotes } from './tft-patch-schedule.mjs';

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

// Ohne Netz: --now und eine leere Stimmen-Datei (alle Quellen unbekannt →
// die Bestaetigung aendert nichts). PATCH_CONFIRM fest auf an, damit eine
// Umgebung mit PATCH_CONFIRM=0 die Tests nicht verfaelscht.
function sandbox(t, { html = FIXTURE, meta = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tft-schedule-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const htmlFile = join(dir, 'seite.html');
  const setFile = join(dir, 'tft-set.json');
  const votesFile = join(dir, 'stimmen.json');
  writeFileSync(htmlFile, html);
  writeFileSync(votesFile, '{}');
  writeFileSync(setFile, JSON.stringify({ setNumber: 18, setName: 'X', latestPatch: '18.3', foo: { bar: 1 }, patchCuts: CUTS, ...meta }, null, 2) + '\n');
  const run = (...extra) => spawnSync(process.execPath,
    [SCRIPT, '--file', htmlFile, '--today', '2026-10-05', '--now', '2026-10-05T02:17:00.000Z', '--votes-file', votesFile, '--set-file', setFile, ...extra],
    { encoding: 'utf8', env: { ...process.env, PATCH_CONFIRM: '1' } });
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

// ---------- Termin erst nach Bestaetigung (G2) ----------
// Nachgestellt: Riot nannte 18.7 ab 11.11.2026, der Patch kam nicht (Notes 404,
// MetaTFT 18.6, CDragon seit 04.11. unveraendert).

const RUN = '2026-11-12T02:17:00.000Z';             // laufender Sammeltag 2026-11-11
const runAt = (day) => `${day}T02:17:00.000Z`;      // Bot-Zeit, Sammeltag = day − 1
const S18 = deepFreeze([
  ['18.1', '2026-08-26'], ['18.2', '2026-09-10'], ['18.3', '2026-09-23'], ['18.4', '2026-10-07'], ['18.5', '2026-10-21'],
  ['18.6', '2026-11-04'], ['18.7', '2026-11-11'], ['19.1', '2026-12-01'], ['19.2', '2026-12-15'],
].map(([patch, from_day]) => ({ set: Number(patch.split('.')[0]), patch, from_day, seen_at: NOW })));
const RIOT = S18.map(({ set, patch, from_day }) => ({ set, patch, from_day }));
const HOLD = deepFreeze({ riot_from_day: '2026-11-11', since: RUN });
const withEntry = (patch, extra, list = S18) => deepFreeze(list.map((s) => (s.patch === patch ? { ...s, ...extra } : s)));
const held = (from_day, extra = {}) => withEntry('18.7', { from_day, hold: HOLD, ...extra });
const get = (list, patch) => list.find((s) => s.patch === patch);
const outcome = (r, patch) => r.decisions.find((x) => x.patch === patch)?.outcome;

const MT = (patch, start = '2026-11-05T00:00:08.489Z', b = '') => ({ patch, b_patch_version: b, start });
const CD_OLD = '2026-11-04T00:47:00.000Z';
const CD_NEW = '2026-11-18T00:50:00.000Z';
const votes = (notes, metatft, cdragon, patch = '18.7') => ({ notes: notes === undefined ? {} : { [patch]: notes }, metatft, cdragon });
const NONE = votes('nein', MT('18.6'), CD_OLD);                            // 3× nein
const LIVE = votes('ja', MT('18.7', '2026-11-19T00:00:05.000Z'), CD_NEW);  // 3× ja, MetaTFT-Start = Sammeltag 18.11.
const RUNNING = get(S18, '18.7').set;               // laufende Set der Fixture
const confirm = (starts, now, observations, set = RUNNING) => confirmStarts(starts, { set, now, nowIso: now, observations });

test('Stimmen je Quelle: ja / nein / unbekannt', () => {
  const e = { set: 18, patch: '18.7', from_day: '2026-11-11' };
  const v = (obs) => patchVotes(e, obs);
  const unknown = { notes: 'unbekannt', metatft: 'unbekannt', cdragon: 'unbekannt' };
  assert.deepEqual(v(NONE), { notes: 'nein', metatft: 'nein', cdragon: 'nein' });
  assert.deepEqual(v(LIVE), { notes: 'ja', metatft: 'ja', cdragon: 'ja' });
  assert.deepEqual(v({}), unknown);
  assert.deepEqual(v(undefined), unknown);
  assert.equal(v(votes('vielleicht')).notes, 'unbekannt');
  assert.equal(v({ notes: { '18.6': 'ja' } }).notes, 'unbekannt', 'Notes eines anderen Patches');
  // MetaTFT: gleich oder hoeher = ja (Zahl, nicht Text: 18.10 > 18.7)
  for (const p of ['18.7', '18.8', '18.10', '19.1']) assert.equal(v({ metatft: MT(p) }).metatft, 'ja', p);
  for (const p of ['18.6', '17.9']) assert.equal(v({ metatft: MT(p) }).metatft, 'nein', p);
  for (const mt of [null, { patch: 18.7 }, { patch: 'x' }, { patch: '18.7b' }, 'kaputt']) {
    assert.equal(v({ metatft: mt }).metatft, 'unbekannt', JSON.stringify(mt));
  }
  // CDragon: Stempel ab Riots Tag − 2
  assert.equal(v({ cdragon: '2026-11-09T00:00:00.000Z' }).cdragon, 'ja');
  assert.equal(v({ cdragon: '2026-11-08T23:59:00.000Z' }).cdragon, 'nein');
  for (const cd of [null, 'kaputt', 42]) assert.equal(v({ cdragon: cd }).cdragon, 'unbekannt', String(cd));
  // angehalten: Riots Tag zaehlt, nicht das verschobene from_day (14.11. − 2 waere nein)
  assert.equal(patchVotes({ set: 18, patch: '18.7', from_day: '2026-11-14', hold: HOLD }, { cdragon: '2026-11-10T00:00:00.000Z' }).cdragon, 'ja');
});

test('Kandidaten: juengster gestarteter Termin plus angehaltene, nie pinned / x.1 / bestaetigt', () => {
  const c = (list, now, set = RUNNING) => confirmCandidates(list, set, now).map((s) => s.patch);
  assert.deepEqual(c(S18, RUN), ['18.7']);
  // Sammeltag wechselt um 05:00 UTC
  assert.deepEqual(c(S18, '2026-11-11T04:59:59.000Z'), ['18.6']);
  assert.deepEqual(c(S18, '2026-11-11T05:00:00.000Z'), ['18.7']);
  // nur der juengste — ist er erledigt, wird kein aelterer nachgeholt
  assert.deepEqual(c(withEntry('18.7', { pinned: true }), RUN), []);
  assert.deepEqual(c(withEntry('18.7', { confirmed: true }), RUN), []);
  // angehaltene immer, auch noch nicht gestartet; daneben der juengste gestartete
  assert.deepEqual(c(held('2026-11-12'), RUN), ['18.6', '18.7']);
  assert.deepEqual(c(held('2026-11-12', { pinned: true }), RUN), ['18.6']);
  // x.1 nie (Set-Start), Termine anderer Sets nie
  const in19 = runAt('2026-12-02');
  assert.deepEqual(c(S18, in19, 19), []);
  assert.deepEqual(c(withEntry('19.1', { from_day: '2026-12-02', hold: { riot_from_day: '2026-12-01' } }), in19, 19), []);
  assert.deepEqual(c(S18, in19, 18), ['18.7']);
});

test('Entscheid fuer einen nicht angehaltenen Termin', () => {
  // [Stimmen, Ergebnis, from_day, angehalten, bestaetigt, Meldungen]
  const cases = [
    [NONE, 'held', '2026-11-12', true, false, 1],
    [votes('nein', MT('18.6'), null), 'held', '2026-11-12', true, false, 1],
    [votes('ja', MT('18.6'), CD_OLD), 'held', '2026-11-12', true, false, 1],
    [votes('ja', MT('18.7'), CD_OLD), 'confirmed', '2026-11-11', false, true, 0],
    [votes(undefined, MT('18.7'), CD_NEW), 'confirmed', '2026-11-11', false, true, 0],
    [votes('ja', MT('18.6'), null), 'undecided', '2026-11-11', false, false, 0],
    [votes('nein', null, null), 'undecided', '2026-11-11', false, false, 0],
    [{}, 'undecided', '2026-11-11', false, false, 0],
  ];
  for (const [obs, want, day, isHeld, isConfirmed, nAlerts] of cases) {
    const label = JSON.stringify(obs);
    const r = confirm(S18, RUN, obs);
    const e = get(r.starts, '18.7');
    assert.equal(r.decisions.length, 1, label);
    assert.equal(outcome(r, '18.7'), want, label);
    assert.equal(e.from_day, day, label);
    assert.equal('hold' in e, isHeld, label);
    assert.equal(e.confirmed === true, isConfirmed, label);
    assert.equal(r.alerts.length, nAlerts, label);
    assert.deepEqual(r.starts.filter((s) => s.patch !== '18.7'), S18.filter((s) => s.patch !== '18.7'), label);
  }
  const r = confirm(S18, RUN, NONE);
  assert.deepEqual(get(r.starts, '18.7').hold, { riot_from_day: '2026-11-11', since: RUN });
  assert.match(r.alerts[0], /^18\.7: angehalten — Riot nannte 2026-11-11, aber Notes nein, MetaTFT nein \(18\.6\), CDragon nein \(2026-11-04\)\. Gilt fruehestens ab 2026-11-12, Sammeltag 2026-11-11 bleibt beim Vorgaenger$/);
  // Laeufe ausgefallen: der Termin liegt schon Tage zurueck → trotzdem ab morgen
  const late = confirm(S18, runAt('2026-11-15'), NONE);
  assert.equal(get(late.starts, '18.7').from_day, '2026-11-15');
  assert.match(late.alerts[0], /Sammeltage 2026-11-11 bis 2026-11-14 bleiben beim Vorgaenger$/);
  assert.deepEqual(get(late.starts, '18.7').hold, { riot_from_day: '2026-11-11', since: runAt('2026-11-15') });
});

test('angehaltener Termin rueckt mit dem Sammeltag, ohne neue Meldung', () => {
  let r = confirm(held('2026-11-12'), runAt('2026-11-13'), NONE);
  assert.equal(outcome(r, '18.7'), 'hold-extended');
  assert.equal(get(r.starts, '18.7').from_day, '2026-11-13');
  assert.deepEqual(get(r.starts, '18.7').hold, HOLD);
  assert.deepEqual(r.alerts, []);
  // drei Laeufe ausgefallen: springt auf morgen
  r = confirm(held('2026-11-12'), runAt('2026-11-16'), NONE);
  assert.equal(get(r.starts, '18.7').from_day, '2026-11-16');
  // schon morgen oder weiter hinten: bleibt
  for (const day of ['2026-11-13', '2026-11-20']) {
    r = confirm(held(day), runAt('2026-11-13'), NONE);
    assert.equal(outcome(r, '18.7'), 'hold-unchanged', day);
    assert.equal(get(r.starts, '18.7').from_day, day);
  }
  // unklar (Quellen weg): bleibt angehalten und rueckt weiter — nie unbestaetigt wirksam
  r = confirm(held('2026-11-12'), runAt('2026-11-13'), {});
  assert.equal(outcome(r, '18.7'), 'hold-extended');
  assert.equal(get(r.starts, '18.7').from_day, '2026-11-13');
  assert.deepEqual(get(r.starts, '18.7').hold, HOLD);
  assert.deepEqual(r.alerts, []);
});

test('Freigabe nach Halt: Sammeltag aus MetaTFT-Start (begrenzt auf [Riots Tag, heute]), sonst der naechste', () => {
  const now = runAt('2026-11-20');   // laufender Sammeltag 2026-11-19
  const cases = [
    [LIVE, '2026-11-18', /MetaTFT-Start 2026-11-19T00:00:05/],
    [votes('ja', MT('18.7', '2026-11-05T00:00:00.000Z'), CD_NEW), '2026-11-11', /MetaTFT-Start/],    // vor Riots Tag
    [votes('ja', MT('18.7', '2026-11-25T00:00:00.000Z'), CD_NEW), '2026-11-19', /MetaTFT-Start/],    // nach heute
    // Notes + CDragon kommen meist einen Tag vor dem Go-Live → ohne MetaTFT-Start erst der naechste Sammeltag
    [votes('ja', MT('18.6'), CD_NEW), '2026-11-20', /naechster Sammeltag/],                           // MetaTFT nein
    [votes('ja', null, CD_NEW), '2026-11-20', /naechster Sammeltag/],                                 // MetaTFT weg
    [votes('ja', MT('18.7', '2026-11-19T00:00:05.000Z', 'b'), CD_NEW), '2026-11-20', /naechster Sammeltag/], // Start eines B-Patches
    [votes('ja', MT('18.8', '2026-11-16T00:00:05.000Z'), CD_NEW), '2026-11-20', /naechster Sammeltag/], // Start eines spaeteren Patches
    [votes('nein', MT('18.7', 'kaputt'), CD_NEW), '2026-11-20', /naechster Sammeltag/],
  ];
  for (const [obs, day, how] of cases) {
    const label = JSON.stringify(obs);
    const r = confirm(held('2026-11-19'), now, obs);
    const e = get(r.starts, '18.7');
    assert.equal(outcome(r, '18.7'), 'released', label);
    assert.equal(e.from_day, day, label);
    assert.equal(e.confirmed, true, label);
    assert.equal('hold' in e, false, label);
    assert.equal(e.previous_from_day, '2026-11-11', label);
    assert.equal(r.alerts.length, 1, label);
    assert.match(r.alerts[0], /^18\.7: nach Halt bestaetigt \(.*\) — gilt ab /, label);
    assert.match(r.alerts[0], how, label);
  }
});

test('Obergrenze: nie naeher als 6 Tage an den naechsten, nie mehr als 42 nach dem vorigen Termin', () => {
  // 19.1 am 01.12. → 18.7 spaetestens ab 25.11.
  let r = confirm(held('2026-11-24'), runAt('2026-11-25'), NONE);
  assert.equal(outcome(r, '18.7'), 'hold-extended');
  assert.equal(get(r.starts, '18.7').from_day, '2026-11-25');
  r = confirm(held('2026-11-25'), runAt('2026-11-26'), NONE);
  assert.equal(outcome(r, '18.7'), 'capped');
  assert.deepEqual(get(r.starts, '18.7'), get(held('2026-11-25'), '18.7'));
  assert.equal(r.alerts.length, 1);
  assert.match(r.alerts[0], /weniger als 6 Tage vor 19\.1 \(2026-12-01\).*Von Hand entscheiden \(pinned setzen\)/);
  // Freigabe ohne MetaTFT-Start an der Obergrenze: bleibt am angehaltenen Tag statt am naechsten Sammeltag
  r = confirm(held('2026-11-25'), runAt('2026-11-26'), votes('ja', MT('18.6'), CD_NEW));
  assert.equal(outcome(r, '18.7'), 'released');
  assert.equal(get(r.starts, '18.7').from_day, '2026-11-25');
  // nicht angehalten: kein Halt, nur Meldung
  r = confirm(withEntry('18.7', { from_day: '2026-11-25' }), runAt('2026-11-26'), NONE);
  assert.equal(outcome(r, '18.7'), 'capped');
  assert.deepEqual(get(r.starts, '18.7'), get(withEntry('18.7', { from_day: '2026-11-25' }), '18.7'));
  // ohne Nachfolger: hoechstens 42 Tage nach 18.6 (04.11. → 16.12.)
  const only18 = S18.filter((s) => s.set === 18);
  r = confirm(withEntry('18.7', { from_day: '2026-12-15', hold: HOLD }, only18), runAt('2026-12-16'), NONE);
  assert.equal(get(r.starts, '18.7').from_day, '2026-12-16');
  r = confirm(withEntry('18.7', { from_day: '2026-12-16', hold: HOLD }, only18), runAt('2026-12-17'), NONE);
  assert.equal(outcome(r, '18.7'), 'capped');
  assert.match(r.alerts[0], /mehr als 42 Tage nach 18\.6 \(2026-11-04\)/);
});

test('pinned und x.1 bleiben unberuehrt, auch bei klarem Nein', () => {
  const pinned = withEntry('18.7', { pinned: true });
  let r = confirm(pinned, RUN, NONE);
  assert.deepEqual(r.decisions, []);
  assert.deepEqual(r.starts, pinned);
  r = confirm(S18, runAt('2026-12-02'), votes('nein', MT('18.7'), CD_OLD, '19.1'), 19);
  assert.deepEqual(r.decisions, []);
  assert.deepEqual(r.starts, S18);
});

test('mergeSchedule: angehaltener Termin bleibt, auch wenn Riots Tag mehr als 3 Tage zurueckliegt', () => {
  const list = held('2026-11-16');
  for (const today of ['2026-11-12', '2026-11-15', '2026-11-20']) {
    const r = mergeSchedule(list, RIOT, today, LATER);
    assert.deepEqual(r.changes, [], today);
    assert.deepEqual(r.notes, [], today);
    assert.deepEqual(r.starts, list, today);
  }
  // Gegenprobe: ohne Halt wirft derselbe Stand (Sperre 3 Tage)
  assert.throws(() => mergeSchedule(withEntry('18.7', { from_day: '2026-11-16' }), RIOT, '2026-11-15', LATER), /vergangenen Termin/);
  // Riot nennt ein neues Datum: nur Hinweis
  const moved18 = RIOT.map((r) => (r.patch === '18.7' ? { ...r, from_day: '2026-11-18' } : r));
  const r = mergeSchedule(list, moved18, '2026-11-15', LATER);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.notes, ['18.7: angehalten (gilt fruehestens ab 2026-11-16), Riot nennt jetzt 2026-11-18 statt 2026-11-11']);
  assert.equal(get(r.starts, '18.7').from_day, '2026-11-16');
});

test('mergeSchedule: bestaetigter Termin bleibt, Riots alter Tag ohne Hinweis', () => {
  const done = withEntry('18.7', { from_day: '2026-11-18', confirmed: true, previous_from_day: '2026-11-11' });
  let r = mergeSchedule(done, RIOT, '2026-11-25', LATER);
  assert.deepEqual(r.changes, []);
  assert.deepEqual(r.notes, []);
  assert.deepEqual(r.starts, done);
  const other = RIOT.map((x) => (x.patch === '18.7' ? { ...x, from_day: '2026-11-20' } : x));
  r = mergeSchedule(done, other, '2026-11-25', LATER);
  assert.deepEqual(r.notes, ['18.7: Go-Live ab 2026-11-18 bestaetigt, Riot nennt 2026-11-20']);
  assert.equal(get(r.starts, '18.7').from_day, '2026-11-18');
  // Gegenprobe: ohne confirmed wirft derselbe Stand
  assert.throws(() => mergeSchedule(withEntry('18.7', { from_day: '2026-11-18', previous_from_day: '2026-11-11' }), RIOT, '2026-11-25', LATER), /vergangenen Termin/);
});

test('kaputte Eingaben der Bestaetigung werfen', () => {
  for (const hold of [{ since: RUN }, { riot_from_day: '11.11.2026' }, 'ja']) {
    const list = withEntry('18.7', { from_day: '2026-11-12', hold });
    assert.throws(() => confirm(list, RUN, NONE), /Halte-Eintrag ungueltig/, JSON.stringify(hold));
    assert.throws(() => mergeSchedule(list, RIOT, '2026-11-12', LATER), /Halte-Eintrag ungueltig/, JSON.stringify(hold));
  }
  assert.throws(() => confirm(S18, 'gestern', NONE), /Ungueltiger Zeitpunkt/);
  assert.throws(() => confirmStarts({}, { set: 18, now: RUN }), /keine Liste/);
});

// ---------- Das Skript mit Bestaetigung (ohne Netz, --votes-file) ----------

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (d) => `${MONTH_NAMES[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8))}, ${d.slice(0, 4)}`;
const PAGE18 = page(RIOT.map((r) => [`TFT ${r.patch}`, longDate(r.from_day)]));

function confirmBox(t, starts, { cuts = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tft-confirm-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const htmlFile = join(dir, 'seite.html');
  const setFile = join(dir, 'tft-set.json');
  const votesFile = join(dir, 'stimmen.json');
  writeFileSync(htmlFile, PAGE18);
  writeFileSync(setFile, JSON.stringify({ setNumber: 18, latestPatch: '18.6', patchCuts: cuts, patchStarts: starts }, null, 2) + '\n');
  const read = () => readFileSync(setFile, 'utf8');
  const run = (now, observations, { env = {}, extra = [] } = {}) => {
    writeFileSync(votesFile, JSON.stringify(observations));
    return spawnSync(process.execPath, [SCRIPT, '--file', htmlFile, '--now', now, '--votes-file', votesFile, '--set-file', setFile, ...extra],
      { encoding: 'utf8', env: { ...process.env, PATCH_CONFIRM: '1', ...env } });
  };
  return { run, read, entry: (patch) => get(JSON.parse(read()).patchStarts, patch) };
}

test('Skript: Halt → weiter angehalten → Freigabe, Meldung nur bei Halt und Freigabe', (t) => {
  const box = confirmBox(t, S18);
  let r = box.run(RUN, NONE);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /BEFUND 18\.7: angehalten — Riot nannte 2026-11-11/);
  assert.deepEqual(box.entry('18.7'), { ...get(S18, '18.7'), from_day: '2026-11-12', hold: { riot_from_day: '2026-11-11', since: RUN } });

  // 17.11.: Riots Tag liegt 6 Tage zurueck — ohne Halt wuerde mergeSchedule werfen
  for (const day of ['2026-11-13', '2026-11-17']) {
    r = box.run(runAt(day), NONE);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /BEFUND/);
    assert.equal(box.entry('18.7').from_day, day);
  }

  r = box.run(runAt('2026-11-19'), LIVE);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /BEFUND 18\.7: nach Halt bestaetigt .* gilt ab 2026-11-18/);
  assert.deepEqual(box.entry('18.7'), { ...get(S18, '18.7'), from_day: '2026-11-18', confirmed: true, previous_from_day: '2026-11-11' });

  const before = box.read();
  r = box.run(runAt('2026-11-20'), LIVE);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /kein offener Termin/);
  assert.match(r.stdout, /unveraendert/);
  assert.equal(box.read(), before);
});

test('Skript: Go-Live bestaetigt ohne Halt → Exit 0, keine Meldung', (t) => {
  const box = confirmBox(t, S18);
  const r = box.run(RUN, votes('ja', MT('18.7', '2026-11-12T00:00:05.000Z'), '2026-11-11T00:50:00.000Z'));
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /BEFUND/);
  assert.match(r.stdout, /18\.7: Go-Live ab 2026-11-11 bestaetigt/);
  assert.deepEqual(box.entry('18.7'), { ...get(S18, '18.7'), confirmed: true });
});

test('Skript: PATCH_CONFIRM=0 → keine Pruefung, Halte-Eintrag und Termine bleiben', (t) => {
  for (const [starts, now] of [[held('2026-11-12'), runAt('2026-11-15')], [S18, RUN]]) {
    const box = confirmBox(t, starts);
    const before = box.read();
    const r = box.run(now, NONE, { env: { PATCH_CONFIRM: '0' } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /abgeschaltet \(PATCH_CONFIRM=0\)/);
    assert.match(r.stdout, /unveraendert/);
    assert.equal(box.read(), before);
  }
});

test('Skript: Obergrenze → Exit 2 "von Hand entscheiden", nichts verschoben', (t) => {
  const box = confirmBox(t, held('2026-11-25'));
  const before = box.read();
  const r = box.run(runAt('2026-11-26'), NONE);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /BEFUND 18\.7: .*Von Hand entscheiden \(pinned setzen\)/);
  assert.equal(box.read(), before);
});

test('Skript: --dry-run meldet den Halt, schreibt aber nichts', (t) => {
  const box = confirmBox(t, S18);
  const before = box.read();
  const r = box.run(RUN, NONE, { extra: ['--dry-run'] });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /BEFUND 18\.7: angehalten/);
  assert.match(r.stdout, /--dry-run: nichts geschrieben/);
  assert.equal(box.read(), before);
});

test('Skript: Freigabe, die einen B-Patch ueberholt, wird verworfen — Exit 2, Halt bleibt', (t) => {
  const cut = { set: 18, patch: '18.6b', base: '18.6', from_day: '2026-11-15' };
  const box = confirmBox(t, held('2026-11-19'), { cuts: [cut] });
  const before = box.read();
  const r = box.run(runAt('2026-11-20'), votes('ja', MT('18.7', '2026-11-13T00:00:05.000Z'), CD_NEW));
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /BEFUND Bestaetigung nicht angewendet — passt nicht zu den B-Patches: B-Patch 18\.6b ab 2026-11-15 liegt nach dem Go-Live von 18\.7 \(2026-11-12\)/);
  assert.equal(box.read(), before);
});
