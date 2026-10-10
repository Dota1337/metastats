/**
 * Zuschnitt der Overwolf-App-Antworten (companion-api.ts).
 *
 * Geprueft wird, was die App sonst falsch anzeigen wuerde: Mitspieler-Zeilen
 * oder Augments im eigenen Verlauf, relative Bildpfade, die in der App ins
 * Leere zeigen, und Rezepte fuer Items, die gar keine Rezepte sind.
 *
 * Lauf: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  absoluteUrl,
  buildCompanionVs,
  companionStats,
  memberKeyOf,
  rerollPlan,
  resolveBoard,
  toCompanionLookups,
  unitsAtPlayerLevel,
  toCompanionMatch,
  pickLobbyAccount,
  toLobbyEntry,
  COMPANION_CORS_HEADERS,
  SITE_ORIGIN,
} from './companion-api.ts';

test('absoluteUrl: relative Pfade bekommen die Seite davor, absolute bleiben', () => {
  assert.equal(absoluteUrl('/api/img/a.png'), `${SITE_ORIGIN}/api/img/a.png`);
  assert.equal(absoluteUrl('https://x.org/a.png'), 'https://x.org/a.png');
  assert.equal(absoluteUrl(null), null);
  assert.equal(absoluteUrl(''), null);
});

test('CORS: offen fuer alle Herkuenfte, nur lesend', () => {
  assert.equal(COMPANION_CORS_HEADERS['Access-Control-Allow-Origin'], '*');
  assert.equal(COMPANION_CORS_HEADERS['Access-Control-Allow-Methods'], 'GET, OPTIONS');
});

test('toCompanionMatch: nur die eigene Zeile, keine Augments, aktive Traits zuerst', () => {
  const m = {
    matchId: 'EUW1_1',
    gameDatetime: 1000,
    queueId: 1100,
    participants: [
      { puuid: 'other', placement: 1, units: [{ characterId: 'X' }] },
      {
        puuid: 'me',
        placement: 4,
        level: 8,
        augments: ['DA_Augment_Secret'],
        traits: [
          { name: 'T_off', numUnits: 1, style: 0 },
          { name: 'T_bronze', numUnits: 2, style: 1 },
          { name: 'T_gold', numUnits: 4, style: 3 },
        ],
        units: [{ characterId: 'A', tier: 2, itemNames: ['I1'] }, { characterId: 'B' }],
      },
    ],
  };
  const out = toCompanionMatch(m, 'me');
  assert.equal(out.placement, 4);
  assert.deepEqual(out.traits.map(t => t.id), ['T_gold', 'T_bronze']);
  assert.deepEqual(out.units, [{ id: 'A', star: 2, items: ['I1'] }, { id: 'B', star: 1, items: [] }]);
  assert.ok(!JSON.stringify(out).includes('Augment'));
  assert.ok(!JSON.stringify(out).includes('other'));
});

test('toCompanionMatch: Spiel ohne eigene Zeile faellt weg', () => {
  assert.equal(toCompanionMatch({ matchId: 'x', participants: [{ puuid: 'a', placement: 1 }] }, 'me'), null);
  assert.equal(toCompanionMatch({ participants: [{ puuid: 'me', placement: 1 }] }, 'me'), null);
});

test('toCompanionLookups: nur Set-Champions, alle aktiven Items ausser Augmenten', () => {
  const assets = {
    set: 18,
    iconBase: 'https://raw.communitydragon.org/latest/game/',
    champions: {
      U1: { name: 'Unit', cost: 3, icon: 'u.png', tile: '/api/img/u.png', traits: ['T1'] },
      M1: { name: 'Monster', cost: 0, icon: 'm.png', traits: [] },
    },
    items: {
      C1: { name: 'Comp1', icon: 'c1.png', tags: ['component'] },
      C2: { name: 'Comp2', icon: 'c2.png', tags: ['component'] },
      F1: { name: 'Full', icon: 'f1.png', composition: ['C1', 'C2'] },
      R1: { name: 'Radiant', icon: 'r1.png', composition: ['F1'] },
      N1: { name: 'Not active', icon: 'n1.png', composition: ['C1', 'C1'] },
      A1: { name: 'Artifact', icon: 'assets/maps/tft/icons/items/hexcore/a1.png' },
      Z1: { name: 'Aftershock', icon: 'assets/ux/tft/hud/zaps/wands/z1.png' },
      E1: { name: 'Emblem', icon: 'e1.png', composition: ['X'] },
      DA_18_EmblemFooAugment: { name: 'Foo Emblem', icon: 'e2.png' },
    },
    traits: { T1: { name: 'Trait', icon: 't.png' } },
    augments: {},
    active: { items: ['C1', 'C2', 'F1', 'R1', 'A1', 'Z1', 'E1', 'DA_18_EmblemFooAugment'] },
  };
  const l = toCompanionLookups(assets);
  assert.deepEqual(Object.keys(l.champions), ['U1']);
  assert.equal(l.champions.U1.icon, `${SITE_ORIGIN}/api/img/u.png`);
  assert.deepEqual(Object.keys(l.items).sort(), ['A1', 'C1', 'C2', 'DA_18_EmblemFooAugment', 'E1', 'F1', 'R1']);
  assert.deepEqual(l.items.F1.recipe, ['C1', 'C2']);
  assert.equal(l.items.R1.recipe, undefined);
  assert.equal(l.items.C1.component, true);
  assert.equal(l.shopOdds[9].length, 5);
});

test('toCompanionMatch mit lobby: alle Spieler nach Platz, ohne Augments', () => {
  const m = {
    matchId: 'EUW1_2',
    gameDatetime: 2000,
    queueId: 1090,
    participants: [
      { puuid: 'me', placement: 3, level: 8, augments: ['DA_Augment_X'], units: [{ characterId: 'A' }] },
      { puuid: 'p1', riotIdName: 'Eins', placement: 1, level: 9, units: [{ characterId: 'B', tier: 3, itemNames: ['I1'] }] },
    ],
  };
  const out = toCompanionMatch(m, 'me', { lobby: true });
  assert.deepEqual(out.lobby.map(p => [p.puuid, p.placement, p.name]), [['p1', 1, 'Eins'], ['me', 3, null]]);
  assert.deepEqual(out.lobby[0].units, [{ id: 'B', star: 3, items: ['I1'] }]);
  assert.ok(!JSON.stringify(out).includes('Augment'));
  assert.equal(toCompanionMatch(m, 'me').lobby, undefined);
});

test('memberKeyOf: Familien-Schluessel ohne Stufe, Stern und Augment', () => {
  assert.equal(memberKeyOf('T_Star@6_Lulu*3~twotanky'), 'T_Star__Lulu');
  assert.equal(memberKeyOf('kaputt'), null);
});

test('buildCompanionVs: beide Richtungen, Zwei-Carry-Mitglieder zaehlen zur Comp, ab Mindest-Spielen', () => {
  const comps = [
    { key: 'A__x', members: ['A__x', 'A__y'] },
    { key: 'B__z', members: ['B__z'] },
  ];
  const pairs = [
    { a_key: 'A@4_x', b_key: 'B@6_z', games: 20, a_better: 15 },
    { a_key: 'A@6_y*3', b_key: 'B@4_z', games: 20, a_better: 5 },
    { a_key: 'A@4_x', b_key: 'A@6_y', games: 50, a_better: 25 }, // gleiche Comp
    { a_key: 'C@4_q', b_key: 'B@4_z', games: 99, a_better: 50 }, // nicht in der Liste
  ];
  const vs = buildCompanionVs(comps, pairs);
  assert.deepEqual(vs['A__x']['B__z'], [40, 0.5]);
  assert.deepEqual(vs['B__z']['A__x'], [40, 0.5]);
  assert.equal(vs['A__x']['A__x'], undefined);
  assert.deepEqual(buildCompanionVs(comps, pairs, 41), {});
});

test('resolveBoard: staerkster Anteil zuerst, Ausweichen ins naechste Feld, immer gleich', () => {
  const shares = {
    U1: [{ cell: 3, share: 0.9 }],
    U2: [{ cell: 3, share: 0.6 }, { cell: 10, share: 0.2 }],
    U3: [{ cell: 3, share: 0.5 }],
    U4: [],
  };
  const out = resolveBoard(['U3', 'U2', 'U1', 'U4'], shares);
  assert.deepEqual(out, [{ unit: 'U1', cell: 3 }, { unit: 'U2', cell: 10 }, { unit: 'U3', cell: 2 }]);
  assert.deepEqual(resolveBoard(['U1', 'U2', 'U3'], shares), out);
});

test('companionStats: gerundet, fehlende Werte null', () => {
  assert.deepEqual(companionStats({ games: 12, avgPlacement: 4.256, top4Rate: 0.51234, top1Rate: null }),
    { games: 12, avg: 4.26, top4: 0.512, win: null });
});

test('rerollPlan: Carry bis 3 Kosten mit Familien-3-Sterne-Anteil ab 0,55, Stufe aus den Kosten', () => {
  const cost = { A: 3, B: 2, C: 4, D: 1 };
  const variants = [
    { typicalUnits: [{ characterId: 'A', gamesWithUnit: 100, star3Games: 70 }, { characterId: 'C', gamesWithUnit: 100, star3Games: 90 }] },
    { typicalUnits: [{ characterId: 'A', gamesWithUnit: 100, star3Games: 50 }, { characterId: 'B', gamesWithUnit: 100, star3Games: 40 }] },
  ];
  // A: 120/200 = 0,6 -> Reroll auf 7; C kostet 4 -> zaehlt nicht; B 0,4 -> zu wenig.
  assert.deepEqual(rerollPlan(['A', 'B', 'C'], variants, id => cost[id]), { level: 7, targets: ['A'] });
  // Nur Units aus der Kandidatenliste zaehlen.
  assert.equal(rerollPlan(['B', 'C'], variants, id => cost[id]), null);
  // Hoechster Anteil entscheidet die Stufe, gleiche Kosten kommen mit.
  const v2 = [{ typicalUnits: [
    { characterId: 'A', gamesWithUnit: 100, star3Games: 60 },
    { characterId: 'D', gamesWithUnit: 100, star3Games: 90 },
  ] }];
  assert.deepEqual(rerollPlan(['A', 'D'], v2, id => cost[id]), { level: 5, targets: ['D'] });
  // Zu wenige Spiele -> kein Reroll.
  assert.equal(rerollPlan(['D'], [{ typicalUnits: [{ characterId: 'D', gamesWithUnit: 4, star3Games: 4 }] }], id => cost[id]), null);
});

test('unitsAtPlayerLevel: die haeufigsten Units auf der Stufe, hoechstens so viele wie die Stufe', () => {
  const units = [
    { characterId: 'A', levelGames: { 7: 50, 8: 10 } },
    { characterId: 'B', levelGames: { 7: 80 } },
    { characterId: 'C', levelGames: { 8: 30 } },
    { characterId: 'D', levelGames: { 7: 50 } },
    { characterId: 'E' },
  ];
  assert.deepEqual(unitsAtPlayerLevel(units, 7), ['B', 'A', 'D']);
  assert.deepEqual(unitsAtPlayerLevel(units, 8), ['C', 'A']);
  assert.deepEqual(unitsAtPlayerLevel(units.concat(Array.from({ length: 10 }, (_, i) => ({ characterId: `X${i}`, levelGames: { 5: i + 1 } }))), 5).length, 5);
});

test('pickLobbyAccount: Tag ohne Gross/Klein, Region der Partie zuerst, sonst erster Treffer', () => {
  const hits = [
    { puuid: 'a', tagLine: 'EUW', region: 'na1', tier: 'GOLD', division: 'I', lp: 10 },
    { puuid: 'b', tagLine: 'euw', region: 'euw1', tier: null, division: null, lp: null },
    { puuid: 'c', tagLine: 'KR1', region: 'kr', tier: null, division: null, lp: null },
  ];
  assert.equal(pickLobbyAccount(hits, 'EUW', 'EUW1')?.puuid, 'b');
  assert.equal(pickLobbyAccount(hits, 'euw', null)?.puuid, 'a');
  assert.equal(pickLobbyAccount(hits, 'EUW', 'kr')?.puuid, 'a');
  assert.equal(pickLobbyAccount(hits, 'TR1', 'tr1'), null);
});

test('toLobbyEntry: Rang, Platzierungen und haeufigste Carries; unbekannt = leer', () => {
  const acc = { puuid: 'a', tagLine: 'EUW', region: 'euw1', tier: 'MASTER', division: 'I', lp: 120 };
  const games = [
    { placement: 1, carry: 'X' }, { placement: 5, carry: 'Y' }, { placement: 2, carry: 'X' },
    { placement: 8, carry: null }, { placement: 3, carry: 'Z' }, { placement: 4, carry: 'W' },
  ];
  const e = toLobbyEntry('A#EUW', acc, games);
  assert.deepEqual(e.recent, [1, 5, 2, 8, 3, 4]);
  assert.deepEqual(e.carries, [{ unit: 'X', games: 2 }, { unit: 'Y', games: 1 }, { unit: 'Z', games: 1 }]);
  assert.equal(e.found, true);
  assert.equal(e.tier, 'MASTER');
  const none = toLobbyEntry('B#EUW', null, []);
  assert.deepEqual(none, { name: 'B#EUW', found: false, tier: null, division: null, lp: null, recent: [], carries: [] });
});
