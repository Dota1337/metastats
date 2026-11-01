import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlayNumbers, releasePatch, unitSeries } from './tft-unit-numbers.mjs';

test('Release-Kennung', () => {
  assert.equal(releasePatch({ release: 'rls-18.6.0.5794736.Set18FullPC.Shipping.pbe' }), '18.6');
  assert.equal(releasePatch({ release: 'irgendwas' }), null);
  assert.equal(releasePatch(null), null);
});

test('Reihen in Textreihenfolge, Skalen-Faktoren raus, gleichbleibende Reihen raus', () => {
  const unit = {
    ability: { desc: '<TFTAttribute attributeID="B"/> <TFTAttribute attributeID="A"/> <TFTAttribute attributeID="C"/>' },
    attributeCalcs: {
      A: { terms: [{ coefficient: [1, 2, 3], scaling: 'AD' }, { coefficient: [9, 9, 9], scaling: 'AP' }] },
      B: { values: [4, 5, 6] },
      C: { terms: [{ coefficient: [7, 8, 9], scaling: 'PhysicalDamageCalc1' }] },
    },
  };
  assert.deepEqual(unitSeries(unit), [[4, 5, 6], [1, 2, 3]]);
  assert.deepEqual(unitSeries({}), []);
});

test('nahe Reihe wird ersetzt, in allen Sprachen', () => {
  const r = overlayNumbers({ en: 'deal 200/300/490 and 10/15/20', de: 'macht 200/300/490 und 10/15/20' }, [[10, 15, 20], [210, 315, 500]]);
  assert.deepEqual(r.text, { en: 'deal 210/315/500 and 10/15/20', de: 'macht 210/315/500 und 10/15/20' });
  assert.deepEqual(r.replaced, [{ from: '200/300/490', to: '210/315/500' }]);
  assert.deepEqual(r.left, []);
});

test('Prozent als Anteil', () => {
  const r = overlayNumbers({ en: 'gain 20%/30%' }, [[0.2, 0.3]]);
  assert.equal(r.text.en, 'gain 20%/30%');
  const pct = overlayNumbers({ en: 'gain 20/30%' }, [[0.22, 0.33]]);
  assert.equal(pct.text.en, 'gain 22/33%');
});

test('zu weit weg: Text bleibt (Alistar 76/137/246 gegen 100/150/225)', () => {
  const r = overlayNumbers({ en: 'deal 76/137/246' }, [[100, 150, 225]]);
  assert.equal(r.text.en, 'deal 76/137/246');
  assert.deepEqual(r.left, ['76/137/246']);
});

test('zwei gleich nahe Kandidaten: Text bleibt', () => {
  const r = overlayNumbers({ en: 'deal 100/200/300' }, [[102, 204, 306], [104, 208, 312]]);
  assert.equal(r.text.en, 'deal 100/200/300');
});

test('exakte Treffer belegen ihre Reihe, die zweite Textreihe bekommt sie nicht', () => {
  const r = overlayNumbers({ en: 'a 100/200/300 b 102/204/306' }, [[102, 204, 306]]);
  assert.equal(r.text.en, 'a 100/200/300 b 102/204/306');
  assert.deepEqual(r.left, ['100/200/300']);
});

test('keine Zahlen von MetaTFT: nichts passiert', () => {
  assert.equal(overlayNumbers({ en: 'deal 1/2/3' }, []).text.en, 'deal 1/2/3');
});
