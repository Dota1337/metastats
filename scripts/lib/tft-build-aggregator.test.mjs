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
import { aggregateMatch, emptyAggregate, finalize, isPersistableFinishedItem, isOutcomeFinishedItem, isOutcomeEmblem, addFamilyPairs, familyPairRows, persistBuilds } from './tft-build-aggregator.mjs';
import { chunkByBytes, matchupKeepFrom } from './tft-supabase-writer.mjs';

// Comp-Duelle (0092): je Spielerpaar, Familie statt Variante, gleiche Familie
// zaehlt nicht, beide Richtungen, ohne Mindestzahl und ohne Ergebnis-Auswahl.
test('addFamilyPairs: Familie, gleiche Familie raus, Mehrfach-Spieler, beide Richtungen', () => {
  const map = new Map();
  // Platz 1: Azir (Variante @3), Platz 2: Azir (@5 — gleiche Familie),
  // Platz 3: Kayle, Platz 4: ohne Comp, Platz 5: Kayle.
  addFamilyPairs(map, 'master',
    ['DA_Exec@3_DA_Azir', 'DA_Exec@5_DA_Azir*3', 'DA_Eclipse@1_DA_Kayle', null, 'DA_Eclipse@2_DA_Kayle~aug'],
    [1, 2, 3, 4, 5]);
  assert.equal(map.size, 1, 'nur das Paar Azir/Kayle');
  const [e] = [...map.values()];
  // 2 Azir-Spieler x 2 Kayle-Spieler = 4 Vergleiche, Azir immer vorne.
  assert.deepEqual(e, { bucket: 'master', a: 'DA_Eclipse__DA_Kayle', b: 'DA_Exec__DA_Azir', games: 4, aBetter: 0, bBetter: 4 });
  const rows = familyPairRows(map);
  assert.deepEqual(rows, [
    { bucket: 'master', comp: 'DA_Eclipse__DA_Kayle', opp: 'DA_Exec__DA_Azir', games: 4, better: 0 },
    { bucket: 'master', comp: 'DA_Exec__DA_Azir', opp: 'DA_Eclipse__DA_Kayle', games: 4, better: 4 },
  ]);
});

test('addFamilyPairs: je Rang getrennt, ausgeglichenes Paar bleibt, fehlende Platzierung zaehlt fuer keinen', () => {
  const map = new Map();
  addFamilyPairs(map, 'master', ['T@1_A', 'U@1_B'], [1, 2]);
  addFamilyPairs(map, 'master', ['T@1_A', 'U@1_B'], [2, 1]);
  addFamilyPairs(map, 'challenger', ['T@1_A', 'U@1_B'], [1, 2]);
  addFamilyPairs(map, 'challenger', ['T@1_A', 'U@1_B'], [undefined, undefined]);
  const byBucket = Object.fromEntries([...map.values()].map(e => [e.bucket, e]));
  // 50 % bleibt erhalten (die alte Liste haette es verworfen).
  assert.deepEqual([byBucket.master.games, byBucket.master.aBetter, byBucket.master.bBetter], [2, 1, 1]);
  assert.deepEqual([byBucket.challenger.games, byBucket.challenger.aBetter, byBucket.challenger.bBetter], [2, 1, 0]);
});

test('aggregateMatch/finalize: compMatchups nur im Rang des Matches, nie pro_pool', () => {
  const agg = emptyAggregate();
  const p = (i, trait, carry) => ({
    puuid: `p${i}`, placement: i + 1, level: 8, last_round: 30, augments: [],
    traits: [{ name: trait, num_units: 6, style: 3, tier_current: 3, tier_total: 4 }],
    units: [{ character_id: carry, tier: 2, itemNames: ['TFT_Item_InfinityEdge', 'TFT_Item_GuinsoosRageblade', 'TFT_Item_Bloodthirster'] }],
  });
  aggregateMatch({
    metadata: { match_id: 'EUW1_3' },
    info: { queue_id: 1100, tft_set_number: 17, participants: [p(0, 'TFT17_Stargazer', 'TFT17_Lulu'), p(1, 'TFT17_Mecha', 'TFT17_Fiora')] },
  }, agg, { tierBucket: 'diamond', currentSet: 17, proPuuids: new Set(['p0']) });
  const out = finalize(agg, { minCompGames: 1, minUnitGames: 1 });
  // Lobby hat einen Pro (p0): Comp-Statistik schreibt zusaetzlich pro_pool, die Duelle nicht.
  assert.deepEqual(out.compMatchups, [
    { bucket: 'diamond', comp: 'TFT17_Mecha__TFT17_Fiora', opp: 'TFT17_Stargazer__TFT17_Lulu', games: 1, better: 0 },
    { bucket: 'diamond', comp: 'TFT17_Stargazer__TFT17_Lulu', opp: 'TFT17_Mecha__TFT17_Fiora', games: 1, better: 1 },
  ]);
});

