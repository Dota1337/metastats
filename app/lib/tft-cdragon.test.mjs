// Auswahlliste der Einheiten gegen die echten Bundles. Anlass 2026-10-03:
// Akali und Master Yi standen in Builder und Explorer doppelt, weil die
// Alias-Kopien (TFT18_* → DA_18_*_AD) mitgezaehlt wurden.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tftPlayableChampions } from './tft-cdragon.ts';

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
