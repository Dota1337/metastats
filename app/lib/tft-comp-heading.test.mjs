// Seitentitel und Ueberschrift einer Comp nennen dieselben Carries
// (compHeadingText). Anlass 09.11.2026: Titel „Verteidiger · Rengar“, h1 auf
// derselben Seite „Verteidiger · Cassiopeia“.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compHeadingText, compHeading } from './tft-comp-heading.ts';

const assets = JSON.parse(readFileSync(new URL('../../public/tft-assets-18.json', import.meta.url), 'utf8'));
const KEY = 'DA_18_Defender@4_DA_18_Rengar';
const u = (characterId, games, items, extra = {}) => ({
  characterId, count: games, gamesWithUnit: games,
  topItems: Object.entries(items).map(([apiName, count]) => ({ apiName, count })), ...extra,
});

test('ohne Units: Trait + Carry aus dem Schluessel', () => {
  assert.equal(compHeadingText({ clusterKey: KEY, games: 500, typicalUnits: [] }, assets, 'en'), 'Defender · Rengar');
});

test('Carry an den Items erkannt: Titel nennt ihn wie die Ueberschrift', () => {
  const comp = {
    clusterKey: KEY, games: 500,
    typicalUnits: [
      u('DA_18_Cassiopeia', 480, { DA_JeweledGauntlet: 400, DA_RabadonsDeathcap: 380 }, { carryItemGamesAll: 470 }),
      u('DA_18_Rengar', 500, {}, { carryItemGamesAll: 0 }),
    ],
  };
  assert.deepEqual(compHeading(comp, assets).named, ['DA_18_Cassiopeia']);
  assert.equal(compHeadingText(comp, assets, 'en'), 'Defender · Cassiopeia');
  // Uebersetzter Trait-Name, gleiche Carries
  assert.match(compHeadingText(comp, assets, 'de'), / · Cassiopeia$/);
});

test('kein Comp-Schluessel: null (Aufrufer nimmt den Namen aus der Kennung)', () => {
  assert.equal(compHeadingText({ clusterKey: 'quatsch', games: 10, typicalUnits: [] }, assets, 'en'), null);
});
