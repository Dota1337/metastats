#!/usr/bin/env node
// Regressionstest fuer routeUpsertRows aus scripts/crawl-tft-pro-players.mjs.
//
// Anlass: der woechentliche Pro-Crawl starb ab 2026-06-28 fuenf Laeufe in Folge
// an "23505 duplicate key ... tft_pro_players_puuid_key" — die Pro-Daten waren
// ueber fuenf Wochen eingefroren, ohne dass jemand etwas gemerkt hat. Liquipedia
// lieferte einwandfrei (1086 Spielerseiten), es war unser Upsert.
//
// Diese Faelle muessen dauerhaft gruen bleiben.

import { routeUpsertRows } from './crawl-tft-pro-players.mjs';

let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : `\n       erwartet ${JSON.stringify(expected)}, war ${JSON.stringify(actual)}`}`);
  if (!ok) failed++;
}

console.log('=== routeUpsertRows ===');

{
  // Der Trikpi-Fall: die puuid ist im DB-Stand bekannt. Frueher entschied die
  // Regel anhand der Seite — jetzt gewinnt immer die puuid, weil sie die
  // Identitaet ist. Damit kann die Schreib-Reihenfolge nichts mehr zerreissen.
  const existing = new Map([['P1', 'Trikpi']]);
  const r = routeUpsertRows([{ puuid: 'P1', source_page: 'Trikpi' }], existing);
  check('bekannte puuid, gleiche Seite -> puuid-Key', [r.puuidKeyRows.length, r.pageKeyRows.length], [1, 0]);
}
{
  const existing = new Map([['P1', 'Trikpi']]);
  const r = routeUpsertRows([{ puuid: 'P1', source_page: 'Trikpi_(player)' }], existing);
  check('bekannte puuid, andere Seite (Rename) -> puuid-Key', [r.puuidKeyRows.length, r.pageKeyRows.length], [1, 0]);
}
{
  // Der zweite Killer: zwei Seiten, dieselbe puuid, beide neu. Frueher gingen
  // beide auf den source_page-Key -> zwei INSERTs auf dieselbe puuid -> 23505.
  const r = routeUpsertRows([
    { puuid: 'NEU', source_page: 'Spieler_A' },
    { puuid: 'NEU', source_page: 'Spieler_A_alt' },
  ], new Map());
  check('Duplikat im Batch -> nur eine Zeile ueberlebt',
    [r.puuidKeyRows.length + r.pageKeyRows.length, r.dropped.length], [1, 1]);
  check('verworfene Zeile ist protokolliert', r.dropped[0].source_page, 'Spieler_A_alt');
  check('behaltene Zeile ist die erste', r.pageKeyRows[0].source_page, 'Spieler_A');
}
{
  // CN-Zeilen: keine puuid, nur eine Seite. Muessen weiter ueber den
  // source_page-Key laufen, sonst bricht die CN-Ingestion.
  const r = routeUpsertRows([
    { puuid: null, source_page: 'CN_Spieler_1' },
    { puuid: null, source_page: 'CN_Spieler_2' },
  ], new Map());
  check('CN ohne puuid -> source_page-Key', [r.puuidKeyRows.length, r.pageKeyRows.length], [0, 2]);
  check('mehrere puuid-lose Zeilen werden NICHT als Duplikate verworfen', r.dropped.length, 0);
}
{
  // Manueller Streamer-Pfad: keine Seite.
  const r = routeUpsertRows([{ puuid: 'S1', source_page: null }], new Map());
  check('ohne source_page -> puuid-Key', [r.puuidKeyRows.length, r.pageKeyRows.length], [1, 0]);
}
{
  // Neue puuid, neue Seite -> normaler Liquipedia-Pfad.
  const r = routeUpsertRows([{ puuid: 'NEU2', source_page: 'Neue_Seite' }], new Map());
  check('unbekannte puuid + Seite -> source_page-Key', [r.puuidKeyRows.length, r.pageKeyRows.length], [0, 1]);
}
{
  // Gemischt und realistisch.
  const existing = new Map([['ALT', 'Alte_Seite']]);
  const r = routeUpsertRows([
    { puuid: 'ALT', source_page: 'Alte_Seite' },      // bekannt -> puuid
    { puuid: 'NEU', source_page: 'Neu_1' },           // neu     -> page
    { puuid: 'NEU', source_page: 'Neu_1_dup' },       // Duplikat-> weg
    { puuid: null, source_page: 'CN_1' },             // CN      -> page
    { puuid: 'MAN', source_page: null },              // manuell -> puuid
  ], existing);
  check('gemischt: puuid-Key', r.puuidKeyRows.map(x => x.puuid), ['ALT', 'MAN']);
  check('gemischt: page-Key', r.pageKeyRows.map(x => x.source_page), ['Neu_1', 'CN_1']);
  check('gemischt: verworfen', r.dropped.length, 1);
}
{
  const r = routeUpsertRows([], new Map());
  check('leere Eingabe', [r.puuidKeyRows.length, r.pageKeyRows.length, r.dropped.length], [0, 0, 0]);
}
{
  // Invariante, die den urspruenglichen Fehler unmoeglich macht: nach dem
  // Routing darf KEINE puuid mehr doppelt vorkommen — weder innerhalb einer
  // Gruppe noch ueber beide hinweg.
  const existing = new Map([['A', 'S_A']]);
  const r = routeUpsertRows([
    { puuid: 'A', source_page: 'S_A' },
    { puuid: 'A', source_page: 'S_A2' },
    { puuid: 'B', source_page: 'S_B' },
    { puuid: 'B', source_page: 'S_B2' },
  ], existing);
  const all = [...r.puuidKeyRows, ...r.pageKeyRows].map(x => x.puuid).filter(Boolean);
  check('Invariante: keine puuid doppelt nach dem Routing', all.length, new Set(all).size);
}

// ── Geteilte Dedup-Sicht ueber mehrere Batches ───────────────────────────────
// Regression 2026-08-02: die CN-Zeilen liefen als einziger Batch komplett an
// routeUpsertRows vorbei (upsertGrouped(uniqueCn, 'source_page')). Eine
// CN-Seite, die auf eine schon existierende puuid aufloest, wurde damit als
// INSERT geschrieben und riss den Lauf mit 23505 ab. Sichtbare Folge: von 247
// geparsten CN-Zeilen war KEINE in der DB — die Tabelle hatte 625 liquipedia
// + 2 manual und null cn.
{
  const seen = new Map();
  const known = new Map([['P1', 'IiLucky']]);
  const riot = routeUpsertRows([{ puuid: 'P1', source_page: 'IiLucky' }], known, seen);
  check('Batch 1: bekannte puuid -> puuid-Key', [riot.puuidKeyRows.length, riot.pageKeyRows.length], [1, 0]);

  const cn = routeUpsertRows([{ puuid: 'P1', source_page: 'CN_Lucky' }], known, seen);
  check('Batch 2: dieselbe puuid wird nicht erneut geschrieben',
    [cn.puuidKeyRows.length, cn.pageKeyRows.length], [0, 0]);
  check('Batch 2: die Dublette ist protokolliert', cn.dropped.length, 1);
}
{
  // Neue puuid, in der DB unbekannt, in beiden Batches: genau EINE Zeile darf
  // geschrieben werden, sonst kollidieren zwei INSERTs miteinander.
  const seen = new Map();
  const a = routeUpsertRows([{ puuid: 'NEU', source_page: 'Seite_A' }], new Map(), seen);
  const b = routeUpsertRows([{ puuid: 'NEU', source_page: 'Seite_B' }], new Map(), seen);
  const written = a.puuidKeyRows.length + a.pageKeyRows.length
    + b.puuidKeyRows.length + b.pageKeyRows.length;
  check('neue puuid in zwei Batches -> genau eine Zeile', written, 1);
}
{
  // Schema B2: puuid-lose CN-Zeilen muessen weiterhin alle durchgehen.
  const seen = new Map();
  const r = routeUpsertRows(
    [{ puuid: null, source_page: 'CN_A' }, { puuid: null, source_page: 'CN_B' }],
    new Map(), seen,
  );
  check('puuid-lose CN-Zeilen gehen alle auf den source_page-Key',
    [r.pageKeyRows.length, r.dropped.length], [2, 0]);
}
{
  // Ein geteilter Zustand darf den Default-Fall nicht veraendern: ohne
  // uebergebene Map muss jeder Aufruf fuer sich stehen.
  const known = new Map();
  const x = routeUpsertRows([{ puuid: 'Q', source_page: 'S1' }], known);
  const y = routeUpsertRows([{ puuid: 'Q', source_page: 'S1' }], known);
  check('ohne geteilte Map bleiben Aufrufe unabhaengig',
    [x.pageKeyRows.length, y.pageKeyRows.length], [1, 1]);
}

console.log('');
if (failed > 0) { console.error(`=== ${failed} FEHLER ===`); process.exit(1); }
console.log('=== alle Tests gruen ===');
