#!/usr/bin/env node
// Prozess-Waechter fuer die Workstation — einer pro Rechner, gestartet vom
// SessionStart-Hook start-watcher.mjs. Regeln und Vorfall: watcher-policy.mjs.
//
// Jede Minute: Prozessliste holen, Claude und ihre Nachfahren auf „niedriger
// als normal“ setzen, Rechner mit mehr als 120 s CPU auf „Leerlauf“, verwaiste
// Suchen beenden. Selbst laeuft er im Leerlauf, damit er dem Spiel nie
// Rechenzeit nimmt. Endet 10 min nach der letzten Claude-Sitzung oder nach 24 h.
//
// Sperrdatei + Log: %LOCALAPPDATA%\metastats-watcher\. Notschalter:
// PROCESS_WATCHER=0 verhindert den Start (start-watcher.mjs).
import { execFile } from 'node:child_process';
import {
  appendFileSync, closeSync, mkdirSync, openSync, readFileSync, renameSync,
  statSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decide, waechterLebt, WAECHTER_ORDNER } from './watcher-policy.mjs';

export const LOCK = path.join(WAECHTER_ORDNER, 'watcher.lock');
const LOG = path.join(WAECHTER_ORDNER, 'watcher.log');
const TAKT_MS = 60_000;
const OHNE_CLAUDE_MS = 10 * 60_000;
const MAX_LAUFZEIT_MS = 24 * 3600_000;
const LOG_MAX = 1024 * 1024;
const { PRIORITY_BELOW_NORMAL, PRIORITY_LOW } = os.constants.priority;

export function lebt(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** { pid, mtimeMs } der Sperrdatei; pid -1 = gerade unlesbar; null = keine Sperre. */
export function sperreLesen(datei = LOCK) {
  try {
    const { mtimeMs } = statSync(datei);
    let pid = -1;
    try { pid = Number(JSON.parse(readFileSync(datei, 'utf8')).pid); } catch { /* wird gerade geschrieben */ }
    return { pid, mtimeMs };
  } catch {
    return null;
  }
}

function log(zeile) {
  try {
    try { if (statSync(LOG).size > LOG_MAX) renameSync(LOG, `${LOG}.1`); } catch { /* noch kein Log */ }
    appendFileSync(LOG, `${new Date().toISOString()} ${zeile}\n`);
  } catch { /* Log ist Komfort, kein Grund zum Abbruch */ }
}

const kurz = (s) => String(s || '').replace(/\s+/g, ' ').slice(0, 160);

function sperreHolen() {
  mkdirSync(WAECHTER_ORDNER, { recursive: true });
  for (let versuch = 0; versuch < 2; versuch++) {
    try {
      const fd = openSync(LOCK, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, start: Date.now() }));
      closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (waechterLebt(sperreLesen(), Date.now(), lebt)) return false;
      try { unlinkSync(LOCK); } catch { /* ein anderer war schneller */ }
    }
  }
  return false;
}

// Win32_Process statt tasklist: nur hier gibt es Elternprozess, Startzeit und
// CPU-Zeit in einem Aufruf. Startzeit als FILETIME-String, weil sie als Zahl
// ueber 2^53 liegt und JSON sie sonst rundet.
function psListe(filter) {
  return [
    "$ErrorActionPreference='Stop'",
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    `$l = @(Get-CimInstance Win32_Process${filter ? ` -Filter "${filter}"` : ''} | ForEach-Object { [pscustomobject]@{`,
    '  p=$_.ProcessId; pp=$_.ParentProcessId; n=$_.Name; e=$_.ExecutablePath; c=$_.CommandLine;',
    "  t=$(if ($_.CreationDate) { [string]$_.CreationDate.ToFileTimeUtc() } else { '0' });",
    '  k=[double]($_.KernelModeTime + $_.UserModeTime) / 1e7; r=$_.Priority } })',
    'ConvertTo-Json -InputObject $l -Compress',
  ].join('\n');
}

export function prozessListe(filter = '') {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psListe(filter)],
      { windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
      (err, out) => {
        if (err) return reject(err);
        try {
          const roh = JSON.parse(out || '[]');
          resolve((Array.isArray(roh) ? roh : [roh]).map((x) => ({
            pid: Number(x.p), ppid: Number(x.pp), name: x.n || '', exe: x.e || '', cmd: x.c || '',
            created: String(x.t ?? '0'), cpu: Number(x.k) || 0,
            prio: x.r == null ? NaN : Number(x.r),
          })));
        } catch (e) {
          reject(e);
        }
      });
  });
}

function setzePrio(p, stufe, text) {
  try {
    os.setPriority(p.pid, stufe);
    log(`${text}: ${p.name} PID ${p.pid} (${p.grund})`);
  } catch (e) {
    log(`Prioritaet nicht gesetzt: ${p.name} PID ${p.pid}: ${e.code || e.message}`);
  }
}

async function beenden(liste) {
  // Zwischen Liste und kill koennte die PID neu vergeben sein — nachfragen und
  // nur beenden, wenn die Startzeit noch dieselbe ist.
  const jetzt = await prozessListe(liste.map((p) => `ProcessId=${Number(p.pid)}`).join(' OR '));
  const aktuell = new Map(jetzt.map((p) => [p.pid, p]));
  for (const p of liste) {
    if (aktuell.get(p.pid)?.created !== p.created) continue;
    try {
      process.kill(p.pid);
      log(`beendet: ${p.name} PID ${p.pid} (${p.grund}, ${Math.round(p.cpu)} s CPU): ${kurz(p.cmd)}`);
    } catch (e) {
      log(`beenden fehlgeschlagen: ${p.name} PID ${p.pid}: ${e.code || e.message}`);
    }
  }
}

async function durchgang(zustand) {
  const r = decide(await prozessListe(), { selfPid: process.pid, lineage: zustand.lineage });
  zustand.lineage = r.lineage;
  if (r.claudeDa) zustand.claudeZuletzt = Date.now();
  for (const p of r.lower) setzePrio(p, PRIORITY_BELOW_NORMAL, 'gesenkt');
  for (const p of r.idle) setzePrio(p, PRIORITY_LOW, 'Leerlauf');
  if (r.kill.length) await beenden(r.kill);
}

async function main() {
  try { os.setPriority(PRIORITY_LOW); } catch { /* dann eben normal */ }
  if (!sperreHolen()) return;
  const start = Date.now();
  log(`Start PID ${process.pid}`);
  const zustand = { lineage: new Set(), claudeZuletzt: start };
  const ende = (grund) => {
    log(`Ende: ${grund}`);
    try { if (sperreLesen()?.pid === process.pid) unlinkSync(LOCK); } catch { /* egal */ }
  };

  for (;;) {
    const s = sperreLesen();
    if (s && s.pid !== -1 && s.pid !== process.pid) return log(`Ende: Sperre gehoert jetzt PID ${s.pid}`);
    try { writeFileSync(LOCK, JSON.stringify({ pid: process.pid, start, beat: Date.now() })); } catch { /* naechster Takt */ }
    try {
      await durchgang(zustand);
    } catch (e) {
      log(`Durchgang fehlgeschlagen: ${kurz(e.message)}`);
    }
    const jetzt = Date.now();
    if (jetzt - zustand.claudeZuletzt > OHNE_CLAUDE_MS) return ende('seit 10 min keine Claude-Sitzung');
    if (jetzt - start > MAX_LAUFZEIT_MS) return ende('24 h Laufzeit erreicht');
    await new Promise((r) => setTimeout(r, TAKT_MS));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => log(`Abbruch: ${kurz(e?.stack || e)}`));
}
