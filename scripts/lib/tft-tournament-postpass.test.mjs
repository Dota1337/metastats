// Tests fuer die reinen Regeln der Nachlaeufe (D5, 2026-10-05): Server aus dem
// Seitenpfad, Team-Kuerzel-Verknuepfung, alte Verknuepfungen sortieren.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  platformsForPage, platformsForCountry, stripTeamPrefix, buildProIndex,
  prefixProPuuid, classifyStaleLinks,
} from './tft-tournament-postpass.mjs';

test('Golden_Spatula ist kein China-Turnier: Region aus dem Abschnitt davor', () => {
  // Echte Seitennamen aus tft_tournaments (gemessen 2026-10-05).
  assert.deepEqual(platformsForPage('Cyber_City/Americas/Golden_Spatula'), ['na1', 'br1', 'la1', 'la2']);
  assert.deepEqual(platformsForPage('Cyber_City/APAC/Golden_Spatula'), ['kr', 'jp1', 'tw2', 'vn2', 'oc1', 'sg2']);
  assert.deepEqual(platformsForPage('Cyber_City/EMEA/Golden_Spatula'), ['euw1', 'eun1', 'tr1', 'me1', 'ru']);
});

test('East_Asian_Finals: kr/jp/oce, Unterseite gewinnt', () => {
  assert.deepEqual(platformsForPage('Monsters_Attack!/East_Asian_Finals'), ['kr', 'jp1', 'oc1']);
  assert.deepEqual(platformsForPage('Monsters_Attack!/East_Asian_Finals/Japan'), ['jp1']);
  assert.deepEqual(platformsForPage('Monsters_Attack!/East_Asian_Finals/Korea'), ['kr']);
  assert.deepEqual(platformsForPage('Monster_Attack!/Japan/East_Asian_Finals_Qualifier'), ['jp1']);
});

test('China-Seiten und Seiten ohne Region bleiben ohne Zuordnung', () => {
  assert.deepEqual(platformsForPage('Cyber_City/China/Regional_Finals'), []);
  assert.deepEqual(platformsForPage('Remix_Rumble/TOC'), []);
  assert.deepEqual(platformsForPage('Remix_Rumble/CN_Qualifier'), []);
  assert.deepEqual(platformsForPage('Remix_Rumble/World_Championship'), []);
  assert.deepEqual(platformsForCountry('cn'), []);
  assert.equal(platformsForCountry('world'), null);
  assert.equal(platformsForCountry(''), null);
});

test('stripTeamPrefix: nur kurzes Kuerzel in Grossbuchstaben', () => {
  assert.equal(stripTeamPrefix('HR Loescher'), 'Loescher');
  assert.equal(stripTeamPrefix('ROC WithoutYou'), 'WithoutYou');
  assert.equal(stripTeamPrefix('Loescher'), null);
  assert.equal(stripTeamPrefix('Team Loescher'), null);      // "Team" ist kein Kuerzel
  assert.equal(stripTeamPrefix('ABCDEF Spieler'), null);     // zu lang
  assert.equal(stripTeamPrefix(''), null);
});

test('prefixProPuuid: eindeutiger Pro wird verknuepft, gleichnamige nie', () => {
  const idx = buildProIndex([
    { pro_name: 'Loescher', source_page: 'Loescher', puuid: 'P-LOE' },
    { pro_name: 'Tropical', source_page: 'Tropical_(American_player)', puuid: 'P-TROP-US' },
    { pro_name: 'Tropical', source_page: 'Tropical_(Greek_player)', puuid: 'P-TROP-GR' },
    { pro_name: 'NoAccount', source_page: 'NoAccount', puuid: null },
    { pro_name: 'Deleted', source_page: 'JosueDeleted', puuid: 'P-JOSUE' },
  ]);
  assert.equal(prefixProPuuid('HR Loescher', idx), 'P-LOE');
  assert.equal(prefixProPuuid('HR loescher', idx), 'P-LOE');     // Gross/klein egal
  assert.equal(prefixProPuuid('ABC Tropical', idx), null);       // zwei Pros → nie
  assert.equal(prefixProPuuid('ABC NoAccount', idx), null);      // Pro ohne Konto zaehlt nicht
  assert.equal(prefixProPuuid('ABC JosueDeleted', idx), 'P-JOSUE'); // ueber die Liquipedia-Seite
  assert.equal(prefixProPuuid('Loescher', idx), null);           // ohne Kuerzel: nicht diese Regel
  assert.equal(prefixProPuuid('HR Unbekannt', idx), null);
});

test('buildProIndex: Seite und Name zeigen auf dasselbe Konto → bleibt eindeutig', () => {
  const idx = buildProIndex([{ pro_name: 'Double61', source_page: 'Double61', puuid: 'P-D61' }]);
  assert.equal(idx.get('double61').size, 1);
});

test('classifyStaleLinks: verwaist → loeschen, sonst Pruefliste, gesetzte bleiben unberuehrt', () => {
  const existing = [
    { tournament_id: 'T1', raw_name: 'A', puuid: 'x', method: 'name-unique-master' }, // neu gesetzt
    { tournament_id: 'T1', raw_name: 'B', puuid: 'y', method: 'name-unique-master' }, // Zeile weg
    { tournament_id: 'T2', raw_name: 'C', puuid: 'z', method: 'name-unique-master' }, // Regel trifft nicht mehr
  ];
  const keep = new Set(['T1|A']);
  const resultKeys = new Set(['T1|A', 'T2|C']);
  const { orphans, review } = classifyStaleLinks(existing, keep, resultKeys);
  assert.deepEqual(orphans.map(e => e.raw_name), ['B']);
  assert.deepEqual(review.map(e => e.raw_name), ['C']);
  // Leere Eingaben: nichts zu tun.
  assert.deepEqual(classifyStaleLinks([], keep, resultKeys), { orphans: [], review: [] });
  assert.deepEqual(classifyStaleLinks(null, keep, resultKeys), { orphans: [], review: [] });
});
