// Item-Regeln des Comp-Builders gegen das echte Set-18-Bundle und die
// Item-Texte. Anlass 2026-10-18: gleiche Items liessen sich nicht mehrfach
// ausruesten, Embleme zaehlten nicht, Thief's Gloves belegte nur 1 Platz.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { emblemTraitOf, itemBlock, itemSlots, slotsUsed, RETIRED_ITEM_IDS, championTraitNames, itemTeamSize, teamLimit, TEAM_SIZE_BASE, BOARD_CELLS, unitTeamSlots, teamSlotsUsed, boardTraitCounts, traitTeamSize } from './tft-builder-items.ts';

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

// Anlass 2026-10-18: Tactician's Crown/Cape/Shield fehlten im Builder, das
// Brett blieb fest bei 10.
test('Tactician-Items: +1 Brettplatz je Item, aus Text und ohne Textdatei', () => {
  const tactician = ['DA_TacticiansCape', 'DA_TacticiansCrown', 'DA_TacticiansShield'];
  for (const id of tactician) {
    assert.ok(active.has(id), `${id} nicht aktiv`);
    assert.equal(itemTeamSize(texts, id), 1);
    assert.equal(itemTeamSize(null, id), 1);
  }
  // Augment mit aehnlichem Namen und normale Items zaehlen nicht
  for (const id of ['DA_TacticiansKitchen', 'TFT_Augment_TacticiansKitchen', 'DA_Deathblade', 'DA_18_EmblemVanguard']) {
    assert.equal(itemTeamSize(texts, id), 0, id);
    assert.equal(itemTeamSize(null, id), 0, id);
  }
  // In der Textdatei hat genau das Trio ein teamSize
  assert.deepEqual(Object.keys(texts.items).filter(id => texts.items[id].teamSize).sort(), tactician);
});

test('Elderwood-Pflanzen: kein Brettplatz, normale Items ja, Embleme und Tactician-Items nein', () => {
  const plant = { characterId: 'DA_Elderwood18_StonebarkTree', items: [] };
  assert.equal(unitTeamSlots(bundle, plant.characterId), 0);
  assert.equal(teamSlotsUsed(bundle, [plant, { characterId: withVanguard }]), 1);
  assert.equal(itemBlock(bundle, texts, plant, 'DA_Deathblade'), null);
  assert.equal(itemBlock(bundle, texts, plant, 'DA_18_EmblemElderwood'), 'plant');
  assert.equal(itemBlock(bundle, texts, plant, 'DA_18_EmblemVanguard'), 'plant');
  assert.equal(itemBlock(bundle, texts, plant, 'DA_TacticiansCrown'), 'plant');
  assert.equal(itemBlock(bundle, null, plant, 'DA_TacticiansCrown'), 'plant');
  // Pflanzen zaehlen fuer keine Synergie.
  assert.equal(boardTraitCounts(bundle, [plant]).size, 0);
});

test('Brettgrenze: 10, jedes Tactician-Item einzeln, hoechstens 28 Felder', () => {
  const u = (items) => ({ characterId: withoutVanguard, items });
  assert.equal(TEAM_SIZE_BASE, 10);
  assert.equal(teamLimit(texts, []), 10);
  assert.equal(teamLimit(texts, [u(['DA_Deathblade']), u([])]), 10);
  assert.equal(teamLimit(texts, [u(['DA_TacticiansCrown'])]), 11);
  // zwei gleiche auf einer Unit zaehlen doppelt, drei verschiedene verteilt dreifach
  assert.equal(teamLimit(texts, [u(['DA_TacticiansCrown', 'DA_TacticiansCrown'])]), 12);
  assert.equal(teamLimit(texts, [u(['DA_TacticiansCrown']), u(['DA_TacticiansCape']), u(['DA_TacticiansShield', 'DA_Deathblade'])]), 13);
  assert.equal(teamLimit(null, [u(['DA_TacticiansShield'])]), 11);
  const many = Array.from({ length: 10 }, () => u(['DA_TacticiansCrown', 'DA_TacticiansCrown', 'DA_TacticiansCrown']));
  assert.equal(teamLimit(texts, many), BOARD_CELLS);
});

// Anlass 2026-10-18: Elder Dragon belegt im Spiel 2 Plaetze und zaehlt fuer
// Riftbeast als 2, Riftbeast 10 gibt +2 Plaetze — der Builder zaehlte 1/1/0.
// Logik mit Testdaten, damit der Test den Set-Wechsel ueberlebt.
const fx = {
  traits: {
    T_Apex: { name: 'Apex Predator', desc: 'Elder Dragon takes up 2 team slots and grants +2 to the Riftbeast trait.', tiers: [{ minUnits: 1 }] },
    T_Rift: { name: 'Riftbeast', desc: 'Bonus.(@MinUnits@) +@TeamSize@ maximum team size', tiers: [{ minUnits: 3 }, { minUnits: 5 }, { minUnits: 7 }, { minUnits: 10, variables: { TeamSize: 2 } }] },
    T_Van: { name: 'Vanguard', desc: 'Shield.', tiers: [{ minUnits: 2, variables: { TeamSize: 5 } }] },
    T_Ghost: { name: 'Ghost', desc: 'Ghost Unit takes up 3 team slots.', tiers: [{ minUnits: 1 }] },
  },
  champions: {
    Elder: { name: 'Elder Dragon', traits: ['Apex Predator', 'Riftbeast'] },
    ElderPve: { name: 'Elder Dragon', traits: [] },
    GhostOther: { name: 'Ghost Unit', traits: ['Vanguard'] },
    ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`R${i}`, { name: `R${i}`, traits: ['Riftbeast'] }])),
    V0: { name: 'V0', traits: ['Vanguard'] }, V1: { name: 'V1', traits: ['Vanguard'] },
  },
  items: { E_Rift: { name: 'Riftbeast Emblem' } },
};
const unit = (characterId, items = []) => ({ characterId, items });
const rift = (n) => Array.from({ length: n }, (_, i) => unit(`R${i}`));

