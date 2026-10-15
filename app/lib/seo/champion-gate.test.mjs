/**
 * 404-/308-/307-Pruefung der LoL-Champion-Adressen (champion-gate.ts).
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

test('bekannte Champions und feste Unterseiten gehen ohne Abruf durch', async () => {
  for (const id of ['Ahri', 'MonkeyKing', 'JarvanIV']) {
    assert.deepEqual(await decideChampion(id, noFetch, build), { kind: 'pass' }, id);
  }
  const withStatic = championIds(['Ahri'], ['tierlist']);
  assert.deepEqual(await decideChampion('tierlist', noFetch, withStatic), { kind: 'pass' });
});

test('falsche Gross/Klein-Schreibung → 308 nur mit Bestaetigung der Laufzeit-Liste', async () => {
  const red = (id, permanent) => ({ kind: 'redirect', id, permanent });
  assert.deepEqual(await decideChampion('ahri', async () => live, build), red('Ahri', true));
  assert.deepEqual(await decideChampion('monkeyking', async () => live, build), red('MonkeyKing', true));
  assert.deepEqual(await decideChampion('JARVANIV', async () => live, build), red('JarvanIV', true));
  // Data Dragon weg: nur die Build-Liste kennt die Schreibweise → voruebergehend (307)
  assert.deepEqual(await decideChampion('ahri', async () => null, build), red('Ahri', false));
  // Riot hat die Schreibweise geaendert, die Build-Liste ist alt: nie auf die alte Adresse
  const renamed = championIds(['AHRI', 'MonkeyKing', 'JarvanIV']);
  assert.deepEqual(await decideChampion('ahri', async () => renamed, build), red('AHRI', true));
});

test('keine Kennungs-Form → 404 ohne Abruf', async () => {
  for (const id of ['Ahri-', 'No-Such-Champ', 'Nunu & Willump', "Kai'Sa", '../etc', 'Ahri.']) {
    assert.deepEqual(await decideChampion(id, noFetch, build), { kind: 'missing' }, id);
  }
});

test('Kennung mit Ziffer oder Unterstrich geht an den Abgleich (kuenftige Champions)', async () => {
  const withDigit = championIds([...live.ids, 'Champ2']);
  assert.deepEqual(await decideChampion('Champ2', async () => withDigit, build), { kind: 'pass' });
  assert.deepEqual(await decideChampion('Fake123', async () => live, build), { kind: 'missing' });
  assert.deepEqual(await decideChampion('Ahri_', async () => live, build), { kind: 'missing' });
});

test('neuer Champion (nicht in der Build-Liste) geht ueber den Laufzeit-Abgleich durch', async () => {
  assert.deepEqual(await decideChampion('NewChamp', async () => live, build), { kind: 'pass' });
  assert.deepEqual(await decideChampion('newchamp', async () => live, build), { kind: 'redirect', id: 'NewChamp', permanent: true });
});

test('Faelschung → 404 nur mit Laufzeit-Liste; ohne sie geht sie durch', async () => {
  assert.deepEqual(await decideChampion('NoSuchChampion', async () => live, build), { kind: 'missing' });
  assert.deepEqual(await decideChampion('NoSuchChampion', async () => null, build), { kind: 'pass' });
});

test('leere Build-Liste (Abruf im Build gescheitert): alles ueber die Laufzeit', async () => {
  const empty = championIds([]);
  assert.deepEqual(await decideChampion('Ahri', async () => live, empty), { kind: 'pass' });
  assert.deepEqual(await decideChampion('ahri', async () => live, empty), { kind: 'redirect', id: 'Ahri', permanent: true });
  assert.deepEqual(await decideChampion('Ahri', async () => null, empty), { kind: 'pass' });
  assert.deepEqual(await decideChampion('ahri', async () => null, empty), { kind: 'pass' });
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

test('Laufzeit: vor einer 404 wird eine Liste aelter als 60 s nachgeprueft (Patch-Tag)', async () => {
  let t = 0;
  const dd = fakeDdragon({ ids: many(150) });
  const load = createLiveChampionIds({ fetch: dd.fetch, now: () => t });
  const decide = id => decideChampion(id, confirm => load(undefined, confirm), build);
  await load();
  // 2 min spaeter: neuer Patch mit neuem Champion, die gemerkte Liste kennt ihn nicht
  dd.state.version = '16.21.1';
  dd.state.ids = [...many(150), 'NewChamp'];
  t = 2 * 60 * 1000;
  assert.deepEqual(await decide('NewChamp'), { kind: 'pass' });
  assert.deepEqual(dd.calls.slice(2), ['/api/versions.json', '/cdn/16.21.1/data/en_US/champion.json']);
  // Faelschungs-Serie: innerhalb der naechsten 60 s kein weiterer Abruf
  t += 30 * 1000;
  assert.deepEqual(await decide('NoSuchChampion'), { kind: 'missing' });
  assert.deepEqual(await decide('AlsoFake'), { kind: 'missing' });
  assert.equal(dd.calls.length, 4);
  // danach hoechstens versions.json
  t += 60 * 1000;
  assert.deepEqual(await decide('NoSuchChampion'), { kind: 'missing' });
  assert.deepEqual(dd.calls.slice(4), ['/api/versions.json']);
});

test('Laufzeit: Nachpruefung scheitert → Adresse geht durch, Treffer kommen weiter aus der Liste', async () => {
  let t = 0;
  const dd = fakeDdragon({ ids: [...many(150), 'NewChamp'] });
  const load = createLiveChampionIds({ fetch: dd.fetch, now: () => t });
  const decide = id => decideChampion(id, confirm => load(undefined, confirm), build);
  await load();
  dd.state.fail = true;
  t = 5 * 60 * 1000;
  assert.deepEqual(await decide('NoSuchChampion'), { kind: 'pass' });
  assert.deepEqual(await decide('newchamp'), { kind: 'redirect', id: 'NewChamp', permanent: true });
});

test('Laufzeit: zu wenige Champions in der Antwort gelten als Fehlschlag', async () => {
  const dd = fakeDdragon({ ids: ['Ahri'] });
  const load = createLiveChampionIds({ fetch: dd.fetch });
  assert.equal(await load(), null);
});
