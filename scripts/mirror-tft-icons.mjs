#!/usr/bin/env node
/**
 * Legt alle TFT-Bilder, die der Bild-Weiterleiter (`app/api/img/[...p]`)
 * ausliefern darf, dauerhaft in unserem Vercel-Blob-Speicher ab
 * (`tft-img/<cdragon-pfad>`). Die Route liest zuerst dort und fragt
 * CommunityDragon nur noch, wenn ein Bild bei uns fehlt.
 *
 * Warum: CommunityDragon fiel am 06.10.2026 stundenlang aus (Antwort 522 nach
 * ~20 s), und jeder Deploy leert Vercels Zwischenspeicher. Ohne eigene Kopie
 * fehlen dann die Bilder auf der Seite.
 *
 * Ablauf:
 *   1. Pfade aus allen public/tft-*.json sammeln (aktuelles Bundle zuerst).
 *   2. Vorhandene Kopien auflisten, fehlende bei CommunityDragon holen,
 *      pruefen (vollstaendige Bilddatei), hochladen — ohne zu ueberschreiben.
 *   3. `--refresh`: nur das aktuelle Bundle neu holen und Bilder ersetzen,
 *      deren Bytes sich geaendert haben (CDragon `latest` ist beweglich).
 *
 * Ein Ausfall von CommunityDragon ist kein Fehler dieses Jobs: er wartet
 * (Notbremse), gibt an seiner Zeitgrenze auf und meldet die Luecke als Warnung.
 * Rot (Exit 1) wird er nur, wenn unser eigener Speicher nicht mitspielt.
 *
 * Usage: node scripts/mirror-tft-icons.mjs [--refresh] [--dry-run]
 *          [--max-minutes=300] [--concurrency=4] [--limit=N] [--only=<teilstring>]
 *
 * Env: BLOB_READ_WRITE_TOKEN (sonst aus .env.local; wird nie ausgegeben)
 */

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { list, put } from '@vercel/blob';
import { collectImagePaths, looksLikeCompleteImage, imageContentType, CDRAGON_GAME_BASE } from './lib/tft-image-paths.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = 'tft-img/';
const META_KEY = 'tft-img-meta/last-run.json';
const MAX_BYTES = 4 * 1024 * 1024; // wie MAX_BYTES in der Route
const FETCH_TIMEOUT_MS = 25_000;
const RETRY_DELAYS_MS = [2_000, 8_000];
// Wie lange Vercels Blob-Auslieferung eine Kopie zwischenspeichert. Ein Tag,
// damit ein `--refresh` spaetestens am Folgetag durchschlaegt.
const BLOB_CACHE_SECONDS = 86_400;
// Notbremse: Schlagen von den letzten 50 Abrufen mehr als 80 % fehl, ist
// CommunityDragon gestoert. Dann nicht weiter draufhalten, sondern warten.
const BRAKE_WINDOW = 50;
const BRAKE_RATIO = 0.8;
const BRAKE_PAUSE_MS = 120_000;

const args = process.argv.slice(2);
const REFRESH = args.includes('--refresh');
const DRY_RUN = args.includes('--dry-run');
const numArg = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  const n = a ? Number(a.split('=')[1]) : def;
  return Number.isFinite(n) && n > 0 ? n : def;
};
const MAX_MINUTES = numArg('max-minutes', 300);
const CONCURRENCY = numArg('concurrency', 4);
const LIMIT = numArg('limit', Infinity);
const ONLY = args.find((x) => x.startsWith('--only='))?.slice('--only='.length) || null;
const DEADLINE = Date.now() + MAX_MINUTES * 60_000;

