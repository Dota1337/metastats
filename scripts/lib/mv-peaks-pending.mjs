// Uebergabe Marktwert-Sync → Peaks (freeze-marketvalue-peaks.mjs) ueber den
// gemeinsamen Zustandsordner /var/lib/metastats-mv-sync (StateDirectory= in
// beiden Units).
//
// Anlass (gemessen 23.11.2026): Peaks rechnete 4× am Tag alle ~133 Tsd.
// Spieler mit Snapshot in den letzten 7 Tagen neu (Ø 137 s, 12 Mio. gelesene
// Bloecke in 5,2 Tagen) und schrieb jeden zurueck — fuer 56 neue Zeilen.
// Neue Werte entstehen aber nur fuer Spieler, deren Snapshot-Zeilen der Sync
// gerade nach Supabase geschickt hat. Genau die stehen in der Warteliste.
//
// Absprache:
// - Der Sync schreibt je Lauf EINE Datei pending-<ms>-<pid>.json mit den
//   Spielern der ANGEKOMMENEN Pakete, auch leer, erst nach dem Upsert
//   (Persistent-Timer koennen nach einem Neustart gleichzeitig starten), dazu
//   den Herzschlag sync-heartbeat.json.
// - Peaks liest beim Start alle Wartelisten und loescht nach dem Durchgang
//   genau diese Dateien — eine waehrenddessen neu geschriebene bleibt liegen.
// - Fenster-Lauf (alter Weg, alle Spieler der 7 Tage) einmal am Tag und immer,
//   wenn an der Absprache etwas nicht stimmt (decidePeaksMode).

import { join } from 'node:path';
import { listFiles, readJsonOrNull, writeJsonAtomic } from './state-dir.mjs';

export const MV_SYNC_STATE_NAME = 'metastats-mv-sync';
export const PENDING_RE = /^pending-\d+-\d+\.json$/;
export const HEARTBEAT_FILE = 'sync-heartbeat.json';
export const WINDOW_FILE = 'peaks-window.json';
// Sync alle 6 h; zwei verpasste Laeufe → Absprache gilt als gestoert.
export const HEARTBEAT_MAX_AGE_MS = 12 * 3_600_000;
// Fenster-Lauf taeglich (Peaks alle 6 h, 5 min Zufallsversatz → 22 h).
export const WINDOW_EVERY_MS = 22 * 3_600_000;
// Darueber ist die Liste als Abfrage-Parameter zu gross, und der Fenster-Lauf
// ist ohnehin genauso teuer (erster Sync ohne Zustand schickt alle Spieler).
export const PENDING_MAX_PLAYERS = 60_000;

export function writePending(dir, puuids, { now = Date.now(), pid = process.pid, onError } = {}) {
  const list = [...new Set(puuids)].filter((p) => typeof p === 'string' && p);
  return writeJsonAtomic(join(dir, `pending-${now}-${pid}.json`), { v: 1, at: new Date(now).toISOString(), puuids: list }, onError);
}

export function writeHeartbeat(dir, info, { now = Date.now(), onError } = {}) {
  return writeJsonAtomic(join(dir, HEARTBEAT_FILE), { v: 1, at: new Date(now).toISOString(), ...info }, onError);
}

export function writeWindowMark(dir, set, { now = Date.now(), onError } = {}) {
  return writeJsonAtomic(join(dir, WINDOW_FILE), { v: 1, at: new Date(now).toISOString(), set }, onError);
}

/** Alle Wartelisten: { files, puuids:Set, bad } — bad = Zahl unlesbarer Dateien. */
export function readPending(dir) {
  const files = listFiles(dir, PENDING_RE);
  const puuids = new Set();
  let bad = 0;
  for (const f of files) {
    const j = readJsonOrNull(f);
    if (!j || j.v !== 1 || !Array.isArray(j.puuids)) { bad++; continue; }
    for (const p of j.puuids) if (typeof p === 'string' && p) puuids.add(p);
  }
  return { files, puuids, bad };
}

export function readHeartbeat(dir) { return readJsonOrNull(join(dir, HEARTBEAT_FILE)); }
export function readWindowMark(dir) { return readJsonOrNull(join(dir, WINDOW_FILE)); }

const ageMs = (iso, now) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? now - t : Infinity;
};

/**
 * Modus fuer den Durchgang des laufenden Sets:
 *   window  — alter Weg (alle Spieler mit Snapshot im 7-Tage-Fenster)
 *   pending — nur die Spieler der Warteliste
 *   skip    — Warteliste leer, seit dem letzten Lauf kam nichts an
 */
export function decidePeaksMode({ enabled = true, stateDir, heartbeat, windowMark, set, pending, now = Date.now() }) {
  if (!enabled) return { mode: 'window', reason: 'Schalter PEAKS_FROM_PENDING=0' };
  if (!stateDir) return { mode: 'window', reason: 'kein Zustandsordner' };
  if (!heartbeat || ageMs(heartbeat.at, now) > HEARTBEAT_MAX_AGE_MS) return { mode: 'window', reason: 'kein frischer Herzschlag vom Sync' };
  if (!windowMark || windowMark.set !== set) return { mode: 'window', reason: 'erster Fenster-Lauf in diesem Set' };
  if (ageMs(windowMark.at, now) >= WINDOW_EVERY_MS) return { mode: 'window', reason: 'taeglicher Fenster-Lauf' };
  if (!pending || pending.bad > 0) return { mode: 'window', reason: 'Warteliste unlesbar' };
  if (pending.puuids.size > PENDING_MAX_PLAYERS) return { mode: 'window', reason: `Warteliste zu gross (${pending.puuids.size})` };
  if (pending.puuids.size === 0) return { mode: 'skip', reason: 'keine neuen Zeilen seit dem letzten Lauf' };
  return { mode: 'pending', reason: `${pending.puuids.size} Spieler aus ${pending.files.length} Warteliste(n)` };
}