test('matchupKeepFrom: 8 Tage vor dem geschriebenen Tag, Monatsgrenze, kaputter Tag wirft', () => {
  assert.equal(matchupKeepFrom('2026-10-11'), '2026-10-03');
  assert.equal(matchupKeepFrom('2026-10-05'), '2026-09-27');
  assert.equal(matchupKeepFrom('2026-10-11', 3), '2026-10-08');
  assert.throws(() => matchupKeepFrom('kaputt'));
});

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

// persistBuilds (0096, tft_daily_unit_builds): Item-Bloecke der Detailseite.
test('persistBuilds: Sterne, Plaetze ohne Thief\'s Gloves, Summe aller Kopien, fertige Items je Stern', () => {
  const IE = 'TFT_Item_InfinityEdge', GR = 'TFT_Item_GuinsoosRageblade', BT = 'TFT_Item_Bloodthirster';
  const TG = 'TFT_Item_ThiefsGloves', BF = 'DA_Component_BFSword';
  const agg = emptyAggregate();
  const p = (i, tier, itemNames) => ({
    puuid: `p${i}`, placement: i + 1, level: 8, last_round: 30, augments: [],
    traits: [{ name: 'TFT17_Stargazer', num_units: 6, style: 3, tier_current: 3, tier_total: 4 }],
    units: [{ character_id: 'TFT17_Lulu', tier, itemNames }],
  });
  aggregateMatch({
    metadata: { match_id: 'EUW1_9' },
    info: { queue_id: 1100, tft_set_number: 17, participants: [
      p(0, 2, [IE, GR, BT]), p(1, 2, [GR, IE, BT]), p(2, 2, [IE, BF]), p(3, 3, [TG, IE, GR]), p(4, 1, []),
    ] },
  }, agg, { tierBucket: 'diamond', currentSet: 17 });
  const b = finalize(agg, { minUnitGames: 1 }).byUnit.TFT17_Lulu.diamond.persistBuilds;
  assert.deepEqual(b.stars, { 1: 1, 2: 3, 3: 1 });
  // Platz-Summe = alle Kopien mit Item auf dem Platz; Gleichstand nach Name.
  assert.deepEqual(b.slotsByTier['2'], {
    0: [3, [[IE, 2], [GR, 1]]],
    1: [3, [[BF, 1], [GR, 1], [IE, 1]]],
    2: [2, [[BT, 2]]],
  });
  assert.equal(b.slotsByTier['3'], undefined, 'Kopie mit Thief\'s Gloves zaehlt nicht');
  // Je Stern nur fertige Items (Bauteil raus), [item, games, top4, sumPlacement].
  assert.deepEqual(b.itemsByTier['2'], [[IE, 3, 3, 6], [BT, 2, 2, 3], [GR, 2, 2, 3]]);
  assert.deepEqual(b.sets, [[`${BT}|${GR}|${IE}`, 2, 2, 3], [`${GR}|${IE}|${TG}`, 1, 1, 4]]);
  assert.deepEqual(b.setsByTier['2'], [[`${BT}|${GR}|${IE}`, 2, 2, 3]]);
  // Die JSON-Felder bleiben da (Companion, Datei), persistBuilds faellt dort raus.
  assert.ok(finalize(agg, { minUnitGames: 1 }).byUnit.TFT17_Lulu.diamond.itemSlotOrderByTier);
});

