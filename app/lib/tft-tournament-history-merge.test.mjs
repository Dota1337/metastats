// Tests fuer das Zusammenfuehren der Turnierhistorie (D8-B, D9-B, D10, D11-B).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTournamentHistory, normalizeLiquipediaPage } from './tft-tournament-history-merge.ts';

const READ_AT = '2026-10-05T08:00:00.000Z';
const L = 'https://liquipedia.net/tft/';

function listEntry(over) {
  return {
    tournament: 'X', date: '2026-01-01', place: '5th', placement: 5, placement_max: null, win: false,
    prize_usd: null, tier: 'B-Tier', title: 'X', page: `${L}X`, src: 'results', read_at: READ_AT, ...over,
  };
}
function tour(page, end, tier = 'S', name = page) {
  return { name, tier, start_date: end, end_date: end, liquipedia_page: page };
}

test('Liste ist Hauptquelle: Tabellenzeile desselben Turniers kommt nicht doppelt', () => {
  const tours = new Map([['t1', tour('Space_Gods/EMEA/Major', '2026-06-21')]]);
  const h = mergeTournamentHistory({
    json: [listEntry({ tournament: 'Major', title: 'Space_Gods/EMEA/Major', page: `${L}Space_Gods/EMEA/Major`, placement: 1, place: '1st', win: true, tier: 'A-Tier' })],
    totalEarningsUsd: 27730,
    rows: [{ tournament_id: 't1', placement: 1, placement_max: null, pro_name: 'Loescher', prize_usd: null, prize_native: 5000, prize_currency: 'EUR' }],
    tours,
  });
  assert.equal(h.entries.length, 1);
  assert.equal(h.entries[0].tier, 'A-Tier');          // Liste, nicht unser "S"
  assert.equal(h.entries[0].internal, true);          // Link auf unsere Seite
  assert.equal(h.entries[0].prizeNative, 5000);       // Preis-Ersatz aus der Tabelle
  assert.equal(h.wins, 1);
  assert.equal(h.earningsUsd, 27730);
});

test('Neuere Tabellenzeile ergaenzt, alte nicht; Preisgeld = Gesamtsumme + Neues', () => {
  const tours = new Map([
    ['new', tour('Neu/Cup', '2026-09-30', 'B')],
    ['old', tour('Alt/Cup', '2026-08-01', 'A')],
    ['grace', tour('Grenz/Cup', '2026-09-21', 'C')],
  ]);
  const h = mergeTournamentHistory({
    json: [listEntry({ prize_usd: 100 })],
    totalEarningsUsd: 1000,
    rows: [
      { tournament_id: 'new', placement: 1, placement_max: null, pro_name: 'A', prize_usd: 500, prize_native: null, prize_currency: null },
      { tournament_id: 'old', placement: 1, placement_max: null, pro_name: 'A', prize_usd: 900, prize_native: null, prize_currency: null },
      { tournament_id: 'grace', placement: 1, placement_max: 4, pro_name: 'A', prize_usd: 50, prize_native: null, prize_currency: null },
    ],
    tours,
  });
  const names = h.entries.map(e => e.tournament).sort();
  assert.deepEqual(names, ['Grenz/Cup', 'Neu/Cup', 'X']);
  assert.equal(h.entries.find(e => e.tournament === 'Neu/Cup').tier, 'B-Tier');
  assert.equal(h.entries.find(e => e.tournament === 'Grenz/Cup').place, '1–4');
  assert.equal(h.wins, 1);                 // geteilter 1.-4. zaehlt nicht
  assert.equal(h.earningsUsd, 1000 + 500 + 50);
});

test('Sieg in der Liste nur bei genau "1st"', () => {
  const h = mergeTournamentHistory({
    json: [
      listEntry({ place: '1st', placement: 1, win: true }),
      listEntry({ place: '1st - 2nd', placement: 1, placement_max: 2, win: false }),
      listEntry({ place: '2nd', placement: 2, win: false }),
    ],
    totalEarningsUsd: null, rows: [], tours: new Map(),
  });
  assert.equal(h.wins, 1);
  assert.equal(h.entries.find(e => e.placeMax === 2).place, '1–2');
});

