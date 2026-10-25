#!/usr/bin/env node
// Waechter gegen zu blasse Schrift (WCAG 4,5:1 fuer normale Schrift).
//
// Anlass: impeccable-Scan von 9 Live-Seiten am 2026-10-25, 76 Kontrast-
// Warnungen. Behoben in den Commits davor; dieser Check haelt den Stand.
//
// Drei Stufen:
//
//   1. FESTE PAARE, harte Null. Schrift-Tokens auf den Seitenflaechen, Weiss
//      auf den Fuell-Tokens, Rang-, Trait- und Tier-Farben. Die Werte kommen
//      aus den Quelldateien (globals.css, rank-format.ts, tft-trait-style.ts,
//      tft-tier-letter.ts), nicht aus einer Kopie hier. Ein Token, das sich
//      nicht aufloesen laesst, ist ein Fehler — sonst waere der Check gruen
//      ueber einer Farbe, die niemand geprueft hat. Bekannte Ausnahmen stehen
//      unten mit ihrem Messwert; schlechter werden duerfen sie nicht.
//
//   2. RATSCHE fuer rohe Schriftfarben im Markup (`text-[#hex]`,
//      `color: '#hex'`) unter 4,5:1 auf base. Der Bestand steht in
//      RAW_TEXT_ALLOWED; jede neue Fundstelle blockt.
//
//   3. GLEICHLAUF: die Rangfarben, die die beiden Verteilungs-Skripte in die
//      woechentlichen JSON-Dateien schreiben, muessen RANK_TIER_COLOR sein.
//
// Was er NICHT sieht: Schrift auf Bildern, berechnete Farben (Ternaries,
// withAlpha), Tailwind-Paletten wie text-red-400. Dafuer gibt es den
// Live-Scan; `--remind` meldet, wenn sich Farben seit dem letzten geaendert
// haben (blockt nie, in CI still). `--stamp` setzt den Stempel nach einem
// Live-Scan neu.

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { blend, contrastRatio, hexToRgb, parseTokens, resolveColor, rgbToHex } from './lib/contrast.mjs';

// Ein nicht aufloesbares Token oder eine leere Farbliste wirft — als Meldung
// statt als Stacktrace ausgeben.
process.on('uncaughtException', (e) => {
  console.error(`Kontrast-Check abgebrochen: ${e.message}`);
  process.exit(1);
});

const MIN = 4.5;
// Weniger ausgewertete Paare heisst: ein Leser hat still nichts gefunden.
const MIN_PAIRS = 45;
const STAMP = 'infra/contrast-live-stamp.json';
const LIVE_SCAN_HINT = 'npx --yes impeccable@4.7.0 detect --json <URLs> (siehe infra/contrast-live-stamp.json)';

// Bekannte Unterschreitungen, Messwert auf zwei Stellen. Schlechter als der
// Messwert → rot. Besser → Hinweis, den Wert nachzuziehen oder zu streichen.
const EXCEPTIONS = {
  // Das TFT-Lila ist auf Schrift getrimmt; heller ginge nur mit anderem Farbton
  // (Entscheidung 2026-09-27, vorher #7B61FF mit 3,72).
  'text-accent @tft auf base': 4.45,
  // Tier-Buchstaben: Rang-Leiter, User-Farben 20.10.2026 (tft-tier-letter.ts).
  // Kurze, fette Einzelbuchstaben auf eigener Toenung; Aenderung nur mit
  // Freigabe (feedback_tft_tier_thresholds).
  'Tier A auf eigener Toenung': 3.64,
  'Tier B auf eigener Toenung': 4.2,
  'Tier-Platzhalter (—) auf base': 3.78,
};

// Rohe Schriftfarben unter 4,5:1, Bestand 2026-10-25. Schluessel Datei|#hex.
const RAW_TEXT_ALLOWED = {
  // Platzhalterseite, keine Route mit Inhalt.
  'app/components/tft/StubPage.tsx|#7b61ff': 'Platzhalter',
  // Dunkle Schrift auf heller Abzeichen-Flaeche, nie auf base.
  'app/components/tft/unit/UnitBuilds.tsx|#11151c': 'dunkel auf hell',
  'app/tft/units/[id]/UnitDetailClient.tsx|#11151c': 'dunkel auf hell',
  // Bronze-Medaille der Liga-Tabelle.
  'app/ligen/page.tsx|#b87333': 'Medaille',
};

const read = (f) => readFileSync(f, 'utf8');
const tokens = parseTokens(read('app/globals.css'));

