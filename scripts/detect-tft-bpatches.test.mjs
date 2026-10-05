// Riot hat den Aufbau der Mid-Patch-Abschnitte ab 18.2 geaendert (Datum als
// h4, frei benannte Kategorien). Die echten Seiten 18.1–18.3 liegen gekuerzt
// unter scripts/fixtures/tft-bpatch-notes-18-{1,2,3}.html (Stand 2026-10-05).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseMidpatch, categoryKind, notesFromHtml, notesUrl, fetchNotes,
  basesToCheck, mergeBaseCuts, run, LOOKBACK_DAYS,
} from './detect-tft-bpatches.mjs';
import { AUTO_SCAN_DAYS } from './lib/tft-patch-relabel.mjs';

const html = minor => readFileSync(new URL(`./fixtures/tft-bpatch-notes-18-${minor}.html`, import.meta.url), 'utf8');
const notesOf = base => notesFromHtml(html(base.split('.')[1]), notesUrl(base));
const balanceDays = base => {
  const n = notesOf(base);
  return parseMidpatch(n.body, n.publishIso).filter(u => u.balance).map(u => u.day);
};
const show = cs => cs.map(c => `${c.patch} ${c.from_day}`);

// Terminplan wie in public/tft-set.json (Stand 2026-10-05), fest im Test,
// damit spaetere Laeufe der Erkenner den Test nicht veraendern.
const STARTS = [
  ['18.1', '2026-08-26'], ['18.2', '2026-09-10'], ['18.3', '2026-09-23'], ['18.4', '2026-10-07'],
  ['18.5', '2026-10-21'], ['18.6', '2026-11-04'], ['19.1', '2026-12-01'], ['19.2', '2026-12-15'],
].map(([patch, from_day]) => ({ set: Number(patch.split('.')[0]), patch, from_day }));
const cut = (patch, from_day, extra = {}) => ({
  set: 18, patch, base: patch.slice(0, -1), from_day, source: 'alt', detected_at: '2026-09-01T00:00:00.000Z', ...extra,
});
const meta = (cuts = [], extra = {}) => ({ setNumber: 18, latestPatch: '18.3', patchStarts: STARTS, patchCuts: cuts, ...extra });
const NOW = '2026-10-05T03:00:00.000Z';
const fromFixtures = async base => (['18.1', '18.2', '18.3'].includes(base) ? notesOf(base) : null);
const fakeNotes = (base, body, publishIso) => ({ url: notesUrl(base), body: `<h2 id="patch-midpatch-updates">X</h2>${body}`, publishIso });

test('echte Seiten ergeben die richtigen Schnitte', () => {
  const from = base => show(mergeBaseCuts({ existing: [], days: balanceDays(base), base, set: 18, today: '2026-10-05', source: 'x', nowIso: NOW }).cuts);
  // 18.1: "AUGUST 31ST AND SEPTEMBER 1ST" als h3 → ab dem zweiten Tag.
  assert.deepEqual(from('18.1'), ['18.1b 2026-09-01']);
  // 18.2: zweite h2 mit derselben id beendet den Abschnitt ("XP PER LEVEL" waere unbekannt).
  assert.deepEqual(from('18.2'), ['18.2b 2026-09-14']);
  // 18.3: 28.09. hat keine Kategorie (Wisp abgeschaltet) — kein eigener Schnitt.
  assert.deepEqual(from('18.3'), ['18.3b 2026-09-24']);
  const n = notesOf('18.3');
  assert.deepEqual(parseMidpatch(n.body, n.publishIso).map(u => `${u.day} ${u.balance}`), ['2026-09-28 false', '2026-09-24 true']);
  assert.equal(n.url, notesUrl('18.3'));
  assert.equal(n.publishIso, '2026-09-22T18:00:00.000Z');
});

test('Seite ohne __NEXT_DATA__ oder ohne Text wirft', () => {
  assert.throws(() => notesFromHtml('<html></html>', 'u'), /__NEXT_DATA__ fehlt/);
  const empty = '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"page":{"blades":[]}}}}</script>';
  assert.throws(() => notesFromHtml(empty, 'u'), /kein Notes-Text/);
});