const ts = () => new Date().toISOString().slice(11, 19);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN.trim();
  const envFile = resolve(ROOT, '.env.local');
  if (!existsSync(envFile)) return null;
  const line = readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('BLOB_READ_WRITE_TOKEN='));
  return line ? line.slice('BLOB_READ_WRITE_TOKEN='.length).trim().replace(/^["']|["']$/g, '') : null;
}

async function listExisting(token) {
  const existing = new Map();
  let cursor;
  let storeOrigin = null;
  do {
    const page = await list({ prefix: PREFIX, limit: 1000, cursor, token });
    for (const b of page.blobs) {
      existing.set(b.pathname.slice(PREFIX.length), { size: b.size, url: b.url });
      storeOrigin ??= new URL(b.url).origin;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return { existing, storeOrigin };
}

// Holt ein Bild bei CommunityDragon. Ergebnis: { buf } oder { error, permanent }.
// 404 ist endgueltig (der Pfad existiert dort nicht), alles andere wird
// zweimal wiederholt.
async function download(path) {
  let last = 'unbekannt';
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1] + Math.random() * 1000);
    try {
      const res = await fetch(CDRAGON_GAME_BASE + path, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'image/*' },
      });
      if (res.status === 404) {
        await res.body?.cancel().catch(() => {});
        return { error: 'HTTP 404', permanent: true };
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        last = `HTTP ${res.status}`;
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) return { error: `zu gross (${buf.length} B)`, permanent: true };
      if (!looksLikeCompleteImage(path, buf)) {
        last = 'keine vollstaendige Bilddatei';
        continue;
      }
      return { buf };
    } catch (e) {
      last = e?.name === 'TimeoutError' ? `Zeitlimit ${FETCH_TIMEOUT_MS / 1000} s` : String(e?.message ?? e).slice(0, 80);
    }
  }
  return { error: last, permanent: false };
}

async function upload(path, buf, token, overwrite) {
  try {
    await put(PREFIX + path, buf, {
      access: 'public',
      contentType: imageContentType(path),
      token,
      addRandomSuffix: false,
      allowOverwrite: overwrite,
      cacheControlMaxAge: BLOB_CACHE_SECONDS,
    });
    return 'uploaded';
  } catch (e) {
    // Zwei Laeufe gleichzeitig (manuell + Zeitplan): das Bild ist schon da.
    if (!overwrite && /already exists/i.test(String(e?.message ?? ''))) return 'exists';
    throw e;
  }
}

