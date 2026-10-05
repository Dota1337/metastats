// Tests fuer die Regeln des Historie-Modus (D7, D8-B, D10).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildHistoryEntries, checkPlausible, needsInfobox, decideEarnings, newerTablePages,
  selectHistoryTargets, normalizePage, isResultsList, listPrizeSum, withTimeout, StepTimeoutError,
} from './tft-pro-history.mjs';
import { parseResultsHtml } from './tft-tournament-parse.mjs';
import { normalizeLiquipediaPage } from '../../app/lib/tft-tournament-history-merge.ts';

const READ_AT = '2026-10-05T08:00:00.000Z';
const fixture = readFileSync(new URL('../fixtures/tft-tournament-results.html', import.meta.url), 'utf8');

test('Fixture → Eintraege mit src, Lesezeitpunkt, Sieg nur bei "1st", kein 0-Preis', () => {
  const parsed = parseResultsHtml(fixture, { playerName: 'Loescher' });
  const entries = buildHistoryEntries(parsed.rows, READ_AT);
  assert.equal(entries.length, parsed.rows.length);
  assert.ok(isResultsList(entries));
  assert.ok(entries.every(e => e.read_at === READ_AT));
  assert.ok(entries.every(e => e.prize_usd === null || e.prize_usd > 0));
  for (const e of entries) assert.equal(e.win, e.place === '1st');
  assert.equal(listPrizeSum(entries), entries.reduce((s, e) => s + (e.prize_usd || 0), 0));
});

test('Plausibilitaet: Kopfzeile, leere Tabelle, Einbruch', () => {
  assert.equal(checkPlausible({ headerFound: false, rows: [] }, 0).ok, false);
  assert.equal(checkPlausible({ headerFound: true, rows: [] }, 0).ok, false);
  const rows = (n) => ({ headerFound: true, rows: Array.from({ length: n }, () => ({})) });
  assert.equal(checkPlausible(rows(4), 10).ok, false);   // 10 → 4: Einbruch
  assert.equal(checkPlausible(rows(5), 10).ok, true);    // genau die Haelfte
  assert.equal(checkPlausible(rows(1), 9).ok, true);     // alte Liste zu klein fuer die Regel
  assert.equal(checkPlausible(rows(60), 51).ok, true);
});

test('Infobox nur bei neuem/geaendertem Preis, fehlendem Wert oder alter Liste', () => {
  const e = (page, place, prize) => ({ tournament: page, title: page, placement: place, prize_usd: prize, src: 'results', read_at: READ_AT });
  const old = [e('A/Cup', 1, 500), e('B/Cup', 3, null)];
  assert.equal(needsInfobox(old, [e('A/Cup', 1, 500), e('B/Cup', 3, null)], 1000), false);
  assert.equal(needsInfobox(old, [e('A/Cup', 1, 500), e('B/Cup', 3, null), e('C/Cup', 9, null)], 1000), false); // neu, aber unbezahlt
  assert.equal(needsInfobox(old, [e('A/Cup', 1, 500), e('C/Cup', 2, 100)], 1000), true);  // neu bezahlt
  assert.equal(needsInfobox(old, [e('A/Cup', 1, 600)], 1000), true);                       // Betrag geaendert
  assert.equal(needsInfobox(old, [e('A/Cup', 1, 500)], null), true);                       // kein Wert
  assert.equal(needsInfobox(old, [e('A/Cup', 1, 500)], 0), true);
  assert.equal(needsInfobox([{ tournament: 'A', page: 'x', prize_usd: 500 }], [e('A/Cup', 1, 500)], 1000), true); // alte Liste
});

test('Preisgeld: Infobox, sonst Listensumme, nie 0', () => {
  assert.equal(decideEarnings({ infoboxFetched: false, infobox: null, listSum: 999 }), undefined);
  assert.equal(decideEarnings({ infoboxFetched: true, infobox: 235109, listSum: 244282 }), 235109);
  assert.equal(decideEarnings({ infoboxFetched: true, infobox: null, listSum: 700 }), 700);
  assert.equal(decideEarnings({ infoboxFetched: true, infobox: 0, listSum: 0 }), undefined);
});

test('Neuere Tabellen-Turniere: fehlt in der Liste und endete nach Lesezeitpunkt − 14 Tage', () => {
  const list = [{ title: 'Space_Gods/EMEA/Major', page: 'https://liquipedia.net/tft/Space_Gods/EMEA/Major', src: 'results', read_at: READ_AT }];
  const tours = [
    { page: 'Space_Gods/EMEA/Major', end: '2026-10-01' },   // in der Liste
    { page: 'Neu/Cup', end: '2026-09-21' },                 // genau an der Grenze
    { page: 'Alt/Cup', end: '2026-09-20' },                 // zu alt
    { page: 'Ohne/Ende', end: null },
  ];
  assert.deepEqual(newerTablePages(list, tours), ['neu/cup']);
  assert.deepEqual(newerTablePages([{ title: 'X', page: 'x' }], tours), []); // alte Liste: Regel greift nicht
});

