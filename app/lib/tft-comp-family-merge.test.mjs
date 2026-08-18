/**
 * Regressionstests für den Family-Merge der Comp-Detail-Page.
 *
 * Warum ausgerechnet hier: Dieses Modul setzt den User-Entscheid vom
 * 2026-06-21 (Option C) mechanisch um — Level UND Augment werden auf
 * `<trait>__<carry>` konsolidiert. Wer die Familien-Identität versehentlich
 * enger schneidet, zerlegt das Listing wieder in Sub-Cluster; wer sie weiter
 * schneidet, mischt fremde Comps zusammen. Beides sieht in der UI aus wie
 * „andere Zahlen", nicht wie ein Fehler.
 *
 * Zweite Fehlerklasse, die hier scharf ist: Supabase liefert `bigint`-Spalten
 * als STRING. `games` als '900' vs 1000 sortiert lexikografisch falsch und
 * summiert per + zu '9001000'. Genau dafür steht überall `Number(...)` — die
 * Tests fixieren das, statt darauf zu vertrauen.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  familyKeyForMerge,
  selectFamilyMembers,
  mergeFamilyRows,
  applyAnchorMultiplicity,
} from './tft-comp-family-merge.ts';

const row = (cluster_key, games, over = {}) => ({
  cluster_key,
  games,
  sum_placement: Number(games) * 4,
  top4: Math.round(Number(games) / 2),
  top1: Math.round(Number(games) / 8),
  sum_level: Number(games) * 8,
  sum_last_round: Number(games) * 30,
  sum_players_eliminated: Number(games),
  sum_gold_left: Number(games) * 3,
  participants: 100000,
  typical_units_merged: [[{ characterId: 'TFT17_Lulu', count: Number(games) }]],
  typical_augments_merged: [],
  carry_items_merged: [],
  last_round_dist_merged: null,
  top4_by_round_merged: null,
  level_dist_merged: null,
  level_sum_last_round_merged: null,
  carry_star_dist_merged: null,
  contested_dist_merged: null,
  bucket_breakdown: null,
  ...over,
});

test('Familien-Identität konsolidiert Level, Star, Augment und Secondary', () => {
  // Der kanonische Fall aus dem User-Entscheid: Stargazer-Mountain-Lulu hatte
  // real 11 Sub-Cluster und gehört in EINE Familie.
  const keys = [
    'TFT17_Stargazer@4_TFT17_Lulu',
    'TFT17_Stargazer@6_TFT17_Lulu',
    'TFT17_Stargazer@6_TFT17_Lulu*3',
    'TFT17_Stargazer@6_TFT17_Lulu~TwoTanky',
    'TFT17_Stargazer@6_TFT17_Lulu*3~TwoTanky#TFT17_Vex',
  ];
  const families = new Set(keys.map(familyKeyForMerge));
  assert.equal(families.size, 1);
  assert.equal([...families][0], 'TFT17_Stargazer__TFT17_Lulu');
});

test('anderer Carry oder anderes Trait ist eine andere Familie', () => {
  assert.notEqual(
    familyKeyForMerge('TFT17_Stargazer@6_TFT17_Lulu'),
    familyKeyForMerge('TFT17_Stargazer@6_TFT17_Vex'),
  );
  assert.notEqual(
    familyKeyForMerge('TFT17_Stargazer@6_TFT17_Lulu'),
    familyKeyForMerge('TFT17_GravesTrait@6_TFT17_Lulu'),
  );
});

test('unparsebarer Key wird unverändert durchgereicht statt zu werfen', () => {
  assert.equal(familyKeyForMerge('kaputt'), 'kaputt');
  assert.equal(familyKeyForMerge(''), '');
});

test('selectFamilyMembers sammelt Geschwister und sortiert nach games desc', () => {
  const rows = [
    row('TFT17_Stargazer@4_TFT17_Lulu', 300),
    row('TFT17_GravesTrait@6_TFT17_Vex', 9999),
    row('TFT17_Stargazer@6_TFT17_Lulu*3', 1200),
    row('TFT17_Stargazer@6_TFT17_Lulu~TwoTanky', 700),
  ];
  const members = selectFamilyMembers(rows, 'TFT17_Stargazer@6_TFT17_Lulu*3');
  assert.deepEqual(members.map(r => r.games), [1200, 700, 300]);
});

test('games als bigint-String sortiert numerisch, nicht lexikografisch', () => {
  const rows = [
    row('TFT17_Stargazer@4_TFT17_Lulu', '900'),
    row('TFT17_Stargazer@6_TFT17_Lulu', '1000'),
  ];
  const members = selectFamilyMembers(rows, 'TFT17_Stargazer@4_TFT17_Lulu');
  assert.deepEqual(members.map(r => r.games), ['1000', '900'], "'1000' muss vor '900' stehen");
});

test('mergeFamilyRows summiert Zähler und rechnet bigint-Strings sauber', () => {
  const merged = mergeFamilyRows([
    row('TFT17_Stargazer@6_TFT17_Lulu', '1000'),
    row('TFT17_Stargazer@4_TFT17_Lulu', '500'),
  ]);
  assert.equal(merged.games, 1500);
  assert.equal(typeof merged.games, 'number');
  assert.equal(merged.sum_placement, 6000);
  assert.equal(merged.top4, 750);
});

test('Anker ist der games-stärkste Sub-Cluster, auch bei unsortierter Eingabe', () => {
  const merged = mergeFamilyRows([
    row('TFT17_Stargazer@4_TFT17_Lulu', 300),
    row('TFT17_Stargazer@6_TFT17_Lulu*3', 1200),
    row('TFT17_Stargazer@6_TFT17_Lulu', 700),
  ]);
  assert.equal(merged.cluster_key, 'TFT17_Stargazer@6_TFT17_Lulu*3');
});

test('participants ist ein Fenster-Total und wird NICHT summiert', () => {
  // Würde es summiert, wäre die Pick-Rate der Familie durch ein Vielfaches der
  // echten Spielerzahl geteilt — die Comp sähe drei Mal seltener aus.
  const merged = mergeFamilyRows([
    row('TFT17_Stargazer@6_TFT17_Lulu', 1000),
    row('TFT17_Stargazer@4_TFT17_Lulu', 500),
    row('TFT17_Stargazer@2_TFT17_Lulu', 100),
  ]);
  assert.equal(merged.participants, 100000);
});

test('ein einzelner Member wird unverändert zurückgegeben', () => {
  const single = row('TFT17_Stargazer@6_TFT17_Lulu', 1000);
  assert.equal(mergeFamilyRows([single]), single);
});

test('leere Member-Liste wirft laut, statt einen leeren Row zu erfinden', () => {
  assert.throws(() => mergeFamilyRows([]), /empty member list/);
});

test('JSONB-Arrays werden flach konkateniert, durchgehend leere bleiben null', () => {
  const a = row('TFT17_Stargazer@6_TFT17_Lulu', 1000, {
    typical_units_merged: [[{ characterId: 'TFT17_Lulu', count: 900 }], [{ characterId: 'TFT17_Vex', count: 400 }]],
    carry_star_dist_merged: [{ 3: 500 }],
  });
  const b = row('TFT17_Stargazer@4_TFT17_Lulu', 500, {
    typical_units_merged: [[{ characterId: 'TFT17_Lulu', count: 480 }]],
    carry_star_dist_merged: [{ 2: 400 }],
  });
  const merged = mergeFamilyRows([a, b]);
  assert.equal(merged.typical_units_merged.length, 3, 'innere Arrays bleiben getrennt, werden nicht verschachtelt');
  assert.ok(merged.typical_units_merged.every(Array.isArray));
  assert.deepEqual(merged.carry_star_dist_merged, [{ 3: 500 }, { 2: 400 }]);
  assert.equal(merged.level_dist_merged, null, 'nirgends vorhanden → null, nicht []');
});

test('bucket_breakdown wird pro Bucket summiert', () => {
  const merged = mergeFamilyRows([
    row('TFT17_Stargazer@6_TFT17_Lulu', 1000, {
      bucket_breakdown: { master: { games: 600, sum_placement: 2400 }, diamond: { games: 400, sum_placement: 1800 } },
    }),
    row('TFT17_Stargazer@4_TFT17_Lulu', 500, {
      bucket_breakdown: { master: { games: 500, sum_placement: 2100 } },
    }),
  ]);
  assert.deepEqual(merged.bucket_breakdown, {
    master: { games: 1100, sum_placement: 4500 },
    diamond: { games: 400, sum_placement: 1800 },
  });
});

test('bucket_breakdown-Merge mutiert die Eingabe-Rows nicht', () => {
  const a = row('TFT17_Stargazer@6_TFT17_Lulu', 1000, {
    bucket_breakdown: { master: { games: 600, sum_placement: 2400 } },
  });
  const b = row('TFT17_Stargazer@4_TFT17_Lulu', 500, {
    bucket_breakdown: { master: { games: 500, sum_placement: 2100 } },
  });
  mergeFamilyRows([a, b]);
  assert.deepEqual(a.bucket_breakdown.master, { games: 600, sum_placement: 2400 });
});

test('Property: Spielsumme bleibt erhalten, Schnitt bleibt im Korridor der Members', () => {
  const arbMember = fc.record({
    level: fc.integer({ min: 1, max: 9 }),
    games: fc.integer({ min: 1, max: 50000 }),
    avg: fc.double({ min: 1, max: 8, noNaN: true }),
  });
  fc.assert(fc.property(fc.array(arbMember, { minLength: 2, maxLength: 12 }), (specs) => {
    const members = specs.map((s, i) => row(`TFT17_Stargazer@${s.level}_TFT17_Lulu*${(i % 2) + 2}`, s.games, {
      sum_placement: s.games * s.avg,
    }));
    const merged = mergeFamilyRows(members);
    const totalGames = specs.reduce((t, s) => t + s.games, 0);
    assert.equal(merged.games, totalGames);
    const mergedAvg = merged.sum_placement / merged.games;
    const avgs = specs.map(s => s.avg);
    assert.ok(mergedAvg >= Math.min(...avgs) - 1e-9 && mergedAvg <= Math.max(...avgs) + 1e-9,
      `gewichteter Schnitt ${mergedAvg} außerhalb [${Math.min(...avgs)}, ${Math.max(...avgs)}]`);
  }), { numRuns: 1500 });
});

/* ---- applyAnchorMultiplicity (2026-08-18) --------------------------------
 * `multiplicity` ist das einzige Unit-Feld, das eine Struktur-Eigenschaft der
 * Variante beschreibt („zwei Ornn?") und keine Rate. Der Family-Merge verduennt
 * es messbar unter die 1,5-Schwelle des ×2-Abzeichens (Live gemessen: Ornn
 * 1,94 im Anker, 1,44 nach Family-Merge), waehrend die Listen-Card denselben
 * Anker-Wert zeigt. Diese Tests fixieren, dass beide Flaechen dieselbe Zahl
 * nennen — und dass die Uebernahme nicht mehr anfasst als dieses eine Feld.
 */

