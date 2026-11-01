// Tests fuer die Bretter einer Comp (tft-comp-build-group.ts).
//
// Warum: Unterzeilen der Liste, Knoepfe der Detailseite und die genaue Ansicht
// muessen dieselbe Gruppe bilden, sonst springt die Spielzahl nach dem Klick.
//
// Lauf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { boardGroupMembers, boardGroups, boardJoinRule, sumBoardUnits } from './tft-comp-build-group.ts';
import { buildCompFamilies } from './tft-comp-families.ts';

const opts = extra => ({ keyOf: r => r.key, gamesOf: r => r.games, boardOf: r => r.board, ...extra });
const keys = groups => groups.map(g => g.rows.map(r => r.key));

// Echte Zeilen Lunar · Lux, alle Regionen, Diamond+, 30.10.2026 (Live-API).
const LUNAR = [
  { key: 'Lunar@4_Lux', games: 98, board: ['Alune', 'Diana', 'Lux', 'Sentinel', 'Taric', 'Rakan', 'Fiddle', 'Aphelios', 'Lillia'] },
  { key: 'Lunar@2_Lux', games: 82, board: ['Lux', 'Alune', 'Sentinel', 'Diana', 'Taric', 'Lillia', 'Aphelios', 'Fiddle'] },
  { key: 'Lunar@3_Lux', games: 503, board: ['Lux', 'Alune', 'Diana', 'Sentinel', 'Fiddle', 'Lillia', 'Taric', 'Ivern', 'Rakan'] },
  { key: 'Lunar@1_Lux', games: 633, board: ['Alune', 'Lux', 'Diana', 'Sentinel', 'Fiddle', 'Lillia', 'Taric', 'Rakan', 'Ivern'] },
];

test('Lunar: gleiche Units und enthaltenes Brett ergeben 2 Gruppen, keine Zeile geht verloren', () => {
  const groups = boardGroups(LUNAR, opts());
  assert.deepEqual(keys(groups), [['Lunar@1_Lux', 'Lunar@3_Lux'], ['Lunar@4_Lux', 'Lunar@2_Lux']]);
  assert.deepEqual(groups[1].boardRows.map(r => r.key), ['Lunar@4_Lux'], 'gezeigt wird das vollere Brett');
  assert.equal(groups[1].board.length, 9);
  assert.equal(groups.flatMap(g => g.rows).reduce((s, r) => s + r.games, 0), 1316);
});

test('Ergebnis haengt nicht von der Reihenfolge ab', () => {
  const a = boardGroups(LUNAR, opts());
  const b = boardGroups([...LUNAR].reverse(), opts());
  assert.deepEqual(keys(a), keys(b));
  assert.deepEqual(a.map(g => g.board), b.map(g => g.board));
});

test('Negativfall: eine andere Unit bleibt ein anderes Brett', () => {
  const groups = boardGroups([
    { key: 'A', games: 10, board: ['a', 'b', 'c'] },
    { key: 'B', games: 20, board: ['a', 'b', 'd'] },
  ], opts());
  assert.equal(groups.length, 2);
});

test('Mehrere groessere Bretter: das meistgespielte, Gleichstand nach Schluessel', () => {
  const small = { key: 'S', games: 10, board: ['a', 'b'] };
  const x = { key: 'X', games: 20, board: ['a', 'b', 'c'] };
  const y = { key: 'Y', games: 50, board: ['a', 'b', 'd'] };
  assert.deepEqual(keys(boardGroups([small, x, y], opts())), [['Y', 'S'], ['X']]);
  const tie = { key: 'Z', games: 20, board: ['a', 'b', 'e'] };
  const groups = boardGroups([small, tie, x], opts());
  assert.deepEqual(groups[0].rows.map(r => r.key), ['X', 'S'], 'Gleichstand: gleiche Spiele, kleinere Units-Kennung gewinnt');
});

test('Kette: A in B in C landet komplett bei C, Anker bleibt das vollste Brett', () => {
  const groups = boardGroups([
    { key: 'A', games: 500, board: ['a'] },
    { key: 'B', games: 100, board: ['a', 'b'] },
    { key: 'C', games: 10, board: ['a', 'b', 'c'] },
  ], opts());
  assert.deepEqual(keys(groups), [['A', 'B', 'C']]);
  assert.deepEqual(groups[0].boardRows.map(r => r.key), ['C']);
});

test('Zeilen ohne Units bleiben fuer sich', () => {
  const groups = boardGroups([
    { key: 'leer', games: 5, board: [] },
    { key: 'A', games: 10, board: ['a'] },
  ], opts());
  assert.equal(groups.length, 2);
});

// Reroll-Regel wie tft-comp-merge: Haupt-Traeger kostet <=3, ≥40 % auf 3 Sternen.
const unit = (characterId, games, items = 0, star3Games = 0) => ({
  characterId, count: games, gamesWithUnit: games, star3Games,
  topItems: items ? [{ apiName: 'IE', count: items }] : [],
});
const rule = extra => boardJoinRule({
  gamesOf: r => r.games,
  unitsOf: r => r.typicalUnits,
  costOf: id => ({ Xayah: 2, Aphelios: 4, Lux: 5 })[id] ?? 1,
  isComponent: () => false,
  ...extra,
});

