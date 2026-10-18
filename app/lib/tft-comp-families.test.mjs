import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachPatchDeltas, topFamilyKeys, visibleFamilies, currentSetFamilies, TOP_FAMILY_LIMIT, buildCompFamilies, leanCompRow,
  familyShowsUnit, SHOWN_BOARD_UNITS,
} from './tft-comp-families.ts';
import { compTraitFamilyKey } from './tft-cluster.ts';
import { buildPatchDeltaIndex } from './tft-patch-delta.ts';

const fam = (key, games, extra = {}) => ({
  familyKey: key, trait: 'DA_Trait', carry: 'DA_Carry', carries: [], tanks: [],
  totalGames: games, variants: [], ...extra,
});

// Δ „vs Vorpatch": Cluster-Zeilen beider Patches, Schluessel wie die Liste.
const K1 = 'DA_Trait@6_DA_Carry';
const K2 = 'DA_Trait@8_DA_Carry';
const K3 = 'DA_Other@4_DA_X';
const deltaIndex = (current, previous) => buildPatchDeltaIndex('comp', { patch: '18.4', prev: '18.3' },
  { hasData: true, currentPatch: '18.4', previousPatch: '18.3', current, previous });
const famOf = (k, extra = {}) => fam(compTraitFamilyKey(k), 0, { mainComp: { slug: k }, ...extra });

test('attachPatchDeltas: Familie summiert alle ihre Cluster beider Patches', () => {
  const idx = deltaIndex(
    [{ k: K1, g: 300, a: 4.0 }, { k: K2, g: 100, a: 3.0 }],
    [{ k: K1, g: 200, a: 4.5 }, { k: K2, g: 200, a: 4.0 }],
  );
  const [f] = attachPatchDeltas([famOf(K1, { variants: [{ slug: K1, _clusterKeys: [K1] }, { slug: K2 }] })], idx, false);
  // jetzt (1200+300)/400 = 3,75; vorher (900+800)/400 = 4,25
  assert.ok(Math.abs(f.delta.deltaAvgPlace - -0.5) < 1e-9);
  assert.equal(f.mainComp.delta, f.delta);
  assert.ok(Math.abs(f.variants[0].delta.deltaAvgPlace - -0.5) < 1e-9);
  assert.equal(f.variants[1].delta.deltaAvgPlace, null, 'K2 jetzt unter der Mindestmenge');
});

test('attachPatchDeltas: zusammengelegte Familien zaehlen mit, fremde nicht', () => {
  const idx = deltaIndex(
    [{ k: K1, g: 200, a: 4.0 }, { k: K3, g: 200, a: 2.0 }],
    [{ k: K1, g: 200, a: 4.0 }, { k: K3, g: 200, a: 4.0 }],
  );
  const solo = attachPatchDeltas([famOf(K1)], idx, false)[0];
  assert.equal(solo.delta.deltaAvgPlace, 0);
  const merged = attachPatchDeltas([famOf(K1, { memberKeys: [compTraitFamilyKey(K1), compTraitFamilyKey(K3)] })], idx, false)[0];
  assert.equal(merged.delta.deltaAvgPlace, -1);
});

test('attachPatchDeltas: ohne Daten kein erfundener Pfeil, Sortierung nach Δ mit Luecken hinten', () => {
  const fams = [famOf(K3, { weightedAvgPlacement: 4.1 }), famOf(K1, { weightedAvgPlacement: 4.0 })];
  assert.equal(attachPatchDeltas(fams, null, true), fams);
  const idx = deltaIndex([{ k: K1, g: 200, a: 4.0 }], [{ k: K1, g: 200, a: 4.2 }]);
  const out = attachPatchDeltas(fams, idx, true);
  assert.deepEqual(out.map(f => f.mainComp.slug), [K1, K3]);
  assert.equal(out[1].delta, null);
  assert.equal(fams[1].delta, undefined, 'Eingabe bleibt unveraendert');
});

test('topFamilyKeys waehlt nach Spielen, nicht nach Reihenfolge', () => {
  const fams = Array.from({ length: TOP_FAMILY_LIMIT + 5 }, (_, i) => fam(`f${i}`, i));
  const keys = topFamilyKeys(fams);
  assert.equal(keys.size, TOP_FAMILY_LIMIT);
  assert.ok(keys.has(`f${TOP_FAMILY_LIMIT + 4}`) && !keys.has('f0'));
  assert.equal(topFamilyKeys(fams.slice(0, TOP_FAMILY_LIMIT)), null);
});

test('topFamilyKeys: Gleichstand auf Platz 40/41 haengt nicht an der Eingangsreihenfolge', () => {
  // 39 klar vorne, dann 3 Familien mit gleichen Spielen um 1 Platz.
  const fams = [
    ...Array.from({ length: TOP_FAMILY_LIMIT - 1 }, (_, i) => fam(`top${String(i).padStart(2, '0')}`, 1000 + i)),
    fam('tie_c', 10), fam('tie_a', 10), fam('tie_b', 10),
  ];
  const a = [...topFamilyKeys(fams)].sort();
  const b = [...topFamilyKeys([...fams].reverse())].sort();
  assert.deepEqual(a, b);
  assert.ok(a.includes('tie_a') && !a.includes('tie_b') && !a.includes('tie_c'));
});

test('leanCompRow: laesst Mitspiel-Anteil und altes Trend-Feld weg', () => {
  const row = {
    slug: 'DA_Trait@6_DA_Carry', clusterKey: 'DA_Trait@6_DA_Carry', games: 100,
    typicalUnits: [{ characterId: 'DA_Carry', count: 90, cooccurrence: { DA_X: 0.5 } }],
    velocity: { deltaAvgPlace: -0.12, gamesNow: 80, gamesPrev: 70, avgPlaceNow: 3.9, isNew: false },
  };
  const lean = leanCompRow(row);
  assert.equal('velocity' in lean, false);
  assert.equal('cooccurrence' in lean.typicalUnits[0], false);
  assert.equal(lean.games, 100);
  assert.equal(row.typicalUnits[0].cooccurrence.DA_X, 0.5, 'Eingabe bleibt unveraendert');
  assert.equal(row.velocity.gamesPrev, 70, 'Eingabe bleibt unveraendert');
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

test('Core/Flex: zusammengelegte Variante zaehlt alle Gruppenzeilen, Hauptzeile ihr gezeigtes Board', () => {
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
  // Hauptzeile = gezeigtes Board (hier die zusammengelegte Gruppe mit den
  // meisten Spielen), nicht die Familie (dort waeren A, B und D Flex).
  assert.equal(f.totalGames, 200);
  assert.equal(f.mainComp._mergedFromBuilds?.length, 2);
  assert.deepEqual(f.mainComp.coreFlex, { DA_C: 'core', A: 'flex', B: 'core' });
});

test('familyShowsUnit: nur die meistgespielten Units des gezeigten Bretts zaehlen', () => {
  const units = Array.from({ length: 11 }, (_, i) => ({ characterId: 'U' + i, count: 100 - i }));
  const fam = { mainComp: { typicalUnits: units.slice().reverse() } };
  assert.equal(familyShowsUnit(fam, 'U0'), true);
  assert.equal(familyShowsUnit(fam, 'U' + (SHOWN_BOARD_UNITS - 1)), true);
  assert.equal(familyShowsUnit(fam, 'U' + SHOWN_BOARD_UNITS), false);
  assert.equal(familyShowsUnit({ mainComp: {} }, 'U0'), false);
});
