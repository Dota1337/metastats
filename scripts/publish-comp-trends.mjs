#!/usr/bin/env node
// Comp-Verlauf vorrechnen (seit 22.11.2026): 49 Dateien je Region-Gruppe x
// Rang-Gruppe nach Vercel Blob, gelesen von app/api/tft/comps/trend/route.ts.
// Format und Rechenregel: app/lib/comp-trend-files.mjs.
//
// Laeuft als ExecStartPre=- in metastats-snapshot-publisher.service direkt
// nach precompute-comp-windows.mjs und nimmt dessen Endtag (data-end-handoff,
// gleiches privates /tmp). Ohne Endtag kein Lauf — die Route rechnet dann live.
// Ein Fehler hier blockiert den Publisher nicht; ein Haenger auch nicht, weil
// der ganze Lauf eine feste Frist hat (die Unit hat TimeoutStartSec=infinity).
//
// Last auf Supabase klein halten (Micro-Stufe, die Besucher haengen an
// derselben Datenbank): Tageszeilen werden auf der Box aufgehoben
// (StateDirectory, eine Datei je Tag, scripts/lib/comp-trend-cache.mjs). Je
// Lauf kommen eine Zaehl-Abfrage (Index-Only ueber 0093) und nur die Tage neu,
// die fehlen, sich geaendert haben oder zu den letzten 3 Tagen gehoeren —
// hoechstens MAX_LOADS_PER_RUN Tage. Mehr (erster Aufbau) nur mit --full und
// nachts: 35 kalte Tage sind ~720 MB Lesestoff, das 2,8-fache des DB-Caches.
//
// Nie lokal starten (liest Supabase, schreibt Blob). Lokal nur `node --check`.
// Auf der Box (Publisher muss inaktiv sein, ausserhalb der Unit gibt es keine
// Uebergabe): node scripts/publish-comp-trends.mjs --end YYYY-MM-DD [--full] [--dry-run]
// Schalter: COMP_TREND_PUBLISH=0.

import pg from 'pg';
import { put, list, del } from '@vercel/blob';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabasePgUrl, applyStatementTimeout } from './lib/pg-url.mjs';
import { readDataEndHandoff } from './lib/data-end-handoff.mjs';
import { dayFingerprint, daysToLoad, pruneCache, readCache, stateDir, writeCache } from './lib/comp-trend-cache.mjs';
import {
  COMP_TREND_INDEX_KEY, COMP_TREND_KEEP_DAYS, COMP_TREND_PREFIX, COMP_TREND_WINDOW_DAYS, TREND_ALL_TIERS,
  addDays, buildTrendFile, dayRange, isTrendDay, trendFileKey, trendGroupId, trendGroups,
} from '../app/lib/comp-trend-files.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const FULL = args.includes('--full');
const END_ARG = (() => {
  const i = args.indexOf('--end');
  return i >= 0 ? args[i + 1] : null;
})();

const PAUSE_MS = FULL ? 1000 : 250;
const STATEMENT_MS = 60_000;
const MAX_LOADS_PER_RUN = 8;
const RUN_BUDGET_MS = 10 * 60_000;
const WARN_FILE_BYTES = 3 * 1024 * 1024;

