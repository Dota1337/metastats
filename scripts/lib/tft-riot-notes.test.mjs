import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, parseRiotChanges, seriesOf } from './tft-riot-notes.mjs';

const line = (name, ...rows) => `<li><strong>${name}</strong><ul>${rows.map(r => `<li>${r}</li>`).join('')}</ul></li>`;

test('verschachtelte Liste: Name aus der Elternzeile', () => {
  const body = `<h2>TRAITS</h2><ul>${line('Riftbeast (7)', 'AD/AP: 6% <span>⇒ </span>5%')}</ul>`;
  const [c] = parseRiotChanges(body, '18.5');
  assert.deepEqual([c.entity, c.label, c.old, c.new, c.patch, c.mid, c.section], ['Riftbeast (7)', 'AD/AP', '6%', '5%', '18.5', false, 'TRAITS']);
});

test('Name als eigenes <li> davor, beschreibende Zeile dazwischen nimmt ihm nichts', () => {
  const body = '<h2>AUGMENTS</h2><ul><li>Cooking Pot</li><li>Is now excluded from Coronation, The Trait Tree+</li><li>HP per Emblem: 60 ⇒ 70</li></ul>';
  assert.equal(parseRiotChanges(body)[0].entity, 'Cooking Pot');
});

test('Zeile ohne Zahl oder ohne Doppelpunkt faellt raus', () => {
  const body = `<h2>X</h2><ul>${line('A', 'Bonus AS: Now grants more ⇒ much more', 'Stats 6% ⇒ 5%')}</ul>`;
  assert.deepEqual(parseRiotChanges(body), []);
});

test('zeitliche Folge: erst Patch, dann Mid-Patch aeltestes zuerst, obwohl die Seite umgekehrt steht', () => {
  const body = [
    '<h2 id="patch-midpatch-updates">MID-PATCH UPDATE</h2>',
    `<h3>OCTOBER 27TH</h3><ul>${line('Kha\'Zix', 'Damage: 250/350/530 ⇒ 230/310/450')}</ul>`,
    `<h3>OCTOBER 22ND</h3><ul>${line('Kha\'Zix', 'Damage: 255/360/515 ⇒ 250/350/530')}</ul>`,
    `<h2>UNITS</h2><ul>${line('Kha\'Zix', 'Damage: 265/370/535 ⇒ 255/360/515')}</ul>`,
  ].join('');
  const changes = parseRiotChanges(body, '18.5');
  assert.deepEqual(changes.map(c => c.new), ['255/360/515', '250/350/530', '230/310/450']);
  assert.deepEqual(changes.map(c => c.mid), [false, true, true]);
});

test('nameKey und seriesOf', () => {
  assert.equal(nameKey("Kha'Zix (2)"), 'khazix');
  assert.deepEqual(seriesOf('190/285/470 AD'), [190, 285, 470]);
  assert.deepEqual(seriesOf('2,5%'), [2.5]);
  assert.deepEqual(seriesOf('keine'), []);
});
