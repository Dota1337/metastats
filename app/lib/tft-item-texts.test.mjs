// Item-Texte von tactics.tools (scripts/refresh-item-texts.mjs). Anlass
// 2026-10-18: Set-18-Items hatten im Builder keinen Infotext, weil
// CommunityDragon fuer sie keine Beschreibung liefert.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStatLine, itemTextFor } from './tft-item-texts.ts';
import { extractAssigned } from '../../scripts/refresh-item-texts.mjs';

const texts = JSON.parse(fs.readFileSync(new URL('../../public/tft-item-texts-18.json', import.meta.url), 'utf8'));
const LANGS = ['en', 'de', 'ko', 'zh', 'es', 'fr'];
// wie tft-desc-format.test.mjs: kein roher Platzhalter darf durchkommen
const RAW = /@|%i:|\{\{|\{[A-Za-z]|\\n|<[a-z/]|\u0001|\u0002/;

test('Werte-Zeile: Zahl + Wert, % vor oder hinter dem Symbol', () => {
  assert.deepEqual(parseStatLine('55% %i:scaleAD% 10% %i:scaleDA%'), [
    { value: '55%', key: 'scaleAD' }, { value: '10%', key: 'scaleDA' },
  ]);
  // Radiant: % hinter dem Symbol; Deutsch mit Leerzeichen davor
  const radiant = [
    { value: '40%', key: 'scaleAD' }, { value: '40%', key: 'scaleAP' },
    { value: '40', key: 'scaleMR' }, { value: '40%', key: 'scaleSV' },
  ];
  assert.deepEqual(parseStatLine('40 %i:scaleAD%% 40 %i:scaleAP%% 40 %i:scaleMR% 40 %i:scaleSV%%'), radiant);
  assert.deepEqual(parseStatLine('40 %i:scaleAD% % 40 %i:scaleAP% % 40 %i:scaleMR% 40 %i:scaleSV% %'), radiant);
  assert.deepEqual(parseStatLine('150 %i:scaleHealth% 20% %i:scaleCrit%'), [
    { value: '150', key: 'scaleHealth' }, { value: '20%', key: 'scaleCrit' },
  ]);
  assert.deepEqual(parseStatLine(''), []);
  assert.deepEqual(parseStatLine(undefined), []);
});

test('Abholung: Objekt hinter window.<name> auch mit Klammern in Texten', () => {
  const src = 'window.a = {"x":"}"};\n      window.s18Itemsi18n = {"A":"B {C}","A_desc":"x \\" { y"};';
  assert.deepEqual(extractAssigned(src, 's18Itemsi18n'), { A: 'B {C}', A_desc: 'x " { y' });
  assert.equal(extractAssigned(src, 's19Itemsi18n'), null);
});

test('Datei: jeder Text in allen 6 Sprachen ohne rohe Platzhalter, Werte vollstaendig zerlegt', () => {
  const ids = Object.keys(texts.items);
  assert.ok(ids.length >= 100, `nur ${ids.length} Items`);
  for (const id of ids) {
    for (const lang of LANGS) {
      const v = itemTextFor(texts, id, lang);
      assert.ok(v, `${id} ${lang}: kein Text`);
      assert.ok(v.desc, `${id} ${lang}: leerer Text`);
      assert.doesNotMatch(v.desc, RAW, `${id} ${lang}: ${v.desc}`);
      const raw = texts.items[id].i18n[lang]?.stats || '';
      const symbols = (raw.match(/%i:\w+%/g) || []).length;
      assert.equal(v.stats.length, symbols, `${id} ${lang}: Werte "${raw}"`);
    }
  }
});

test('Datei: Spielregeln aus dem englischen Text', () => {
  const unique = Object.keys(texts.items).filter(id => texts.items[id].unique).sort();
  assert.deepEqual(unique, [
    'DA_Artifact_GamblersBlade', 'DA_Artifact_GoldCollector', 'DA_Artifact_MogulsMail',
    'DA_Artifact_VoidGauntlet', 'DA_Artifact_ZhonyasParadox',
  ]);
  const three = Object.keys(texts.items).filter(id => texts.items[id].slots === 3).sort();
  assert.deepEqual(three, ['DA_ThiefsGloves', 'DA_ThiefsGlovesRadiant']);
});

test('Sprache fehlt → Englisch; Item ohne Text → null', () => {
  const t = { items: { X: { i18n: { en: { desc: 'Hello', stats: '10 %i:scaleAD%' } } } } };
  assert.equal(itemTextFor(t, 'X', 'de').desc, 'Hello');
  assert.equal(itemTextFor(t, 'Y', 'de'), null);
  assert.equal(itemTextFor(null, 'X', 'de'), null);
});
