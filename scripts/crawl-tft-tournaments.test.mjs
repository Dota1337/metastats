// Tests fuer die reinen Regeln des Turnier-Crawlers (Plan Aufgabe B).
// Der Import darf den Lauf nicht starten (Import-Schutz in main).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  entrantsFromRows, buildPageIndex, linkPuuid, planDeletes, repairTargets, dedupeResults,
  toAwardRows, placeAwardsByRedirect, TEAM_PRIZE_MODE, TFT_SET_NAMES, SEED_TOURNAMENTS,
} from './crawl-tft-tournaments.mjs';

test('Sonderpreise: Platz-Name ueber Link, dann Name; mehrdeutig → null; Dubletten raus', () => {
  const idx = buildPageIndex([{ pro_name: 'Loescher', source_page: 'Loescher', puuid: 'p-loe' }]);
  const places = [
    { placement: 15, proName: 'Loescher', link: null },
    { placement: 3, proName: 'Josue', link: 'JosueDeleted' },
    { placement: 7, proName: 'Twin', link: null },
    { placement: 8, proName: 'twin', link: 'Twin_(2)' },
  ];
  const convertLocal = (raw) => (raw == null ? null
    : { usd: Math.round(raw * 0.14), native: raw, currency: 'CNY', rate: 0.14, date: '2026-09-19', source: 'ecb' });
  const rows = toAwardRows('ew', [
    { award: '1 Win Bounty', proName: 'Loescher', link: null, prizeUsdRaw: 100 },
    { award: '1 Win Bounty', proName: 'Loescher', link: null, prizeUsdRaw: 100 },   // Dublette
    { award: '1 Win Bounty', proName: 'Deleted', link: 'JosueDeleted', prizeUsdRaw: 100 },
    { award: 'MVP', proName: 'LOESCHER ', link: 'Nobody', prizeUsdRaw: null, prizeLocalRaw: 1000 },
    { award: 'MVP', proName: 'Twin', link: 'Twin', prizeUsdRaw: 50 },
    { award: 'MVP', proName: 'Fremd', link: null, prizeUsdRaw: 50 },
  ], convertLocal, idx, places);
  assert.equal(rows.length, 5);
  const by = (a, n) => rows.find(r => r.award === a && r.pro_name === n);
  const loe = by('1 Win Bounty', 'Loescher');
  assert.equal(loe.place_name, 'Loescher');
  assert.equal(loe.pro_puuid, 'p-loe');
  assert.equal(loe.prize_usd, 100);
  assert.equal(loe.prize_currency, 'USD');
  assert.equal(loe.fx_source, 'usd');
  assert.equal(by('1 Win Bounty', 'Deleted').place_name, 'Josue');       // ueber den Link
  const mvp = by('MVP', 'LOESCHER ');
  assert.equal(mvp.place_name, 'Loescher');                                // Link ohne Treffer → Name
  assert.equal(mvp.prize_usd, 140);
  assert.equal(mvp.prize_native, 1000);
  assert.equal(mvp.prize_currency, 'CNY');
  assert.equal(by('MVP', 'Twin').place_name, 'Twin');                      // Link trifft genau eine Zeile
  assert.equal(by('MVP', 'Fremd').place_name, null);
  assert.equal(by('MVP', 'Fremd').tournament_id, 'ew');
});

test('Sonderpreise: zwei gleichnamige Platz-Zeilen ohne Link → kein Platz-Name', () => {
  const places = [{ placement: 7, proName: 'Twin', link: null }, { placement: 8, proName: 'twin', link: null }];
  const rows = toAwardRows('x', [{ award: 'MVP', proName: 'Twin', link: null, prizeUsdRaw: 50 }], () => null, new Map(), places);
  assert.equal(rows[0].place_name, null);
  assert.equal(rows[0].pro_puuid, null);
  const none = toAwardRows('x', [{ award: 'MVP', proName: 'Y', link: null, prizeUsdRaw: null, prizeLocalRaw: null }], () => null, new Map(), []);
  assert.equal(none[0].prize_usd, null);
  assert.equal(none[0].prize_currency, null);
});

