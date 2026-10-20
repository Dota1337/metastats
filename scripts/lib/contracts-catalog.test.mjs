// Tests fuer den Vertrag comp-catalog-days (scripts/lib/contracts.mjs). Nur die
// reine Auswertung — Supabase fasst der Pruefer selbst an.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCompCatalogDays } from './contracts.mjs';

const DAY = '2026-10-24';
// Je Region eine Zeile je Rang (wie crawl_meta), hier zwei.
const meta = (regions, catalogId) => regions.flatMap(region => [
  { region, catalog_id: catalogId }, { region, catalog_id: catalogId },
]);

test('comp-catalog-days: ohne Katalog-Tag gruen, ohne Tag uebersprungen', () => {
  const r = evaluateCompCatalogDays({ day: DAY, metaRows: meta(['euw1', 'kr'], null), perfectByRegion: new Map() });
  assert.equal(r.status, 'ok');
  assert.match(r.detail, /noch kein Katalog-Tag \(2 Regionen/);
  assert.equal(evaluateCompCatalogDays({ day: null, metaRows: [], perfectByRegion: new Map() }).status, 'skipped');
});

test('comp-catalog-days: Katalog-Tag erwartet, aber alles klassisch = rot; nicht erwartet = gruen', () => {
  const r = evaluateCompCatalogDays({ day: DAY, metaRows: meta(['euw1', 'kr'], null), perfectByRegion: new Map(), expected: { patch: '18.5', priorDays: 3 } });
  assert.equal(r.status, 'broken');
  assert.match(r.detail, /Katalog-Tag erwartet \(Patch 18\.5, 3 fruehere Tage.*alle 2 Regionen klassisch/);
  assert.equal(evaluateCompCatalogDays({ day: DAY, metaRows: meta(['euw1'], null), perfectByRegion: new Map(), expected: null }).status, 'ok');
  // Markiert ist er gelaufen: die Erwartung aendert dann nichts.
  const done = evaluateCompCatalogDays({ day: DAY, metaRows: meta(['euw1'], 7), perfectByRegion: new Map([['euw1', 9]]), expected: { patch: '18.5', priorDays: 3 } });
  assert.equal(done.status, 'ok');
});

test('comp-catalog-days: alle markiert mit Perfekt-Zaehlern = gruen', () => {
  const r = evaluateCompCatalogDays({ day: DAY, metaRows: meta(['euw1', 'kr'], 7), perfectByRegion: new Map([['euw1', 900], ['kr', 1200]]) });
  assert.equal(r.status, 'ok');
  assert.match(r.detail, /2 Regionen markiert/);
});

test('comp-catalog-days: eine Region klassisch = gelb, ein Rang markiert reicht (bool_or)', () => {
  const rows = [...meta(['euw1'], 7), ...meta(['kr'], null)];
  const r = evaluateCompCatalogDays({ day: DAY, metaRows: rows, perfectByRegion: new Map([['euw1', 900]]) });
  assert.equal(r.status, 'warn');
  assert.match(r.detail, /klassisch gezaehlt: kr/);
  const partly = [{ region: 'euw1', catalog_id: 7 }, { region: 'euw1', catalog_id: null }];
  assert.equal(evaluateCompCatalogDays({ day: DAY, metaRows: partly, perfectByRegion: new Map([['euw1', 5]]) }).status, 'ok');
});

test('comp-catalog-days: markierte Region ohne Perfekt-Zaehler = rot, schlaegt gelb', () => {
  const rows = [...meta(['euw1', 'na1'], 7), ...meta(['kr'], null)];
  const r = evaluateCompCatalogDays({ day: DAY, metaRows: rows, perfectByRegion: new Map([['euw1', 900], ['na1', 0]]) });
  assert.equal(r.status, 'broken');
  assert.match(r.detail, /ohne Perfekt-Zaehler: na1$/);
});