test('Ohne Gesamtsumme: Listensumme; ganz ohne Preisgeld: null statt 0', () => {
  const a = mergeTournamentHistory({ json: [listEntry({ prize_usd: 700 }), listEntry({ prize_usd: 300 })], totalEarningsUsd: null, rows: [], tours: new Map() });
  assert.equal(a.earningsUsd, 1000);
  const b = mergeTournamentHistory({ json: [listEntry({})], totalEarningsUsd: 0, rows: [], tours: new Map() });
  assert.equal(b.earningsUsd, null);
});

test('Alte Liste ohne src: Tabellenzeile schlaegt Listeneintrag, Gesamtsumme = max', () => {
  const tours = new Map([['t1', tour('A/B', '2025-01-01', 'S')]]);
  const h = mergeTournamentHistory({
    json: [
      { tournament: 'A B', date: '2025-01-01', place: '1st', prize_usd: 100, tier: 'S-Tier', page: `${L}A/B` },
      { tournament: 'C', date: '2024-01-01', place: '1st-2nd', prize_usd: 50, tier: null, page: `${L}C` },
    ],
    totalEarningsUsd: 120,
    rows: [{ tournament_id: 't1', placement: 1, placement_max: null, pro_name: 'P', prize_usd: 100, prize_native: null, prize_currency: null }],
    tours,
  });
  assert.equal(h.entries.length, 2);
  assert.equal(h.entries[0].internal, true);
  assert.equal(h.wins, 1);                 // "1st-2nd" ist geteilt
  assert.equal(h.earningsUsd, 150);
});

test('Nicht-Pro ohne Liste: geteilter 1. Platz aus der Tabelle ist kein Sieg', () => {
  const tours = new Map([['q', tour('Q/1', '2026-05-01', 'B')]]);
  const h = mergeTournamentHistory({
    json: null, totalEarningsUsd: null,
    rows: [{ tournament_id: 'q', placement: 1, placement_max: 4, pro_name: 'P', prize_usd: null, prize_native: null, prize_currency: null }],
    tours,
  });
  assert.equal(h.wins, 0);
  assert.equal(h.entries[0].place, '1–4');
  assert.equal(h.earningsUsd, null);
});

const EW = 'Enchanted_Wilds/TFT_Pro_Circuit/EMEA/Elderwood_Cup';
function award(tid, prize, over = {}) {
  return { tournament_id: tid, award: '1 Win Bounty', pro_name: 'Loescher', place_name: 'Loescher', prize_usd: prize, ...over };
}

test('Bonus haengt am Listeneintrag; Liquipedia-Summe bleibt unveraendert', () => {
  const tours = new Map([['ew', tour(EW, '2026-09-19', 'B', 'Elderwood Cup')]]);
  const h = mergeTournamentHistory({
    json: [listEntry({ title: EW, page: `${L}${EW}`, placement: 15, place: '15th', prize_usd: 700 })],
    totalEarningsUsd: 27730,
    rows: [{ tournament_id: 'ew', placement: 15, placement_max: null, pro_name: 'Loescher', prize_usd: 700, prize_native: null, prize_currency: null }],
    tours,
    awards: [award('ew', 100)],
  });
  assert.equal(h.entries.length, 1);
  assert.equal(h.entries[0].prizeUsd, 700);
  assert.equal(h.entries[0].bonusUsd, 100);
  assert.equal(h.earningsUsd, 27730);
});

test('Bonus ohne Gesamtsumme zaehlt zur Listensumme; zwei Boni je Turnier addiert', () => {
  const tours = new Map([['ew', tour(EW, '2026-09-19')]]);
  const h = mergeTournamentHistory({
    json: [listEntry({ title: EW, page: `${L}${EW}`, prize_usd: 700 })],
    totalEarningsUsd: null, rows: [], tours,
    awards: [award('ew', 100), award('ew', 50, { award: 'MVP' }), award('ew', null, { award: 'Leer' })],
  });
  assert.equal(h.entries[0].bonusUsd, 150);
  assert.equal(h.earningsUsd, 850);
});

