import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExplorerUrl, explorerQueryFor } from './tft-explorer-url.ts';
import { parseExplorerParams, serializeExplorerQuery } from './tft-explorer-query.ts';

const parse = (url) => parseExplorerParams(new URL(url, 'https://x.test').searchParams);

test('Link der Unit-Seite: kurze Form, Rang-Gruppe als Raenge, Traeger und Reiter', () => {
  const url = buildExplorerUrl({
    units: [{ id: 'U_Lux', n: 3, nx: 3, s: 2, sx: 2 }], focus: 'U_Lux', tab: 'builds', bucket: 'master_plus', region: 'euw1',
  });
  assert.equal(decodeURIComponent(url), '/tft/explorer?r=euw1&k=challenger,grandmaster,master&u=U_Lux:s2e:n3e&tab=builds&f=U_Lux');
  const q = parse(url);
  assert.equal(q.tab, 'builds');
  assert.equal(q.focus, 'U_Lux');
  assert.deepEqual(q.ranks, ['CHALLENGER', 'GRANDMASTER', 'MASTER']);
});

test('Rundlauf: gelesene Anfrage schreibt dieselbe Adresse', () => {
  for (const f of [
    { items: ['I_Shojin'], bucket: 'diamond_plus' },
    { traits: ['T_Elderwood'] },
    { units: ['U_A', 'U_B'], region: 'ALL', patch: '9.9' },
    { units: [{ id: 'U_A', it: ['I_X'] }], tab: 'items', focus: 'U_A', bucket: 'all' },
  ]) {
    const url = buildExplorerUrl(f);
    const qs = url.split('?')[1] ?? '';
    assert.equal(serializeExplorerQuery(parse(url)), qs, url);
    assert.equal(serializeExplorerQuery(explorerQueryFor(f)), qs);
  }
});

test('ohne Filter: nackte Explorer-Adresse', () => {
  assert.equal(buildExplorerUrl({}), '/tft/explorer');
});
