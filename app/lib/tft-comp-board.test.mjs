/**
 * Aufstellungsbrett der Comp-Liste und der Overwolf-App (tft-comp-board.ts).
 *
 * Geprueft wird, was auf der Seite sonst falsch stuende: ein Reiter mit dem
 * Brett einer anderen Stufe, zwei Units auf einem Feld, ein Levelplan aus
 * einer anderen MetaTFT-Comp als die Positionen, und ein Brett, das auf der
 * Seite anders aussieht als in der App.
 *
 * Lauf: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  boardLayout,
  buildCompBoards,
  compBoardPlants,
  compPositioning,
  defaultLevel,
  earlyBoards,
  parseGuideParam,
  pickLevelBoards,
  resolveBoard,
  unitsAtPlayerLevel,
} from './tft-comp-board.ts';

// Neun feste Units plus zwei, die nur auf Stufe 9 dazukommen.
const UNITS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].map(u => `TFT17_${u}`);

function fixtureComp() {
  const levelGames = (i) => ({
    7: i < 7 ? 300 - i : 0,
    8: i < 8 ? 200 - i : 0,
    9: i < 9 ? 150 - i : i === 9 ? 10 : 0,
    6: i < 6 ? 40 : 0,
  });
  return {
    typicalUnits: UNITS.slice(0, 9).map(characterId => ({ characterId })),
    mergedFamilies: ['TFT17_Flora__TFT17_A'],
    outcome: {
      levels: [
        { level: 6, games: 40, share: 0.05, top4Rate: 0.2 },
        { level: 7, games: 300, share: 0.4, top4Rate: 0.4 },
        { level: 8, games: 200, share: 0.35, top4Rate: 0.7 },
        { level: 9, games: 49, share: 0.2, top4Rate: 0.9 },
      ],
      units: UNITS.map((characterId, i) => ({ characterId, levelGames: levelGames(i) })),
    },
  };
}

// Jede Unit hat ein eigenes Lieblingsfeld; Unit i steht auf Feld i.
function fakeShares() {
  const calls = [];
  const fn = async (ids, ctx) => {
    calls.push({ ids: [...ids], ctx });
    return {
      units: Object.fromEntries(ids.map(id => [id, [{ cell: UNITS.indexOf(id), share: 0.5 }]])),
      source: 'metatft',
    };
  };
  return { fn, calls };
}

const GUIDES = {
  familyMap: { TFT17_Flora__TFT17_A: 'g1' },
  comps: [{ id: 'g1', units: UNITS.slice(0, 9), games: 1000, levelling: 'lvl 7' }],
  details: {
    g1: {
      levels: [
        { level: 5, stage: '2', round: '1', count: 900 },
        { level: 7, stage: '4', round: '1', count: 800 },
        { level: 8, stage: '', round: '', count: 500 },
      ],
      earlyByLevel: {
        4: [{ units: ['TFT17_A'], count: 49, avg: 4 }, { units: ['TFT17_B'], count: 50, avg: 4.123 }],
        5: [{ units: [], count: 500, avg: 4 }],
      },
      carousel: [],
      positions: {},
      rerolls: null,
    },
  },
};

test('boardLayout: vorderste Reihe oben, gerade Reihen ein halbes Feld versetzt, 28 Felder', () => {
  const rows = boardLayout();
  assert.deepEqual(rows.map(r => r.row), [3, 2, 1, 0]);
  assert.deepEqual(rows.map(r => r.shift), [false, true, false, true]);
  assert.deepEqual(rows[0].cells, [21, 22, 23, 24, 25, 26, 27]);
  assert.deepEqual(rows[3].cells, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(rows.flatMap(r => r.cells)).size, 28);
});

test('defaultLevel: meiste Top-4-Spiele, nicht der groesste Anteil; Gleichstand -> mehr Spiele, dann niedrigere Stufe', () => {
  // 7: 300 × 0,4 = 120, 8: 200 × 0,7 = 140 → Stufe 8, obwohl 7 haeufiger ist.
  assert.equal(defaultLevel([{ level: 7, games: 300, top4Rate: 0.4 }, { level: 8, games: 200, top4Rate: 0.7 }]), 8);
  assert.equal(defaultLevel([{ level: 8, games: 100, top4Rate: 0.5 }, { level: 7, games: 50, top4Rate: 1 }]), 8);
  assert.equal(defaultLevel([{ level: 9, games: 100, top4Rate: 0.5 }, { level: 8, games: 100, top4Rate: 0.5 }]), 8);
  assert.equal(defaultLevel([{ level: 8, games: 10, top4Rate: null }]), 8);
  assert.equal(defaultLevel([]), null);
});

test('resolveBoard: zwei Units mit demselben Lieblingsfeld landen nie auf einem Feld', () => {
  const shares = { X: [{ cell: 24, share: 0.8 }], Y: [{ cell: 24, share: 0.8 }] };
  const out = resolveBoard(['Y', 'X'], shares);
  assert.equal(out.length, 2);
  assert.equal(new Set(out.map(c => c.cell)).size, 2);
  // Gleichstand: alphabetisch zuerst; der zweite weicht in derselben Reihe aus.
  assert.deepEqual(out, [{ unit: 'X', cell: 24 }, { unit: 'Y', cell: 23 }]);
});

test('resolveBoard: Pflanzen erst nach allen Units, Ausweichen erst dieselbe Reihe, dann die Nachbarreihe', () => {
  const shares = { X: [{ cell: 3, share: 0.2 }], Y: [{ cell: 4, share: 0.9 }] };
  // Pflanze will Feld 3 staerker als X — die Unit bekommt es trotzdem.
  const plantShares = { P: [{ cell: 3, share: 0.95 }, { cell: 10, share: 0.5 }], Q: [{ cell: 0, share: 0.4 }] };
  const out = resolveBoard(['X', 'Y'], shares, ['P', 'Q'], plantShares);
  assert.deepEqual(out, [{ unit: 'Y', cell: 4 }, { unit: 'X', cell: 3 }, { unit: 'P', cell: 10 }, { unit: 'Q', cell: 0 }]);
  // Reihe 0 voll bis auf nichts: die Pflanze weicht in Reihe 1 aus, nicht nach vorn.
  const row0 = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(c => [`U${c}`, [{ cell: c, share: 0.5 }]]));
  const full = resolveBoard(Object.keys(row0), row0, ['P'], { P: [{ cell: 2, share: 0.9 }] });
  assert.deepEqual(full.at(-1), { unit: 'P', cell: 9 });
  // Zwei Kopien derselben Pflanze landen auf zwei Feldern.
  const two = resolveBoard([], {}, ['P', 'P'], { P: [{ cell: 5, share: 0.9 }] });
  assert.deepEqual(two.map(c => c.cell), [5, 4]);
  // Ohne Feld-Anteile keine Pflanze.
  assert.deepEqual(resolveBoard([], {}, ['P'], {}), []);
});

test('buildCompBoards: Pflanzen nach Elderwood-Zahl je Brett, eigene Abfrage, nie auf einem Unit-Feld', async () => {
  const STONE = 'DA_Elderwood18_StonebarkTree';
  const BLOOM = 'DA_Elderwood18_Lifeblossom';
  const plantBundle = {
    traits: { DA_18_Elderwood: { name: 'Elderwood', tiers: [3, 5, 7, 9, 11].map(minUnits => ({ minUnits })) } },
    // A-C sind Elderwood: auf Stufe 7 und 8 je 3 → Baum + Blume.
    champions: Object.fromEntries(['A', 'B', 'C'].map(u => [`TFT17_${u}`, { traits: ['Elderwood'] }])),
  };
  const plantCalls = [];
  // Lieblingsfeld der Pflanzen liegt auf Units (Feld 0 und 1).
  const fetchPlants = async (ids) => {
    plantCalls.push(ids);
    return { [STONE]: [{ cell: 0, share: 0.9 }], [BLOOM]: [{ cell: 1, share: 0.8 }] };
  };
  const { fn } = fakeShares();
  const opts = { comp: fixtureComp(), fetchShares: fn, guides: GUIDES, levelRange: [7, 9], minLevelGames: 50, earlyMinGames: 50 };
  const out = await buildCompBoards({ ...opts, plants: compBoardPlants(plantBundle, null, fetchPlants) });
  for (const lvl of ['7', '8']) {
    const board = out.boardsByPlayerLevel[lvl];
    assert.deepEqual(board.filter(c => c.unit.startsWith('DA_')).map(c => c.unit).sort(), [BLOOM, STONE]);
    assert.equal(new Set(board.map(c => c.cell)).size, board.length, `Stufe ${lvl}: zwei auf einem Feld`);
    assert.equal(board.find(c => c.unit === 'TFT17_A').cell, 0);
  }
  assert.equal(plantCalls.length, 1);
  // Mit Emblem in der Haelfte der Spiele: 4 Elderwood → weiter Stufe 1, gleiche Pflanzen.
  const emblem = { basis: 'games', rows: [{ item: 'DA_18_EmblemElderwood', share: 0.6 }] };
  const withEmblem = await buildCompBoards({ ...opts, plants: compBoardPlants(plantBundle, emblem, fetchPlants) });
  assert.equal(withEmblem.boardsByPlayerLevel['7'].filter(c => c.unit.startsWith('DA_')).length, 2);
  // Ohne Elderwood-Units keine Pflanzen-Abfrage.
  const none = { ...plantBundle, champions: {} };
  plantCalls.length = 0;
  const plain = await buildCompBoards({ ...opts, plants: compBoardPlants(none, null, fetchPlants) });
  assert.equal(plantCalls.length, 0);
  assert.ok(Object.values(plain.boardsByPlayerLevel).every(b => b.every(c => !c.unit.startsWith('DA_'))));
  // Trait fehlt im Bundle: keine Pflanzen-Option.
  assert.equal(compBoardPlants({ traits: {}, champions: {} }, null, fetchPlants), undefined);
});

test('unitsAtPlayerLevel: nie mehr Units als die Stufe, auch wenn mehr auf der Stufe gespielt wurden', () => {
  const units = fixtureComp().outcome.units;
  assert.equal(unitsAtPlayerLevel(units, 9).length, 9);
  assert.ok(!unitsAtPlayerLevel(units, 9).includes('TFT17_J'));
  assert.deepEqual(unitsAtPlayerLevel(units, 7), UNITS.slice(0, 7));
});

test('buildCompBoards (Seite): nur Stufen 7-9 ab 50 Spielen, Brett je Stufe mit genau den Units der Stufe', async () => {
  const { fn, calls } = fakeShares();
  const out = await buildCompBoards({
    comp: fixtureComp(), fetchShares: fn, guides: GUIDES,
    levelRange: [7, 9], minLevelGames: 50, earlyMinGames: 50,
  });
  // Stufe 6 liegt ausserhalb, Stufe 9 hat nur 49 Spiele.
  assert.deepEqual(Object.keys(out.boardsByPlayerLevel), ['7', '8']);
  assert.deepEqual(out.boardsByPlayerLevel['7'].map(c => c.unit).sort(), UNITS.slice(0, 7));
  assert.deepEqual(out.boardsByPlayerLevel['8'].map(c => c.cell), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(out.boardSource, 'metatft');
  assert.equal(out.board.length, 9);
  // MetaTFT-Zuordnung ueber den Familien-Eintrag; by-units bekommt sie mit.
  assert.equal(out.guideId, 'g1');
  assert.ok(calls.every(c => c.ctx.guide === 'g1' && c.ctx.families[0] === 'TFT17_Flora__TFT17_A'));
  // Levelplan-Schritte ohne Stage fallen weg; Early-Boards erst ab 50 Spielen.
  assert.deepEqual(out.levelTiming, [{ level: 5, stage: '2-1' }, { level: 7, stage: '4-1' }]);
  assert.deepEqual(out.early, { 4: [{ units: ['TFT17_B'], games: 50, avg: 4.12 }] });
});

test('buildCompBoards (Detailseite): fruehe Boards als Brett, nur mit withEarlyBoards, ohne Extra-Abfrage', async () => {
  const guides = structuredClone(GUIDES);
  guides.details.g1.earlyByLevel = {
    5: [{ units: ['TFT17_A'], count: 60, avg: 4.4 }, { units: ['TFT17_K', 'TFT17_J'], count: 200, avg: 3.9 }],
    6: [{ units: ['TFT17_B'], count: 49, avg: 4 }],
  };
  const opts = { comp: fixtureComp(), guides, levelRange: [7, 9], minLevelGames: 50, earlyMinGames: 50 };
  const off = fakeShares();
  const without = await buildCompBoards({ ...opts, fetchShares: off.fn });
  assert.equal(without.earlyBoardsByLevel, undefined);
  const on = fakeShares();
  const withEarly = await buildCompBoards({ ...opts, fetchShares: on.fn, withEarlyBoards: true });
  // Das meistgespielte Board je Stufe; Stufe 6 hat keins ab 50 Spielen.
  assert.deepEqual(Object.keys(withEarly.earlyBoardsByLevel), ['5']);
  assert.deepEqual(withEarly.earlyBoardsByLevel['5'].map(c => c.cell).sort((a, b) => a - b), [9, 10]);
  // Die fruehen Units laufen in derselben Abfrage wie die Stufenbretter mit.
  assert.equal(on.calls.length, off.calls.length);
  assert.ok(on.calls.some(c => c.ids.includes('TFT17_K')));
  // Endbretter bleiben unberuehrt.
  assert.deepEqual(withEarly.boardsByPlayerLevel, without.boardsByPlayerLevel);
});

test('buildCompBoards: Seite und App zeigen auf derselben Stufe dasselbe Brett', async () => {
  const page = await buildCompBoards({
    comp: fixtureComp(), fetchShares: fakeShares().fn, guides: GUIDES,
    levelRange: [7, 9], minLevelGames: 50, earlyMinGames: 50,
  });
  const app = await buildCompBoards({
    comp: fixtureComp(), fetchShares: fakeShares().fn, guides: GUIDES,
    levelRange: [5, 9], minLevelGames: 30, earlyMinGames: 50,
  });
  assert.deepEqual(page.boardsByPlayerLevel['7'], app.boardsByPlayerLevel['7']);
  assert.deepEqual(page.boardsByPlayerLevel['8'], app.boardsByPlayerLevel['8']);
  assert.deepEqual(Object.keys(app.boardsByPlayerLevel), ['6', '7', '8', '9']);
});

test('buildCompBoards: mehr als 12 Units je Abfrage werden aufgeteilt', async () => {
  const many = Array.from({ length: 14 }, (_, i) => `TFT17_U${i}`);
  const comp = {
    typicalUnits: [],
    outcome: {
      levels: [{ level: 7, games: 100 }, { level: 9, games: 100 }],
      units: many.map((characterId, i) => ({ characterId, levelGames: { 7: i < 7 ? 50 : 0, 9: i >= 5 ? 60 + i : 0 } })),
    },
  };
  const calls = [];
  const out = await buildCompBoards({
    comp,
    fetchShares: async (ids) => {
      calls.push(ids.length);
      return { units: Object.fromEntries(ids.map(id => [id, [{ cell: many.indexOf(id), share: 0.3 }]])), source: 'companion' };
    },
    guides: null,
    levelRange: [7, 9], minLevelGames: 50, earlyMinGames: 50,
  });
  assert.ok(calls.every(n => n <= 12));
  assert.equal(calls.reduce((s, n) => s + n, 0), 14);
  assert.equal(out.boardsByPlayerLevel['9'].length, 9);
  assert.equal(out.guideId, null);
  assert.deepEqual(out.levelTiming, []);
  // Ohne typische Units gibt es kein Gesamtbrett.
  assert.deepEqual(out.board, []);
  assert.equal(out.boardSource, null);
});

test('buildCompBoards: ohne Feld-Anteile kein Brett und keine Quelle', async () => {
  const out = await buildCompBoards({
    comp: fixtureComp(), fetchShares: async () => null, guides: GUIDES,
    levelRange: [7, 9], minLevelGames: 50, earlyMinGames: 50,
  });
  assert.deepEqual(out.board, []);
  assert.equal(out.boardSource, null);
  assert.equal(out.boardsByPlayerLevel, undefined);
});

// Zweite MetaTFT-Comp, die die Zeile festnageln kann (die eigene Zuordnung
// faende g1 ueber den Familien-Eintrag).
const GUIDES2 = {
  ...GUIDES,
  comps: [...GUIDES.comps, { id: 'g2', units: ['TFT17_X'], games: 500, levelling: 'Fast 8' }],
  details: {
    ...GUIDES.details,
    g2: {
      levels: [{ level: 8, stage: '4', round: '2', count: 100 }],
      earlyByLevel: { 5: [{ units: ['TFT17_C'], count: 80, avg: 3.5 }] },
      carousel: [], positions: {}, rerolls: null,
    },
  },
};

test('parseGuideParam: none = keine Anleitung, Ziffern = ID, alles andere = selbst zuordnen', () => {
  assert.equal(parseGuideParam('none'), null);
  assert.equal(parseGuideParam('426032'), '426032');
  assert.equal(parseGuideParam('constructor'), undefined);
  assert.equal(parseGuideParam('1234567890123'), undefined);
  assert.equal(parseGuideParam(''), undefined);
  assert.equal(parseGuideParam(null), undefined);
});

test('buildCompBoards: festgenagelte Anleitung gilt fuer Positionen, Levelschritte und Early', async () => {
  const opts = { comp: fixtureComp(), guides: GUIDES2, levelRange: [7, 9], minLevelGames: 50, earlyMinGames: 50 };
  const pinned = fakeShares();
  const a = await buildCompBoards({ ...opts, fetchShares: pinned.fn, guideId: 'g2' });
  assert.equal(a.guideId, 'g2');
  assert.ok(pinned.calls.every(c => c.ctx.guide === 'g2'));
  assert.deepEqual(a.early, { 5: [{ units: ['TFT17_C'], games: 80, avg: 3.5 }] });
  assert.deepEqual(a.levelTiming, [{ level: 8, stage: '4-2' }]);

  // null: die Zeile hat keine Anleitung — dann auch das Detail nicht.
  const none = fakeShares();
  const b = await buildCompBoards({ ...opts, fetchShares: none.fn, guideId: null });
  assert.equal(b.guideId, null);
  assert.ok(none.calls.every(c => c.ctx.guide === null));
  assert.deepEqual(b.early, {});
  assert.deepEqual(b.levelTiming, []);

  // Unbekannte ID (alte Generation) und Objekt-Schluessel: selbst zuordnen.
  for (const guideId of ['999', 'constructor', undefined]) {
    const c = await buildCompBoards({ ...opts, fetchShares: fakeShares().fn, guideId });
    assert.equal(c.guideId, 'g1', String(guideId));
  }
});

test('compPositioning: Reiter 7-9 ab 50 Spielen, Startreiter, Levelplan — gleich, egal mit welchem Bereich gebaut', async () => {
  const levels = fixtureComp().outcome.levels;
  const page = await buildCompBoards({
    comp: fixtureComp(), fetchShares: fakeShares().fn, guides: GUIDES,
    levelRange: [7, 9], minLevelGames: 50, earlyMinGames: 50,
  });
  const app = await buildCompBoards({
    comp: fixtureComp(), fetchShares: fakeShares().fn, guides: GUIDES,
    levelRange: [5, 9], minLevelGames: 30, earlyMinGames: 50,
  });
  const p = compPositioning(page, levels, GUIDES);
  assert.deepEqual(compPositioning(app, levels, GUIDES), p);
  // Stufe 6 liegt ausserhalb, Stufe 9 hat nur 49 Spiele.
  assert.deepEqual(p.levels.map(l => l.level), [7, 8]);
  assert.deepEqual(Object.keys(p.boardsByPlayerLevel), ['7', '8']);
  // 7: 300 × 0,4 = 120, 8: 200 × 0,7 = 140.
  assert.equal(p.defaultLevel, 8);
  assert.equal(p.levelling, 'lvl 7');
  assert.deepEqual(p.plan, { kind: 'reroll', level: 7 });
  // Schritt ohne Stage faellt weg, die anderen beiden bleiben.
  assert.deepEqual(p.levelTiming, [{ level: 5, stage: '2-1' }, { level: 7, stage: '4-1' }]);

  // Ohne Anleitung: kein Levelplan, keine Schritte, Bretter bleiben.
  const bare = compPositioning({ ...page, guideId: null }, levels, GUIDES);
  assert.equal(bare.plan, null);
  assert.deepEqual(bare.levelTiming, []);
  assert.deepEqual(Object.keys(bare.boardsByPlayerLevel), ['7', '8']);
});

test('pickLevelBoards: altes App-Feld (5-9 ab 200) aus dem gemeinsamen Durchgang', async () => {
  const out = await buildCompBoards({
    comp: fixtureComp(), fetchShares: fakeShares().fn, guides: GUIDES,
    levelRange: [5, 9], minLevelGames: 30, earlyMinGames: 50,
  });
  const legacy = pickLevelBoards(out.boardsByPlayerLevel, fixtureComp().outcome.levels, [5, 9], 200);
  assert.deepEqual(Object.keys(legacy), ['7', '8']);
  assert.deepEqual(legacy['7'], out.boardsByPlayerLevel['7']);
  assert.equal(pickLevelBoards(out.boardsByPlayerLevel, [], [5, 9], 200), undefined);
});

test('earlyBoards: ab der Mindestzahl, leere Boards fallen weg', () => {
  assert.deepEqual(earlyBoards(GUIDES.details.g1, 50), { 4: [{ units: ['TFT17_B'], games: 50, avg: 4.12 }] });
  assert.deepEqual(earlyBoards(undefined), {});
});
