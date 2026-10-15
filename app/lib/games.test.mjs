/**
 * Spielwechsel und Startseiten (games.ts) in beiden Zustaenden des Schalters
 * TFT_IS_HOME (feature-flags.ts): TFT als Hauptseite (`/` → Uebersicht, LoL
 * unter `/lol`) und zurueck (LoL auf `/`).
 *
 * Lauf: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TFT_HOME, lolHome, gamesInOrder, mapPathToGame, detectGameFromPath } from './games.ts';

test('Startseiten je Schalterzustand', () => {
  assert.equal(TFT_HOME, '/tft/comps/atlas');
  assert.equal(lolHome(true), '/lol');
  assert.equal(lolHome(false), '/');
  assert.deepEqual(gamesInOrder(true).map(g => g.id), ['tft', 'lol'], 'Hauptseite steht links');
  assert.deepEqual(gamesInOrder(false).map(g => g.id), ['lol', 'tft']);
});

test('Spielwechsel LoL → TFT landet auf der Uebersicht', () => {
  for (const on of [true, false]) {
    assert.equal(mapPathToGame('/', 'tft', on), TFT_HOME);
    assert.equal(mapPathToGame('/lol', 'tft', on), TFT_HOME);
    assert.equal(mapPathToGame('/en/lol', 'tft', on), '/en' + TFT_HOME);
    assert.equal(mapPathToGame('/datenschutz', 'tft', on), TFT_HOME, 'Rueckfall');
  }
  assert.equal(mapPathToGame('/champions/Ahri', 'tft'), '/tft/units');
});

test('Spielwechsel TFT → LoL landet auf der LoL-Startseite des Zustands', () => {
  assert.equal(mapPathToGame('/tft', 'lol', true), '/lol');
  assert.equal(mapPathToGame('/tft', 'lol', false), '/');
  assert.equal(mapPathToGame('/tft/rising', 'lol', true), '/lol', 'Rueckfall');
  assert.equal(mapPathToGame('/tft/rising', 'lol', false), '/');
  assert.equal(mapPathToGame('/en/tft/rising', 'lol', true), '/en/lol');
  assert.equal(mapPathToGame('/fr/tft/rising', 'lol', false), '/fr');
  // Seiten mit Gegenstueck bleiben unberuehrt.
  assert.equal(mapPathToGame('/tft/comps/atlas', 'lol', true), '/champions');
  assert.equal(mapPathToGame('/tft/player/A--B', 'lol', true), '/player/A--B');
});

test('/lol gilt als LoL, die Uebersicht als TFT', () => {
  assert.equal(detectGameFromPath('/lol'), 'lol');
  assert.equal(detectGameFromPath('/en/lol'), 'lol');
  assert.equal(detectGameFromPath(TFT_HOME), 'tft');
});

test('Weiterleitungen in next.config.ts sind voruebergehend (nie 308)', () => {
  // Eine gemerkte 308 liesse sich beim Umlegen des Schalters nicht mehr
  // zuruecknehmen — deshalb steht hier keine Hauptseiten-Regel mit permanent: true.
  const src = readFileSync(join(import.meta.dirname, '..', '..', 'next.config.ts'), 'utf8');
  const start = src.indexOf('Hauptseite (Schalter TFT_IS_HOME');
  const end = src.indexOf("source: '/tft/gods'");
  assert.ok(start > 0 && end > start, 'Hauptseiten-Block gefunden');
  const home = src.slice(start, end);
  assert.ok(home.includes("source: '/tft'"), '/tft gehoert zum geprueften Block');
  assert.ok(!/permanent:\s*true/.test(home), 'Hauptseite und /tft nur 307');
});