const ts = () => new Date().toISOString();
const log = (m) => console.log(`[comp-trend ${ts()}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Passwort aus jeder Meldung heraushalten (feedback_no_secret_in_error_output).
const PW = (() => {
  const m = String(process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '')
    .match(/^postgres(?:ql)?:\/\/[^:/@]+:(.*)@[^@]+$/);
  return m && m[1] ? m[1] : null;
})();
const scrub = (s) => (PW ? String(s).split(PW).join('***') : String(s));

// Wie precompute-comp-windows.mjs (statsWriterActive): schreibt gerade ein
// Sammler tft_daily_comp_stats, waeren die Tage halb. Dann die alten Dateien
// stehen lassen — die Route rechnet dafuer live. Ohne /proc gilt "aktiv".
const WRITER_SCRIPTS = ['collect-tft-allranks', 'import-tft-json-to-supabase', 'relabel-tft-bpatch'];
function statsWriterActive() {
  let pids;
  try { pids = readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { return true; }
  for (const pid of pids) {
    let cmd;
    try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { continue; }
    if (WRITER_SCRIPTS.some((w) => cmd.includes(w))) return true;
  }
  return false;
}

async function upload(key, body) {
  return put(key, body, {
    access: 'public',
    contentType: 'application/json',
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    allowOverwrite: true,
    // 60 s wie meta-pulse/route-mirrors: nur so kommt ein zweiter Lauf am
    // selben Endtag (Resume-Crawl) zeitnah an (reference_snapshot_first_pattern).
    cacheControlMaxAge: 60,
    abortSignal: AbortSignal.timeout(120_000),
  });
}

/** Ordner mit Endtag aelter als COMP_TREND_KEEP_DAYS loeschen. Fehler nur melden. */
async function pruneBlobs(endDay) {
  const cutoff = addDays(endDay, -COMP_TREND_KEEP_DAYS);
  const old = [];
  let cursor;
  try {
    do {
      const page = await list({ prefix: `${COMP_TREND_PREFIX}/`, cursor, limit: 1000, token: process.env.BLOB_READ_WRITE_TOKEN });
      for (const b of page.blobs) {
        const m = b.pathname.slice(COMP_TREND_PREFIX.length + 1).match(/^(\d{4}-\d{2}-\d{2})\//);
        if (m && m[1] < cutoff) old.push(b.url);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    for (let i = 0; i < old.length; i += 100) {
      await del(old.slice(i, i + 100), { token: process.env.BLOB_READ_WRITE_TOKEN });
    }
    if (old.length) log(`${old.length} alte Dateien (Endtag vor ${cutoff}) geloescht`);
  } catch (err) {
    log(`Aufraeumen im Blob-Speicher fehlgeschlagen: ${err?.message || err} — naechster Lauf versucht es wieder`);
  }
}

async function main() {
  if (process.env.COMP_TREND_PUBLISH === '0') {
    log('aus (COMP_TREND_PUBLISH=0) — nichts geschrieben');
    return 0;
  }
  const endDay = END_ARG ?? readDataEndHandoff();
  if (!isTrendDay(endDay)) {
    log(`kein Endtag${END_ARG ? ` (--end ${END_ARG} ungueltig)` : ' von der Vorab-Rechnung'} — nichts geschrieben`);
    return END_ARG ? 1 : 0;
  }
  if (!DRY && !process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('[comp-trend] BLOB_READ_WRITE_TOKEN fehlt');
    return 1;
  }
  if (statsWriterActive()) {
    log('ein Sammler schreibt gerade die Tagesstatistik — nichts geschrieben, die alten Dateien bleiben');
    return 0;
  }
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });

  const t0 = Date.now();
  const days = dayRange(addDays(endDay, 1 - COMP_TREND_WINDOW_DAYS), endDay);
  const client = new pg.Client({
    connectionString: supabasePgUrl(process.env),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
    // Frist auf unserer Seite, falls die Verbindung stumm haengt.
    query_timeout: STATEMENT_MS + 10_000,
  });
  client.on('error', (err) => console.error(`[comp-trend] Verbindung: ${scrub(err?.message || err)}`));
  let queries = 0;
  let loaded = 0;
  const rowsByDay = new Map();
  try {
    await client.connect();
    // Der Pooler verwirft die Startoption statement_timeout — nur set_config wirkt.
    await applyStatementTimeout(client, STATEMENT_MS);

    // pro_pool ist kein Rang (ALL_BUCKETS enthaelt ihn nicht) — in Zaehlung und Laden ausgeschlossen.
    // Kein Set- oder Patch-Filter: die Live-Abfrage (0043) hat auch keinen.
    queries++;
    const tq = Date.now();
    const { rows: counts } = await client.query(
      `select day::text as day, count(*)::bigint as n, coalesce(sum(games), 0)::bigint as g
         from tft_daily_comp_stats
        where day >= $1::date and day <= $2::date and bucket = any($3::text[])
        group by day`,
      [days[0], endDay, TREND_ALL_TIERS],
    );
    log(`Zaehlung ${days[0]}..${endDay}: ${counts.length} Tage mit Zeilen (${Date.now() - tq} ms)`);
    const dbFp = new Map(counts.map((r) => [r.day, dayFingerprint(r.n, r.g)]));
    const cache = readCache(dir, days);
    const load = daysToLoad(days, dbFp, cache);
    const needDb = [...load].filter((d) => dbFp.has(d));
    if (!FULL && needDb.length > MAX_LOADS_PER_RUN) {
      log(`${needDb.length} Tage fehlen oder haben sich geaendert (Grenze ${MAX_LOADS_PER_RUN} je Lauf) — `
        + `lade die ${MAX_LOADS_PER_RUN} neuesten, nichts hochgeladen. Erster Aufbau: --full nachts.`);
    }
    const allowed = new Set(FULL ? needDb : needDb.slice(-MAX_LOADS_PER_RUN));

    for (const d of days) {
      if (!load.has(d)) {
        rowsByDay.set(d, cache.get(d).rows);
        continue;
      }
      if (!dbFp.has(d)) {
        // Keine Zeilen laut Zaehlung — nichts abzufragen.
        writeCache(dir, d, dayFingerprint(0, 0), []);
        rowsByDay.set(d, []);
        continue;
      }
      if (!allowed.has(d)) continue;
      await sleep(PAUSE_MS);
      queries++;
      const tl = Date.now();
      const { rows } = await client.query({
        text: `select region, bucket, cluster_key, games, sum_placement, top4, top1
                 from tft_daily_comp_stats
                where day = $1::date and bucket = any($2::text[])`,
        values: [d, TREND_ALL_TIERS],
        rowMode: 'array',
      });
      const clean = rows.map((r) => [r[0], r[1], r[2], Number(r[3]) || 0, Number(r[4]) || 0, Number(r[5]) || 0, Number(r[6]) || 0]);
      // Abdruck aus den geladenen Zeilen selbst: schreibt der Sammler zwischen
      // Zaehlung und Laden nach, merkt es der naechste Lauf.
      writeCache(dir, d, dayFingerprint(clean.length, clean.reduce((s, r) => s + r[3], 0)), clean);
      rowsByDay.set(d, clean);
      loaded++;
      log(`Tag ${d}: ${clean.length} Zeilen (${Date.now() - tl} ms)`);
    }
    pruneCache(dir, new Set(days));
  } finally {
    await client.end().catch(() => {});
  }

  const missing = days.filter((d) => !rowsByDay.has(d));
  if (missing.length) {
    log(`${missing.length} Tage noch nicht geladen (${missing[0]}..${missing[missing.length - 1]}) — nichts hochgeladen, `
      + `${queries} DB-Abfragen, ${Math.round((Date.now() - t0) / 1000)} s`);
    return 0;
  }
  if (statsWriterActive()) {
    log('ein Sammler hat waehrend des Ladens begonnen — nichts hochgeladen, der naechste Lauf laedt die Tage neu');
    return 0;
  }

  const builtAt = ts();
  const entries = {};
  let bytesTotal = 0;
  let biggest = 0;
  for (const g of trendGroups()) {
    const file = buildTrendFile({ region: g.region, bucket: g.bucket, endDay, days, rowsByDay, builtAt });
    const body = JSON.stringify(file);
    const bytes = Buffer.byteLength(body, 'utf8');
    bytesTotal += bytes;
    biggest = Math.max(biggest, bytes);
    if (bytes > WARN_FILE_BYTES) log(`WARNUNG: ${trendGroupId(g.region, g.bucket)} ist ${(bytes / 1048576).toFixed(1)} MB gross`);
    const key = trendFileKey(endDay, g.region, g.bucket);
    if (!DRY) await upload(key, body);
    entries[trendGroupId(g.region, g.bucket)] = { key, bytes, comps: Object.keys(file.comps).length };
  }
  // index.json zuletzt und nur bei 49/49: steht er, sind alle Dateien dieses Laufs oben.
  // Nur fuer den Waechter (infra/contracts.json) — die Route liest ihn nicht.
  const index = { builtAt, endDay, firstDay: days[0], days: days.length, entries };
  if (!DRY) {
    await upload(COMP_TREND_INDEX_KEY, JSON.stringify(index));
    await pruneBlobs(endDay);
  }
  log(`${DRY ? 'Trockenlauf: ' : ''}${Object.keys(entries).length} Dateien, ${(bytesTotal / 1048576).toFixed(1)} MB `
    + `(groesste ${(biggest / 1024).toFixed(0)} KB), ${loaded} Tage aus der DB, ${queries} DB-Abfragen, `
    + `Endtag ${endDay}, ${Math.round((Date.now() - t0) / 1000)} s, 0 Fehler`);
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // Feste Frist fuer den ganzen Lauf: als ExecStartPre darf er den Publisher nie aufhalten.
  setTimeout(() => {
    console.error(`[comp-trend] Frist ${RUN_BUDGET_MS / 60000} min ueberschritten — Abbruch, die alten Dateien bleiben`);
    process.exit(1);
  }, FULL ? 3 * RUN_BUDGET_MS : RUN_BUDGET_MS).unref();
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(`[comp-trend] Abbruch: ${scrub(err?.message || err)} — die alten Dateien bleiben`);
    process.exit(1);
  });
}
