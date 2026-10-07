#!/usr/bin/env node
// Rechnet die Patch-Vergleiche fuer /tft/meta-pulse (region=all) vor.
//
// Warum: get_tft_comp_stats_for_diff ueber alle Regionen braucht live 7-20 s
// und laeuft in der Route an den 20-s-Deckel der Datenbank — dann bleiben die
// Patch-Kaesten leer. Hier laeuft dieselbe Funktion ueber eine direkte
// Verbindung mit 120 s Limit, das Ergebnis landet als Blob. Pfad und
// Gueltigkeitsregeln: app/lib/snapshot-matrix.ts (META_PULSE_DIFF_*), Leser:
// app/lib/meta-pulse-diff-snapshot.ts.
//
// Seit 2026-10-02 zusaetzlich die Velocity („Aufsteiger", kalt bis 12 s):
// je Patch alle Fenster, die die Seite anfragen kann (META_PULSE_VELOCITY_*).
//
// Seit 2026-10-08 zusaetzlich die Rohzeilen der Patch-Gewinner
// (/api/tft/patch-diff, RSS-Feed; live 11-21 s, Items und Comps liefen in den
// 20-s-Deckel): je Art × Patch × Rang-Gruppe (PATCH_DIFF_*), ganz am Ende.
//
// Stuendlich per systemd-Timer (metastats-meta-pulse-diffs.timer). Rechnet nur
// neu, wenn der Blob fehlt, seine Spielzahl/sein letzter Tag nicht mehr zur
// Patch-Liste passt oder er aelter als 12 h ist — sonst kostet ein Lauf eine
// einzige kleine Abfrage.
//
// Env: SUPABASE_DB_URL, BLOB_READ_WRITE_TOKEN, SNAPSHOT_MANIFEST_URL.
// Flags: --dry-run (rechnen, nicht hochladen), --force (alles neu rechnen),
// --only=diff,velocity,patchdiff (nur diese Teile; Unbekanntes → Abbruch).
import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';
import { put } from '@vercel/blob';
import { ACTIVE_REGIONS } from './lib/active-regions.mjs';
import {
  establishedPatches,
  listWindowDays,
  metaPulseDiffPath,
  isValidMetaPulseDiff,
  metaPulseVelocityWindow,
  metaPulseVelocityPath,
  isValidMetaPulseVelocity,
  META_PULSE_DIFF_BUCKETS,
  META_PULSE_DIFF_MIN_GAMES,
  META_PULSE_VELOCITY_MIN_GAMES,
  META_PULSE_VELOCITY_SHIFTS,
  META_PULSE_COMPLETE_LOOKBACK_DAYS,
  metaPulseCompleteDay,
  previousPatchOf,
  PATCH_DIFF_ENTITIES,
  PATCH_DIFF_RPC,
  PATCH_DIFF_COLUMNS,
  PATCH_DIFF_BUCKETS,
  PATCH_DIFF_P_DAYS,
  PATCH_DIFF_MIN_GAMES,
  patchDiffPath,
  isValidPatchDiff,
  normalizePatchDiffRows,
} from '../app/lib/snapshot-matrix.generated.mjs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');
// --only=<Teil>[,<Teil>]: nur diese Teile rechnen. Positiv-Liste, damit ein
// neuer Teil nicht still bei einem alten --only mitlaeuft oder wegfaellt.
const PARTS = ['diff', 'velocity', 'patchdiff'];
const onlyArg = (args.find(a => a.startsWith('--only=')) || '').slice(7);
const ONLY = onlyArg ? onlyArg.split(',').map(x => x.trim()).filter(Boolean) : PARTS;
const unknownParts = ONLY.filter(x => !PARTS.includes(x));
if (ONLY.length === 0 || unknownParts.length > 0) {
  console.error(`--only: unbekannt ${unknownParts.join(', ') || '(leer)'} — erlaubt: ${PARTS.join(', ')}`);
  process.exit(1);
}
const runs = (part) => ONLY.includes(part);
const DAY_MS = 86_400_000;
const PATCH_COUNT = 3;
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
// Schonung der Datenbank (2026-10-01: Velocity fuer den alten Patch 18.2 lief
// 110 s und mehr, danach war die DB bis zum Neustart weg). Alte Patches liegen
// nicht im Speicher und kommen von der Platte, deshalb:
// - Velocity nur fuer den laufenden Patch, alte Patches rechnet die Route live;
// - Patchvergleiche alter Patches nur einmal am Tag (Route nimmt bis 36 h);
// - Notbremse: erster DB-Fehler oder eine Abfrage ueber 60 s beendet den Lauf;
// - kurze Pause zwischen den Abfragen.
const CLOSED_REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // Web akzeptiert sie 14 Tage
const SLOW_QUERY_MS = Number(process.env.META_PULSE_SLOW_MS) || 60_000; // Umgebung nur zum Testen der Bremse
const PAUSE_MS = 250;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class Brake extends Error {}

