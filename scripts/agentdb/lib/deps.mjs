// Eigene Pakete der Gedaechtnis-Suche: fastembed, better-sqlite3, sqlite-vec.
//
// Bis 19.11.2026 standen sie im Root-package.json. onnxruntime-node (kommt ueber
// fastembed) laedt beim Installieren auf Linux CUDA-Dateien von GitHub, die es
// seit 17.11.2026 nicht mehr gibt (404). Damit scheiterte `npm ci` in 12
// GitHub-Workflows und im Vercel-Bau ohne Cache, und die naechste
// Lockfile-Aenderung haette die Hetzner-Box getroffen. Die Website braucht die
// Pakete nicht. Sie liegen jetzt in scripts/agentdb/node_modules (eigenes
// package.json + Lockfile, KEINE npm-workspaces) und werden von
// install-deps.mjs selbst nachinstalliert.
//
// Nur Node-Bordmittel importieren: diese Datei laeuft auch dann, wenn die
// Pakete fehlen.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

export const AGENTDB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const NM_DIR = join(AGENTDB_DIR, 'node_modules');
// Gleicher Name und gleiches Format wie der Box-Stempel
// (infra/hetzner/remote-deploy.sh: sha1 des Lockfiles + Node-ABI). Liegt IN
// node_modules: ein halb geloeschter Ordner kann so nie „passt" melden.
export const STAMP_NAME = '.metastats-lock-sha1';

export const STATE_DIR = join(os.homedir(), '.claude', 'agentdb');
export const INSTALL_LOCK = join(STATE_DIR, 'install.lock');
export const INSTALL_PAUSE = join(STATE_DIR, 'install-pause.json');
export const INSTALL_LOG = join(STATE_DIR, 'install.log');

export const INSTALL_TIMEOUT_MS = 10 * 60_000;
export const PAUSE_MS = 30 * 60_000;

/** Soll-Stempel: sha1(scripts/agentdb/package-lock.json) + Node-ABI. */
export function wantStamp() {
  const lock = readFileSync(join(AGENTDB_DIR, 'package-lock.json'));
  return `${createHash('sha1').update(lock).digest('hex')} abi-${process.versions.modules}`;
}

/** true, wenn scripts/agentdb/node_modules zum Lockfile und zur Node-Version passt. */
export function depsReady() {
  try {
    return readFileSync(join(NM_DIR, STAMP_NAME), 'utf8').trim() === wantStamp();
  } catch {
    return false;
  }
}

/** Notschalter: AGENTDB_AUTO_INSTALL=0 schaltet die Selbstinstallation ab. */
export const autoInstallOff = () => process.env.AGENTDB_AUTO_INSTALL === '0';

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Die Sperre gilt, solange ihr Besitzer lebt ODER sie juenger als das
// npm-Zeitlimit ist. Nur nach Alter (wie daemon.lock, 60 s) reicht nicht:
// npm ci dauert laenger, ein zweiter Aufrufer liefe mitten hinein
// (logic-flow-critic 19.11.2026). Obergrenze 2x Zeitlimit gegen eine unter
// Windows wiederverwendete PID.
export function installLockHeld() {
  try {
    const pid = parseInt(readFileSync(INSTALL_LOCK, 'utf8'), 10);
    const age = Date.now() - statSync(INSTALL_LOCK).mtimeMs;
    if (age > 2 * INSTALL_TIMEOUT_MS) return false;
    return pidAlive(pid) || age < INSTALL_TIMEOUT_MS + 60_000;
  } catch {
    return false;
  }
}

export function acquireInstallLock() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    if (existsSync(INSTALL_LOCK)) {
      if (installLockHeld()) return false;
      unlinkSync(INSTALL_LOCK);
    }
    // 'wx' schlaegt fehl, wenn die Datei zwischen Pruefung und Schreiben entsteht.
    writeFileSync(INSTALL_LOCK, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

export function releaseInstallLock() {
  try {
    if (readFileSync(INSTALL_LOCK, 'utf8').trim() === String(process.pid)) unlinkSync(INSTALL_LOCK);
  } catch {}
}

// Nach einer gescheiterten Installation oder einem Aufwaermfehler des Dienstes
// 30 min kein neuer Versuch. Sonst startet jeder Prompt einen neuen Download —
// auf einem Rechner, auf dem nebenbei gespielt wird.
export function pauseActive() {
  try {
    const p = JSON.parse(readFileSync(INSTALL_PAUSE, 'utf8'));
    return Date.now() < Date.parse(p.until) ? p : null;
  } catch {
    return null;
  }
}

export function setPause(reason) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(INSTALL_PAUSE, JSON.stringify({
      until: new Date(Date.now() + PAUSE_MS).toISOString(),
      reason: String(reason).slice(0, 500),
    }, null, 2));
  } catch {}
}

export function clearPause() {
  try { unlinkSync(INSTALL_PAUSE); } catch {}
}
