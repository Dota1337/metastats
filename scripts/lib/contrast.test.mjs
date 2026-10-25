// WCAG-Rechnung und Token-Leser fuer scripts/check-contrast.mjs.
// Referenzwerte sind die bekannten Grenzfaelle #767676/#777777 auf Weiss
// (4,54 / 4,48) — sie liegen knapp um 4,5 und trennen eine falsche Formel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { blend, contrastRatio, hexToRgb, luminance, parseTokens, resolveColor, rgbToHex } from './contrast.mjs';

const r2 = (n) => Math.round(n * 100) / 100;

test('hexToRgb liest 3- und 6-stellig und wirft bei allem anderen', () => {
  assert.deepEqual(hexToRgb('#fff'), [255, 255, 255]);
  assert.deepEqual(hexToRgb('#19233A'), [25, 35, 58]);
  assert.throws(() => hexToRgb('red'));
  assert.throws(() => hexToRgb('#12345'));
  assert.equal(rgbToHex([25, 35, 58]), '#19233a');
});

test('Kontrast: bekannte WCAG-Werte', () => {
  assert.equal(r2(contrastRatio(hexToRgb('#ffffff'), hexToRgb('#000000'))), 21);
  assert.equal(r2(contrastRatio(hexToRgb('#767676'), hexToRgb('#ffffff'))), 4.54);
  assert.equal(r2(contrastRatio(hexToRgb('#777777'), hexToRgb('#ffffff'))), 4.48);
  // Reihenfolge egal
  assert.equal(contrastRatio(hexToRgb('#6c4fff'), hexToRgb('#fff')), contrastRatio(hexToRgb('#fff'), hexToRgb('#6c4fff')));
  // Werte dieser Welle (Commit-Texte nennen sie so)
  assert.equal(r2(contrastRatio(hexToRgb('#ffffff'), hexToRgb('#6c4fff'))), 5);
  assert.equal(r2(contrastRatio(hexToRgb('#e44040'), hexToRgb('#19233a'))), 3.8);
  assert.equal(r2(contrastRatio(hexToRgb('#ff6467'), hexToRgb('#19233a'))), 5.41);
});

test('Gegenprobe: die Referenzwerte verwerfen eine Formel ohne Gamma-Linearisierung', () => {
  // So saehe ein typischer Fehler aus: Kanalwerte direkt gewichtet.
  const naiveLum = (rgb) => 0.2126 * rgb[0] / 255 + 0.7152 * rgb[1] / 255 + 0.0722 * rgb[2] / 255;
  const naive = (a, b) => {
    const x = naiveLum(a), y = naiveLum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const grey = hexToRgb('#767676'), white = hexToRgb('#ffffff');
  assert.notEqual(r2(naive(grey, white)), 4.54);
  // und das Urteil kippt: naiv faellt #767676 durch
  assert.ok(naive(grey, white) < 4.5);
  assert.ok(luminance(grey) < naiveLum(grey));
});

test('blend mischt nach Deckkraft', () => {
  assert.deepEqual(blend([255, 255, 255], [0, 0, 0], 0.5), [127.5, 127.5, 127.5]);
  assert.deepEqual(blend([10, 20, 30], [0, 0, 0], 1), [10, 20, 30]);
});

const MINI = `
@import "tailwindcss";
/* :root { --a: #000000; } ← Kommentar, darf nicht zaehlen */
:root {
  --a: #112233;
  --a-rgb: 62 207 142;
  --b: rgb(var(--a-rgb));
  --c: var(--a);
  --acc: var(--a);
  --fallback: var(--missing, #ffffff);
  --broken: var(--missing);
  --tri: var(--a-rgb);
}
@theme inline { --color-a: var(--a); }
[data-game="tft"] {
  --acc: #abcdef;
}`;

test('parseTokens + resolveColor: var, Tripel, tft-Block, Rueckfallwert', () => {
  const t = parseTokens(MINI);
  assert.deepEqual(resolveColor('var(--c)', t), [17, 34, 51]);
  assert.deepEqual(resolveColor('var(--b)', t), [62, 207, 142]);
  assert.deepEqual(resolveColor('rgb(var(--a-rgb) / 40%)', t), [62, 207, 142]);
  assert.deepEqual(resolveColor('rgb(var(--tri))', t), [62, 207, 142]);
  assert.deepEqual(resolveColor('var(--acc)', t), [17, 34, 51]);
  assert.deepEqual(resolveColor('var(--acc)', t, 'tft'), [171, 205, 239]);
  // was der tft-Block nicht ueberschreibt, kommt aus :root
  assert.deepEqual(resolveColor('var(--c)', t, 'tft'), [17, 34, 51]);
  assert.deepEqual(resolveColor('var(--fallback)', t), [255, 255, 255]);
});

test('resolveColor wirft bei fehlendem Token statt still zu bestehen', () => {
  const t = parseTokens(MINI);
  assert.throws(() => resolveColor('var(--broken)', t), /--missing/);
  assert.throws(() => resolveColor('var(--gibts-nicht)', t), /--gibts-nicht/);
  assert.throws(() => resolveColor('color-mix(in srgb, red, blue)', t));
  assert.throws(() => parseTokens('body { color: red; }'), /:root/);
});

test('globals.css: Fuell-Lila nur unter TFT, Schrift-Lila unveraendert', () => {
  const css = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'globals.css'), 'utf8');
  const t = parseTokens(css);
  const hex = (v, scope) => rgbToHex(resolveColor(v, t, scope));
  assert.equal(hex('var(--accent-tft)'), '#8a73ff');
  assert.equal(hex('var(--accent)', 'tft'), '#8a73ff');
  assert.equal(hex('var(--accent-fill)', 'tft'), '#6c4fff');
  assert.equal(hex('var(--accent-fill-hover)', 'tft'), '#5b3cf5');
  // LoL: Fuellung folgt weiter dem Gold
  assert.equal(hex('var(--accent-fill)'), hex('var(--accent-lol)'));
  assert.equal(hex('var(--brand-text)'), '#a892ff');
  assert.equal(hex('var(--pos-loss-text)'), '#ff6467');
  assert.equal(hex('var(--pos-win)'), '#3ecf8e');
});