test('Kategorien nach Wortregel', () => {
  assert.equal(categoryKind('18.3 B PATCH BALANCE CHANGES'), 'balance');
  assert.equal(categoryKind('18.2 CHAMPION TARGETING'), 'balance');
  assert.equal(categoryKind('AUGMENTS TEMPORARILY DISABLED'), 'balance');
  assert.equal(categoryKind('WISPS'), 'balance');
  assert.equal(categoryKind('CHAMPION BUG FIXES'), 'other');
  assert.equal(categoryKind('PERFORMANCE/STABILITY BUG FIXES'), 'other');
  assert.equal(categoryKind('NEW ARENA'), 'unknown');
});

test('unbekannte Kategorie bricht ab', () => {
  const body = '<h2 id="patch-midpatch-updates">X</h2><h4>OCTOBER 2ND</h4><h4>NEW ARENA</h4>';
  assert.throws(() => parseMidpatch(body, '2026-09-30T00:00:00Z'), /Unbekannte Kategorie/);
});

test('Kategorie ohne Datum bricht weiter ab', () => {
  const body = '<h2 id="patch-midpatch-updates">X</h2><h4>UNITS</h4>';
  assert.throws(() => parseMidpatch(body, '2026-09-30T00:00:00Z'), /ohne Datums-Ueberschrift/);
});

test('Rueckblick entspricht der Auto-Umbenennung', () => {
  assert.equal(LOOKBACK_DAYS, AUTO_SCAN_DAYS);
});

test('welche Basen gelesen werden', () => {
  // 18.2 endet am 22.09. und reicht damit noch in die letzten 14 Tage.
  assert.deepEqual(basesToCheck(meta(), '2026-10-05'), ['18.3', '18.2']);
  // Am 07.10. startet 18.4; 18.2 liegt jetzt ganz vor dem Rueckblick.
  assert.deepEqual(basesToCheck(meta(), '2026-10-07'), ['18.4', '18.3']);
  // latestPatch zaehlt immer mit, auch wenn er laut Plan noch nicht live ist.
  assert.deepEqual(basesToCheck(meta([], { latestPatch: '18.4' }), '2026-10-05'), ['18.4', '18.3', '18.2']);
  // Ohne Terminplan wie frueher: latestPatch und der davor.
  assert.deepEqual(basesToCheck({ setNumber: 18, latestPatch: '18.3' }, '2026-10-05'), ['18.3', '18.2']);
  // latestPatch einer fremden Set zaehlt nicht.
  assert.deepEqual(basesToCheck(meta([], { latestPatch: '17.9' }), '2026-10-05'), ['18.3', '18.2']);
  assert.deepEqual(basesToCheck({ setNumber: 18, latestPatch: '17.9' }, '2026-10-05'), []);
});

const merge = (existing, days, today = '2026-10-05') =>
  mergeBaseCuts({ existing, days, base: '18.3', set: 18, today, source: 'neu', nowIso: NOW });

test('neuer Schnitt wird hinten angehaengt, bestehender bleibt unveraendert', () => {
  const r = merge([cut('18.3b', '2026-09-24')], ['2026-09-24', '2026-10-01']);
  assert.equal(r.conflict, null);
  assert.deepEqual(show(r.cuts), ['18.3b 2026-09-24', '18.3c 2026-10-01']);
  assert.equal(r.cuts[0].detected_at, '2026-09-01T00:00:00.000Z');
  assert.equal(r.cuts[0].source, 'alt');
  assert.deepEqual(r.cuts[1], { set: 18, patch: '18.3c', base: '18.3', from_day: '2026-10-01', source: 'neu', detected_at: NOW });
  assert.deepEqual(r.changes, ['18.3c neu ab 2026-10-01']);
});

test('zurueckgezogener Schnitt bleibt stehen und wird gemeldet', () => {
  const r = merge([cut('18.3b', '2026-09-24')], []);
  assert.equal(r.conflict, null);
  assert.deepEqual(show(r.cuts), ['18.3b 2026-09-24']);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /nicht mehr in den Notes/);
  // pinned: nur Hinweis, kein Befund.
  const p = merge([cut('18.3b', '2026-09-24', { pinned: true })], []);
  assert.equal(p.findings.length, 0);
  assert.equal(p.notes.length, 1);
});

