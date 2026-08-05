// Resolver-Hook für den Testlauf: löst extensionslose relative Imports auf
// `.ts`/`.tsx` auf.
//
// Warum überhaupt: Node 22.18+ strippt TS-Typen nativ, scheitert aber an den
// extensionslosen Specifiern, die der Next-Bundler auflöst und Node nicht
// (`import { parseClusterKey } from './tft-cluster'` → ERR_MODULE_NOT_FOUND).
// Ohne diesen Hook wäre `app/lib` schlicht nicht testbar — und genau dort
// liegen zwei der fünf Module mit belegter Fehlerhistorie
// (tft-comp-family-merge, tft-comp-level-outcome), die kein MJS-Gegenstück
// haben, auf das man ausweichen könnte.
//
// Bewusst minimal: nur relative Specifier ohne Endung, nur wenn die Datei
// wirklich existiert, sonst unverändert an nextResolve durchgereicht. Damit
// kann der Hook keine Auflösung ändern, die ohne ihn funktioniert hätte.
//
// Geladen ausschließlich über `node --import scripts/lib/ts-test-hook.mjs`
// im `test`-Script — kein Produktionspfad importiert diese Datei.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EXTENSIONS = ['.ts', '.tsx'];

export function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  const hasExtension = /\.[cm]?[jt]sx?$|\.json$/i.test(specifier);
  if (relative && !hasExtension && context.parentURL) {
    for (const ext of EXTENSIONS) {
      const candidate = specifier + ext;
      try {
        if (existsSync(fileURLToPath(new URL(candidate, context.parentURL)))) {
          return nextResolve(candidate, context);
        }
      } catch {
        // Nicht auflösbare URL (z. B. data:-parentURL) — normal weiterreichen.
      }
    }
  }
  return nextResolve(specifier, context);
}
