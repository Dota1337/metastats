// Eigentliche Adresse der Item-Seite (itemCanonicalId): gleichnamige
// Augment-/Upgrade-Variante → Grund-Item, alles andere bleibt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { itemCanonicalId } from './tft-item-path.ts';

const items = JSON.parse(readFileSync(new URL('../../public/tft-assets-18.json', import.meta.url), 'utf8')).items;

test('Flora-Emblem aus dem Augment zeigt aufs normale Emblem', () => {
  assert.equal(itemCanonicalId(items, 'DA_18_EmblemFloraFatalisAugment'), 'DA_18_EmblemFloraFatalis');
  assert.equal(itemCanonicalId(items, 'DA_18_EmblemFloraFatalis'), 'DA_18_EmblemFloraFatalis');
});

test('anderer Name oder fehlendes Grund-Item: eigene Adresse', () => {
  const fake = { X_Item: { name: 'Klinge' }, X_ItemAugment: { name: 'Andere Klinge' }, Y_ItemUpgrade: { name: 'Y' } };
  assert.equal(itemCanonicalId(fake, 'X_ItemAugment'), 'X_ItemAugment');
  assert.equal(itemCanonicalId(fake, 'Y_ItemUpgrade'), 'Y_ItemUpgrade');
  assert.equal(itemCanonicalId(fake, 'Unbekannt'), 'Unbekannt');
  assert.equal(itemCanonicalId(null, 'X_ItemAugment'), 'X_ItemAugment');
});

test('echtes Bundle: jedes Ziel existiert und heisst gleich, Ziele sind selbst Grund-Items', () => {
  let mapped = 0;
  for (const id of Object.keys(items)) {
    const target = itemCanonicalId(items, id);
    if (target === id) continue;
    mapped++;
    assert.ok(items[target], `${id} → ${target} fehlt`);
    assert.equal(items[target].name, items[id].name, id);
    assert.equal(itemCanonicalId(items, target), target, `${target} zeigt weiter`);
  }
  assert.ok(mapped > 0);
});
