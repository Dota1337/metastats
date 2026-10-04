#!/usr/bin/env node
// Erzeugt alle Logo-Dateien der Seite und des Companions aus den zwei
// Quellbildern in assets/brand/. Eine Quelle, ein Skript — vorher gab es eine
// zweite Pipeline aus SVGs unter apps/overwolf-app/public/images/.
//
//   node scripts/build-brand-assets.mjs           alles neu erzeugen
//   node scripts/build-brand-assets.mjs --check   nur pruefen (pre-push)
//
// Die Quellen haben einen deckenden Hintergrund (#0A0C11). Die Seite ist
// #0e1525, also wird freigestellt: Alpha aus dem Abstand zur Hintergrundfarbe,
// Farbe zurueckgerechnet, dann zugeschnitten.
//
// Die Ergebnisse sind committet (nicht im Vercel-Build erzeugt). --check
// vergleicht die Pruefsummen in assets/brand/build-stamp.json mit Quellen,
// Skript und Ergebnissen. Neu erzeugen statt vergleichen waere fragil: eine
// andere sharp-Version komprimiert byte-verschieden.

import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = fileURLToPath(import.meta.url);
const SRC = {
  crest: 'assets/brand/hex-crest@2x.png',
  gg: 'assets/brand/gg.png',
};
const STAMP = 'assets/brand/build-stamp.json';
const OW = 'apps/overwolf-app/public/images';

const BG = [10, 12, 17];             // Hintergrund der Quellbilder
const TILE = { r: 14, g: 21, b: 37 }; // #0e1525, Seitenhintergrund

const OUTPUTS = [
  'app/assets/brand/crest.png',
  'app/assets/brand/gg-64.png',
  'app/icon.png',
  'app/apple-icon.png',
  'app/favicon.ico',
  'public/brand/icon-192.png',
  'public/brand/icon-512.png',
  `${OW}/IconMouseOver.png`,
  `${OW}/IconMouseNormal.png`,
  `${OW}/launcher_icon.ico`,
  `${OW}/splash.png`,
];

const abs = p => resolve(ROOT, p);
const sha = buf => createHash('sha256').update(buf).digest('hex');
const hashFile = p => (existsSync(abs(p)) ? sha(readFileSync(abs(p))) : null);