test('Bonus an ergaenzter Tabellenzeile zaehlt mit', () => {
  const tours = new Map([['new', tour('Neu/Cup', '2026-09-30', 'B')]]);
  const h = mergeTournamentHistory({
    json: [listEntry({ prize_usd: 100 })],
    totalEarningsUsd: 1000,
    rows: [{ tournament_id: 'new', placement: 3, placement_max: null, pro_name: 'A', prize_usd: 500, prize_native: null, prize_currency: null }],
    tours,
    awards: [award('new', 100)],
  });
  assert.equal(h.entries.find(e => e.tournament === 'Neu/Cup').bonusUsd, 100);
  assert.equal(h.earningsUsd, 1000 + 500 + 100);
});

test('Bonus ohne Platz: eigene Zeile ohne Platz; neu zaehlt dazu, alt steckt in der Summe', () => {
  const tours = new Map([
    ['neu', tour('Neu/Cup', '2026-09-30', 'B')],
    ['alt', tour('Alt/Cup', '2026-03-01', 'B')],
    ['weg', tour('Weg/Cup', '2026-09-30', 'B')],
  ]);
  const h = mergeTournamentHistory({
    json: [listEntry({ prize_usd: 100 })],
    totalEarningsUsd: 1000, rows: [], tours,
    awards: [award('neu', 100), award('alt', 50), award('fremd', 75)],
  });
  const neu = h.entries.find(e => e.tournament === 'Neu/Cup');
  assert.equal(neu.place, null);
  assert.equal(neu.prizeUsd, null);
  assert.equal(neu.bonusUsd, 100);
  assert.equal(neu.win, false);
  assert.equal(neu.href, '/tft/tournaments/neu');
  assert.equal(h.entries.find(e => e.tournament === 'Alt/Cup').bonusUsd, 50);
  assert.equal(h.entries.length, 3);            // 'fremd' hat kein Turnier, 'weg' keinen Bonus
  assert.equal(h.earningsUsd, 1000 + 100);
});

test('Alte Liste: Bonus an Tabellenzeile und Listeneintrag, Summe mit Bonus', () => {
  const tours = new Map([
    ['t1', tour('A/B', '2025-01-01', 'S')],
    ['t2', tour('C', '2024-01-01', 'A')],
  ]);
  const h = mergeTournamentHistory({
    json: [
      { tournament: 'A B', date: '2025-01-01', place: '1st', prize_usd: 100, tier: 'S-Tier', page: `${L}A/B` },
      { tournament: 'C', date: '2024-01-01', place: '3rd', prize_usd: 50, tier: null, page: `${L}C` },
    ],
    totalEarningsUsd: 120,
    rows: [{ tournament_id: 't1', placement: 1, placement_max: null, pro_name: 'P', prize_usd: 100, prize_native: null, prize_currency: null }],
    tours,
    awards: [award('t1', 30), award('t2', 20)],
  });
  assert.equal(h.entries.length, 2);
  assert.equal(h.entries.find(e => e.tournament === 'A/B').bonusUsd, 30);
  assert.equal(h.entries.find(e => e.tournament === 'C').bonusUsd, 20);
  assert.equal(h.earningsUsd, 100 + 30 + 50 + 20);
});

test('Ohne Boni bleibt bonusUsd null', () => {
  const h = mergeTournamentHistory({ json: [listEntry({ prize_usd: 10 })], totalEarningsUsd: null, rows: [], tours: new Map() });
  assert.equal(h.entries[0].bonusUsd, null);
  assert.equal(h.earningsUsd, 10);
});

test('Seitennamen: URL, Leerzeichen, kaputte Kodierung', () => {
  assert.equal(normalizeLiquipediaPage(`${L}Magic_n%27_Mayhem/EMEA`), "magic_n'_mayhem/emea");
  assert.equal(normalizeLiquipediaPage("Magic n' Mayhem/EMEA"), "magic_n'_mayhem/emea");
  assert.equal(normalizeLiquipediaPage(`${L}Bad%E0%A4%A`), 'bad%e0%a4%a');
});
