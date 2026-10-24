import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPhrase, applyPick, bestPick, browseTraits, browseUnits, canAdd, chosenIds, currentTerm, gridMove, isPhrase, pickKey,
  removeEverywhere, searchOptions, splitPhrase, termParts, traitLevelFor,
} from './explorer-search.ts';
import { EMPTY_QUERY } from '../../../lib/tft-explorer-query.ts';

// Erfundene Kennungen (keine echten Set-Nummern in Tests).
const units = [
  { id: 'TFTX_Lux', name: 'Lux', cost: 5, img: null },
  { id: 'TFTX_Jinx', name: 'Jinx', cost: 4, img: null },
  { id: 'TFTX_Vex', name: 'Vex', cost: 3, img: null },
  { id: 'TFTX_MasterYi', name: 'Master Yi', cost: 4, img: null },
  { id: 'TFTX_KogMaw', name: "Kog'Maw", cost: 1, img: null },
];
const items = [
  { id: 'TFTX_Rabadon', name: "Rabadon's Deathcap", bucket: 'standard', img: null },
  { id: 'TFTX_LuxEmblem', name: 'Lux Emblem', bucket: 'emblem', img: null },
];
const traits = [{ id: 'TFTX_Juggernaut', name: 'Juggernaut', img: null, mins: [2, 4, 6] }];
const o = {
  units, items, traits,
  unitById: new Map(units.map(u => [u.id, u])),
  itemById: new Map(items.map(i => [i.id, i])),
  traitById: new Map(traits.map(t => [t.id, t])),
};
const q0 = { ...EMPTY_QUERY };

test('splitPhrase: Verbindungswoerter, mehrteilige Namen, fuehrendes oder', () => {
  assert.deepEqual(splitPhrase('Lux und Jinx oder Master Yi'), [
    { op: null, text: 'Lux' }, { op: 'and', text: 'Jinx' }, { op: 'or', text: 'Master Yi' },
  ]);
  assert.deepEqual(splitPhrase('oder Vex'), [{ op: 'or', text: 'Vex' }]);
  assert.deepEqual(splitPhrase('Lux&Jinx|Vex'), [{ op: null, text: 'Lux' }, { op: 'and', text: 'Jinx' }, { op: 'or', text: 'Vex' }]);
  // „o"/„y" nur auf Spanisch Verbindungswoerter.
  assert.equal(splitPhrase('Lux o Vex').length, 1);
  assert.equal(splitPhrase('Lux o Vex', 'es').length, 2);
  assert.equal(isPhrase(splitPhrase('Lux')), false);
  assert.equal(isPhrase(splitPhrase('Lux and Vex')), true);
});

test('currentTerm: Begriff nach dem letzten Verbindungswort', () => {
  assert.equal(currentTerm('Lux und Ji'), 'Ji');
  assert.equal(currentTerm('Lux und '), '');
  assert.equal(currentTerm('Master Y'), 'Master Y');
});

test('termParts + bestPick: Sterne, Trait-Stufe, Item-Anzahl, Schreibweisen', () => {
  assert.deepEqual(termParts('Lux 3*'), { needle: 'lux', stars: 3, num: null });
  assert.deepEqual(termParts('★★ lux'), { needle: 'lux', stars: 2, num: null });
  assert.deepEqual(bestPick('lux 2*', o), { kind: 'units', f: { id: 'TFTX_Lux', s: 2, sx: 2 } });
  assert.deepEqual(bestPick('lux 3★', o), { kind: 'units', f: { id: 'TFTX_Lux', s: 3 } });
  assert.deepEqual(bestPick('kogmaw', o), { kind: 'units', f: { id: 'TFTX_KogMaw' } });
  assert.deepEqual(bestPick('6 juggernaut', o), { kind: 'traits', f: { id: 'TFTX_Juggernaut', l: 3 } });
  assert.deepEqual(bestPick('juggernaut 5', o), { kind: 'traits', f: { id: 'TFTX_Juggernaut', l: 2 } });
  assert.deepEqual(bestPick('2 rabadon', o), { kind: 'items', f: { id: 'TFTX_Rabadon', n: 2 } });
  // „Lux" ist genau die Unit, nicht das Emblem.
  assert.equal(bestPick('lux', o).kind, 'units');
  assert.equal(bestPick('lux emb', o).f.id, 'TFTX_LuxEmblem');
  assert.equal(bestPick('zzz', o), null);
  assert.equal(traitLevelFor([2, 4, 6], 1), undefined);
});

test('searchOptions: beste Treffer zuerst', () => {
  const r = searchOptions('lux', o);
  assert.deepEqual(r.units.map(u => u.id), ['TFTX_Lux']);
  assert.deepEqual(r.items.map(i => i.id), ['TFTX_LuxEmblem']);
  assert.deepEqual(searchOptions('', o).units, []);
});

