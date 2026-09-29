/**
 * persistTopItems (Tabelle tft_daily_unit_top_items, Item-Reihe auf /tft/units).
 *
 * Kern-Regel: erst Bauteile/Embleme/Thief's Gloves rausfiltern, DANN auf 15
 * kappen — sonst verdraengen haeufige Bauteile die fertigen Items und die
 * Reihe hat weniger als 6 Eintraege. `topItems` fuer die
 * JSON/Detailseite bleibt unveraendert ungefiltert bei 10.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateMatch, emptyAggregate, finalize, isPersistableFinishedItem, isOutcomeFinishedItem } from './tft-build-aggregator.mjs';
import { chunkByBytes } from './tft-supabase-writer.mjs';

function unitWithItems(itemGames) {
  const agg = emptyAggregate();
  const items = new Map();
  for (const [item, games] of itemGames) items.set(item, { games, top4: 0, sumPlacement: games * 4 });
  agg.byUnit.set('TFT18_Test', new Map([['diamond', {
    games: 500, sumPlacement: 2000, top4: 250, top1: 60,
    items, itemSets: new Map(),
  }]]));
  return finalize(agg, { minUnitGames: 5 }).byUnit.TFT18_Test.diamond;
}

test('Filter vor Kappung: 10 Stoerer mit den meisten Spielen verdraengen keine fertigen Items', () => {
  const noise = [
    'DA_Component_BFSword', 'DA_Component_RecurveBow', 'TFT_Item_Spatula', 'TFT_Item_FryingPan',
    'TFTTutorial_Item_ChainVest', 'TFT18_Item_WarriorEmblemItem', 'TFT_Item_ThiefsGloves',
    'TFT_Item_EmptyBag', 'DA_Item_SomethingEmblem', 'DA_Component_Spatula',
  ].map((it, i) => [it, 1000 - i]);
  const finished = ['TFT_Item_InfinityEdge', 'TFT_Item_GuinsoosRageblade', 'TFT_Item_Bloodthirster',
    'TFT_Item_WarmogsArmor', 'TFT_Item_GargoyleStoneplate', 'TFT_Item_SpearOfShojin', 'TFT_Item_Deathblade']
    .map((it, i) => [it, 100 - i]);
  const b = unitWithItems([...noise, ...finished]);
  assert.deepEqual(b.persistTopItems.map(x => x.item), finished.map(([it]) => it));
  // JSON-Feld unveraendert: ungefiltert, 10 Eintraege, Stoerer vorne.
  assert.equal(b.topItems.length, 10);
  assert.equal(b.topItems[0].item, 'DA_Component_BFSword');
});

test('Kappung auf 15, Sortierung Spiele absteigend, Gleichstand nach Name', () => {
  const many = Array.from({ length: 20 }, (_, i) => [`TFT_Item_Fake${String(i).padStart(2, '0')}`, i < 2 ? 50 : 40 - i]);
  const b = unitWithItems(many);
  assert.equal(b.persistTopItems.length, 15);
  assert.deepEqual(b.persistTopItems.slice(0, 2).map(x => x.item), ['TFT_Item_Fake00', 'TFT_Item_Fake01']);
  for (let i = 1; i < b.persistTopItems.length; i++) {
    assert.ok(b.persistTopItems[i - 1].games >= b.persistTopItems[i].games);
  }
  assert.deepEqual(Object.keys(b.persistTopItems[0]).sort(), ['games', 'item', 'sumPlacement', 'top4']);
});

test('isPersistableFinishedItem', () => {
  assert.equal(isPersistableFinishedItem('TFT_Item_InfinityEdge'), true);
  assert.equal(isPersistableFinishedItem('TFT_Item_BFSword'), false);
  assert.equal(isPersistableFinishedItem('DA_Component_TearOfTheGoddess'), false);
  assert.equal(isPersistableFinishedItem('TFT_Item_ThiefsGloves_Radiant'), false);
  assert.equal(isPersistableFinishedItem(''), false);
});

// Rollen-Felder je Comp-Einheit (app/lib/tft-comp-roles.ts): Items einmal pro
// Spiel, auch wenn die Unit doppelt steht; Hand of Justice zaehlt als Carry.
test('Comp-Einheiten: Items einmal pro Spiel, carryItemGamesAll inkl. HoJ, tankItemGames', () => {
  const unit = (id, items, tier = 2) => ({ character_id: id, tier, itemNames: items });
  const participant = (i, units) => ({
    puuid: `p${i}`, placement: i + 1, level: 8, last_round: 30, augments: [],
    traits: [{ name: 'TFT17_Stargazer', num_units: 6, style: 3, tier_current: 3, tier_total: 4 }],
    units,
  });
  const lineup = [
    unit('TFT17_KhaZix', ['TFT_Item_HandOfJustice', 'TFT_Item_Guardbreaker']),
    unit('TFT17_Samira', ['TFT_Item_WarmogsArmor', 'TFT_Item_BrambleVest']),
    unit('TFT17_Samira', ['TFT_Item_WarmogsArmor']),
    unit('TFT17_Lulu', []), unit('TFT17_Nami', []), unit('TFT17_Jax', []),
  ];
  const agg = emptyAggregate();
  aggregateMatch({
    metadata: { match_id: 'EUW1_1' },
    info: { queue_id: 1100, tft_set_number: 17, game_version: 'Version 17.1', participants: [0, 1].map(i => participant(i, lineup)) },
  }, agg, { tierBucket: 'diamond', currentSet: 17 });
  const comps = finalize(agg, { minCompGames: 1, minUnitGames: 1 }).byComp;
  const row = Object.values(comps).flatMap(b => Object.values(b))[0];
  assert.ok(row, 'Comp-Zeile erwartet');
  const byId = Object.fromEntries(row.typicalUnits.map(u => [u.characterId, u]));
  assert.equal(byId.TFT17_KhaZix.carryItemGamesAll, 2);
  assert.equal(byId.TFT17_KhaZix.tankItemGames, 0);
  // Samira steht doppelt: Warmog einmal pro Spiel, nicht zweimal.
  const warmog = byId.TFT17_Samira.topItems.find(i => i.apiName === 'TFT_Item_WarmogsArmor');
  assert.equal(warmog.count, 2);
  assert.equal(byId.TFT17_Samira.tankItemGames, 4);
  assert.equal(byId.TFT17_Samira.carryItemGamesAll, 0);
});

// Comp-Ergebnisse je Unit und Item (Tabelle tft_daily_comp_outcome, 0078).
// Faire Grundmenge: nur Kopien mit genau 3 fertigen Items; Thief's Gloves
// nimmt die ganze Kopie raus; Traenke und Bauteile zaehlen nicht als Item;
// pro_pool bekommt keine Outcome-Daten.
test('Comp-Outcome: 3-Item-Kopien, Doppel-Items, Thief\'s Gloves/Trank/Bauteil raus, kein pro_pool', () => {
  const IE = 'TFT_Item_InfinityEdge';
  const GB = 'TFT_Item_Guardbreaker';
  const unit = (id, items, tier = 2) => ({ character_id: id, tier, itemNames: items });
  const participant = (i, placement, level, lastRound, units) => ({
    puuid: `p${i}`, placement, level, last_round: lastRound, augments: [],
    traits: [{ name: 'TFT17_Stargazer', num_units: 6, style: 3, tier_current: 3, tier_total: 4 }],
    units,
  });
  const p0 = participant(0, 1, 9, 30, [
    unit('TFT17_KhaZix', [IE, IE, GB], 3),
    unit('TFT17_Samira', ['TFT_Item_WarmogsArmor', 'TFT_Item_BrambleVest', 'DA_HealthPotion18_Radiant']),
    unit('TFT17_Lulu', ['TFT_Item_ThiefsGloves', IE, GB]),
    unit('TFT17_Nami', []), unit('TFT17_Jax', []), unit('tft17_bardfollower', []),
  ]);
  const p1 = participant(1, 5, 8, 20, [
    unit('TFT17_KhaZix', [IE, GB, 'DA_Component_BFSword'], 3),
    unit('TFT17_Samira', ['TFT_Item_WarmogsArmor']),
    unit('TFT17_Lulu', []), unit('TFT17_Nami', []), unit('TFT17_Jax', []),
  ]);
  const agg = emptyAggregate();
  aggregateMatch({
    metadata: { match_id: 'EUW1_2' },
    info: { queue_id: 1100, tft_set_number: 17, game_version: 'Version 17.1', participants: [p0, p1] },
  }, agg, { tierBucket: 'diamond', currentSet: 17, proPuuids: new Set(['p0']) });
  const comps = finalize(agg, { minCompGames: 1, minUnitGames: 1 }).byComp;
  const keys = Object.keys(comps);
  assert.equal(keys.length, 1, `eine Comp erwartet, bekam ${keys.join(', ')}`);
  const buckets = comps[keys[0]];
  // pro_pool nimmt die ganze Lobby auf, sobald ein Pro drin ist.
  assert.equal(buckets.pro_pool?.games, 2);
  assert.equal(buckets.pro_pool.outcome, undefined, 'pro_pool darf keine Outcome-Daten haben');
  assert.equal(buckets.all?.outcome, undefined, 'Roll-ups werden nicht gespeichert');

  const o = buckets.diamond.outcome;
  assert.equal(o.games, 2);
  assert.deepEqual(o.placementHist, [1, 0, 0, 0, 1, 0, 0, 0]);
  assert.deepEqual(o.levelStats, { 9: [1, 1, 1, 1, 1], 8: [1, 5, 25, 0, 0] });
  // Runde 20 ist 4-2: p1 hat Stage 5 nicht erreicht.
  assert.deepEqual(o.levelStatsS5, { 9: [1, 1, 1, 1, 1] });
  // Kha'Zix: auf beiden Boards, aber nur p0 hat 3 fertige Items (p1: Bauteil).
  assert.deepEqual(o.units.TFT17_KhaZix, [2, 6, 26, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(o.unitItems.TFT17_KhaZix, { [IE]: [1, 1, 1, 1, 2], [GB]: [1, 1, 1, 1, 1] });
  assert.deepEqual(o.unitSets.TFT17_KhaZix, { [[GB, IE, IE].sort().join('|')]: [1, 1, 1] });
  // Samira: Trank zaehlt nicht → nur 2 fertige Items → keine Item-Zeile.
  assert.deepEqual(o.units.TFT17_Samira.slice(5), [0, 0, 0, 0]);
  assert.equal(o.unitItems.TFT17_Samira, undefined);
  // Lulu: Thief's Gloves → Kopie komplett raus, zaehlt aber als „auf dem Board".
  assert.equal(o.units.TFT17_Lulu[0], 2);
  assert.equal(o.unitItems.TFT17_Lulu, undefined);
  // Summons sind keine Units.
  assert.equal(o.units.tft17_bardfollower, undefined);
  assert.deepEqual(o.unitLevels.TFT17_KhaZix, { 9: [1, 1, 1], 8: [1, 5, 25] });
});

test('isOutcomeFinishedItem: Embleme ja, Traenke/Booster/Bauteile nein', () => {
  assert.equal(isOutcomeFinishedItem('TFT_Item_InfinityEdge'), true);
  assert.equal(isOutcomeFinishedItem('TFT18_Item_WarriorEmblemItem'), true);
  assert.equal(isOutcomeFinishedItem('TFT_Item_InfinityEdge_Radiant'), true);
  for (const it of ['DA_HealthPotion18', 'DA_ManaPotion18_Radiant', 'DA_BlastPotion18_Charm', 'DA_AttackBooster18',
    'DA_Reforger', 'DA_LuckyItemChest', 'DA_MasterworkUpgrade', 'DA_Consumable_Foo', 'TFT_Item_EmptyBag',
    'DA_Component_BFSword', 'TFT_Item_Spatula', '']) {
    assert.equal(isOutcomeFinishedItem(it), false, it);
  }
});

test('chunkByBytes: Byte-Grenze und Zeilen-Grenze', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ i, pad: 'x'.repeat(90) }));
  const one = JSON.stringify(rows[0]).length;
  const chunks = chunkByBytes(rows, one * 2);
  assert.deepEqual(chunks.map(c => c.length), [2, 2, 1]);
  assert.deepEqual(chunkByBytes([{ big: 'y'.repeat(50) }], 10).map(c => c.length), [1]);
  assert.equal(chunkByBytes(Array.from({ length: 450 }, () => ({})), 1e9).length, 3);
});
