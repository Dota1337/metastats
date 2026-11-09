// Riot-Probe der Spielersuche (riot-name-probe.ts). Prueft ohne Netz:
// nur account-v1-Adressen, LoL ohne puuid, Zwischenspeicher je Spiel,
// Bremse je 10 s (gesamt und Dropdown), unvollstaendige Antworten, Abschalter.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRiotNameProbe, ACCOUNT_BASE, DEFAULT_TAGS } from './riot-name-probe.ts';

// Wie Riot: Name ohne Gross/Klein und Leerzeichen, Tag ohne Gross/Klein.
const norm = (k) => { const [n, t] = k.split('#'); return n.replace(/\s/g, '').toLowerCase() + '#' + t.toLowerCase(); };

function fakeRiot({ accounts = {}, regions = {}, status = {} } = {}) {
  const calls = [];
  const acc = Object.fromEntries(Object.entries(accounts).map(([k, v]) => [norm(k), v]));
  const st = Object.fromEntries(Object.entries(status).map(([k, v]) => [norm(k), v]));
  const reply = (code, body) => ({ status: code, ok: code === 200, headers: new Headers(), json: async () => body });
  const fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    let m = u.match(/\/accounts\/by-riot-id\/([^/]+)\/([^/]+)$/);
    if (m) {
      const key = norm(`${decodeURIComponent(m[1])}#${decodeURIComponent(m[2])}`);
      if (st[key]) return reply(st[key], null);
      return acc[key] ? reply(200, acc[key]) : reply(404, null);
    }
    m = u.match(/\/region\/by-game\/(lol|tft)\/by-puuid\/([^/]+)$/);
    if (m) {
      const r = regions[`${m[1]}:${decodeURIComponent(m[2])}`];
      return r === undefined ? reply(404, null) : reply(200, { puuid: m[2], game: m[1], region: r });
    }
    return reply(500, null);
  };
  return { fetch, calls };
}

let clock = 1_000_000;
const now = () => clock;

beforeEach(() => {
  clock = 1_000_000;
  process.env.RIOT_API_KEY_TFT = 'test-key';
  delete process.env.LOL_SEARCH_RIOT_PROBE;
  delete process.env.TFT_SEARCH_RIOT_PROBE;
});

const BANGA = { 'SQ Heimer Banga#EUW': { puuid: 'P1', gameName: 'SQ Heimer Banga', tagLine: 'EUW' } };

test('LoL: nur account-v1-Adressen, Server ueber by-game/lol, keine puuid', async () => {
  const riot = fakeRiot({ accounts: BANGA, regions: { 'lol:P1': 'EUW1', 'tft:P1': 'NA1' } });
  const p = createRiotNameProbe({ fetch: riot.fetch, now });
  const r = await p.probe('SQ Heimer Banga', 'lol');
  assert.equal(r.complete, true);
  assert.deepEqual(r.hits, [{ gameName: 'SQ Heimer Banga', tagLine: 'EUW', region: 'euw1', tier: null, division: null, lp: null }]);
  assert.equal(riot.calls.length, DEFAULT_TAGS.length + 1);
  for (const u of riot.calls) assert.ok(u.startsWith(`${ACCOUNT_BASE}/`), u);
  assert.ok(ACCOUNT_BASE.endsWith('/riot/account/v1'));
  assert.ok(riot.calls.some(u => u.includes('/region/by-game/lol/')));
  assert.ok(!riot.calls.some(u => u.includes('/by-game/tft/')));
});

test('TFT: puuid bleibt, Server ueber by-game/tft', async () => {
  const riot = fakeRiot({ accounts: BANGA, regions: { 'tft:P1': 'NA1' } });
  const p = createRiotNameProbe({ fetch: riot.fetch, now });
  const r = await p.probe('SQ Heimer Banga', 'tft');
  assert.deepEqual(r.hits, [{ gameName: 'SQ Heimer Banga', tagLine: 'EUW', region: 'na1', tier: null, division: null, lp: null, puuid: 'P1' }]);
});

test('kein Server fuer das Spiel: LoL laesst den Treffer weg, TFT behaelt ihn ohne Server', async () => {
  const riot = fakeRiot({ accounts: BANGA, regions: {} });
  const p = createRiotNameProbe({ fetch: riot.fetch, now });
  assert.deepEqual((await p.probe('SQ Heimer Banga', 'lol')).hits, []);
  const tft = await p.probe('SQ Heimer Banga', 'tft');
  assert.equal(tft.hits.length, 1);
  assert.equal(tft.hits[0].region, null);
  assert.equal(tft.hits[0].puuid, 'P1');
});

