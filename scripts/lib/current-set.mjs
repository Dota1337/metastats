// Aktuelle TFT-Set-Nummer — eine Quelle fuer alle MJS-Konsumenten.
//
// Die Wahrheit ist die Datei public/tft-set.json, NICHT public/tft-assets.json.
// Der Unterschied ist kein Geschmack, sondern das Bump-Gate: detect-tft-set.mjs
// haelt tft-set.json bewusst auf dem alten Set, bis SET_BUMP_EARLIEST erreicht
// ist (siehe detect-tft-set.mjs:173). tft-assets.json folgt dagegen der
// CDragon-Datenlage und springt schon, sobald Riot das neue Set ausliefert —
// also Tage vor dem Live-Go.
//
// Wer hier auf tft-assets.json ausweicht, klassifiziert in diesem Fenster gegen
// ein Set, das niemand spielt. Deshalb ist die Asset-Datei nur Notnagel, wenn
// tft-set.json gar nicht lesbar ist.
//
// Das TS-Pendant ist app/lib/current-set.ts. Es ist KEIN Spiegel im Sinne von
// reference_dual_module_patterns.md — beide lesen dieselbe JSON-Datei, es gibt
// keine duplizierte Logik, die driften koennte. Die Datei IST die Single-Source.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Set aus public/tft-set.json lesen. null wenn die Datei fehlt oder kaputt ist.
// `currentSet.number` ist das aeltere Schema, `setNumber` das aktuelle — beide
// werden akzeptiert, damit ein halb migrierter Stand nicht stillschweigend
// null liefert.
export function loadCurrentSet(repoRoot = process.cwd()) {
  const path = resolve(repoRoot, 'public', 'tft-set.json');
  if (!existsSync(path)) return null;
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    return j.currentSet?.number ?? j.setNumber ?? null;
  } catch { return null; }
}

// Startdatum des laufenden Sets als ISO-Tag (YYYY-MM-DD), null wenn unbekannt.
//
// Gebraucht ueberall dort, wo "seit dem Set-Start" die richtige Grenze ist und
// ein fester Tagesabstand die falsche waere: Backfills, Rueckstands-Sortierung,
// und Schwellwerte, die kurz nach einem Set-Start bewusst anders greifen.
export function loadSetStartDate(repoRoot = process.cwd()) {
  const path = resolve(repoRoot, 'public', 'tft-set.json');
  if (!existsSync(path)) return null;
  try {
    const d = JSON.parse(readFileSync(path, 'utf8')).setStartDate;
    return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  } catch { return null; }
}

// Volle Tage seit dem Set-Start. null, wenn kein Startdatum bekannt ist —
// Aufrufer muessen diesen Fall behandeln und duerfen ihn nicht als 0 lesen.
export function daysSinceSetStart(repoRoot = process.cwd()) {
  const d = loadSetStartDate(repoRoot);
  if (!d) return null;
  const started = Date.parse(d + 'T00:00:00Z');
  if (Number.isNaN(started)) return null;
  return Math.floor((Date.now() - started) / 86_400_000);
}
// Notnagel: das Set aus dem Asset-Bundle. Ungegatet, siehe Kopfkommentar —
// nur benutzen, wenn tft-set.json ausfaellt.
function loadSetFromAssets(repoRoot) {
  const path = resolve(repoRoot, 'public', 'tft-assets.json');
  if (!existsSync(path)) return null;
  try {
    const s = JSON.parse(readFileSync(path, 'utf8')).set;
    return typeof s === 'number' ? s : null;
  } catch { return null; }
}

// Aufgeloeste Set-Nummer mit Fallback-Kette. Wirft, wenn BEIDE Quellen
// ausfallen.
//
// Der Wurf ist Absicht. Die frueher naheliegende Variante — null zurueckgeben
// und weiterlaufen — waere teurer: classifyComp laedt dann eine leere Cost-Map,
// der Carry-Swap wird zum No-Op, und jede Route liefert weiter HTTP 200 mit
// systematisch anderen Cluster-Keys. Kein Log, kein Sentry-Event, nur falsche
// Zahlen. Ein lauter Fehler ist billiger als eine stille Fehlklassifikation.
//
// Beide Dateien liegen im Repo und werden mitdeployt; faellt das aus, ist der
// Deploy kaputt und nicht die Set-Erkennung.
export function resolveCurrentSet(repoRoot = process.cwd()) {
  const gated = loadCurrentSet(repoRoot);
  if (typeof gated === 'number') return gated;

  const fromAssets = loadSetFromAssets(repoRoot);
  if (typeof fromAssets === 'number') {
    console.error(
      `[current-set] public/tft-set.json nicht lesbar — weiche auf tft-assets.json aus (Set ${fromAssets}).`,
    );
    console.error('[current-set] ACHTUNG: diese Quelle kennt das Bump-Gate nicht.');
    return fromAssets;
  }

  throw new Error(
    '[current-set] Weder public/tft-set.json noch public/tft-assets.json lieferten eine Set-Nummer. '
    + 'Ohne aktuelles Set ist jede Klassifikation falsch — Lauf abgebrochen.',
  );
}

// Modul-Level aufgeloest: der Datei-Read passiert einmal pro Prozess, nicht pro
// Aufruf. Konsumenten, die zur Laufzeit reagieren muessen (langlaufende
// Services ueber einen Set-Wechsel hinweg), rufen resolveCurrentSet() erneut.
export const CURRENT_SET = resolveCurrentSet();