const DB_URL = process.env.SUPABASE_DB_URL;
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const MANIFEST_URL = process.env.SNAPSHOT_MANIFEST_URL;
if (!DB_URL || !MANIFEST_URL || (!TOKEN && !DRY_RUN)) {
  console.error('SUPABASE_DB_URL, SNAPSHOT_MANIFEST_URL und BLOB_READ_WRITE_TOKEN muessen gesetzt sein.');
  process.exit(1);
}
const ORIGIN = new URL(MANIFEST_URL).origin;

function encodePasswordInPgUrl(url) {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd < 0) return url;
  const after = url.slice(schemeEnd + 3);
  const atIdx = after.lastIndexOf('@');
  if (atIdx < 0) return url;
  const userinfo = after.slice(0, atIdx);
  const colonIdx = userinfo.indexOf(':');
  if (colonIdx < 0) return url;
  return `${url.slice(0, schemeEnd + 3)}${userinfo.slice(0, colonIdx)}:${encodeURIComponent(userinfo.slice(colonIdx + 1))}${after.slice(atIdx)}`;
}

const pool = new pg.Pool({
  connectionString: encodePasswordInPgUrl(DB_URL),
  ssl: /@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL) ? false : { rejectUnauthorized: false },
  max: 1,
  statement_timeout: 90_000,
  query_timeout: 100_000,
  connectionTimeoutMillis: 15_000,
});
// Ruhende Verbindungen, die der Server kappt (z. B. DB-Neustart), reissen sonst den Prozess.
pool.on('error', (e) => console.error(`DB-Verbindung verworfen: ${e.message}`));

const log = (msg) => console.log(`[meta-pulse-diffs] ${msg}`);
const isoDay = (v) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

