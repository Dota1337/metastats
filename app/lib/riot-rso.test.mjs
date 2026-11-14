// Riot-Anmeldung (riot-rso.ts) gegen einen nachgebauten Riot-Server und eine
// nachgebaute Datenbank. Prueft ohne Netz alle Faelle aus dem Plan vom
// 14.11.2026: neues Konto, Wieder-Login, Verknuepfen, Konflikte, kaputte
// Cookies, Riot-Fehler, Teilfehler beim Anlegen, gleichzeitiger Erst-Login,
// fremde Weiterleitungsziele und dass das Geheimnis nie in einer Antwort steht.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rsoStart, rsoCallback, rsoCookieName, sealRsoCookie, openRsoCookie, rsoUserId, rsoPlaceholderEmail,
  pkceChallenge, RSO_TOKEN_URL, RIOT_ACCOUNT_V1, RSO_COOKIE_MAX_AGE_S,
} from './riot-rso.ts';
import { safeNext } from './safe-next.ts';
import { isRiotPlaceholderEmail } from './riot-rso-email.ts';

const SECRET = 'link-secret-0123456789-abcdefghijklmnopqrstuvwxyz';
const CLIENT_SECRET = 'client-secret-SHOULD-NEVER-LEAK';
const ORIGIN = 'https://www.metastats.gg';
const T0 = 1_800_000_000_000;

const ACC = { puuid: 'rso-puuid-faker', gameName: 'Faker', tagLine: 'KR1' };

function reply(status, body, headers = {}) {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), json: async () => body };
}

function fakeRiot(opts = {}) {
  const calls = [];
  const usedCodes = new Set();
  const o = {
    tokenStatus: 200, meStatus: [200], account: ACC, tftByPuuid: 200, tftPuuidByName: 'tft-puuid-faker',
    tftRegion: 200, lolRegion: 'kr', ...opts,
  };
  let meIdx = 0;
  const fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u === RSO_TOKEN_URL) {
      const body = new URLSearchParams(String(init.body));
      if (o.tokenStatus !== 200) return reply(o.tokenStatus, { error: 'server_error' });
      if (usedCodes.has(body.get('code'))) return reply(400, { error: 'invalid_grant' });
      usedCodes.add(body.get('code'));
      return reply(200, { access_token: 'at-123', token_type: 'Bearer', expires_in: 600 });
    }
    if (u === `${RIOT_ACCOUNT_V1}/accounts/me`) {
      const st = o.meStatus[Math.min(meIdx++, o.meStatus.length - 1)];
      return st === 200 ? reply(200, o.account) : reply(st, null, st === 429 ? { 'retry-after': '1' } : {});
    }
    let m = u.match(/\/accounts\/by-puuid\/([^/]+)$/);
    if (m) {
      if (o.tftByPuuid === 200) return reply(200, { puuid: decodeURIComponent(m[1]), gameName: o.account.gameName, tagLine: o.account.tagLine });
      return reply(o.tftByPuuid, null);
    }
    m = u.match(/\/accounts\/by-riot-id\/([^/]+)\/([^/]+)$/);
    if (m) return o.tftPuuidByName ? reply(200, { puuid: o.tftPuuidByName, gameName: o.byIdName ?? o.account.gameName, tagLine: o.account.tagLine }) : reply(404, null);
    m = u.match(/\/region\/by-game\/(tft|lol)\/by-puuid\/([^/]+)$/);
    if (m) {
      if (m[1] === 'tft') return o.tftRegion === 200 ? reply(200, { region: 'kr' }) : reply(o.tftRegion, null);
      return o.lolRegion ? reply(200, { region: o.lolRegion }) : reply(404, null);
    }
    return reply(500, null);
  };
  return { fetch, calls, o };
}

