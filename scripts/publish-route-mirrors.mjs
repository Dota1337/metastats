#!/usr/bin/env node
// Route-Spiegel (2026-10-18): legt die fertigen Antworten von Rising,
// TFT-Rangliste, Regionen und Ligen als Datei in den Vercel Blob, damit die
// Seiten auch direkt nach einem Deploy sofort laden. Welche Ansichten, wie alt
// sie sein duerfen und wann eine Antwort gilt: app/lib/route-mirror.mjs. Leser:
// app/lib/route-mirror-read.ts.
//
// Holt die Antworten ueber die oeffentliche Route — mit Publisher-Kopfzeile und
// `_pub`, sonst kaeme die eigene Datei bzw. die Edge-Kopie zurueck
// (Selbst-Recycling, reference_snapshot_first_pattern). Die Datei ist damit
// genau die oeffentliche Antwort; es gibt keine zweite Rechenlogik.
//
// Regeln:
// - Nur HTTP 200 ohne `X-Degraded` (halbe Antwort, weil eine Quelle gerade
//   nicht lieferte) und mit bestandener Pruefung wird gespeichert. Ein Fehler
//   ueberschreibt nie eine gute Datei; die alte laeuft ueber ihr Hoechstalter ab.
// - Netzfehler, 5xx, 429 und halbe Antworten: bis zu 3 Wiederholungen
//   (5/15/30 s) — refresh-api auf der Box startet bei jedem Deploy neu.
// - Mehr als 10 % Fehler je Spiegel → Exit 1 und index.json bleibt alt
//   (Frische-Vertrag mirror/<name>/index-frische schlaegt dann an).
//
// Aufruf: node scripts/publish-route-mirrors.mjs --group=rising|leaderboard|regions|ligen [--dry-run]
// Env: BLOB_READ_WRITE_TOKEN (nicht bei --dry-run). Optional ROUTE_MIRROR_SITE
// (Standard https://www.metastats.gg). Liest bewusst keine .env.local: lokal nur
// --dry-run, geschrieben wird nur auf der Box.
import { put } from '@vercel/blob';
import { ACTIVE_REGIONS } from './lib/active-regions.mjs';
import {
  ROUTE_MIRRORS, ROUTE_MIRROR_GROUPS, isValidRouteMirror, routeMirrorFetchPath, routeMirrorIndexPath,
  routeMirrorKey, routeMirrorNames, routeMirrorPath, routeMirrorVariants,
} from '../app/lib/route-mirror.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const GROUP = (args.find(a => a.startsWith('--group=')) || '').slice(8);
if (!ROUTE_MIRROR_GROUPS.includes(GROUP)) {
  console.error(`--group fehlt oder unbekannt (${GROUP || '-'}); erlaubt: ${ROUTE_MIRROR_GROUPS.join(', ')}`);
  process.exit(2);
}

const SITE = (process.env.ROUTE_MIRROR_SITE || 'https://www.metastats.gg').replace(/\/$/, '');
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
if (!TOKEN && !DRY_RUN) {
  console.error('BLOB_READ_WRITE_TOKEN muss gesetzt sein (oder --dry-run).');
  process.exit(1);
}

// Langsamster Abruf: Welt-Rangliste bzw. Rising „alle Regionen" (live 9-10 s,
// Routen-Deckel maxDuration 60 s).
const FETCH_MS = 65_000;
const RETRY_WAIT_MS = [5_000, 15_000, 30_000];
const MAX_ERROR_SHARE = 0.10;
const log = (msg) => console.log(`[route-mirror:${GROUP}] ${msg}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class FetchError extends Error {
  constructor(message, retry) { super(message); this.retry = retry; }
}

async function fetchOnce(url) {
  let res;
  try {
    res = await fetch(url, {
      cache: 'no-store',
      headers: { 'x-snapshot-publisher': '1' },
      signal: AbortSignal.timeout(FETCH_MS),
    });
  } catch (e) {
    throw new FetchError(e.name === 'TimeoutError' ? 'Zeitlimit' : e.message, true);
  }
  if (res.status !== 200) throw new FetchError(`HTTP ${res.status}`, res.status >= 500 || res.status === 429);
  if (res.headers.get('x-degraded') === '1') throw new FetchError('halbe Antwort (X-Degraded)', true);
  try {
    return await res.json();
  } catch {
    throw new FetchError('kein JSON', true);
  }
}

async function fetchWithRetry(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchOnce(url);
    } catch (e) {
      if (!(e instanceof FetchError) || !e.retry || attempt >= RETRY_WAIT_MS.length) throw e;
      await sleep(RETRY_WAIT_MS[attempt]);
    }
  }
}

async function upload(path, payload) {
  await put(path, JSON.stringify(payload), {
    access: 'public',
    contentType: 'application/json',
    token: TOKEN,
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    abortSignal: AbortSignal.timeout(30_000),
  });
}

// TFT-Set der LIVE-Seite (public/tft-set.json, dieselbe Quelle wie CURRENT_SET
// der Routen) — die Datei gilt nur in diesem Set.
async function liveTftSet(runId) {
  const j = await fetchWithRetry(`${SITE}/tft-set.json?_pub=${runId}`);
  const set = Number(j?.setNumber);
  if (!Number.isInteger(set) || set <= 0) throw new Error(`tft-set.json ohne setNumber (${JSON.stringify(j).slice(0, 80)})`);
  return set;
}

async function publishMirror(name, runId, set) {
  const def = ROUTE_MIRRORS[name];
  const variants = routeMirrorVariants(name, ACTIVE_REGIONS);
  const entries = {};
  const errors = [];
  const t0 = Date.now();
  for (const variant of variants) {
    const key = routeMirrorKey(name, variant);
    try {
      const path = routeMirrorFetchPath(name, variant);
      const body = await fetchWithRetry(`${SITE}${path}${path.includes('?') ? '&' : '?'}_pub=${runId}`);
      const snap = { v: 1, name, key, builtAt: new Date().toISOString(), ...(def.tftSet ? { set } : {}), body };
      if (!isValidRouteMirror(snap, name, key, { set })) throw new Error('Antwort faellt durch die Pruefung (leer oder unpassend)');
      if (!DRY_RUN) await upload(routeMirrorPath(name, key), snap);
      entries[key] = true;
    } catch (e) {
      errors.push(`${key}: ${e.message}`);
    }
  }
  const saved = Object.keys(entries).length;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  log(`${name}: ${saved}/${variants.length} gespeichert, ${errors.length} Fehler, ${secs} s${DRY_RUN ? ' (dry-run)' : ''}`);
  for (const e of errors.slice(0, 10)) log(`Fehler ${name} ${e}`);
  const ok = saved > 0 && errors.length <= variants.length * MAX_ERROR_SHARE;
  if (!ok) {
    log(`${name}: zu viele Fehler (Grenze ${Math.round(MAX_ERROR_SHARE * 100)} %) — index.json bleibt alt`);
    return false;
  }
  if (!DRY_RUN) await upload(routeMirrorIndexPath(name), { builtAt: new Date().toISOString(), entries });
  return true;
}

async function main() {
  const runId = Date.now().toString(36);
  const names = routeMirrorNames(GROUP);
  const set = names.some(n => ROUTE_MIRRORS[n].tftSet) ? await liveTftSet(runId) : null;
  let allOk = true;
  for (const name of names) {
    if (!(await publishMirror(name, runId, set))) allOk = false;
  }
  if (!allOk) process.exit(1);
}

main().catch((e) => {
  console.error(`[route-mirror:${GROUP}] Abbruch: ${e.message}`);
  process.exit(1);
});
