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
import { fetchD2PlusEntries, splitByActivity } from './lib/tft-league-entries.mjs';
import { assertContracts } from './lib/contracts.mjs';

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
const MAX_IDS_EXPLICIT = process.argv.includes('--max-ids');
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

// Rollback-Schalter: stellt die alte, statische ACTIVE_REGIONS-Reihenfolge her.
const STATIC_REGION_ORDER = args.includes('--static-region-order');

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
// Region-Reihenfolge: älteste Daten zuerst
//
// Bis 2026-08-03 lief der Driver stur die ACTIVE_REGIONS-Reihenfolge ab —
// euw1 (10.878 Spieler, der größte Brocken) also immer zuerst. Da ein
// Vollzyklus über alle 15 Regionen deutlich länger als einen Tag braucht und
// der Cursor jede Nacht zurückgesetzt wird, kamen die hinteren Regionen nie
// an die Reihe: jp1, oc1, sg2, tw2 und vn2 standen am 03.08. auf Marktwerten
// vom 12.06. — 52 Tage alt, bei 20.399 betroffenen Spielern.
//
// Sortierung jetzt: zuerst Regionen, die heute schon angefangen, aber nicht
// abgeschlossen wurden (sonst bliebe deren Teilarbeit liegen — sie gälten am
// nächsten Tag als "frisch" und rutschten wieder ans Ende), danach die mit
// dem ältesten Snapshot. Regionen ganz ohne Snapshots kommen zuerst.
//
// Fällt die Abfrage aus, bleibt es bei der statischen Reihenfolge — eine
// kaputte Sortierung darf den Lauf nicht verhindern.
// ─────────────────────────────────────────────────────────────────────────────
async function orderByStaleness(regions) {
  if (regions.length <= 1 || STATIC_REGION_ORDER) return regions;
  try {
    const { rows } = await pool.query(`
      select region,
             max(snapshot_date)                                        as newest,
             count(*) filter (where snapshot_date = current_date) > 0  as started_today
        from tft_player_marketvalue_snapshots
       where region = any($1::text[])
       group by region
    `, [regions]);

    const info = new Map(rows.map(r => [r.region, r]));
    const rank = (r) => {
      const i = info.get(r);
      if (!i) return { started: 0, newest: 0 };            // nie gecrawlt → ganz nach vorn
      return {
        started: i.started_today ? -1 : 0,                  // angefangen → vor allen anderen
        newest: i.newest ? Date.parse(i.newest) : 0,
      };
    };

    const ordered = [...regions].sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra.started !== rb.started) return ra.started - rb.started;
      return ra.newest - rb.newest;                          // ältester Snapshot zuerst
    });

    const age = (r) => {
      const i = info.get(r);
      if (!i?.newest) return 'nie';
      return `${Math.round((Date.now() - Date.parse(i.newest)) / 86_400_000)}d`;
    };
    console.log(`    Reihenfolge nach Rückstand: ${ordered.map(r => `${r}(${age(r)})`).join(' ')}`);
    return ordered;
  } catch (err) {
    console.error(`    [warn] Staleness-Sortierung fehlgeschlagen (${err.message}) — statische Reihenfolge`);
    return regions;
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

// RIOT-BUDGET, aufgeteilt (2026-08-02). Alle vier Prozesse teilen sich EINEN
// Key-Bucket, hatten aber je 180/10,5s = 86% des Match-Detail-Limits (200/10s).
// Solo schon zu dicht am Rand — gemessen 39 abgefangene 429er im Marktwert-Lauf
// und 16 im Daily-Crawl binnen drei Tagen. Bei Ueberlappung mit der stets
// laufenden refresh-api entsprechend mehr.
//
// Aufteilung: Batch-Prozesse 130, refresh-api 60. Zwei Batch-Prozesse laufen
// nie gleichzeitig (Conflicts=), also ist der reale Worst Case
// 130 + 60 = 190/10,5s = 18,1 req/s gegen 20 req/s Limit.
// Fuer den Marktwert-Lauf unkritisch: durch die Aktivitaetserkennung braucht er
// nur noch einen Bruchteil der Calls.
const riot = createRiotClient({
  shortWindowRequests: 130,
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
  statement_timeout: 60_000, // bound query hangs (Audit H2, 2026-06-28)
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
         puuid, region, tier, rank, lp, ladder_rank, snapshot_date, games_played
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
    // Spielzaehler des letzten Snapshots. NULL heisst "unbekannt" und fuehrt in
    // splitByActivity bewusst zu AKTIV — beim ersten Lauf nach Migration 0051
    // rechnet also alles einmal durch, danach greift die Inkrementalitaet.
    gamesPlayed: row.games_played ?? null,
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

// Wieviele Match-IDs braucht DIESER Spieler? Der fixe Wert war doppelt falsch:
// er wurde bis 2026-08-01 gar nicht durchgereicht (der Cache holte immer 200),
// und selbst korrekt durchgereicht ist eine feste 30 im Nachhol-Fall zu klein —
// bei einer Woche Rueckstand hat ein aktiver Spieler weit mehr Matches, und die
// nicht geholten fehlen DAUERHAFT, weil startTime danach weiterwandert.
// Deshalb: aus dem Rueckstand ableiten. ~25 Ranked-Spiele/Tag ist die Obergrenze
// eines sehr aktiven Spielers; gedeckelt auf 200 (Riots Seitengroesse).
const GAMES_PER_DAY_CEILING = 25;
function maxIdsForPlayer(player) {
  if (MAX_IDS_EXPLICIT) return MAX_IDS;   // CLI-Override gewinnt immer
  const gapMs = Date.now() - player.lastSnapshotDate.getTime();
  const gapDays = Math.max(1, Math.ceil(gapMs / 86_400_000));
  return Math.min(200, Math.max(DEFAULT_MAX_IDS, gapDays * GAMES_PER_DAY_CEILING));
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

  // --- Aktivitaetserkennung -------------------------------------------------
  // Bis 2026-08-02 bekam JEDER dieser Spieler eine eigene Riot-Call-Kette, auch
  // die grosse Mehrheit ohne ein einziges neues Spiel. Die Liga-Eintraege
  // liefern gebuendelt (~30-60 Calls statt ~10.876) pro Spieler wins+losses;
  // bewegt sich die Summe nicht, hat er nicht gespielt.
  //
  // WICHTIG — "nicht gespielt" heisst NICHT "Wert unveraendert": der Multiplier
  // ist populations-relativ, verschiebt sich also mit den anderen. Inaktive
  // ueberspringen waere fachlich falsch. Gespart werden nur die RIOT-Calls;
  // gerechnet wird weiterhin fuer alle (gemessen: 36 ms/Spieler, ~31 min fuer
  // die gesamte Grundgesamtheit — siehe infra/specs/2026-08-02-*.md).
  let entries = new Map();
  {
    // Bewusst AUCH im Dry-Run: der Abruf ist rein lesend (~30-60 Calls) und ist
    // die einzige Moeglichkeit, die Aktivitaets-Aufteilung zu pruefen, ohne
    // einen Snapshot zu schreiben. Ein Dry-Run, der den neuen Pfad ueberspringt,
    // testet nichts.
    try {
      entries = await fetchD2PlusEntries(region, url => riot.fetchJson(url), API_KEY, { log: m => console.log(m) });
    } catch (err) {
      // Kein Abbruch: ohne Eintraege gelten alle als aktiv, der Lauf verhaelt
      // sich exakt wie vor dem Umbau. Teurer, aber korrekt.
      console.error(`  [entries] FEHLER (${err.message}) → alle Spieler gelten als aktiv`);
      entries = new Map();
    }
  }
  const { active, inactive } = splitByActivity(players, entries);
  const inactiveSet = new Set(inactive.map(p => p.puuid));
  // Frische Rang-Daten aus den Liga-Eintraegen uebernehmen. Bisher kamen tier/
  // rank/lp aus dem Snapshot des VORTAGS — der Code nahm bewusst in Kauf, dass
  // sie einen Tag alt sind. Das erklaert vermutlich beobachtete Basiswert-
  // Spruenge. ladder_rank bleibt aus dem Snapshot: den liefern die Eintraege
  // nicht, und er stammt aus dem Daily-Crawler.
  let refreshedRank = 0;
  for (const p of players) {
    const e = entries.get(p.puuid);
    if (!e) continue;
    if (p.tier !== e.tier || p.rank !== e.rank || p.lp !== e.lp) refreshedRank++;
    p.tier = e.tier;
    p.rank = e.rank;
    p.lp = e.lp;
    p.wins = e.wins;
    p.losses = e.losses;
    // Ab hier traegt gamesPlayed den AKTUELLEN Stand — die Aufteilung oben hat
    // den Vortageswert bereits verbraucht. Dieser Wert wird in den Snapshot
    // geschrieben und ist morgen die Vergleichsbasis.
    p.gamesPlayed = e.games;
  }
  console.log(`  [aktiv] ${active.length} gespielt / ${inactive.length} inaktiv`
    + ` | ${refreshedRank} mit frischem Rang`
    + (entries.size === 0 ? ' | KEINE Liga-Eintraege → alle aktiv' : ''));

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
        maxIds: maxIdsForPlayer(p),
        concurrency: MATCH_CONCURRENCY,
        force: false,
        // DER Kern des inkrementellen Umbaus: wer laut Liga-Eintrag nicht
        // gespielt hat, braucht keinen Riot-Abruf. gatherPlayer liest dann nur
        // den Cache und extrahiert die Roh-Metriken — dieselbe Rechnung, ohne
        // die teure Beschaffung.
        skipCacheRefresh: inactiveSet.has(p.puuid),
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

  // Abbruch-Riegel: nach einem SIGTERM mitten in Pass 1 haben wir nur einen
  // WILLKUERLICHEN Ausschnitt der Region — die Spieler, die zufaellig vor dem
  // Signal dran waren. Frueher lief Pass 2 damit trotzdem durch. Die Folge war
  // ein stiller Datenfehler, kein Absturz:
  //
  //   Lauf 1 bricht ab, schreibt Snapshots fuer Teil-Kohorte A und persistiert
  //   eine Population, die NUR aus A gebaut ist. Lauf 2 schliesst genau diese
  //   Spieler aus (snapshot_date < current_date), baut die Population aus dem
  //   Rest B und ueberschreibt sie. Ergebnis: die Multiplier derselben Region
  //   sind gegen zwei verschiedene Bezugsgroessen gerechnet und untereinander
  //   nicht vergleichbar.
  //
  // Der 30%-Floor unten faengt das NICHT: er prueft die Groesse des Samples,
  // nicht ob es vollstaendig ist. Ein Abbruch bei 60% besteht ihn anstandslos.
  //
  // Deshalb: bei Abbruch gar nichts schreiben. Die Gather-Arbeit ist nicht
  // verloren — sie liegt in tft_mv_inflight_raw und der naechste Lauf rechnet
  // ueber die vollstaendige Kohorte. Die Region bleibt unvollstaendig (Cursor
  // nicht auf completed), der Watchdog holt sie nach.
  if (pass1Aborted) {
    const inflightNote = inflightActive
      ? 'Gather-Arbeit liegt in tft_mv_inflight_raw, naechster Lauf setzt fort'
      : 'ACHTUNG: Inflight-Resume ist AUS, die Gather-Arbeit dieser Region ist verloren';
    console.warn(`  [abort] Pass 2 uebersprungen — Teil-Kohorte ${gathered.length}/${players.length}`);
    console.warn(`  [abort] Keine Snapshots, keine Population geschrieben. ${inflightNote}.`);
    return {
      region, players: players.length, gathered: gathered.length,
      snapshots: 0, unrated: 0, failed, backup: backupTbl,
      fromInflight, aborted: true,
    };
  }

  // Sanity-Floor (Audit H3): ein degradiertes Sample (z.B. Riot-429-Storm hat
  // 90% der gathers verworfen) darf die gute Population NICHT via on-conflict-
  // Upsert überschreiben → sonst sind die Marktwerte der ganzen Region für den
  // Tag falsch. Unter 30% der iterierten Spieler: Region überspringen, die
  // bestehende Population/Snapshots (≤1 Tag alt) bleiben erhalten. Der
  // mv-watchdog re-triggert die Region (kein heutiger Snapshot) für einen Retry.
  if (!POP_BYPASS_REGIONS.has(region) && gathered.length < players.length * 0.3) {
    console.error(`  [pop] DEGRADED: nur ${gathered.length}/${players.length} usable (<30%) — Region übersprungen, bestehende Population erhalten`);
    return { region, players: players.length, snapshots: 0, failed, degraded: true, backup: backupTbl };
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
  const maxIdsLabel = MAX_IDS_EXPLICIT
    ? `${MAX_IDS} (CLI-Override)`
    : `adaptiv ${DEFAULT_MAX_IDS}-200 (aus Rueckstand)`;
  console.log(`    max-ids: ${maxIdsLabel} | concurrency: ${MATCH_CONCURRENCY} | limit: ${LIMIT || 'unlimited'}`);
  console.log(`    dry-run: ${DRY_RUN} | skip-backup: ${SKIP_BACKUP} | reset-cursor: ${RESET_CURSOR}`);
  console.log(`    inflight-resume: ${USE_INFLIGHT_RESUME ? 'ON' : 'OFF (default — set MV_USE_INFLIGHT_RESUME=true to enable)'}`);

  // Cursor laden (oder leer wenn neuer UTC-Tag / --reset-cursor)
  const cursor = readCursor();
  const todoRegions = await orderByStaleness(
    REGIONS.filter(r => !cursor.completed.includes(r)),
  );
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

  // Exit non-zero on SUBSTANTIAL region failure (>=50%) so systemd does NOT fire
  // the OnSuccess chain (snapshot-publisher would publish stale/empty marketvalue
  // data). Per-region errors are otherwise swallowed into results → exit 0.
  // Audit M5, 2026-06-28.
  // Laufzeit-Vertrag: hat der Lauf Snapshots ins lokale PG geschrieben?
  // Nicht-fatal — der Exit-Code steuert unten bewusst die OnSuccess-Kette.
  if (!DRY_RUN) {
    await assertContracts(['marketvalue/hetzner-snapshots'])
      .catch(err => console.error('[contract] Prüfung fehlgeschlagen:', err.message));
  }

  if (!DRY_RUN) {
    const errored = results.filter(r => r.error).length;
    if (errored > 0 && errored >= Math.ceil(results.length / 2)) {
      console.error(`[exit 1] ${errored}/${results.length} Regionen mit Fatal-Error — OnSuccess-Kette unterdrückt`);
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error('FAIL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
