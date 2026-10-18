// Elderwood-Pflanzen (tft-elderwood-plants.ts) gegen das echte Set-18-Bundle.
// Geprueft wird, was sonst falsch auf Builder, Comp-Brettern und in der App
// stuende: Pflanzen auf der falschen Stufe, ein falscher Stern, eine Pflanze,
// die nach dem Abbau einer Unit stehen bleibt, und fehlende Namen.
//
// Lauf: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  boardPlantIds, elderwoodCount, emblemBonus, isElderwoodPlant, plantAllowance, plantIds,
  plantName, plantNames, plantRules, plantStar, plantTier, trimPlants,
} from './tft-elderwood-plants.ts';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const bundle = read('../../public/tft-assets-18.json');
const rules = plantRules(bundle);

const STONE = 'DA_Elderwood18_StonebarkTree';
const BLOOM = 'DA_Elderwood18_Lifeblossom';
const GUARD = 'DA_Elderwood18_Protector';
const LANGS = ['de', 'en', 'ko', 'zh', 'es', 'fr'];

const elderwoodUnits = Object.keys(bundle.champions)
  .filter(id => !isElderwoodPlant(id) && (bundle.champions[id].traits || []).includes('Elderwood'));

const allow = (n) => Object.fromEntries(plantAllowance(rules, n));

test('Bundle: Elderwood mit 5 Stufen, Trait-Text nennt alle drei Pflanzen und die Sterne', () => {
  assert.ok(rules, 'keine Regeln — Trait fehlt oder hat andere Stufen');
  assert.equal(rules.traitName, 'Elderwood');
  assert.deepEqual(rules.mins, [3, 5, 7, 9, 11]);
  const desc = bundle.traits.DA_18_Elderwood.desc;
  for (const s of ['Stonebark Tree and a Lifebloom', 'second Stonebark Tree', 'Deepwood Protector', '2-star', '3-star']) {
    assert.ok(desc.includes(s), `Trait-Text ohne "${s}"`);
  }
  assert.ok(bundle.items[rules.emblem], 'Elderwood-Emblem fehlt im Bundle');
  assert.ok(elderwoodUnits.length >= 8, `nur ${elderwoodUnits.length} Elderwood-Units`);
});

test('Bundle: Pflanzen ohne Kosten, ohne Synergie, mit Bild und dem englischen Namen der Tabelle', () => {
  assert.deepEqual(plantIds(rules), [STONE, BLOOM, GUARD]);
  for (const id of plantIds(rules)) {
    const c = bundle.champions[id];
    assert.ok(c, `${id} fehlt im Bundle`);
    assert.equal(c.cost, 0, id);
    assert.deepEqual(c.traits, [], id);
    assert.ok(c.icon, `${id} ohne Bild`);
    assert.equal(c.name, plantName(id, 'en'), id);
    assert.ok(!bundle.plannerCodes?.[id], `${id} hat einen Planner-Code`);
  }
});

test('Namen: alle 6 Sprachen gefuellt, unbekannte Sprache faellt auf Englisch, Nicht-Pflanze null', () => {
  for (const id of plantIds(rules)) {
    const names = plantNames(id);
    for (const l of LANGS) assert.ok(names[l] && names[l] !== id, `${id} ohne ${l}`);
  }
  assert.equal(plantName(STONE, 'de'), 'Steinrindenbaum');
  assert.equal(plantName(STONE, 'xx'), 'Stonebark Tree');
  assert.equal(plantName('DA_18_Xayah', 'de'), null);
  assert.equal(isElderwoodPlant('DA_18_Lux_Elderwood'), false);
});

test('Stufen: Zahl je Pflanze und Stern folgen der Elderwood-Zahl', () => {
  assert.deepEqual(allow(2), {});
  assert.deepEqual(allow(3), { [STONE]: 1, [BLOOM]: 1 });
  assert.deepEqual(allow(4), { [STONE]: 1, [BLOOM]: 1 });
  assert.deepEqual(allow(5), { [STONE]: 2, [BLOOM]: 1 });
  assert.deepEqual(allow(7), { [STONE]: 2, [BLOOM]: 1, [GUARD]: 1 });
  assert.deepEqual(allow(11), { [STONE]: 2, [BLOOM]: 1, [GUARD]: 1 });
  assert.deepEqual([2, 3, 7, 8, 9, 10, 11].map(n => plantStar(rules, n)), [1, 1, 1, 1, 2, 2, 3]);
  assert.equal(plantTier(rules, 0), -1);
});

test('trimPlants: Ueberzaehlige fallen weg, die zuerst gesetzten bleiben; ohne Wegfall dasselbe Array', () => {
  const ps = [
    { cell: 1, characterId: STONE },
    { cell: 2, characterId: 'DA_18_Xayah' },
    { cell: 3, characterId: STONE },
    { cell: 4, characterId: GUARD },
    { cell: 5, characterId: BLOOM },
  ];
  assert.equal(trimPlants(ps, rules, 7), ps);
  assert.deepEqual(trimPlants(ps, rules, 5).map(p => p.cell), [1, 2, 3, 5]);
  assert.deepEqual(trimPlants(ps, rules, 3).map(p => p.cell), [1, 2, 5]);
  assert.deepEqual(trimPlants(ps, rules, 2).map(p => p.cell), [2]);
  // Ohne Regeln (Bundle fehlt) bleibt alles stehen.
  assert.equal(trimPlants(ps, null, 0), ps);
  assert.equal(plantRules(null), null);
  assert.equal(plantRules({ traits: { DA_18_Elderwood: { name: 'Elderwood', tiers: [{ minUnits: 3 }] } } }), null);
});

test('elderwoodCount: jeder Champion einmal, Pflanzen und fremde Units zaehlen nicht', () => {
  const three = elderwoodUnits.slice(0, 3);
  assert.equal(elderwoodCount(rules, bundle, [...three, three[0], STONE, 'DA_18_Garen']), 3);
});

test('emblemBonus: nur je Spiel gezaehlte Anteile ab 0,5', () => {
  const rows = (share) => [{ item: rules.emblem, share }];
  assert.equal(emblemBonus(rules, { basis: 'games', rows: rows(0.5) }), 1);
  assert.equal(emblemBonus(rules, { basis: 'games', rows: rows(0.49) }), 0);
  assert.equal(emblemBonus(rules, { basis: 'copies', rows: rows(0.9) }), 0);
  assert.equal(emblemBonus(rules, { basis: 'games', rows: [{ item: 'DA_18_EmblemVanguard', share: 0.9 }] }), 0);
  assert.equal(emblemBonus(rules, null), 0);
});

test('boardPlantIds: Kopien je Pflanze, Emblem hebt auf die naechste Stufe', () => {
  assert.deepEqual(boardPlantIds(rules, bundle, elderwoodUnits.slice(0, 2)), []);
  assert.deepEqual(boardPlantIds(rules, bundle, elderwoodUnits.slice(0, 3)), [STONE, BLOOM]);
  assert.deepEqual(boardPlantIds(rules, bundle, elderwoodUnits.slice(0, 4), 1), [STONE, STONE, BLOOM]);
  assert.deepEqual(boardPlantIds(rules, bundle, elderwoodUnits.slice(0, 6), 1), [STONE, STONE, BLOOM, GUARD]);
});
