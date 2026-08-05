/**
 * Mirror-Äquivalenz: app/lib/tft-classify-comp.ts (Vercel-Read-Pfad) muss
 * bit-identisch zu scripts/lib/tft-classify-comp.mjs (SoT, Schreib-Pfad)
 * klassifizieren.
 *
 * Warum property-based statt Beispielen: Die Mirror-Drift ist genau die
 * Fehlerklasse, die man mit ausgedachten Fällen NICHT findet — beide Dateien
 * sehen beim Lesen gleich aus, und die Divergenz sitzt in einem Korridor, den
 * niemand als Testfall hinschreibt (Fast-8, 5-Kosten gegen 4-Kosten, gleiche
 * Item-Zahl, kein UniqueTrait). Genau dort lief der Cost-Aware-Swap ein
 * halbes Jahr nur auf einem der beiden Pfade (Audit D1, 2026-06-28).
 * fast-check würfelt diesen Korridor von selbst.
 *
 * Der Generator erzeugt bewusst NUR snake_case-Traits (`tier_current`) — das
 * ist das Match-V1-Shape, das beide Pfade real sehen. Die TS-Seite akzeptiert
 * zusätzlich camelCase; diese absichtliche Asymmetrie steht als eigener Test
 * unten, statt sie als Property-Fehlschlag zu tarnen.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { classifyComp as classifyTs } from './tft-classify-comp.ts';
import { classifyComp as classifyMjs } from '../../scripts/lib/tft-classify-comp.mjs';

// Echte Set-17-IDs mit bekannten Kosten — der Cost-Aware-Swap liest
// public/tft-assets-17.json zur Laufzeit. Erfundene IDs hätten Kosten 0 und
// der Swap wäre in JEDEM generierten Fall stillgelegt.
const CHAMPS = [
  'TFT17_Bard',      // 5
  'TFT17_Fiora',     // 5
  'TFT17_Rammus',    // 4
  'TFT17_Corki',     // 4
  'TFT17_Lulu',
  'TFT17_Vex',
];
const ITEMS = [
  'TFT_Item_InfinityEdge',
  'TFT_Item_Deathblade',
  'TFT_Item_LastWhisper',
  'TFT_Item_BlueBuff',
  'TFT_Item_WarmogsArmor',
  'TFT_Item_DragonsClaw',
];
const TRAIT_NAMES = [
  'TFT17_Stargazer',
  'TFT17_GravesTrait',
  'TFT17_BlitzcrankUniqueTrait',
  'TFT17_FioraUniqueTrait',
];
const AUGMENTS = [
  'TFT_Augment_TwoTanky',
  'TFT17_Augment_LuluCarry',
  'TFT17_Augment_VexGodAugment',
  'TFT_Augment_ComponentCrafting',
];

const arbParticipant = fc.record({
  traits: fc.array(
    fc.record({
      name: fc.constantFrom(...TRAIT_NAMES),
      style: fc.integer({ min: 0, max: 4 }),
      tier_current: fc.integer({ min: 0, max: 7 }),
    }),
    { maxLength: 4 },
  ),
  units: fc.array(
    fc.record({
      character_id: fc.constantFrom(...CHAMPS),
      itemNames: fc.array(fc.constantFrom(...ITEMS), { maxLength: 4 }),
      tier: fc.integer({ min: 1, max: 4 }),
    }),
    { maxLength: 8 },
  ),
  augments: fc.array(fc.constantFrom(...AUGMENTS), { maxLength: 3 }),
  level: fc.integer({ min: 1, max: 10 }),
});

test('TS-Mirror und MJS-SoT klassifizieren identisch (5000 zufällige Boards)', () => {
  fc.assert(
    fc.property(arbParticipant, fc.boolean(), (participant, withAugmentSuffix) => {
      const opts = { withAugmentSuffix };
      assert.deepEqual(classifyTs(participant, opts), classifyMjs(participant, opts));
    }),
    { numRuns: 5000 },
  );
});

test('beide Pfade liefern für dasselbe Board denselben Cluster-Key-Aufbau', () => {
  const participant = {
    traits: [{ name: 'TFT17_Stargazer', style: 3, tier_current: 6 }],
    units: [{ character_id: 'TFT17_Lulu', itemNames: ['TFT_Item_InfinityEdge'], tier: 3 }],
  };
  const res = classifyTs(participant);
  assert.equal(res.clusterKey, 'TFT17_Stargazer@6_TFT17_Lulu');
  assert.deepEqual(res, classifyMjs(participant));
});

test('camelCase-tierCurrent liest nur der TS-Mirror — bewusste Asymmetrie', () => {
  // Das Hetzner-Zwischenformat liefert camelCase; Match-V1 snake_case. Nur der
  // Read-Pfad sieht beide, deshalb ist die Divergenz hier KEIN Drift-Bug. Wer
  // die MJS-Seite anfasst, soll aber an dieser Stelle stolpern statt es
  // nebenbei zu „vereinheitlichen".
  const participant = {
    traits: [{ name: 'TFT17_Stargazer', style: 3, tierCurrent: 6 }],
    units: [{ character_id: 'TFT17_Lulu', itemNames: ['TFT_Item_InfinityEdge'], tier: 3 }],
  };
  assert.equal(classifyTs(participant).clusterKey, 'TFT17_Stargazer@6_TFT17_Lulu');
  assert.equal(classifyMjs(participant).clusterKey, 'TFT17_Stargazer@0_TFT17_Lulu');
});

test('Cluster-Key enthält nie Whitespace oder undefined', () => {
  // Ein `undefined` im Key ist der stille Totalschaden: die Row landet in der
  // DB, joint aber gegen nichts mehr.
  fc.assert(
    fc.property(arbParticipant, (participant) => {
      const res = classifyTs(participant, { withAugmentSuffix: true });
      if (!res) return;
      assert.doesNotMatch(res.clusterKey, /undefined|null|\s/);
      assert.match(res.clusterKey, /^.+@\d+_.+$/);
    }),
    { numRuns: 2000 },
  );
});