/** `{ KEY: '#hex', ... }` aus einem benannten Objekt-Literal lesen. */
function readHexMap(file, constName) {
  const src = read(file);
  const start = src.indexOf(`${constName}`);
  if (start < 0) throw new Error(`${constName} nicht gefunden in ${file}`);
  const open = src.indexOf('{', src.indexOf('=', start));
  const close = src.indexOf('}', open);
  const out = {};
  for (const m of src.slice(open, close).matchAll(/['"]?([\w+]+)['"]?\s*:\s*['"](#[0-9a-fA-F]{3,6})['"]/g)) {
    out[m[1]] = m[2].toLowerCase();
  }
  if (Object.keys(out).length === 0) throw new Error(`${constName} in ${file} ist leer`);
  return out;
}

const RANK = readHexMap('app/lib/rank-format.ts', 'RANK_TIER_COLOR');
const TRAIT = readHexMap('app/lib/tft-trait-style.ts', 'TRAIT_STYLE_COLOR');
const TIER = readHexMap('app/lib/tft-tier-letter.ts', 'TIER_COLORS');
const tierNone = /TIER_NONE_COLOR\s*=\s*'(#[0-9a-fA-F]{6})'/.exec(read('app/lib/tft-tier-letter.ts'))?.[1];
if (!tierNone) throw new Error('TIER_NONE_COLOR nicht gefunden');

const tok = (name, scope = 'root') => resolveColor(`var(--${name})`, tokens, scope);
const base = tok('surface-base');
const raised = tok('surface-raised');
const white = hexToRgb('#ffffff');

/** [Bezeichnung, Schrift-RGB, Flaechen-RGB] */
const pairs = [];
for (const name of ['fg-primary', 'fg-secondary', 'fg-muted', 'fg-faint', 'fg-bright', 'brand-text', 'pos-loss-text', 'pos-win']) {
  pairs.push([`text-${name} auf base`, tok(name), base]);
  pairs.push([`text-${name} auf raised`, tok(name), raised]);
}
pairs.push(['text-accent @lol auf base', tok('accent'), base]);
pairs.push(['text-accent @tft auf base', tok('accent', 'tft'), base]);
for (const name of ['accent-fill', 'accent-fill-hover']) pairs.push([`Weiss auf ${name} @tft`, white, tok(name, 'tft')]);
for (const name of ['brand-fill', 'brand-fill-hover']) pairs.push([`Weiss auf ${name}`, white, tok(name)]);
for (const [k, hex] of Object.entries(RANK)) pairs.push([`Rang ${k} auf base`, hexToRgb(hex), base]);
for (const [k, hex] of Object.entries(TRAIT)) {
  const c = hexToRgb(hex);
  pairs.push([`Trait-Stufe ${k} auf base`, c, base]);
  pairs.push([`Trait-Stufe ${k} auf eigener Toenung`, c, blend(c, base, 0x25 / 255)]);
}
for (const [k, hex] of Object.entries(TIER)) {
  const c = hexToRgb(hex);
  pairs.push([`Tier ${k} auf eigener Toenung`, c, blend(c, base, 0x26 / 255)]);
}
pairs.push(['Tier-Platzhalter (—) auf base', hexToRgb(tierNone), base]);

const errors = [];
const notes = [];

if (pairs.length < MIN_PAIRS) errors.push(`nur ${pairs.length} Paare ausgewertet, erwartet mindestens ${MIN_PAIRS}`);

const seenExceptions = new Set();
for (const [label, fg, bg] of pairs) {
  const r = Math.round(contrastRatio(fg, bg) * 100) / 100;
  const ex = EXCEPTIONS[label];
  if (ex != null) {
    seenExceptions.add(label);
    if (r < ex) errors.push(`${label}: ${r.toFixed(2)}:1, schlechter als die Ausnahme ${ex.toFixed(2)} (${rgbToHex(fg)} auf ${rgbToHex(bg)})`);
    else if (r >= MIN) notes.push(`${label} besteht jetzt (${r.toFixed(2)}:1) — Ausnahme in scripts/check-contrast.mjs streichen.`);
    else if (r > ex) notes.push(`${label}: ${r.toFixed(2)}:1 — Messwert der Ausnahme auf ${r.toFixed(2)} nachziehen.`);
    continue;
  }
  if (r < MIN) errors.push(`${label}: ${r.toFixed(2)}:1 < ${MIN} (${rgbToHex(fg)} auf ${rgbToHex(bg)})`);
}
for (const label of Object.keys(EXCEPTIONS)) {
  if (!seenExceptions.has(label)) errors.push(`Ausnahme ohne Paar: "${label}" — Bezeichnung geaendert oder Paar entfallen`);
}

// Stufe 2: rohe Schriftfarben im Markup
const RAW_RE = [
  /(?:^|[\s"'`{(])(?:[\w-]+:)*text-\[#([0-9a-fA-F]{3,6})\]/g,
  /\bcolor:\s*["']#([0-9a-fA-F]{3,6})["']/g,
];
const files = execSync('git ls-files app', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.tsx') && !f.startsWith('app/internal/design-lab/'));
const rawFound = new Set();
for (const file of files) {
  const lines = read(file).split('\n');
  lines.forEach((line, i) => {
    for (const re of RAW_RE) {
      for (const m of line.matchAll(re)) {
        const hex = `#${m[1].toLowerCase()}`;
        const r = contrastRatio(hexToRgb(hex), base);
        if (r >= MIN) continue;
        const key = `${file}|${hex}`;
        rawFound.add(key);
        if (!(key in RAW_TEXT_ALLOWED)) {
          errors.push(`${file}:${i + 1}  Schrift ${hex} hat auf base nur ${r.toFixed(2)}:1 — Token nutzen (text-fg-faint, text-brand-text, text-pos-loss-text …)`);
        }
      }
    }
  });
}
for (const key of Object.keys(RAW_TEXT_ALLOWED)) {
  if (!rawFound.has(key)) notes.push(`${key} kommt nicht mehr vor — aus RAW_TEXT_ALLOWED streichen.`);
}

// Stufe 3: Gleichlauf der Rangfarben in den Verteilungs-Skripten
for (const script of ['scripts/fetch-tft-tier-distribution.mjs', 'scripts/fetch-tier-distribution.mjs']) {
  const src = read(script);
  const found = [...src.matchAll(/key:\s*'(\w+)'[^}]*?color:\s*'(#[0-9a-fA-F]{6})'/g)];
  if (found.length !== Object.keys(RANK).length) {
    errors.push(`${script}: ${found.length} Rangfarben gelesen, RANK_TIER_COLOR hat ${Object.keys(RANK).length}`);
  }
  for (const [, key, hex] of found) {
    if (RANK[key] !== hex.toLowerCase()) errors.push(`${script}: ${key} ${hex} ≠ RANK_TIER_COLOR ${RANK[key] ?? '(fehlt)'}`);
  }
}

// Fingerabdruck aller aufgeloesten Farben fuer --remind / --stamp
const fingerprint = createHash('sha1')
  .update(pairs.map(([l, fg, bg]) => `${l}=${rgbToHex(fg)}/${rgbToHex(bg)}`).join('\n'))
  .digest('hex')
  .slice(0, 12);

const args = new Set(process.argv.slice(2));

if (args.has('--stamp')) {
  const prev = existsSync(STAMP) ? JSON.parse(read(STAMP)) : {};
  const stamp = { ...prev, fingerprint, checkedAt: new Date().toISOString().slice(0, 10) };
  writeFileSync(STAMP, `${JSON.stringify(stamp, null, 2)}\n`);
  console.log(`Stempel gesetzt: ${fingerprint} (${stamp.checkedAt}).`);
  process.exit(0);
}

if (args.has('--remind')) {
  if (process.env.CI) process.exit(0);
  const stamp = existsSync(STAMP) ? JSON.parse(read(STAMP)) : null;
  if (!stamp || stamp.fingerprint !== fingerprint) {
    const since = stamp?.checkedAt ? ` seit dem Live-Scan vom ${stamp.checkedAt}` : '';
    console.log(`[Hinweis] Farben haben sich${since} geaendert — Live-Scan wiederholen: ${LIVE_SCAN_HINT}, danach node scripts/check-contrast.mjs --stamp`);
  }
  process.exit(0);
}

if (errors.length > 0) {
  console.error(`Kontrast unter ${MIN}:1 (${errors.length}x):`);
  for (const e of errors.slice(0, 30)) console.error('  ' + e);
  if (errors.length > 30) console.error(`  ... und ${errors.length - 30} weitere`);
  process.exit(1);
}
for (const n of notes) console.log('  ' + n);
console.log(`Kontrast: ${pairs.length} Paare, ${rawFound.size} rohe Altfarben im Bestand, Rangfarben im Gleichlauf.`);
