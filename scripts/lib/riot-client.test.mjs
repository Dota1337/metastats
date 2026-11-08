// Auffuellen des LoL-Kontingents (riot-client.mjs `fill`) gegen ein simuliertes Riot:
// festes 120-s-Fenster je Host, das mit der ersten Anfrage beginnt und alle Abrufe des
// Keys zaehlt (so verhaelt sich x-app-rate-limit-count, gemessen 08.11.2026: 69 → 1 in
// einem Schritt). Uhr und Warten sind falsch, damit die Tests keine Minuten brauchen.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRiotClient, longWindowCount } from './riot-client.mjs';
import { LOL_DEV_KEY_BATCH, lolFillOptions } from './riot-limits.mjs';

const EU = 'europe.api.riotgames.com';
const EU_URL = `https://${EU}/lol/match/v5/matches/EUW1_1`;
const ZONE = 112_000;                       // Fensterbeginn + 120 s − 8 s
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/**
 * foreign: [{ at, n, host? }] — fremde Abrufe (Live-Seite) relativ zum Start.
 * header: false oder (Index) => bool = Riot schickt keinen Zaehler. fail429: Indizes eigener
 * Abrufe mit 429. winMs: wie lang Riots Fenster wirklich ist.
 */
function riot({ fill = lolFillOptions(undefined), foreign = [], header = true, fail429 = new Set(), winMs = 120_000 } = {}) {
  const T0 = 1_000_000;
  let t = T0;
  const windows = new Map();
  const own = [];                           // { t, host, n, win, status }
  const queue = foreign.map((f) => ({ host: EU, ...f, t: T0 + f.at })).sort((a, b) => a.t - b.t);
  const add = (host, at, k) => {
    let w = windows.get(host);
    if (!w || at >= w.start + winMs) { w = { start: at, n: 0 }; windows.set(host, w); }
    w.n += k;
    return w;
  };
  globalThis.fetch = async (url) => {
    const host = new URL(url).host;
    while (queue.length && queue[0].t <= t) { const f = queue.shift(); add(f.host, f.t, f.n); }
    const w = add(host, t, 1);
    const i = own.length;
    const status = w.n > 100 || fail429.has(i) ? 429 : 200;
    own.push({ t, host, n: w.n, win: w.start, status });
    t += 150;                               // Antwortzeit
    const withHeader = typeof header === 'function' ? header(i) : header;
    const headers = withHeader ? { 'x-app-rate-limit-count': `${w.n}:120,1:1` } : {};
    if (status === 429) return new Response('', { status, headers: { ...headers, 'retry-after': '3' } });
    return new Response('{}', { status, headers });
  };
  const client = createRiotClient({
    ...LOL_DEV_KEY_BATCH, apiKey: 'test', log: () => {}, fill,
    now: () => t, sleep: async (ms) => { t += ms; },
  });
  return { client, own, T0, now: () => t };
}

async function run(r, n, url = EU_URL) { for (let i = 0; i < n; i++) await r.client.fetch(url, {}); }

/** Eigene Abrufe je Riot-Fenster (Fensterbeginn → Liste), in Reihenfolge. */
function windowsOf(own, host = EU) {
  const m = new Map();
  for (const o of own) if (o.host === host) { if (!m.has(o.win)) m.set(o.win, []); m.get(o.win).push(o); }
  return [...m.entries()].map(([start, list]) => ({ start, list }));
}

/** Hoechstzahl eigener Abrufe in irgendeinem 122-s-Stueck ab `from`. */
function maxSliding(own, from = -Infinity) {
  let max = 0;
  for (const o of own) {
    if (o.t < from) continue;
    max = Math.max(max, own.filter((x) => x.t > o.t - 122_000 && x.t <= o.t && x.t >= from).length);
  }
  return max;
}

test('Zaehler-Header lesen', () => {
  assert.equal(longWindowCount('68:120,11:1', 120), 68);
  assert.equal(longWindowCount('11:1, 7:120', 120), 7);
  assert.equal(longWindowCount('11:1', 120), null);
  assert.equal(longWindowCount(null, 120), null);
  assert.equal(longWindowCount('x:120', 120), null);
});

test('ohne fill: gleitendes Fenster wie bisher (36. Abruf erst nach 122 s)', async () => {
  const r = riot({ fill: null });
  await run(r, 36);
  assert.ok(r.own[35].t - r.own[0].t >= 122_000);
  assert.equal(r.client.fillStats().calls, 0);
});

test('ruhiger Schluessel: 35 sofort, Rest nur in den letzten 8 s, hoechstens 85 je Fenster, kein 122-s-Loch', async () => {
  const r = riot();
  await run(r, 400);
  const wins = windowsOf(r.own);
  assert.ok(wins.length >= 4, String(wins.length));
  for (const { start, list } of wins) {
    assert.ok(list.length <= 85, `${list.length} in einem Fenster`);
    const early = list.filter((o) => o.t < start + ZONE).length;
    assert.ok(early <= 35, `${early} vor der Zone`);
  }
  // Volle Fenster nutzen den Rahmen auch aus.
  assert.ok(wins.slice(0, -1).every((w) => w.list.length >= 80), wins.map((w) => w.list.length).join(','));
  assert.ok(r.own.every((o) => o.status === 200));
  // Heute: 400 Abrufe bei 35/122 s = ~1.400 s.
  assert.ok(r.now() - r.T0 < 700_000, String(r.now() - r.T0));
  assert.ok(r.client.fillStats().calls > 150);
});

