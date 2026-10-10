import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRoles, namedCarries, shownItems, sumUnits, resolveFamilies, roleItemSets, componentCheckFromItems,
  coreFlexKind, coreFlexMap, unitPresence, splitCoreFlex, forcedCoreIds,
} from './tft-comp-roles.ts';

const opts = { set: 18, isComponent: (a) => a === 'DA_BFSword' };
const u = (characterId, games, items, extra = {}) => ({
  characterId, count: games, gamesWithUnit: games,
  topItems: Object.entries(items).map(([apiName, count]) => ({ apiName, count })), ...extra,
});

test('Haupt-Carry: meiste Carry-Items je Spiel vorne, Key-Carry nur bei < 10 % Abstand', () => {
  // Spellweaver: LeBlanc (Key) haelt in jedem Spiel ein Carry-Item, Veigar traegt mehr
  const units = [
    u('LeBlanc', 100, { DA_JeweledGauntlet: 80, DA_SpearOfShojin: 63 }, { carryItemGamesAll: 100 }),
    u('Veigar', 99, { DA_JeweledGauntlet: 90, DA_RabadonsDeathcap: 87 }, { carryItemGamesAll: 97 }),
  ];
  assert.deepEqual(computeRoles(units, 100, { ...opts, keyCarry: 'LeBlanc' }).carries, ['Veigar', 'LeBlanc']);
  // knapp (Veigar 1,49 vs Key 1,40): Key bleibt vorne
  const close = [
    u('Cassiopeia', 100, { DA_JeweledGauntlet: 80, DA_SpearOfShojin: 60 }, { carryItemGamesAll: 100 }),
    u('Veigar', 100, { DA_JeweledGauntlet: 80, DA_RabadonsDeathcap: 69 }, { carryItemGamesAll: 99 }),
  ];
  assert.deepEqual(computeRoles(close, 100, { ...opts, keyCarry: 'Cassiopeia' }).carries, ['Cassiopeia', 'Veigar']);
  assert.deepEqual(computeRoles(close, 100, opts).carries, ['Veigar', 'Cassiopeia']);
});

test('Hand of Justice und Edge of Night zaehlen als Carry-Items, nicht als Tank-Items', () => {
  const { carry, tank } = roleItemSets(18);
  assert.ok(carry.has('DA_HandOfJustice') && carry.has('DA_EdgeOfNight'));
  assert.ok(!tank.has('DA_HandOfJustice') && !tank.has('DA_EdgeOfNight'));
  assert.ok(tank.has('DA_WarmogsArmor'));
});

test('Carry wird an den Items erkannt, nicht am Key; zwei Carries, staerkster zuerst', () => {
  const units = [
    u('A', 100, { DA_GuinsoosRageblade: 70, DA_KrakensFury: 50 }, { carryItemGames: 95 }),
    u('B', 90, { DA_JeweledGauntlet: 60, DA_SpearOfShojin: 40 }, { carryItemGames: 70 }),
    u('T', 100, { DA_WarmogsArmor: 60, DA_BrambleVest: 40 }, { carryItemGames: 0 }),
    u('F', 100, {}, { carryItemGames: 5 }),
  ];
  const r = computeRoles(units, 100, opts);
  assert.deepEqual(r.carries, ['A', 'B']);
  assert.deepEqual(r.tanks, ['T']);
  assert.deepEqual(namedCarries(r, 'F'), ['A', 'B']);
  assert.deepEqual(namedCarries({ carries: [], tanks: [] }, 'F'), ['F']);
});

test('Kha-Zix mit Hand of Justice / Edge of Night wird Carry, obwohl das alte Feld sie nicht zaehlt', () => {
  const r = computeRoles([u('K', 100, { DA_HandOfJustice: 50, DA_EdgeOfNight: 40, DA_InfinityEdge: 30 },
    { carryItemGames: 30 })], 100, opts);
  assert.deepEqual(r.carries, ['K']);
});

test('Zu selten, zu wenig Praesenz oder gemischte Items ergeben keinen Carry', () => {
  assert.deepEqual(computeRoles([u('X', 20, { DA_InfinityEdge: 20 }, { carryItemGames: 20 })], 20, opts).carries, []);
  assert.deepEqual(computeRoles([u('X', 40, { DA_InfinityEdge: 40 }, { carryItemGames: 40 })], 100, opts).carries, []);
  // Anteil Carry-Items am Item-Volumen unter 0,6
  assert.deepEqual(computeRoles([u('X', 100, { DA_InfinityEdge: 50, DA_WarmogsArmor: 60 }, { carryItemGames: 70 })],
    100, opts).carries, []);
});

