/**
 * Trait-Detailseite (E4 im SEO-Plan): der Pfad ist je nach Herkunft die
 * Kennung (`DA_18_Elderwood`, Comp-Seiten) oder der Anzeigename (`Elderwood`,
 * Trait-Liste, Unit-Seiten). Beide muessen dieselben Kennungen ergeben — vorher
 * blieben Stufen und Comps beim Anzeigenamen leer, und der Comp-Block traf per
 * Praefix (`DA_18`) alle Traits des Sets. Dazu: Server und Browser lesen die
 * Filter der Detailseiten gleich (sonst laedt der Browser trotz Startdaten nach).
 *
 * Lauf: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  traitIdsForParam, detailFiltersFrom, traitFiltersFrom, detailKey, compDetailKey,
  compsWithItem, compsOfTrait, sharedComponentItems,
} from './tft-detail-filters.ts';

const TRAITS = {
  DA_18_Elderwood: { name: 'Elderwood' },
  DA_18_Arcana: { name: 'Arcana' },
  // Set-17-Fall: mehrere Kennungen, ein Anzeigename.
  TFT17_Stargazer: { name: 'Stargazer' },
  TFT17_Stargazer_Wolf: { name: 'Stargazer' },
};

test('Kennung und Anzeigename fuehren auf dieselben Kennungen', () => {
  const a = traitIdsForParam(TRAITS, 'DA_18_Elderwood');
  const b = traitIdsForParam(TRAITS, 'Elderwood');
  assert.deepEqual(a.ids, ['DA_18_Elderwood']);
  assert.deepEqual(b.ids, ['DA_18_Elderwood']);
  assert.equal(a.display, 'Elderwood');
  assert.equal(b.display, 'Elderwood');
  assert.equal(a.unitCountName, 'DA_18_Elderwood');
  assert.equal(b.unitCountName, 'DA_18_Elderwood');
});

test('Anderer Trait mit gleichem Set-Praefix gehoert nicht dazu', () => {
  assert.ok(!traitIdsForParam(TRAITS, 'Elderwood').ids.includes('DA_18_Arcana'));
});

test('Mehrere Kennungen je Anzeigename: alle, die Pfad-Kennung bleibt die fuer die Kurve', () => {
  const byName = traitIdsForParam(TRAITS, 'Stargazer');
  assert.deepEqual(new Set(byName.ids), new Set(['TFT17_Stargazer', 'TFT17_Stargazer_Wolf']));
  // Anzeigename im Pfad: die Wurzel-Variante wie die Kopfzeile, nicht die erste.
  assert.equal(traitIdsForParam({ TFT17_Stargazer_Wolf: { name: 'Stargazer' }, TFT17_Stargazer: { name: 'Stargazer' } }, 'Stargazer').unitCountName, 'TFT17_Stargazer');
  const byId = traitIdsForParam(TRAITS, 'TFT17_Stargazer_Wolf');
  assert.equal(byId.unitCountName, 'TFT17_Stargazer_Wolf');
  assert.equal(byId.ids.length, 2);
});

test('Ohne Bundle (noch nicht geladen) oder unbekannt: der Pfad selbst', () => {
  assert.deepEqual(traitIdsForParam(null, 'Elderwood'), { display: 'Elderwood', ids: ['Elderwood'], unitCountName: 'Elderwood' });
  assert.deepEqual(traitIdsForParam(TRAITS, 'Nope').ids, ['Nope']);
});

test('Echtes Bundle: jeder Anzeigename und jede Kennung trifft genau die eigene Kennung', () => {
  const bundle = JSON.parse(readFileSync(new URL('../../public/tft-assets.json', import.meta.url), 'utf8'));
  for (const [id, t] of Object.entries(bundle.traits)) {
    if (!t?.name) continue;
    const sameName = Object.keys(bundle.traits).filter(k => bundle.traits[k]?.name === t.name);
    assert.deepEqual(new Set(traitIdsForParam(bundle.traits, t.name).ids), new Set(sameName), t.name);
    assert.deepEqual(new Set(traitIdsForParam(bundle.traits, id).ids), new Set(sameName), id);
  }
});

test('Detail-Filter: Standardwerte wie die Liste, alte Raenge auf die Gruppe', () => {
  assert.deepEqual(detailFiltersFrom(new URLSearchParams('')), { region: 'all', bucket: 'master_plus', days: 3 });
  assert.deepEqual(detailFiltersFrom(new URLSearchParams('bucket=diamond&days=9&region=euw1')), { region: 'euw1', bucket: 'diamond_plus', days: 7 });
  assert.equal(detailFiltersFrom(new URLSearchParams('bucket=quatsch')).bucket, 'master_plus');
  assert.deepEqual(traitFiltersFrom(new URLSearchParams('')), { region: 'all', bucket: 'master_plus' });
  assert.notEqual(detailKey('A', { region: 'all', bucket: 'master_plus', days: 3 }), detailKey('A', { region: 'all', bucket: 'master_plus', days: 7 }));
});

test('Comp-Detail-Schluessel: Adresse ohne Filter = Startdaten-Schluessel, Ansicht zaehlt mit', () => {
  // Server (comp-detail-data.ts) und Browser (CompDetailClient.tsx) bilden ihn
  // aus derselben Adresse; nur bei Gleichheit nimmt die Seite die Startdaten.
  const f = detailFiltersFrom(new URLSearchParams(''));
  const slug = 'DA_18_Executioner@3_DA_18_Azir';
  assert.equal(compDetailKey(slug, f, 'family'), 'DA_18_Executioner@3_DA_18_Azir|all|master_plus|3|family');
  assert.notEqual(compDetailKey(slug, f, 'family'), compDetailKey(slug, f, 'exact'));
  assert.equal(
    compDetailKey(slug, detailFiltersFrom(new URLSearchParams('bucket=diamond')), 'family'),
    compDetailKey(slug, { region: 'all', bucket: 'diamond_plus', days: 3 }, 'family'),
  );
});

// Auswahl aus den Listen-Zeilen: Server und Browser nutzen dieselben
// Funktionen, hier deren Regeln.
const COMPS = [
  { slug: 'a', clusterKey: 'DA_18_Elderwood@5_DA_18_Lulu', typicalUnits: [{ characterId: 'DA_18_Lulu' }], carryItems: [{ items: ['X', 'Y'] }] },
  { slug: 'b', clusterKey: 'DA_18_Arcana@4_DA_18_Ahri', typicalUnits: [{ characterId: 'DA_18_Ahri' }, { characterId: 'DA_18_Lulu' }], carryItems: [{ items: ['Y'] }] },
  { slug: 'c', clusterKey: 'DA_18_Elderwood@7_DA_18_Maokai', typicalUnits: [{ characterId: 'DA_18_Maokai' }] },
];

test('Comps eines Items: alle mit dem Item in den Carry-Items, ohne Kappung', () => {
  assert.deepEqual(compsWithItem(COMPS, 'Y').map(c => c.slug), ['a', 'b']);
  assert.deepEqual(compsWithItem(COMPS, 'Z'), []);
});

test('Comps eines Traits: nur der Haupt-Trait, kein Praefix-Treffer', () => {
  assert.deepEqual(compsOfTrait(COMPS, ['DA_18_Elderwood']).map(c => c.slug), ['a', 'c']);
  assert.deepEqual(compsOfTrait(COMPS, ['DA_18']), []);
});

test('Gleiche Bauteile: aktiv, geteilte Komponente, ohne Corrupted/Platzhalter, nicht das Item selbst', () => {
  const items = {
    A: { name: 'A', icon: null, composition: ['Sword', 'Bow'] },
    B: { name: 'B', icon: null, composition: ['Sword', 'Rod'] },
    B_Corrupted: { name: 'B', icon: null, composition: ['Sword', 'Rod'] },
    C: { name: 'tft_item_name_C', icon: null, composition: ['Bow', 'Rod'] },
    D: { name: 'D', icon: null, composition: ['Rod', 'Tear'] },
    E: { name: 'E', icon: null, composition: ['Bow', 'Tear'] },
  };
  const active = ['A', 'B', 'B_Corrupted', 'C', 'D'];
  assert.deepEqual(sharedComponentItems(items, active, 'A', ['Sword', 'Bow']).map(([k]) => k), ['B']);
  assert.deepEqual(sharedComponentItems(items, active, 'A', []), []);
});