test('applyPick: und in die Hauptliste, oder zieht den vorigen Baustein in einen Kasten', () => {
  let r = applyPick(q0, { kind: 'units', f: { id: 'TFTX_Lux' } }, 'and', null);
  assert.deepEqual(r.query.units, [{ id: 'TFTX_Lux' }]);
  r = applyPick(r.query, { kind: 'units', f: { id: 'TFTX_Jinx' } }, 'and', r.last);
  r = applyPick(r.query, { kind: 'traits', f: { id: 'TFTX_Juggernaut' } }, 'or', r.last);
  assert.deepEqual(r.query.units, [{ id: 'TFTX_Lux' }]);
  assert.deepEqual(r.query.groups, [{ m: 'any', units: [{ id: 'TFTX_Jinx' }], items: [], traits: [{ id: 'TFTX_Juggernaut' }] }]);
  assert.deepEqual(r.last, { kind: 'traits', id: 'TFTX_Juggernaut', where: 0 });
  // Weiteres „oder" geht in denselben Kasten.
  r = applyPick(r.query, { kind: 'units', f: { id: 'TFTX_Vex' } }, 'or', r.last);
  assert.equal(r.query.groups.length, 1);
  assert.deepEqual(r.query.groups[0].units.map(u => u.id), ['TFTX_Jinx', 'TFTX_Vex']);
  // Doppelt in der Hauptliste: nur neue Zusaetze werden uebernommen.
  const again = applyPick(r.query, { kind: 'units', f: { id: 'TFTX_Lux' } }, 'and', null);
  assert.equal(again.added, false);
  const stars = applyPick(r.query, { kind: 'units', f: { id: 'TFTX_Lux', s: 3 } }, 'and', null);
  assert.deepEqual(stars.query.units, [{ id: 'TFTX_Lux', s: 3 }]);
});

test('applyPick: „ohne"-Baustein aus altem Link zieht nicht in einen Kasten; Grenzen halten', () => {
  const q = { ...q0, units: [{ id: 'TFTX_Lux', x: true }] };
  const r = applyPick(q, { kind: 'units', f: { id: 'TFTX_Vex' } }, 'or', { kind: 'units', id: 'TFTX_Lux', where: 'main' });
  assert.deepEqual(r.query.units, [{ id: 'TFTX_Lux', x: true }, { id: 'TFTX_Vex' }]);
  assert.equal(r.query.groups.length, 0);
  const full = { ...q0, units: Array.from({ length: 9 }, (_, i) => ({ id: `TFTX_U${i}` })) };
  assert.equal(applyPick(full, { kind: 'units', f: { id: 'TFTX_Lux' } }, 'and', null).added, false);
});

test('applyPhrase: ganze Eingabe, unbekannte Begriffe werden gemeldet', () => {
  const r = applyPhrase(q0, splitPhrase('Lux 2* und Jinx oder Vex und zzz'), o, 'and', null);
  assert.deepEqual(r.query.units, [{ id: 'TFTX_Lux', s: 2, sx: 2 }]);
  assert.deepEqual(r.query.groups[0].units.map(u => u.id), ['TFTX_Jinx', 'TFTX_Vex']);
  assert.deepEqual(r.missed, ['zzz']);
});

test('chosenIds: Hauptliste und Kaesten; „ohne" und „keins davon" getrennt', () => {
  const q = {
    ...q0, units: [{ id: 'TFTX_Lux' }, { id: 'TFTX_Jinx', x: true }],
    groups: [
      { m: 'any', units: [{ id: 'TFTX_Vex' }], items: [{ id: 'TFTX_Rabadon' }], traits: [] },
      { m: 'none', units: [], items: [], traits: [{ id: 'TFTX_Juggernaut' }] },
    ],
  };
  const c = chosenIds(q);
  assert.deepEqual([...c.on].sort(), ['items:TFTX_Rabadon', 'units:TFTX_Lux', 'units:TFTX_Vex']);
  assert.deepEqual([...c.out].sort(), ['traits:TFTX_Juggernaut', 'units:TFTX_Jinx']);
  assert.equal(c.on.has(pickKey('units', 'TFTX_Lux')), true);
});

test('removeEverywhere: Hauptliste + Kaesten, leere Kaesten fallen weg, last neu nummeriert', () => {
  const q = {
    ...q0, units: [{ id: 'TFTX_Lux', s: 3 }],
    groups: [
      { m: 'any', units: [{ id: 'TFTX_Lux' }], items: [], traits: [] },
      { m: 'any', units: [{ id: 'TFTX_Vex' }, { id: 'TFTX_Jinx' }], items: [], traits: [] },
    ],
  };
  const r = removeEverywhere(q, 'units', 'TFTX_Lux', { kind: 'units', id: 'TFTX_Vex', where: 1 });
  assert.deepEqual(r.query.units, []);
  assert.equal(r.query.groups.length, 1);
  assert.deepEqual(r.query.groups[0].units.map(u => u.id), ['TFTX_Vex', 'TFTX_Jinx']);
  assert.deepEqual(r.last, { kind: 'units', id: 'TFTX_Vex', where: 0 });
  // last auf den entfernten Baustein → verworfen.
  assert.equal(removeEverywhere(q, 'units', 'TFTX_Lux', { kind: 'units', id: 'TFTX_Lux', where: 'main' }).last, null);
  // Andere Arten bleiben unberuehrt.
  assert.deepEqual(removeEverywhere(q, 'items', 'TFTX_Lux', null).query, q);
});

