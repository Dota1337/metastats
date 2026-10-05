import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decide, redactReport, sign, verifySignature, keyOf, withMarker, parseMarker, BUNDLE_AT,
} from './contracts-alert.mjs';

const NOW = Date.parse('2026-09-29T23:30:00Z');
const AT = '2026-09-29T23:01:00Z';

// Echte Zeilen aus /var/lib/metastats/contracts-status.json vom 2026-09-28.
const RAW = {
  checkedAt: AT,
  summary: { ok: 1, broken: 2, error: 0, skipped: 0 },
  results: [
    { id: 'daily-crawl/comp-stats', owner: 'metastats-daily-crawl.service', status: 'ok', detail: '2026-09-27: 12262 Rows (min 3000, Lag 1d)' },
    { id: 'lol-matchfill/match-cache', owner: 'x', status: 'broken', detail: 'letzter Tag 2026-09-20 ist 8d alt, erlaubt sind 3d' },
    { id: 'sicherheit/anon-lockout', owner: 'x', status: 'broken', detail: '2 offene Leserechte: tft_mv_peaks_backup_20260927→anon' },
  ],
};
// Standardtyp steht in contracts.json ohne `type` — der Server mappt ihn auf ''.
const TYPES = new Map([['daily-crawl/comp-stats', ''], ['lol-matchfill/match-cache', ''], ['sicherheit/anon-lockout', 'anon-lockout']]);

const report = () => redactReport(RAW, TYPES);
const issue = (number, state, key, extra = {}) => ({ number, state, title: 't', body: withMarker('text', { key, green: 0, ...extra }) });

test('redact: Sicherheitsvertrag verliert Detail, Fehlertext bleibt auf der Box', () => {
  const r = redactReport({ ...RAW, results: [...RAW.results, { id: 'e', status: 'error', detail: 'connect ECONNREFUSED 10.0.0.1:5432' }] }, TYPES);
  const sec = r.results.find((x) => x.id === 'sicherheit/anon-lockout');
  assert.equal(sec.sensitive, true);
  assert.equal(sec.reason, null);
  assert.ok(!JSON.stringify(r).includes('tft_mv_peaks'));
  assert.ok(!JSON.stringify(r).includes('ECONNREFUSED'));
  assert.ok(!JSON.stringify(r).includes('detail'));
});

test('redact: unbekannte Kennung bekommt keinen Grund', () => {
  const r = redactReport({ ...RAW, results: [{ id: 'neu', status: 'broken', detail: 'geheim' }] }, TYPES);
  assert.equal(r.results[0].reason, null);
});

test('Signatur: gueltig, abgelaufen, falsches Token', () => {
  const ts = String(NOW);
  assert.equal(verifySignature('abc', ts, sign('abc', ts), NOW), true);
  assert.equal(verifySignature('abc', ts, sign('abc', ts), NOW + 6 * 60_000), false);
  assert.equal(verifySignature('abc', ts, sign('xyz', ts), NOW), false);
  assert.equal(verifySignature('abc', ts, 'zz', NOW), false);
  assert.equal(verifySignature('', ts, sign('', ts), NOW), false);
});

test('erster Lauf: je roter Vertrag eine Aufgabe, Sicherheit neutral betitelt', () => {
  const ops = decide({ kind: 'report', report: report(), now: NOW }, []);
  const creates = ops.filter((o) => o.op === 'create');
  assert.equal(creates.length, 2);
  assert.ok(creates.some((o) => o.title === '[Vertrag] lol-matchfill/match-cache'));
  const sec = creates.find((o) => !o.title.includes('lol-'));
  assert.ok(!sec.title.includes('sicherheit') && !sec.body.includes('anon'));
});

test('zweiter Lauf, gleicher Grund mit anderen Zahlen: nichts', () => {
  const first = decide({ kind: 'report', report: report(), now: NOW }, []);
  const issues = first.map((o, i) => ({ number: i + 1, state: 'open', title: o.title, body: o.body }));
  const r2 = report();
  r2.results[1].reason = 'letzter Tag 2026-09-20 ist 9d alt, erlaubt sind 3d';
  assert.deepEqual(decide({ kind: 'report', report: r2, now: NOW }, issues), []);
});

