// Zustandsordner fuer Box-Skripte (systemd StateDirectory=), gemeinsam fuer
// sync-marketvalue-to-supabase, freeze-marketvalue-peaks und aggregate-lol-builds.
//
// Zustand gibt es NUR, wenn die Unit den Ordner ausdruecklich vergibt
// (STATE_DIRECTORY enthaelt genau diesen Namen). Ein Handlauf aus der Shell,
// ein Kindprozess einer anderen Unit (crawl-all-regions.mjs startet den Sync)
// oder neuer Code vor dem Einspielen der Units bekommt null — die Aufrufer
// laufen dann exakt wie vor dem Zustand. Kein tmpdir-Rueckfall: alle Units
// laufen mit PrivateTmp=yes, ein tmp-Pfad waere je Unit privat und fluechtig.
//
// Lesen und Schreiben werfen nie: Lesen liefert null, Schreiben false.

import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Eintrag aus STATE_DIRECTORY (systemd, ':'-getrennt), dessen letzter Teil `name` ist — sonst null. */
export function ownStateDir(name, env = process.env) {
  const dirs = String(env.STATE_DIRECTORY || '').split(':').filter(Boolean);
  return dirs.find((d) => d.replace(/\/+$/, '').split('/').pop() === name) || null;
}

export function readJsonOrNull(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Atomar: temporaere Datei im selben Ordner (rename ueber Laufwerksgrenzen
 * scheitert), fsync, dann umbenennen. true = geschrieben; false = nicht
 * moeglich, Grund an onError.
 */
export function writeJsonAtomic(path, value, onError = () => {}) {
  const tmp = `${path}.${process.pid}.tmp`;
  let fd = null;
  try {
    mkdirSync(dirname(path), { recursive: true });
    fd = openSync(tmp, 'w');
    writeSync(fd, JSON.stringify(value));
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tmp, path);
    return true;
  } catch (err) {
    if (fd != null) { try { closeSync(fd); } catch { /* schon zu */ } }
    try { unlinkSync(tmp); } catch { /* nichts angelegt */ }
    onError(err);
    return false;
  }
}

/** Pfade der Dateien im Ordner, deren Name zum Muster passt, sortiert; fehlender Ordner = []. */
export function listFiles(dir, re) {
  try {
    return readdirSync(dir).filter((f) => re.test(f)).sort().map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/** Loescht die genannten Dateien; liefert die Zahl der wirklich geloeschten. */
export function removeFiles(paths) {
  let n = 0;
  for (const p of paths) {
    try { unlinkSync(p); n++; } catch { /* schon weg */ }
  }
  return n;
}