test('Sonderpreise: Weiterleitungsnamen in beide Richtungen, nur offene Boni, nur eindeutig', async () => {
  const places = [
    { placement: 4, proName: 'Dankmemes', link: null },          // Platz traegt den Weiterleitungsnamen
    { placement: 16, proName: 'Josue', link: 'Deleted' },        // Link ist eine Weiterleitung
    { placement: 9, proName: 'Neu', link: 'NeuName' },           // Bonus nennt den alten Namen
    { placement: 2, proName: 'Twin', link: null },
    { placement: 3, proName: 'TwinB', link: 'TwinAlt' },         // zwei Zeilen fuer dieselbe Seite
    { placement: 1, proName: 'Loescher', link: null },
  ];
  const rows = [
    { award: 'Bounty', pro_name: 'Dankmemes01', link: 'Dankmemes01', place_name: null },
    { award: 'Bounty', pro_name: 'JosueDeleted', link: 'JosueDeleted', place_name: null },
    { award: 'Bounty', pro_name: 'Alt', link: 'AltName', place_name: null },
    { award: 'Bounty', pro_name: 'Twin', link: 'TwinPage', place_name: null },
    { award: 'Bounty', pro_name: 'Fehlt', link: null, place_name: null },
    { award: 'Bounty', pro_name: 'Loescher', link: null, place_name: 'Loescher' },
  ];
  const asked = [];
  const resolve = async (titles) => {
    asked.push(...titles);
    const m = { Dankmemes01: 'Dankmemes01', JosueDeleted: 'JosueDeleted', AltName: 'NeuName', TwinPage: 'TwinPage', Fehlt: null };
    return new Map(titles.map(t => [t, m[t] ?? null]));
  };
  const aliases = async (pages) => {
    const m = { Dankmemes01: ['Dankmemes'], JosueDeleted: ['Deleted', 'Josue Deleted'], NeuName: [], TwinPage: ['Twin', 'TwinAlt'] };
    return new Map(pages.map(p => [p, m[p] || []]));
  };
  await placeAwardsByRedirect(rows, places, { resolve, aliases });
  const by = (n) => rows.find(r => r.pro_name === n).place_name;
  assert.equal(by('Dankmemes01'), 'Dankmemes');
  assert.equal(by('JosueDeleted'), 'Josue');
  assert.equal(by('Alt'), 'Neu');
  assert.equal(by('Twin'), null);            // Seite trifft zwei Platz-Zeilen → nicht raten
  assert.equal(by('Fehlt'), null);           // Seite gibt es nicht
  assert.equal(by('Loescher'), 'Loescher');  // schon zugeordnet, bleibt
  assert.ok(!asked.includes('Loescher'));    // nur offene Boni werden nachgeschlagen

  // nichts offen oder keine Plaetze → keine Abfrage
  let calls = 0;
  const count = async () => { calls++; return new Map(); };
  await placeAwardsByRedirect([{ pro_name: 'A', place_name: 'A' }], places, { resolve: count, aliases: count });
  await placeAwardsByRedirect([{ pro_name: 'A', place_name: null }], [], { resolve: count, aliases: count });
  assert.equal(calls, 0);
});

test('Loeschen mit eigenem Schluessel (Sonderpreise)', () => {
  const keyOf = r => `${r.award}|${r.pro_name}`;
  const stored = [{ award: 'MVP', pro_name: 'A' }, { award: 'Bounty', pro_name: 'A' }, { award: 'Bounty', pro_name: 'B' }];
  const p = planDeletes(stored, [{ award: 'MVP', pro_name: 'A' }, { award: 'Bounty', pro_name: 'A' }], { intact: true, infobox: true, keyOf });
  assert.deepEqual(p.remove, [{ award: 'Bounty', pro_name: 'B' }]);
  // ohne keyOf wuerden alle drei (placement undefined) als gleich gelten
  assert.equal(planDeletes(stored, stored, { intact: true, infobox: true, keyOf }).remove.length, 0);
  assert.equal(planDeletes(stored, [], { intact: false, infobox: true, keyOf }).review.length, 3);
});

test('Teilnehmer aus Zeilen: Solo, Team (D3), Duo, leer', () => {
  const solo = [
    { kind: 'solo', proName: 'Loescher', placement: 1 },
    { kind: 'solo', proName: 'loescher', placement: 1 },   // gleicher Spieler
    { kind: 'solo', proName: 'k0nda1', placement: 2 },
  ];
  assert.equal(entrantsFromRows(solo), 2);
  const team = [
    { kind: 'team', proName: 'A', team: 'Alpha', placement: 1 },
    { kind: 'team', proName: 'B', team: 'alpha', placement: 1 },
    { kind: 'team', proName: 'C', team: null, placement: 2 },
    { kind: 'team', proName: 'D', team: null, placement: 2 },
    { kind: 'team', proName: 'E', team: 'Beta', placement: 3 },
  ];
  assert.equal(entrantsFromRows(team), 3);   // Alpha, Platz 2 ohne Team, Beta
  const duo = [
    { kind: 'duo', proName: 'A', placement: 1 }, { kind: 'duo', proName: 'B', placement: 1 },
    { kind: 'duo', proName: 'C', placement: 2 },
  ];
  assert.equal(entrantsFromRows(duo), 2);
  assert.equal(entrantsFromRows([]), null);
  assert.equal(entrantsFromRows(null), null);
});