function currentHashes() {
  const files = {};
  for (const p of [...Object.values(SRC), ...OUTPUTS]) files[p] = hashFile(p);
  // Zeilenenden normalisiert: git wandelt sie je Rechner um (autocrlf).
  return { script: sha(readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n')), files };
}

if (process.argv.includes('--check')) {
  if (!existsSync(abs(STAMP))) {
    console.error(`${STAMP} fehlt. Run: node scripts/build-brand-assets.mjs`);
    process.exit(1);
  }
  const want = JSON.parse(readFileSync(abs(STAMP), 'utf8'));
  const have = currentHashes();
  const bad = [];
  if (want.script !== have.script) bad.push('scripts/build-brand-assets.mjs');
  for (const p of Object.keys(have.files)) if (want.files?.[p] !== have.files[p]) bad.push(p);
  if (bad.length) {
    console.error('Logo-Dateien passen nicht zum Stempel:\n  ' + bad.join('\n  '));
    console.error('Run: node scripts/build-brand-assets.mjs');
    process.exit(1);
  }
  console.log('  brand assets OK.');
  process.exit(0);
}

// Hintergrund entfernen + zuschneiden.
async function cutout(path) {
  const { data, info } = await sharp(abs(path)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    let a = 0;
    for (let c = 0; c < 3; c++) {
      const v = data[i + c], b = BG[c];
      const ac = v >= b ? (v - b) / (255 - b) : (b - v) / b;
      if (ac > a) a = ac;
    }
    if (a < 0.02) { data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0; continue; }
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.max(0, Math.min(255, Math.round((data[i + c] - BG[c] * (1 - a)) / a)));
    }
    data[i + 3] = Math.round(a * 255);
  }
  const png = await sharp(data, { raw: info }).png().toBuffer();
  return sharp(png).trim({ threshold: 1 }).png().toBuffer();
}

const fitTo = (buf, w, h) =>
  sharp(buf).resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

// Deckende quadratische Kachel mit dem GG-Zeichen, ~12 % Rand
// (iOS fuellt Transparenz schwarz, maskable braucht eine Sicherheitszone).
async function tile(mark, size, { pad = 0.12, radius = 0 } = {}) {
  const inner = Math.round(size * (1 - 2 * pad));
  const m = await fitTo(mark, inner, inner);
  let base = sharp({ create: { width: size, height: size, channels: 4, background: { ...TILE, alpha: 1 } } });
  if (radius) {
    const r = Math.round(size * radius);
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`);
    base = sharp(await base.png().toBuffer()).composite([{ input: mask, blend: 'dest-in' }]);
  }
  const off = Math.round((size - inner) / 2);
  return sharp(await base.png().toBuffer()).composite([{ input: m, left: off, top: off }]).png().toBuffer();
}

// ICO mit PNG-Ebenen (seit Vista erlaubt). png-to-ico legt die Ebenen als
// unkomprimierte Bitmaps ab — das waren 285 KB fuer den Launcher, Grenze 150 KB.
function pngIco(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach((png, i) => {
    const w = png.readUInt32BE(16), h = png.readUInt32BE(20), e = 6 + 16 * i;
    head.writeUInt8(w >= 256 ? 0 : w, e); head.writeUInt8(h >= 256 ? 0 : h, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += png.length;
  });
  return Buffer.concat([head, ...pngs]);
}

const pal = (buf, colors = 128) =>
  sharp(buf).png({ compressionLevel: 9, palette: true, colors, dither: 0.6 }).toBuffer();

function put(path, buf) {
  mkdirSync(dirname(abs(path)), { recursive: true });
  writeFileSync(abs(path), buf);
  console.log(`  ${path}  ${(buf.length / 1024).toFixed(1)} KB`);
}

async function main() {
  const crest = await cutout(SRC.crest);
  const gg = await cutout(SRC.gg);

  // Seite: Wappen im Hero (Anzeige bis 208 px breit, Datei fuer 2x),
  // GG-Zeichen in Nav und Seitenmenue (Anzeige 24 px).
  put('app/assets/brand/crest.png', await pal(await sharp(crest).resize({ width: 448 }).png().toBuffer(), 128));
  put('app/assets/brand/gg-64.png', await pal(await fitTo(gg, 64, 64), 64));

  // Seiten-Icons.
  const rounded = { radius: 0.18 };
  put('app/icon.png', await pal(await tile(gg, 256, rounded), 96));
  put('app/apple-icon.png', await pal(await tile(gg, 180), 96));
  put('public/brand/icon-192.png', await pal(await tile(gg, 192, { pad: 0.16 }), 96));
  put('public/brand/icon-512.png', await pal(await tile(gg, 512, { pad: 0.16 }), 128));
  const fav = [];
  for (const s of [16, 32, 48]) fav.push(await pal(await tile(gg, s, { pad: 0.06, radius: 0.18 }), 48));
  put('app/favicon.ico', pngIco(fav));

  // Companion (Dateinamen fest: manifest.json + main.ts verweisen darauf).
  const over = await tile(gg, 256, rounded);
  put(`${OW}/IconMouseOver.png`, await pal(over, 96));
  put(`${OW}/IconMouseNormal.png`, await pal(await sharp(over).greyscale().png().toBuffer(), 64));
  const ico = [];
  for (const s of [16, 32, 48, 256]) ico.push(await pal(await tile(gg, s, { pad: s < 32 ? 0.06 : 0.12, radius: 0.18 }), 64));
  const icoBuf = pngIco(ico);
  if (icoBuf.length > 150 * 1024) throw new Error(`launcher_icon.ico ${icoBuf.length} B > 150 KB (Overwolf-Grenze)`);
  put(`${OW}/launcher_icon.ico`, icoBuf);

  // Splash: Vorlage splash.svg, an der Stelle des alten Zeichens das GG-Wappen.
  const mark = await fitTo(gg, 104, 120);
  const svg = readFileSync(abs(`${OW}/splash.svg`), 'utf8').replace(
    '<!--BRAND_MARK-->',
    `<image x="18" y="30" width="52" height="60" href="data:image/png;base64,${mark.toString('base64')}"/>`,
  );
  if (!svg.includes('data:image/png')) throw new Error('splash.svg: Platzhalter <!--BRAND_MARK--> fehlt');
  put(`${OW}/splash.png`, await sharp(Buffer.from(svg), { density: 192 }).resize(400, 120).png({ compressionLevel: 9 }).toBuffer());

  writeFileSync(abs(STAMP), JSON.stringify(currentHashes(), null, 2) + '\n');
  console.log(`  ${STAMP}`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
