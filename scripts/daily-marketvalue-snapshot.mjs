#!/usr/bin/env node
/**
 * Daily Marktwert-Snapshot-Lauf — Lib-basierter Daily-Driver für Phase A4.
 *
 * Ersetzt langfristig den alten Cold-Sweep-Crawler (`collect-tft-marketvalues
 * .mjs` via `crawl-all-regions.mjs`) für den TÄGLICHEN Refresh-Pfad. Der alte
 * Crawler bleibt als wöchentlicher Discovery-Lauf (Aufsteiger-Erkennung,
 * Sonntags).
 *
 * Iterations-Quelle (Option Z aus Multi-Review-Verdict 2026-06-19):
 *   • tft_player_marketvalue_snapshots WHERE tier IN (D2+)
 *                                        AND snapshot_date < today
 *                                        AND region = X
 * Das ist die D2+-Kohorte die heute noch keinen Snapshot hat. Aufsteiger
 * werden vom wöchentlichen Discovery-Lauf abgefangen.
 *
 * Pro Spieler:
 *   1. refreshPlayerMatchCache mit startTime = last_snapshot_date - 1h
 *      → fetcht nur NEUE Matches statt voller 200-id-Diff. Memory:
 *        reference_riot_production_key + Multi-Review-Verdict.
 *   2. gatherPlayer (Lib) extrahiert Raw-Metriken.
 *   3. Pop-Recompute aus aktiven Spielern der Region.
 *   4. snapshotPlayer (Lib) schreibt Snapshot mit aktualisiertem Multiplier.
 *
 * me1-Sonderfall: Population n=68 ist statistisch nicht valide für z-Scores.
 * Bypass: synthetic-null-pop → multiplier=1.0 (pure Base-Value). Memory:
 * Multi-Review-Verdict Data-Skeptic 2026-06-19.
 *
 * Backup-Pattern für Rollback: vor jedem scharfen Lauf wird die heutige
 * Region-Slice als `tft_pmvs_backup_YYYYMMDD_<region>` archiviert. Bei
 * Fehler: TRUNCATE heutige Region-Rows + Restore aus Backup. Tabelle wird
 * nach 7 Tagen automatisch durch pg_prune-Cron entfernt.
 *
 * Usage:
 *   node scripts/daily-marketvalue-snapshot.mjs --region euw1
 *   node scripts/daily-marketvalue-snapshot.mjs --region euw1 --dry-run
 *   node scripts/daily-marketvalue-snapshot.mjs --region all
 *   node scripts/daily-marketvalue-snapshot.mjs --region euw1 --max-ids 100  # Patch-Day-Override
 *
 * Flags:
 *   --region <name|all>       Region (oder 'all' für alle 15 aktiven)
 *   --dry-run                 Keine Riot-Calls, kein Schreiben. Estimate aus DB-Reads.
 *   --max-ids <N>             Cap für startTime-bounded Match-ID-Pull (Default 30, Patch-Day 100)
 *   --match-concurrency <N>   Match-Detail-Concurrency (Default 4, schont Refresh-API-Headroom)
 *   --limit <N>               Nur N Spieler pro Region (Smoke-Mode)
 *   --skip-backup             Backup-Table-Step skippen (für Tests)
 *   --verbose
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import pg from 'pg';
import { createRiotClient } from './lib/riot-client.mjs';
import { buildCompMeta, applyMeta, buildPopulation } from './lib/tft-skill-score.mjs';
import {
  buildHotCompKeys,
  buildRecommendedItems,
} from './lib/tft-season-aggregator.mjs';
import {
  getRegionalCluster,
  loadCurrentSet,
  loadGraph,
  gatherPlayer,
  persistPopulation,
  snapshotPlayer,
} from './lib/tft-marketvalue-pipeline.mjs';
import { ACTIVE_REGIONS } from './lib/active-regions.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// Konstanten
// ─────────────────────────────────────────────────────────────────────────────

// ACTIVE_REGIONS = 15 Regionen (ph2/th2 raus seit 2026-06-19). me1 ist drin
// trotz n=68 Pop — kriegt synthetic-null-pop unten. Single-Source-of-Truth
// in scripts/lib/active-regions.mjs (synchron mit app/lib/active-regions.ts).

// Regions mit zu kleiner Pop für valide z-Score-Verteilung. Synthetic-null-pop
// → multiplier=1.0 (Base-Value only, signals=null).
const POP_BYPASS_REGIONS = new Set(['me1']);

const D2_TIERS = ['DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];

// Default-Caps für Daily-Lauf — bewusst klein, weil startTime den
// Match-ID-Range schon stark einschränkt. Patch-Day-Override via --max-ids 100.
const DEFAULT_MAX_IDS = 30;
const DEFAULT_CONCURRENCY = 4;

// Sicherheits-Overlap beim startTime-Filter — Match-V1 schneidet manchmal
// um Tagesgrenzen, 1h Puffer gegen Off-by-one-Verluste.
const START_TIME_OVERLAP_SEC = 60 * 60;

// Sub-Region-Resume Inflight-Tabelle (Migration 0046, 2026-06-25).
// Schwelle: nur Regionen mit >= 500 Spielern aktivieren Inflight (Region-
// Laufzeit ~10min als Mindest-ROI). Skip-Liste: me1 (n~90), br1/la1/la2
// (~1200 alle), oc1 (~900) — kleine Regionen sind atomar genug.
// (Multi-Review perf-critic F8: Schwelle player-count-basiert, nicht magic 100)
const INFLIGHT_MIN_PLAYERS = 500;

// Feature-Flag für Inflight-Resume. Default OFF für erste 2-3 Wochen Production
// (architect F5: Rollback in 60s ohne Code-Deploy via systemd Environment=).
// Driver schreibt Inflight wenn Flag=true, sonst Bypass komplett.
const USE_INFLIGHT_RESUME = (process.env.MV_USE_INFLIGHT_RESUME || 'false').toLowerCase() === 'true';

// Cursor-Schema-Version. Bei Major-Schema-Änderung bumpen, alt-Driver
// erkennen Mismatch und resetten Cursor sauber (logic-flow F6).
const CURSOR_SCHEMA_VERSION = 2;

// Region-Cursor lebt OUTSIDE /opt/metastats-crawler — remote-deploy.sh würde
// einen In-Repo-Cursor mit `git clean -fd` killen. Lokal-Dev fällt auf cwd.
// Cursor pro UTC-Tag: enthält die heute schon fertigen Regionen. Bei Tagesgrenze
// resetet sich der Cursor automatisch (date-stamp im File).
const CURSOR_PATH = process.env.MV_SNAPSHOT_CURSOR
  || (existsSync('/etc/metastats-crawler')
      ? '/etc/metastats-crawler/marketvalue-snapshot-cursor.json'
      : resolve(process.cwd(), '.mv-snapshot-cursor.json'));

// ─────────────────────────────────────────────────────────────────────────────
// Args
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const arg = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
const hasFlag = (k) => args.includes(k);

const REGION_ARG = (arg('--region', 'all') || 'all').toLowerCase();
const DRY_RUN = hasFlag('--dry-run');
const MAX_IDS = parseInt(arg('--max-ids', String(DEFAULT_MAX_IDS)), 10);
const MATCH_CONCURRENCY = parseInt(arg('--match-concurrency', String(DEFAULT_CONCURRENCY)), 10);
const LIMIT = parseInt(arg('--limit', '0'), 10);
const SKIP_BACKUP = hasFlag('--skip-backup');
const RESET_CURSOR = hasFlag('--reset-cursor');
const VERBOSE = hasFlag('--verbose');

if (!Number.isFinite(MAX_IDS) || MAX_IDS < 1 || MAX_IDS > 1000) {
  console.error(`Invalid --max-ids ${MAX_IDS}, expected 1..1000`);
  process.exit(1);
}
if (!Number.isFinite(MATCH_CONCURRENCY) || MATCH_CONCURRENCY < 1 || MATCH_CONCURRENCY > 20) {
  console.error(`Invalid --match-concurrency ${MATCH_CONCURRENCY}, expected 1..20`);
  process.exit(1);
}

const REGIONS = REGION_ARG === 'all'
  ? [...ACTIVE_REGIONS]
  : [REGION_ARG];

for (const r of REGIONS) {
  if (!ACTIVE_REGIONS.includes(r)) {
    console.error(`Unknown or inactive region: ${r}`);
    console.error(`Active: ${ACTIVE_REGIONS.join(', ')}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Env-Loader (identisch zu collect-tft-marketvalues.mjs)
// ─────────────────────────────────────────────────────────────────────────────

function loadEnv() {
  const candidates = ['/etc/metastats-crawler/env', resolve(process.cwd(), '.env.local')];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.includes('=') || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
    break;
  }
}
loadEnv();

const API_KEY = process.env.RIOT_API_KEY_TFT;
if (!API_KEY) { console.error('RIOT_API_KEY_TFT env var required'); process.exit(1); }

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL env var required'); process.exit(1); }

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || null;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || null;

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

const riot = createRiotClient({
  shortWindowRequests: 180,
  shortWindowMs: 10_500,
  longWindowRequests: 28000,
  longWindowMs: 605_000,
});

// pg.Pool max=6 (Perf-Critic-Verdict: schont Refresh-API-Headroom während
// des langen Laufs; Default 10 würde Companion-Backfill alle 10 min killen).
//
// DATABASE_URL kann Hetzner-local (kein Encoding, kein SSL) oder Supabase-
// Pooler (URL-encoded Password + SSL) sein. Auto-detect per Hostname.
function encodePasswordInPgUrl(url) {
  // Special-Chars wie '#' in Supabase-Passwörtern brechen pg's URL-Parser.
  const schemeEnd = url.indexOf('://');
  if (schemeEnd < 0) return url;
  const after = url.slice(schemeEnd + 3);
  const atIdx = after.lastIndexOf('@');
  if (atIdx < 0) return url;
  const userinfo = after.slice(0, atIdx);
  const rest = after.slice(atIdx);
  const colonIdx = userinfo.indexOf(':');
  if (colonIdx < 0) return url;
  const user = userinfo.slice(0, colonIdx);
  const pass = userinfo.slice(colonIdx + 1);
  return `${url.slice(0, schemeEnd + 3)}${user}:${encodeURIComponent(pass)}${rest}`;
}
const isRemote = /supabase\.com|pooler\.|aws-/i.test(DATABASE_URL);
const pool = new pg.Pool({
  connectionString: isRemote ? encodePasswordInPgUrl(DATABASE_URL) : DATABASE_URL,
  ssl: isRemote ? { rejectUnauthorized: false } : undefined,
  max: 6,
});

let aborting = false;
process.on('SIGTERM', () => {
  if (aborting) return;
  aborting = true;
  console.log('\n  [signal] SIGTERM — finishing current region, then exiting (cursor preserved)');
});

// ─────────────────────────────────────────────────────────────────────────────
// Region-Cursor: tagsweise "schon fertig"-Liste
// ─────────────────────────────────────────────────────────────────────────────

function todayUtcIso() {
  return new Date().toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Inflight-Tabelle Helper (Sub-Region-Resume, Migration 0046)
// ─────────────────────────────────────────────────────────────────────────────

// Cleanup stale Inflight beim Driver-Start. Architect F3: day-cleanup REICHT
// NICHT — Set-Bump zwischen 23:55 (Set 17) und 00:05 (Set 18) würde stale Set-17
// Inflight stehen lassen. Cleanup-Condition: day < today OR set_number != current.
async function cleanupStaleInflight(currentSetNumber) {
  if (!USE_INFLIGHT_RESUME) return;
  try {
    const r = await pool.query(
      `delete from tft_mv_inflight_raw
       where day < $1 or set_number != $2`,
      [todayUtcIso(), currentSetNumber],
    );
    if (r.rowCount > 0) {
      console.log(`  [inflight] cleaned ${r.rowCount} stale rows (day<today OR set != ${currentSetNumber})`);
    }
  } catch (err) {
    console.error(`  [inflight] cleanupStale failed: ${err.message}`);
  }
}

// `--reset-cursor` Cascade: löscht Cursor + alle heutigen Inflight-Rows.
async function clearTodayInflight() {
  if (!USE_INFLIGHT_RESUME) return;
  try {
    const r = await pool.query(
      `delete from tft_mv_inflight_raw where day = $1`,
      [todayUtcIso()],
    );
    if (r.rowCount > 0) {
      console.log(`  [inflight] reset: ${r.rowCount} heute-Rows gelöscht`);
    }
  } catch (err) {
    console.error(`  [inflight] reset failed: ${err.message}`);
  }
}

// Pass-1-Eintritt: lese alle bereits gather-ten Spieler für diese Region.
// Truth-Source für Skip-Set (logic-flow F2: cursor.persistedCount ist NUR
// Anzeige-Telemetrie, NIE Skip-Threshold).
async function loadInflightForRegion(region) {
  if (!USE_INFLIGHT_RESUME) return new Map();
  try {
    const r = await pool.query(
      `select puuid, raw_metrics
       from tft_mv_inflight_raw
       where region = $1 and day = $2`,
      [region, todayUtcIso()],
    );
    return new Map(r.rows.map(row => [row.puuid, row.raw_metrics]));
  } catch (err) {
    console.error(`  [inflight] load failed (${region}): ${err.message}`);
    return new Map();
  }
}

// Pro Spieler nach erfolgreichem gatherPlayer: persistiere Raw-Metriken.
// PK (puuid, region, day) — UPSERT idempotent bei Re-Run.
async function insertInflight(region, setNumber, puuid, rawMetrics) {
  if (!USE_INFLIGHT_RESUME) return;
  try {
    await pool.query(
      `insert into tft_mv_inflight_raw (puuid, region, day, set_number, raw_metrics)
       values ($1, $2, $3, $4, $5)
       on conflict (puuid, region, day) do update set raw_metrics = excluded.raw_metrics, persisted_at = now()`,
      [puuid, region, todayUtcIso(), setNumber, rawMetrics],
    );
  } catch (err) {
    // Inflight-Write-Failure ist nicht fatal — Driver läuft ohne Resume
    // weiter, nur Crash-Recovery für diesen Spieler ist weg.
    if (VERBOSE) console.error(`  [inflight] insert failed ${puuid.slice(0, 8)}…: ${err.message}`);
  }
}

// Region-Done-Cleanup. NICHT atomar mit Cursor-Write — Reihenfolge umgekehrt
// (logic-flow F1: Cursor zuerst). Bei Crash zwischen Cursor-Write und Cleanup
// bleibt stale Inflight, wird beim nächsten Driver-Start via cleanupStaleInflight
// gefangen.
async function cleanupRegionInflight(region) {
  if (!USE_INFLIGHT_RESUME) return;
  try {
    const r = await pool.query(
      `delete from tft_mv_inflight_raw where region = $1 and day = $2`,
      [region, todayUtcIso()],
    );
    if (VERBOSE && r.rowCount > 0) {
      console.log(`  [inflight] region-done cleanup ${region}: ${r.rowCount} rows`);
    }
  } catch (err) {
    console.error(`  [inflight] region-done cleanup ${region}: ${err.message}`);
  }
}

function readCursor() {
  if (RESET_CURSOR) return { day: todayUtcIso(), completed: [], inflight: null };
  try {
    const raw = JSON.parse(readFileSync(CURSOR_PATH, 'utf8'));
    // Cursor wird pro UTC-Tag resetet — gestern fertige Regionen brauchen heute
    // wieder einen frischen Snapshot.
    if (raw.day !== todayUtcIso()) return { day: todayUtcIso(), completed: [], inflight: null };
    // Bei Schema-Version-Mismatch: fail-loud (logic-flow F6). Aktuell V1->V2
    // ist tolerant lesbar (inflight fehlt = null), aber zukünftige V2->V3
    // soll explizit migrationspflicht sein.
    const version = raw.cursorVersion ?? 1;
    if (version > CURSOR_SCHEMA_VERSION) {
      console.error(`[cursor] schema version ${version} unsupported (driver supports ${CURSOR_SCHEMA_VERSION}) — resetting`);
      return { day: todayUtcIso(), completed: [], inflight: null };
    }
    return {
      day: raw.day,
      completed: Array.isArray(raw.completed) ? raw.completed : [],
      // inflight ist Anzeige-only (logic-flow F2). Skip-Set kommt IMMER aus
      // loadInflightForRegion() DB-Query, NIE aus cursor.inflight.persistedCount.
      inflight: raw.inflight && typeof raw.inflight === 'object' ? raw.inflight : null,
    };
  } catch {
    return { day: todayUtcIso(), completed: [], inflight: null };
  }
}

function writeCursor(cursor) {
  // Atomic write via tmp-file + rename. Logic-Flow-Critic 2026-06-20: direkt
  // writeFileSync ist nicht crash-safe — SIGKILL während des Writes könnte den
  // Cursor truncated/corrupt hinterlassen. readCursor würde dann als "leer"
  // behandeln → alle 15 Regionen morgen neu iterieren (~30k Riot-Calls
  // Verschwendung). tmp+rename ist POSIX-atomic auf demselben Filesystem.
  try {
    mkdirSync(dirname(CURSOR_PATH), { recursive: true });
    const tmpPath = `${CURSOR_PATH}.tmp`;
    const payload = {
      cursorVersion: CURSOR_SCHEMA_VERSION,
      day: cursor.day,
      completed: cursor.completed,
      updatedAt: new Date().toISOString(),
    };
    // inflight ist optional + Anzeige-only. NUR setzen wenn aktiv vorhanden,
    // sonst weglassen — vermeidet stale `inflight` nach Region-Done.
    if (cursor.inflight && typeof cursor.inflight === 'object') {
      payload.inflight = cursor.inflight;
    }
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
    // rename() ist atomic auf POSIX → entweder altes File oder neues File,
    // nie ein truncated File.
    renameSync(tmpPath, CURSOR_PATH);
  } catch (err) {
    console.error(`[cursor] persist failed (${CURSOR_PATH}): ${err.message}`);
  }
}

function clearCursor() {
  try { unlinkSync(CURSOR_PATH); } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic-null-pop für me1-Bypass
// ─────────────────────────────────────────────────────────────────────────────

function makeNullPop() {
  // Alle MADs = 0 → zOf() returns null für jedes Signal → wSum = 0 →
  // skillScoreRaw = 0 → multiplier = 1 + 0.65·tanh(0) = 1.0. Saubere
  // "kein Skill-Score" Aussage statt erfundener Werte.
  const nullStat = { median: 0, mad: 0, n: 0 };
  return {
    medians: {
      performance: nullStat,
      metaRelative: nullStat,
      consistency: nullStat,
      flexMastery: nullStat,
      survival: nullStat,
      eco: nullStat,
      boardStrength: nullStat,
    },
    expectedDmg: {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Iteration: alle D2+ Spieler einer Region deren letzter Snapshot < today
// ─────────────────────────────────────────────────────────────────────────────

async function loadIterationTargets(region) {
  // Pro Spieler: das ZULETZT bekannte Snapshot-Tier + LP + last_snapshot_date.
  // Wir gehen davon aus, dass das Tier nicht im letzten Tag um mehr als 1
  // Division gerutscht ist — wenn doch, korrigiert sich das im nächsten
  // wöchentlichen Discovery-Lauf (= alter Crawler mit --include-diamond).
  const r = await pool.query(
    `with latest as (
       select distinct on (puuid)
         puuid, region, tier, rank, lp, ladder_rank, snapshot_date
       from tft_player_marketvalue_snapshots
       where region = $1
       order by puuid, snapshot_date desc
     )
     select * from latest
     where tier = any($2::text[])
       and snapshot_date < current_date`,
    [region, D2_TIERS],
  );
  return r.rows.map(row => ({
    puuid: row.puuid,
    tier: row.tier,
    rank: row.rank,
    lp: row.lp,
    ladderRank: row.ladder_rank ?? undefined,
    lastSnapshotDate: row.snapshot_date,
    // wins/losses fehlen — der Daily-Refresh fragt sie nicht frisch ab
    // (würde extra by-puuid-Call kosten). Skill-Score nutzt sie nur als
    // Bayesian-Prior für top4Blend; bei wins=losses=0 fällt der Score auf
    // den beobachteten top4-Rate zurück, was OK ist.
    wins: 0,
    losses: 0,
  }));
}

function startTimeForPlayer(player) {
  // last_snapshot_date kommt als Date-Object aus pg → epoch sec
  const t = player.lastSnapshotDate.getTime() / 1000;
  return Math.floor(t) - START_TIME_OVERLAP_SEC;
}

// ─────────────────────────────────────────────────────────────────────────────
// Backup-Pattern für Rollback
// ─────────────────────────────────────────────────────────────────────────────

function backupTableName(region) {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `tft_pmvs_backup_${d}_${region}`;
}

async function createBackup(region) {
  const tbl = backupTableName(region);
  // CREATE IF NOT EXISTS-Pattern: bei Re-Run am gleichen Tag bleibt das
  // ursprüngliche Backup erhalten (= state VOR allen heutigen Schreibwegen).
  const exists = await pool.query(
    `select 1 from pg_tables where schemaname = 'public' and tablename = $1`,
    [tbl],
  );
  if (exists.rows.length > 0) {
    console.log(`  [backup] ${tbl} existiert bereits — skip (wahrscheinlich Re-Run)`);
    return tbl;
  }
  await pool.query(
    `create table ${tbl} as
     select * from tft_player_marketvalue_snapshots
     where region = $1 and snapshot_date = current_date`,
    [region],
  );
  const cnt = await pool.query(`select count(*)::int as n from ${tbl}`);
  console.log(`  [backup] ${tbl} — ${cnt.rows[0].n} Rows gesichert`);
  return tbl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Region-Lauf
// ─────────────────────────────────────────────────────────────────────────────

async function processRegion(region) {
  const regional = getRegionalCluster(region);
  console.log(`\n=== ${region} (cluster=${regional}) ===`);
  const t0 = Date.now();

  // 0. Player-Liste aus Snapshot-Tabelle (Option Z, vereinfacht)
  let players = await loadIterationTargets(region);
  console.log(`  [iter] ${players.length} D2+ Spieler ohne heutigen Snapshot`);
  if (LIMIT > 0) players = players.slice(0, LIMIT);

  // Dry-Run: nur Estimate ausgeben, keine Riot-Calls, kein Schreib
  if (DRY_RUN) {
    const fs = await pool.query(
      `select count(*)::int as n,
              count(*) filter (where last_fetched_at > now() - interval '7 days')::int as fresh_7d,
              count(*) filter (where last_fetched_at > now() - interval '1 day')::int as fresh_1d
       from tft_player_fetch_state where region = $1`,
      [region],
    );
    const f = fs.rows[0];
    // Quota-Estimate: pro Spieler ~1 by-puuid + 0-5 Match-Details + 1 Account
    const estCalls = players.length * (1 + 2 + 1); // optimistisch 2 Match-Details avg
    console.log(`  [dry-run] fetch_state: ${f.n} cache rows, ${f.fresh_7d} fresh<7d, ${f.fresh_1d} fresh<1d`);
    console.log(`  [dry-run] estimated Riot-Calls: ${estCalls} (~${(estCalls / 17 / 60).toFixed(1)} min @ 17 req/s)`);
    return { region, players: players.length, snapshots: 0, dryRun: true };
  }

  if (players.length === 0) {
    console.log(`  [done] nichts zu tun — alle Spieler haben heutigen Snapshot`);
    return { region, players: 0, snapshots: 0 };
  }

  // 1. Backup vor scharfem Lauf
  let backupTbl = null;
  if (!SKIP_BACKUP) {
    backupTbl = await createBackup(region);
  }

  // 2. Pass 1: gatherPlayer pro Spieler
  const setNumber = loadCurrentSet();
  if (setNumber == null) {
    console.error('  [error] No current set, aborting');
    return { region, players: players.length, snapshots: 0, failed: 1 };
  }
  const graph = loadGraph(region);
  const hotCompKeys = buildHotCompKeys(graph);
  const recommendedItems = buildRecommendedItems(graph);

  // Inflight-Aktivierungs-Check: nur ab >=500 Spielern lohnt sich Resume-
  // Granularität (perf-critic F8: kleine Regionen sind in 2-5min durch,
  // Resume-Wert null). me1/br1/la1/la2/oc1 skippen automatisch.
  const inflightActive = USE_INFLIGHT_RESUME && players.length >= INFLIGHT_MIN_PLAYERS;
  const inflightMap = inflightActive ? await loadInflightForRegion(region) : new Map();
  if (inflightActive) {
    console.log(`  [inflight] active — ${inflightMap.size} puuids im Skip-Set (resume mode)`);
  } else if (USE_INFLIGHT_RESUME) {
    console.log(`  [inflight] skipped — region <${INFLIGHT_MIN_PLAYERS} players`);
  }

  const gathered = [];
  let p1 = 0, tooFew = 0, failed = 0, fromInflight = 0;
  let pass1Aborted = false;
  for (const p of players) {
    if (aborting) {
      console.log(`  [signal] Pass 1 stopped at ${p1}/${players.length} (region NOT marked completed, ${gathered.length} usable so far)`);
      pass1Aborted = true;
      break;
    }
    // Inflight-Skip: wenn Spieler im Resume-Set, raw_metrics direkt nutzen
    // (data-skeptic F1: Time-Skew-Bias <0.5% bei 2h-Gap akzeptiert — Inflight
    // ist Zeitpunkt-Freeze, nicht reproduzierbar mit Frisch-Stand. Akzeptable
    // Granularität bei Daily-Snapshots).
    if (inflightMap.has(p.puuid)) {
      gathered.push({ p, raw: inflightMap.get(p.puuid) });
      fromInflight++;
      p1++;
      continue;
    }
    try {
      const startTimeSec = startTimeForPlayer(p);
      const ctx = {
        region, regional,
        setNumber, hotCompKeys, recommendedItems,
        startTimeSec,
        maxIds: MAX_IDS,
        concurrency: MATCH_CONCURRENCY,
        force: false,
        skipCacheRefresh: false,
        verbose: VERBOSE,
      };
      const g = await gatherPlayer(pool, riot, p, ctx);
      p1++;
      if (g.skip) {
        tooFew++;
      } else {
        gathered.push({ p, raw: g.raw });
        // Inflight-Persist nach erfolgreichem Gather. Best-effort — Failure
        // ist non-fatal (Driver läuft ohne Resume für diesen Player weiter).
        await insertInflight(region, setNumber, p.puuid, g.raw);
      }
      if (VERBOSE || p1 % 50 === 0 || p1 === players.length) {
        const dt = ((Date.now() - t0) / 1000).toFixed(0);
        const inflightSuffix = inflightActive ? `, ${fromInflight} resumed` : '';
        console.log(`  [pass1] ${p1}/${players.length} | ${gathered.length} usable, ${tooFew} too-few${inflightSuffix} | ${dt}s`);
      }
    } catch (err) {
      failed++;
      if (VERBOSE) console.error(`  [error] puuid=${p.puuid.slice(0, 8)}…: ${err.message}`);
    }
  }

  if (gathered.length === 0) {
    console.log(`  [done] keine usable Spieler → keine Snapshots geschrieben`);
    return { region, players: players.length, snapshots: 0, failed, backup: backupTbl };
  }

  // 3. Population-Recompute aus aktiver Sub-Kohorte
  //
  // Pop-Determinismus-Pflicht (architect F9): gathered nach puuid sortieren
  // VOR buildCompMeta/buildPopulation. Bei Resume-Mix (Inflight+Frisch) kommt
  // gathered in der Reihenfolge "alle Frisch nach DB-Order, dann übersprungene
  // Inflight in DB-Order" — nicht puuid-sortiert. Single-Run wäre direkt
  // puuid-sortiert (loadIterationTargets ORDER BY puuid). Sort macht Pop
  // bitwise reproduzierbar zwischen den Pfaden.
  gathered.sort((a, b) => a.p.puuid.localeCompare(b.p.puuid));

  let pop;
  let compMetaSize = 0;
  if (POP_BYPASS_REGIONS.has(region)) {
    pop = makeNullPop();
    console.log(`  [pop] ${region} bypassed (n=${gathered.length} zu klein für valide z-Verteilung) — multiplier=1.0`);
  } else {
    const compMeta = buildCompMeta(gathered.map(g => g.raw));
    // applyMeta über GESAMTE gathered-Liste (Inflight + Frisch) — data-skeptic
    // F2: metaRelM wird in-place in raw_metrics geschrieben. Wenn applyMeta
    // nur über Frisch läuft, fehlt metaRelative-z für Inflight-Spieler →
    // unrated-Cascade in Pass 2.
    for (const g of gathered) applyMeta(g.raw, compMeta);
    pop = buildPopulation(gathered.map(g => g.raw));
    compMetaSize = compMeta.size;
    await persistPopulation(pool, region, setNumber, pop, compMeta, gathered.length, {
      supaUrl: SUPA_URL, supaKey: SUPA_KEY,
    });
    console.log(`  [pop] persisted — ${gathered.length} players, ${compMetaSize} comps`);
  }

  // 4. Pass 2: snapshotPlayer pro Spieler
  //
  // Iteriert über die kombinierte gathered-Liste (Inflight + Frisch nach
  // puuid-Sort). Bei Crash zwischen Pass 1 und Pass 2 ist die Liste nicht
  // mehr in-Memory (logic-flow F4) — DAFÜR sorgt aber der Inflight-Resume
  // beim Re-Start: cleanupStaleInflight läuft NICHT auf heutige Rows, der
  // nächste Pass-1-Lauf für die Region findet Inflight-Map = volle Liste,
  // alle Spieler gehen direkt nach gathered (kein Gather nötig), Pop wird
  // neu gebaut, Pass 2 läuft über die volle Liste. Idempotent via
  // UPSERT in tft_player_marketvalue_snapshots.
  let snapshotted = 0, unrated = 0;
  const snapshotCtx = {
    region, regional,
    apiKey: API_KEY,
    snapshotDate: null,  // default = current_date
  };
  for (const g of gathered) {
    try {
      const r = await snapshotPlayer(pool, riot, g.p, g.raw, pop, snapshotCtx);
      if (r.snapshotted) snapshotted++; else unrated++;
    } catch (err) {
      failed++;
      if (VERBOSE) console.error(`  [error] snapshot ${g.p.puuid.slice(0, 8)}…: ${err.message}`);
    }
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(0);
  const inflightSuffix = inflightActive ? `, ${fromInflight} from-inflight` : '';
  const abortedSuffix = pass1Aborted ? ' [ABORTED — region not completed]' : '';
  console.log(`  [done] ${snapshotted} snapshots | ${gathered.length} usable / ${players.length} total | ${tooFew} too-few, ${unrated} unrated, ${failed} failed${inflightSuffix} | ${dt}s${abortedSuffix}`);
  return { region, players: players.length, gathered: gathered.length, snapshots: snapshotted, unrated, failed, backup: backupTbl, fromInflight, aborted: pass1Aborted };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== Daily Marktwert-Snapshot ===`);
  console.log(`    regions: ${REGIONS.join(', ')}`);
  console.log(`    max-ids: ${MAX_IDS} | concurrency: ${MATCH_CONCURRENCY} | limit: ${LIMIT || 'unlimited'}`);
  console.log(`    dry-run: ${DRY_RUN} | skip-backup: ${SKIP_BACKUP} | reset-cursor: ${RESET_CURSOR}`);
  console.log(`    inflight-resume: ${USE_INFLIGHT_RESUME ? 'ON' : 'OFF (default — set MV_USE_INFLIGHT_RESUME=true to enable)'}`);

  // Cursor laden (oder leer wenn neuer UTC-Tag / --reset-cursor)
  const cursor = readCursor();
  const todoRegions = REGIONS.filter(r => !cursor.completed.includes(r));
  if (cursor.completed.length > 0) {
    console.log(`    cursor: ${cursor.completed.length}/${REGIONS.length} schon heute fertig (${cursor.completed.join(',')})`);
    console.log(`    todo: ${todoRegions.join(',')}`);
  } else {
    console.log(`    cursor: ${CURSOR_PATH} (frischer Tag oder reset)`);
  }

  // Inflight-Stale-Cleanup beim Start. Pflicht VOR jeglichen Region-Reads.
  // Architect F3: Cleanup-Condition `day < today OR set_number != current`.
  // Bei --reset-cursor zusätzlich heutige Inflight wipen.
  if (USE_INFLIGHT_RESUME && !DRY_RUN) {
    const currentSet = loadCurrentSet();
    if (currentSet != null) {
      await cleanupStaleInflight(currentSet);
      if (RESET_CURSOR) await clearTodayInflight();
    }
  }

  if (todoRegions.length === 0) {
    console.log(`\n=== Alle Regionen heute schon fertig — No-Op ===`);
    await pool.end().catch(() => {});
    return;
  }

  const t0 = Date.now();
  const results = [];
  try {
    for (const region of todoRegions) {
      if (aborting) {
        console.log(`[${region}] skipped — SIGTERM (cursor: ${cursor.completed.length}/${REGIONS.length} done)`);
        break;
      }
      try {
        const r = await processRegion(region);
        results.push(r);
        // Region als "heute fertig" markieren (auch bei dry-run nicht, weil
        // dort keine echten Snapshots geschrieben wurden — aber dry-run hat
        // sowieso keinen Side-Effect).
        //
        // Region-Done-Reihenfolge (logic-flow F1): Cursor-Write ZUERST,
        // Inflight-Cleanup DANACH. Wenn Cleanup-DELETE crashed bleiben stale
        // Inflight-Rows — werden beim nächsten Driver-Start via
        // cleanupStaleInflight gefangen. Umgekehrt wäre teurer: Cleanup-OK
        // aber Cursor-Crash → 14k Re-Fetches morgen.
        //
        // ABORTED-Pass-1 (logic-flow F3): wenn aborting mid-Pass-1, hat
        // processRegion zwar Pop+Pass-2 für die bisher gather-ten Spieler
        // durchgezogen (Snapshots in DB), aber Region ist NICHT komplett
        // durchlaufen. Region als pending lassen → nächster Lauf resumed
        // via Inflight-Map (alle bisher gather-ten kommen aus Inflight,
        // Riot-Calls nur für Rest).
        if (!DRY_RUN && !r.aborted) {
          cursor.completed.push(region);
          writeCursor(cursor);
          await cleanupRegionInflight(region);
        } else if (r.aborted) {
          console.log(`[${region}] cursor preserved (aborted), inflight retained for resume`);
        }
      } catch (err) {
        // Bei Fatal-Fehler einer Region NICHT als completed markieren →
        // nächster Lauf resumed bei dieser Region.
        console.error(`[${region}] FATAL: ${err.message}`);
        if (VERBOSE) console.error(err.stack);
        results.push({ region, error: err.message });
      }
    }
    // Wenn alle Regionen durch (und nicht aborted): Cursor löschen für sauberen
    // nächsten Tagesstart (statt darauf zu warten dass der UTC-Tag wechselt).
    if (!aborting && !DRY_RUN && cursor.completed.length === REGIONS.length) {
      console.log(`[cursor] alle ${REGIONS.length} Regionen heute fertig — cursor cleared`);
      clearCursor();
    }
  } finally {
    await pool.end().catch(() => {});
  }

  const totalMin = ((Date.now() - t0) / 60_000).toFixed(1);
  console.log(`\n=== Done in ${totalMin} min ===`);
  const tot = results.reduce((s, r) => s + (r.snapshots || 0), 0);
  console.log(`Total snapshots: ${tot} over ${results.length} regions`);
  for (const r of results) {
    if (r.error) console.log(`  ${r.region}: ERROR ${r.error}`);
    else if (r.dryRun) console.log(`  ${r.region}: ${r.players} would-iterate`);
    else console.log(`  ${r.region}: ${r.snapshots || 0} snapshots / ${r.players} players / ${r.failed || 0} failed${r.backup ? ` | backup=${r.backup}` : ''}`);
  }
}

main().catch(err => {
  console.error('FAIL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
