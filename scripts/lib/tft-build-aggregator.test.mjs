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
import { emptyAggregate, finalize, isPersistableFinishedItem } from './tft-build-aggregator.mjs';

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