function fakeStore(opts = {}) {
  const users = new Map();   // id → {id, email, rsoCreated, name}
  const links = new Map();   // user_id → row
  const sessions = [];
  const log = [];
  let current = opts.current ?? null;
  const failInsertOnce = { v: opts.failInsertOnce ?? false };
  const s = {
    users, links, sessions, log,
    setCurrent(id) { current = id; },
    deps: {
      currentUserId: async () => current,
      findLinkByPuuid: async (p) => [...links.values()].find(r => r.rso_puuid === p) ?? null,
      findLinkByUser: async (u) => links.get(u) ?? null,
      insertLink: async (row) => {
        if (failInsertOnce.v) { failInsertOnce.v = false; return 'error'; }
        if ([...links.values()].some(r => r.rso_puuid === row.rso_puuid)) return 'dup_puuid';
        if (links.has(row.user_id)) return 'dup_user';
        links.set(row.user_id, { tft_puuid: null, has_tft: null, lol_region: null, ...row });
        return 'ok';
      },
      updateLinkNames: async (uid, p, g, t) => {
        const r = links.get(uid);
        if (r && r.rso_puuid === p) { r.game_name = g; r.tag_line = t; }
      },
      updateLinkEnrichment: async (uid, p, e) => {
        const r = links.get(uid);
        if (r && r.rso_puuid === p) Object.assign(r, e);
      },
      createUser: async (a) => {
        if (users.has(a.id) || [...users.values()].some(u => u.email === a.email)) return 'error';
        users.set(a.id, { id: a.id, email: a.email, rsoCreated: true, name: a.name });
        return 'ok';
      },
      getUser: async (id) => users.get(id) ?? null,
      deleteUser: async (id) => { users.delete(id); links.delete(id); },
      setUserName: async (id, name) => { const u = users.get(id); if (u) u.name = name; },
      createSession: async (email) => {
        const u = [...users.values()].find(x => x.email === email);
        if (!u) return false;
        sessions.push(u.id);
        current = u.id;
        return true;
      },
      log: (event, data) => log.push({ event, data }),
    },
  };
  return s;
}

function deps(riot, store, extra = {}) {
  return {
    fetch: riot.fetch, now: () => T0, sleep: async () => {},
    clientId: 'client-id', clientSecret: CLIENT_SECRET, linkSecret: SECRET, tftKey: 'RGAPI-tft',
    ...store.deps, ...extra,
  };
}

async function startFlow({ mode = 'login', next = '/tft', current = null } = {}) {
  const r = await rsoStart({ mode, next, currentUserId: current, origin: ORIGIN, clientId: 'client-id', linkSecret: SECRET, now: T0 });
  const url = new URL(r.location);
  return { r, state: url.searchParams.get('state'), url };
}

async function callback({ state, cookieValue, code = 'code-1', extraQuery = {} }, d) {
  const q = new URLSearchParams({ state, code, ...extraQuery });
  const cookies = cookieValue === undefined ? {} : { [rsoCookieName(state)]: cookieValue };
  return rsoCallback({ query: q, cookies, origin: ORIGIN }, d);
}

test('start: Riot-Adresse mit state, PKCE S256, scope openid und fester Rueckleitung', async () => {
  const { r, url, state } = await startFlow();
  assert.equal(url.origin + url.pathname, 'https://auth.riotgames.com/authorize');
  assert.equal(url.searchParams.get('scope'), 'openid');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://www.metastats.gg/auth/riot/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(r.cookie.name, rsoCookieName(state));
  const ck = await openRsoCookie(r.cookie.value, SECRET, T0);
  assert.equal(url.searchParams.get('code_challenge'), await pkceChallenge(ck.v));
  assert.equal(ck.u, null);
});

test('start: angemeldet + login → Kontoseite, abgemeldet + link → Login', async () => {
  assert.equal((await rsoStart({ mode: 'login', next: '/', currentUserId: 'u1', origin: ORIGIN, clientId: 'c', linkSecret: SECRET, now: T0 })).location, '/auth/account');
  assert.match((await rsoStart({ mode: 'link', next: '/', currentUserId: null, origin: ORIGIN, clientId: 'c', linkSecret: SECRET, now: T0 })).location, /^\/auth\/login\?next=/);
});

test('neues Konto: Riot-only-Konto mit fester Kennung, Platzhalter-Adresse, Sitzung, Anreicherung', async () => {
  const riot = fakeRiot({ tftByPuuid: 400 });
  const store = fakeStore();
  const { r, state } = await startFlow({ next: '/tft/comps' });
  const res = await callback({ state, cookieValue: r.cookie.value }, deps(riot, store));
  assert.equal(res.location, '/tft/comps');
  assert.deepEqual(res.clearCookies, [rsoCookieName(state)]);
  const id = await rsoUserId(ACC.puuid, SECRET);
  assert.ok(store.users.has(id));
  assert.ok(isRiotPlaceholderEmail(store.users.get(id).email));
  assert.equal(store.users.get(id).email, await rsoPlaceholderEmail(ACC.puuid, SECRET));
  assert.deepEqual(store.sessions, [id]);
  const link = store.links.get(id);
  assert.equal(link.rso_puuid, ACC.puuid);
  assert.equal(link.tft_puuid, 'tft-puuid-faker');  // by-puuid 400 → ueber den Namen
  assert.equal(link.has_tft, true);
  assert.equal(link.lol_region, 'kr');
  assert.equal(store.users.get(id).name, 'Faker#KR1');
});