test('Elder Dragon: 2 Plaetze, zaehlt fuer Riftbeast als 2 — nur die Unit mit Name UND Synergie', () => {
  assert.equal(unitTeamSlots(fx, 'Elder'), 2);
  assert.equal(unitTeamSlots(fx, 'ElderPve'), 1);
  // Text nennt eine Unit ohne diese Synergie → keine Regel
  assert.equal(unitTeamSlots(fx, 'GhostOther'), 1);
  assert.equal(unitTeamSlots(fx, 'R0'), 1);
  assert.equal(unitTeamSlots(fx, 'gibtsnicht'), 1);
  assert.equal(unitTeamSlots(null, 'Elder'), 1);
  assert.equal(teamSlotsUsed(fx, [unit('Elder'), ...rift(8)]), 10);
  const c = boardTraitCounts(fx, [unit('Elder'), unit('R0')]);
  assert.equal(c.get('Riftbeast'), 3);
  assert.equal(c.get('Apex Predator'), 1);
  // zweite Kopie zaehlt nicht, Emblem gibt +1
  assert.equal(boardTraitCounts(fx, [unit('Elder'), unit('Elder'), unit('V0', ['E_Rift'])]).get('Riftbeast'), 3);
});

test('Riftbeast 10 gibt +2 Plaetze, Synergie ohne Teamgroessen-Text nicht', () => {
  // Elder (2) + 7 Riftbeasts = 9 → keine Extra-Plaetze
  assert.equal(teamLimit(null, [unit('Elder'), ...rift(7)], fx), 10);
  // Elder (2) + 8 Riftbeasts = 10 → 12 Plaetze
  assert.equal(teamLimit(null, [unit('Elder'), ...rift(8)], fx), 12);
  // Vanguard hat einen TeamSize-Wert, der Text nennt ihn nicht → zaehlt nicht
  assert.equal(teamLimit(null, [unit('V0'), unit('V1')], fx), 10);
  // ohne Bundle nur Items
  assert.equal(teamLimit(texts, [unit('Elder', ['DA_TacticiansCrown']), ...rift(8)]), 11);
  assert.equal(teamLimit(texts, [unit('Elder', ['DA_TacticiansCrown']), ...rift(8)], fx), 13);
  // Platzhalter-Trait ohne Aufloesung zaehlt nicht
  assert.equal(teamLimit(null, [unit('Elder'), ...rift(8)], fx, (p, tr) => (p.characterId === 'R0' ? null : tr)), 10);
});

test('Set 18: Elder Dragon und das Riot-Brett mit Riftbeast 10', () => {
  assert.equal(unitTeamSlots(bundle, 'DA_18_ElderDragon'), 2);
  assert.equal(unitTeamSlots(bundle, 'TFT_ElderDragon'), 1);
  // EUW1_8016857850: Stufe 10, 11 Units, davon 9 Riftbeasts mit Elder, Riftbeast 10
  const rb = Object.keys(bundle.champions).filter(id => id !== 'DA_18_ElderDragon' && championTraitNames(bundle, id).includes('Riftbeast'));
  const other = champs.filter(id => !championTraitNames(bundle, id).includes('Riftbeast') && !/ElderDragon/.test(id));
  assert.ok(rb.length >= 8 && other.length >= 2);
  const board = [unit('DA_18_ElderDragon'), ...rb.slice(0, 8).map(id => unit(id)), unit(other[0]), unit(other[1])];
  assert.equal(boardTraitCounts(bundle, board).get('Riftbeast'), 10);
  assert.equal(teamSlotsUsed(bundle, board), 12);
  assert.equal(teamLimit(texts, board, bundle), 12);
});

test('Aktuelles Bundle: jede Brettplatz-Regel im Text wird erkannt', () => {
  const cur = read('../../public/tft-assets.json');
  for (const t of Object.values(cur.traits)) {
    if (/team slot/i.test(t.desc || '')) {
      const hits = Object.keys(cur.champions).filter(id => unitTeamSlots(cur, id) > 1);
      assert.ok(hits.length > 0, `${t.name}: "team slot" im Text, keine Unit erkannt`);
    }
    for (const tier of t.tiers || []) {
      if (!(tier.variables?.TeamSize > 0)) continue;
      const counts = new Map([[t.name, tier.minUnits]]);
      assert.ok(traitTeamSize(cur, counts) > 0, `${t.name} ${tier.minUnits}: TeamSize nicht erkannt`);
    }
  }
});

test('Rest-Liste zeigt auf Eintraege, die es im Set-18-Bundle wirklich gibt', () => {
  for (const id of RETIRED_ITEM_IDS) assert.ok(active.has(id), `${id} nicht mehr in active.items — Liste pruefen`);
});
