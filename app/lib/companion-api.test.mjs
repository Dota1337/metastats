/**
 * Zuschnitt der Overwolf-App-Antworten (companion-api.ts).
 *
 * Geprueft wird, was die App sonst falsch anzeigen wuerde: Mitspieler-Zeilen
 * oder Augments im eigenen Verlauf, relative Bildpfade, die in der App ins
 * Leere zeigen, und Rezepte fuer Items, die gar keine Rezepte sind.
 *
 * Lauf: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  absoluteUrl,
  toCompanionLookups,
  toCompanionMatch,
  COMPANION_CORS_HEADERS,
  SITE_ORIGIN,
} from './companion-api.ts';

test('absoluteUrl: relative Pfade bekommen die Seite davor, absolute bleiben', () => {
  assert.equal(absoluteUrl('/api/img/a.png'), `${SITE_ORIGIN}/api/img/a.png`);
  assert.equal(absoluteUrl('https://x.org/a.png'), 'https://x.org/a.png');
  assert.equal(absoluteUrl(null), null);
  assert.equal(absoluteUrl(''), null);
});

test('CORS: offen fuer alle Herkuenfte, nur lesend', () => {
  assert.equal(COMPANION_CORS_HEADERS['Access-Control-Allow-Origin'], '*');
  assert.equal(COMPANION_CORS_HEADERS['Access-Control-Allow-Methods'], 'GET, OPTIONS');
});

test('toCompanionMatch: nur die eigene Zeile, keine Augments, aktive Traits zuerst', () => {
  const m = {
    matchId: 'EUW1_1',
    gameDatetime: 1000,
    queueId: 1100,
    participants: [
      { puuid: 'other', placement: 1, units: [{ characterId: 'X' }] },
      {
        puuid: 'me',
        placement: 4,
        level: 8,
        augments: ['DA_Augment_Secret'],
        traits: [
          { name: 'T_off', numUnits: 1, style: 0 },
          { name: 'T_bronze', numUnits: 2, style: 1 },
          { name: 'T_gold', numUnits: 4, style: 3 },
        ],
        units: [{ characterId: 'A', tier: 2, itemNames: ['I1'] }, { characterId: 'B' }],
      },
    ],
  };
  const out = toCompanionMatch(m, 'me');
  assert.equal(out.placement, 4);
  assert.deepEqual(out.traits.map(t => t.id), ['T_gold', 'T_bronze']);
  assert.deepEqual(out.units, [{ id: 'A', star: 2, items: ['I1'] }, { id: 'B', star: 1, items: [] }]);
  assert.ok(!JSON.stringify(out).includes('Augment'));
  assert.ok(!JSON.stringify(out).includes('other'));
});

test('toCompanionMatch: Spiel ohne eigene Zeile faellt weg', () => {
  assert.equal(toCompanionMatch({ matchId: 'x', participants: [{ puuid: 'a', placement: 1 }] }, 'me'), null);
  assert.equal(toCompanionMatch({ participants: [{ puuid: 'me', placement: 1 }] }, 'me'), null);
});

test('toCompanionLookups: nur Set-Champions, alle aktiven Items ausser Augmenten', () => {
  const assets = {
    set: 18,
    iconBase: 'https://raw.communitydragon.org/latest/game/',
    champions: {
      U1: { name: 'Unit', cost: 3, icon: 'u.png', tile: '/api/img/u.png', traits: ['T1'] },
      M1: { name: 'Monster', cost: 0, icon: 'm.png', traits: [] },
    },
    items: {
      C1: { name: 'Comp1', icon: 'c1.png', tags: ['component'] },
      C2: { name: 'Comp2', icon: 'c2.png', tags: ['component'] },
      F1: { name: 'Full', icon: 'f1.png', composition: ['C1', 'C2'] },
      R1: { name: 'Radiant', icon: 'r1.png', composition: ['F1'] },
      N1: { name: 'Not active', icon: 'n1.png', composition: ['C1', 'C1'] },
      A1: { name: 'Artifact', icon: 'assets/maps/tft/icons/items/hexcore/a1.png' },
      Z1: { name: 'Aftershock', icon: 'assets/ux/tft/hud/zaps/wands/z1.png' },
      E1: { name: 'Emblem', icon: 'e1.png', composition: ['X'] },
      DA_18_EmblemFooAugment: { name: 'Foo Emblem', icon: 'e2.png' },
    },
    traits: { T1: { name: 'Trait', icon: 't.png' } },
    augments: {},
    active: { items: ['C1', 'C2', 'F1', 'R1', 'A1', 'Z1', 'E1', 'DA_18_EmblemFooAugment'] },
  };
  const l = toCompanionLookups(assets);
  assert.deepEqual(Object.keys(l.champions), ['U1']);
  assert.equal(l.champions.U1.icon, `${SITE_ORIGIN}/api/img/u.png`);
  assert.deepEqual(Object.keys(l.items).sort(), ['A1', 'C1', 'C2', 'DA_18_EmblemFooAugment', 'E1', 'F1', 'R1']);
  assert.deepEqual(l.items.F1.recipe, ['C1', 'C2']);
  assert.equal(l.items.R1.recipe, undefined);
  assert.equal(l.items.C1.component, true);
  assert.equal(l.shopOdds[9].length, 5);
});
