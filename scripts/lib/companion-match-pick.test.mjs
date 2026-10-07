import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickMatch, riotStartMs, shouldRetryUnresolvable, TS_WINDOW_MS, MATCH_ALGO_VERSION } from './companion-match-pick.mjs';

const T = iso => Date.parse(iso);
// Match-Detail wie von Riot: game_datetime = Ende, game_length in Sekunden.
const md = (id, startIso, endIso) => ({
  metadata: { match_id: id },
  info: { game_datetime: T(endIso), game_length: (T(endIso) - T(startIso)) / 1000 },
});

// Echte Zeiten des am 2026-10-05 aufgegebenen Spiels LIVE_1791123480000 (EUW).
const A = md('EUW1_8003564628', '2026-10-04T13:52:16.318Z', '2026-10-04T14:28:12.560Z');
const B = md('EUW1_8003611995', '2026-10-04T14:37:03.692Z', '2026-10-04T15:17:20.910Z');
const C = md('EUW1_8003663904', '2026-10-04T15:16:42.552Z', '2026-10-04T15:51:30.158Z');

test('Start = Ende minus Spieldauer', () => {
  assert.equal(riotStartMs(A.info), T('2026-10-04T13:52:16.318Z'));
  assert.equal(riotStartMs({}), null);
});

test('mitten im Spiel eingestiegen: 26 Min nach Start, vor Ende → Treffer', () => {
  const seed = 1791123480000; // 2026-10-04T14:18:00Z
  const r = pickMatch(seed, [C, B, A]);
  assert.equal(r?.md.metadata.match_id, 'EUW1_8003564628');
  assert.ok(r.delta > TS_WINDOW_MS); // die alte Regel (±15 Min) haette hier aufgegeben
});

test('zweites echtes Fall-Spiel LIVE_1791106080000: nur das laufende Spiel passt', () => {
  const seed = 1791106080000; // 2026-10-04T09:28:00Z
  const prev = md('EUW1_8003301547', '2026-10-04T08:43:50.096Z', '2026-10-04T09:24:17.019Z');
  const cur = md('EUW1_8003317470', '2026-10-04T09:10:33.357Z', '2026-10-04T09:44:16.667Z');
  assert.equal(pickMatch(seed, [prev, cur])?.md.metadata.match_id, 'EUW1_8003317470');
});

test('zwei Spiele direkt hintereinander: der engste Start gewinnt', () => {
  // Spieler fliegt frueh raus und startet das naechste Spiel, waehrend die
  // Lobby des ersten noch bis 14:28 laeuft. App sieht das zweite um 14:13.
  const second = md('EUW1_2', '2026-10-04T14:13:20Z', '2026-10-04T14:50:00Z');
  const seed = T('2026-10-04T14:13:00Z');
  assert.equal(pickMatch(seed, [A, second])?.md.metadata.match_id, 'EUW1_2');
  // App erst spaet im ersten Spiel, das zweite beginnt deutlich spaeter.
  assert.equal(pickMatch(T('2026-10-04T14:20:00Z'), [A, B])?.md.metadata.match_id, 'EUW1_8003564628');
});

test('Ende ist das eigene Ausscheiden: naechstes Spiel waehrend die alte Lobby noch laeuft', () => {
  // Echte Zahlen EUW1_8006458069: Start 16:24:07.585, Lobby-Ende 16:59:35.890,
  // Beobachter Platz 6 nach 1870 s raus (16:55:17). App sieht das naechste,
  // bei Riot noch nicht gelistete Spiel um 16:57.
  const old = md('EUW1_8006458069', '2026-10-07T16:24:07.585Z', '2026-10-07T16:59:35.890Z');
  old.info.participants = [{ puuid: 'me', time_eliminated: 1870 }, { puuid: 'x', time_eliminated: 2118 }];
  const seed = T('2026-10-07T16:57:00Z');
  assert.equal(pickMatch(seed, [old], 'me'), null);
  // Ohne Beobachter-Zeile gilt das Lobby-Ende — dann haette es gepasst.
  assert.equal(pickMatch(seed, [old], 'unbekannt')?.md.metadata.match_id, 'EUW1_8006458069');
  // Vor dem eigenen Ausscheiden bleibt es ein Treffer.
  assert.equal(pickMatch(T('2026-10-07T16:50:00Z'), [old], 'me')?.md.metadata.match_id, 'EUW1_8006458069');
});

test('kein Treffer: Start nach dem Spielende oder mehr als 15 Min vor dem Spielstart', () => {
  assert.equal(pickMatch(T('2026-10-04T14:29:00Z'), [A]), null);
  assert.equal(pickMatch(T('2026-10-04T14:21:00Z'), [B]), null); // 16 Min vor Start
  assert.equal(pickMatch(T('2026-10-04T14:23:00Z'), [B])?.md.metadata.match_id, 'EUW1_8003611995'); // 14 Min vor Start
  assert.equal(pickMatch(T('2026-10-04T14:00:00Z'), []), null);
  assert.equal(pickMatch(T('2026-10-04T14:00:00Z'), [{ info: { game_length: 100 } }, null]), null);
});

test('Statusdatei: alte no_match genau einmal neu, Doppel bleiben aufgegeben', () => {
  assert.ok(MATCH_ALGO_VERSION >= 2);
  assert.equal(shouldRetryUnresolvable(undefined), true);
  assert.equal(shouldRetryUnresolvable({ reason: 'no_match_in_window(2)', at: 'x' }), true);
  assert.equal(shouldRetryUnresolvable({ reason: 'no_match_in_window(2)', v: MATCH_ALGO_VERSION }), false);
  assert.equal(shouldRetryUnresolvable({ reason: 'duplicate_of:EUW1_7857797655' }), false);
  assert.equal(shouldRetryUnresolvable({ reason: 'observer_not_handle' }), false);
  assert.equal(shouldRetryUnresolvable({ reason: 'no_timestamp' }), false);
});
