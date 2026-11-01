import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleCounts, compareBundles } from './check-tft-bundle-shrink.mjs';

const many = (n, make) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, make(i)]));
const LANGS = ['de', 'ko', 'zh', 'es', 'fr'];
const i18n = () => Object.fromEntries(LANGS.map(l => [l, { desc: 'x' }]));
const bundle = (over = {}) => ({
  set: 18,
  champions: many(90, () => ({})),
  traits: many(30, () => ({ names: Object.fromEntries(LANGS.map(l => [l, 'n'])) })),
  augments: many(100, () => ({ i18n: i18n() })),
  items: many(100, () => ({})),
  active: { items: Array(100).fill('x'), augments: Array(100).fill('x') },
  plannerCodes: many(70, () => 1),
  ...over,
});

test('gleich oder wenig kleiner: sauber', () => {
  assert.deepEqual(compareBundles(bundle(), bundle()), []);
  assert.deepEqual(compareBundles(bundle(), bundle({ champions: many(82, () => ({})) })), []);
});

test('deutlich weniger: Befund', () => {
  const [f] = compareBundles(bundle(), bundle({ champions: many(80, () => ({})) }));
  assert.match(f, /champions: 90 → 80/);
});

test('eine Sprache weg faellt auf, auch wenn die Gesamtzahl stimmt', () => {
  const noKo = many(100, () => { const t = i18n(); delete t.ko; return { i18n: t }; });
  const findings = compareBundles(bundle(), bundle({ augments: noKo }));
  assert.deepEqual(findings, ['augment-texte ko: 100 → 0']);
});

test('Set-Wechsel darf kleiner sein, aber nicht leer', () => {
  assert.deepEqual(compareBundles(bundle(), bundle({ set: 19, champions: many(50, () => ({})) })), []);
  assert.equal(compareBundles(bundle(), bundle({ set: 19, champions: {} })).length, 1);
});

test('kaputtes Bundle zaehlt als leer', () => {
  assert.equal(bundleCounts(null).champions, 0);
  assert.ok(compareBundles(bundle(), {}).length > 0);
});
