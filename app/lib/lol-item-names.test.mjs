/**
 * Item-Namen fuer die Builds-Route (lol-item-names.ts): ein Zusatz, der nie
 * wirft. Faellt Data Dragon aus, geht die Antwort ohne `itemNames` raus und
 * der Block zeigt „Item N“ — die Route darf daran nie scheitern.
 *
 * Lauf: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { lolItemNameTable, withItemNames } from './lol-item-names.ts';

const ITEM_JSON = { data: { 3089: { name: "Rabadon's Deathcap" }, 3100: { name: 'Lich Bane' }, 3020: { name: "Sorcerer's Shoes" } } };
const body = (version) => ({
  ddragonVersion: version, hasBuilds: true,
  roles: { MIDDLE: { topBuilds: [{ items: [3089, 0] }], topBoots: [{ item: 3020 }], topItems: [{ item: 7777 }] } },
});

function stubFetch(t, impl) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push(String(url)); return impl(url, opts); };
  t.after(() => { globalThis.fetch = orig; });
  return calls;
}
const ok = () => new Response(JSON.stringify(ITEM_JSON), { status: 200 });

test('Namen nur fuer die Items der Antwort, unbekannte fehlen', async (t) => {
  const calls = stubFetch(t, ok);
  const out = await withItemNames(body('91.1.1'));
  assert.deepEqual(out.itemNames, { 3089: "Rabadon's Deathcap", 3020: "Sorcerer's Shoes" });
  assert.equal(out.roles.MIDDLE.topBoots[0].item, 3020);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/cdn\/91\.1\.1\/data\/en_US\/item\.json$/);
});

test('gleichzeitige Anfragen laden item.json nur einmal', async (t) => {
  const calls = stubFetch(t, ok);
  await Promise.all([withItemNames(body('91.2.1')), withItemNames(body('91.2.1')), lolItemNameTable('91.2.1')]);
  assert.equal(calls.length, 1);
});

test('Fehler: kein Wurf, Antwort unveraendert, 60 s gemerkt', async (t) => {
  const calls = stubFetch(t, () => new Response('nope', { status: 403 }));
  const b = body('91.3.1');
  assert.equal(await withItemNames(b), b);
  assert.equal(await lolItemNameTable('91.3.1'), null);
  assert.equal(calls.length, 1, 'innerhalb von 60 s kein neuer Versuch');
  await lolItemNameTable('91.3.1', Date.now() + 61_000);
  assert.equal(calls.length, 2, 'danach neuer Versuch');
});

test('Netzfehler und kaputtes JSON ergeben null', async (t) => {
  stubFetch(t, (url) => {
    if (String(url).includes('91.4.1')) throw new Error('ECONNRESET');
    return new Response('{kaputt', { status: 200 });
  });
  assert.equal(await lolItemNameTable('91.4.1'), null);
  assert.equal(await lolItemNameTable('91.4.2'), null);
});

test('ohne gueltige Version kein Abruf', async (t) => {
  const calls = stubFetch(t, ok);
  assert.equal(await lolItemNameTable('../x'), null);
  const b = { ...body(undefined) };
  assert.equal(await withItemNames(b), b);
  assert.equal(calls.length, 0);
});

test('haelt hoechstens zwei Versionen', async (t) => {
  const calls = stubFetch(t, ok);
  await lolItemNameTable('91.6.1');
  await lolItemNameTable('91.6.2');
  await lolItemNameTable('91.6.3');
  await lolItemNameTable('91.6.3');
  assert.equal(calls.length, 3);
  await lolItemNameTable('91.6.1');
  assert.equal(calls.length, 4, 'die aelteste ist verdraengt');
});
