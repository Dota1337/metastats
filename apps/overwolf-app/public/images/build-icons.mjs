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
  // File names follow Overwolf convention:
  //   IconMouseNormal.png = grayscale, default unselected state
  //   IconMouseOver.png   = colored, hover/selected
  //   launcher_icon.ico   = multi-size Windows launcher, 4 layers (16/32/48/256)
  //   splash.png          = 400×120 splash banner
  const tasks = [
    { svg: 'logo.svg',      png: 'IconMouseOver.png',   size: { width: 256, height: 256 } },
    { svg: 'logo-gray.svg', png: 'IconMouseNormal.png', size: { width: 256, height: 256 } },
    { svg: 'splash.svg',    png: 'splash.png',          size: { width: 400, height: 120 } },
  ];

  for (const t of tasks) {
    const inPath = join(here, t.svg);
    const outPath = join(here, t.png);
    await svgToPng(inPath, outPath, t.size);
    console.log(`✓ ${t.png}  (${t.size.width}×${t.size.height})`);
  }

  // ICO: Overwolf store spec requires exactly 16/32/48/256 and < 150 KB.
  // Built from logo-ico.svg (a colour-reduced version of logo.svg) so the
  // 256x256 layer palette-quantises tight enough to stay inside the budget.
  const icoSizes = [16, 32, 48, 256];
  const icoBuffers = [];
  for (const size of icoSizes) {
    const svg = readFileSync(join(here, 'logo-ico.svg'));
    const buf = await sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9, palette: true, colors: 32, dither: 0 })
      .toBuffer();
    icoBuffers.push(buf);
  }
  const icoBuf = await pngToIco(icoBuffers);
  writeFileSync(join(here, 'launcher_icon.ico'), icoBuf);
  console.log(`✓ launcher_icon.ico (sizes ${icoSizes.join('/')}, ${(icoBuf.length / 1024).toFixed(1)} KB)`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