test('Datum aendern nur bis heute−3', () => {
  // 03.10. → 04.10., heute 05.10.: beide Tage nicht vor dem 02.10. → erlaubt.
  const ok = merge([cut('18.3b', '2026-10-03')], ['2026-10-04']);
  assert.equal(ok.conflict, null);
  assert.deepEqual(show(ok.cuts), ['18.3b 2026-10-04']);
  assert.equal(ok.cuts[0].detected_at, NOW);
  assert.equal(ok.cuts[0].source, 'neu');
  assert.deepEqual(ok.changes, ['18.3b: 2026-10-03 → 2026-10-04']);
  // 24.09. → 25.09.: aelter als heute−3 → Abbruch.
  assert.match(merge([cut('18.3b', '2026-09-24')], ['2026-09-25']).conflict, /heute−3/);
  // Neuer Tag zu alt, alter Tag frisch → ebenfalls Abbruch.
  assert.match(merge([cut('18.3b', '2026-10-03')], ['2026-09-30']).conflict, /heute−3/);
});

test('pinned Schnitt aendert sein Datum nie', () => {
  const r = merge([cut('18.3b', '2026-10-03', { pinned: true })], ['2026-10-04']);
  assert.equal(r.conflict, null);
  assert.deepEqual(show(r.cuts), ['18.3b 2026-10-03']);
  assert.equal(r.cuts[0].pinned, true);
  assert.equal(r.changes.length, 0);
  assert.equal(r.notes.length, 1);
});

test('Einschub vor bestehendem Schnitt, Buchstaben-Luecke und Mehrdeutigkeit brechen ab', () => {
  assert.match(merge([cut('18.3b', '2026-09-24')], ['2026-09-20', '2026-09-24']).conflict, /vor dem letzten Schnitt/);
  assert.match(merge([cut('18.3b', '2026-09-24'), cut('18.3d', '2026-09-30')], ['2026-09-24', '2026-09-30']).conflict, /lueckenlos/);
  assert.match(merge([cut('18.3b', '2026-09-24')], ['2026-09-25', '2026-09-26'], '2026-09-27').conflict, /mehrdeutig/);
});

test('Lauf ueber die echten Seiten: nichts zu tun, wenn alles schon drinsteht', async () => {
  const stored = [cut('18.1b', '2026-09-01'), cut('18.2b', '2026-09-14'), cut('18.3b', '2026-09-24')];
  const r = await run({ meta: meta(stored), today: '2026-10-05', nowIso: NOW, fetchNotes: fromFixtures });
  assert.deepEqual(r.findings, []);
  assert.equal(r.exitCode, 0);
  assert.equal(r.changed, false);
  assert.deepEqual(Object.keys(r.perBase), ['18.3', '18.2']);
});

test('Lauf von leer: Schnitte fuer die gelesenen Basen', async () => {
  const r = await run({ meta: meta(), today: '2026-10-05', nowIso: NOW, fetchNotes: fromFixtures });
  assert.equal(r.exitCode, 0);
  assert.equal(r.changed, true);
  // 18.1 liegt vor dem Rueckblick und wird nicht mehr gelesen.
  assert.deepEqual(show(r.cuts), ['18.2b 2026-09-14', '18.3b 2026-09-24']);
});

test('Fehler einer Basis betrifft nur diese Basis', async () => {
  const fetcher = async base => {
    if (base === '18.2') throw new Error('HTTP 503');
    return notesOf(base);
  };
  const r = await run({ meta: meta(), today: '2026-10-05', nowIso: NOW, fetchNotes: fetcher });
  assert.equal(r.exitCode, 2);
  assert.equal(r.changed, true);
  assert.deepEqual(show(r.cuts), ['18.3b 2026-09-24']);
  assert.match(r.findings.join('\n'), /18\.2: Abruf fehlgeschlagen/);
});

test('unbekannte Kategorie laesst nur ihre Basis aus', async () => {
  const fetcher = async base => (base === '18.3'
    ? fakeNotes(base, '<h4>SEPTEMBER 25TH</h4><h4>NEW ARENA</h4>', '2026-09-22T18:00:00.000Z')
    : notesOf(base));
  const r = await run({ meta: meta(), today: '2026-10-05', nowIso: NOW, fetchNotes: fetcher });
  assert.equal(r.exitCode, 2);
  assert.deepEqual(show(r.cuts), ['18.2b 2026-09-14']);
  assert.match(r.findings.join('\n'), /18\.3: Unbekannte Kategorie/);
});