test('gleiche Kennung bei beiden Schluesseln: tft_puuid = rso_puuid, kein Namensabruf', async () => {
  const riot = fakeRiot({ tftByPuuid: 200 });
  const store = fakeStore();
  const { r, state } = await startFlow();
  await callback({ state, cookieValue: r.cookie.value }, deps(riot, store));
  const link = [...store.links.values()][0];
  assert.equal(link.tft_puuid, ACC.puuid);
  assert.ok(!riot.calls.some(c => c.url.includes('/by-riot-id/')));
});

test('Wieder-Login: bestehende Verknuepfung → Sitzung des Besitzers, kein neues Konto, Name aufgefrischt', async () => {
  const riot = fakeRiot({ account: { ...ACC, gameName: 'Hide on bush' } });
  const store = fakeStore();
  store.users.set('discord-user', { id: 'discord-user', email: 'a@example.com', rsoCreated: false, name: 'Alice' });
  store.links.set('discord-user', { user_id: 'discord-user', rso_puuid: ACC.puuid, tft_puuid: null, game_name: 'Faker', tag_line: 'KR1', has_tft: null, lol_region: null });
  const { r, state } = await startFlow();
  const res = await callback({ state, cookieValue: r.cookie.value }, deps(riot, store));
  assert.equal(res.location, '/tft');
  assert.deepEqual(store.sessions, ['discord-user']);
  assert.equal(store.users.size, 1);
  assert.equal(store.links.get('discord-user').game_name, 'Hide on bush');
  assert.equal(store.users.get('discord-user').name, 'Alice');  // fremde Namen bleiben
});

test('Verknuepfen: angemeldeter Nutzer bekommt die Riot-ID, keine neue Sitzung', async () => {
  const riot = fakeRiot();
  const store = fakeStore({ current: 'u1' });
  store.users.set('u1', { id: 'u1', email: 'u1@example.com', rsoCreated: false });
  const { r, state } = await startFlow({ mode: 'link', next: '/auth/account', current: 'u1' });
  const res = await callback({ state, cookieValue: r.cookie.value }, deps(riot, store));
  assert.equal(res.location, '/auth/account');
  assert.equal(store.links.get('u1').rso_puuid, ACC.puuid);
  assert.deepEqual(store.sessions, []);
});

test('Verknuepfen: Riot-ID gehoert schon einem anderen Konto → conflict, nichts geaendert', async () => {
  const riot = fakeRiot();
  const store = fakeStore({ current: 'u1' });
  store.links.set('u2', { user_id: 'u2', rso_puuid: ACC.puuid, game_name: 'Faker', tag_line: 'KR1' });
  const { r, state } = await startFlow({ mode: 'link', current: 'u1' });
  const res = await callback({ state, cookieValue: r.cookie.value }, deps(riot, store));
  assert.equal(res.location, '/auth/account?error=conflict');
  assert.equal(store.links.get('u2').user_id, 'u2');
  assert.ok(!store.links.has('u1'));
});

test('Verknuepfen: Konto hat schon ein anderes Riot-Konto → has_other', async () => {
  const riot = fakeRiot();
  const store = fakeStore({ current: 'u1' });
  store.links.set('u1', { user_id: 'u1', rso_puuid: 'other-puuid', game_name: 'X', tag_line: 'Y' });
  const { r, state } = await startFlow({ mode: 'link', current: 'u1' });
  assert.equal((await callback({ state, cookieValue: r.cookie.value }, deps(riot, store))).location, '/auth/account?error=has_other');
});

test('Verknuepfen: nach Tab-Wechsel anderer Nutzer angemeldet → state, kein Riot-Abruf', async () => {
  const riot = fakeRiot();
  const store = fakeStore({ current: 'u1' });
  const { r, state } = await startFlow({ mode: 'link', current: 'u1' });
  store.setCurrent('u9');
  assert.equal((await callback({ state, cookieValue: r.cookie.value }, deps(riot, store))).location, '/auth/account?error=state');
  assert.equal(riot.calls.length, 0);
});

test('Login bei schon angemeldetem Nutzer und unbekannter Riot-ID → already_signed_in, kein zweites Konto', async () => {
  const riot = fakeRiot();
  const store = fakeStore();
  const { r, state } = await startFlow();
  store.setCurrent('u1');
  assert.equal((await callback({ state, cookieValue: r.cookie.value }, deps(riot, store))).location, '/auth/login?error=already_signed_in');
  assert.equal(store.users.size, 0);
});

