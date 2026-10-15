/**
 * Zauberliste der Spielerseite (dd-assets.ts → MatchDetail.tsx, LiveGameDetail.tsx): Anzeigename
 * „Flash“, nicht die Kennung „SummonerFlash“ — dieselbe Regel wie der
 * Builds-Block (lol-builds-view.ts). Der Speicher haengt an der Version, deshalb
 * nutzt jeder Fall eine eigene.
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

function stubFetch(t, impl) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return impl(url); };
  t.after(() => { globalThis.fetch = orig; });
  return calls;
}

test('Anzeigenamen und Bilder, Eintrag ohne Bild faellt weg', async (t) => {
  stubFetch(t, () => new Response(JSON.stringify(SUMMONER_JSON), { status: 200 }));
  const map = await loadSummonerIndex('92.1.1');
  assert.deepEqual(map[4], { id: 4, name: 'Flash', iconFile: 'SummonerFlash.png' });
  assert.equal(map[14].name, 'Ignite');
  assert.equal(map[99], undefined);
});

test('ein Abruf je Version', async (t) => {
  const calls = stubFetch(t, () => new Response(JSON.stringify(SUMMONER_JSON), { status: 200 }));
  await Promise.all([loadSummonerIndex('92.2.1'), loadSummonerIndex('92.2.1')]);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/cdn\/92\.2\.1\/data\/en_US\/summoner\.json$/);
});

test('Fehlerantwort und Netzfehler ergeben eine leere Liste', async (t) => {
  stubFetch(t, (url) => {
    if (String(url).includes('92.3.1')) return new Response('nope', { status: 403 });
    throw new Error('ECONNRESET');
  });
  assert.deepEqual(await loadSummonerIndex('92.3.1'), {});
  assert.deepEqual(await loadSummonerIndex('92.3.2'), {});
});

test('ohne Version kein Abruf', async (t) => {
  const calls = stubFetch(t, () => new Response('{}', { status: 200 }));
  assert.deepEqual(await loadSummonerIndex(''), {});
  assert.equal(calls.length, 0);
});
