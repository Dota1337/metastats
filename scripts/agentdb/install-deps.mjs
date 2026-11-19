#!/usr/bin/env node
// Installiert die Pakete der Gedaechtnis-Suche nach scripts/agentdb/node_modules.
// Hintergrund und Pfade: lib/deps.mjs.
//
// Start: abgekoppelt durch ensure-daemon.mjs, wenn der Stempel nicht passt.
// Von Hand (ignoriert Pause und Notschalter):
//   node scripts/agentdb/install-deps.mjs [--force]
//
// Regeln (Review logic-flow-critic + architect, 19.11.2026):
// - Dieser Prozess haelt install.lock selbst, nicht der Aufrufer.
// - npm ci laeuft in einem Nebenordner; danach wird umbenannt. Haelt unter
//   Windows ein anderer Prozess eine .node-Datei offen, scheitert nur das
//   Umbenennen — der bestehende Paket-Ordner bleibt heil, nie halb geloescht.
// - Der Stempel entsteht nur bei Erfolg und wandert mit dem Ordner.
// - Nur `npm ci` aus dem eingecheckten Lockfile, nie `npm install`.
// - Zeitlimit beendet den ganzen Prozessbaum (taskkill /T), nicht nur npm.
// - Fehler: 30 min Pause, Exit 1. Nie Exit 2. Ausgabe nur ins Log.

import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync,
  readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { findNpmCli } from '../lib/npm-cli.mjs';
import {
  AGENTDB_DIR, NM_DIR, STAMP_NAME, STATE_DIR, INSTALL_LOG, INSTALL_TIMEOUT_MS,
  wantStamp, depsReady, acquireInstallLock, releaseInstallLock, setPause, clearPause,
} from './lib/deps.mjs';

const FORCE = process.argv.includes('--force');
// Arbeitsordner beginnen mit „.install-": .gitignore deckt sie ab, und die
// Pakete darin liegen immer unter einem Pfad mit /node_modules/ (Drift-Filter).
const WORK_RE = /^\.install-\d+$/;

function log(msg) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(INSTALL_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

function killTree(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch {}
  }
}

function runNpmCi(cwd, fd) {
  return new Promise((resolve) => {
    const cli = findNpmCli();
    if (!cli) return resolve({ ok: false, why: `npm-cli.js nicht gefunden neben ${process.execPath}` });
    const child = spawn(process.execPath, [cli, 'ci', '--no-audit', '--no-fund'], {
      cwd,
      stdio: ['ignore', fd, fd],
      windowsHide: true,
      // Auf Linux eigene Prozessgruppe, damit killTree(-pid) die Enkel trifft.
      detached: process.platform !== 'win32',
      env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--use-system-ca' },
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, INSTALL_TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, why: e.message }); });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) return resolve({ ok: true });
      resolve({ ok: false, why: timedOut ? `npm ci nach ${INSTALL_TIMEOUT_MS / 60000} min abgebrochen` : `npm ci exit ${code ?? signal}` });
    });
  });
}

async function main() {
  if (!FORCE && depsReady()) {
    log('Pakete passen zum Lockfile — nichts zu tun.');
    return 0;
  }
  if (!acquireInstallLock()) {
    log('Andere Installation laeuft — Abbruch.');
    return 1;
  }

  const work = join(AGENTDB_DIR, `.install-${process.pid}`);
  let fd;
  try {
    // Reste abgestuerzter Vorgaenger. Unter der Sperre laeuft sonst niemand.
    for (const d of readdirSync(AGENTDB_DIR)) {
      if (WORK_RE.test(d) && d !== `.install-${process.pid}`) {
        try { rmSync(join(AGENTDB_DIR, d), { recursive: true, force: true }); }
        catch (e) { log(`Rest ${d} nicht loeschbar: ${e.message}`); }
      }
    }

    const staging = join(work, 'new');
    mkdirSync(staging, { recursive: true });
    copyFileSync(join(AGENTDB_DIR, 'package.json'), join(staging, 'package.json'));
    copyFileSync(join(AGENTDB_DIR, 'package-lock.json'), join(staging, 'package-lock.json'));
    const stamp = wantStamp();

    log(`npm ci startet (Soll ${stamp})`);
    fd = openSync(INSTALL_LOG, 'a');
    const r = await runNpmCi(staging, fd);
    if (!r.ok) throw new Error(r.why);
    writeFileSync(join(staging, 'node_modules', STAMP_NAME), `${stamp}\n`);

    // Tausch. Der alte Ordner landet unter <work>/old/node_modules, damit auch
    // er unter einem /node_modules/-Pfad liegt.
    const old = join(work, 'old');
    if (existsSync(NM_DIR)) {
      mkdirSync(old, { recursive: true });
      renameSync(NM_DIR, join(old, 'node_modules'));
    }
    try {
      renameSync(join(staging, 'node_modules'), NM_DIR);
    } catch (e) {
      if (!existsSync(NM_DIR) && existsSync(join(old, 'node_modules'))) renameSync(join(old, 'node_modules'), NM_DIR);
      throw e;
    }
    clearPause();
    log(`Fertig: ${stamp}`);
    return 0;
  } catch (e) {
    log(`FEHLER: ${e.message} — naechster automatischer Versuch fruehestens in 30 min`);
    setPause(`install: ${e.message}`);
    return 1;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch {} }
    try { rmSync(work, { recursive: true, force: true }); }
    catch (e) { log(`Aufraeumen ${work} unvollstaendig (${e.message}) — naechster Lauf raeumt nach.`); }
    releaseInstallLock();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => { log(`ERROR ${err.message}`); process.exit(1); },
);
