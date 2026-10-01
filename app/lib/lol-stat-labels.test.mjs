// Drift-Waechter: jeder deutsche Text, den marketvalue.ts und stats-categories.ts
// an die Spielerseite liefern, braucht einen Uebersetzungs-Eintrag. Sonst bleibt
// er auf der englischen/koreanischen/... Seite still deutsch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MV_CATEGORY_KEYS, LOL_STAT_LABEL_KEYS, MV_STAT_FRAGMENTS, translateStatText,
} from './lol-stat-labels.ts';

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const marketvalue = read('./marketvalue.ts');
const statsCategories = read('./stats-categories.ts');
const i18n = read('./i18n.tsx');

test('jede Marktwert-Kategorie und jedes Label hat einen Schluessel', () => {
  const calls = [...marketvalue.matchAll(/add\('([^']+)', '([^']+)'/g)];
  assert.ok(calls.length > 100, `nur ${calls.length} add-Aufrufe gefunden`);
  for (const [, cat, label] of calls) {
    assert.ok(MV_CATEGORY_KEYS[cat], `Kategorie fehlt: ${cat}`);
    assert.ok(LOL_STAT_LABEL_KEYS[label], `Label fehlt: ${label}`);
  }
});

test('jeder Detailname der Coach-Kategorien hat einen Schluessel', () => {
  const names = [...statsCategories.matchAll(/\{ name: '([^']+)', value:/g)].map(m => m[1]);
  assert.ok(names.length > 80, `nur ${names.length} Detailnamen gefunden`);
  for (const n of names) assert.ok(LOL_STAT_LABEL_KEYS[n], `Detailname fehlt: ${n}`);
});

test('jeder Schluessel existiert in i18n.tsx', () => {
  const keys = [
    ...Object.values(MV_CATEGORY_KEYS), ...Object.values(LOL_STAT_LABEL_KEYS),
    ...MV_STAT_FRAGMENTS.map(([, k]) => k),
  ];
  for (const k of keys) assert.ok(i18n.includes(`'${k}': t6(`), `i18n fehlt: ${k}`);
});

test('nach dem Ersetzen bleibt kein deutsches Wort in Stat-Texten und Einheiten', () => {
  const fake = (k) => `[${k}]`;
  const templates = [...marketvalue.matchAll(/add\('[^']+', '[^']+', [^,]+, `(.*)`\)/g)].map(m => m[1]);
  const units = [...statsCategories.matchAll(/unit: '([^']*)'/g)].map(m => m[1]);
  const german = /Spiel|Rollen|Rückstand|Vorteil|Vorsprung|Unterzahl|überlebt|Siege|\btot\b/;
  for (const s of [...templates, ...units]) {
    const out = translateStatText(fake, s);
    assert.ok(!german.test(out), `deutsch uebrig: "${s}" -> "${out}"`);
  }
});
