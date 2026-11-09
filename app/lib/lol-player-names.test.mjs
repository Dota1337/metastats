/**
 * Zeilen fuer das LoL-Namensverzeichnis (lol-player-names.ts).
 *
 * Der teure Fehler ist eine Zeile, die Riot so nicht bestaetigt hat: daraus
 * wird eine Spielerseite „bekannt“ und von Google indexiert, obwohl es den
 * Spieler so nicht gibt. Deshalb: nur vollstaendige Riot-Antworten, Riots
 * Schreibweise unveraendert, Zeitpunkt der Antwort.
 *
 * Lauf: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { lolNameRow } from './lol-player-names.ts';

const at = new Date('2026-11-09T18:00:00.000Z');

test('vollstaendige Riot-Antwort → Zeile in Riots Schreibweise mit Zeitpunkt der Antwort', () => {
  assert.deepEqual(lolNameRow({ puuid: 'P1', gameName: 'TwTv SharonMirza', tagLine: '99999' }, 'euw1', at), {
    puuid: 'P1', game_name: 'TwTv SharonMirza', tag_line: '99999', region: 'euw1', last_seen: '2026-11-09T18:00:00.000Z',
  });
  // Leerzeichen im Tag bleiben („KR 1“ ≠ „KR1“).
  assert.equal(lolNameRow({ puuid: 'P2', gameName: 'CruncyWM', tagLine: 'TW TV' }, 'euw1', at).tag_line, 'TW TV');
});

test('fehlt puuid, Name, Tag oder Server → keine Zeile', () => {
  assert.equal(lolNameRow({ gameName: 'A', tagLine: 'EUW' }, 'euw1', at), null);
  assert.equal(lolNameRow({ puuid: '', gameName: 'A', tagLine: 'EUW' }, 'euw1', at), null);
  assert.equal(lolNameRow({ puuid: 'P', gameName: '  ', tagLine: 'EUW' }, 'euw1', at), null);
  assert.equal(lolNameRow({ puuid: 'P', gameName: 'A', tagLine: '' }, 'euw1', at), null);
  assert.equal(lolNameRow({ puuid: 'P', gameName: 'A' }, 'euw1', at), null, 'Riot ohne tagLine (route.ts nutzte frueher `|| ""`)');
  assert.equal(lolNameRow({ puuid: 'P', gameName: 'A', tagLine: 'EUW' }, ' ', at), null);
  assert.equal(lolNameRow({ puuid: 1, gameName: 'A', tagLine: 'EUW' }, 'euw1', at), null);
});