test('persistBuilds: erste 5 immer, danach ab max(2, 1 % der Spiele), Kappe 15', () => {
  const sets = n => new Map(Array.from({ length: 20 }, (_, i) => [`S${String(i).padStart(2, '0')}`, { games: n[i], top4: 0, sumPlacement: 0 }]));
  const games = [50, 40, 30, 20, 10, 9, 9, 8, 7, 6, 5, 4, 3, 3, 2, 2, 2, 1, 1, 1];
  // 1000 Spiele → Schwelle 10: nur die ersten 5.
  assert.deepEqual(persistBuilds({ games: 1000, itemSets: sets(games) }).sets.map(r => r[0]), ['S00', 'S01', 'S02', 'S03', 'S04']);
  // 100 Spiele → Schwelle 2: alles ab 2 Spielen, gekappt auf 15.
  const kept = persistBuilds({ games: 100, itemSets: sets(games) }).sets;
  assert.equal(kept.length, 15);
  assert.ok(kept.every(r => r[1] >= 2));
  // Ohne Maps (alte Eimer) kein Fehler.
  assert.deepEqual(persistBuilds({ games: 5 }), { stars: {}, sets: [], itemsByTier: {}, setsByTier: {}, slotsByTier: {} });
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
  // Ohne Embleme trotzdem ein Objekt mit Nenner — sonst fehlt die Zeile im Nenner.
  assert.deepEqual(o.emblems, { g: 2, e: {} });
});

// Embleme der Comp (0091): je Spiel einmal, egal wie viele Items die Unit
// traegt; zwei Traeger in einem Spiel zaehlen das Spiel einmal; Augment-Embleme
// und Phantom-Gegenstaende zaehlen nicht.
test('Comp-Outcome: Embleme je Spiel mit Traegern, ohne Augment/Phantom', () => {
  const IE = 'TFT_Item_InfinityEdge';
  const GB = 'TFT_Item_Guardbreaker';
  const EM = 'TFT17_Item_StargazerEmblemItem';
  const unit = (id, items, tier = 2) => ({ character_id: id, tier, itemNames: items });
  const participant = (i, placement, level, lastRound, units) => ({
    puuid: `p${i}`, placement, level, last_round: lastRound, augments: [],
    traits: [{ name: 'TFT17_Stargazer', num_units: 6, style: 3, tier_current: 3, tier_total: 4 }],
    units,
  });
  const p0 = participant(0, 1, 9, 30, [
    unit('TFT17_KhaZix', [IE, IE, GB], 3),
    unit('TFT17_Samira', [EM]),
    unit('TFT17_Lulu', ['DA_18_EmblemFloraFatalisAugment']),
    unit('TFT17_Nami', [EM]), unit('TFT17_Jax', ['DA_PhantomEmblem18']),
  ]);
  const p1 = participant(1, 5, 8, 20, [
    unit('TFT17_KhaZix', [IE, GB, 'DA_Component_BFSword'], 3),
    unit('TFT17_Samira', [EM, 'TFT_Item_WarmogsArmor']),
    unit('TFT17_Lulu', []), unit('TFT17_Nami', []), unit('TFT17_Jax', []),
  ]);
  const agg = emptyAggregate();
  aggregateMatch({
    metadata: { match_id: 'EUW1_3' },
    info: { queue_id: 1100, tft_set_number: 17, game_version: 'Version 17.1', participants: [p0, p1] },
  }, agg, { tierBucket: 'diamond', currentSet: 17, proPuuids: new Set() });
  const comps = finalize(agg, { minCompGames: 1, minUnitGames: 1 }).byComp;
  const keys = Object.keys(comps);
  assert.equal(keys.length, 1, `eine Comp erwartet, bekam ${keys.join(', ')}`);
  const o = comps[keys[0]].diamond.outcome;
  // n=2 Spiele, s=1+5, q=1+25, Top 4 und Sieg nur p0.
  assert.deepEqual(o.emblems, {
    g: 2,
    e: { [EM]: { t: [2, 6, 26, 1, 1], h: { TFT17_Samira: 2, TFT17_Nami: 1 } } },
  });
  // Die 3-Item-Zaehlung bleibt unberuehrt: Samira hat nie 3 fertige Items.
  assert.equal(o.unitItems.TFT17_Samira, undefined);
});

test('isOutcomeEmblem: Trait-Embleme ja, Augment-Embleme und Phantom nein', () => {
  for (const it of ['DA_18_EmblemExecutioner', 'TFT17_Item_StargazerEmblemItem']) assert.equal(isOutcomeEmblem(it), true, it);
  for (const it of ['DA_18_EmblemFloraFatalisAugment', 'DA_PhantomEmblem18', 'DA_PhantomEmblemUpgrade18', 'TFT_Item_InfinityEdge', '', null]) {
    assert.equal(isOutcomeEmblem(it), false, String(it));
  }
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
