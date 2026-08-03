/**
 * Regressionstests für das PostgREST-Row-Targeting der Pro-Updates.
 *
 * Fehlerhistorie: Adressierung über `puuid` ergab bei CN-Pros (puuid NULL)
 * ein `puuid=eq.null`, das den Text "null" matcht — PostgREST antwortet
 * 200 mit 0 betroffenen Zeilen. Ein stiller Erfolg, der die Anreicherung für
 * puuid-lose Rows unsichtbar wirkungslos machte (247 Rows, 2026-07-04), und
 * der verwandte Upsert-Routing-Fehler lief fünf Wochen unbemerkt.
 *
 * Der Schutz besteht darin, dass eine Row OHNE id laut wirft statt still zu
 * no-oppen. Diese Tests halten genau das fest.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proRowFilter } from './pro-row-filter.mjs';

test('adressiert über die id, nicht über puuid', () => {
  assert.equal(proRowFilter({ id: 42, puuid: 'abc' }), 'id=eq.42');
});

test('id=0 ist gültig und wird nicht als fehlend behandelt', () => {
  // Klassische Falsy-Falle: `if (!p.id)` würde hier fälschlich werfen.
  assert.equal(proRowFilter({ id: 0 }), 'id=eq.0');
});

test('CN-Pro ohne puuid funktioniert — das war der Ursprungsbug', () => {
  const cnPro = { id: 991, puuid: null, pro_name: '小寒', source_page: '小寒' };
  assert.equal(proRowFilter(cnPro), 'id=eq.991');
});

test('fehlende id wirft laut, statt still 0 Rows zu treffen', () => {
  assert.throws(() => proRowFilter({ puuid: 'abc', pro_name: 'Foo' }), /has no id/);
  assert.throws(() => proRowFilter({ id: null }), /has no id/);
  assert.throws(() => proRowFilter({ id: undefined }), /has no id/);
});

test('Fehlermeldung nennt den Pro, damit der Fund zuordenbar ist', () => {
  assert.throws(() => proRowFilter({ pro_name: 'Dishsoap' }), /Dishsoap/);
});

test('auch ohne jede Row wird geworfen, nicht undefined zurückgegeben', () => {
  assert.throws(() => proRowFilter(null), /has no id/);
  assert.throws(() => proRowFilter(undefined), /has no id/);
});
