// JSON nur schreiben, wenn sich mehr als die Zeitstempel geaendert hat.
//
// Der Daten-Lauf (tft-data-refresh.yml) kann mehrmals am Tag laufen; jeder Commit
// ist ein Deploy. Gemessen 01.11.2026: von 10 woechentlichen Bundle-Commits aenderten
// 3 nichts ausser `fetchedAt`. Bleibt der Inhalt gleich, bleibt die Datei liegen,
// samt altem Stempel.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const STAMPS = new Set(['fetchedAt', 'scrapedAt']);

export function withoutStamps(value) {
  if (Array.isArray(value)) return value.map(withoutStamps);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!STAMPS.has(k)) out[k] = withoutStamps(v);
    return out;
  }
  return value;
}

/**
 * Rueckgabe true, wenn geschrieben wurde. `serialize` legt das Dateiformat fest
 * (einzeilig, eingerueckt, Zeilenende); verglichen wird immer der Inhalt.
 */
export function writeJsonIfChanged(path, data, serialize = JSON.stringify) {
  if (existsSync(path)) {
    try {
      const before = JSON.stringify(withoutStamps(JSON.parse(readFileSync(path, 'utf8'))));
      if (before === JSON.stringify(withoutStamps(data))) return false;
    } catch { /* kaputte Datei: neu schreiben */ }
  }
  writeFileSync(path, serialize(data));
  return true;
}