test('canAdd = echter Klick: Hauptliste, Kasten, neuer Kasten, Gesamtgrenze', () => {
  const real = (q, kind, op, last) => applyPick(q, { kind, f: { id: 'TFTX_New' } }, op, last).added;
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: `TFTX_U${i}` }));
  const box6 = { m: 'any', units: Array.from({ length: 6 }, (_, i) => ({ id: `TFTX_B${i}` })), items: [], traits: [] };
  const box1 = (id) => ({ m: 'any', units: [{ id }], items: [], traits: [] });
  const cases = [
    [q0, 'units', 'and', null],
    [{ ...q0, units: nine }, 'units', 'and', null],
    [{ ...q0, units: nine }, 'items', 'and', null],
    [{ ...q0, groups: [box6] }, 'items', 'or', { kind: 'units', id: 'TFTX_B0', where: 0 }],
    [{ ...q0, groups: [box1('TFTX_A')] }, 'items', 'or', { kind: 'units', id: 'TFTX_A', where: 0 }],
    [{ ...q0, units: [{ id: 'TFTX_M' }], groups: [box1('TFTX_A'), box1('TFTX_B'), box1('TFTX_C')] }, 'traits', 'or', { kind: 'units', id: 'TFTX_M', where: 'main' }],
    [{ ...q0, units: [{ id: 'TFTX_M' }] }, 'traits', 'or', { kind: 'units', id: 'TFTX_M', where: 'main' }],
    [{ ...q0, units: nine, items: Array.from({ length: 6 }, (_, i) => ({ id: `TFTX_I${i}` })) }, 'traits', 'and', null],
  ];
  const got = cases.map(([q, kind, op, last]) => canAdd(q, kind, op, last));
  assert.deepEqual(got, cases.map(([q, kind, op, last]) => real(q, kind, op, last)));
  assert.deepEqual(got, [true, false, true, false, true, false, true, false]);
});

test('browseUnits: Kosten-Zeilen aus den Daten, Formen mit vorhandener Basis fallen weg', () => {
  const us = [
    { id: 'TFTX_Lux', name: 'Lux', cost: 5 }, { id: 'TFTX_LuxCoven', name: 'Lux (Coven)', cost: 5 },
    { id: 'TFTX_Odd', name: 'Odd (Form)', cost: 2 }, { id: 'TFTX_Vex', name: 'Vex', cost: 3 },
    { id: 'TFTX_Ahri', name: 'Ahri', cost: 3 },
  ];
  assert.deepEqual(browseUnits(us).map(r => r.map(u => u.id)), [['TFTX_Odd'], ['TFTX_Ahri', 'TFTX_Vex'], ['TFTX_Lux']]);
});

test('browseTraits: alphabetisch, Einstufen-Synergien dahinter', () => {
  const ts = [
    { id: 'a', name: 'Zeta', mins: [2, 4] }, { id: 'b', name: 'Alpha', mins: [1] },
    { id: 'c', name: 'Beta', mins: [3, 5] }, { id: 'd', name: 'Eclipse', mins: [] },
  ];
  assert.deepEqual(browseTraits(ts).map(r => r.map(x => x.name)), [['Beta', 'Zeta'], ['Alpha', 'Eclipse']]);
});

test('gridMove: Abschnitte brechen um, hoch/runter behaelt die Spalte', () => {
  // Abschnitte 5 und 3, 3 Spalten → Zeilen [0,1,2] [3,4] [5,6,7]
  const s = [5, 3];
  assert.equal(gridMove(s, 3, -1, 'down'), 0);
  assert.equal(gridMove(s, 3, 2, 'down'), 4);
  assert.equal(gridMove(s, 3, 4, 'down'), 6);
  assert.equal(gridMove(s, 3, 7, 'up'), 4);
  assert.equal(gridMove(s, 3, 1, 'up'), 1);
  assert.equal(gridMove(s, 3, 7, 'down'), 7);
  assert.equal(gridMove(s, 3, 0, 'left'), 0);
  assert.equal(gridMove(s, 3, 7, 'right'), 7);
  assert.equal(gridMove(s, 3, 4, 'right'), 5);
  assert.equal(gridMove([], 3, -1, 'down'), -1);
});
