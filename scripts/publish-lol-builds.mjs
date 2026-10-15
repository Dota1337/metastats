#!/usr/bin/env node
// Legt die Builds der LoL-Champion-Standardansicht (euw1 + EMERALD_PLUS) als
// Datei je Champion in den Vercel Blob (SEO Weg B, Nachtrag 8). Die Seite
// /champions/<id> zeigt sie damit im ersten HTML, die Builds-Route liest sie
// zuerst (app/lib/lol-builds-snapshot.ts). Pfade und Pruefregel:
// app/lib/lol-builds-blob.mjs.
//
// Laeuft nach jedem erfolgreichen Verdichtungslauf (alle 6 h):
// metastats-lol-builds.service → OnSuccess= → metastats-lol-builds-publish.service.
// Holt die Antworten ueber die oeffentliche Route — mit Publisher-Kopfzeile und
// `_pub`, sonst kaeme die eigene Datei bzw. die Edge-Kopie zurueck
// (Selbst-Recycling, reference_snapshot_first_pattern). Die Datei ist damit
// genau die oeffentliche Antwort, nie Rohzeilen der gesperrten Tabelle.
//
// Regeln:
// - Nur `source: 'db'` wird gespeichert.
// - `source: 'json'` mit `dbUnavailable` = Datenbank-Ausfall = Fehler.
//   Ohne `dbUnavailable` = unter 200 Spielen → alte Datei loeschen (sonst bliebe
//   sie bis 48 h sichtbar, obwohl die Route laengst die Repo-Datei zeigt).
// - HTTP-Fehler, Zeitlimit, Pruefung nicht bestanden = Fehler.
// - Mehr als 10 % Fehler → Exit 1, index.json bleibt alt (Vertrag
//   lol-builds/blob-frische schlaegt dann an). index.json zuletzt, nur bei Erfolg.
//
// Env: BLOB_READ_WRITE_TOKEN, SNAPSHOT_MANIFEST_URL (gleicher Blob-Speicher wie
// das Snapshot-Manifest). Optional LOL_BUILDS_SITE (Standard www.metastats.gg).
// Flags: --dry-run (abrufen + pruefen, nichts schreiben oder loeschen),
//        --only=103,157 (nur diese Keys; schreibt keinen index).
import { readFileSync, existsSync } from 'node:fs';
import { put, del } from '@vercel/blob';
import {
  LOL_BUILDS_DEFAULT, LOL_BUILDS_INDEX_PATH, isChampionKey, isValidLolBuildsSnapshot, lolBuildsPath,
} from '../app/lib/lol-builds-blob.mjs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const onlyArg = (args.find(a => a.startsWith('--only=')) || '').slice(7);
const ONLY = onlyArg ? onlyArg.split(',').map(x => x.trim()).filter(Boolean) : null;
if (ONLY && (ONLY.length === 0 || !ONLY.every(isChampionKey))) {
  console.error(`--only: nur Zahl-Keys erlaubt (${onlyArg})`);
  process.exit(1);
}

const SITE = (process.env.LOL_BUILDS_SITE || 'https://www.metastats.gg').replace(/\/$/, '');
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const MANIFEST_URL = process.env.SNAPSHOT_MANIFEST_URL;
if (!MANIFEST_URL || (!TOKEN && !DRY_RUN)) {
  console.error('SNAPSHOT_MANIFEST_URL und BLOB_READ_WRITE_TOKEN muessen gesetzt sein.');
  process.exit(1);
}
const ORIGIN = new URL(MANIFEST_URL).origin;

const CONCURRENCY = 3;        // ~173 Abrufe a 0,3-0,5 s → unter einer Minute, DB-Last wie drei Besucher
const FETCH_MS = 20_000;
const MAX_ERROR_SHARE = 0.10;
const DDRAGON = 'https://ddragon.leagueoflegends.com';
const log = (msg) => console.log(`[lol-builds-publish] ${msg}`);

