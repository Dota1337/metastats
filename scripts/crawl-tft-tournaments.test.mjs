// Tests fuer die reinen Regeln des Turnier-Crawlers (Plan Aufgabe B).
// Der Import darf den Lauf nicht starten (Import-Schutz in main).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  entrantsFromRows, buildPageIndex, linkPuuid, planDeletes, repairTargets, dedupeResults,
  TEAM_PRIZE_MODE, TFT_SET_NAMES, SEED_TOURNAMENTS,
} from './crawl-tft-tournaments.mjs';

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
