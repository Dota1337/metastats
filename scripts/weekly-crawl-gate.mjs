#!/usr/bin/env node
// Tor vor der Wochen-Sammlung (weekly-crawl.yml / weekly-crawl-kr.yml).
//
// 1. Alters-Tor: gesammelt wird nur, wenn collectedAt der Datei aelter als
//    5 Tage ist (ausser FORCE=true). Seit refresh-riot-key.mjs die Sammlung
//    bei frischem Key anstoesst, wuerde der Freitags-Cron sonst doppelt sammeln.
// 2. Box abwarten: der Marktwert-Pass auf der Box (metastats-lol-marketvalue)
//    teilt sich den Riot-Key und arbeitet die Regionen nacheinander ab
//    (euw1, dann kr; je ~3 h). Riot begrenzt je Region — gewartet wird deshalb
//    nur, solange der Pass in DERSELBEN Region steht (oder noch vor seiner
//    ersten Region auf die Sperre wartet). Ist die Box nicht erreichbar, wird
//    nicht gewartet.
// 3. Wartet der Lauf laenger als MAX_WAIT_MIN, stoesst er denselben Workflow
//    neu an (attempt+1, hoechstens MAX_ATTEMPTS) und sammelt selbst nicht —
//    die Sammlung (~2 h 15 min) muss noch in die 6 h Laufzeit passen.
//
// Ausgabe: run=true|false nach $GITHUB_OUTPUT.
// Umgebung: DATA_FILE (Pflicht), BOX_REGION (euw1|kr), FORCE, BOX_HOST,
// BOX_KEY (Pfad zum SSH-Key), WORKFLOW + ATTEMPT + GH_TOKEN (Neu-Anstoss).

import { readFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const STALE_DAYS = 5;
const MAX_WAIT_MIN = Number(process.env.MAX_WAIT_MIN || 150);
const MAX_ATTEMPTS = 4;
const POLL_MIN = 5;
const UNIT = 'metastats-lol-marketvalue.service';

function output(run, why) {
  console.log(run ? `Sammlung laeuft: ${why}` : `::warning::Sammlung ausgelassen: ${why}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\n`);
}

// Zustand der Unit und die Region, an der der laufende Pass gerade arbeitet
// (letzte Zeile "region <r>:" im Journal DIESES Starts). null = nicht erreichbar.
function boxState() {
  const host = process.env.BOX_HOST;
  const key = process.env.BOX_KEY?.replace(/^~(?=\/)/, homedir());
  if (!host) return null;
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];
  if (key) args.push('-i', key, '-o', 'IdentitiesOnly=yes');
  const remote = `systemctl is-active ${UNIT}; `
    + `inv=$(systemctl show -p InvocationID --value ${UNIT}); `
    + `[ -n "$inv" ] && journalctl _SYSTEMD_INVOCATION_ID=$inv -o cat --no-pager | grep -o 'region [a-z0-9]*:' | tail -1`;
  args.push(`root@${host}`, remote);
  const r = spawnSync('ssh', args, { encoding: 'utf8', timeout: 45_000, killSignal: 'SIGKILL' });
  // is-active endet bei inaktiven Units mit Exit 3, schreibt den Zustand aber
  // trotzdem; ohne Ausgabe war die Verbindung das Problem.
  const lines = (r.stdout || '').trim().split('\n').filter(Boolean);
  if (!lines.length) return null;
  const region = lines[1]?.match(/^region ([a-z0-9]+):$/)?.[1] ?? null;
  return { state: lines[0], region };
}

function redispatch(force) {
  const { WORKFLOW: wf } = process.env;
  const attempt = Number(process.env.ATTEMPT || 0);
  if (!wf) return 'kein Neu-Anstoss konfiguriert';
  if (attempt + 1 >= MAX_ATTEMPTS) return `kein Neu-Anstoss mehr (Versuch ${attempt + 1} von ${MAX_ATTEMPTS})`;
  const r = spawnSync('gh', ['workflow', 'run', wf, '--ref', 'main', '-f', `attempt=${attempt + 1}`, '-f', `force=${force}`],
    { encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' });
  return r.status === 0
    ? `neu angestossen (Versuch ${attempt + 2} von ${MAX_ATTEMPTS})`
    : `Neu-Anstoss fehlgeschlagen: ${(r.stderr || r.error?.message || '').trim().slice(0, 200)}`;
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function main() {
  const file = process.env.DATA_FILE;
  if (!file) throw new Error('DATA_FILE fehlt');
  const force = process.env.FORCE === 'true';
  const myRegion = process.env.BOX_REGION || null;

  if (!force) {
    let collectedAt = null;
    try { collectedAt = JSON.parse(readFileSync(file, 'utf8')).collectedAt; } catch { /* unten */ }
    const ageDays = (Date.now() - new Date(collectedAt).getTime()) / 86_400_000;
    if (Number.isFinite(ageDays) && ageDays < STALE_DAYS) {
      return output(false, `${file} ist ${ageDays.toFixed(1)} Tage alt (Grenze ${STALE_DAYS}).`);
    }
    console.log(Number.isFinite(ageDays) && collectedAt ? `${file} ist ${ageDays.toFixed(1)} Tage alt.` : `${file}: collectedAt nicht lesbar — sammeln.`);
  }

  const deadline = Date.now() + MAX_WAIT_MIN * 60_000;
  for (;;) {
    const box = boxState();
    if (!box) return output(true, 'Box nicht erreichbar — kein Warten.');
    if (box.state !== 'activating') return output(true, `Marktwert-Pass auf der Box: ${box.state}.`);
    if (myRegion && box.region && box.region !== myRegion) {
      return output(true, `Marktwert-Pass arbeitet an ${box.region}, nicht an ${myRegion}.`);
    }
    if (Date.now() + POLL_MIN * 60_000 > deadline) {
      return output(false, `Marktwert-Pass (${box.region ?? 'Start'}) laeuft nach ${MAX_WAIT_MIN} min noch — ${redispatch(force)}.`);
    }
    console.log(`Marktwert-Pass laeuft noch (${box.region ?? 'wartet auf Sperre'}) — warte ${POLL_MIN} min.`);
    await sleep(POLL_MIN * 60_000);
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
