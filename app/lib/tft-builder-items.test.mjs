// Item-Regeln des Comp-Builders gegen das echte Set-18-Bundle und die
// Item-Texte. Anlass 2026-10-18: gleiche Items liessen sich nicht mehrfach
// ausruesten, Embleme zaehlten nicht, Thief's Gloves belegte nur 1 Platz.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { emblemTraitOf, itemBlock, itemSlots, slotsUsed, RETIRED_ITEM_IDS, championTraitNames } from './tft-builder-items.ts';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const bundle = read('../../public/tft-assets-18.json');
const texts = read('../../public/tft-item-texts-18.json');
const active = new Set(bundle.active.items);

// Eine Unit, die die Synergie des Vanguard-Emblems NICHT hat, und eine, die sie hat.
const vanguardTrait = emblemTraitOf(bundle, 'DA_18_EmblemVanguard');
const champs = Object.keys(bundle.champions).filter(id => id.startsWith('DA_') && (bundle.champions[id].traits || []).length);
const withVanguard = champs.find(id => championTraitNames(bundle, id).includes(vanguardTrait));
const withoutVanguard = champs.find(id => !championTraitNames(bundle, id).includes(vanguardTrait));

test('Emblem → Synergie ueber den Namen, auch bei abweichender Kennung', () => {
  assert.equal(vanguardTrait, 'Vanguard');
  assert.equal(emblemTraitOf(bundle, 'DA_18_EmblemSlayer'), 'Ravager');
  // Phantom Emblem gibt keine feste Synergie → kein ausruestbares Emblem
  assert.equal(emblemTraitOf(bundle, 'DA_PhantomEmblem18'), null);
  assert.equal(emblemTraitOf(bundle, 'DA_Deathblade'), null);
  const emblems = [...active].filter(id => / Emblem$/.test(bundle.items[id]?.name || '') && !/Phantom/.test(id));
  for (const id of emblems) assert.ok(emblemTraitOf(bundle, id), `${id} ohne Synergie`);
  assert.ok(withVanguard && withoutVanguard);
});

test('Gleiche Items bis 3, dann voll; Entfernen ist Sache der Seite', () => {
  const u = (items) => ({ characterId: withoutVanguard, items });
  assert.equal(itemBlock(bundle, texts, u([]), 'DA_Deathblade'), null);
  assert.equal(itemBlock(bundle, texts, u(['DA_Deathblade']), 'DA_Deathblade'), null);
  assert.equal(itemBlock(bundle, texts, u(['DA_Deathblade', 'DA_Deathblade']), 'DA_Deathblade'), null);
  assert.equal(itemBlock(bundle, texts, u(['DA_Deathblade', 'DA_Deathblade', 'DA_Deathblade']), 'DA_Deathblade'), 'full');
});

test('"Nur 1 pro Champion" gilt nur fuer die markierten Artefakte', () => {
  const u = (items) => ({ characterId: withoutVanguard, items });
  assert.equal(itemBlock(bundle, texts, u(['DA_Artifact_ZhonyasParadox']), 'DA_Artifact_ZhonyasParadox'), 'unique');
  assert.equal(itemBlock(bundle, texts, u(['DA_Artifact_LichBane']), 'DA_Artifact_LichBane'), null);
});

test("Thief's Gloves belegt 3 Plaetze, auch Radiant und ohne Textdatei", () => {
  const u = (items) => ({ characterId: withoutVanguard, items });
  for (const tg of ['DA_ThiefsGloves', 'DA_ThiefsGlovesRadiant']) {
    assert.equal(itemSlots(texts, tg), 3);
    assert.equal(itemSlots(null, tg), 3);
    assert.equal(itemBlock(bundle, texts, u([]), tg), null);
    assert.equal(itemBlock(bundle, texts, u(['DA_Deathblade']), tg), 'full');
    assert.equal(itemBlock(bundle, texts, u([tg]), 'DA_Deathblade'), 'full');
    assert.equal(slotsUsed(texts, [tg]), 3);
  }
});

test('Emblem nicht auf eigene Synergie und nicht doppelt', () => {
  assert.equal(itemBlock(bundle, texts, { characterId: withVanguard, items: [] }, 'DA_18_EmblemVanguard'), 'emblem');
  assert.equal(itemBlock(bundle, texts, { characterId: withoutVanguard, items: [] }, 'DA_18_EmblemVanguard'), null);
  assert.equal(itemBlock(bundle, texts, { characterId: withoutVanguard, items: ['DA_18_EmblemVanguard'] }, 'DA_18_EmblemVanguard'), 'emblem');
});

test('Rest-Liste zeigt auf Eintraege, die es im Set-18-Bundle wirklich gibt', () => {
  for (const id of RETIRED_ITEM_IDS) assert.ok(active.has(id), `${id} nicht mehr in active.items — Liste pruefen`);
});