async function existing(path) {
  try {
    const res = await fetch(`${ORIGIN}/${path}?_pub=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function main() {
  // Dieselbe Patch-Liste wie die Route: get_tft_available_patches(30) + Mindestvolumen.
  // Tage als Text: pg macht aus `date` sonst ein Date in Ortszeit (Tagesversatz).
  const { rows: raw } = await pool.query(
    'select patch, set_number, first_day::text as first_day, last_day::text as last_day, total_matches from get_tft_available_patches(30)',
  );
  const allPatches = establishedPatches(raw);
  // Vorpatch-Regel wie die Route (previousPatchOf): ein Kurz-Patch wird
  // uebersprungen. Die Liste reicht deshalb mindestens bis zum Vorpatch des
  // Vorpatches — die Seite vergleicht den gewaehlten Vorpatch wieder mit
  // SEINEM Vorpatch. Uebersprungene Kurz-Patches dazwischen bleiben drin, sie
  // sind direkt waehlbar.
  const prevPatch = previousPatchOf(allPatches, allPatches[0]?.patch);
  const prevPrevPatch = prevPatch ? previousPatchOf(allPatches, prevPatch.patch) : null;
  const reachIdx = allPatches.indexOf(prevPrevPatch ?? prevPatch);
  const patches = allPatches.slice(0, Math.max(PATCH_COUNT, reachIdx + 1));
  if (patches.length === 0) throw new Error('keine Patches');
  const regions = [...ACTIVE_REGIONS];
  let computed = 0, skipped = 0, failed = 0;

  // Jede Abfrage mit Pause davor; DB-Fehler loest die Notbremse aus.
  const guardedQuery = async (sql, params) => {
    await sleep(PAUSE_MS);
    const t0 = Date.now();
    try {
      const { rows } = await pool.query(sql, params);
      return { rows, ms: Date.now() - t0 };
    } catch (e) {
      throw new Brake(`DB-Fehler nach ${((Date.now() - t0) / 1000).toFixed(1)} s: ${e.message}`);
    }
  };
  const brakeIfSlow = (ms, path) => {
    if (ms > SLOW_QUERY_MS) throw new Brake(`${path} brauchte ${(ms / 1000).toFixed(1)} s`);
  };

  // Laufender Patch zuerst (Diffs, dann Velocity), alte Patch-Diffs danach,
  // Patch-Gewinner ganz am Ende (neuer Teil, darf die alten nicht aufhalten).
  if (runs('diff')) await runDiffs(patches[0], REFRESH_AFTER_MS, false);
  if (runs('velocity')) await runVelocity();
  for (const p of runs('diff') ? patches.slice(1) : []) await runDiffs(p, CLOSED_REFRESH_AFTER_MS, true);
  if (runs('patchdiff')) await runPatchDiffs();

  log(`fertig: ${computed} neu, ${skipped} aktuell, ${failed} Fehler (Patches ${patches.map(p => p.patch).join(', ')}${runs('patchdiff') ? `; Patch-Gewinner ${allPatches.map(p => p.patch).join(', ')}` : ''})`);
  return failed;

  // Patch-Gewinner (/api/tft/patch-diff, RSS-Feed): Rohzeilen je Art × Patch ×
  // Rang-Gruppe, nur alle Regionen, alle Patches der 30-Tage-Liste (aeltere
  // sind in den Stats-Funktionen ohnehin leer). Gruppe „all" zuerst (laedt
  // die Tage in den Speicher), Items zuletzt (langsamste Abfrage).
  async function runPatchDiffs() {
    for (const entity of PATCH_DIFF_ENTITIES) {
      for (const [idx, p] of allPatches.entries()) {
        const closed = idx > 0;
        for (const [bucketLabel, buckets] of Object.entries(PATCH_DIFF_BUCKETS)) {
          const path = patchDiffPath(p.patch, entity, bucketLabel);
          const want = {
            set: Number(p.set_number), patch: p.patch, entity, lastDay: isoDay(p.last_day),
            totalMatches: Number(p.total_matches), regions, buckets, now: Date.now(), closed,
          };
          if (!FORCE) {
            const old = await existing(path);
            // Laufend: neu bei jeder neuen Spielzahl oder nach 12 h.
            // Abgeschlossen: neu nur bei mehr Spielen (Nachzuegler) oder nach
            // 7 Tagen — die 30-Tage-Liste laesst ihre Summe sonst schrumpfen.
            if (isValidPatchDiff(old, want)
              && (closed ? Number(old.totalMatches) >= want.totalMatches : Number(old.totalMatches) === want.totalMatches)
              && Date.now() - Date.parse(old.generatedAt) < (closed ? CLOSED_REFRESH_AFTER_MS : REFRESH_AFTER_MS)) {
              skipped++;
              continue;
            }
          }
          try {
            const isComp = entity === 'comp';
            const { rows, ms } = await guardedQuery(
              `select ${PATCH_DIFF_COLUMNS[entity].join(', ')} from ${PATCH_DIFF_RPC[entity]}(
                 p_regions => $1::text[], p_buckets => $2::text[], p_days => $3::int,
                 p_patch => $4::text, p_set => $5::int${isComp ? ', p_min_games => $6::int' : ''})`,
              [regions, [...buckets], PATCH_DIFF_P_DAYS, p.patch, want.set, ...(isComp ? [PATCH_DIFF_MIN_GAMES] : [])],
            );
            const snap = {
              v: 1,
              generatedAt: new Date().toISOString(),
              set: want.set,
              patch: p.patch,
              entity,
              lastDay: want.lastDay,
              totalMatches: want.totalMatches,
              regions,
              buckets: [...buckets],
              days: PATCH_DIFF_P_DAYS,
              minGames: PATCH_DIFF_MIN_GAMES,
              rows: normalizePatchDiffRows(entity, rows),
            };
            if (!isValidPatchDiff(snap, want)) throw new Error('eigener Blob faellt durch die Pruefung');
            if (!DRY_RUN) {
              await put(path, JSON.stringify(snap), {
                access: 'public',
                contentType: 'application/json',
                token: TOKEN,
                addRandomSuffix: false,
                allowOverwrite: true,
                cacheControlMaxAge: 60,
              });
            }
            computed++;
            log(`${path}: ${snap.rows.length} Zeilen in ${(ms / 1000).toFixed(1)} s${DRY_RUN ? ' (dry-run)' : ''}`);
            brakeIfSlow(ms, path);
          } catch (e) {
            if (e instanceof Brake) throw e;
            failed++;
            log(`FEHLER ${path}: ${e.message}`);
          }
        }
      }
    }
  }

  async function runDiffs(p, refreshAfterMs, closed) {
    for (const [bucketLabel, buckets] of Object.entries(META_PULSE_DIFF_BUCKETS)) {
      const path = metaPulseDiffPath(p.patch, bucketLabel);
      const want = {
        set: Number(p.set_number), patch: p.patch, lastDay: isoDay(p.last_day),
        totalMatches: Number(p.total_matches), regions, buckets, now: Date.now(), closed,
      };
      if (!FORCE) {
        const old = await existing(path);
        // Abgeschlossene Patches: die 30-Tage-Patchliste laesst ihre Summe
        // schrumpfen, Gleichheit wuerde sie bei jedem Lauf neu rechnen lassen.
        if (isValidMetaPulseDiff(old, want)
          && (closed || Number(old.totalMatches) === want.totalMatches)
          && Date.now() - Date.parse(old.generatedAt) < refreshAfterMs) {
          skipped++;
          continue;
        }
      }
      try {
        // Fenster ab dem ersten Patch-Tag (current_date wie in der Route).
        const { rows, ms } = await guardedQuery(
          `select * from get_tft_comp_stats_for_diff($1::text[], $2::text[],
             (current_date - $3::date + 1)::int, $4::text, $5::int, $6::int)`,
          [regions, [...buckets], isoDay(p.first_day), p.patch, Number(p.set_number), META_PULSE_DIFF_MIN_GAMES],
        );
        const snap = {
          v: 1,
          generatedAt: new Date().toISOString(),
          set: want.set,
          patch: p.patch,
          lastDay: want.lastDay,
          totalMatches: want.totalMatches,
          regions,
          buckets: [...buckets],
          minGames: META_PULSE_DIFF_MIN_GAMES,
          rows: rows.map(r => ({
            cluster_key: r.cluster_key,
            games: Number(r.games),
            sum_placement: Number(r.sum_placement),
            top4: Number(r.top4),
            top1: Number(r.top1),
            participants: Number(r.participants),
          })),
        };
        if (!isValidMetaPulseDiff(snap, want)) throw new Error('eigener Blob faellt durch die Pruefung');
        if (!DRY_RUN) {
          await put(path, JSON.stringify(snap), {
            access: 'public',
            contentType: 'application/json',
            token: TOKEN,
            addRandomSuffix: false,
            allowOverwrite: true,
            cacheControlMaxAge: 60,
          });
        }
        computed++;
        log(`${path}: ${rows.length} Comps in ${(ms / 1000).toFixed(1)} s${DRY_RUN ? ' (dry-run)' : ''}`);
        brakeIfSlow(ms, path);
      } catch (e) {
        if (e instanceof Brake) throw e;
        failed++;
        log(`FEHLER ${path}: ${e.message}`);
      }
    }
  }

  // Velocity („Aufsteiger"): alle Fenster, die die Seite fuer Tage 1-7 und
  // Abstand 1/2/3/7/14 anfragen kann — ueber dieselbe Rechnung wie die Route.
  // Nur der laufende Patch (selIdx 0), siehe Schonung oben.
  async function runVelocity() {
  const todayNum = Math.floor(Date.now() / DAY_MS);
  const { anchorOffsetDays: latestOffsetDays } = listWindowDays({
    requestedDays: 1, patchFilter: null, patchStartDay: null,
    latestDay: isoDay(allPatches[0].last_day), today: new Date(),
  });
  for (let selIdx = 0; selIdx < 1; selIdx++) {
    const raw = patches[selIdx];
    const rawCmp = previousPatchOf(allPatches, raw.patch);
    const sel = { patch: raw.patch, first_day: isoDay(raw.first_day), last_day: isoDay(raw.last_day) };
    const setNumber = Number(raw.set_number);
    // Letzter vollstaendiger Tag, dieselbe Regel wie die Route. Kleine Abfrage
    // ausserhalb der Notbremse: ein Fehler heisst nur Fenster wie bisher.
    let completeDay = null;
    try {
      const { rows: metaRows } = await pool.query(
        `select region, day::text as day, finished_at from tft_daily_crawl_meta
          where set_number = $1 and region = any($2::text[]) and day >= $3::date - $4::int`,
        [setNumber, regions, sel.last_day, META_PULSE_COMPLETE_LOOKBACK_DAYS],
      );
      completeDay = metaPulseCompleteDay(
        metaRows.map(r => ({ region: r.region, day: r.day, finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null })),
        regions, Date.now(),
      );
      log(`vollstaendig bis ${completeDay ?? '–'} (neuester Tag ${sel.last_day})`);
    } catch (e) {
      log(`Tages-Eingang nicht lesbar, Fenster wie bisher: ${e.message}`);
    }
    const previousPatch = rawCmp && Number(rawCmp.set_number) === setNumber ? rawCmp.patch : null;
    const windows = new Map();
    for (let requestedDays = 1; requestedDays <= 7; requestedDays++) {
      for (const velocityShift of META_PULSE_VELOCITY_SHIFTS) {
        const w = metaPulseVelocityWindow({
          sel, cmpLastDay: rawCmp ? isoDay(rawCmp.last_day) : null, previousPatch,
          selIdx, requestedDays, velocityShift, latestOffsetDays, todayNum, completeDay,
        });
        windows.set(`${w.mode}|${w.anchorDay}|${w.effDays}|${w.effShift}`, w);
      }
    }
    for (const [bucketLabel, buckets] of Object.entries(META_PULSE_DIFF_BUCKETS)) {
      for (const w of windows.values()) {
        const path = metaPulseVelocityPath(sel.patch, bucketLabel, w);
        const want = {
          set: setNumber, patch: sel.patch, comparePatch: previousPatch,
          lastDay: sel.last_day, totalMatches: Number(raw.total_matches),
          compareTotalMatches: rawCmp ? Number(rawCmp.total_matches) : null,
          regions, buckets, window: w, now: Date.now(),
        };
        if (!FORCE) {
          const old = await existing(path);
          if (isValidMetaPulseVelocity(old, want)
            && Number(old.totalMatches) === want.totalMatches
            && (w.mode !== 'crossPatch' || Number(old.compareTotalMatches) === want.compareTotalMatches)
            && Date.now() - Date.parse(old.generatedAt) < REFRESH_AFTER_MS) {
            skipped++;
            continue;
          }
        }
        try {
          // Anker als absoluter Tag → Offset gegen current_date der Datenbank.
          const { rows, ms } = await guardedQuery(
            `select cluster_key, games_now, games_prev, sum_placement_now, sum_placement_prev
               from get_tft_comp_velocity(
                 p_regions => $1::text[], p_buckets => $2::text[], p_set => $3::int,
                 p_patch => $4::text, p_days => $5::int, p_shift_days => $6::int,
                 p_min_games => $7::int, p_anchor_offset_days => (current_date - $8::date)::int)`,
            [regions, [...buckets], setNumber, w.velocityPatch, w.effDays, w.effShift,
              META_PULSE_VELOCITY_MIN_GAMES, w.anchorDay],
          );
          const snap = {
            v: 1,
            generatedAt: new Date().toISOString(),
            set: setNumber,
            patch: sel.patch,
            comparePatch: previousPatch,
            lastDay: sel.last_day,
            totalMatches: want.totalMatches,
            compareTotalMatches: want.compareTotalMatches,
            regions,
            buckets: [...buckets],
            minGames: META_PULSE_VELOCITY_MIN_GAMES,
            mode: w.mode,
            anchorDay: w.anchorDay,
            effDays: w.effDays,
            effShift: w.effShift,
            rows: rows.map(r => ({
              cluster_key: r.cluster_key,
              games_now: Number(r.games_now),
              games_prev: Number(r.games_prev),
              sum_placement_now: Number(r.sum_placement_now),
              sum_placement_prev: Number(r.sum_placement_prev),
            })),
          };
          if (!isValidMetaPulseVelocity(snap, want)) throw new Error('eigener Blob faellt durch die Pruefung');
          if (!DRY_RUN) {
            await put(path, JSON.stringify(snap), {
              access: 'public',
              contentType: 'application/json',
              token: TOKEN,
              addRandomSuffix: false,
              allowOverwrite: true,
              cacheControlMaxAge: 60,
            });
          }
          computed++;
          log(`${path}: ${rows.length} Comps in ${(ms / 1000).toFixed(1)} s${DRY_RUN ? ' (dry-run)' : ''}`);
          brakeIfSlow(ms, path);
        } catch (e) {
          if (e instanceof Brake) throw e;
          failed++;
          log(`FEHLER ${path}: ${e.message}`);
        }
      }
    }
  }
  }
}

main()
  .then(async (failed) => { await pool.end(); process.exit(failed > 0 ? 1 : 0); })
  .catch(async (e) => { log(`${e instanceof Brake ? 'Notbremse, Lauf beendet' : 'abgebrochen'}: ${e.message}`); await pool.end().catch(() => {}); process.exit(1); });
