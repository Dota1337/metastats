#!/usr/bin/env node
// Builds the .opk package that Overwolf's submission flow expects.
// Run from repo root:  node apps/overwolf-app/build-opk.mjs
//
// What an OPK is: a ZIP with the manifest at the root and every asset
// the app needs alongside it, renamed from .zip → .opk. Overwolf's
// docs say to use "normal" compression, not maximum — we use level 6
// which matches the default ZIP behaviour.
//
// What we deliberately exclude:
//   - .svg sources (build artefacts, not run by Overwolf)
//   - build-icons.mjs (devtool, not needed at runtime)
//   - build-opk.mjs   (this script itself)
//   - README.md       (dev doc, not the user-facing one Overwolf wants
//                      in their store listing — that lives elsewhere)

import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { ZipArchive } from 'archiver';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, 'dist');
const outFile = join(outDir, 'metastats-companion.opk');

async function main() {
  await import('node:fs/promises').then(fs => fs.mkdir(outDir, { recursive: true }));

  await new Promise((resolveP, rejectP) => {
    const output = createWriteStream(outFile);
    const archive = new ZipArchive({ zlib: { level: 6 } });

    output.on('close', () => {
      const size = (archive.pointer() / 1024).toFixed(1);
      console.log(`✓ ${outFile}  (${size} KB)`);
      resolveP();
    });
    archive.on('warning', err => {
      if (err.code === 'ENOENT') console.warn('archive warning:', err.message);
      else rejectP(err);
    });
    archive.on('error', rejectP);

    archive.pipe(output);

    // Manifest must sit at the OPK root.
    archive.file(join(here, 'manifest.json'), { name: 'manifest.json' });

    // Runtime assets.
    archive.directory(join(here, 'windows'), 'windows');
    archive.directory(join(here, 'js'), 'js');
    archive.directory(join(here, 'css'), 'css');

    // Images: keep PNGs + ICO, skip SVG sources since Overwolf doesn't read them.
    const imageGlob = [
      'IconMouseNormal.png',
      'IconMouseOver.png',
      'launcher_icon.ico',
      'splash.png',
    ];
    for (const f of imageGlob) {
      archive.file(join(here, 'images', f), { name: `images/${f}` });
    }

    archive.finalize();
  });
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