test('falscher state, fehlendes Cookie, manipuliertes Cookie, abgelaufenes Cookie → state', async () => {
  const riot = fakeRiot();
  const store = fakeStore();
  const { r, state } = await startFlow();
  const d = deps(riot, store);
  assert.equal((await callback({ state, cookieValue: undefined }, d)).location, '/auth/login?error=state');
  const [v, body, sig] = r.cookie.value.split('.');
  assert.equal((await callback({ state, cookieValue: `${v}.${body}x.${sig}` }, d)).location, '/auth/login?error=state');
  assert.equal((await callback({ state, cookieValue: `v0.${body}.${sig}` }, d)).location, '/auth/login?error=state');
  const other = await startFlow();
  assert.equal((await callback({ state, cookieValue: other.r.cookie.value }, d)).location, '/auth/login?error=state');
  const late = deps(riot, store, { now: () => T0 + (RSO_COOKIE_MAX_AGE_S + 1) * 1000 });
  assert.equal((await callback({ state, cookieValue: r.cookie.value }, late)).location, '/auth/login?error=state');
  assert.equal(riot.calls.length, 0);
});

test('Riot: abgebrochen → riot_denied; Token 500 → exchange; accounts/me 401 → account', async () => {
  const store = fakeStore();
  let f = await startFlow();
  assert.equal((await callback({ state: f.state, cookieValue: f.r.cookie.value, extraQuery: { error: 'access_denied' } }, deps(fakeRiot(), store))).location, '/auth/login?error=riot_denied');
  f = await startFlow();
  assert.equal((await callback({ state: f.state, cookieValue: f.r.cookie.value }, deps(fakeRiot({ tokenStatus: 500 }), store))).location, '/auth/login?error=exchange');
  f = await startFlow();
  assert.equal((await callback({ state: f.state, cookieValue: f.r.cookie.value }, deps(fakeRiot({ meStatus: [401] }), store))).location, '/auth/login?error=account');
  assert.equal(store.users.size, 0);
});

test('accounts/me 429 einmal → Wiederholung klappt', async () => {
  const riot = fakeRiot({ meStatus: [429, 200] });
  const store = fakeStore();
  const { r, state } = await startFlow();
  assert.equal((await callback({ state, cookieValue: r.cookie.value }, deps(riot, store))).location, '/tft');
  assert.equal(riot.calls.filter(c => c.url.endsWith('/accounts/me')).length, 2);
});

test('doppelter Callback mit demselben Code: zweiter endet als Erfolg, weil schon angemeldet', async () => {
  const riot = fakeRiot();
  const store = fakeStore();
  const { r, state } = await startFlow();
  const d = deps(riot, store);
  assert.equal((await callback({ state, cookieValue: r.cookie.value }, d)).location, '/tft');
  assert.equal((await callback({ state, cookieValue: r.cookie.value }, d)).location, '/tft');
  assert.equal(store.users.size, 1);
});

test('Teilfehler: Konto angelegt, Verknuepfung scheitert → Konto weg; naechster Versuch klappt', async () => {
  const riot = fakeRiot();
  const store = fakeStore({ failInsertOnce: true });
  let f = await startFlow();
  assert.equal((await callback({ state: f.state, cookieValue: f.r.cookie.value }, deps(riot, store))).location, '/auth/login?error=account');
  assert.equal(store.users.size, 0);
  f = await startFlow();
  assert.equal((await callback({ state: f.state, cookieValue: f.r.cookie.value, code: 'code-2' }, deps(riot, store))).location, '/tft');
  assert.equal(store.users.size, 1);
  assert.equal(store.links.size, 1);
});

test('Wiederaufnahme: Konto existiert schon ohne Verknuepfung (Loeschen scheiterte) → wird uebernommen', async () => {
  const riot = fakeRiot();
  const store = fakeStore();
  const id = await rsoUserId(ACC.puuid, SECRET);
  store.users.set(id, { id, email: await rsoPlaceholderEmail(ACC.puuid, SECRET), rsoCreated: true });
  const { r, state } = await startFlow();
  assert.equal((await callback({ state, cookieValue: r.cookie.value }, deps(riot, store))).location, '/tft');
  assert.equal(store.links.get(id).rso_puuid, ACC.puuid);
});

test('fremdes Konto mit derselben Adresse (nicht vom Server angelegt) wird NICHT uebernommen', async () => {
  const riot = fakeRiot();
  const store = fakeStore();
  const id = await rsoUserId(ACC.puuid, SECRET);
  store.users.set(id, { id, email: await rsoPlaceholderEmail(ACC.puuid, SECRET), rsoCreated: false });
  const { r, state } = await startFlow();
  assert.equal((await callback({ state, cookieValue: r.cookie.value }, deps(riot, store))).location, '/auth/login?error=account');
  assert.equal(store.links.size, 0);
  assert.deepEqual(store.sessions, []);
});

