/**
 * Perfekt getroffen (Comp-Katalog Phase 3): Summen ueber Zeilen mit und ohne
 * bewertete Tage, Schwellen der Anzeige, Zusammenlegen in mergeFamilyRows.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sumPerfect, perfectShare, perfectStats, PERFECT_MIN_BASE, PERFECT_MIN_GAMES } from './tft-comp-perfect.ts';
import { mergeFamilyRows } from './tft-comp-family-merge.ts';

const row = (extra) => ({
  cluster_key: 'DA_T@4_DA_C', games: 300, sum_placement: 1200, top4: 160, top1: 40,
  sum_level: 0, sum_last_round: 0, sum_players_eliminated: 0, sum_gold_left: 0, participants: 1000,
  typical_units_merged: [], typical_augments_merged: [], carry_items_merged: [],
  last_round_dist_merged: null, top4_by_round_merged: null, level_dist_merged: null,
  level_sum_last_round_merged: null, carry_star_dist_merged: null, contested_dist_merged: null,
  bucket_breakdown: null, ...extra,
});
const rated = { perfect_games: 120, perfect_sum_placement: 360, perfect_top4: 90, perfect_top1: 30, perfect_base_games: 200 };

test('sumPerfect: nur bewertete Zeilen zaehlen, sonst null', () => {
  assert.equal(sumPerfect([]), null);
  assert.equal(sumPerfect([row({})]), null); // alte DB-Fassung ohne Spalten
  assert.equal(sumPerfect([row({ perfect_games: null, perfect_base_games: 0 })]), null); // klassische Tage
  const p = sumPerfect([row(rated), row({ perfect_games: null, perfect_base_games: 0 })]);
  assert.deepEqual(p, { games: 120, base: 200, avgPlacement: 3, top4Rate: 0.75, top1Rate: 0.25 });
  // Strings aus der Datenbank (bigint) werden gezaehlt.
  assert.equal(sumPerfect([row({ perfect_games: '5', perfect_sum_placement: '20', perfect_top4: '2', perfect_top1: '1', perfect_base_games: '10' })]).games, 5);
  // Bewertet, aber kein perfektes Spiel: Werte null, Basis bleibt.
  assert.deepEqual(sumPerfect([row({ ...rated, perfect_games: 0, perfect_sum_placement: 0, perfect_top4: 0, perfect_top1: 0 })]),
    { games: 0, base: 200, avgPlacement: null, top4Rate: null, top1Rate: null });
});

test('Anzeige: Anteil ab 100 bewerteten, Werte ab 100 perfekten Spielen, Spiele immer', () => {
  assert.equal(PERFECT_MIN_BASE, 100);
  assert.equal(PERFECT_MIN_GAMES, 100);
  const p = { games: 99, base: 99, avgPlacement: 3.1, top4Rate: 0.7, top1Rate: 0.2 };
  assert.equal(perfectShare(p), null);
  assert.equal(perfectShare({ ...p, base: 100 }), 0.99);
  assert.deepEqual(perfectStats(p), { games: 99, avgPlacement: null, top4Rate: null, top1Rate: null });
  assert.deepEqual(perfectStats({ ...p, games: 100 }), { games: 100, avgPlacement: 3.1, top4Rate: 0.7, top1Rate: 0.2 });
  assert.deepEqual(perfectStats(null), { games: 0, avgPlacement: null, top4Rate: null, top1Rate: null });
});

test('mergeFamilyRows: Perfekt-Zaehler summiert ueber bewertete Zeilen, sonst null', () => {
  const merged = mergeFamilyRows([row(rated), row({ ...rated, cluster_key: 'DA_T@6_DA_C', games: 100 }), row({ cluster_key: 'DA_T@2_DA_C', games: 50, perfect_games: null, perfect_base_games: 0 })]);
  assert.equal(merged.perfect_games, 240);
  assert.equal(merged.perfect_base_games, 400);
  assert.equal(merged.perfect_sum_placement, 720);
  const none = mergeFamilyRows([row({}), row({ cluster_key: 'DA_T@6_DA_C', games: 100 })]);
  assert.equal(none.perfect_games, null);
  assert.equal(sumPerfect([none]), null);
});
