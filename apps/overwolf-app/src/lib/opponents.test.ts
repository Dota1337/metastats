import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CompanionComp } from '../../../../app/lib/companion-types.ts';
import type { OppBoard } from './boards.ts';
import type { RosterRow } from './store.ts';
import { opponentRows, boardStage } from './opponents.ts';

function comp(key: string, trait: string, ids: string[], carries: string[]): CompanionComp {
  return {
    key, slug: key, name: `${trait.toUpperCase()} · ${carries.join(' & ')}`, trait, carries, itemCarriers: [], tier: 'A',
    avg: 4, top4: 0.5, win: 0.1, pick: 0.01, games: 100, traitLevel: 4, avgLevel: 8,
    units: ids.map(id => ({ id })),
  };
}
function board(ids: string[], round = 42, stage: string | null = null): OppBoard {
  return { units: ids.map(unit => ({ unit, level: 1 })), round, stage };
}

const X = comp('x', 'tx', ['A', 'B', 'C', 'D', 'E', 'F', 'G'], ['G']);
const Y = comp('y', 'ty', ['H', 'I', 'J', 'K', 'L', 'M', 'N'], ['N']);
const XB = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const YB = ['H', 'I', 'J', 'K', 'L', 'M', 'N'];

const row = (name: string, health: number | null): RosterRow => ({ name, health, rank: null });

test('nur erkannte Bretter, sortiert nach Leben, naechster Gegner markiert', () => {
  const rows = opponentRows({
    oppBoards: { 'a#1': board(XB), 'b#2': board(YB), 'c#3': board(['A', 'B']) },
    roster: [row('a#1', 40), row('b#2', 80), row('c#3', 90), row('me#0', 70)],
    opponent: 'a#1',
  }, [X, Y]);
  assert.deepEqual(rows.map(r => [r.name, r.short, r.hp, r.next]), [['b#2', 'b', 80, false], ['a#1', 'a', 40, true]]);
  assert.equal(rows[0].rec.kind, 'sure');
});

test('ohne Spielerliste: alle gemerkten Bretter, nach Namen', () => {
  const rows = opponentRows({ oppBoards: { 'z#1': board(XB), 'a#2': board(YB) }, roster: [], opponent: null }, [X, Y]);
  assert.deepEqual(rows.map(r => [r.name, r.hp]), [['a#2', null], ['z#1', null]]);
});

test('mit Spielerliste: Bretter fremder Namen fallen heraus, Ausgeschiedene bleiben unten', () => {
  const rows = opponentRows({
    oppBoards: { 'alt#9': board(XB), 'raus#1': board(YB), 'da#2': board(XB) },
    roster: [row('raus#1', 0), row('da#2', 12), row('ohne#3', null)],
    opponent: null,
  }, [X, Y]);
  assert.deepEqual(rows.map(r => r.name), ['da#2', 'raus#1']);
});

test('Leben unbekannt steht hinter bekanntem', () => {
  const rows = opponentRows({
    oppBoards: { 'a#1': board(XB), 'b#2': board(YB) },
    roster: [row('a#1', null), row('b#2', 5)],
    opponent: null,
  }, [X, Y]);
  assert.deepEqual(rows.map(r => r.name), ['b#2', 'a#1']);
});

test('Stufe: gemeldete Angabe, sonst aus der Runde', () => {
  assert.equal(boardStage(board(XB, 42, '4-2')), '4-2');
  assert.equal(boardStage(board(XB, 53)), '5-3');
  const [r] = opponentRows({ oppBoards: { 'a#1': board(XB, 31) }, roster: [], opponent: null }, [X, Y]);
  assert.equal(r.stage, '3-1');
});