test('gleichzeitiger Erst-Login derselben Riot-ID: ein Konto, beide angemeldet', async () => {
  const store = fakeStore();
  const a = await startFlow();
  const b = await startFlow();
  const [ra, rb] = await Promise.all([
    callback({ state: a.state, cookieValue: a.r.cookie.value, code: 'ca' }, deps(fakeRiot(), store)),
    callback({ state: b.state, cookieValue: b.r.cookie.value, code: 'cb' }, deps(fakeRiot(), store)),
  ]);
  assert.equal(ra.location, '/tft');
  assert.equal(rb.location, '/tft');
  assert.equal(store.users.size, 1);
  assert.equal(store.links.size, 1);
});

test('Anreicherung scheitert (Riot 429) → Anmeldung gilt trotzdem, Felder bleiben leer', async () => {
  const riot = fakeRiot({ tftByPuuid: 429 });
  const store = fakeStore();
  const { r, state } = await startFlow();
  assert.equal((await callback({ state, cookieValue: r.cookie.value }, deps(riot, store))).location, '/tft');
  const link = [...store.links.values()][0];
  assert.equal(link.tft_puuid, null);
  assert.equal(link.lol_region, null);
});

test('Name gehoert inzwischen jemand anderem (by-riot-id liefert anderen Namen) → keine TFT-Kennung', async () => {
  const riot = fakeRiot({ tftByPuuid: 400, byIdName: 'Someone Else' });
  const store = fakeStore();
  const { r, state } = await startFlow();
  assert.equal((await callback({ state, cookieValue: r.cookie.value }, deps(riot, store))).location, '/tft');
  assert.equal([...store.links.values()][0].tft_puuid, null);
});

test('kein LoL-Konto (by-game/lol 404) → lol_region null; kein TFT (404) → has_tft false', async () => {
  const riot = fakeRiot({ lolRegion: null, tftRegion: 404 });
  const store = fakeStore();
  const { r, state } = await startFlow();
  await callback({ state, cookieValue: r.cookie.value }, deps(riot, store));
  const link = [...store.links.values()][0];
  assert.equal(link.lol_region, null);
  assert.equal(link.has_tft, false);
});

test('Ziel nach der Anmeldung: nur eigene Pfade', async () => {
  for (const bad of ['//evil.com', '/\\evil.com', '/\t/evil.com', 'https://evil.com', '/auth/riot/start', 'javascript:alert(1)', '']) {
    assert.equal(safeNext(bad), '/', bad);
  }
  assert.equal(safeNext('/%09/evil.com'), '/%09/evil.com');  // bleibt ein eigener Pfad
  assert.equal(safeNext('/tft/comps?x=1#a'), '/tft/comps?x=1#a');
  const { r, state } = await startFlow({ next: '//evil.com' });
  const res = await callback({ state, cookieValue: r.cookie.value }, deps(fakeRiot(), fakeStore()));
  assert.equal(res.location, '/');
});

test('Geheimnisse stehen in keiner Antwort und keinem Protokoll', async () => {
  const riot = fakeRiot({ meStatus: [401] });
  const store = fakeStore();
  const { r, state, url } = await startFlow();
  const res = await callback({ state, cookieValue: r.cookie.value }, deps(riot, store));
  const all = JSON.stringify([res, url.toString(), r.cookie, store.log]);
  assert.ok(!all.includes(CLIENT_SECRET));
  assert.ok(!all.includes(SECRET));
  assert.ok(!all.includes('at-123'));
  // Der Token-Abruf schickt das Geheimnis nur im Basic-Kopf.
  const tokenCall = riot.calls.find(c => c.url === RSO_TOKEN_URL);
  assert.ok(!String(tokenCall.init.body).includes(CLIENT_SECRET));
  assert.equal(tokenCall.init.headers.Authorization, `Basic ${Buffer.from(`client-id:${CLIENT_SECRET}`).toString('base64')}`);
});

test('Cookie: Version und Signatur werden geprueft', async () => {
  const v = await sealRsoCookie({ s: 'a', v: 'b', m: 'login', n: '/', u: null, e: T0 + 1000 }, SECRET);
  assert.ok(await openRsoCookie(v, SECRET, T0));
  assert.equal(await openRsoCookie(v, `${SECRET}x`, T0), null);
  assert.equal(await openRsoCookie(v, SECRET, T0 + 2000), null);
});
