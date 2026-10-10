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
//   - .svg sources (splash.svg is the template for scripts/build-brand-assets.mjs)
//   - build-opk.mjs   (this script itself)
//   - README.md       (dev doc, not the user-facing one Overwolf wants
//                      in their store listing — that lives elsewhere)

import { createWriteStream, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { ZipArchive } from 'archiver';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, 'dist');
const appDir = join(outDir, 'app');
// Version im Dateinamen, damit alte und neue Pakete nicht verwechselt werden.
const version = JSON.parse(readFileSync(join(appDir, 'manifest.json'), 'utf8')).meta.version;
const outFile = join(outDir, `metastats-companion-${version}.opk`);

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

    // Vite legt die fertige App samt manifest.json in dist/app ab; das OPK
    // ist genau dieser Ordner. SVG-Quellen und das Icon-Skript bleiben draussen.
    archive.glob('**/*', { cwd: appDir, ignore: ['**/*.svg', '**/*.mjs'] });

    archive.finalize();
  });
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
