// Welche CommunityDragon-Bilder unsere eigene Kopie (Vercel Blob, Praefix
// `tft-img/`) enthalten soll.
//
// Zwei Fragen, eine Datei:
//   1. Welche Pfade darf der Bild-Weiterleiter (`app/api/img/[...p]`) ueberhaupt
//      ausliefern? Antwort steht in `app/lib/cdragon-base.ts` (`safeCdragonUrl`).
//      Hier steht dieselbe Regel noch einmal, weil Skripte kein TypeScript laden.
//      Das ist ein Spiegel-Paar (reference_dual_module_patterns.md) — deshalb
//      prueft `tft-image-paths.test.mjs` beide Seiten gegeneinander.
//   2. Welche dieser Pfade kommen in unseren Daten vor? Antwort: jede Zeichenkette
//      in `public/tft-*.json`, die mit `assets/` beginnt (oder mit der vollen
//      CDragon-Adresse) und die Regel aus 1. besteht. Bewusst ALLE Dateien, nicht
//      nur das aktuelle Bundle: aeltere Sets und Turnier-/Comp-Dateien zeigen
//      ebenfalls Bilder.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const CDRAGON_GAME_BASE = 'https://raw.communitydragon.org/latest/game/';
export const CDRAGON_PATH_PREFIXES = ['assets/maps/', 'assets/characters/', 'assets/ux/'];

// Gleiche Endungen wie IMG_EXT in app/lib/cdragon-base.ts.
const IMG_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

export function imageContentType(path) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return IMG_EXT[ext] ?? null;
}

// Gibt den Pfad so zurueck, wie der Weiterleiter ihn hinter der CDragon-Base
// sieht — oder null, wenn er ihn ablehnen wuerde. Die Kopie liegt unter genau
// diesem Namen, damit die Route ohne eigene Umrechnung findet, was hier
// abgelegt wurde.
export function mirrorKeyFor(path) {
  if (typeof path !== 'string' || path === '') return null;
  const segments = path.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') return null;
    if (seg.includes('\\') || seg.includes('\0')) return null;
  }
  if (!CDRAGON_PATH_PREFIXES.some((p) => path.startsWith(p))) return null;
  if (!imageContentType(path)) return null;
  let url;
  try {
    url = new URL(path, CDRAGON_GAME_BASE);
  } catch {
    return null;
  }
  if (!url.href.startsWith(CDRAGON_GAME_BASE)) return null;
  if (url.search || url.hash) return null;
  const key = url.href.slice(CDRAGON_GAME_BASE.length);
  // Pfade, die beim URL-Bau umgeschrieben werden (Leerzeichen, Umlaute),
  // kopieren wir nicht: die Route wuerde sie unter einem anderen Namen suchen.
  // Stand 06.10.2026: 0 solche Pfade in den Daten.
  return key === path ? key : null;
}

function walkStrings(value, out) {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) walkStrings(v, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) walkStrings(v, out);
  }
}

function pathsInFile(file) {
  const strings = [];
  walkStrings(JSON.parse(readFileSync(file, 'utf8')), strings);
  const found = [];
  for (const s of strings) {
    const rel = s.startsWith(CDRAGON_GAME_BASE) ? s.slice(CDRAGON_GAME_BASE.length) : s;
    if (!rel.startsWith('assets/')) continue;
    const key = mirrorKeyFor(rel);
    if (key) found.push(key);
  }
  return found;
}

/**
 * Alle zu kopierenden Pfade, das aktuelle Bundle (`tft-assets.json`) zuerst —
 * damit eine Erstbefuellung, die an ihrer Zeitgrenze abbricht, das Wichtigste
 * schon erledigt hat.
 *
 * @returns {{ paths: string[], current: Set<string>, files: string[] }}
 */
export function collectImagePaths(publicDir) {
  const files = readdirSync(publicDir)
    .filter((f) => /^tft-.*\.json$/.test(f))
    .sort((a, b) => (a === 'tft-assets.json' ? -1 : b === 'tft-assets.json' ? 1 : a.localeCompare(b)));
  const seen = new Set();
  const paths = [];
  const current = new Set();
  for (const f of files) {
    for (const key of pathsInFile(join(publicDir, f))) {
      if (f === 'tft-assets.json') current.add(key);
      if (seen.has(key)) continue;
      seen.add(key);
      paths.push(key);
    }
  }
  return { paths, current, files };
}

// Ist das wirklich eine vollstaendige Bilddatei? CDragon liefert bei Stoerungen
// auch mal eine HTML-Fehlerseite mit Status 200 oder bricht mitten im Body ab.
// Beides darf nicht als „Bild" dauerhaft in unserer Kopie landen.
export function looksLikeCompleteImage(path, buf) {
  if (!buf || buf.length < 32) return false;
  const type = imageContentType(path);
  if (type === 'image/png') {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!sig.every((b, i) => buf[i] === b)) return false;
    // Der IEND-Block steht immer am Ende: 4 Byte Laenge, „IEND", 4 Byte CRC.
    return buf.subarray(buf.length - 12).includes(Buffer.from('IEND'));
  }
  if (type === 'image/jpeg') {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;
  }
  if (type === 'image/webp') {
    return buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
  }
  return false;
}