test('Zwischenspeicher je Spiel', async () => {
  const riot = fakeRiot({ accounts: BANGA, regions: { 'lol:P1': 'euw1', 'tft:P1': 'euw1' } });
  const p = createRiotNameProbe({ fetch: riot.fetch, now });
  await p.probe('SQ Heimer Banga', 'tft');
  const afterTft = riot.calls.length;
  assert.equal(p.cached('SQ Heimer Banga', 'lol'), null);
  await p.probe('sq  heimer banga', 'lol');
  assert.ok(riot.calls.length > afterTft, 'LoL fragt trotz TFT-Eintrag selbst');
  const n = riot.calls.length;
  const again = await p.probe('SQ Heimer Banga', 'lol');
  assert.equal(riot.calls.length, n);
  assert.equal(again.complete, true);
  assert.equal(p.cached('SQ Heimer Banga', 'lol')[0].puuid, undefined);
  clock += 10 * 60_000;
  assert.equal(p.cached('SQ Heimer Banga', 'lol'), null);
});

test('Bremse: hoechstens 5 Proben je 10 s, danach wieder frei', async () => {
  const riot = fakeRiot();
  const p = createRiotNameProbe({ fetch: riot.fetch, now });
  for (let i = 0; i < 5; i++) assert.equal((await p.probe(`Name${i}`, 'lol')).complete, true);
  const n = riot.calls.length;
  const blocked = await p.probe('Name5', 'tft');
  assert.deepEqual(blocked, { hits: [], complete: false });
  assert.equal(riot.calls.length, n, 'gebremst = keine Riot-Abfrage');
  clock += 10_000;
  assert.equal((await p.probe('Name5', 'tft')).complete, true);
});

test('Bremse: Dropdown hoechstens 2 je 10 s, Enter bleibt frei', async () => {
  const riot = fakeRiot();
  const p = createRiotNameProbe({ fetch: riot.fetch, now });
  assert.equal((await p.probe('Aaa', 'lol', 'suggest')).complete, true);
  assert.equal((await p.probe('Bbb', 'lol', 'suggest')).complete, true);
  assert.equal((await p.probe('Ccc', 'lol', 'suggest')).complete, false);
  assert.equal((await p.probe('Ccc', 'lol', 'enter')).complete, true);
});

test('Riot antwortet nicht ueberall: unvollstaendig, nicht gespeichert', async () => {
  const riot = fakeRiot({ accounts: BANGA, regions: { 'lol:P1': 'euw1' }, status: { 'SQ Heimer Banga#KR1': 503 } });
  const p = createRiotNameProbe({ fetch: riot.fetch, now });
  const r = await p.probe('SQ Heimer Banga', 'lol');
  assert.equal(r.complete, false);
  assert.equal(r.hits.length, 1);
  assert.equal(p.cached('SQ Heimer Banga', 'lol'), null);
});

test('Namen ausserhalb 3–16 Zeichen: sofort leer und vollstaendig, ohne Riot', async () => {
  const riot = fakeRiot();
  const p = createRiotNameProbe({ fetch: riot.fetch, now });
  assert.deepEqual(await p.probe('ab', 'lol'), { hits: [], complete: true });
  assert.deepEqual(await p.probe('a'.repeat(17), 'lol'), { hits: [], complete: true });
  assert.equal(riot.calls.length, 0);
});

test('Abschalter: LoL und TFT getrennt, ohne Schluessel nichts', async () => {
  const riot = fakeRiot({ accounts: BANGA, regions: { 'lol:P1': 'euw1', 'tft:P1': 'euw1' } });
  const p = createRiotNameProbe({ fetch: riot.fetch, now });
  process.env.LOL_SEARCH_RIOT_PROBE = 'off';
  assert.deepEqual(await p.probe('SQ Heimer Banga', 'lol'), { hits: [], complete: false });
  assert.equal((await p.probe('SQ Heimer Banga', 'tft')).complete, true);
  delete process.env.LOL_SEARCH_RIOT_PROBE;
  process.env.TFT_SEARCH_RIOT_PROBE = 'off';
  assert.deepEqual(await p.probe('Other Name', 'tft'), { hits: [], complete: false });
  assert.equal((await p.probe('Other Name', 'lol')).complete, true);
  delete process.env.RIOT_API_KEY_TFT;
  assert.deepEqual(await p.probe('Third Name', 'lol'), { hits: [], complete: false });
});
