#!/usr/bin/env node
// Re-generates all Overwolf-app icon assets from the SVG sources.
// Run from repo root:  node apps/overwolf-app/images/build-icons.mjs
//
// Output files (all in this folder):
//   icon_256.png       — main app icon, full colour
//   icon_256_gray.png  — disabled-state icon
//   icon_256.ico       — Windows launcher icon (PNG-in-ICO container)
//   splash.png         — 400×120 splash banner shown while the app launches

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import pngToIco from 'png-to-ico';

const here = dirname(fileURLToPath(import.meta.url));

async function svgToPng(svgPath, outPath, { width, height }) {
  const svg = readFileSync(svgPath);
  const buf = await sharp(svg, { density: 384 })
    .resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(outPath, buf);
  return buf;
}

async function main() {
  const tasks = [
    { svg: 'logo.svg',      png: 'icon_256.png',      size: { width: 256, height: 256 } },
    { svg: 'logo-gray.svg', png: 'icon_256_gray.png', size: { width: 256, height: 256 } },
    { svg: 'splash.svg',    png: 'splash.png',        size: { width: 400, height: 120 } },
  ];

  for (const t of tasks) {
    const inPath = join(here, t.svg);
    const outPath = join(here, t.png);
    await svgToPng(inPath, outPath, t.size);
    console.log(`✓ ${t.png}  (${t.size.width}×${t.size.height})`);
  }

  // ICO: Windows launcher prefers multi-size, build from PNGs at 16/32/48/64/128/256
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoBuffers = [];
  for (const size of icoSizes) {
    const svg = readFileSync(join(here, 'logo.svg'));
    const buf = await sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    icoBuffers.push(buf);
  }
  const icoBuf = await pngToIco(icoBuffers);
  writeFileSync(join(here, 'icon_256.ico'), icoBuf);
  console.log(`✓ icon_256.ico (sizes ${icoSizes.join('/')})`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
