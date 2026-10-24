import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CARRIERS_START, carrierRows, carriersBody, isCarriersDefault } from './explorer-carriers.mjs';
import { TABS, normalizeQuery } from './explorer-normalize.mjs';
import { pickItemsWarmBody, startViewTabs } from './explorer-unit-warm.mjs';
import { carrierPick } from '../../app/lib/tft-explorer-coplay.mjs';
import {
  carriersApiQs, carriersItemOf, carriersServiceBody, parseExplorerParams,
} from '../../app/lib/tft-explorer-query.ts';

const X = 'DA_GargoyleStoneplate';
const LATEST = '18.5b';
// Wie resolveLatest im Dienst.
const resolved = (body) => {
  const q = normalizeQuery(body);
  if (q.patches[0] === 'latest') q.patches = [LATEST];
  return q;
};
const page = (s) => parseExplorerParams(new URLSearchParams(s));

test('Seite und Dienst: dieselbe Anfrage, und sie gilt als Standardansicht', () => {
  assert.deepEqual(normalizeQuery(carriersServiceBody(X)), normalizeQuery(carriersBody(X)));
  assert.equal(carriersApiQs(X), `i=${X}&tab=carriers&f=${X}`);
  // Der User-Link: Item gewaehlt, Reiter Items.
  const item = carriersItemOf(page(`i=${X}&tab=items`), LATEST);
  assert.equal(item, X);
  assert.ok(isCarriersDefault(resolved(carriersServiceBody(item)), LATEST));
  // Der Reiter taucht nie in der Seiten-Adresse auf: tab=carriers faellt auf Units zurueck.
  assert.equal(page(carriersApiQs(X)).tab, 'units');
});

test('carriersItemOf: nur Standardansicht mit genau einem Item', () => {
  assert.equal(carriersItemOf(page(`i=${X}`)), X);
  assert.equal(carriersItemOf(page(`p=${LATEST}&i=${X}`), LATEST), X, 'neuester Patch als Nummer');
  for (const s of [
    `p=18.4&i=${X}`, `p=all&i=${X}`, `k=diamond&i=${X}`, `r=euw1&i=${X}`, `lv=8&i=${X}`, `pl=1-4&i=${X}`,
    `i=${X},DA_Other`, `i=!${X}`, `i=${X}:n2`, `u=DA_18_Maokai&i=${X}`, `t=DA_Trait&i=${X}`, `g1=any,u.DA_A,u.DA_B&i=${X}`,
    `bc=emb:2-&i=${X}`, `tg=shred&i=${X}`, '',
  ]) assert.equal(carriersItemOf(page(s), LATEST), null, s);
  assert.equal(carriersItemOf(page(`p=${LATEST}&i=${X}`), null), null, 'ohne bekannten neuesten Patch nur „latest"');
});

test('isCarriersDefault: andere Grundmenge oder Filter → keine Standardansicht', () => {
  const ok = resolved(carriersBody(X));
  assert.ok(isCarriersDefault(ok, LATEST));
  assert.ok(!isCarriersDefault(ok, null));
  assert.ok(!isCarriersDefault(ok, '18.4'));
  assert.ok(!isCarriersDefault(resolved({ ...carriersBody(X), region: 'euw1' }), LATEST));
  assert.ok(!isCarriersDefault(resolved({ ...carriersBody(X), ranks: ['DIAMOND'] }), LATEST));
  assert.ok(!isCarriersDefault(resolved({ ...carriersBody(X), items: [{ id: X }, { id: 'DA_Other' }] }), LATEST));
  assert.ok(!isCarriersDefault(resolved({ ...carriersBody(X), items: [{ id: 'DA_Other' }] }), LATEST), 'Fokus nicht das Item');
  assert.ok(!isCarriersDefault(resolved({ ...carriersBody(X), items: [{ id: X, x: true }] }), LATEST));
  assert.ok(!isCarriersDefault(resolved({ ...carriersBody(X), units: [{ id: 'DA_A' }] }), LATEST));
  assert.ok(!isCarriersDefault(resolved({ ...carriersBody(X), tab: 'items' }), LATEST));
  assert.throws(() => normalizeQuery({ tab: 'carriers', items: [{ id: X }] }), /invalid_focus/);
});

test('Startansichten: kein Reiter, der ohne Fokus wirft (sonst laeuft warmUnits nie)', () => {
  const tabs = startViewTabs(TABS);
  assert.ok(!tabs.includes('carriers') && !tabs.includes('builds') && tabs.includes('items'));
  for (const tab of tabs) assert.doesNotThrow(() => normalizeQuery({ tab, patches: ['latest'] }), tab);
});

test('carrierRows: aus dem Vorrat, unvollstaendig → null, ohne Δ', () => {
  const store = new Map();
  const put = (body, res) => store.set(JSON.stringify(normalizeQuery(body)), res);
  const get = (body) => store.get(JSON.stringify(normalizeQuery(body)));
  put(CARRIERS_START.units, { rows: [
    { key: 'A', sub: null, games: 5000 }, { key: 'B', sub: null, games: 3000 }, { key: 'C', sub: null, games: 999 },
  ] });
  put(CARRIERS_START.items, { rows: [{ key: X, sub: null, games: 4000 }, { key: 'DA_Other', sub: null, games: 900 }] });
  const row = (key, games, avg) => ({ key, sub: null, sub2: null, games, matches: games, avg, top4: 0.6, top1: 0.2, half: 0.1, dOut: -0.4, dBase: -0.3 });
  put(pickItemsWarmBody('A'), { rows: [row(X, 300, 3.9), row('DA_Other', 50, 4.1)] });
  assert.equal(carrierRows(X, get), null, 'B fehlt noch');
  put(pickItemsWarmBody('B'), { rows: [row('DA_Other', 80, 4.0)] });
  assert.deepEqual(carrierRows(X, get), {
    rows: [{ key: 'A', games: 300, matches: 300, avg: 3.9, top4: 0.6, top1: 0.2, half: 0.1 }],
    refGames: 4000,
  });
  assert.equal(carrierRows(X, () => undefined), null, 'leerer Vorrat');
  assert.deepEqual(carrierRows('DA_Rare', get), { rows: [], refGames: 0 });
});

test('carrierPick: 200 Spiele UND 2 % der Item-Bretter, bester Ø zuerst, hoechstens 8', () => {
  const r = (key, games, avg) => ({ key, games, avg });
  const rows = [
    r('Krug', 28483, 3.96), r('Maokai', 25261, 3.47), r('Taric', 13704, 3.53), r('Alistar', 13666, 3.90),
    r('Gnar', 839, 3.31), r('Lux', 6000, 3.20), r('Few', 199, 2.5),
  ];
  // 294.908 Bretter mit Gargoyle → 2 % = 5.898 Spiele.
  assert.deepEqual(carrierPick(rows, { refGames: 294908 }).map(x => x.key), ['Lux', 'Maokai', 'Taric', 'Alistar', 'Krug']);
  assert.deepEqual(carrierPick(rows, { refGames: 294908, allow: id => id !== 'Lux', max: 2 }).map(x => x.key), ['Maokai', 'Taric']);
  // Seltenes Item: dann greift die 200.
  assert.deepEqual(carrierPick(rows, { refGames: 5000 }).map(x => x.key).slice(0, 3), ['Lux', 'Gnar', 'Maokai']);
  assert.deepEqual(carrierPick(rows, { refGames: 0 }), []);
});
