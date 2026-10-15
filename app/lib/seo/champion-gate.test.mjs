/**
 * 404-/308-Pruefung der LoL-Champion-Adressen (champion-gate.ts).
 *
 * Wie bei not-found-gate.test.mjs ist der teure Fehler die echte Seite, die
 * ploetzlich 404 antwortet — besonders ein neuer Champion am Patch-Tag, den
 * die Build-Liste noch nicht kennt. Feste Testlisten und ein eingespielter
 * Abruf: der Test braucht kein Netz.
 *
 * Lauf: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { decideChampion, championIds, championIdFromPath, createLiveChampionIds } from './champion-gate.ts';

const build = championIds(['Ahri', 'MonkeyKing', 'JarvanIV']);
const live = championIds(['Ahri', 'MonkeyKing', 'JarvanIV', 'NewChamp']);
const noFetch = () => { throw new Error('kein Abruf erwartet'); };

test('Pfad → Kennung: nur /champions/<id>, kaputte Kodierung = null', () => {
  assert.equal(championIdFromPath('/champions/Ahri'), 'Ahri');
  assert.equal(championIdFromPath('/champions/Jarvan%49V'), 'JarvanIV');
  assert.equal(championIdFromPath('/champions/%E0%A4%A'), null);
  for (const p of ['/champions', '/champions/', '/champions/Ahri/xyz', '/tft/units/Ahri', '/champion/Ahri']) {
    assert.equal(championIdFromPath(p), undefined, p);
  }
});

test('bekannte Champions gehen ohne Abruf durch', async () => {
  for (const id of ['Ahri', 'MonkeyKing', 'JarvanIV']) {
    assert.deepEqual(await decideChampion(id, noFetch, build), { kind: 'pass' }, id);
  }
});

test('falsche Gross/Klein-Schreibung → 308 auf die richtige, ohne Abruf', async () => {
  assert.deepEqual(await decideChampion('ahri', noFetch, build), { kind: 'redirect', id: 'Ahri' });
  assert.deepEqual(await decideChampion('monkeyking', noFetch, build), { kind: 'redirect', id: 'MonkeyKing' });
  assert.deepEqual(await decideChampion('JARVANIV', noFetch, build), { kind: 'redirect', id: 'JarvanIV' });
});

test('keine reine Buchstaben-Kennung → 404 ohne Abruf', async () => {
  for (const id of ['Fake123', 'Ahri_', 'Nunu & Willump', "Kai'Sa", '../etc']) {
    assert.deepEqual(await decideChampion(id, noFetch, build), { kind: 'missing' }, id);
  }
});

test('neuer Champion (nicht in der Build-Liste) geht ueber den Laufzeit-Abgleich durch', async () => {
  assert.deepEqual(await decideChampion('NewChamp', async () => live, build), { kind: 'pass' });
  assert.deepEqual(await decideChampion('newchamp', async () => live, build), { kind: 'redirect', id: 'NewChamp' });
});

test('Faelschung → 404 nur mit Laufzeit-Liste; ohne sie geht sie durch', async () => {
  assert.deepEqual(await decideChampion('NoSuchChampion', async () => live, build), { kind: 'missing' });
  assert.deepEqual(await decideChampion('NoSuchChampion', async () => null, build), { kind: 'pass' });
});

test('leere Build-Liste (Abruf im Build gescheitert): alles ueber die Laufzeit, Kleinschreibung trotzdem 308', async () => {
  const empty = championIds([]);
  assert.deepEqual(await decideChampion('Ahri', async () => live, empty), { kind: 'pass' });
  assert.deepEqual(await decideChampion('ahri', async () => live, empty), { kind: 'redirect', id: 'Ahri' });
  assert.deepEqual(await decideChampion('Ahri', async () => null, empty), { kind: 'pass' });
});

// ---------- Laufzeit-Liste ----------

function fakeDdragon({ version = '16.20.1', ids = ['Ahri', 'MonkeyKing'], fail = false, delayMs = 0 } = {}) {
  const calls = [];
  const state = { version, ids, fail };
  const fetch = async url => {
    calls.push(url.replace('https://ddragon.leagueoflegends.com', ''));
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    if (state.fail) throw new Error('offline');
    if (url.endsWith('/api/versions.json')) return { ok: true, status: 200, json: async () => [state.version, '16.19.1'] };
    const data = Object.fromEntries(state.ids.map(id => [id, { id }]));
    return { ok: true, status: 200, json: async () => ({ data }) };
  };
  return { fetch, calls, state };
}
const many = n => Array.from({ length: n }, (_, i) => `Champ${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`);

test('Laufzeit: gleichzeitige Anfragen teilen sich EINEN Abruf', async () => {
  const dd = fakeDdragon({ ids: many(150), delayMs: 20 });
  const load = createLiveChampionIds({ fetch: dd.fetch });
  const results = await Promise.all(Array.from({ length: 20 }, () => load()));
  assert.ok(results.every(r => r && r.ids.size === 150));
  assert.deepEqual(dd.calls, ['/api/versions.json', '/cdn/16.20.1/data/en_US/champion.json']);
});

test('Laufzeit: Liste 10 min gemerkt, danach nur versions.json; champion.json erst bei neuer Version', async () => {
  let t = 0;
  const dd = fakeDdragon({ ids: many(150) });
  const load = createLiveChampionIds({ fetch: dd.fetch, now: () => t });
  await load();
  t = 9 * 60 * 1000;
  await load();
  assert.equal(dd.calls.length, 2, 'innerhalb von 10 min kein Abruf');
  t = 11 * 60 * 1000;
  await load();
  assert.deepEqual(dd.calls.slice(2), ['/api/versions.json'], 'gleiche Version → nur versions.json');
  // Patch-Tag: neue Version mit neuem Champion
  dd.state.version = '16.21.1';
  dd.state.ids = [...many(150), 'NewChamp'];
  t = 22 * 60 * 1000;
  const list = await load();
  assert.ok(list.ids.has('NewChamp'));
  assert.deepEqual(dd.calls.slice(3), ['/api/versions.json', '/cdn/16.21.1/data/en_US/champion.json']);
});

test('Laufzeit: Fehlschlag → null (Adresse geht durch), 60 s Pause, dann neuer Versuch', async () => {
  let t = 0;
  const dd = fakeDdragon({ fail: true });
  const load = createLiveChampionIds({ fetch: dd.fetch, now: () => t });
  assert.equal(await load(), null);
  assert.equal(await load(), null);
  assert.equal(dd.calls.length, 1, 'in der Pause kein weiterer Abruf');
  dd.state.fail = false;
  dd.state.ids = many(150);
  t = 61 * 1000;
  assert.equal((await load()).ids.size, 150);
});

test('Laufzeit: alte Liste + Fehlschlag → null, nie eine 404 aus einer veralteten Liste', async () => {
  let t = 0;
  const dd = fakeDdragon({ ids: many(150) });
  const load = createLiveChampionIds({ fetch: dd.fetch, now: () => t });
  await load();
  dd.state.fail = true;
  t = 11 * 60 * 1000;
  assert.equal(await load(), null);
});

test('Laufzeit: zu langsamer Abruf → null nach der Wartezeit, waitUntil haelt ihn am Leben', async () => {
  const dd = fakeDdragon({ ids: many(150), delayMs: 60 });
  const load = createLiveChampionIds({ fetch: dd.fetch, waitMs: 10 });
  const kept = [];
  assert.equal(await load(p => kept.push(p)), null);
  assert.equal(kept.length, 1);
  await kept[0];
  assert.equal((await load()).ids.size, 150, 'danach aus dem Speicher');
});

test('Laufzeit: zu wenige Champions in der Antwort gelten als Fehlschlag', async () => {
  const dd = fakeDdragon({ ids: ['Ahri'] });
  const load = createLiveChampionIds({ fetch: dd.fetch });
  assert.equal(await load(), null);
});