async function json(url, opts = {}) {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_MS), ...opts });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Zahl-Keys aller Champions. Data Dragon zuerst; faellt es aus, die Keys des
// letzten Laufs — die Route selbst braucht Data Dragon fuer Zahl-Keys nicht.
async function championKeys() {
  try {
    const version = (await json(`${DDRAGON}/api/versions.json`))?.[0];
    const data = (await json(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`))?.data || {};
    const keys = Object.values(data).map(c => String(c?.key)).filter(isChampionKey);
    if (keys.length >= 100) return keys;
    throw new Error(`nur ${keys.length} Champions`);
  } catch (e) {
    log(`Data Dragon: ${e.message} — Keys aus dem letzten index.json`);
    const prev = await json(`${ORIGIN}/${LOL_BUILDS_INDEX_PATH}`).catch(() => null);
    const keys = Object.keys(prev?.entries || {}).filter(isChampionKey);
    if (keys.length === 0) throw new Error('keine Champion-Liste (Data Dragon und letzter index.json fehlen)');
    return keys;
  }
}

async function publishOne(key, runId, builtAt) {
  const { region, rank } = LOL_BUILDS_DEFAULT;
  const body = await json(`${SITE}/api/champions/${key}/builds?region=${region}&rank=${rank}&_pub=${runId}`, {
    headers: { 'x-snapshot-publisher': '1' },
  });
  const path = lolBuildsPath(key);
  if (body?.source !== 'db') {
    if (body?.dbUnavailable) throw new Error('Datenbank nicht erreichbar');
    if (!DRY_RUN) await del(`${ORIGIN}/${path}`, { token: TOKEN, abortSignal: AbortSignal.timeout(FETCH_MS) });
    return { kind: 'below' };
  }
  const snap = { ...body, builtAt };
  if (!isValidLolBuildsSnapshot(snap, key)) throw new Error('Antwort faellt durch die Pruefung');
  if (!DRY_RUN) {
    await put(path, JSON.stringify(snap), {
      access: 'public',
      contentType: 'application/json',
      token: TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      abortSignal: AbortSignal.timeout(FETCH_MS),
    });
  }
  const games = Object.values(snap.roles).reduce((s, r) => s + r.games, 0);
  return { kind: 'saved', games };
}

async function main() {
  const t0 = Date.now();
  const runId = t0.toString(36);
  const builtAt = new Date(t0).toISOString();
  const keys = ONLY || await championKeys();
  const entries = {};
  const errors = [];
  let below = 0;
  let next = 0;
  async function worker() {
    while (next < keys.length) {
      const key = keys[next++];
      try {
        const r = await publishOne(key, runId, builtAt);
        if (r.kind === 'saved') entries[key] = r.games;
        else below++;
      } catch (e) {
        errors.push(`${key}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  log(`${keys.length} Champions: ${Object.keys(entries).length} gespeichert, ${below} unter 200 Spielen (Datei entfernt), ${errors.length} Fehler, ${secs} s${DRY_RUN ? ' (dry-run)' : ''}`);
  for (const e of errors.slice(0, 10)) log(`Fehler ${e}`);

  if (errors.length > keys.length * MAX_ERROR_SHARE || Object.keys(entries).length === 0) {
    log(`zu viele Fehler (Grenze ${Math.round(MAX_ERROR_SHARE * 100)} %) — index.json bleibt alt`);
    process.exit(1);
  }
  if (ONLY || DRY_RUN) return;
  await put(LOL_BUILDS_INDEX_PATH, JSON.stringify({ builtAt, ...LOL_BUILDS_DEFAULT, entries }), {
    access: 'public',
    contentType: 'application/json',
    token: TOKEN,
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    abortSignal: AbortSignal.timeout(FETCH_MS),
  });
  log(`index.json geschrieben (${Object.keys(entries).length} Eintraege)`);
}

main().catch((e) => {
  console.error(`[lol-builds-publish] Abbruch: ${e.message}`);
  process.exit(1);
});
