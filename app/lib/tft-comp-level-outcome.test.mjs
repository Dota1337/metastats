/**
 * Regressionstests für den LevelOutcome-Block der Comp-Detail-Page.
 *
 * Warum ausgerechnet hier: Dieser Block ist die Pflicht-Mitigation zur
 * Option-C-Konsolidierung — er ist der EINZIGE verbliebene Pfad, auf dem ein
 * Spieler sieht, dass eine Comp auf 6er-Aktivierung S-Tier ist, während der
 * Familien-Schnitt sie mittelmäßig aussehen lässt. Fällt er still aus (Filter
 * zu scharf, Level aus dem falschen Feld, Anteile gegen den falschen Nenner),
 * verschwindet genau die Information, für die er gebaut wurde.
 *
 * Der Aktivierungs-Level kommt aus dem `@N` im cluster_key, NICHT aus
 * level_dist (das trägt das Spieler-Endlevel). Diese Verwechslung ist die
 * naheliegendste falsche Reparatur und steht deshalb als eigener Test.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { buildLevelOutcome } from './tft-comp-level-outcome.ts';

const row = (cluster_key, games, over = {}) => ({
  cluster_key,
  games,
  sum_placement: Number(games) * 4,
  top4: Number(games) / 2,
  top1: Number(games) / 8,
  sum_level: 0,
  sum_last_round: 0,
  sum_players_eliminated: 0,
  sum_gold_left: 0,
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

test('aggregiert je Aktivierungs-Level und sortiert aufsteigend', () => {
  const out = buildLevelOutcome([
    row('TFT17_Stargazer@6_TFT17_Lulu', 900),
    row('TFT17_Stargazer@4_TFT17_Lulu', 600),
    row('TFT17_Stargazer@6_TFT17_Lulu*3', 300),
  ]);
  assert.deepEqual(out.map(r => r.level), [4, 6], 'aufsteigend = Power-Curve-Leserichtung');
  assert.equal(out.find(r => r.level === 6).games, 1200, 'gleiche Aktivierung wird zusammengezogen');
  const shares = out.reduce((s, r) => s + r.share, 0);
  assert.ok(Math.abs(shares - 1) < 1e-9, `Anteile summieren auf ${shares}`);
});

test('Sub-Cluster unter der Mindestgröße fallen raus — auch aus dem Nenner', () => {
  // Der subtile Teil: ein ausgefilterter Sub-Cluster darf den Anteils-Nenner
  // nicht mehr erhöhen, sonst summieren sich die Anteile auf < 1 und die
  // Level-Verteilung sieht künstlich flach aus.
  const out = buildLevelOutcome([
    row('TFT17_Stargazer@6_TFT17_Lulu', 900),
    row('TFT17_Stargazer@2_TFT17_Lulu', 29),
  ]);
  assert.deepEqual(out.map(r => r.level), [6]);
  assert.equal(out[0].share, 1);
});

test('Mindestgröße ist parametrisierbar', () => {
  const members = [row('TFT17_Stargazer@6_TFT17_Lulu', 40), row('TFT17_Stargazer@4_TFT17_Lulu', 35)];
  assert.equal(buildLevelOutcome(members, 38).length, 1);
  assert.equal(buildLevelOutcome(members, 30).length, 2);
});

test('leere oder komplett ausgefilterte Eingabe liefert eine leere Liste', () => {
  assert.deepEqual(buildLevelOutcome([]), []);
  assert.deepEqual(buildLevelOutcome([row('TFT17_Stargazer@6_TFT17_Lulu', 5)]), []);
});

test('unparsebare Cluster-Keys werden übersprungen statt als Level 0 geführt', () => {
  const out = buildLevelOutcome([
    row('kaputt-ohne-at', 900),
    row('TFT17_Stargazer@0_TFT17_Lulu', 900),
    row('TFT17_Stargazer@6_TFT17_Lulu', 900),
  ]);
  assert.deepEqual(out.map(r => r.level), [6]);
  assert.equal(out[0].share, 1);
});

test('star3Games zählt nur die *3-Sub-Cluster des Levels', () => {
  const out = buildLevelOutcome([
    row('TFT17_Stargazer@6_TFT17_Lulu', 900),
    row('TFT17_Stargazer@6_TFT17_Lulu*3', 300),
    row('TFT17_Stargazer@6_TFT17_Lulu*2', 200),
  ]);
  assert.equal(out[0].games, 1400);
  assert.equal(out[0].star3Games, 300);
});

test('Raten werden gegen die Level-Spiele gerechnet, nicht gegen die Familie', () => {
  const out = buildLevelOutcome([
    row('TFT17_Stargazer@6_TFT17_Lulu', 1000, { sum_placement: 2170, top4: 900, top1: 300 }),
    row('TFT17_Stargazer@4_TFT17_Lulu', 1000, { sum_placement: 5000, top4: 400, top1: 80 }),
  ]);
  const six = out.find(r => r.level === 6);
  assert.ok(Math.abs(six.avgPlacement - 2.17) < 1e-9);
  assert.ok(Math.abs(six.top4Rate - 0.9) < 1e-9);
  assert.ok(Math.abs(six.top1Rate - 0.3) < 1e-9);
});

test('bigint-Strings aus Supabase werden numerisch gerechnet', () => {
  const out = buildLevelOutcome([
    row('TFT17_Stargazer@6_TFT17_Lulu', '900', { sum_placement: '3600', top4: '450', top1: '100' }),
    row('TFT17_Stargazer@6_TFT17_Lulu*3', '300', { sum_placement: '900', top4: '270', top1: '90' }),
  ]);
  assert.equal(out[0].games, 1200);
  assert.ok(Math.abs(out[0].avgPlacement - 3.75) < 1e-9);
});

test('typicalUnits: Nicht-Champions raus, Cooccurrence gegen die Level-Spiele', () => {
  const out = buildLevelOutcome([
    row('TFT17_Stargazer@6_TFT17_Lulu', 1000, {
      typical_units_merged: [[
        { characterId: 'TFT17_Lulu', count: 950, topItems: [{ apiName: 'TFT_Item_InfinityEdge', count: 800 }] },
        { characterId: 'TFT17_Vex', count: 600 },
        { characterId: 'TFT_TrainingDummy', count: 900 },
        { characterId: 'TFT_BlueGolem', count: 900 },
      ]],
    }),
  ]);
  const ids = out[0].typicalUnits.map(u => u.characterId);
  assert.deepEqual(ids, ['TFT17_Lulu', 'TFT17_Vex']);
  assert.ok(Math.abs(out[0].typicalUnits[0].cooccurrence - 0.95) < 1e-9);
  assert.deepEqual(out[0].typicalUnits[0].topItems, [{ apiName: 'TFT_Item_InfinityEdge', count: 800 }]);
});

test('typicalUnits: Einheiten unter 15 % Cooccurrence fallen raus', () => {
  const out = buildLevelOutcome([
    row('TFT17_Stargazer@6_TFT17_Lulu', 1000, {
      typical_units_merged: [[
        { characterId: 'TFT17_Lulu', count: 950 },
        { characterId: 'TFT17_Vex', count: 149 },
      ]],
    }),
  ]);
  assert.deepEqual(out[0].typicalUnits.map(u => u.characterId), ['TFT17_Lulu']);
});

test('typicalUnits: Counts werden über Sub-Cluster desselben Levels gemergt und auf 9 gekappt', () => {
  const many = (offset) => Array.from({ length: 12 }, (_, i) => ({
    characterId: `TFT17_Unit${String.fromCharCode(65 + i)}`,
    count: 900 - i * 10 + offset,
  }));
  const out = buildLevelOutcome([
    row('TFT17_Stargazer@6_TFT17_Lulu', 600, { typical_units_merged: [many(0)] }),
    row('TFT17_Stargazer@6_TFT17_Lulu*3', 400, { typical_units_merged: [many(0)] }),
  ]);
  assert.equal(out[0].typicalUnits.length, 9);
  assert.equal(out[0].typicalUnits[0].count, 1800, 'Counts beider Sub-Cluster addiert');
  const counts = out[0].typicalUnits.map(u => u.count);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), 'absteigend nach count');
});

test('Property: Anteile summieren auf 1, Raten bleiben in [0,1]', () => {
  const arbSpec = fc.record({
    level: fc.integer({ min: 1, max: 9 }),
    star: fc.integer({ min: 2, max: 3 }),
    games: fc.integer({ min: 1, max: 40000 }),
  });
  fc.assert(fc.property(fc.array(arbSpec, { minLength: 1, maxLength: 15 }), (specs) => {
    const members = specs.map((s, i) => row(
      `TFT17_Stargazer@${s.level}_TFT17_Lulu*${s.star}#TFT17_Vex${i}`,
      s.games,
      { sum_placement: s.games * 4.5, top4: Math.floor(s.games * 0.5), top1: Math.floor(s.games * 0.12) },
    ));
    const out = buildLevelOutcome(members);
    if (out.length === 0) return;
    const shareSum = out.reduce((t, r) => t + r.share, 0);
    assert.ok(Math.abs(shareSum - 1) < 1e-9, `Anteilssumme ${shareSum}`);
    for (const r of out) {
      assert.ok(r.top4Rate >= 0 && r.top4Rate <= 1, `top4Rate ${r.top4Rate}`);
      assert.ok(r.top1Rate >= 0 && r.top1Rate <= 1, `top1Rate ${r.top1Rate}`);
      assert.ok(r.avgPlacement > 0 && r.avgPlacement <= 8, `avgPlacement ${r.avgPlacement}`);
      assert.ok(r.star3Games <= r.games);
      assert.ok(Number.isInteger(r.level) && r.level > 0);
    }
    assert.deepEqual(out.map(r => r.level), [...out.map(r => r.level)].sort((a, b) => a - b));
  }), { numRuns: 1500 });
});