test('Grund aendert sich: ein Kommentar', () => {
  const k = keyOf('lol-matchfill/match-cache');
  const ops = decide({ kind: 'report', report: report(), now: NOW }, [issue(5, 'open', k, { reason: 'anders' })]);
  assert.ok(ops.some((o) => o.op === 'comment' && o.number === 5));
});

test('gruen: erst nach zwei Laeufen schliessen', () => {
  const k = keyOf('daily-crawl/comp-stats');
  const once = decide({ kind: 'report', report: report(), now: NOW }, [issue(7, 'open', k)]);
  assert.ok(once.some((o) => o.op === 'edit' && o.number === 7 && parseMarker(o.body).green === 1));
  assert.ok(!once.some((o) => o.op === 'close' && o.number === 7));
  const twice = decide({ kind: 'report', report: report(), now: NOW }, [issue(7, 'open', k, { green: 1 })]);
  assert.ok(twice.some((o) => o.op === 'close' && o.number === 7));
});

test('wieder rot: geschlossene Aufgabe wird wiedereroeffnet statt neu angelegt', () => {
  const k = keyOf('lol-matchfill/match-cache');
  const ops = decide({ kind: 'report', report: report(), now: NOW }, [issue(3, 'closed', k)]);
  assert.ok(ops.some((o) => o.op === 'reopen' && o.number === 3));
  assert.ok(!ops.some((o) => o.op === 'create' && o.title.includes('lol-')));
});

test('skipped schliesst nichts, entfernter Vertrag schon', () => {
  const r = report();
  r.results[0].status = 'skipped';
  const skippedKey = keyOf('daily-crawl/comp-stats');
  const ops = decide({ kind: 'report', report: r, now: NOW }, [issue(8, 'open', skippedKey), issue(9, 'open', keyOf('weg/damit'))]);
  assert.ok(!ops.some((o) => o.number === 8));
  assert.ok(ops.some((o) => o.op === 'close' && o.number === 9));
});

test('ab BUNDLE_AT rot: nur eine Sammel-Aufgabe', () => {
  const r = report();
  for (let i = 0; i < BUNDLE_AT; i++) r.results.push({ id: `x/${i}`, status: 'broken', sensitive: false, reason: 'weg' });
  const ops = decide({ kind: 'report', report: r, now: NOW }, []);
  assert.equal(ops.length, 1);
  assert.match(ops[0].title, /Pruefungen rot/);
  assert.ok(!ops[0].body.includes('sicherheit/'));
});

test('Totmann: nicht erreichbar und veraltet getrennt, veraltet bewertet nicht neu', () => {
  const un = decide({ kind: 'unreachable', why: 'HTTP 503' }, []);
  assert.equal(un.length, 1);
  assert.match(un[0].title, /nicht erreichbar/);
  const stale = decide({ kind: 'report', report: report(), now: NOW + 31 * 3_600_000 }, [issue(4, 'open', keyOf('daily-crawl/comp-stats'))]);
  assert.equal(stale.length, 1);
  assert.match(stale[0].title, /laeuft nicht/);
});

// ---- Gelb (warn) ------------------------------------------------------------

const WARN_RAW = {
  checkedAt: AT,
  summary: { ok: 0, warn: 1, broken: 0, error: 0, skipped: 0 },
  results: [{ id: 'box/stand-main', status: 'warn', detail: 'Box-Stand liegt hinter main: 3 Commit(s), davon 2 Datei(en) in den Deploy-Pfaden, juengster Commit vor 5 h — Deploy gescheitert oder nicht angestossen' }],
};
const WARN_TYPES = new Map([['box/stand-main', 'box-main']]);
const warnReport = () => redactReport(WARN_RAW, WARN_TYPES);
const WKEY = keyOf('box/stand-main');

