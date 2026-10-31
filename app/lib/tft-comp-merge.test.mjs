import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMergeRow, applyMerges, isRerollComp, mergePairs, mergeRowsForWindow, mergeTargets, newMergeInput, resolveMerges } from './tft-comp-merge.mjs';

const COST = { Soraka: 2, Gnar: 5, Lux: 5, Kennen: 3, Aphelios: 3, Elder: 5, Brambleback: 1, Pebbles: 1, Gromp: 2, Rengar: 4, Cass: 4, Ahri: 3, Ashe: 5, A: 1, B: 2, C: 3, D: 4, E: 2, F: 2, G: 3, H: 1, Reroll: 1 };
const costOf = id => COST[id];

// units: [id, Anteil, Items je Spiel, 3-Sterne-Anteil]
function comp(input, key, games, units) {
  addMergeRow(input, key, {
    games,
    units: units.map(([id, share, load = 0, star3 = 0]) => ({
      characterId: id,
      gamesWithUnit: Math.round(share * games),
      star3Games: Math.round(star3 * share * games),
      topItems: load > 0 ? [{ apiName: 'Item', count: Math.round(load * share * games) }] : [],
    })),
  });
}
const pairsOf = input => mergePairs(input, costOf).map(p => `${p.from}>${p.to}`);

test('Endstufe mit 5-Kosten-Key haengt an der Comp, deren Carry auf ihrem Brett steht', () => {
  const input = newMergeInput();
  comp(input, 'E__Soraka', 5000, [['Soraka', 1, 2], ['A', 1, 2], ['B', .9], ['C', .9], ['D', .8]]);
  comp(input, 'E__Gnar', 2000, [['Gnar', 1, 1], ['Soraka', .9, 2], ['A', 1, 2], ['B', .9], ['C', .9], ['D', .8]]);
  assert.deepEqual(pairsOf(input), ['E__Gnar>E__Soraka']);
});

test('Kette Lux → Gnar → Soraka zeigt nach dem Aufloesen direkt auf das Ziel', () => {
  const input = newMergeInput();
  comp(input, 'E__Soraka', 5000, [['Soraka', 1, 2], ['A', 1, 2], ['B', .9], ['C', .9], ['D', .8]]);
  comp(input, 'E__Gnar', 2000, [['Gnar', 1, 1], ['Soraka', .9, 2], ['A', 1, 2], ['B', .9], ['C', .9], ['D', .8]]);
  comp(input, 'E__Lux', 1000, [['Lux', 1, 2], ['Gnar', .95, 1], ['Soraka', .56, 2], ['A', 1, 2], ['B', .9], ['C', .9], ['D', .8]]);
  const res = resolveMerges(mergePairs(input, costOf), input);
  assert.deepEqual(res.map(m => [m.from, m.to]).sort(), [['E__Gnar', 'E__Soraka'], ['E__Lux', 'E__Soraka']]);
});

test('5-Kosten-Key ohne aehnliches Brett bleibt fuer sich', () => {
  const input = newMergeInput();
  comp(input, 'L__Aphelios', 5000, [['Aphelios', 1, 2], ['A', 1], ['B', 1], ['C', 1]]);
  comp(input, 'L__Lux', 900, [['Lux', 1, 2], ['Aphelios', .6, 1], ['D', 1], ['E', 1], ['F', 1], ['G', 1]]);
  assert.deepEqual(pairsOf(input), []);
});

test('gleiche Item-Traeger, gleicher Kern: Riftbeast mit Brambleback wird eine Comp', () => {
  const input = newMergeInput();
  const board = [['Brambleback', 1, 3], ['A', 1], ['B', 1], ['C', .9], ['D', .9]];
  comp(input, 'R__Gromp', 700, [...board, ['Gromp', 1]]);
  comp(input, 'R__Pebbles', 1900, [...board, ['Pebbles', 1]]);
  assert.deepEqual(pairsOf(input), ['R__Gromp>R__Pebbles']);
});

test('anderer Trait wird nie zusammengelegt', () => {
  const input = newMergeInput();
  const board = [['Brambleback', 1, 3], ['A', 1], ['B', 1], ['C', .9], ['D', .9]];
  comp(input, 'R__Gromp', 700, [...board, ['Gromp', 1]]);
  comp(input, 'S__Pebbles', 1900, [...board, ['Pebbles', 1]]);
  assert.deepEqual(pairsOf(input), []);
});

