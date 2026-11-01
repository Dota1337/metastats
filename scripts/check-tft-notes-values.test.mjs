import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findStale, staleInText, staleInTrait, withoutReverted } from './check-tft-notes-values.mjs';

const change = (entity, label, old, next, extra = {}) => ({ entity, label, old, new: next, patch: '18.5', ...extra });

test('Reihe: alter Wert da, neuer fehlt', () => {
  const c = change('Caitlyn', 'Damage', '190/285/470 AD', '200/300/490 AD');
  assert.equal(staleInText('deals 190/285/470 damage', c), true);
  assert.equal(staleInText('deals 200/300/490 damage', c), false);
  assert.equal(staleInText('deals 190/285/700 damage', c), false, 'dritter Wert ist kein Befund');
  assert.equal(staleInText('deals 190/285 damage', { ...c, old: '190/285', new: '200/300' }), true);
});

test('einzelne Zahl: Stelle einer Reihe zaehlt nicht (Sivir)', () => {
  const c = change('Sivir', 'Bounce Damage', '20% of initial', '18% of initial');
  assert.equal(staleInText('220/330/1050 + 15/20/100 damage', c), false);
  assert.equal(staleInText('deals 20% of the initial damage', c), true);
});

test('Prozent gegen Prozent, neu in jeder Form (Bronze For Life II)', () => {
  const c = change('Bronze For Life II', 'Resists per Trait', '3%', '2.5%');
  assert.equal(staleInText('gains 3% Damage Amp and 2.5 Armor', c), false);
  assert.equal(staleInText('gains 3 Armor', c), false, 'ohne Prozentzeichen kein Beleg fuer 3 %');
  assert.equal(staleInText('gains 3% Armor', c), true);
});

test('Riots Symbole sind keine Prozentzeichen', () => {
  const c = change('Helm', 'AD/AP', '40%', '35%');
  assert.equal(staleInText('40 %i:scaleMR% 7 %i:mana%', c), false);
  const plain = change('Helm', 'Mana Regen', '7', '6');
  assert.equal(staleInText('40 %i:scaleMR% 7 %i:mana%', plain), true);
  assert.equal(staleInText('40 %i:scaleMR% 6 %i:mana%', plain), false);
});

const beast = ad => ({ name: 'Riftbeast', tiers: [{ variables: { '{1b76cfed}': ad, Armor: 5 } }] });
const RIFT = change('Riftbeast (7)', 'AD/AP', '6%', '5%');

test('Gegenprobe Riftbeast: ohne Korrektur Befund, mit Korrektur keiner', () => {
  assert.equal(staleInTrait(beast(0.06), RIFT), true);
  assert.equal(staleInTrait(beast(0.05), RIFT), false);
  assert.equal(staleInTrait(beast(0.04), RIFT), false, 'dritter Wert');
});

test('Prozent-Zeile sucht nur in Anteilen: 5 Ruestung ist kein Beleg fuer 5 %', () => {
  assert.equal(staleInTrait({ name: 'X', tiers: [{ variables: { AD: 0.06, Armor: 5 } }] }, RIFT), true);
});

test('Faktor-Schreibweise: 1,4 sind 140 %', () => {
  const c = change('Elderwood (9)', 'Summon Bonus Health', '140%', '125%');
  assert.equal(staleInTrait({ name: 'Elderwood', tiers: [{ variables: { H: 1.4 } }] }, c), true);
  assert.equal(staleInTrait({ name: 'Elderwood', tiers: [{ variables: { H: 1.25 } }] }, c), false);
});

test('Zuruecknahme hebt sich auf (Brambleback), echte Kette nicht', () => {
  const up = change('Brambleback', 'Alpha Mark Heal', '4%', '5%');
  const down = change(null, 'Brambleback: Healing On-Hit', '5%', '4%', { mid: true });
  const other = change('Sivir', 'X', '5%', '4%');
  assert.deepEqual(withoutReverted([up, down]), []);
  assert.deepEqual(withoutReverted([up, other]), [up, other]);
  const a = change('Kai', 'D', '1/2', '3/4');
  const b = change('Kai', 'D', '3/4', '5/6');
  assert.deepEqual(withoutReverted([a, b]), [a, b]);
});

const BUNDLE = {
  champions: { C: { name: 'Caitlyn' } },
  traits: { T: beast(0.05) },
  augments: {
    DA_P: { name: 'Patience Is A Virtue', desc: 'Gain 5 rerolls' },
    OLD_P: { name: 'Patience is a Virtue', desc: 'Gain 4 rerolls', aliasOf: 'DA_P' },
    A: { name: 'Nesting Anvils', desc: 'gain 4 gold' },
  },
  active: { items: ['B', 'BR'] },
  items: { B: { name: 'Blue Buff' }, BR: { name: 'Radiant Blue Buff' } },
};
const TEXTS = { items: { B: { i18n: { en: { desc: 'x', stats: '15%' } } }, BR: { i18n: { en: { desc: 'x', stats: '30%' } } } } };
const UNITS = { units: { C: { ability: { desc: { en: 'deals 190/285/470' } } } } };

test('Gesamtlauf: Unit, Augment, Radiant-Abschnitt; Kopie und Fremdes still', () => {
  const findings = findStale({
    bundle: BUNDLE, itemTexts: TEXTS, unitInfo: UNITS,
    changes: [
      change('Caitlyn', 'Damage', '190/285/470', '200/300/490'),
      RIFT,
      change('Patience Is A Virtue', 'Initial Rerolls', '4', '5'),
      change('Nesting Anvils', 'Gold', '4', '6'),
      change('Blue Buff', 'Base AD/AP', '30%', '25%', { section: 'RADIANT ITEMS' }),
      change('Unbekannt', 'D', '1', '2'),
    ],
  });
  assert.equal(findings.length, 3);
  assert.match(findings[0], /Unit Caitlyn/);
  assert.match(findings[1], /Augment Nesting Anvils/);
  assert.match(findings[2], /Item Radiant Blue Buff/);
});
