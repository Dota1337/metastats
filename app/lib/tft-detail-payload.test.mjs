// Item-Bloecke der Unit- und Item-Detailseite (0096): Mindestzahl 30 Spiele,
// Thief's Gloves raus, Item-Plaetze mit der Summe ALLER Kopien als Nenner,
// Zustaende pending/failed fuer Startdaten und Datenbank-Fehler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carrierAvgPlacement, itemCarriers, itemDetailBody, itemHolders, itemHoldersByAvg, unitDetailBody, unitItemBlocks } from './tft-detail-payload.ts';

const IE = 'TFT_Item_InfinityEdge', GR = 'TFT_Item_GuinsoosRageblade', TG = 'TFT_Item_ThiefsGloves';

test('Knopf Ø: die bewerteten Units mit dem besten Ø, nicht die mit dem besten Delta', () => {
  const rows = [
    { characterId: 'BestesDelta', games: 500, sumPlacement: 2500, delta: -0.4 },
    { characterId: 'BesterSchnitt', games: 500, sumPlacement: 1500, delta: 0.3 },
    { characterId: 'Mitte', games: 500, sumPlacement: 2000, delta: 0.1 },
    { characterId: 'Unbewertet', games: 900, sumPlacement: 2700 },
    { characterId: 'Winzig', games: 40, sumPlacement: 40 },
    { characterId: 'Ohne', games: 10, sumPlacement: 10 },
  ];
  // Kappe 2: nur bewertete, die beste Delta-Unit fliegt raus, beste Schnitte bleiben.
  assert.deepEqual(itemHoldersByAvg(rows, 2), [['BesterSchnitt', 3, 0.3], ['Mitte', 4, 0.1]]);
  // Freie Plaetze: meistgespielte Unbewertete; die ganze Reihe faellt nach Ø, ohne Ø hinten.
  assert.deepEqual(itemHoldersByAvg(rows).map(h => h[0]), ['Winzig', 'Unbewertet', 'BesterSchnitt', 'Mitte', 'BestesDelta', 'Ohne']);
  assert.deepEqual(itemHoldersByAvg(rows, 4).map(h => h[0]), ['Unbewertet', 'BesterSchnitt', 'Mitte', 'BestesDelta']);
  // Eingabe bleibt unberuehrt, Gleichstand fest.
  const tie = [{ characterId: 'B', games: 100, sumPlacement: 400, delta: -0.1 }, { characterId: 'A', games: 100, sumPlacement: 400, delta: 0.1 }];
  assert.deepEqual(itemHoldersByAvg(tie).map(h => h[0]), ['A', 'B']);
  assert.deepEqual(tie.map(r => r.characterId), ['B', 'A']);
});

test('Traeger ohne Delta: Auswahl nach Spielen, Reihenfolge nach sichtbarem Ø', () => {
  const rows = [
    { characterId: 'Viel', games: 900, sumPlacement: 4500 },
    { characterId: 'Mittel', games: 500, sumPlacement: 1500 },
    { characterId: 'Wenig', games: 100, sumPlacement: 400 },
    { characterId: 'Winzig', games: 20, sumPlacement: 20 },
    { characterId: 'Stark', games: 60, sumPlacement: 60 },
  ];  // Winzig hat den besten Rohwert, ist aber nicht unter den 4 meistgespielten.
  assert.deepEqual(itemHolders(rows, 4), [['Stark', 1, null], ['Mittel', 3, null], ['Wenig', 4, null], ['Viel', 5, null]]);
  // Ist er dabei, steht er ohne Ø (unter 30 Spielen) ganz hinten.
  assert.deepEqual(itemHolders(rows).map(h => h[0]), ['Stark', 'Mittel', 'Wenig', 'Viel', 'Winzig']);
  // Delta bleibt vorne, der Rest fuellt nur die freien Plaetze, und ist alles voll, keiner.
  const mixed = [{ characterId: 'D', games: 200, sumPlacement: 1000, delta: -0.2 }, { characterId: 'A', games: 300, sumPlacement: 1200 }, { characterId: 'B', games: 300, sumPlacement: 900 }];
  assert.deepEqual(itemHolders(mixed, 2).map(h => h[0]), ['D', 'A']);
  assert.deepEqual(itemHolders(mixed, 1).map(h => h[0]), ['D']);
  assert.deepEqual(itemHolders(mixed).map(h => h[0]), ['D', 'B', 'A']);
});

test('Beste Traeger: Delta zuerst, bestes oben, danach die meistgespielten ohne Delta', () => {
  const rows = [
    { characterId: 'Haeufig', games: 900, sumPlacement: 3600 },
    { characterId: 'Rot', games: 500, sumPlacement: 2500, delta: 0.234 },
    { characterId: 'Gruen', games: 200, sumPlacement: 700, delta: -0.276 },
    { characterId: 'Selten', games: 20, sumPlacement: 60 },
    { characterId: 'Null', games: 300, sumPlacement: 1200, delta: 0 },
  ];
  assert.deepEqual(itemHolders(rows), [
    ['Gruen', 3.5, -0.28],
    ['Null', 4, 0],
    ['Rot', 5, 0.23],
    ['Haeufig', 4, null],
    ['Selten', null, null],
  ]);
  // Gleichstand fest, sonst springen Kacheln zwischen zwei Abrufen.
  const tie = [{ characterId: 'B', games: 100, sumPlacement: 400, delta: -0.1 }, { characterId: 'A', games: 100, sumPlacement: 400, delta: -0.1 }];
  assert.deepEqual(itemHolders(tie).map(h => h[0]), ['A', 'B']);
  // Kappe, und eine Unit mit schlechtem Delta bleibt vor einer ohne Wert.
  assert.equal(itemHolders(rows, 2).length, 2);
  // Stand von vor 0112: kein Delta, also Haeufigkeit.
  assert.deepEqual(itemHolders([{ characterId: 'X', games: 40 }, { characterId: 'Y', games: 90 }]).map(h => h[0]), ['Y', 'X']);
});

test('Ø je Unit in der Items-Liste: ab 30 Spielen, 2 Stellen, ohne Summe nie 0', () => {
  assert.equal(carrierAvgPlacement(30, 97), 3.23);
  assert.equal(carrierAvgPlacement(12498, 40431), 3.23);
  assert.equal(carrierAvgPlacement(29, 90), null);
  // Stand von vor Migration 0111: Spiele da, Summe fehlt oder wurde beim Zusammenlegen 0.
  assert.equal(carrierAvgPlacement(500, 0), null);
  assert.equal(carrierAvgPlacement(500, undefined), null);
  assert.equal(carrierAvgPlacement(undefined, undefined), null);
});

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
