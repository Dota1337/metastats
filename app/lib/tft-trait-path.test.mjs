// Trait-Links nennen dieselbe Adresse wie das canonical der Seite: den
// englischen Anzeigenamen, nie die Kennung (Search Console 09.11.2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { traitPath, traitDisplayParam } from './tft-trait-path.ts';

const traits = JSON.parse(readFileSync(new URL('../../public/tft-assets-18.json', import.meta.url), 'utf8')).traits;

test('Kennung und Anzeigename landen auf derselben Adresse', () => {
  assert.equal(traitPath(traits, 'DA_18_Elderwood'), '/tft/traits/Elderwood');
  assert.equal(traitPath(traits, 'Elderwood'), '/tft/traits/Elderwood');
  assert.equal(traitDisplayParam(traits, 'DA_18_Defender'), 'Defender');
});

test('Namen mit Leer- oder Sonderzeichen werden kodiert, Unbekanntes bleibt', () => {
  assert.equal(traitPath({ X: { name: 'Flora Fatalis' } }, 'X'), '/tft/traits/Flora%20Fatalis');
  assert.equal(traitPath(null, 'DA_18_Elderwood'), '/tft/traits/DA_18_Elderwood');
});

test('jede Trait-Kennung des Bundles ergibt die Adresse ihres Namens', () => {
  for (const [id, t] of Object.entries(traits)) {
    if (!t?.name) continue;
    assert.equal(traitPath(traits, id), traitPath(traits, t.name), id);
  }
});
