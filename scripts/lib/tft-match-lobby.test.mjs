import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLobbyRow, dedupeLobbies, insertLobbies, saveLobbies, lobbyCaptureEnabled,
  LOBBY_MAX_FAILURES, _resetLobbyState,
} from './tft-match-lobby.mjs';
import { refreshPlayerMatchCache } from './tft-match-cache-pg.mjs';
import { loadCurrentSet } from './current-set.mjs';

const SET = loadCurrentSet();

function participant(i, extra = {}) {
  return {
    puuid: `P${i}`, placement: i, level: 8, last_round: 30 + i, gold_left: i,
    units: [{ character_id: `TFT${SET}_Unit${i}`, tier: 2, itemNames: ['A', 'B'] }],
    traits: [{ name: 'T1', tier_current: 1, num_units: 2, style: 1 }, { name: 'T0', tier_current: 0, num_units: 1, style: 0 }],
    ...extra,
  };
}
function rawMatch(id = 'EUW1_1', { n = 8, set = SET } = {}) {
  return {
    metadata: { match_id: id },
    info: {
      queue_id: 1100, tft_set_number: set, game_datetime: 1_760_000_000_000, game_version: 'v',
      participants: Array.from({ length: n }, (_, k) => participant(8 - k)),
    },
  };
}

beforeEach(() => {
  _resetLobbyState();
  delete process.env.LOBBY_CAPTURE;
});

test('Lobby: 8 Teilnehmer nach Platz, nur aktive Traits, kompakte Schluessel', () => {
  const row = buildLobbyRow(rawMatch(), 'euw1', SET);
  assert.equal(row.match_id, 'EUW1_1');
  assert.equal(row.participants.length, 8);
  assert.deepEqual(row.participants.map((p) => p.pl), [1, 2, 3, 4, 5, 6, 7, 8]);
  const first = row.participants[0];
  assert.deepEqual(first.u, [[`TFT${SET}_Unit1`, 2, ['A', 'B']]]);
  assert.deepEqual(first.t, [['T1', 1, 2, 1]]);
  assert.equal(first.g, 1);
});

test('Lobby: fremdes Set, unvollstaendige Lobby oder kaputter Platz → keine Zeile', () => {
  assert.equal(buildLobbyRow(rawMatch('X', { set: SET - 1 }), 'euw1', SET), null);
  assert.equal(buildLobbyRow(rawMatch('X', { n: 7 }), 'euw1', SET), null);
  const bad = rawMatch('X');
  bad.info.participants[0].placement = 0;
  assert.equal(buildLobbyRow(bad, 'euw1', SET), null);
});

test('Entdoppeln nach match_id und sortieren', () => {
  const a = { match_id: 'B' }, b = { match_id: 'A' }, c = { match_id: 'B', x: 1 };
  assert.deepEqual(dedupeLobbies([a, b, c, null]).map((r) => r.match_id), ['A', 'B']);
});

function fakeClient({ failOn } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (failOn && sql.includes(failOn)) throw new Error('boom');
      return { rows: [] };
    },
  };
}

test('Insert in einer Transaktion mit eigenem Zeitlimit', async () => {
  const c = fakeClient();
  const n = await insertLobbies(c, [buildLobbyRow(rawMatch('A'), 'euw1', SET), buildLobbyRow(rawMatch('A'), 'euw1', SET)]);
  assert.equal(n, 1);
  assert.deepEqual(c.queries, ['begin', 'set local statement_timeout', 'insert into tft_match_lobby', 'commit']);
});

test('Fehler im Insert → Rollback, saveLobbies wirft nicht, schaltet nach Serie ab', async () => {
  process.env.LOBBY_CAPTURE = '1';
  const row = buildLobbyRow(rawMatch('A'), 'euw1', SET);
  for (let i = 0; i < LOBBY_MAX_FAILURES; i++) {
    const c = fakeClient({ failOn: 'insert into tft_match_lobby' });
    assert.equal(await saveLobbies(c, [row]), 0);
    assert.ok(c.queries.includes('rollback'));
  }
  assert.equal(lobbyCaptureEnabled(), false);
  // abgeschaltet: kein weiterer Datenbank-Zugriff
  const c = fakeClient();
  assert.equal(await saveLobbies(c, [row]), 0);
  assert.equal(c.queries.length, 0);
});

test('Schalter: nur LOBBY_CAPTURE=1 schaltet ein', () => {
  assert.equal(lobbyCaptureEnabled(), false);
  process.env.LOBBY_CAPTURE = '0';
  assert.equal(lobbyCaptureEnabled(), false);
  process.env.LOBBY_CAPTURE = '1';
  assert.equal(lobbyCaptureEnabled(), true);
});

// Ende zu Ende ueber refreshPlayerMatchCache mit falscher DB und falschem Riot.
function fakeDb({ lobbyFails = false } = {}) {
  const log = [];
  return {
    log,
    async query(sql) {
      const head = sql.trim().split(/\s+/).slice(0, 3).join(' ');
      log.push(head);
      if (lobbyFails && head === 'insert into tft_match_lobby') throw new Error('lobby kaputt');
      if (/count\(\*\)/.test(sql)) return { rows: [{ n: 1 }] };
      return { rows: [] };
    },
  };
}
const riot = {
  async fetchJson(url) {
    if (url.includes('/ids?')) return url.includes('start=0&') ? ['EUW1_1'] : [];
    return rawMatch('EUW1_1');
  },
};

test('Cache-Write: Lobby vor den Match-Zeilen, nur mit Schalter', async () => {
  process.env.LOBBY_CAPTURE = '1';
  const db = fakeDb();
  const r = await refreshPlayerMatchCache(db, 'P1', 'euw1', 'europe', riot, { force: true, syncSupabase: false });
  assert.equal(r.newMatches, 1);
  const iLobby = db.log.indexOf('insert into tft_match_lobby');
  const iCache = db.log.indexOf('insert into tft_player_match_cache');
  assert.ok(iLobby >= 0 && iCache > iLobby, db.log.join(' | '));

  delete process.env.LOBBY_CAPTURE;
  const off = fakeDb();
  await refreshPlayerMatchCache(off, 'P1', 'euw1', 'europe', riot, { force: true, syncSupabase: false });
  assert.equal(off.log.indexOf('insert into tft_match_lobby'), -1);
  assert.ok(off.log.includes('insert into tft_player_match_cache'));
});

test('Cache-Write: kaputte Lobby-Tabelle kippt den Match-Cache nicht', async () => {
  process.env.LOBBY_CAPTURE = '1';
  const db = fakeDb({ lobbyFails: true });
  const r = await refreshPlayerMatchCache(db, 'P1', 'euw1', 'europe', riot, { force: true, syncSupabase: false });
  assert.equal(r.newMatches, 1);
  assert.ok(db.log.includes('rollback'));
  assert.ok(db.log.includes('insert into tft_player_match_cache'));
});