test('Reroll-Comp bleibt fuer sich, auch bei gleichem Kern', () => {
  const input = newMergeInput();
  const board = [['A', 1], ['B', 1], ['C', 1], ['D', 1]];
  comp(input, 'T__Reroll', 700, [['Reroll', 1, 3, .7], ...board]);
  comp(input, 'T__Gnar', 1900, [['Gnar', 1], ['Reroll', 1, 3, .1], ...board]);
  assert.equal(isRerollComp(input.get('T__Reroll'), costOf), true);
  assert.equal(isRerollComp(input.get('T__Gnar'), costOf), false);
  assert.deepEqual(pairsOf(input), []);
});

test('Reroll-Grenze: teurer Traeger ist kein Reroll, Anteil knapp darunter auch nicht', () => {
  const input = newMergeInput();
  comp(input, 'T__D', 500, [['D', 1, 3, .9]]);
  comp(input, 'T__A', 500, [['A', 1, 3, .39]]);
  comp(input, 'T__B', 500, [['B', 1, 3, .41]]);
  assert.equal(isRerollComp(input.get('T__D'), costOf), false);
  assert.equal(isRerollComp(input.get('T__A'), costOf), false);
  assert.equal(isRerollComp(input.get('T__B'), costOf), true);
});

test('Schutz: Unit mit vielen Items, die in der anderen kaum steht, trennt (Defender Rengar)', () => {
  const input = newMergeInput();
  const core = [['A', 1], ['B', 1], ['C', 1]];
  comp(input, 'D__Rengar', 700, [['Rengar', 1, 2.5], ['Cass', .3], ...core]);
  comp(input, 'D__Cass', 1900, [['Cass', 1, 2.5], ['Rengar', .2], ...core]);
  assert.deepEqual(pairsOf(input), []);
});

test('R2 ohne aehnliches Brett bleibt fuer sich (Blossom Gnar), Kern allein reicht nicht', () => {
  const input = newMergeInput();
  comp(input, 'B__Yi', 4000, [['Ahri', .9, 2], ['D', .92, 2], ['A', .94], ['B', .93], ['C', .74], ['E', .73], ['F', .61]]);
  comp(input, 'B__Gnar', 1500, [['Ahri', 1, 2], ['D', 1, 2], ['Gnar', 1, 1], ['G', .59], ['H', .58]]);
  assert.deepEqual(pairsOf(input), []);
});

test('zu wenig Spiele: keine Zuordnung', () => {
  const input = newMergeInput();
  const board = [['Brambleback', 1, 3], ['A', 1], ['B', 1], ['C', .9], ['D', .9]];
  comp(input, 'R__Gromp', 99, [...board, ['Gromp', 1]]);
  comp(input, 'R__Pebbles', 1900, [...board, ['Pebbles', 1]]);
  assert.deepEqual(pairsOf(input), []);
});

test('Gruppe: Ziel ist die meistgespielte Comp, auch wenn die Paare anders zeigen', () => {
  const input = newMergeInput();
  comp(input, 'R__Elder', 4000, []);
  comp(input, 'R__Gnar', 800, []);
  comp(input, 'R__Pebbles', 1900, []);
  const res = resolveMerges([
    { from: 'R__Elder', to: 'R__Gnar', rule: 'R1' },
    { from: 'R__Gnar', to: 'R__Pebbles', rule: 'R1' },
  ], input);
  assert.deepEqual(res.map(m => [m.from, m.to]).sort(), [['R__Gnar', 'R__Elder'], ['R__Pebbles', 'R__Elder']]);
});

test('Selbstbezug in den Paaren aendert nichts', () => {
  const input = newMergeInput();
  comp(input, 'R__Elder', 4000, []);
  assert.deepEqual(resolveMerges([{ from: 'R__Elder', to: 'R__Elder', rule: 'R1' }], input), []);
});