test('gelb: Grund verlaesst die Box, Sicherheitsvertrag bleibt stumm', () => {
  const r = warnReport();
  assert.equal(r.results[0].status, 'warn');
  assert.match(r.results[0].reason, /hinter main/);
  const sec = redactReport({ ...WARN_RAW, results: [{ id: 'sicherheit/anon-lockout', status: 'warn', detail: 'tabelle_x→anon' }] }, TYPES);
  assert.equal(sec.results[0].reason, null);
  assert.ok(!JSON.stringify(sec).includes('tabelle_x'));
});

test('gelb: eigene Aufgabe mit "(Warnung)" und Stufe im Marker', () => {
  const ops = decide({ kind: 'report', report: warnReport(), now: NOW }, []);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, 'create');
  assert.equal(ops[0].title, '[Vertrag] box/stand-main (Warnung)');
  assert.match(ops[0].body, /gelb \(Warnung, kein Ausfall\)/);
  assert.equal(parseMarker(ops[0].body).level, 'warn');
});

test('gelb, zweiter Lauf mit anderen Zahlen: keine neue Mail', () => {
  const first = decide({ kind: 'report', report: warnReport(), now: NOW }, []);
  const issues = first.map((o, i) => ({ number: i + 1, state: 'open', title: o.title, body: o.body }));
  const r2 = warnReport();
  r2.results[0].reason = 'Box-Stand liegt hinter main: 7 Commit(s), davon 4 Datei(en) in den Deploy-Pfaden, juengster Commit vor 29 h — Deploy gescheitert oder nicht angestossen';
  assert.deepEqual(decide({ kind: 'report', report: r2, now: NOW }, issues), []);
});

test('gelb -> rot: Kommentar und neuer Titel', () => {
  const open = { number: 11, state: 'open', title: '[Vertrag] box/stand-main (Warnung)', body: withMarker('text', { key: WKEY, green: 0, level: 'warn', reason: 'x' }) };
  const r = warnReport();
  r.results[0].status = 'broken';
  const ops = decide({ kind: 'report', report: r, now: NOW }, [open]);
  assert.ok(ops.some((o) => o.op === 'comment' && o.number === 11 && /jetzt rot/.test(o.body)));
  const edit = ops.find((o) => o.op === 'edit' && o.number === 11);
  assert.equal(edit.title, '[Vertrag] box/stand-main');
  assert.equal(parseMarker(edit.body).level, 'red');
});

test('gelb wieder da: geschlossene Aufgabe "Wieder gelb."', () => {
  const ops = decide({ kind: 'report', report: warnReport(), now: NOW }, [issue(12, 'closed', WKEY)]);
  const reopen = ops.find((o) => o.op === 'reopen');
  assert.equal(reopen.number, 12);
  assert.match(reopen.comment, /^Wieder gelb\./);
  assert.equal(ops.find((o) => o.op === 'edit').title, '[Vertrag] box/stand-main (Warnung)');
});

test('alte rote Aufgabe ohne Stufe im Marker bleibt bei rot ruhig', () => {
  const k = keyOf('lol-matchfill/match-cache');
  const reason = 'letzter Tag #-#-# ist #d alt, erlaubt sind #d';
  const ops = decide({ kind: 'report', report: report(), now: NOW }, [issue(13, 'open', k, { reason })]);
  assert.ok(!ops.some((o) => o.number === 13));
});

test('gelb zaehlt nicht fuer die Sammel-Aufgabe', () => {
  const r = report();
  for (let i = 0; i < BUNDLE_AT; i++) r.results.push({ id: `w/${i}`, status: 'warn', sensitive: false, reason: 'gelb' });
  const ops = decide({ kind: 'report', report: r, now: NOW }, []);
  assert.ok(!ops.some((o) => /Pruefungen rot/.test(o.title ?? '')));
  assert.equal(ops.filter((o) => o.op === 'create' && /\(Warnung\)/.test(o.title)).length, BUNDLE_AT);
});

test('Totmann-Aufgaben schliessen, sobald frisch', () => {
  const ops = decide({ kind: 'report', report: report(), now: NOW }, [issue(1, 'open', '__unreachable'), issue(2, 'open', '__stale')]);
  assert.ok(ops.some((o) => o.op === 'close' && o.number === 1));
  assert.ok(ops.some((o) => o.op === 'close' && o.number === 2));
});