test('Items: nur an Item-Traegern, keine Komponenten, hoechstens drei, unter 15 % aufgefuellt', () => {
  const roles = { carries: ['A'], tanks: [], itemCarriers: ['A', 'T'] };
  const a = u('A', 100, { DA_BFSword: 90, DA_InfinityEdge: 60, DA_LastWhisper: 40, DA_Deathblade: 30,
    DA_GiantSlayer: 20, DA_Bloodthirster: 14 });
  assert.deepEqual(shownItems(a, roles, opts.isComponent).map(i => i.apiName),
    ['DA_InfinityEdge', 'DA_LastWhisper', 'DA_Deathblade']);
  assert.deepEqual(shownItems(u('F', 100, { DA_InfinityEdge: 80 }), roles, opts.isComponent), []);
  // Tank mit 60 % / 30 % / 8 %: das dritte Item wird aus derselben Comp aufgefuellt
  assert.deepEqual(shownItems(u('T', 100, { DA_WarmogsArmor: 60, DA_BrambleVest: 30, DA_GargoyleStoneplate: 8 }),
    roles, opts.isComponent).map(i => i.apiName), ['DA_WarmogsArmor', 'DA_BrambleVest', 'DA_GargoyleStoneplate']);
  // Ohne itemCarriers (alte Aufrufer): Carries + Tanks
  assert.equal(shownItems(u('T', 100, { DA_WarmogsArmor: 60 }), { carries: [], tanks: ['T'] }).length, 1);
});

test('Item-Traeger: bis zu vier Units nach Items je Spiel, Emblem zaehlt, Komponenten nicht', () => {
  const units = [
    u('A', 100, { DA_GuinsoosRageblade: 90, DA_KrakensFury: 80 }),                         // 1,7
    u('Z', 60, { DA_18_EmblemExecutioner: 40, DA_VoidStaff: 30, DA_SpearOfShojin: 14 }),     // 1,4 (Emblem zaehlt)
    u('V', 45, { DA_GargoyleStoneplate: 33, DA_WarmogsArmor: 24 }),                          // 1,27, Praesenz 0,45
    u('M', 90, { DA_WarmogsArmor: 50, DA_BrambleVest: 40 }),                                 // 1,0
    u('S', 100, { DA_SpiritVisage: 95 }),                                                    // 0,95 → fuenfter, faellt raus
    u('C', 100, { DA_BFSword: 300 }),                                                        // nur Komponenten
    u('R', 30, { DA_InfinityEdge: 30, DA_LastWhisper: 30 }),                                 // Praesenz 0,3
  ];
  assert.deepEqual(computeRoles(units, 100, opts).itemCarriers, ['A', 'Z', 'V', 'M']);
});

test('Item-Traeger: unter drei starken wird mit >= 0,6 Items je Spiel aufgefuellt, darunter nicht', () => {
  const units = [
    u('A', 100, { DA_GuinsoosRageblade: 90, DA_KrakensFury: 80 }),  // 1,7
    u('H', 100, { DA_WarmogsArmor: 68 }),                            // 0,68
    u('D', 100, { DA_WarmogsArmor: 46 }),                            // 0,46 → nicht
  ];
  assert.deepEqual(computeRoles(units, 100, opts).itemCarriers, ['A', 'H']);
  assert.deepEqual(computeRoles([u('X', 20, { DA_InfinityEdge: 40 })], 20, opts).itemCarriers, []);
});

test('sumUnits addiert Spiele und Items ueber Varianten', () => {
  const s = sumUnits([[u('A', 10, { X: 5 })], [u('A', 20, { X: 3, Y: 1 })], null]);
  assert.equal(s[0].gamesWithUnit, 30);
  assert.deepEqual(s[0].topItems, [{ apiName: 'X', count: 8 }, { apiName: 'Y', count: 1 }]);
});

test('Familien: gegenseitige Carries mit gleichem Kern werden zusammengelegt, ohne Verkettung', () => {
  const core = ['C1', 'C2', 'C3', 'C4'].map(id => u(id, 100, {}));
  const fam = (key, carry, games, carries) => ({
    key, trait: 'T', keyCarry: carry, games,
    units: [...core.map(c => ({ ...c, count: games, gamesWithUnit: games })),
      ...carries.map(c => u(c, games, { DA_InfinityEdge: games }, { carryItemGames: games }))],
  });
  const m = resolveFamilies([
    fam('T__A', 'A', 500, ['A', 'B']),
    fam('T__B', 'B', 300, ['A', 'B']),
    fam('T__C', 'C', 200, ['B', 'C']),   // gegenseitig nur mit B, B haengt schon an A
    { ...fam('T__D', 'D', 100, ['A', 'D']), trait: 'Other' },
  ], opts);
  assert.equal(m.get('T__B'), 'T__A');
  assert.equal(m.get('T__C'), 'T__C');
  assert.equal(m.get('T__D'), 'T__D');
});

test('Familien mit zu verschiedenem Kern bleiben getrennt', () => {
  const mk = (key, carry, coreIds) => ({
    key, trait: 'T', keyCarry: carry, games: 100,
    units: [...coreIds.map(id => u(id, 100, {})),
      u('A', 100, { DA_InfinityEdge: 100 }, { carryItemGames: 100 }),
      u('B', 100, { DA_InfinityEdge: 100 }, { carryItemGames: 100 })],
  });
  const m = resolveFamilies([mk('T__A', 'A', ['C1', 'C2', 'C3', 'C4', 'C5']), mk('T__B', 'B', ['D1', 'D2', 'D3', 'D4', 'D5'])], opts);
  assert.equal(m.get('T__B'), 'T__B');
});

