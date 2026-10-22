import test from 'node:test';
import assert from 'node:assert/strict';
import { ADV_DEFAULT, advFromUrlParam, advToUrlParam, applyAdvancedFilters } from './tft-comp-adv-filters.ts';
import { buildCompFamilies, familyCost, topFamilyKeys, TOP_FAMILY_LIMIT } from './tft-comp-families.ts';

const units = (o) => Object.entries(o).map(([characterId, g]) => ({ characterId, count: g, gamesWithUnit: g }));
const row = (slug, games, avgPlacement, more = {}) => ({
  slug, clusterKey: slug, games, avgPlacement, top4Rate: 0.5, top1Rate: 0.1, pickRate: games / 10000,
  typicalUnits: units({ DA_C: games }), ...more,
});
const fam = (key, extra = {}) => ({
  familyKey: key, trait: 'DA_T', carry: 'DA_C', carries: [], tanks: [], variants: [],
  totalGames: 500, familyPickRate: 0.01, weightedAvgPlacement: 4.0, weightedTop4Rate: 0.55, weightedTop1Rate: 0.15, ...extra,
});

test('Spiele ≥: zaehlt die ganze Comp, nicht die groesste Zeile', () => {
  const families = buildCompFamilies([row('DA_J@2_DA_C', 150, 4.3), row('DA_J@3_DA_C', 120, 4.2)], 'avg', null);
  assert.equal(families.length, 1);
  const out = applyAdvancedFilters(families, { ...ADV_DEFAULT, gamesMin: 200 }, null);
  assert.equal(out.length, 1, 'keine Zeile hat 200 Spiele, die Comp hat 270');
  assert.equal(out[0].totalGames, 270);
});

test('Ø max: eine starke Zeile macht eine schwache Comp nicht zum Treffer', () => {
  const families = buildCompFamilies([row('DA_E@4_DA_C', 300, 3.0), row('DA_E@6_DA_C', 2000, 4.7)], 'avg', null);
  // (300·3,0 + 2000·4,7) / 2300 ≈ 4,48
  assert.ok(families[0].weightedAvgPlacement > 4.4);
  assert.equal(applyAdvancedFilters(families, { ...ADV_DEFAULT, avgPlaceMax: 4.4 }, null).length, 0);
});

test('Grenzwerte am angezeigten Wert (Ø 2 Stellen, Top 4/Sieg ganze Prozent)', () => {
  const at = (extra, f) => applyAdvancedFilters([fam('x', extra)], { ...ADV_DEFAULT, ...f }, null).length;
  assert.equal(at({ weightedAvgPlacement: 4.254 }, { avgPlaceMax: 4.25 }), 1, 'zeigt 4,25');
  assert.equal(at({ weightedAvgPlacement: 4.256 }, { avgPlaceMax: 4.25 }), 0, 'zeigt 4,26');
  assert.equal(at({ weightedTop4Rate: 0.546 }, { top4MinPct: 55 }), 1, 'zeigt 55 %');
  assert.equal(at({ weightedTop4Rate: 0.544 }, { top4MinPct: 55 }), 0, 'zeigt 54 %');
  assert.equal(at({ weightedTop1Rate: 0.175 }, { top1MinPct: 18 }), 1, 'zeigt 18 %');
  assert.equal(at({ familyPickRate: null }, { pickMaxPct: 1 }), 1, 'ohne Pick zaehlt das Kriterium nicht');
  assert.equal(at({ weightedAvgPlacement: null }, { avgPlaceMax: 9 }), 0, 'ohne Ø kein Treffer');
});

test('ohne aktiven Filter: dieselbe Liste', () => {
  const list = [fam('a'), fam('b')];
  assert.equal(applyAdvancedFilters(list, ADV_DEFAULT, null), list);
});

test('Filter vor dem Schnitt auf 40: Treffer jenseits von Platz 40 bleiben', () => {
  const list = Array.from({ length: TOP_FAMILY_LIMIT + 5 }, (_, i) =>
    fam(`f${String(i).padStart(2, '0')}`, { totalGames: 10000 - i, familyPickRate: i >= TOP_FAMILY_LIMIT ? 0.01 : 0.2 }));
  const hits = applyAdvancedFilters(list, { ...ADV_DEFAULT, pickMaxPct: 5 }, null);
  assert.equal(hits.length, 5);
  assert.equal(topFamilyKeys(hits), null, 'unter 40 Treffern kein weiterer Schnitt');
});

// Kosten: erster genannter Carry, ausser ein genannter 1–3-Kosten-Carry wird
// ueberwiegend auf 3 Sternen gespielt (rerollPlan).
const assets = { traits: {}, champions: { DA_Alune: { cost: 5 }, DA_Veigar: { cost: 1 }, DA_Kayle: { cost: 2 } } };
const twoCarry = (star3) => fam('DA_S__DA_Alune', {
  carry: 'DA_Alune', carries: ['DA_Alune', 'DA_Veigar'],
  variants: [{ typicalUnits: [
    { characterId: 'DA_Alune', count: 100, gamesWithUnit: 100, star3Games: 0 },
    { characterId: 'DA_Veigar', count: 100, gamesWithUnit: 100, star3Games: star3 },
  ] }],
});

test('familyCost: 3-Sterne-Reroll-Carry hinter einem teureren Carry bestimmt die Kosten', () => {
  assert.equal(familyCost(twoCarry(98), assets), 1);
  assert.equal(familyCost(twoCarry(10), assets), 5, 'ohne 3 Sterne: erster genannter Carry');
  const cost = (star3, costGroup) => applyAdvancedFilters([twoCarry(star3)], { ...ADV_DEFAULT, costGroup }, assets).length;
  assert.equal(cost(98, 'reroll'), 1);
  assert.equal(cost(98, 'fast8'), 0, 'eine Comp steht in genau einer Kostengruppe');
  assert.equal(cost(10, 'fast8'), 1);
  assert.equal(cost(98, 'reroll') + cost(98, 'mid') + cost(98, 'fast8'), 1);
});

test('familyCost: ohne Kosten im Bundle in keiner Kostengruppe', () => {
  const f = fam('DA_S__DA_X', { carry: 'DA_X', carries: ['DA_X'] });
  assert.equal(familyCost(f, assets), null);
  for (const costGroup of ['reroll', 'mid', 'fast8']) {
    assert.equal(applyAdvancedFilters([f], { ...ADV_DEFAULT, costGroup }, assets).length, 0);
  }
  assert.equal(applyAdvancedFilters([f], { ...ADV_DEFAULT, costGroup: 'reroll' }, null).length, 0, 'ohne Bundle kein Treffer');
});

test('Adresse: Format unveraendert', () => {
  const f = { ...ADV_DEFAULT, avgPlaceMax: 4.4, pickMaxPct: 5, gamesMin: 200, costGroup: 'reroll' };
  assert.equal(advToUrlParam(f), 'avgMax=4.4_pickMax=5_gamesMin=200_cost=reroll');
  assert.deepEqual(advFromUrlParam('avgMax=4.4_pickMax=5_gamesMin=200_cost=reroll'), f);
  assert.equal(advToUrlParam(ADV_DEFAULT), null);
});
