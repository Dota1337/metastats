// Eigene Bilder fuer Augments, die bei CDragon nur den Platzhalter haben
// (User 2026-10-15, F3c). Set 18: 45 von 592 Augments zeigen
// `hexcore/missing-t<n>.png` — ein „T" statt eines Bildes, darunter alle 19
// Trait-Augments. tactics.tools liefert fuer alle 45 das echte Bild
// (`ap.tft.tools/img/augments/<id><Ziffer>.png`, Inhalt webp).
//
// Regeln:
// - Nur Platzhalter werden ersetzt. Liefert CDragon spaeter ein echtes Bild,
//   gewinnt es von selbst.
// - Die Dateien liegen unter public/tft-extra/augments/<set>/<id>.webp und
//   werden mit eingecheckt (Wochenlauf). Dateien eingefrorener Sets nie
//   loeschen: das Set-Archiv tft-assets-<set>.json zeigt weiter darauf.
// - Byte-gleiche Bilder verschiedener Augment-Familien werden NICHT
//   geschrieben. tactics.tools hat im Juni 2026 Bilder ueber Augments hinweg
//   wiederverwendet (Kommentar in fetch-tft-assets.mjs). Innerhalb einer
//   Familie (Champ Delivery / + / ++) ist das normal — Riot teilt dort selbst
//   ein Bild (gemessen 15.10.2026: 178 geteilte Bilder im Set-18-Bundle).
// - items[] bleibt unberuehrt: Augment-Kacheln lesen augments[].

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { looksLikeCompleteImage } from './tft-image-paths.mjs';

const PLACEHOLDER_RE = /(?:^|\/)missing-t(\d)\.png$/i;
const SOURCE = 'https://ap.tft.tools/img/augments/';
const MIN_BYTES = 1024;
const TIMEOUT_MS = 15000;

/** Ziffer des Platzhalters (1-3) oder null, wenn das Icon kein Platzhalter ist. */
export function placeholderDigit(icon) {
  const m = PLACEHOLDER_RE.exec(typeof icon === 'string' ? icon : '');
  return m ? m[1] : null;
}

/** Oeffentlicher Pfad des eigenen Bildes (so steht er im Bundle). */
export function augmentExtraIconPath(set, apiName) {
  return `/tft-extra/augments/${set}/${apiName}.webp`;
}

/** Datei auf der Platte, relativ zum Repo. */
export function augmentExtraIconFile(set, apiName, root = 'public') {
  return `${root}${augmentExtraIconPath(set, apiName)}`;
}

/** Familie eines Augments: Name ohne +/++ und ohne I/II/III am Ende. */
export function augmentFamilyKey(name) {
  let s = String(name || '').trim().toLowerCase();
  for (;;) {
    const next = s.replace(/\s*(?:\++|\b(?:i{1,3}|iv)\b)\s*$/, '').trim();
    if (next === s) return s;
    s = next;
  }
}

/**
 * Traegt fuer jedes Augment mit Platzhalter das eigene Bild ein, wenn die
 * Datei existiert. Gibt die Zahl der ersetzten Icons zurueck.
 */
export function applyAugmentIconOverrides(augments, set, { exists = existsSync, root = 'public' } = {}) {
  let n = 0;
  for (const [id, a] of Object.entries(augments || {})) {
    if (!a || placeholderDigit(a.icon) === null) continue;
    if (!exists(augmentExtraIconFile(set, id, root))) continue;
    a.icon = augmentExtraIconPath(set, id);
    n++;
  }
  return n;
}

const md5 = buf => createHash('md5').update(buf).digest('hex');

/**
 * Laedt fehlende Bilder fuer Augments mit Platzhalter. Vorhandene Dateien
 * werden nicht neu geladen. Wirft nicht: jeder Fehler bleibt ein Platzhalter
 * und steht in `failed`.
 */
export async function fetchMissingAugmentIcons(augments, set, {
  fetchImpl = fetch, root = 'public', log = console.log,
} = {}) {
  const dir = `${root}/tft-extra/augments/${set}`;
  const want = Object.entries(augments || {})
    .filter(([id, a]) => a && placeholderDigit(a.icon) !== null && !existsSync(augmentExtraIconFile(set, id, root)));
  const result = { checked: want.length, written: [], failed: [], blocked: [] };
  if (want.length === 0) return result;

  // Pruefsummen der schon vorhandenen Bilder samt Familie, fuer den Doppel-Check.
  const known = new Map();
  const familyOf = id => augmentFamilyKey(augments[id]?.name || id);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.webp')) continue;
      const id = f.slice(0, -5);
      known.set(md5(readFileSync(`${dir}/${f}`)), new Set([familyOf(id)]));
    }
  }

  const fetched = [];
  for (const [id, a] of want) {
    const digits = [...new Set([placeholderDigit(a.icon), String(a.tier), '1', '2', '3'])].filter(d => /^\d$/.test(d));
    let buf = null;
    for (const d of digits) {
      try {
        const res = await fetchImpl(`${SOURCE}${encodeURIComponent(id)}${d}.png`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) continue;
        const b = Buffer.from(await res.arrayBuffer());
        // Inhalt ist webp, auch wenn die Adresse .png heisst.
        if (b.length >= MIN_BYTES && looksLikeCompleteImage('x.webp', b)) { buf = b; break; }
      } catch { /* naechste Ziffer */ }
    }
    if (buf) fetched.push({ id, buf, hash: md5(buf) });
    else result.failed.push(id);
  }

  // Erst alle Pruefsummen sammeln, dann schreiben — sonst haengt das Ergebnis
  // an der Reihenfolge der Abrufe.
  for (const f of fetched) {
    const fams = known.get(f.hash) ?? new Set();
    fams.add(familyOf(f.id));
    known.set(f.hash, fams);
  }
  for (const f of fetched) {
    if (known.get(f.hash).size > 1) { result.blocked.push(f.id); continue; }
    mkdirSync(dir, { recursive: true });
    writeFileSync(augmentExtraIconFile(set, f.id, root), f.buf);
    result.written.push(f.id);
  }
  log(`       augment-icons: ${result.checked} ohne Bild, ${result.written.length} geladen, ${result.failed.length} nicht gefunden, ${result.blocked.length} blockiert (gleiches Bild, andere Familie)`);
  if (result.blocked.length) log(`       augment-icons blockiert: ${result.blocked.join(', ')}`);
  return result;
}
