/**
 * 404-Pruefung der Middleware (not-found-gate.ts).
 *
 * Der teure Fehler ist hier nicht die durchgelassene Muell-Adresse (die zeigt
 * wie bisher eine leere Seite), sondern die echte Seite, die ploetzlich 404
 * antwortet — Google wirft sie dann aus dem Index. Deshalb pruefen die meisten
 * Faelle das Durchlassen.
 *
 * Lauf: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { isUnknownDetailPath, buildLookup } from './not-found-gate.ts';
import known from './known-ids.generated.json' with { type: 'json' };

const unknown = p => isUnknownDetailPath(p);
const enc = s => encodeURIComponent(s);

test('die erzeugte Liste ist nicht leer und kennt das laufende Set', () => {
  assert.ok(known.units.length > 50 && known.items.length > 1000 && known.traits.length > 30 && known.teams.length > 100);
  assert.ok(known.plausiblePrefixes.includes(`TFT${known.currentSet}_`));
  assert.deepEqual(known.staticSegments['tft/comps'], ['atlas', 'community', 'compare'], 'aus app/tft/comps gelesen');
});

test('bekannte Kennungen gehen durch — Units, Items, Traits, Teams', () => {
  assert.equal(unknown('/tft/units/DA_18_Azir'), false);
  assert.equal(unknown('/tft/units/TFT17_Lulu'), false, 'altes Set aus tft-assets-17.json');
  assert.equal(unknown('/tft/items/TFT_Item_InfinityEdge'), false);
  assert.equal(unknown('/tft/traits/DA_18_Elderwood'), false);
  assert.equal(unknown(`/tft/traits/${enc('Elderwood')}`), false, 'Anzeigename aus der Trait-Liste');
  assert.equal(unknown(`/tft/traits/${enc('Apex Predator')}`), false, 'Anzeigename mit Leerzeichen');
  assert.equal(unknown('/teams/100-thieves'), false);
});

test('Comp-Slugs: Grammatik + bekannter Trait/Carry, %40 und %23 kodiert', () => {
  assert.equal(unknown(`/tft/comps/${enc('DA_18_Executioner@3_DA_18_Azir')}`), false);
  assert.equal(unknown(`/tft/comps/${enc('DA_18_Elderwood@8_DA_18_Ahri*3')}`), false);
  assert.equal(unknown(`/tft/comps/${enc('DA_18_Elderwood@8_DA_18_Ahri#DA_18_Azir')}`), false);
  assert.equal(unknown(`/tft/comps/${enc('TFT17_Stargazer@6_TFT17_Lulu*3')}`), false, 'Set 17');
  // unkodiert, wie manche Links es schreiben
  assert.equal(unknown('/tft/comps/DA_18_Executioner@3_DA_18_Azir'), false);
});

test('statische Nachbarn und Listen bleiben unberuehrt', () => {
  for (const p of ['/tft/comps/atlas', '/tft/comps/community', '/tft/comps/compare', '/tft/comps', '/tft/units',
    '/tft/units/', '/teams', '/tft/comps/DA_18_X@3_Fake/opengraph-image', '/tft/augments/Nope']) {
    assert.equal(unknown(p), false, p);
  }
});

test('neue Kennungen des laufenden Sets gehen durch (Item nach B-Patch noch nicht im Bundle)', () => {
  assert.equal(unknown('/tft/items/DA_18_Item_BrandNew'), false);
  assert.equal(unknown('/tft/items/TFT_Item_BrandNew'), false);
  assert.equal(unknown(`/tft/units/TFT${known.currentSet}_NewUnit`), false);
  assert.equal(unknown(`/tft/comps/${enc('DA_18_NewTrait@4_DA_18_NewCarry')}`), false);
});

test('erfundene Adressen → 404', () => {
  assert.equal(unknown('/tft/units/NoSuchUnit123'), true, 'ohne Praefix');
  assert.equal(unknown('/tft/units/TFT16_Ahri'), true, 'altes Set ohne Bundle');
  assert.equal(unknown('/tft/items/TFT17_Item_Fake'), true, 'altes Set, nicht in Bundle 17');
  assert.equal(unknown('/tft/traits/NoSuchTrait'), true);
  assert.equal(unknown(`/tft/traits/${enc('Erfundene Synergie')}`), true);
  assert.equal(unknown(`/tft/comps/${enc('Fake@9_NoSuchUnit')}`), true);
  assert.equal(unknown('/tft/comps/kein-slug'), true, 'falsche Grammatik');
  assert.equal(unknown(`/tft/comps/${enc('DA_18_Elderwood@8_NoSuchUnit')}`), true, 'Carry unbekannt');
  assert.equal(unknown(`/tft/comps/${enc('DA_18_Elderwood@8_DA_18_Ahri#Nope')}`), true, 'zweiter Carry unbekannt');
  assert.equal(unknown('/teams/doesnotexist'), true);
  assert.equal(unknown('/teams/DA_18_Azir'), true, 'Teams ohne Praefix-Ausnahme');
});

test('lesbare Comp-Adressen und Familien-Kennungen (L2)', () => {
  if (known.currentSet !== 18) return; // Namen von Set 18
  assert.equal(unknown('/tft/comps/lunar-aphelios'), false);
  assert.equal(unknown('/tft/comps/Lunar-Aphelios'), false, 'Grossschreibung leitet die Middleware um');
  assert.equal(unknown('/tft/comps/fake-nosuchunit'), true);
  assert.equal(unknown('/tft/comps/lunar-nosuchunit'), true);
  assert.equal(unknown('/tft/comps/DA_18_Lunar__DA_18_Aphelios'), false, 'Familien-Kennung');
  assert.equal(unknown('/tft/comps/DA_18_Lunar__NoSuchUnit'), true);
  // Eigene Pruefung reinreichbar (leere Namenstabelle laesst lesbare Formen durch).
  assert.equal(isUnknownDetailPath('/tft/comps/fake-nosuchunit', undefined, () => true), false);
});

test('kaputte Kodierung → 404 statt Absturz', () => {
  assert.equal(unknown('/tft/units/%E0%A4%A'), true);
  assert.equal(unknown('/tft/comps/%'), true);
  assert.equal(unknown('/teams/%zz'), true);
});

test('leere Liste (fehlt oder kaputt) laesst alles durch', () => {
  const empty = buildLookup({ plausiblePrefixes: [], units: [], items: [], traits: [], teams: [], staticSegments: {} });
  for (const p of ['/tft/units/NoSuchUnit123', '/tft/traits/NoSuchTrait', '/teams/doesnotexist', `/tft/comps/${enc('Fake@9_X')}`]) {
    assert.equal(isUnknownDetailPath(p, empty), false, p);
  }
  // Grammatik bleibt hart: ohne @ nur lesbare Namen, die die Namenstabelle kennt.
  assert.equal(isUnknownDetailPath('/tft/comps/kein-slug', empty), true);
});

test('feste Unterseiten kommen aus der Liste, nicht aus dem Code', () => {
  const l = buildLookup({ ...known, staticSegments: { 'tft/units': ['compare'] } });
  assert.equal(isUnknownDetailPath('/tft/units/compare', l), false, 'neue Unterseite neben [id]');
  assert.equal(isUnknownDetailPath('/tft/comps/atlas', l), true, 'ohne Eintrag kein Freipass');
});

test('Kennung mit der Set-Nummer im Namen gilt als plausibel, auch mit neuem Praefix', () => {
  const set = known.currentSet;
  assert.equal(unknown(`/tft/units/XY_${set}_NewChamp`), false);
  assert.equal(unknown(`/tft/comps/${enc(`XY_${set}_Trait@4_XY_${set}_Carry`)}`), false);
  assert.equal(unknown(`/tft/units/XY_${set - 1}_OldChamp`), true, 'Nummer eines alten Sets');
});