test('Auswahl: nie geholt → neuere Zeilen → aelteste, 40 Plaetze reserviert', () => {
  const mk = (id, src, stamp) => ({ id, pro_name: `P${String(id).padStart(3, '0')}`, source_page: `P${id}`, hist_src: src, last_history_enriched_at: stamp });
  const pros = [];
  for (let i = 0; i < 80; i++) pros.push(mk(i, null, null));                                  // nie geholt
  for (let i = 80; i < 90; i++) pros.push(mk(i, 'results', '2026-10-10T00:00:00Z'));          // neuere Zeilen
  for (let i = 90; i < 150; i++) pros.push(mk(i, 'results', `2026-10-${String(6 + (i % 20)).padStart(2, '0')}T00:00:00Z`));
  pros.push(mk(200, null, '2026-10-06T00:00:00Z'));   // vom Modus gestempelt, ohne Liste (404)
  pros.push({ ...mk(201, null, null), source_page: null });
  const newerIds = new Set([80, 81, 82, 83, 84, 85, 86, 87, 88, 89]);
  const r = selectHistoryTargets(pros, { newerIds, max: 93, minOldest: 40 });
  assert.equal(r.selected.length, 93);
  assert.deepEqual(r.groups, { never: 80, newer: 10, oldest: 61 });
  const ids = r.selected.map(p => p.id);
  assert.equal(ids.filter(id => id < 80).length, 53);         // 93 − 40
  assert.equal(ids.filter(id => id >= 80 && id < 90).length, 0);
  assert.equal(ids.filter(id => id >= 90).length, 40);
  assert.ok(!ids.includes(201));
  assert.equal(r.deferred, 151 - 93);

  // Wenige Aelteste: freie Plaetze gehen an die vorderen Gruppen
  const r2 = selectHistoryTargets(pros.slice(0, 90), { newerIds, max: 93 });
  assert.equal(r2.selected.length, 90);
  // Nachlauf --max 372: alle
  assert.equal(selectHistoryTargets(pros, { newerIds, max: 372 }).selected.length, 151);
  // Aelteste zuerst (nie gestempelt vor gestempelt)
  const r3 = selectHistoryTargets([mk(1, 'results', '2026-10-20T00:00:00Z'), mk(2, 'results', null)], { max: 1 });
  assert.equal(r3.selected[0].id, 2);
});

test('Seitennamen gleich normalisiert wie die Anzeige', () => {
  for (const s of ['https://liquipedia.net/tft/Magic_n%27_Mayhem/EMEA', "Magic n' Mayhem/EMEA", 'Bad%E0%A4%A', 'A/B/', null]) {
    assert.equal(normalizePage(s), normalizeLiquipediaPage(s));
  }
});

test('Zeitlimit greift', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 20, 'Probe'), /Zeitlimit/);
  // Eigene Klasse: Aufrufer halten danach an, statt mit dem naechsten Abruf weiterzumachen.
  await assert.rejects(withTimeout(new Promise(() => {}), 20, 'Probe'), (e) => e instanceof StepTimeoutError);
  // Ein normaler Fehler des Abrufs ist KEIN Zeitlimit.
  await assert.rejects(withTimeout(Promise.reject(new Error('kaputt')), 1000, 'x'), (e) => !(e instanceof StepTimeoutError));
  assert.equal(await withTimeout(Promise.resolve(7), 1000, 'x'), 7);
});

test('Alias zaehlt als derselbe Spieler (kein Duo-Partner)', () => {
  const html = `<table><tr><th>Date</th><th>Place</th><th>Tier</th><th colspan="2">Tournament</th><th>Team</th><th>Prize</th></tr>
<tr><td>2026-01-02</td><td data-sort-value="1"><span class="placement-text">1st</span></td><td><a href="/tft/B" title="B">B-Tier</a></td><td></td>
<td><a href="/tft/Duo_Cup" title="Duo Cup">Duo Cup</a></td>
<td><div class="block-players-wrapper"><div class="block-player"><span class="name"><a>Deleted</a></span></div><div class="block-player"><span class="name"><a>Partner</a></span></div></div></td><td>$100</td></tr></table>`;
  const without = parseResultsHtml(html, { playerName: 'JosueDeleted' }).rows[0];
  const withAlias = parseResultsHtml(html, { playerName: 'JosueDeleted', aliases: ['Deleted'] }).rows[0];
  assert.deepEqual(without.partners, ['Deleted', 'Partner']);
  assert.deepEqual(withAlias.partners, ['Partner']);
  assert.equal(withAlias.mode, 'duo');
});
