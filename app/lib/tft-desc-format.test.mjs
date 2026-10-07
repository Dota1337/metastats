// Beschreibungstexte aus CommunityDragon. Anlass 2026-10-05: Builder-Tooltips
// zeigten rohe Platzhalter (@Duration@, %i:scaleAP%, {{TFT_Keyword_X}}).
// Set 18 hat keine Werte je Stern, deshalb wird bereinigt, nie erfunden.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatTftDesc } from './tft-desc-format.ts';

const bundle = (n) => JSON.parse(fs.readFileSync(new URL(`../../public/tft-assets-${n}.json`, import.meta.url), 'utf8'));
const RAW = /@|%i:|\{\{|\{[A-Za-z]|\\n|<[a-z/]|\u0001|\u0002/;

test('Faehigkeit: Platzhalter weg, Saetze bleiben lesbar', () => {
  assert.equal(
    formatTftDesc('Taunt, forcing enemies to attack this champion. For @Duration@ seconds, gain @ShieldCalc1@ %i:scaleAP% Shield and @ArmorMR@ Armor and Magic Resist. \\n \\nWhen the Shield breaks, deal @PhysicalDamageCalc1@ %i:scaleArmor%%i:scaleMR% physical damage to enemies in @DamageHexRange@ Hexes.'),
    'Taunt, forcing enemies to attack this champion. Gain Shield and Armor and Magic Resist.\nWhen the Shield breaks, deal physical damage to enemies.',
  );
  assert.match(
    formatTftDesc('Purple Buff: Every @TraitTimer@ seconds, Gromp gains @TraitTimedAP@ Ability Power.'),
    /^Purple Buff: Periodically, Gromp gains Ability Power\.$/,
  );
  assert.match(
    formatTftDesc('dealing @A@ %i:scaleAD% physical damage + @B@ %i:scaleAD% for each attack while casting.'),
    /^dealing physical damage plus more for each attack while casting\.$/,
  );
});

test('Schluesselwort hinter einem Satzende ist nur ein Verweis', () => {
  assert.equal(
    formatTftDesc('Gain 2 Hands of Justice. Allies equipped with Hand of Justice gain Precision and 25% Critical Strike Chance.{{TFT_Keyword_Precision}}'),
    'Gain 2 Hands of Justice. Allies equipped with Hand of Justice gain Precision and 25% Critical Strike Chance.',
  );
  assert.equal(formatTftDesc('获得精准。{{TFT_Keyword_Precision}}'), '获得精准。');
});

test('Negativfall: echte Zahlen und Satzzeichen bleiben', () => {
  const de = 'Champions, die den Kampf neben einer Ahnenholz-Pflanze beginnen, erhalten 15 % Angriffstempo und heilen sich alle 2 Sekunden um 2 % ihres maximalen Lebens.';
  assert.equal(formatTftDesc(de), de);
  assert.equal(formatTftDesc('Uno, dos..., ¡cinco!'), 'Uno, dos..., ¡cinco!');
  assert.equal(formatTftDesc('Gain a holographique !'), 'Gain a holographique !');
  assert.equal(formatTftDesc(''), '');
  assert.equal(formatTftDesc(undefined), '');
});

test('Zaehler-Anzeige ohne Wert am Ende faellt weg, Klammerinhalt bleibt', () => {
  assert.equal(
    formatTftDesc('아군 챔피언이 15명 사망할 때마다 무작위 조합 아이템 1개를 획득합니다. (최대 3개)남은 사망 횟수:'),
    '아군 챔피언이 15명 사망할 때마다 무작위 조합 아이템 1개를 획득합니다. (최대 3개)',
  );
  assert.equal(formatTftDesc('Gain 5 gold. Rolls: Health:'), 'Gain 5 gold.');
  assert.equal(formatTftDesc('获得1个强大的随机奖励。奖励：'), '获得1个强大的随机奖励。');
});

for (const set of [17, 18]) {
  test(`Set ${set}: kein Platzhalter bleibt in irgendeinem Text`, () => {
    const a = bundle(set);
    const texts = [];
    for (const c of Object.values(a.champions)) if (c.ability?.desc) texts.push(c.ability.desc);
    for (const i of Object.values(a.items)) if (i.desc) texts.push(i.desc);
    for (const x of Object.values(a.augments)) {
      if (x.desc) texts.push(x.desc);
      for (const v of Object.values(x.i18n || {})) if (v.desc) texts.push(v.desc);
    }
    assert.ok(texts.length > 1000);
    const rest = texts.map(formatTftDesc).filter((t) => RAW.test(t) || /%/.test(t.replace(/\d[\s\u00a0\u202f]?%/g, '')));
    assert.deepEqual(rest.slice(0, 5), []);
  });
}
