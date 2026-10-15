// Item-Bloecke der Unit- und Item-Detailseite (0096): Mindestzahl 30 Spiele,
// Thief's Gloves raus, Item-Plaetze mit der Summe ALLER Kopien als Nenner,
// Zustaende pending/failed fuer Startdaten und Datenbank-Fehler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemCarriers, itemDetailBody, unitDetailBody, unitItemBlocks } from './tft-detail-payload.ts';

const IE = 'TFT_Item_InfinityEdge', GR = 'TFT_Item_GuinsoosRageblade', TG = 'TFT_Item_ThiefsGloves';

const raw = {
  stars: { 1: 120, 2: 900, 3: 40 },
  sets: [[`${GR}|${IE}|${IE}`, 80, 50, 300], [`${GR}|${IE}|${TG}`, 60, 30, 260], [`${GR}|${GR}|${IE}`, 29, 20, 90]],
  itemsByTier: { 2: [[IE, 500, 300, 1800], [TG, 90, 40, 400], [GR, 29, 10, 120]], 3: [[IE, 20, 18, 40]] },
  setsByTier: { 2: [[`${GR}|${IE}|${IE}`, 70, 45, 260]] },
  slotsByTier: {
    2: { 0: [400, [[IE, 250], [TG, 100], [GR, 50]]], 1: [29, [[GR, 29]]] },
    3: { 0: [10, [[IE, 10]]] },
  },
  topItems: [[IE, 700, 400, 2600], [GR, 31, 10, 140], [TG, 300, 100, 1300]],
};

test('unitItemBlocks: ab 30 Spielen, Thief\'s Gloves raus, Platz-Summe bleibt Nenner', () => {
  const b = unitItemBlocks(raw);
  assert.deepEqual(b.topItems.map(x => x.item), [IE, GR]);
  assert.equal(b.topItems[0].avgPlacement, 2600 / 700);
  assert.deepEqual(b.topItemSets.map(s => s.items), [[GR, IE, IE]], 'Set mit Thief\'s Gloves und Set unter 30 raus');
  assert.deepEqual(Object.keys(b.topItemsByTier), ['2'], '3★ nur 20 Spiele');
  assert.deepEqual(b.topItemsByTier['2'].map(x => x.item), [IE]);
  assert.deepEqual(b.topItemSetsByTier['2'][0].items, [GR, IE, IE]);
  // Platz 0: Thief's Gloves nicht gezeigt, Summe 400 bleibt (User: Prozent ueber alle Kopien).
  assert.deepEqual(b.itemSlotsByTier, { 2: { 0: { total: 400, entries: [{ item: IE, count: 250 }, { item: GR, count: 50 }] } } });
  assert.deepEqual(b.starGames, { 1: 120, 2: 900, 3: 40 });
});

test('unitItemBlocks: ohne Daten leer, keine erfundenen Werte', () => {
  assert.deepEqual(unitItemBlocks(null), {
    topItems: [], topItemSets: [], topItemsByTier: null, topItemSetsByTier: null, itemSlotsByTier: null, starGames: null,
  });
});

const input = { id: 'TFT18_X', region: 'all', bucket: 'master_plus', core: { games: 900, avgPlacement: 4, top4Rate: 0.5, top1Rate: 0.1 }, coreKnown: true, filterSet: 18, filterPatch: '18.4' };

test('unitDetailBody: pending → Browser laedt nach, failed → nicht zwischenspeichern', () => {
  const pending = unitDetailBody(input, 'pending');
  assert.equal(pending.body.unit.itemsPending, true);
  assert.equal(pending.cacheable, false);
  assert.deepEqual(pending.body.unit.topItems, []);
  const failed = unitDetailBody(input, 'failed');
  assert.equal(failed.body.unit.itemsPending, undefined);
  assert.equal(failed.cacheable, false);
  const none = unitDetailBody(input, null);
  assert.equal(none.cacheable, true);
  assert.equal(none.body.unit.itemSlotsByTier, null);
  const ok = unitDetailBody(input, raw);
  assert.equal(ok.cacheable, true);
  assert.equal(ok.body.unit.games, 900);
  assert.equal(ok.body.patch, '18.4');
  // Unit nicht in der Liste: keine Daten, nicht zwischenspeichern.
  assert.deepEqual(unitDetailBody({ ...input, core: null }, raw), {
    body: { region: 'all', bucket: 'master_plus', hasData: false, unit: null }, cacheable: false,
  });
});

test('itemCarriers / itemDetailBody: ab 30 Spielen, hoechstens 10, Raten aus Summen', () => {
  const rows = Array.from({ length: 14 }, (_, i) => [`U${i}`, 200 - i, (200 - i) * 4, 100, 20]);
  rows.push(['LOW', 29, 100, 10, 1]);
  const c = itemCarriers(rows);
  assert.equal(c.length, 10);
  assert.deepEqual(c[0], { characterId: 'U0', games: 200, avgPlacement: 4, top4Rate: 0.5, top1Rate: 0.1 });
  assert.ok(!c.some(x => x.characterId === 'LOW'));
  const pending = itemDetailBody({ ...input, id: IE }, 'pending');
  assert.equal(pending.body.item.itemsPending, true);
  assert.deepEqual(pending.body.item.topUsers, []);
  assert.equal(itemDetailBody({ ...input, id: IE }, rows).body.item.topUsers.length, 10);
});
