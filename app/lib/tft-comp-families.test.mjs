import test from 'node:test';
import assert from 'node:assert/strict';
import {
  familyTrend, topFamilyKeys, visibleFamilies, currentSetFamilies, TOP_FAMILY_LIMIT, buildCompFamilies,
} from './tft-comp-families.ts';

const fam = (key, games, extra = {}) => ({
  familyKey: key, trait: 'DA_Trait', carry: 'DA_Carry', carries: [], tanks: [],
  totalGames: games, variants: [], ...extra,
});
const v = (deltaAvgPlace, gamesNow) => ({ velocity: { deltaAvgPlace, gamesNow } });

test('familyTrend gewichtet das Delta nach Spielen im aktuellen Fenster', () => {
  const f = fam('a', 0, { variants: [v(-0.4, 300), v(0.2, 100)] });
  assert.equal(familyTrend(f), (-0.4 * 300 + 0.2 * 100) / 400);
});

test('familyTrend ignoriert Varianten ohne belastbares Delta', () => {
  const f = fam('a', 0, { variants: [v(null, 500), v(0.3, 50), { velocity: null }, {}] });
  assert.equal(familyTrend(f), 0.3);
});

test('familyTrend ist null ohne Trenddaten — kein erfundener Pfeil', () => {
  assert.equal(familyTrend(fam('a', 0, { variants: [{}, v(null, 10)] })), null);
  assert.equal(familyTrend(fam('a', 0, { variants: [v(0.5, 0)] })), null);
});

test('topFamilyKeys waehlt nach Spielen, nicht nach Reihenfolge', () => {
  const fams = Array.from({ length: TOP_FAMILY_LIMIT + 5 }, (_, i) => fam(`f${i}`, i));
  const keys = topFamilyKeys(fams);
  assert.equal(keys.size, TOP_FAMILY_LIMIT);
  assert.ok(keys.has(`f${TOP_FAMILY_LIMIT + 4}`) && !keys.has('f0'));
  assert.equal(topFamilyKeys(fams.slice(0, TOP_FAMILY_LIMIT)), null);
});

test('visibleFamilies: ohne Suche Top-Schnitt in Eingangsreihenfolge, Suche hebt ihn auf', () => {
  const assets = { traits: { DA_Trait: { name: 'Stargazer' } }, champions: { DA_Carry: { name: 'Lulu' }, DA_X: { name: 'Soraka' } } };
  const fams = [fam('c', 5), fam('a', 50), fam('b', 1, { carries: ['DA_X'] })];
  assert.deepEqual(visibleFamilies(fams, new Set(['a', 'c']), '', assets).map(f => f.familyKey), ['c', 'a']);
  assert.deepEqual(visibleFamilies(fams, new Set(['a']), 'soraka', assets).map(f => f.familyKey), ['b']);
});

test('currentSetFamilies behaelt nur Traits aus dem aktuellen Bundle', () => {
  const assets = { traits: { DA_Trait: {} }, champions: {} };
  const out = currentSetFamilies([fam('a', 1), fam('b', 1, { trait: 'TFT17_Old' })], assets);
  assert.deepEqual(out.map(f => f.familyKey), ['a']);
});

test('Core/Flex: zusammengelegte Variante zaehlt alle Gruppenzeilen, Hauptzeile die ganze Familie', () => {
  const units = (o) => Object.entries(o).map(([characterId, g]) => ({ characterId, count: g, gamesWithUnit: g }));
  const row = (slug, games, u) => ({ slug, clusterKey: slug, games, avgPlacement: 4, top4Rate: 0.5, top1Rate: 0.1, pickRate: 0.01, typicalUnits: units(u) });
  // T@8 und T@9 haben dieselben Units -> eine Variante mit 160 Spielen.
  // B: 60 + 60 von 160 = 75 % -> Core (nur der Anker: 60/100 bzw. 60/160 -> Flex)
  // A: 90 + 20 von 160 = 69 % -> Flex (nur der Anker: 90/100 -> Core)
  const rows = [
    row('DA_T@8_DA_C', 100, { DA_C: 100, A: 90, B: 60 }),
    row('DA_T@9_DA_C', 60, { DA_C: 60, A: 20, B: 60 }),
    row('DA_T@7_DA_C', 40, { DA_C: 40, D: 40 }),
  ];
  const [f] = buildCompFamilies(rows, 'games', null);
  const merged = f.variants.find(v => v._mergedFromBuilds);
  assert.equal(merged.games, 160);
  assert.deepEqual(merged.coreFlex, { DA_C: 'core', A: 'flex', B: 'core' });
  const single = f.variants.find(v => !v._mergedFromBuilds);
  assert.deepEqual(single.coreFlex, { DA_C: 'core', D: 'core' });
  // Familie: 200 Spiele — C 200 Core, A 110 / B 120 / D 40 Flex
  assert.equal(f.totalGames, 200);
  assert.deepEqual(f.mainComp.coreFlex, { DA_C: 'core', A: 'flex', B: 'flex', D: 'flex' });
});