test('Reroll bleibt fuer sich, Teil-Comp-Grenze haelt', () => {
  const reroll = { key: 'E@0', games: 100, board: ['Xayah', 'b'], typicalUnits: [unit('Xayah', 100, 300, 60), unit('b', 100)] };
  const normal = { key: 'E@1', games: 100, board: ['Xayah', 'b', 'c'], typicalUnits: [unit('Aphelios', 100, 300), unit('Xayah', 100), unit('b', 100)] };
  assert.equal(boardGroups([reroll, normal], opts({ canJoin: rule() })).length, 2, 'Reroll zu Nicht-Reroll');
  const plain = { ...reroll, typicalUnits: [unit('Aphelios', 100, 300), unit('b', 100)] };
  assert.equal(boardGroups([plain, normal], opts({ canJoin: rule() })).length, 1, 'beide ohne Reroll');
  const parted = rule({ partOf: r => r.part });
  assert.equal(boardGroups([{ ...plain, part: 'p1' }, { ...normal, part: 'p2' }], opts({ canJoin: parted })).length, 2, 'andere Teil-Comp');
  assert.equal(boardGroups([{ ...plain, part: 'p1' }, { ...normal, part: 'p1' }], opts({ canJoin: parted })).length, 1);
});

test('boardGroupMembers: eigene Kennung vorn, ohne Zeile nur sie selbst', () => {
  assert.deepEqual(boardGroupMembers(LUNAR, 'Lunar@2_Lux', opts()), ['Lunar@2_Lux', 'Lunar@4_Lux']);
  assert.deepEqual(boardGroupMembers(LUNAR, 'Lunar@9_Lux', opts()), ['Lunar@9_Lux']);
});

test('sumBoardUnits: Zahlen ueber alle Zeilen, Zusatz-Unit aus restUnits, 3★ bleibt', () => {
  const big = { typicalUnits: [
    { characterId: 'a', count: 98, gamesWithUnit: 98, star3Games: 60, multiplicity: 1.5, cooccurrence: 1, topItems: [{ apiName: 'IE', count: 50 }] },
    { characterId: 'Rakan', count: 41, gamesWithUnit: 41, star3Games: 0, cooccurrence: 0.42, topItems: [] },
  ] };
  const small = {
    typicalUnits: [{ characterId: 'a', count: 82, gamesWithUnit: 82, star3Games: 10, multiplicity: 1, cooccurrence: 1, topItems: [{ apiName: 'IE', count: 10 }, { apiName: 'BT', count: 30 }] }],
    restUnits: [['Rakan', 20], ['Andere', 5]],
  };
  const out = sumBoardUnits([big, small], big.typicalUnits, 180);
  assert.deepEqual(out.map(u => u.characterId), ['a', 'Rakan'], 'Units des gezeigten Bretts, keine fremden');
  assert.equal(out[0].gamesWithUnit, 180);
  assert.equal(out[0].star3Games, 70);
  assert.deepEqual(out[0].topItems, [{ apiName: 'IE', count: 60 }, { apiName: 'BT', count: 30 }]);
  assert.ok(Math.abs(out[0].multiplicity - (1 + 49 / 180)) < 1e-9);
  assert.equal(out[1].gamesWithUnit, 61, '41 + 20 aus der Zeile, die sie nicht zeigt');
  assert.ok(Math.abs(out[1].cooccurrence - 61 / 180) < 1e-9);
});

test('Liste nutzt dieselben Gruppen; Familien-Summe bleibt, Brett und Anteile stimmen', () => {
  const row = (r, extra = {}) => ({
    slug: r.key, clusterKey: r.key, compKey: 'Lunar__Lux', games: r.games,
    avgPlacement: 4, top4Rate: 0.5, top1Rate: 0.1, pickRate: 0.01,
    typicalUnits: r.board.map(id => unit(id, r.games)),
    ...extra,
  });
  const assets = { set: 18, champions: {}, items: {}, traits: {} };
  const rows = [
    row(LUNAR[0]),
    row(LUNAR[1], { restUnits: [['Rakan', 20]] }),
    row(LUNAR[2]),
    row(LUNAR[3]),
  ];
  const [fam] = buildCompFamilies(rows, 'avg', assets);
  const server = boardGroups(LUNAR, opts());
  assert.deepEqual(
    fam.variants.map(v => v.games).sort((a, b) => b - a),
    server.map(g => g.rows.reduce((s, r) => s + r.games, 0)),
  );
  assert.equal(fam.totalGames, 1316);
  const nine = fam.variants.find(v => v.games === 180);
  assert.equal(nine.slug, 'Lunar@4_Lux');
  assert.equal(nine.typicalUnits.length, 9);
  assert.equal(nine.typicalUnits.find(u => u.characterId === 'Rakan').gamesWithUnit, 118, '98 + 20');
});

test('Ohne Asset-Bundle: nur gleiche Units, kein Zusammenlegen ohne Reroll-Pruefung', () => {
  const rows = LUNAR.map(r => ({
    slug: r.key, clusterKey: r.key, compKey: 'L', games: r.games, avgPlacement: 4, top4Rate: 0.5, top1Rate: 0.1, pickRate: 0.01,
    typicalUnits: r.board.map(id => unit(id, r.games)),
  }));
  assert.equal(buildCompFamilies(rows, 'avg', null)[0].variants.length, 3);
});

test('Keine zweite Gruppier-Regel im Code', () => {
  const offenders = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(name) || name === 'tft-comp-build-group.ts') continue;
      if (/\b(compBuildHash|buildHash|byBuild)\b/.test(readFileSync(p, 'utf8'))) offenders.push(p);
    }
  };
  walk(join(process.cwd(), 'app'));
  assert.deepEqual(offenders, []);
});