test('Komponenten-Pruefung liest die Tags aus dem Asset-Bundle', () => {
  const isC = componentCheckFromItems({ DA_BFSword: { tags: ['component'] }, DA_InfinityEdge: { tags: [] } });
  assert.equal(isC('DA_BFSword'), true);
  assert.equal(isC('DA_InfinityEdge'), false);
  assert.equal(isC('Unbekannt'), false);
});

test('Core/Flex: Core ab genau 75 % der Spiele, darunter Flex', () => {
  assert.equal(coreFlexKind({ characterId: 'A', count: 75, gamesWithUnit: 75 }, 100), 'core');
  assert.equal(coreFlexKind({ characterId: 'A', count: 74, gamesWithUnit: 74 }, 100), 'flex');
  assert.equal(coreFlexKind({ characterId: 'A', count: 3, gamesWithUnit: 3 }, 100), 'flex');
});

test('Core/Flex zaehlt Spiele mit der Unit, nicht Kopien; altes Format faellt auf count zurueck', () => {
  // zwei Kopien in 60 von 100 Spielen: count 120, Anteil trotzdem 60 %
  const twice = { characterId: 'B', count: 120, gamesWithUnit: 60 };
  assert.equal(unitPresence(twice, 100), 0.6);
  assert.equal(coreFlexKind(twice, 100), 'flex');
  assert.equal(coreFlexKind({ characterId: 'C', count: 80 }, 100), 'core');
});

test('Core/Flex ohne Spiele: keine Einteilung statt erfundener Werte', () => {
  assert.equal(unitPresence({ characterId: 'A', count: 5, gamesWithUnit: 5 }, 0), null);
  assert.equal(coreFlexKind({ characterId: 'A', count: 5, gamesWithUnit: 5 }, 0), null);
  assert.deepEqual(coreFlexMap([{ characterId: 'A', count: 5 }], 0), {});
  assert.deepEqual(coreFlexMap(null, 100), {});
  assert.deepEqual(
    coreFlexMap([{ characterId: 'A', count: 90, gamesWithUnit: 90 }, { characterId: 'B', count: 40, gamesWithUnit: 40 }, { count: 99 }], 100),
    { A: 'core', B: 'flex' },
  );
});

test('splitCoreFlex: Reihenfolge bleibt je Gruppe, genannte Carries immer Core', () => {
  const units = ['A', 'B', 'C', 'D', 'E'].map((characterId) => ({ characterId }));
  const kinds = { A: 'flex', B: 'core', C: 'flex', D: 'core' };
  const ids = (g) => Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((u) => u.characterId)]));
  // E ohne Eintrag: hinten ohne Rahmen
  assert.deepEqual(ids(splitCoreFlex(units, kinds)), { core: ['B', 'D'], flex: ['A', 'C'], rest: ['E'] });
  // C steht im Comp-Namen: Core, an seiner Stelle in der Eingabe-Reihenfolge
  assert.deepEqual(ids(splitCoreFlex(units, kinds, ['C'])), { core: ['B', 'C', 'D'], flex: ['A'], rest: ['E'] });
});

test('splitCoreFlex ohne Einteilung: keine Rahmen, auch nicht fuer genannte Carries', () => {
  const units = [{ characterId: 'A' }, { characterId: 'B' }];
  for (const kinds of [undefined, null, {}]) {
    assert.deepEqual(splitCoreFlex(units, kinds, ['A']), { core: [], flex: [], rest: units });
  }
});

test('forcedCoreIds: genannte Carries, Units mit gezeigten Items und 3★-Units — wie die Kachel', () => {
  const units = [
    u('Azir', 100, { DA_JeweledGauntlet: 90 }),
    u('Rammus', 46, { DA_Warmogs: 40 }, { star3Games: 36 }),          // Items + 3★
    u('Hecarim', 40, { DA_Warmogs: 2 }, { star3Games: 22 }),          // 3★ (55 %), keine gezeigten Items
    u('Yorick', 44, { DA_Warmogs: 1 }, { star3Games: 0 }),            // weder noch
    u('Teemo', 40, { DA_BFSword: 30 }, { star3Games: 21 }),           // 52,5 % unter 55 %, nur Komponente
    u('Kobuko', 4, {}, { star3Games: 4 }),                            // unter 5 Spielen kein Abzeichen
  ];
  const roles = { carries: ['Azir'], tanks: [], itemCarriers: ['Azir', 'Rammus', 'Teemo'] };
  assert.deepEqual(forcedCoreIds(units, roles, ['Azir'], opts.isComponent), ['Azir', 'Rammus', 'Hecarim']);
  // Rahmen und Kachel nutzen dieselbe Funktion: gezeigte Items => Core
  for (const x of units) {
    const marked = shownItems(x, roles, opts.isComponent, 3).length > 0 || ['Rammus', 'Hecarim'].includes(x.characterId);
    if (marked) assert.ok(forcedCoreIds(units, roles, [], opts.isComponent).includes(x.characterId), x.characterId);
  }
  assert.deepEqual(forcedCoreIds(null, roles, ['Azir']), ['Azir']);
});
