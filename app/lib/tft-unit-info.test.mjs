import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAbilityDesc, statByStar, STAR_HP, STAR_AD } from './tft-unit-info.ts';

// Kurzform: Zeilen als Text, Stile in [..], Sternwerte in {..}, Symbole in <..>.
const flat = (raw) => parseAbilityDesc(raw).map(l => l.map(s =>
  s.k === 'text' ? (s.style ? `[${s.style}:${s.text}]` : s.text)
    : s.k === 'stars' ? `{${s.values.join('/')}${s.suffix}}` : `<${s.icon}>`).join(''));

test('Text mit Absaetzen, Farben, Sternwerten und Symbolen', () => {
  const raw = '<bright>Passive:</bright> On cast, allies gain <colorstat>3/3/100 %i:scaleAP%</colorstat> mana. <br><br>'
    + '<bright>Active:</bright> Deals <colormagic>375/565/6500 %i:scaleAP%</colormagic> magic damage, reduced by 25%/25%/10% for each enemy hit (minimum 40%).';
  assert.deepEqual(flat(raw), [
    '[bright:Passive:] On cast, allies gain {3/3/100}[stat: ]<scaleAP> mana.',
    '',
    '[bright:Active:] Deals {375/565/6500}[magic: ]<scaleAP> magic damage, reduced by {25%/25%/10%} for each enemy hit (minimum 40%).',
  ]);
});

test('Regel-Erklaerung beginnt eine eigene Zeile, <row> bleibt im Satz', () => {
  const raw = 'Stun for 1/1/6 seconds if the target is <keyword>Burning</keyword>.<rules>Burn: Deals true damage.</rules>'
    + '<br><row>Teal Buff:</row> <row>Gain </row><row>2</row> <row>Mana.</row>';
  assert.deepEqual(flat(raw), [
    'Stun for {1/1/6} seconds if the target is [keyword:Burning].',
    '[rules:Burn: Deals true damage.]',
    'Teal Buff: Gain 2 Mana.',
  ]);
});

test('Unbekannte Tags fallen weg, ihr Text bleibt; leer → keine Zeilen', () => {
  assert.deepEqual(flat('A <foo x="1">b</foo> c'), ['A b c']);
  assert.deepEqual(parseAbilityDesc(''), []);
  assert.deepEqual(parseAbilityDesc(null), []);
});

test('Werte je Stern: Leben x1,8, Angriffsschaden x1,5', () => {
  assert.deepEqual(statByStar(900, STAR_HP), [900, 1620, 2916]);
  assert.deepEqual(statByStar(40, STAR_AD), [40, 60, 90]);
  assert.equal(statByStar(null, STAR_HP), null);
});
