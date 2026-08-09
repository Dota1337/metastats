// Welche Datei rendert unter welchem Spiel?
//
// Hintergrund: --accent folgt dem Game ([data-game="tft"] in app/tft/layout.tsx,
// sonst :root = LoL-Gold). Ein Roh-Hex darf also nur dann durch die Accent-
// Utility ersetzt werden, wenn die Datei ausschliesslich unter EINEM Spiel
// rendert -- sonst wechselt die Farbe.
//
// Entscheidend ist die Erreichbarkeit im Import-Graph, NICHT der Pfad:
// app/components/tft/* liegt im "tft"-Ordner, kann aber von einer LoL-Seite
// importiert werden. Umgekehrt sind app/layout.tsx & Co. Root-Chrome und
// rendern auf JEDER Seite mit.
//
// Ergebnis pro Datei ist eine MENGE erreichender Spiele. Ein drittes Spiel
// braucht deshalb nur einen Eintrag in GAME_ROOTS, keine neue Logik.

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// Reihenfolge zaehlt: der erste passende Prefix gewinnt, '' faengt den Rest.
// LoL hat bewusst KEINEN eigenen Ordner -- seine Seiten liegen top-level und
// bekommen den :root-Default. Das ist Schuld, kein Design (siehe Memory).
const GAME_ROOTS = [
  { game: 'tft', prefix: 'app/tft/' },
  { game: 'lol', prefix: '' },
];

// Next-Special-Files, die eine Route aufspannen. Ohne sie gibt es keinen
// Einstiegspunkt und der halbe Baum waere "unerreichbar".
const ENTRY_RE = /(^|\/)(page|layout|template|default|error|global-error|loading|not-found)\.tsx$/;

// Dateien, die zwar unter app/ liegen, aber NIE CSS sehen:
//   - route.ts        -> JSON/HTTP, kein DOM
//   - opengraph-image -> next/og (satori). Rendert ohne globals.css und ohne
//                        [data-game]-Vorfahre. Ein var(--accent) waere dort
//                        schlicht leer -- das OG-Bild verlaere seine Farbe.
//   - manifest/sitemap/robots -> Metadaten, kein Markup
const NON_DOM_RE = /(^|\/)(route|manifest|sitemap|robots)\.(ts|tsx)$|(^|\/)(opengraph-image|twitter-image|icon|apple-icon)\.(ts|tsx)$/;

const EXTS = ['.tsx', '.ts', '/index.tsx', '/index.ts'];

/** Import-Spezifizierer -> Datei im Repo, oder null (npm-Paket, Asset, ...). */
function resolveSpecifier(spec, fromFile, known) {
  let base;
  if (spec.startsWith('@/')) base = spec.slice(2);
  else if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  else return null;

  if (known.has(base)) return base;
  for (const ext of EXTS) {
    if (known.has(base + ext)) return base + ext;
  }
  return null;
}

/** Statische UND dynamische Importe. next/dynamic laeuft ueber import('...'),
 *  wird also nur von der zweiten Regex gefunden -- fehlt sie, gilt eine von
 *  beiden Seiten dynamisch geladene Komponente faelschlich als exklusiv. */
function readEdges(file, known) {
  const src = readFileSync(file, 'utf8');
  const out = new Set();
  const patterns = [
    /(?:^|\n)\s*import\s+(?:[\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
    /(?:^|\n)\s*export\s+(?:[\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const target = resolveSpecifier(m[1], file, known);
      if (target) out.add(target);
    }
  }
  return out;
}

function gameOf(file) {
  for (const { game, prefix } of GAME_ROOTS) {
    if (file.startsWith(prefix)) return game;
  }
  return null;
}

export function buildAccentScope() {
  const files = execSync('git ls-files app', { encoding: 'utf8' })
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .filter((f) => existsSync(f));

  const known = new Set(files);
  const edges = new Map(files.map((f) => [f, readEdges(f, known)]));

  // Von jedem Route-Einstieg aus verbreiten, welches Spiel ihn erreicht.
  const games = new Map(files.map((f) => [f, new Set()]));
  for (const entry of files) {
    if (!ENTRY_RE.test(entry) || NON_DOM_RE.test(entry)) continue;
    const game = gameOf(entry);
    const seen = new Set([entry]);
    const queue = [entry];
    while (queue.length > 0) {
      const cur = queue.pop();
      games.get(cur).add(game);
      for (const next of edges.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
  }

  // Root-Chrome getrennt ausweisen. app/layout.tsx und die Root-Special-Files
  // rendern auf JEDER Seite mit, liegen aber ausserhalb des [data-game]-
  // Wrappers -- sie sehen also immer :root. Ohne eigene Klasse hiessen sie
  // "ONLY:lol", was heute denselben Wert, aber die falsche Begruendung ergibt:
  // wandert der Anker mal auf <body>, kippen genau diese Dateien auf
  // TFT-Seiten die Farbe, und niemand sucht sie unter "LoL".
  const rootChrome = new Set();
  for (const entry of files) {
    if (!/^app\/[^/]+\.tsx$/.test(entry) || !ENTRY_RE.test(entry)) continue;
    const queue = [entry];
    while (queue.length > 0) {
      const cur = queue.pop();
      if (rootChrome.has(cur)) continue;
      rootChrome.add(cur);
      queue.push(...(edges.get(cur) ?? []));
    }
  }

  const result = new Map();
  for (const file of files) {
    const reached = [...games.get(file)].sort();
    let cls;
    if (NON_DOM_RE.test(file)) cls = 'NON-DOM';
    else if (reached.length === 0) cls = 'UNREACHABLE';
    else if (rootChrome.has(file)) cls = 'ROOT-CHROME';
    else if (reached.length === 1) cls = `ONLY:${reached[0]}`;
    else cls = 'SHARED';
    result.set(file, { games: reached, cls });
  }
  return result;
}

/** Rendert die Datei garantiert unter genau diesem Spiel? Nur dann ist die
 *  Accent-Utility wertgleich zum Roh-Hex. */
export function isExclusiveTo(entry, game) {
  return entry.cls === `ONLY:${game}`;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const scope = buildAccentScope();
  const counts = {};
  for (const { cls } of scope.values()) counts[cls] = (counts[cls] ?? 0) + 1;
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(Object.fromEntries([...scope].map(([f, v]) => [f, v.cls])), null, 1));
  } else {
    console.log(counts);
  }
}
