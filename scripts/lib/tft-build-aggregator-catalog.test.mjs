/**
 * Sammler mit Comp-Katalog (Phase 2, 0101): je Brett die Katalog-Comp, Perfekt-
 * Zaehler, umkaempft/Paare/Duelle je Comp, Schattenzaehlung klassisch.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateMatch, emptyAggregate, finalize } from './tft-build-aggregator.mjs';
import { assignBoard, compClusterKey } from '../../app/lib/tft-comp-catalog.mjs';

const A = { key: 'DA_18_Spell__DA_18_Veigar', core: ['DA_18_Veigar', 'DA_18_LeBlanc', 'DA_18_Ornn', 'DA_18_RekSai'], reroll: ['DA_18_Veigar', 'DA_18_LeBlanc'], carries: ['DA_18_Veigar'], targetLevel: null, members: ['DA_18_Spell__DA_18_Veigar'], adopted: [], games: 1000 };
const B = { key: 'DA_18_Adaptor__DA_18_Aphelios', core: ['DA_18_Aphelios', 'DA_18_Nidalee', 'DA_18_Taric', 'DA_18_Ivern'], reroll: [], carries: ['DA_18_Aphelios'], targetLevel: null, members: ['DA_18_Adaptor__DA_18_Aphelios'], adopted: [], games: 900 };
const CATALOG = { version: 1, comps: [A, B] };

const unit = (id, tier = 2, items = []) => ({ character_id: id, tier, itemNames: items });
const IE = ['DA_Item_InfinityEdge', 'DA_Item_Guinsoo', 'DA_Item_Bloodthirster'];

// Acht Bretter: drei A (Spell-Stufe 2, 2, 4), zwei B, drei ohne Comp.
function lobby() {
  const spell = tier => ({ name: 'DA_18_Spell', num_units: 4, style: tier > 2 ? 3 : 1, tier_current: tier, tier_total: 4 });
  const adaptor = { name: 'DA_18_Adaptor', num_units: 2, style: 1, tier_current: 1, tier_total: 3 };
  const mk = (i, traits, units, level = 8) => ({ puuid: `p${i}`, placement: i + 1, level, last_round: 30 + i, augments: [], traits, units });
  return [
    mk(0, [spell(4)], [unit('DA_18_Veigar', 3, IE), unit('DA_18_LeBlanc', 3), unit('DA_18_Ornn', 2), unit('DA_18_RekSai', 2)], 7),
    mk(1, [adaptor], [unit('DA_18_Aphelios', 2, IE), unit('DA_18_Nidalee'), unit('DA_18_Taric'), unit('DA_18_Ivern')], 9),
    mk(2, [spell(2)], [unit('DA_18_Veigar', 2, IE), unit('DA_18_LeBlanc', 3), unit('DA_18_Ornn'), unit('DA_18_Kennen')], 8),
    mk(3, [{ name: 'DA_18_Sniper', num_units: 4, style: 3, tier_current: 2, tier_total: 3 }], [unit('DA_18_Jhin', 2, IE), unit('DA_18_A'), unit('DA_18_B')]),
    mk(4, [adaptor], [unit('DA_18_Aphelios', 1, IE), unit('DA_18_Nidalee'), unit('DA_18_Taric'), unit('DA_18_Kennen')], 8),
    mk(5, [spell(2)], [unit('DA_18_Veigar', 2), unit('DA_18_LeBlanc', 2), unit('DA_18_Ornn'), unit('DA_18_RekSai')], 8),
    mk(6, [{ name: 'DA_18_Sniper', num_units: 4, style: 3, tier_current: 2, tier_total: 3 }], [unit('DA_18_Jhin', 2, IE), unit('DA_18_A'), unit('DA_18_C')]),
    mk(7, [{ name: 'DA_18_Brawler', num_units: 2, style: 1, tier_current: 1, tier_total: 3 }], [unit('DA_18_Sett', 2, IE)]),
  ];
}
const match = parts => ({ metadata: { match_id: 'EUW1_9' }, info: { queue_id: 1100, tft_set_number: 18, participants: parts } });

test('Katalog: Zeilen je Comp und Trait-Stufe, Summen = Einzelzuordnung, ohne Comp keine Zeile', () => {
  const agg = emptyAggregate();
  aggregateMatch(match(lobby()), agg, { tierBucket: 'diamond', currentSet: 18, catalog: CATALOG });
  const out = finalize(agg, { minCompGames: 1, minUnitGames: 1 });
  const parts = lobby();
  const want = new Map();
  for (const p of parts) {
    const c = assignBoard(new Set(p.units.map(u => u.character_id)), CATALOG);
    if (!c) continue;
    const k = compClusterKey(c, p.traits);
    want.set(k, (want.get(k) || 0) + 1);
  }
  const got = new Map(Object.entries(out.byComp).map(([k, v]) => [k, v.diamond.games]));
  assert.deepEqual([...got.entries()].sort(), [...want.entries()].sort());
  assert.deepEqual([...got.keys()].sort(), ['DA_18_Adaptor@1_DA_18_Aphelios', 'DA_18_Spell@2_DA_18_Veigar', 'DA_18_Spell@4_DA_18_Veigar']);
  // Umkaempft je Comp: drei Spell-Bretter auf zwei Stufen zaehlen als 3.
  assert.deepEqual(Object.keys(out.byComp['DA_18_Spell@2_DA_18_Veigar'].diamond.contestedDist), ['3']);
  assert.deepEqual(Object.keys(out.byComp['DA_18_Adaptor@1_DA_18_Aphelios'].diamond.contestedDist), ['2']);
  // Carry-Stern vom Namens-Carry (Veigar 3★ und 2★, Aphelios 2★ und 1★).
  assert.deepEqual(Object.keys(out.byComp['DA_18_Spell@4_DA_18_Veigar'].diamond.carryStarDist), ['3']);
  assert.deepEqual(Object.keys(out.byComp['DA_18_Adaptor@1_DA_18_Aphelios'].diamond.carryStarDist).sort(), ['1', '2']);
});

test('Katalog: Duelle und Paare je Comp, gleiche Comp auf anderer Stufe zaehlt nicht', () => {
  const agg = emptyAggregate();
  aggregateMatch(match(lobby()), agg, { tierBucket: 'diamond', currentSet: 18, catalog: CATALOG });
  const out = finalize(agg, { minCompGames: 1, minPairGames: 1 });
  // 3 Spell × 2 Adaptor = 6 Vergleiche, nur ein Familienpaar.
  const duel = out.compMatchups.filter(r => r.comp === A.key);
  assert.deepEqual(duel.map(r => [r.opp, r.games]), [[B.key, 6]]);
  for (const pr of [...agg.byCompPair.values()]) assert.notEqual(pr.a.split('@')[0], pr.b.split('@')[0]);
});

test('Katalog: Perfekt-Zaehler nur fuer bewertbare Comps (Reroll-Satz oder Zielstufe)', () => {
  const agg = emptyAggregate();
  aggregateMatch(match(lobby()), agg, { tierBucket: 'diamond', currentSet: 18, catalog: CATALOG });
  const out = finalize(agg, { minCompGames: 1 });
  // A: Reroll Veigar+LeBlanc — nur Platz 1 hat beide auf 3★.
  assert.deepEqual(out.byComp['DA_18_Spell@4_DA_18_Veigar'].diamond.perfect, { games: 1, sumPlacement: 1, top4: 1, top1: 1 });
  assert.deepEqual(out.byComp['DA_18_Spell@2_DA_18_Veigar'].diamond.perfect, { games: 0, sumPlacement: 0, top4: 0, top1: 0 });
  // B: weder Reroll noch Zielstufe → nicht bewertet.
  assert.equal(out.byComp['DA_18_Adaptor@1_DA_18_Aphelios'].diamond.perfect, null);
});

test('Schattenzaehlung laeuft in beiden Modi klassisch, ab 2 Spielen, Units je Spiel einmal', () => {
  for (const catalog of [null, CATALOG]) {
    const agg = emptyAggregate();
    aggregateMatch(match(lobby()), agg, { tierBucket: 'diamond', currentSet: 18, catalog });
    const out = finalize(agg, { minCompGames: 1 });
    const fams = Object.fromEntries(out.compClassic.map(r => [r.family, r]));
    // Sniper·Jhin spielen zwei, Brawler·Sett nur einer (unter 2 Spielen).
    assert.equal(fams['DA_18_Sniper__DA_18_Jhin']?.games, 2);
    assert.deepEqual(fams['DA_18_Sniper__DA_18_Jhin'].units.DA_18_Jhin, [2, 0]);
    assert.equal(fams['DA_18_Brawler__DA_18_Sett'], undefined);
    assert.ok(out.compClassic.every(r => r.games >= 2));
  }
  // Eisen und pro_pool zaehlen nicht in den Schatten.
  const agg = emptyAggregate();
  aggregateMatch(match(lobby()), agg, { tierBucket: 'iron', currentSet: 18, catalog: null });
  assert.equal(finalize(agg, {}).compClassic.length, 0);
});

test('Klassisch: keine Perfekt-Zaehler, Schluessel wie bisher', () => {
  const agg = emptyAggregate();
  aggregateMatch(match(lobby()), agg, { tierBucket: 'diamond', currentSet: 18 });
  const out = finalize(agg, { minCompGames: 1 });
  assert.ok(Object.keys(out.byComp).length >= 4);
  for (const v of Object.values(out.byComp)) assert.equal(v.diamond.perfect, null);
});