test('Anker-Multiplizitaet ersetzt den verduennten Family-Wert', () => {
  const units = [{ characterId: 'TFT17_Ornn', count: 100, multiplicity: 1.44 }];
  applyAnchorMultiplicity(units, [{ characterId: 'TFT17_Ornn', multiplicity: 1.94 }]);
  assert.equal(units[0].multiplicity, 1.94);
});

test('Units, die der Anker nicht kennt, verlieren das Feld statt eine fremde Bezugsmenge zu behalten', () => {
  const units = [{ characterId: 'TFT17_Teemo', count: 10, multiplicity: 1.6 }];
  applyAnchorMultiplicity(units, [{ characterId: 'TFT17_Ornn', multiplicity: 1.94 }]);
  assert.equal('multiplicity' in units[0], false);
});

test('Anker ohne Doppel-Units loescht das Feld — kein stilles Weiterreichen', () => {
  const units = [{ characterId: 'TFT17_Ornn', count: 100, multiplicity: 1.44 }];
  applyAnchorMultiplicity(units, [{ characterId: 'TFT17_Ornn', count: 50 }]);
  assert.equal('multiplicity' in units[0], false);
});

test('alle uebrigen Unit-Felder bleiben unangetastet', () => {
  const units = [{ characterId: 'TFT17_Ornn', count: 100, gamesWithUnit: 90, topItems: [{ apiName: 'X' }] }];
  applyAnchorMultiplicity(units, [{ characterId: 'TFT17_Ornn', multiplicity: 2 }]);
  assert.deepEqual(units[0], {
    characterId: 'TFT17_Ornn', count: 100, gamesWithUnit: 90, topItems: [{ apiName: 'X' }], multiplicity: 2,
  });
});

test('leere Anker-Liste ist kein Absturz und laesst nichts Falsches stehen', () => {
  const units = [{ characterId: 'TFT17_Ornn', multiplicity: 1.44 }, null];
  applyAnchorMultiplicity(units, []);
  assert.equal('multiplicity' in units[0], false);
});
