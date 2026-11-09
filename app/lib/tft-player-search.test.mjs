// Spieler-Vorschlaege (usePlayerSuggest): Abfrage-Text und Zeilen-Helfer der
// Mehrfachsuche. Die Abfrage muss dieselben Treffer liefern wie die rohe Eingabe
// (Server: tft_name_norm, Migration 0072) — nur die Schreibweise darf sich aendern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUGGEST_MIN_CHARS, suggestQuery, lineAt, replaceLine, riotIdKey, mergeLolHits, tftProfileHref, lolProfileHref } from './tft-player-search.ts';

test('suggestQuery: unter der Schwelle null, Leerzeichen zaehlen nicht', () => {
  assert.equal(SUGGEST_MIN_CHARS, 3);
  assert.equal(suggestQuery(''), null);
  assert.equal(suggestQuery('ab'), null);
  assert.equal(suggestQuery('a b'), null);
  assert.equal(suggestQuery('ab#EUW'), null);
  assert.equal(suggestQuery('abc'), 'abc');
});

test('suggestQuery: Name klein und ohne Leerzeichen, Tag getrimmt', () => {
  assert.equal(suggestQuery('Dish Soap'), 'dishsoap');
  assert.equal(suggestQuery('  Dish Soap  '), 'dishsoap');
  assert.equal(suggestQuery('Dish Soap#UWU'), 'dishsoap#uwu');
  assert.equal(suggestQuery('Dish Soap# KR 1 '), 'dishsoap#kr 1');
  // Leerer Tag = kein Tag (die Route behandelt '#' ohne Tag genauso)
  assert.equal(suggestQuery('Dish Soap#'), 'dishsoap');
});

test('suggestQuery: nur ASCII wird klein geschrieben', () => {
  // „İ“ schreiben JS und Postgres unterschiedlich klein — bleibt fuer den Server.
  assert.equal(suggestQuery('İSTANBUL'), 'İstanbul');
  assert.equal(suggestQuery('Hide on bush ツ'), 'hideonbushツ');
  assert.equal(suggestQuery('페이커'), '페이커');
});

test('lineAt: Zeile am Cursor', () => {
  const text = 'Faker#KR1\nCaps#EUW\nDish';
  assert.deepEqual(lineAt(text, 0), { start: 0, end: 9, line: 'Faker#KR1' });
  assert.deepEqual(lineAt(text, 9), { start: 0, end: 9, line: 'Faker#KR1' });
  assert.deepEqual(lineAt(text, 10), { start: 10, end: 18, line: 'Caps#EUW' });
  assert.deepEqual(lineAt(text, text.length), { start: 19, end: 23, line: 'Dish' });
  assert.deepEqual(lineAt('', 0), { start: 0, end: 0, line: '' });
  assert.deepEqual(lineAt('a\n', 2), { start: 2, end: 2, line: '' });
});

test('replaceLine: nur die eine Zeile, Cursor ans Ende', () => {
  const text = 'Faker#KR1\nDish\nCaps#EUW';
  const at = lineAt(text, 13);
  assert.deepEqual(replaceLine(text, at.start, at.end, 'Dish Soap#KR 1'), {
    text: 'Faker#KR1\nDish Soap#KR 1\nCaps#EUW',
    caret: 24,
  });
  const last = lineAt('a\nbc', 4);
  assert.deepEqual(replaceLine('a\nbc', last.start, last.end, 'xyz'), { text: 'a\nxyz', caret: 5 });
});

test('riotIdKey: Name ohne Gross/Klein und Leerzeichen, Tag nur ohne Gross/Klein', () => {
  assert.equal(riotIdKey('SQ Heimer Banga', 'EUW'), riotIdKey('sqheimerbanga', 'euw'));
  assert.notEqual(riotIdKey('Dish', 'KR 1'), riotIdKey('Dish', 'KR1'));
});

test('mergeLolHits: LoL zuerst, gleiche Riot-ID einmal, ohne puuid und Rang, Grenze', () => {
  const lol = [{ gameName: 'SQ Heimer Banga', tagLine: 'EUW', region: 'euw1', tier: null, division: null, lp: null }];
  const tft = [
    { puuid: 'T1', gameName: 'sq heimer banga', tagLine: 'euw', region: 'na1', tier: 'GOLD', division: 'I', lp: 10 },
    { puuid: 'T2', gameName: 'SQ Heimer', tagLine: 'KR 1', region: 'kr', tier: 'MASTER', division: 'I', lp: 99 },
    { puuid: 'T3', gameName: 'SQ Heimer', tagLine: 'KR1', region: 'kr', tier: null, division: null, lp: null },
  ];
  const out = mergeLolHits(lol, tft, 10);
  assert.deepEqual(out.map(h => [h.gameName, h.tagLine, h.region]), [
    ['SQ Heimer Banga', 'EUW', 'euw1'], ['SQ Heimer', 'KR 1', 'kr'], ['SQ Heimer', 'KR1', 'kr'],
  ]);
  for (const h of out) {
    assert.equal('puuid' in h, false);
    assert.equal(h.tier, null);
    assert.equal(h.lp, null);
  }
  assert.equal(mergeLolHits(lol, tft, 2).length, 2);
  assert.deepEqual(mergeLolHits([], [], 10), []);
});

test('Profil-Links: TFT mit puuid wie bisher, ohne puuid ohne leeren Parameter', () => {
  assert.equal(tftProfileHref({ puuid: 'P', gameName: 'A B', tagLine: 'EUW', region: 'euw1' }), '/tft/player/A%20B--EUW?region=euw1&puuid=P');
  assert.equal(tftProfileHref({ puuid: 'P', gameName: 'A', tagLine: 'EUW', region: null }), '/tft/player/A--EUW?puuid=P');
  assert.equal(tftProfileHref({ gameName: 'A', tagLine: 'EUW', region: null }), '/tft/player/A--EUW');
  assert.equal(lolProfileHref({ gameName: 'SQ Heimer Banga', tagLine: 'EUW', region: 'euw1' }), '/player/SQ%20Heimer%20Banga--EUW?region=euw1');
  // Rand gekuerzt wie das canonical der Spielerseite (riotIdSlug).
  assert.equal(tftProfileHref({ gameName: 'A ', tagLine: ' EUW', region: null }), '/tft/player/A--EUW');
  assert.equal(lolProfileHref({ gameName: ' A', tagLine: 'KR 1 ', region: null }), '/player/A--KR%201');
});