test('Terminplan-Pruefung verwirft eine Basis', async () => {
  // Schnitt am 22.09. laege vor dem Go-Live von 18.3 (23.09.).
  const fetcher = async base => (base === '18.3'
    ? fakeNotes(base, '<h4>SEPTEMBER 22ND</h4><h4>UNITS</h4>', '2026-09-22T18:00:00.000Z')
    : notesOf(base));
  const r = await run({ meta: meta(), today: '2026-10-05', nowIso: NOW, fetchNotes: fetcher });
  assert.equal(r.exitCode, 2);
  assert.deepEqual(show(r.cuts), ['18.2b 2026-09-14']);
  assert.match(r.findings.join('\n'), /18\.3: verworfen — .*nicht nach dem Go-Live/);
});

test('verbotene Aenderung eines bestehenden Schnitts: Abbruch, nichts geaendert', async () => {
  const stored = [cut('18.2b', '2026-09-14'), cut('18.3b', '2026-09-24')];
  const fetcher = async base => (base === '18.3'
    ? fakeNotes(base, '<h4>SEPTEMBER 25TH</h4><h4>UNITS</h4>', '2026-09-22T18:00:00.000Z')
    : notesOf(base));
  const r = await run({ meta: meta(stored), today: '2026-10-05', nowIso: NOW, fetchNotes: fetcher });
  assert.equal(r.exitCode, 1);
  assert.equal(r.changed, false);
  assert.deepEqual(r.cuts, stored);
  assert.match(r.conflicts[0], /^18\.3: 18\.3b muesste von 2026-09-24 auf 2026-09-25 wandern/);
});

test('404: Befund nur fuer schon gestartete Basen', async () => {
  const none = async () => null;
  const r = await run({ meta: meta([], { latestPatch: '18.4' }), today: '2026-10-05', nowIso: NOW, fetchNotes: none });
  const all = r.findings.join('\n');
  assert.match(all, /18\.3: keine Notes \(404\)/);
  assert.match(all, /18\.2: keine Notes \(404\)/);
  assert.doesNotMatch(all, /18\.4/);
  assert.equal(r.perBase['18.4'], 'keine Notes (404), noch nicht live');
});

test('Terminplan-Probleme vor dem Lauf werden gemeldet, sperren aber nicht', async () => {
  const stored = [cut('18.2b', '2026-09-14'), cut('18.3b', '2026-09-24'), { set: 18, patch: 'kaputt', base: '18.3', from_day: '2026-09-25' }];
  const r = await run({ meta: meta(stored), today: '2026-10-05', nowIso: NOW, fetchNotes: fromFixtures });
  assert.equal(r.exitCode, 2);
  assert.match(r.findings[0], /^Terminplan: B-Patch-Eintrag verworfen/);
  // Der kaputte Eintrag bleibt in der Datei, der Lauf aendert nichts.
  assert.equal(r.changed, false);
  assert.ok(r.cuts.some(c => c.patch === 'kaputt'));
});

const response = (status, body = '') => ({ status, ok: status >= 200 && status < 300, text: async () => body });
function fakeFetch(steps) {
  const calls = [];
  const impl = async url => {
    calls.push(url);
    const s = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (s instanceof Error) throw s;
    return s;
  };
  return { impl, calls };
}
const noSleep = async () => {};

test('Abruf wiederholt 5xx und Netzfehler', async () => {
  const f = fakeFetch([response(500), new Error('ECONNRESET'), response(200, html(3))]);
  const n = await fetchNotes('18.3', { fetchImpl: f.impl, sleep: noSleep });
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0], notesUrl('18.3'));
  assert.equal(n.publishIso, '2026-09-22T18:00:00.000Z');
  const g = fakeFetch([response(429), response(200, html(3))]);
  assert.ok(await fetchNotes('18.3', { fetchImpl: g.impl, sleep: noSleep }));
  assert.equal(g.calls.length, 2);
});

test('Abruf: 404 ist leer, 403 wirft sofort, dreimal 503 wirft', async () => {
  const a = fakeFetch([response(404)]);
  assert.equal(await fetchNotes('18.9', { fetchImpl: a.impl, sleep: noSleep }), null);
  assert.equal(a.calls.length, 1);
  const b = fakeFetch([response(403)]);
  await assert.rejects(fetchNotes('18.3', { fetchImpl: b.impl, sleep: noSleep }), /HTTP 403/);
  assert.equal(b.calls.length, 1);
  const c = fakeFetch([response(503)]);
  await assert.rejects(fetchNotes('18.3', { fetchImpl: c.impl, sleep: noSleep }), /HTTP 503/);
  assert.equal(c.calls.length, 3);
});
