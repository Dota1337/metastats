// Ziehen & Ablegen (explorer-move.ts): jede Ablage, die geht, ueberlebt den
// Rundweg ueber die Adresse unveraendert; jede, die nicht geht, gibt null.
//
// Lauf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveFilter } from './explorer-move.ts';
import { parseExplorerParams, serializeExplorerQuery, filterCount } from '../../../lib/tft-explorer-query.ts';

const parse = (qs) => parseExplorerParams(new URLSearchParams(qs));
const ser = (q) => serializeExplorerQuery(q);
// Emblem-Regel wie itemFitsUnit: EMB nicht zweimal, OWN ist das Emblem eines eigenen Traits von A.
const fits = (u, i, carried) => !(i === 'EMB' && carried.includes('EMB')) && !(u === 'A' && i === 'OWN');

function moved(qs, src, target) {
  const r = moveFilter(parse(qs), src, target, fits);
  if (r) {
    // Rundweg: nichts faellt still weg, nichts kommt dazu.
    const back = parse(ser(r));
    assert.equal(ser(back), ser(r), 'Adresse fest');
    assert.equal(filterCount(back), filterCount(r), 'gleich viele Bedingungen');
    assert.deepEqual(back.units.flatMap(u => u.it ?? []).sort(), r.units.flatMap(u => u.it ?? []).sort(), 'Unit-Items');
  }
  return r;
}
const unit = (q, id) => q.units.find(u => u.id === id);

test('Emblem wandert von Unit A zu Unit B', () => {
  const r = moved('u=A:iEMB:iX,B', { kind: 'unitItem', unit: 'A', from: 'main', index: 0 }, { kind: 'unit', id: 'B', at: 'main' });
  assert.deepEqual(unit(r, 'A').it, ['X']);
  assert.deepEqual(unit(r, 'B').it, ['EMB']);
});

test('gleiches Item zweimal an A: der gezogene Platz geht, der andere bleibt', () => {
  const r = moved('u=A:iX:iX,B', { kind: 'unitItem', unit: 'A', from: 'main', index: 1 }, { kind: 'unit', id: 'B', at: 'main' });
  assert.deepEqual(unit(r, 'A').it, ['X']);
  assert.deepEqual(unit(r, 'B').it, ['X']);
});

test('letztes Item weg: Unit ohne Item-Liste', () => {
  const r = moved('u=A:iX,B', { kind: 'unitItem', unit: 'A', from: 'main', index: 0 }, { kind: 'unit', id: 'B', at: 'main' });
  assert.equal('it' in unit(r, 'A'), false);
});

test('Ziel kann das Item nicht tragen → null', () => {
  const src = { kind: 'unitItem', unit: 'A', from: 'main', index: 0 };
  assert.equal(moved('u=A:iX,B:iY:iY:iY', src, { kind: 'unit', id: 'B', at: 'main' }), null, '3 Items');
  assert.equal(moved('u=A:iX,B:n1e:iY', src, { kind: 'unit', id: 'B', at: 'main' }), null, 'genau 1 Item');
  assert.equal(moved('u=A:iX,B:xX', src, { kind: 'unit', id: 'B', at: 'main' }), null, 'ohne genau dieses Item');
  assert.equal(moved('u=A:iEMB,B:iEMB', src, { kind: 'unit', id: 'B', at: 'main' }), null, 'Emblem doppelt');
  assert.equal(moved('u=B:iOWN,A', { kind: 'unitItem', unit: 'B', from: 'main', index: 0 }, { kind: 'unit', id: 'A', at: 'main' }), null, 'eigener Trait');
  assert.equal(moved('u=A:iX,!B', src, { kind: 'unit', id: 'B', at: 'main' }), null, 'ohne-Unit');
  assert.equal(moved('u=A:iX', src, { kind: 'unit', id: 'A', at: 'main' }), null, 'auf sich selbst');
});

test('Unit-Item aufs Brett und in einen Kasten', () => {
  const r = moved('u=A:iX', { kind: 'unitItem', unit: 'A', from: 'main', index: 0 }, { kind: 'zone', at: 'main' });
  assert.deepEqual(r.items, [{ id: 'X' }]);
  assert.equal('it' in unit(r, 'A'), false);
  const g = moved('u=A:iX&g1=any,u.C,t.T', { kind: 'unitItem', unit: 'A', from: 'main', index: 0 }, { kind: 'zone', at: 0 });
  assert.deepEqual(g.groups[0].items, [{ id: 'X' }]);
  assert.equal(moved('u=A:iX&i=X', { kind: 'unitItem', unit: 'A', from: 'main', index: 0 }, { kind: 'zone', at: 'main' }), null, 'Item steht schon dort');
  assert.equal(moved('u=A:iX&i=I1,I2,I3,I4,I5,I6', { kind: 'unitItem', unit: 'A', from: 'main', index: 0 }, { kind: 'zone', at: 'main' }), null, '6 Brett-Items');
});