test('Verknuepfung ueber den Liquipedia-Link, nie bei mehreren Konten', () => {
  const idx = buildPageIndex([
    { pro_name: 'JosueDeleted', source_page: 'JosueDeleted', puuid: 'p-josue' },
    { pro_name: 'Loescher', source_page: 'https://liquipedia.net/tft/Loescher', puuid: 'p-loe' },
    { pro_name: 'Zwilling', source_page: 'Zwilling', puuid: 'p-z1' },
    { pro_name: 'Zwilling2', source_page: 'zwilling', puuid: 'p-z2' },
    { pro_name: 'OhneKonto', source_page: 'OhneKonto', puuid: null },
  ]);
  // link= gewinnt gegen den angezeigten Namen
  assert.equal(linkPuuid({ proName: 'Deleted', link: 'JosueDeleted' }, idx), 'p-josue');
  // ohne link= die gleichnamige Liquipedia-Seite (URL-Form der Pro-Seite normalisiert)
  assert.equal(linkPuuid({ proName: 'Loescher', link: null }, idx), 'p-loe');
  // gleicher Anzeigename, aber anderer Link → kein Treffer
  assert.equal(linkPuuid({ proName: 'Loescher', link: 'Loescher_(Spanien)' }, idx), null);
  // Seite mit zwei Konten → nicht raten
  assert.equal(linkPuuid({ proName: 'Zwilling' }, idx), null);
  assert.equal(linkPuuid({ proName: 'OhneKonto' }, idx), null);
  assert.equal(linkPuuid({ proName: '' }, idx), null);
  assert.equal(idx.size, 3);
});

test('Loeschen: nur Verschwundenes, nur bei heiler Seite, Einbruch-Bremse', () => {
  const rows = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ placement: from + i, pro_name: `P${from + i}` }));
  // nichts verschwunden
  assert.deepEqual(planDeletes(rows(3), rows(3), { intact: true, infobox: true }), { remove: [], review: [], reason: null });
  // ein Name korrigiert → alter Schluessel wird entfernt
  const corrected = [...rows(2), { placement: 3, pro_name: 'P3neu' }];
  const p1 = planDeletes(rows(3), corrected, { intact: true, infobox: true });
  assert.deepEqual(p1.remove, [{ placement: 3, pro_name: 'P3' }]);
  assert.equal(p1.review.length, 0);
  // Prize Pool nicht heil → nur pruefen
  const p2 = planDeletes(rows(3), rows(2), { intact: false, infobox: true });
  assert.equal(p2.remove.length, 0);
  assert.equal(p2.review.length, 1);
  assert.match(p2.reason, /nicht heil/);
  // 0 Zeilen gelesen, aber keine Infobox → nichts loeschen
  const p3 = planDeletes(rows(4), [], { intact: true, infobox: false });
  assert.equal(p3.remove.length, 0);
  assert.equal(p3.review.length, 4);
  // Einbruch: 10 → 4 (6 weg) wird nicht geloescht, 10 → 5 schon
  assert.equal(planDeletes(rows(10), rows(4), { intact: true, infobox: true }).remove.length, 0);
  assert.match(planDeletes(rows(10), rows(4), { intact: true, infobox: true }).reason, /Einbruch/);
  assert.equal(planDeletes(rows(10), rows(5), { intact: true, infobox: true }).remove.length, 5);
  // unter 10 Zeilen greift die Bremse nicht
  assert.equal(planDeletes(rows(9), rows(1), { intact: true, infobox: true }).remove.length, 8);
});

test('Reparatur-Ziele (D13): vergangen, mit Seite, ohne Ergebnisse', () => {
  const tours = [
    { id: 'a', liquipedia_page: 'A', status: 'past', end_date: '2024-01-01' },
    { id: 'b', liquipedia_page: 'B', status: 'past', end_date: '2024-01-01' },          // hat Ergebnisse
    { id: 'c', liquipedia_page: null, status: 'past', end_date: '2024-01-01' },         // ohne Seite
    { id: 'd', liquipedia_page: 'D', status: 'upcoming', end_date: '2026-10-01' },      // Status veraltet, Ende vorbei
    { id: 'e', liquipedia_page: 'E', status: 'upcoming', end_date: '2026-12-01' },      // noch nicht vorbei
    { id: 'f', liquipedia_page: 'F', status: 'ongoing', end_date: null },
  ];
  const ids = repairTargets(tours, new Set(['b']), '2026-10-06').map(t => t.id);
  assert.deepEqual(ids, ['a', 'd']);
});

test('Dubletten auf exaktem Schluessel (placement, pro_name)', () => {
  const r = dedupeResults([
    { placement: 1, pro_name: 'A', prize_usd: 10 },
    { placement: 1, pro_name: 'A', prize_usd: 99 },
    { placement: 1, pro_name: 'a' },          // anderer Schluessel (Gross/Klein)
    { placement: 2, pro_name: 'A' },
  ]);
  assert.equal(r.length, 3);
  assert.equal(r[0].prize_usd, 10);
});

test('Team-Preis wird geteilt (Probe 6), Startliste und Set-Namen stimmen', () => {
  assert.equal(TEAM_PRIZE_MODE, 'split');
  assert.equal(SEED_TOURNAMENTS.length, 16);
  // Gleichlauf mit scripts/detect-tft-set.mjs SET_NAMES (dort nicht exportiert).
  const src = readFileSync(new URL('./detect-tft-set.mjs', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('const SET_NAMES = {'), src.indexOf('};', src.indexOf('const SET_NAMES = {')));
  const pairs = [...block.matchAll(/^\s*(\d+):\s*'((?:[^'\\]|\\.)*)'/gm)].map(m => [Number(m[1]), m[2].replace(/\\'/g, "'")]);
  assert.ok(pairs.length >= 9);
  for (const [n, name] of pairs) assert.equal(TFT_SET_NAMES[n], name, `Set ${n}`);
});
