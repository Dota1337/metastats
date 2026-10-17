// URL-Form des Data Explorers: alte Links bleiben zeichengleich, jede URL ist
// nach einem Durchlauf fest (sonst leitet die API-Route mit 308 im Kreis um),
// und der Anfrage-Koerper passt durch die Pruefung des Dienstes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExplorerParams, serializeExplorerQuery, toServiceBody, hasBoardFilters, filterCount, showTop4, showTop1 } from './tft-explorer-query.ts';
import { normalizeQuery } from '../../scripts/lib/explorer-normalize.mjs';

const parse = (qs) => parseExplorerParams(new URLSearchParams(qs));
const round = (qs, o) => serializeExplorerQuery(parse(qs), o);
// Lesbar notiert, verglichen in der Form, die URLSearchParams schreibt.
const enc = (qs) => new URLSearchParams(qs).toString();

// Mit dem bisherigen Stand erzeugte Adressen (Form vor den neuen Filtern).
const OLD = [
  '',
  'r=euw1&k=challenger,master&p=18.3',
  'p=all&u=DA_18_Diana:s2e:n2:iDA_SpearOfShojin:xDA_GuinsoosRageblade',
  'u=!DA_Amumu18:s3,DA_18_Diana:s1&tab=items&f=DA_18_Diana&c=2',
  'i=!DA_Artifact_LightshieldCrest,DA_ThiefsGloves&t=!DA_Juggernaut18,DA_18_Inferno:l2e&tab=traits&split=over',
  'u=DA_18_Diana:iDA_X:iDA_X&st=2,3',
  'tab=level',
];

test('alte Adressen bleiben zeichengleich', () => {
  for (const qs of OLD) assert.equal(round(enc(qs)), enc(qs), qs);
});

test('jede Adresse ist nach einem Durchlauf fest (Seite und API)', () => {
  const samples = [
    ...OLD,
    'lv=9,8,9&pl=1-4&u=DA_A:s1-2:n0e:c2:kemblem2:kartifact1:iDA_Y:iDA_X',
    'pl=3&u=DA_A:s2-2:n0-1',
    'pl=1-8&lv=1,2,3,4,5,6,7,8,9,10',
    'i=DA_X:n2,!DA_Y:n3&g1=none,t.DA_T&g2=any,u.DA_B:s2,i.DA_X:n2,t.DA_T:l2e',
    'g1=any,u.!DA_B,u.DA_C&g3=oder,u.DA_D',
    'u=DA_A:s3-1:n9:c4:kgold1:kemblem1:kemblem2',
  ];
  for (const qs of samples) {
    for (const o of [{}, { forApi: true }]) {
      const once = round(qs, o);
      assert.equal(round(once, o), once, `${qs} → ${once}`);
    }
  }
});

test('neue Teile: Form und Kanonisierung', () => {
  assert.equal(round('lv=9,8,9&pl=1-4'), enc('lv=8,9&pl=1-4'));
  assert.equal(round('pl=1-8&lv=1,2,3,4,5,6,7,8,9,10'), '');
  assert.equal(round('pl=4-2'), '');
  assert.equal(round('u=DA_A:s2-2'), enc('u=DA_A:s2e'));
  assert.equal(round('u=DA_A:s3-1'), 'u=DA_A');
  assert.equal(round('i=DA_X:n1'), 'i=DA_X');
  // Kaesten: Reihenfolge bleibt, Glieder sortiert, „!" im Kasten, doppelte ID
  // und unbekannte Art fallen weg, Luecken werden aufgerueckt
  assert.equal(decodeURIComponent(round('g3=none,t.DA_T&g1=any,u.DA_C,i.DA_X:n2,u.!DA_B,u.DA_C:s2&g2=oder,u.DA_D')),
    'g1=any,i.DA_X:n2,u.DA_C&g2=none,t.DA_T');
});

test('Grenzen: Kaesten nur soweit die Gesamtgrenze von 15 reicht', () => {
  const u = Array.from({ length: 9 }, (_, n) => `DA_U${n}`).join(',');
  const i = Array.from({ length: 6 }, (_, n) => `DA_I${n}`).join(',');
  const q = parse(`u=${u}&i=${i}&g1=any,u.DA_A,u.DA_B&g2=none,t.DA_T`);
  assert.equal(filterCount(q), 15);
  assert.equal(q.groups.length, 0);
  const q2 = parse('g1=any,u.DA_1,u.DA_2,u.DA_3,u.DA_4,u.DA_5,u.DA_6,u.DA_7');
  assert.equal(q2.groups[0].units.length, 6);
});

test('Anfrage-Koerper geht durch die Pruefung des Dienstes und meint dasselbe', () => {
  const qs = 'lv=8,9&pl=1-4&u=DA_A:s1-2:n0e:c2:kemblem2:iDA_X:iDA_X,!DA_B:s2e&i=DA_X:n2&t=DA_T:l2e'
    + '&g1=any,u.DA_C:s2,i.DA_Y,t.DA_U:l2&g2=none,i.DA_Z&tab=items&f=DA_A&c=2';
  const n = normalizeQuery(toServiceBody(parse(qs)));
  assert.deepEqual(n.levels, [8, 9]);
  assert.deepEqual(n.place, [1, 4]);
  const a = n.units.find(u => u.id === 'DA_A');
  assert.deepEqual(a, { id: 'DA_A', x: false, s: null, sx: 2, n: 0, nx: 0, c: 2, it: ['DA_X', 'DA_X'], nit: [], k: [{ b: 'emblem', n: 2 }] });
  assert.deepEqual(n.units.find(u => u.id === 'DA_B'), { id: 'DA_B', x: true, s: 2, sx: 2, n: null, nx: null, c: null, it: [], nit: [], k: [] });
  assert.deepEqual(n.items, [{ id: 'DA_X', x: false, n: 2 }]);
  assert.equal(n.groups.length, 2);
  assert.equal(n.combo, 2);
  // alte Form ergibt dieselbe Dienst-Anfrage wie bisher (s2e = genau 2)
  const old = normalizeQuery(toServiceBody(parse('u=DA_18_Diana:s2e:n2')));
  assert.deepEqual(old.units[0], { id: 'DA_18_Diana', x: false, s: 2, sx: 2, n: 2, nx: null, c: null, it: [], nit: [], k: [] });
  assert.deepEqual(normalizeQuery(toServiceBody(parse(''))).groups, []);
  // Item-Anzahl nur 2–3 (Masken m2/m3): n4 faellt auf der Seite weg, der Dienst lehnt sie ab.
  assert.deepEqual(normalizeQuery(toServiceBody(parse('i=DA_X:n4'))).items, [{ id: 'DA_X', x: false, n: null }]);
  assert.deepEqual(normalizeQuery(toServiceBody(parse('i=DA_X:n3'))).items, [{ id: 'DA_X', x: false, n: 3 }]);
  assert.throws(() => normalizeQuery({ items: [{ id: 'DA_X', n: 4 }] }), /item_count/);
});

test('Brett-Filter und Top-4-/Sieg-Spalten', () => {
  assert.equal(hasBoardFilters(parse('lv=9&pl=1-4')), false);
  assert.equal(hasBoardFilters(parse('g1=none,t.DA_T')), true);
  assert.equal(showTop4(null), true);
  assert.equal(showTop4([1, 4]), false);
  assert.equal(showTop4([3, 6]), true);
  assert.equal(showTop1([1, 4]), true);
  assert.equal(showTop1([2, 8]), false);
  assert.equal(showTop1([1, 1]), false);
});