async function main() {
  const token = loadToken();
  if (!token && !DRY_RUN) {
    console.error('FEHLER: BLOB_READ_WRITE_TOKEN fehlt (Env oder .env.local).');
    process.exit(1);
  }

  const { paths, current, files } = collectImagePaths(resolve(ROOT, 'public'));
  console.log(`[${ts()}] ${paths.length} Bildpfade aus ${files.length} Dateien, davon ${current.size} im aktuellen Bundle`);

  let existing = new Map();
  let storeOrigin = null;
  if (token) {
    try {
      ({ existing, storeOrigin } = await listExisting(token));
    } catch (e) {
      console.error(`FEHLER: Blob-Speicher nicht lesbar: ${e?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 160)}`);
      process.exit(1);
    }
  }
  console.log(`[${ts()}] ${existing.size} Bilder liegen schon im Speicher`);

  const queue = (REFRESH ? paths.filter((p) => current.has(p)) : paths.filter((p) => !existing.has(p)))
    .filter((p) => !ONLY || p.includes(ONLY))
    .slice(0, LIMIT);
  console.log(`[${ts()}] Modus ${REFRESH ? 'refresh' : 'fehlende'}${DRY_RUN ? ' (dry-run)' : ''}: ${queue.length} zu bearbeiten, Zeitgrenze ${MAX_MINUTES} min, ${CONCURRENCY} parallel`);

  const stats = { uploaded: 0, updated: 0, unchanged: 0, failed: 0, notFound: 0, brakes: 0 };
  const failures = [];
  const window = [];
  let pausedUntil = 0;
  let next = 0;
  let done = 0;
  let timedOut = false;
  const started = Date.now();

  async function noteOutcome(ok) {
    window.push(ok);
    if (window.length > BRAKE_WINDOW) window.shift();
    const fails = window.filter((x) => !x).length;
    if (window.length === BRAKE_WINDOW && fails / BRAKE_WINDOW > BRAKE_RATIO && Date.now() >= pausedUntil) {
      stats.brakes++;
      pausedUntil = Date.now() + BRAKE_PAUSE_MS;
      window.length = 0;
      console.log(`[${ts()}] Notbremse: ${fails}/${BRAKE_WINDOW} Abrufe fehlgeschlagen — CommunityDragon gestoert, Pause ${BRAKE_PAUSE_MS / 1000} s`);
    }
  }

  async function worker() {
    while (next < queue.length) {
      if (Date.now() >= DEADLINE) {
        timedOut = true;
        return;
      }
      if (Date.now() < pausedUntil) {
        await sleep(Math.min(pausedUntil - Date.now(), 5_000));
        continue;
      }
      const path = queue[next++];
      const got = await download(path);
      if (got.error) {
        if (got.permanent && got.error === 'HTTP 404') stats.notFound++;
        else stats.failed++;
        failures.push(`${path} (${got.error})`);
        await noteOutcome(got.permanent);
      } else {
        await noteOutcome(true);
        if (REFRESH && existing.has(path)) {
          let same = false;
          try {
            const old = await fetch(existing.get(path).url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
            same = old.ok && Buffer.from(await old.arrayBuffer()).equals(got.buf);
          } catch {
            same = false;
          }
          if (same) stats.unchanged++;
          else {
            if (!DRY_RUN) await upload(path, got.buf, token, true);
            stats.updated++;
          }
        } else {
          if (!DRY_RUN) await upload(path, got.buf, token, false);
          stats.uploaded++;
        }
      }
      done++;
      if (done % 100 === 0) {
        console.log(`[${ts()}] ${done}/${queue.length} — neu ${stats.uploaded}, ersetzt ${stats.updated}, gleich ${stats.unchanged}, Fehler ${stats.failed}, fehlt bei CDragon ${stats.notFound}`);
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } catch (e) {
    console.error(`FEHLER beim Hochladen: ${e?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 160)}`);
    process.exit(1);
  }

  const present = existing.size + stats.uploaded;
  const missing = paths.filter((p) => !existing.has(p)).length - stats.uploaded;
  const summary = {
    at: new Date().toISOString(),
    mode: REFRESH ? 'refresh' : 'missing',
    dryRun: DRY_RUN,
    wanted: paths.length,
    present,
    missing,
    processed: done,
    queued: queue.length,
    ...stats,
    timedOut,
    durationSec: Math.round((Date.now() - started) / 1000),
    failureSample: failures.slice(0, 20),
  };

  console.log(`[${ts()}] Bilanz: ${present}/${paths.length} im Speicher, ${missing} fehlen; neu ${stats.uploaded}, ersetzt ${stats.updated}, gleich ${stats.unchanged}, Fehler ${stats.failed}, fehlt bei CDragon ${stats.notFound}, Notbremsen ${stats.brakes}${timedOut ? ', Zeitgrenze erreicht' : ''}`);
  if (failures.length) console.log(`[${ts()}] Beispiele: ${failures.slice(0, 5).join(' | ')}`);
  if (storeOrigin) console.log(`[${ts()}] Speicher: ${storeOrigin}/${PREFIX}`);

  if (token && !DRY_RUN) {
    try {
      await put(META_KEY, JSON.stringify(summary, null, 2), {
        access: 'public',
        contentType: 'application/json',
        token,
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
      });
    } catch (e) {
      console.error(`Hinweis: Bilanz nicht gespeichert: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### TFT-Bilder-Kopie (${summary.mode})\n\n` +
        `| im Speicher | fehlen | neu | ersetzt | Fehler | fehlt bei CDragon | Dauer |\n|---|---|---|---|---|---|---|\n` +
        `| ${present}/${paths.length} | ${missing} | ${stats.uploaded} | ${stats.updated} | ${stats.failed} | ${stats.notFound} | ${summary.durationSec} s |\n`,
    );
  }
  if (missing > 0) {
    console.log(`::warning::${missing} von ${paths.length} TFT-Bildern fehlen noch in der eigenen Kopie (CommunityDragon: ${stats.failed} Fehler, ${stats.notFound} nicht vorhanden)`);
  }
}

main().catch((e) => {
  console.error(`FEHLER: ${e?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 200)}`);
  process.exit(1);
});