test('fremder Schub: kein Auffuellen, 4 min nur 35, danach wieder', async () => {
  const r = riot({ foreign: [{ at: 30_000, n: 60 }] });
  await run(r, 400);
  const wins = windowsOf(r.own);
  const first = wins[0].list;
  // Ein Abruf in der Zone entdeckt den Schub (35 + 60 + 1), danach Schluss.
  assert.equal(first.length, 36);
  assert.equal(first.at(-1).n, 96);
  assert.ok(r.own.every((o) => o.status === 200), 'kein 429');
  const seen = first.at(-1).t;
  for (const { start, list } of wins.slice(1)) {
    if (start + ZONE < seen + 240_000) assert.ok(list.length <= 35, `${list.length} im Ruhe-Fenster`);
  }
  assert.ok(maxSliding(r.own.filter((o) => o.t > seen && o.t < seen + 240_000)) <= 35);
  assert.ok(wins.some((w) => w.list.length > 35 && w.start > seen), 'fuellt danach wieder auf');
  assert.equal(r.client.fillStats().busy, 1);
});

test('Fenster schon von anderen eroeffnet: dort nur der Grundanteil, ab dem naechsten wieder auffuellen', async () => {
  const r = riot({ foreign: [{ at: -10_000, n: 2 }] });
  await run(r, 200);
  const wins = windowsOf(r.own);
  assert.equal(wins[0].list[0].n, 3);
  assert.ok(wins[0].list.length <= 35, String(wins[0].list.length));
  assert.ok(wins[1].list.length > 35, String(wins[1].list.length));
  assert.equal(r.client.fillStats().busy, 0);
});

test('fehlender Zaehler-Header: nie auffuellen', async () => {
  const r = riot({ header: false });
  await run(r, 120);
  assert.ok(maxSliding(r.own) <= 35, String(maxSliding(r.own)));
  assert.equal(r.client.fillStats().calls, 0);
});

test('Zaehler faellt unterwegs aus: sofort Schluss mit Auffuellen', async () => {
  const r = riot({ header: (i) => i < 45 });     // 35 Grund + 10 in der Zone mit Zaehler
  await run(r, 120);
  const first = windowsOf(r.own)[0].list;
  assert.equal(first.length, 46, 'nur der Abruf, dessen Antwort keinen Zaehler hatte');
  assert.ok(r.own.every((o) => o.status === 200));
  assert.ok(maxSliding(r.own.slice(46)) <= 35);
});

test('Riot-Fenster etwas laenger als 120 s: hoechstens eine Probe je Sekunde ins alte Fenster', async () => {
  const r = riot({ winMs: 121_000 });
  await run(r, 300);
  const wins = windowsOf(r.own);
  for (const { list } of wins) assert.ok(list.length <= 87, String(list.length));
  assert.ok(r.own.every((o) => o.status === 200));
  assert.ok(wins.slice(0, -1).every((w) => w.list.length >= 80), wins.map((w) => w.list.length).join(','));
});

test('429: 4 min nur 35, der Abruf wird nachgeholt', async () => {
  const r = riot({ fail429: new Set([40]) });
  await run(r, 160);
  const hit = r.own[40];
  assert.equal(hit.status, 429);
  assert.equal(r.own.length, 161, 'ein Abruf mehr: der Retry');
  assert.equal(r.client.fillStats().busy, 1);
  const after = r.own.filter((o) => o.t > hit.t && o.t < hit.t + 240_000);
  assert.ok(after.length > 0);
  assert.ok(maxSliding(after) <= 35, String(maxSliding(after)));
});

test('setFill(null) schaltet sofort auf das alte Verhalten', async () => {
  const r = riot();
  await run(r, 100);
  r.client.setFill(null);
  const off = r.now();
  await run(r, 80);
  const later = r.own.filter((o) => o.t >= off);
  // Ab dem Umschalten nie mehr als 35 in 122 s, auch nicht zusammen mit den Abrufen davor.
  assert.equal(later.length, 80);
  for (const o of later) {
    const inWindow = r.own.filter((x) => x.t > o.t - 122_000 && x.t <= o.t).length;
    assert.ok(inWindow <= 35, String(inWindow));
  }
});

test('anderer Host (euw1) wartet nicht auf die europe-Abrufe', async () => {
  const r = riot();
  await run(r, 85);                              // europe-Fenster voll
  const before = r.now();
  await r.client.fetch('https://euw1.api.riotgames.com/lol/league/v4/entries/x', {});
  assert.ok(r.now() - before < 5_000, String(r.now() - before));
});