test('Brett-Item an eine Unit: wird Unit-Item, „≥2" faellt weg', () => {
  const r = moved('u=A&i=X:n2,Y', { kind: 'items', id: 'X', from: 'main' }, { kind: 'unit', id: 'A', at: 'main' });
  assert.deepEqual(r.items, [{ id: 'Y' }]);
  assert.deepEqual(unit(r, 'A').it, ['X']);
});

test('Chips zwischen Hauptzeile und Kasten', () => {
  const r = moved('u=A,B&g1=any,u.C,u.D', { kind: 'units', id: 'A', from: 'main' }, { kind: 'zone', at: 0 });
  assert.deepEqual(r.units.map(u => u.id), ['B']);
  assert.deepEqual(r.groups[0].units.map(u => u.id).sort(), ['A', 'C', 'D']);
  // Auf einen Unit-Chip im Kasten = in diesen Kasten.
  const t = moved('t=T&g1=any,u.C,u.D', { kind: 'traits', id: 'T', from: 'main' }, { kind: 'unit', id: 'C', at: 0 });
  assert.deepEqual(t.groups[0].traits.map(x => x.id), ['T']);
  // Letztes Glied raus: Kasten verschwindet.
  const back = moved('u=B&g1=any,u.C', { kind: 'units', id: 'C', from: 0 }, { kind: 'zone', at: 'main' });
  assert.deepEqual(back.units.map(u => u.id).sort(), ['B', 'C']);
  assert.equal(back.groups.length, 0);
});

test('Chip-Ablage, die nicht geht → null', () => {
  assert.equal(moved('u=A,B', { kind: 'units', id: 'A', from: 'main' }, { kind: 'zone', at: 'main' }), null, 'gleiche Stelle');
  assert.equal(moved('u=A,B', { kind: 'units', id: 'A', from: 'main' }, { kind: 'unit', id: 'B', at: 'main' }), null, 'Unit auf Unit derselben Zeile');
  assert.equal(moved('u=A&g1=any,u.A,u.C', { kind: 'units', id: 'A', from: 'main' }, { kind: 'zone', at: 0 }), null, 'schon im Kasten');
  assert.equal(moved('u=A&g1=any,u.B,u.C,u.D,u.E,u.F,u.G', { kind: 'units', id: 'A', from: 'main' }, { kind: 'zone', at: 0 }), null, 'Kasten voll');
  assert.equal(moved('u=A,B,C,D,E,F,G,H,I&g1=any,u.J,u.K', { kind: 'units', id: 'J', from: 0 }, { kind: 'zone', at: 'main' }), null, '9 Units');
  assert.equal(moved('u=A&g1=none,u.C', { kind: 'units', id: 'A', from: 'main' }, { kind: 'zone', at: 0 }), null, 'keins-davon-Kasten');
  assert.equal(moved('u=A&g1=none,u.C', { kind: 'units', id: 'C', from: 0 }, { kind: 'zone', at: 'main' }), null, 'aus keins-davon');
  assert.equal(moved('u=!A,B&g1=any,u.C', { kind: 'units', id: 'A', from: 'main' }, { kind: 'zone', at: 0 }), null, 'ohne-Chip');
  assert.equal(moved('u=A', { kind: 'units', id: 'Z', from: 'main' }, { kind: 'zone', at: 0 }), null, 'kein Kasten');
});

test('Traeger, Reiter und Rest der Anfrage bleiben unberuehrt', () => {
  const q = parse('r=euw1&p=18.4&u=A:iX,B&tab=items&f=A');
  const r = moveFilter(q, { kind: 'unitItem', unit: 'A', from: 'main', index: 0 }, { kind: 'unit', id: 'B', at: 'main' }, fits);
  assert.equal(r.focus, 'A');
  assert.equal(r.tab, 'items');
  assert.equal(r.region, 'euw1');
  assert.deepEqual(r.patches, ['18.4']);
  assert.deepEqual(q.units.find(u => u.id === 'A').it, ['X'], 'Eingabe unveraendert');
});
