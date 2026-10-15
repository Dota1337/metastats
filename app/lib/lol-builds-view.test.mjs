/**
 * Namen fuer den Builds-Block (lol-builds-view.ts).
 *
 * Der Server schickt nur die Namen mit, die die Startdaten zeigen. Fehlt einer,
 * steht im ersten HTML eine leere Rune oder ein Konter als Zahl ("103") — und
 * der Browser holt die vollen Listen erst beim ersten Wechsel nach.
 *
 * Lauf: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildsAssetsFrom, itemNamesFrom, usedBuildsIds, usedItemIds } from './lol-builds-view.ts';

const runeTrees = [
  { id: 8100, name: 'Domination', icon: 'd.png', slots: [
    { runes: [{ id: 8112, name: 'Electrocute', icon: 'e.png' }, { id: 8128, name: 'Dark Harvest', icon: 'h.png' }] },
    { runes: [{ id: 8126, name: 'Cheap Shot', icon: 'c.png' }] },
  ] },
  { id: 8200, name: 'Sorcery', icon: 's.png', slots: [{ runes: [{ id: 8226, name: 'Manaflow Band', icon: 'm.png' }] }] },
  { id: 8400, name: 'Resolve', icon: 'r.png', slots: [{ runes: [{ id: 8437, name: 'Grasp', icon: 'g.png' }] }] },
];
const summonerData = {
  SummonerFlash: { id: 'SummonerFlash', key: '4', image: { full: 'SummonerFlash.png' } },
  SummonerDot: { id: 'SummonerDot', key: '14', image: { full: 'SummonerDot.png' } },
  SummonerHeal: { id: 'SummonerHeal', key: '7', image: { full: 'SummonerHeal.png' } },
};
const championData = {
  Ahri: { id: 'Ahri', key: '103', name: 'Ahri', image: { full: 'Ahri.png' } },
  Yasuo: { id: 'Yasuo', key: '157', name: 'Yasuo', image: { full: 'Yasuo.png' } },
  Zed: { id: 'Zed', key: '238', name: 'Zed', image: { full: 'Zed.png' } },
};
const rune = { primary: 8100, keystone: 8112, p1: 8126, p2: 0, p3: 0, secondary: 8200, s1: 8226, s2: 0, off: 5008, flex: 5008, def: 5011, games: 10, wins: 6 };
const data = {
  championKey: '103', region: 'euw1', hasBuilds: true, roles: {
    MIDDLE: {
      games: 10, wins: 6, topBuilds: [], topBoots: [], topItems: [], topRunes: [rune], topKeystones: [{ id: 8128, games: 2, wins: 1 }],
      topSummoners: [{ spells: [4, 14], games: 10, wins: 6 }],
      counters: { strongAgainst: [{ enemy: '157', gamesAgainst: 5, lossesAgainst: 1 }], weakAgainst: [] },
    },
  },
};

test('nur benutzte Namen, aber alle, die der Block zeigt', () => {
  const a = buildsAssetsFrom(runeTrees, summonerData, championData, usedBuildsIds(data));
  assert.deepEqual(Object.keys(a.runeIndex).map(Number).sort(), [8100, 8112, 8126, 8128, 8200, 8226]);
  assert.equal(a.runeIndex[8112].name, 'Electrocute');
  assert.deepEqual(Object.keys(a.summoners).map(Number).sort((x, y) => x - y), [4, 14]);
  assert.equal(a.summoners[4].iconFile, 'SummonerFlash.png');
  assert.deepEqual(Object.keys(a.championMap), ['157']);
  assert.equal(a.championMap['157'].name, 'Yasuo');
});

test('ohne Filter: volle Listen wie bisher im Browser', () => {
  const a = buildsAssetsFrom(runeTrees, summonerData, championData);
  assert.equal(Object.keys(a.runeIndex).length, 8); // 3 Baeume + 5 Runen
  assert.equal(Object.keys(a.summoners).length, 3);
  assert.equal(Object.keys(a.championMap).length, 3);
});

test('kaputte Eingaben ergeben leere Teile, keinen Fehler', () => {
  assert.deepEqual(buildsAssetsFrom(null, null, null), { runeIndex: {}, summoners: {}, championMap: {} });
  assert.deepEqual(buildsAssetsFrom({}, [], 'x'), { runeIndex: {}, summoners: {}, championMap: {} });
  assert.deepEqual(usedBuildsIds({ roles: undefined }).runes.size, 0);
});

test('Item-Kennungen: Builds, Stiefel, Items aller Rollen, ohne leere Plaetze', () => {
  const ids = usedItemIds({ roles: {
    MIDDLE: { topBuilds: [{ items: [3089, 0, 4645] }], topBoots: [{ item: 3020 }], topItems: [{ item: 3089 }, { item: 3100 }] },
    TOP: { topBuilds: [], topBoots: [], topItems: [{ item: 6653 }] },
    BROKEN: undefined,
  } });
  assert.deepEqual([...ids].sort((a, b) => a - b), [3020, 3089, 3100, 4645, 6653]);
  assert.equal(usedItemIds({}).size, 0);
});

test('Item-Namen: nur benutzte, ohne Auszeichnungen, leere fehlen', () => {
  const items = {
    3089: { name: "Rabadon's Deathcap" },
    3901: { name: '<rarityLegendary>Fire at Will</rarityLegendary><br><subtitleLeft><silver>500 Silver Serpents</silver></subtitleLeft>' },
    2008: { name: '' },
    3100: { name: 'Lich Bane' },
  };
  assert.deepEqual(itemNamesFrom(items, [3089, 3901, 2008, 9999]), {
    3089: "Rabadon's Deathcap",
    3901: 'Fire at Will 500 Silver Serpents',
  });
  assert.deepEqual(itemNamesFrom(null, [3089]), {});
  assert.deepEqual(itemNamesFrom('x', [3089]), {});
  assert.deepEqual(itemNamesFrom({ 3089: { name: 42 } }, [3089]), {});
});
