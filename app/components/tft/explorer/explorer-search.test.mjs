import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPhrase, applyPick, bestPick, currentTerm, isPhrase, searchOptions, splitPhrase, termParts, traitLevelFor,
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
