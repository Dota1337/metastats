#!/usr/bin/env node
// Korrigiert die Patch-Namen der TFT-Tagesstatistik (tft_daily_*) nach Riots
// Terminplan in public/tft-set.json (patchStarts + patchCuts). Jeder Sammeltag
// bekommt den Namen, den patchForDay fuer ihn ausrechnet — fuer alle Regionen
// gleich. Die Regeln stehen in scripts/lib/tft-patch-relabel.mjs.
//
//   node scripts/relabel-tft-bpatch.mjs                    Probelauf ueber die ganze Set
//   node scripts/relabel-tft-bpatch.mjs --apply            schreiben
//   node scripts/relabel-tft-bpatch.mjs --days 2026-09-23,2026-09-24 --apply
//   node scripts/relabel-tft-bpatch.mjs --auto --apply --run-id <id>
//                                                          so ruft es der Tagestreiber
//
// Ein schreibender Lauf von Hand nimmt die Sperre des Tagestreibers und bricht
// ab, solange der sammelt (etwa 07:45-09:00 Uhr). Der Treiber selbst ruft das
// Skript am Ende jedes Laufs unter seiner eigenen Sperre auf (Kennung in
// METASTATS_DAILY_CRAWL_LOCK_OWNER, siehe scripts/lib/daily-crawl-post.mjs).
// Der Probelauf braucht keine Sperre.
//
// Statusdatei tft-patch-relabel-status.json und Not-Aus-Datei
// tft-patch-relabel.off liegen in /etc/metastats-crawler (Box), sonst im
// Temp-Ordner, oder in TFT_RELABEL_STATE_DIR. Liegt die Not-Aus-Datei, schreibt
// kein Lauf mehr; der Probelauf geht weiter.
//
// Der Dateiname bleibt, obwohl das Skript mehr als B-Patches kann:
// precompute-comp-windows.mjs fuehrt ihn in WRITER_SCRIPTS.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { releaseLock, tryAcquire } from './lib/advisory-lock.mjs';
import { LOCK_OWNER_ENV, dailyCrawlLockPath } from './lib/daily-crawl-post.mjs';
import { pgUrlHost, supabasePgUrl } from './lib/pg-url.mjs';
import { USAGE, parseArgs, runRelabel } from './lib/tft-patch-relabel.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readEnv() {
  const envPath = resolve(__dirname, '..', '.env.local');
  const env = { ...process.env };
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2];
    }
  }
  return env;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(`[relabel] ${args.error}\n`);
    console.error(USAGE);
    return 2;
  }
  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  let meta = null;
  let metaError = null;
  try {
    meta = JSON.parse(readFileSync(resolve(__dirname, '..', 'public/tft-set.json'), 'utf8'));
  } catch (err) {
    metaError = err.message;
  }

  const env = readEnv();
  const connect = async () => {
    // Auf der Box zeigt DATABASE_URL auf die Hetzner-PG — die Tagesstatistik
    // liegt in Supabase. Nie die URL ausgeben, nur den Host.
    const url = supabasePgUrl(env);
    console.log(`[relabel] Datenbank ${pgUrlHost(url)}`);
    const client = new pg.Client({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15_000,
      query_timeout: 180_000,
      application_name: 'tft-patch-relabel',
    });
    client.on('error', (err) => console.error(`[relabel] Verbindung: ${err.message}`));
    await client.connect();
    return client;
  };

  // Schreibende Laeufe nie parallel zum Sammeln: der Treiber haelt die Sperre
  // selbst und kennzeichnet sein Kind; jeder andere Lauf nimmt sie hier.
  const ownedByParent = env[LOCK_OWNER_ENV] && env[LOCK_OWNER_ENV] === String(process.ppid);
  const lockPath = args.write !== 'dry-run' && !ownedByParent ? dailyCrawlLockPath(env) : null;
  if (lockPath && !tryAcquire(lockPath)) {
    console.error(`[relabel] Tagestreiber sammelt gerade (Sperre ${lockPath} belegt) — spaeter erneut`);
    return 1;
  }
  try {
    const { exitCode } = await runRelabel({ args, meta, metaError, connect });
    return exitCode;
  } finally {
    if (lockPath) releaseLock(lockPath);
  }
}

// process.exit statt exitCode: eine haengende Verbindung darf den Treiber, der
// auf dieses Kind wartet, nicht aufhalten.
main().then(
  (code) => process.exit(code),
  (err) => { console.error('[relabel] FAIL:', err.message); process.exit(1); },
);