test('feste Zuordnungen bleiben, nur Zugaenge kommen dazu, Ziel bleibt Ziel', () => {
  const input = newMergeInput();
  comp(input, 'R__Pebbles', 1000, []);
  comp(input, 'R__Gromp', 900, []);
  comp(input, 'R__Elder', 5000, []); // inzwischen groesser als das gespeicherte Ziel
  const fixed = [{ from: 'R__Gromp', to: 'R__Pebbles', rule: 'R2' }];
  const res = resolveMerges([{ from: 'R__Elder', to: 'R__Gromp', rule: 'R1' }], input, fixed);
  assert.deepEqual(res.map(m => [m.from, m.to]), [['R__Elder', 'R__Pebbles']]);
});

test('zwei feste Gruppen werden nicht verschmolzen', () => {
  const input = newMergeInput();
  for (const k of ['R__A', 'R__B', 'R__C', 'R__D']) comp(input, k, 500, []);
  const fixed = [{ from: 'R__B', to: 'R__A', rule: 'R2' }, { from: 'R__D', to: 'R__C', rule: 'R2' }];
  assert.deepEqual(resolveMerges([{ from: 'R__B', to: 'R__D', rule: 'R2' }], input, fixed), []);
});

test('Lese-Seite: Ketten aufgeloest, Kreise brechen ab, Selbstbezug faellt weg', () => {
  const m = mergeTargets([
    { from_key: 'a', to_key: 'b' }, { from_key: 'b', to_key: 'c' },
    { from_key: 'x', to_key: 'y' }, { from_key: 'y', to_key: 'x' },
    { from_key: 's', to_key: 's' },
  ]);
  assert.equal(m.get('a'), 'c');
  assert.equal(m.get('b'), 'c');
  assert.equal(m.has('x'), false);
  assert.equal(m.has('y'), false);
  assert.equal(m.has('s'), false);
});

test('Fenster: je Patch-Familie die eigenen Zeilen, neue Familie nimmt die letzte, alte ohne Eintraege nichts', () => {
  const rows = [
    { patch_family: '18.5', from_key: 'a', to_key: 'b' },
    { patch_family: '18.4', from_key: 'c', to_key: 'd' },
  ];
  const keys = list => list.map(r => r.from_key);
  assert.deepEqual(keys(mergeRowsForWindow(rows, ['18.5'])), ['a']);
  assert.deepEqual(keys(mergeRowsForWindow(rows, ['18.4', '18.5'])), ['c', 'a']);
  assert.deepEqual(keys(mergeRowsForWindow(rows, ['18.6'])), ['a']);
  assert.deepEqual(keys(mergeRowsForWindow(rows, ['18.3'])), []);
  assert.deepEqual(keys(mergeRowsForWindow(rows, ['18.10'])), ['a']);
  assert.deepEqual(mergeRowsForWindow([], ['18.5']), []);
});

test('Sicht: Familien wandern zur Grund-Comp, Teile bleiben bekannt, fremde Ziele zaehlen nicht', () => {
  const lookup = new Map([['E__Lux', 'E__Lux'], ['E__LuxAlt', 'E__Lux'], ['E__Soraka', 'E__Soraka'], ['F__Ashe', 'F__Ashe']]);
  const res = applyMerges(lookup, new Map([['E__Lux', 'E__Soraka'], ['F__Ashe', 'F__Weg']]));
  assert.equal(res.lookup.get('E__Lux'), 'E__Soraka');
  assert.equal(res.lookup.get('E__LuxAlt'), 'E__Soraka');
  assert.equal(res.lookup.get('F__Ashe'), 'F__Ashe');
  assert.equal(res.partOf.get('E__LuxAlt'), 'E__Lux');
  assert.equal(res.partOf.get('E__Soraka'), 'E__Soraka');
  assert.equal(res.partOf.has('F__Ashe'), false);
  assert.deepEqual(res.parts.get('E__Soraka'), ['E__Soraka', 'E__Lux']);
  assert.ok(res.stamp);
  // Die Eingabe bleibt unberuehrt.
  assert.equal(lookup.get('E__Lux'), 'E__Lux');
});

test('Sicht ohne Zuordnung: nichts aendert sich, kein Stand', () => {
  const lookup = new Map([['E__Lux', 'E__Lux']]);
  const res = applyMerges(lookup, new Map());
  assert.equal(res.lookup, lookup);
  assert.equal(res.stamp, null);
  assert.equal(res.parts.size, 0);
});
