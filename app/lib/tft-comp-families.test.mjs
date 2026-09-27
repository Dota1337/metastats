import test from 'node:test';
import assert from 'node:assert/strict';
import {
  familyTrend, topFamilyKeys, visibleFamilies, currentSetFamilies, TOP_FAMILY_LIMIT,
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
