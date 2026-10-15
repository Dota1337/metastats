/**
 * Alte TFT-Spieler-Adressen mit EINEM Strich (slugs.ts, legacyTftPlayerSlug).
 *
 * Die Middleware leitet sie per 308 auf `Name--Tag` um. Der teure Fehler waere
 * eine Schleife (Ziel wird wieder umgeleitet) oder eine Umleitung auf einen
 * falschen Spieler — deshalb: alles mit `--`/`#` und alles ohne Strich bleibt
 * unangetastet, und das Ziel muss vom Seiten-Parser genau so gelesen werden.
 *
 * Lauf: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { legacyTftPlayerSlug, parseTftPlayerSlug, decodeSlug } from './slugs.ts';

test('Ein-Strich-Adresse wird kanonisch', () => {
  assert.equal(legacyTftPlayerSlug('ViggoZe-EUW'), 'ViggoZe--EUW');
  assert.equal(legacyTftPlayerSlug('Hide%20on%20bush-KR1'), 'Hide%20on%20bush--KR1');
});

test('LoL-Altform ueber den Spielwechsel: Teile werden mit Leerzeichen verbunden', () => {
  assert.equal(legacyTftPlayerSlug('Foo-Bar-EUW'), 'Foo%20Bar--EUW');
  assert.equal(legacyTftPlayerSlug('Hide-on-bush-KR1'), 'Hide%20on%20bush--KR1');
});

test('Tags ausserhalb von A-Z/0-9 (gemessen: "KR 1", Koreanisch, 1 Zeichen)', () => {
  assert.equal(legacyTftPlayerSlug('Faker-KR%201'), 'Faker--KR%201');
  assert.equal(legacyTftPlayerSlug(encodeURIComponent('고양이-사랑해')), `${encodeURIComponent('고양이')}--${encodeURIComponent('사랑해')}`);
  assert.equal(legacyTftPlayerSlug('Name-X'), 'Name--X');
  assert.equal(legacyTftPlayerSlug('%2D%2Dx'), null);
});

test('schon kanonisch, mit # oder ohne Strich: keine Umleitung (keine Schleife)', () => {
  assert.equal(legacyTftPlayerSlug('ViggoZe--EUW'), null);
  assert.equal(legacyTftPlayerSlug('ViggoZe%2D%2DEUW'), null);
  assert.equal(legacyTftPlayerSlug('ViggoZe%23EUW'), null);
  assert.equal(legacyTftPlayerSlug('ViggoZe'), null);
  // Das Ziel einer Umleitung wird nie erneut umgeleitet.
  for (const raw of ['ViggoZe-EUW', 'Foo-Bar-EUW', 'Faker-KR%201']) {
    assert.equal(legacyTftPlayerSlug(legacyTftPlayerSlug(raw)), null);
  }
});

test('leerer Name, leerer oder zu langer Tag, kaputtes %: null statt Absturz', () => {
  assert.equal(legacyTftPlayerSlug('-EUW'), null);
  assert.equal(legacyTftPlayerSlug('Name-'), null);
  assert.equal(legacyTftPlayerSlug('Name-%20'), null);
  assert.equal(legacyTftPlayerSlug('Name-ABCDEF'), null);
  assert.equal(legacyTftPlayerSlug('100%-EUW'), '100%25--EUW');
});

test('die Seite liest das Ziel als denselben Spieler', () => {
  for (const [raw, gameName, tagLine] of [
    ['ViggoZe-EUW', 'ViggoZe', 'EUW'],
    ['Hide%20on%20bush-KR1', 'Hide on bush', 'KR1'],
    ['Faker-KR%201', 'Faker', 'KR 1'],
  ]) {
    const target = legacyTftPlayerSlug(raw);
    // Next uebergibt den Pfadteil einmal dekodiert (page.tsx: decodeSlug).
    assert.deepEqual(parseTftPlayerSlug(decodeSlug(target)), { gameName, tagLine });
  }
});
