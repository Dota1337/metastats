/**
 * Regressionstests für den Single-Source-Klassifikator (MJS = SoT).
 *
 * Warum ausgerechnet hier: Jeder Bug in dieser Datei streut in ALLE Aggregate
 * — Cache-Writer, Daily-Aggregator und der Vercel-Read-Pfad ziehen denselben
 * `cluster_key`. Und die Fehler dieser Klasse crashen nicht, sie erzeugen
 * einen *anderen* Key: das Blitzcrank-UniqueTrait-Fragment als Top-Comp, der
 * Cost-Aware-Swap, der auf einem Pfad lief und auf dem anderen nicht. Beides
 * ist erst über einen Cross-Join mit 0 Treffern aufgefallen.
 *
 * Die Fixtures nutzen echte Set-17-IDs aus public/tft-assets-17.json
 * (TFT17_Bard = 5 Kosten, TFT17_Rammus = 4 Kosten) — der Cost-Aware-Swap
 * liest dieselbe Datei zur Laufzeit, ein erfundener Champion würde ihn
 * stillschweigend nie auslösen und der Test wäre grün ohne zu prüfen.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyComp } from './tft-classify-comp.mjs';

// Die Fixtures unten sind Set-17-Boards (TFT17_*-Champions, TFT_Item_*-IDs).
// Seit dem Set-18-Bump ist CURRENT_SET 18, und sowohl die Cost-Map als auch
// die Damage-Item-Liste sind set-genau — ohne dieses Pin liefe der Test gegen
// das Set-18-Bundle und pruefte nichts mehr. Set 17 steht hier bewusst als
// Literal: der Test soll seine Fixtures pruefen, nicht das jeweils aktive Set.
const classify = (participant, opts = {}) => classifyComp(participant, { currentSet: 17, ...opts });

const trait = (name, style, tier) => ({ name, style, tier_current: tier });
const unit = (character_id, itemNames = [], tier = 2) => ({ character_id, itemNames, tier });

const DMG = ['TFT_Item_InfinityEdge', 'TFT_Item_Deathblade', 'TFT_Item_LastWhisper'];
const DEF = 'TFT_Item_WarmogsArmor';

test('aktives Trait + Item-Carry ergibt den erwarteten Cluster-Key', () => {
  const res = classify({
    traits: [trait('TFT17_Stargazer', 3, 6)],
    units: [unit('TFT17_Lulu', DMG.slice(0, 2), 3), unit('TFT17_Rammus', [DEF])],
    level: 8,
  });
  assert.equal(res.clusterKey, 'TFT17_Stargazer@6_TFT17_Lulu');
  assert.equal(res.carryUnit, 'TFT17_Lulu');
  assert.equal(res.carryStar, 3);
  assert.equal(res.primaryTraitLevel, 6);
});

test('UniqueTrait-Fragmente werden nie zum Primary-Trait', () => {
  // Genau dieser Fall stand als `BlitzcrankUniqueTrait@1_...` an der Spitze
  // des Pro-Caches, während das Listing die echte Comp zeigte.
  const res = classify({
    traits: [trait('TFT17_BlitzcrankUniqueTrait', 3, 1), trait('TFT17_Stargazer', 1, 2)],
    units: [unit('TFT17_Lulu', DMG.slice(0, 1))],
  });
  assert.equal(res.primaryTrait, 'TFT17_Stargazer');
});

test('nur UniqueTraits aktiv → null statt Fragment-Cluster', () => {
  const res = classify({
    traits: [trait('TFT17_BlitzcrankUniqueTrait', 3, 1)],
    units: [unit('TFT17_Blitzcrank', DMG)],
  });
  assert.equal(res, null);
});

test('Fragment-Trait ohne UniqueTrait-Suffix wird trotzdem gefiltert (GravesTrait)', () => {
  // Der Fall, den das alte Namensmuster verfehlt hat: TFT17_GravesTrait hat
  // genau eine Stufe ab 1 Unit, heißt aber nicht *UniqueTrait. Erkannt wird er
  // nur über die Bundle-Ableitung aus public/tft-assets-17.json.
  const res = classify({
    traits: [trait('TFT17_GravesTrait', 4, 1), trait('TFT17_Stargazer', 1, 2)],
    units: [unit('TFT17_Vex', DMG.slice(0, 2))],
  });
  assert.equal(res.primaryTrait, 'TFT17_Stargazer');
});

test('SpaceGroove ist KEIN Fragment-Trait und bleibt Primary', () => {
  // Gegenprobe zum Test darüber. SpaceGroove hat fünf Stufen (1/3/5/7/10) und
  // ist ein normaler Comp-Trait — ein zu grober Filter hätte hier eine echte
  // Comp-Linie zerstört.
  const res = classify({
    traits: [trait('TFT17_SpaceGroove', 3, 3)],
    units: [unit('TFT17_Nami', DMG.slice(0, 2))],
  });
  assert.equal(res.primaryTrait, 'TFT17_SpaceGroove');
});

test('MadredsBloodrazor zählt als Damage-Item', () => {
  // Giant Slayer (Set-17-Rename). Fehlte in DAMAGE_CARRY_ITEMS, wodurch
  // Carries mit diesem Item in der Item-Zählung hinter Nebeneinheiten fielen.
  const res = classify({
    traits: [trait('TFT17_Stargazer', 3, 6)],
    units: [
      unit('TFT17_Lulu', ['TFT_Item_MadredsBloodrazor', 'TFT_Item_InfinityEdge']),
      unit('TFT17_Rammus', DMG.slice(0, 1)),
    ],
  });
  assert.equal(res.carryUnit, 'TFT17_Lulu');
});

test('inaktive Traits (style 0) zählen nicht', () => {
  assert.equal(classify({ traits: [trait('TFT17_Stargazer', 0, 2)], units: [unit('TFT17_Lulu')] }), null);
});

test('leere Units → null, leeres Board → null', () => {
  assert.equal(classify({ traits: [trait('TFT17_Stargazer', 3, 6)], units: [] }), null);
  assert.equal(classify({}), null);
});

test('Trait-Sortierung: style vor tier vor Name', () => {
  const res = classify({
    traits: [trait('TFT17_Aaa', 1, 9), trait('TFT17_Bbb', 3, 2), trait('TFT17_Ccc', 3, 4)],
    units: [unit('TFT17_Lulu', DMG.slice(0, 1))],
  });
  assert.equal(res.primaryTrait, 'TFT17_Ccc', 'höherer style gewinnt, danach tier');
});

test('Cost-Aware-Swap: auf Level 8 gewinnt der 4-Kosten-Carry gegen den 5-Kosten-Filler', () => {
  // Bard (5) trägt gleich viele Damage-Items wie Rammus (4), führt die
  // Sortierung nur über die Item-Gesamtzahl an. Fast-8 heißt: der 4-Koster
  // ist der intendierte Carry, der 5-Koster ist der Legendary-Filler.
  const res = classify({
    traits: [trait('TFT17_Stargazer', 3, 4)],
    units: [
      unit('TFT17_Bard', [...DMG.slice(0, 2), DEF]),
      unit('TFT17_Rammus', DMG.slice(0, 2)),
    ],
    level: 8,
  });
  assert.equal(res.carryUnit, 'TFT17_Rammus');
});

test('Cost-Aware-Swap greift NICHT bei Dual-Carry (beide ≥3 Damage-Items)', () => {
  const res = classify({
    traits: [trait('TFT17_Stargazer', 3, 4)],
    units: [unit('TFT17_Bard', [...DMG, DEF]), unit('TFT17_Rammus', DMG)],
    level: 8,
  });
  assert.equal(res.carryUnit, 'TFT17_Bard', 'zwei echte Carries → keine Umdeutung');
});

test('Cost-Aware-Swap greift NICHT bei aktivem UniqueTrait', () => {
  const res = classify({
    traits: [trait('TFT17_Stargazer', 3, 4), trait('TFT17_BardUniqueTrait', 1, 1)],
    units: [unit('TFT17_Bard', [...DMG.slice(0, 2), DEF]), unit('TFT17_Rammus', DMG.slice(0, 2))],
    level: 8,
  });
  assert.equal(res.carryUnit, 'TFT17_Bard');
});

test('Cost-Aware-Swap greift NICHT auf Level 7', () => {
  const res = classify({
    traits: [trait('TFT17_Stargazer', 3, 4)],
    units: [unit('TFT17_Bard', [...DMG.slice(0, 2), DEF]), unit('TFT17_Rammus', DMG.slice(0, 2))],
    level: 7,
  });
  assert.equal(res.carryUnit, 'TFT17_Bard');
});

test('Hero-Augment schlägt die Item-Zählung', () => {
  const res = classify({
    traits: [trait('TFT17_Stargazer', 3, 4)],
    units: [unit('TFT17_Bard', DMG), unit('TFT17_Lulu', [DEF])],
    augments: ['TFT17_Augment_LuluCarry'],
  });
  assert.equal(res.carryUnit, 'TFT17_Lulu');
});

test('Cache-Shape (characterId/items) und Match-V1-Shape (character_id/itemNames) sind äquivalent', () => {
  const raw = classify({
    traits: [trait('TFT17_Stargazer', 3, 6)],
    units: [{ character_id: 'TFT17_Lulu', itemNames: DMG, tier: 3 }],
  });
  const cached = classify({
    traits: [trait('TFT17_Stargazer', 3, 6)],
    units: [{ characterId: 'TFT17_Lulu', items: DMG, tier: 3 }],
  });
  assert.deepEqual(cached, raw);
});

test('Star 4 wird durchgereicht, nicht auf 3 geklemmt', () => {
  // Set-17-Quirk: es gibt 4-Star-Units. Ein Clamp auf 3 hätte die Variante
  // still in die *3-Statistik gemischt.
  const res = classify({
    traits: [trait('TFT17_Stargazer', 3, 6)],
    units: [unit('TFT17_Lulu', DMG, 4)],
  });
  assert.equal(res.carryStar, 4);
});

test('Augment-Suffix nur im Aggregator-Mode', () => {
  const p = {
    traits: [trait('TFT17_Stargazer', 3, 6)],
    units: [unit('TFT17_Lulu', DMG)],
    augments: ['TFT_Augment_TwoTanky'],
  };
  assert.equal(classify(p).clusterKey, 'TFT17_Stargazer@6_TFT17_Lulu');
  assert.equal(
    classify(p, { withAugmentSuffix: true }).clusterKey,
    'TFT17_Stargazer@6_TFT17_Lulu~TwoTanky',
  );
  assert.equal(classify(p).compDefiningAugment, 'TwoTanky', 'Feld bleibt unabhängig vom Suffix gesetzt');
});

test('Unit-Duplikat rekonstruiert TwoTanky auch ohne augments-Feld', () => {
  // Riot liefert seit 2026-06-15 keine augments mehr — die Duplikat-Heuristik
  // ist der einzige verbliebene Weg zu diesem Sub-Cluster.
  const res = classify({
    traits: [trait('TFT17_Stargazer', 3, 6)],
    units: [unit('TFT17_Lulu', DMG), unit('TFT17_Lulu', [DEF]), unit('TFT17_Rammus', [])],
  }, { withAugmentSuffix: true });
  assert.match(res.clusterKey, /~TwoTanky$/);
});

test('Secondary-Carry ab 3 Damage-Items, darunter null', () => {
  const base = {
    traits: [trait('TFT17_Stargazer', 3, 6)],
    units: [unit('TFT17_Lulu', [...DMG, 'TFT_Item_BlueBuff']), unit('TFT17_Rammus', DMG)],
  };
  assert.equal(classify(base).secondaryCarry, 'TFT17_Rammus');
  const weak = {
    ...base,
    units: [unit('TFT17_Lulu', [...DMG, 'TFT_Item_BlueBuff']), unit('TFT17_Rammus', DMG.slice(0, 2))],
  };
  assert.equal(classify(weak).secondaryCarry, null);
});

test('carryItems sind sortiert und ohne Leerwerte', () => {
  const res = classify({
    traits: [trait('TFT17_Stargazer', 3, 6)],
    units: [unit('TFT17_Lulu', ['TFT_Item_LastWhisper', null, 'TFT_Item_Deathblade', ''])],
  });
  assert.deepEqual(res.carryItems, ['TFT_Item_Deathblade', 'TFT_Item_LastWhisper']);
});

test('fehlendes Trait-tier_current wird als 0 gelesen, nicht als NaN', () => {
  const res = classify({
    traits: [{ name: 'TFT17_Stargazer', style: 3 }],
    units: [unit('TFT17_Lulu', DMG)],
  });
  assert.equal(res.clusterKey, 'TFT17_Stargazer@0_TFT17_Lulu');
  assert.equal(res.primaryTraitLevel, 0);
});

test('Board ganz ohne Items fällt auf die Legacy-Rangfolge zurück statt zu crashen', () => {
  const res = classify({
    traits: [trait('TFT17_Stargazer', 3, 6)],
    units: [unit('TFT17_Rammus', [], 1), unit('TFT17_Lulu', [], 3)],
  });
  assert.equal(res.carryUnit, 'TFT17_Lulu', 'gleiche Item-Zahl → höherer Star gewinnt');
});
