/**
 * Zauberliste der Spielerseite (dd-assets.ts → MatchDetail.tsx, LiveGameDetail.tsx): Anzeigename
 * „Flash“, nicht die Kennung „SummonerFlash“ — dieselbe Regel wie der
 * Builds-Block (lol-builds-view.ts). Dazu: erneute Versuche nach einem Aussetzer
 * und ein Fehlschlag, der nach 60 s verfaellt. Der Speicher haengt an der
 * Version, deshalb nutzt jeder Fall eine eigene.
 *
 * Lauf: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadSummonerIndex } from './dd-assets.ts';

const SUMMONER_JSON = { type: 'summoner', version: 'x', data: {
  SummonerFlash: { id: 'SummonerFlash', key: '4', name: 'Flash', image: { full: 'SummonerFlash.png' } },
  SummonerDot: { id: 'SummonerDot', key: '14', name: 'Ignite', image: { full: 'SummonerDot.png' } },
  Broken: { id: 'SummonerBroken', key: '99', name: 'Broken' },
} };

// Ohne echte Wartezeit zwischen den Versuchen.
const FAST = { delays: [0, 0, 0] };

const ok = () => new Response(JSON.stringify(SUMMONER_JSON), { status: 200 });

function stubFetch(t, impl) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push(String(url)); return impl(url, calls.length, init); };
  t.after(() => { globalThis.fetch = orig; });
  return calls;
}

test('Anzeigenamen und Bilder, Eintrag ohne Bild faellt weg', async (t) => {
  stubFetch(t, ok);
  const map = await loadSummonerIndex('92.1.1');
  assert.deepEqual(map[4], { id: 4, name: 'Flash', iconFile: 'SummonerFlash.png' });
  assert.equal(map[14].name, 'Ignite');
  assert.equal(map[99], undefined);
});

test('ein Abruf je Version', async (t) => {
  const calls = stubFetch(t, ok);
  await Promise.all([loadSummonerIndex('92.2.1'), loadSummonerIndex('92.2.1')]);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/cdn\/92\.2\.1\/data\/en_US\/summoner\.json$/);
});

test('403 ist endgueltig: ein Abruf, leere Liste', async (t) => {
  const calls = stubFetch(t, () => new Response('nope', { status: 403 }));
  assert.deepEqual(await loadSummonerIndex('92.3.1', FAST), {});
  assert.equal(calls.length, 1);
});

test('Netzfehler: vier Versuche, dann leere Liste', async (t) => {
  const calls = stubFetch(t, () => { throw new Error('ECONNRESET'); });
  assert.deepEqual(await loadSummonerIndex('92.3.2', FAST), {});
  assert.equal(calls.length, 4);
});

test('zwei Netzfehler, dann Erfolg', async (t) => {
  const calls = stubFetch(t, (url, n) => { if (n <= 2) throw new Error('ECONNRESET'); return ok(); });
  const map = await loadSummonerIndex('92.4.1', FAST);
  assert.equal(map[4].name, 'Flash');
  assert.equal(calls.length, 3);
});

test('503, 429 und abgebrochene Antwort werden wiederholt', async (t) => {
  const calls = stubFetch(t, (url, n) => {
    if (n === 1) return new Response('busy', { status: 503 });
    if (n === 2) return new Response('slow down', { status: 429 });
    if (n === 3) return new Response('{"data":{"Summ', { status: 200 });
    return ok();
  });
  assert.equal((await loadSummonerIndex('92.4.2', FAST))[14].name, 'Ignite');
  assert.equal(calls.length, 4);
});

test('Zeitlimit: haengender Abruf wird abgebrochen und wiederholt', async (t) => {
  // Der Zeitgeber von AbortSignal.timeout haelt Node nicht wach — sonst endet der Lauf vorher.
  const awake = setInterval(() => {}, 1000);
  t.after(() => clearInterval(awake));
  const calls = stubFetch(t, (url, n, init) => {
    if (n > 1) return ok();
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  });
  const map = await loadSummonerIndex('92.4.3', { ...FAST, timeoutMs: 20 });
  assert.equal(map[4].name, 'Flash');
  assert.equal(calls.length, 2);
});

test('Fehlschlag gilt 60 s, danach neuer Abruf', async (t) => {
  let up = false;
  const calls = stubFetch(t, () => (up ? ok() : new Response('nope', { status: 403 })));
  assert.deepEqual(await loadSummonerIndex('92.5.1', FAST), {});
  up = true;
  assert.deepEqual(await loadSummonerIndex('92.5.1', FAST), {});
  assert.equal(calls.length, 1);
  const map = await loadSummonerIndex('92.5.1', { ...FAST, now: Date.now() + 61_000 });
  assert.equal(map[4].name, 'Flash');
  assert.equal(calls.length, 2);
});

test('leere Antwort zaehlt als Fehlschlag, ohne Wiederholung', async (t) => {
  let empty = true;
  const calls = stubFetch(t, () => (empty ? new Response('{"data":{}}', { status: 200 }) : ok()));
  assert.deepEqual(await loadSummonerIndex('92.5.2', FAST), {});
  assert.equal(calls.length, 1);
  empty = false;
  assert.equal((await loadSummonerIndex('92.5.2', { ...FAST, now: Date.now() + 61_000 }))[4].name, 'Flash');
  assert.equal(calls.length, 2);
});

test('Aufrufer waehrend der Wartezeit teilen die laufende Kette', async (t) => {
  const calls = stubFetch(t, (url, n) => (n === 1 ? new Response('busy', { status: 503 }) : ok()));
  const first = loadSummonerIndex('92.6.1', { delays: [40, 0, 0] });
  await new Promise((r) => setTimeout(r, 10));
  const second = loadSummonerIndex('92.6.1');
  assert.equal(second, first);
  assert.equal((await second)[4].name, 'Flash');
  assert.equal(calls.length, 2);
});

test('ohne Version kein Abruf', async (t) => {
  const calls = stubFetch(t, () => new Response('{}', { status: 200 }));
  assert.deepEqual(await loadSummonerIndex(''), {});
  assert.equal(calls.length, 0);
});
