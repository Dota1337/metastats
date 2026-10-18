// Auswahlliste der Einheiten gegen die echten Bundles. Anlass 2026-10-03:
// Akali und Master Yi standen in Builder und Explorer doppelt, weil die
// Alias-Kopien (TFT18_* → DA_18_*_AD) mitgezaehlt wurden.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tftPlayableChampions, traitTierMinUnits, traitTierLabel } from './tft-cdragon.ts';

const bundle = (n) => JSON.parse(fs.readFileSync(new URL(`../../public/tft-assets-${n}.json`, import.meta.url), 'utf8'));

test('Set 18: keine Alias-Kopie in der Auswahl, Quelle bleibt', () => {
  const ids = tftPlayableChampions(bundle(18)).map((x) => x.id);
  assert.equal(ids.filter((id) => id.startsWith('TFT18_')).length, 0);
  assert.ok(ids.includes('DA_18_Akali_AD'));
  assert.ok(ids.includes('DA_18_MasterYi_AD'));
  assert.equal(new Set(ids).size, ids.length);
});

test('Set 18: die Lux-Formen bleiben einzeln waehlbar', () => {
  // Gleiches Bild, aber eigene Traits — darf NICHT zusammengelegt werden.
  const lux = tftPlayableChampions(bundle(18)).filter((x) => /^Lux\b/.test(x.champion.name));
  assert.equal(lux.length, 10);
});

test('Set 18: Alias-Eintraege bleiben im Bundle (alte Builder-Links)', () => {
  const c = bundle(18).champions;
  assert.equal(c.TFT18_Akali?.aliasOf, 'DA_18_Akali_AD');
  assert.equal(c.TFT18_MasterYi?.aliasOf, 'DA_18_MasterYi_AD');
});

test('Set 17: keine Einheit aus einem fremden Set', () => {
  const ids = tftPlayableChampions(bundle(17)).map((x) => x.id);
  assert.ok(ids.length > 0);
  assert.ok(ids.every((id) => id.startsWith('TFT17_')), ids.filter((id) => !id.startsWith('TFT17_')).join(','));
});

// Trait-Stufe → Unit-Zahl (User 18.10.2026: „7 Riftbeast“ statt „Tier 3“).
// Riots tier_current ist die Stufe; das Bundle kennt die Schwellen je Stufe.
const tierBundle = {
  traits: {
    X_Beast: { name: 'Beast', tiers: [3, 5, 7, 10].map((minUnits) => ({ minUnits, style: 1 })) },
    X_Rival: { name: 'Rival', tiers: [1, 1, 2].map((minUnits) => ({ minUnits, style: 1 })) },
    X_Eclipse: { name: 'Eclipse', tiers: [] },
  },
};

test('Trait-Stufe: Position im Bundle ergibt die Unit-Zahl', () => {
  assert.deepEqual([1, 2, 3, 4].map((n) => traitTierMinUnits(tierBundle, 'X_Beast', n)), [3, 5, 7, 10]);
  assert.equal(traitTierLabel('{n} {trait}', tierBundle, 'X_Beast', 3), '7 Beast');
  assert.equal(traitTierLabel('{n} {trait}', tierBundle, 'x_beast', 4), '10 Beast');
});

test('Trait-Stufe: keine geratene Zahl', () => {
  for (const n of [0, -1, 5, 2.5, NaN]) assert.equal(traitTierMinUnits(tierBundle, 'X_Beast', n), null, String(n));
  assert.equal(traitTierMinUnits(null, 'X_Beast', 3), null);
  assert.equal(traitTierMinUnits(tierBundle, 'X_Unbekannt', 1), null);
  assert.equal(traitTierMinUnits(tierBundle, 'X_Eclipse', 1), null);
  // Rival 1/1/2: Stufe 2 waere ein zweites „1 Rival“.
  assert.deepEqual([1, 2, 3].map((n) => traitTierMinUnits(tierBundle, 'X_Rival', n)), [1, null, 2]);
  assert.equal(traitTierLabel('{n} {trait}', tierBundle, 'X_Rival', 2), null);
});

test('Trait-Stufe: aktuelles Bundle — Schwellen aufsteigend, Lookup nach Position', () => {
  const setNumber = JSON.parse(fs.readFileSync(new URL('../../public/tft-set.json', import.meta.url), 'utf8')).setNumber;
  const b = bundle(setNumber);
  for (const [id, tr] of Object.entries(b.traits)) {
    const mins = (tr.tiers || []).map((x) => x.minUnits);
    assert.deepEqual(mins, [...mins].sort((x, y) => x - y), id);
    mins.forEach((m, i) => {
      const got = traitTierMinUnits(b, id, i + 1);
      assert.ok(got === null || got === m, `${id} Stufe ${i + 1}`);
    });
  }
});
