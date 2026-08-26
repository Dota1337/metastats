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

export async function resolve(specifier, context, nextResolve) {
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
  // JSON-Import-Attribut nachruesten. Next und tsc erlauben einen JSON-Import
  // ohne Attribut; Node verlangt seit 22 ein `with { type: 'json' }` und wirft
  // sonst ERR_IMPORT_ATTRIBUTE_MISSING. Ohne das hier ist jedes app/lib-Modul
  // untestbar, das eine JSON-Datei einliest (tft-patch-label liest
  // public/tft-set.json).
  // Das Attribut muss am Resolve-ERGEBNIS haengen, nicht am Context — der
  // Load-Hook prueft die aufgeloeste Zusage, nicht die Anfrage.
  if (/\.json$/i.test(specifier)) {
    const resolved = await nextResolve(specifier, context);
    return {
      ...resolved,
      importAttributes: { ...resolved.importAttributes, type: 'json' },
    };
  }

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // Zweiter Fall derselben Klasse, nur für Paket-Specifier: `next` hat kein
    // `exports`-Feld, also gibt es für `next/server` keine Map — Node sucht
    // wörtlich die endungslose Datei `node_modules/next/server` und findet sie
    // nicht, während der Bundler `server.js` auflöst. Ohne diesen Fallback ist
    // jedes app/lib-Modul untestbar, das NextResponse anfasst (api-cache).
    // Greift ausschließlich, nachdem die reguläre Auflösung bereits gescheitert
    // ist, ändert also wieder nichts an einem Pfad, der ohne den Hook ginge.
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && !relative && !hasExtension && specifier.includes('/')) {
      return await nextResolve(specifier + '.js', context);
    }
    throw err;
  }
}
