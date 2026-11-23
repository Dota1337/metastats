#!/usr/bin/env node
/**
 * Sync today's marketvalue snapshots + per-set season stats from the
 * Hetzner Postgres to Supabase. Runs after collect-tft-marketvalues.mjs.
 *
 * Only the aggregated outputs are mirrored — the raw match cache stays on
 * Hetzner. Supabase keeps the same schema it already had so the Vercel API
 * doesn't need any changes.
 *
 * Usage:
 *   node scripts/sync-marketvalue-to-supabase.mjs
 *   node scripts/sync-marketvalue-to-supabase.mjs --date 2026-05-14
 *   node scripts/sync-marketvalue-to-supabase.mjs --region euw1
 *   node scripts/sync-marketvalue-to-supabase.mjs --full   # alles senden, Zustand neu aufbauen
 *
 * Nur Geaendertes (seit 23.11.2026, scripts/lib/mv-sync-diff.mjs): laeuft die
 * Unit mit StateDirectory=metastats-mv-sync, gehen nur neue oder geaenderte
 * Zeilen raus, plus jede Zeile einmal am Tag. Ohne diesen Ordner (Handlauf,
 * Kind von crawl-all-regions.mjs) wird wie bisher alles gesendet. Danach
 * Warteliste + Herzschlag fuer die Peaks (scripts/lib/mv-peaks-pending.mjs).
 * Schalter: MV_SYNC_DIFF=0 in /etc/metastats-crawler/env sendet wieder alles.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { assertContracts } from './lib/contracts.mjs';
import { upsertBatches } from './lib/supabase-upsert.mjs';
import { ownStateDir, readJsonOrNull, writeJsonAtomic } from './lib/state-dir.mjs';
import {
  FP_MAX_AGE_MS, loadState, pruneState, recordSent, rowFingerprint, rowKey, selectChanged, targetId,
} from './lib/mv-sync-diff.mjs';
import { MV_SYNC_STATE_NAME, writeHeartbeat, writePending } from './lib/mv-peaks-pending.mjs';

const args = process.argv.slice(2);
const arg = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };

// --date is the upper-bound day to sync; --window is how many days back to
// include from there. Default 7d catches large regions whose crawl spans
// >24h (euw1/na1/kr/vn2 all routinely take 18-30h, so a "today only" sync
// would silently drop everything from yesterday's pass). --since X is a
// shortcut for --window N where N = today - X.
const DATE = arg('--date', new Date().toISOString().slice(0, 10));
const WINDOW_DAYS = Math.max(1, parseInt(arg('--window', '7'), 10));
const SINCE = arg('--since', null);   // YYYY-MM-DD, sets effective window
const REGION_FILTER = arg('--region', null);
const VERBOSE = args.includes('--verbose');

// Effective sync range: [LOWER_BOUND, DATE]
const LOWER_BOUND = SINCE || new Date(Date.parse(DATE) - WINDOW_DAYS * 86_400_000)
  .toISOString().slice(0, 10);

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

const DATABASE_URL = process.env.DATABASE_URL;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DATABASE_URL || !SUPA_URL || !SUPA_KEY) {
  console.error('Missing DATABASE_URL / SUPABASE_* env vars');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3, statement_timeout: 60_000 });
// Ruhende Verbindungen, die der Server kappt (z. B. DB-Neustart), reissen sonst den Prozess.
pool.on('error', (e) => console.error(`DB-Verbindung verworfen: ${e.message}`));
const BATCH = 200;
// Frist ueber beide Tabellen: die Unit kappt nach TimeoutStartSec=1800. Lieber
// nach 25 min mit "X von Y Paketen" enden als ohne Meldung abgeschossen werden.
const DEADLINE = Date.now() + 25 * 60_000;

const FULL = args.includes('--full');
const STATE_DIR = ownStateDir(MV_SYNC_STATE_NAME);
const DIFF = Boolean(STATE_DIR) && !FULL && process.env.MV_SYNC_DIFF !== '0';
// Aufraeumen nur im Normallauf: mit --region/--date/--since sieht der Lauf nur
// einen Ausschnitt, die uebrigen Eintraege muessen bleiben.
const UNFILTERED = !REGION_FILTER && !args.includes('--date') && !SINCE;
const TARGET = targetId(SUPA_URL);
// Spieler, deren Snapshot-Zeilen neu/geaendert bei Supabase ankamen → Peaks.
const deliveredPlayers = new Set();
const sent = { snapshots: 0, season_stats: 0 };

/**
 * Upsert mit Wiederholung bei Timeout/Netz/5xx (Fehlschlaege 05.–07.10. um
 * 19:15 UTC). Mit Zustandsordner nur neue/geaenderte Zeilen; der Zustand
 * nimmt nur angekommene Pakete auf und wird auch nach "Frist abgelaufen"
 * gespeichert, damit der naechste Lauf nur den Rest schickt.
 */
async function supaUpsert({ label, table, rows, onConflict, keyCols, omit = [], onNew }) {
  if (!STATE_DIR) {
    if (rows.length) {
      await upsertBatches({ url: SUPA_URL, key: SUPA_KEY, table, rows, onConflict, batchSize: BATCH, deadline: DEADLINE });
    }
    sent[label] = rows.length;
    return;
  }
  const path = join(STATE_DIR, `fp-${label}.json`);
  const { state, reason } = loadState(readJsonOrNull(path), TARGET);
  // Ohne Diff (--full, Schalter) gilt jeder Eintrag als abgelaufen: alles raus,
  // der Zustand wird trotzdem neu eingetragen.
  const sel = selectChanged(rows, state, {
    keyOf: (r) => rowKey(r, keyCols),
    fpOf: (r) => rowFingerprint(r, omit),
    maxAgeMs: DIFF ? FP_MAX_AGE_MS : 0,
  });
  const c = sel.counts;
  console.log(`[${label}] ${c.total} im Fenster: ${c.fresh} neu, ${c.changed} geaendert, ${c.expired} taeglich erneut, `
    + `${c.unchanged} unveraendert → ${sel.send.length} senden${DIFF ? '' : ' (alles: --full oder MV_SYNC_DIFF=0)'}${reason ? ` [${reason}]` : ''}`);
  // Leerer Zustand oder Komplett-Senden: Sendezeiten verteilen, sonst liefe
  // alles gleichzeitig ab (siehe recordSent).
  const spreadMs = reason || !DIFF ? FP_MAX_AGE_MS : 0;
  try {
    if (sel.send.length) {
      await upsertBatches({
        url: SUPA_URL, key: SUPA_KEY, table, rows: sel.send, onConflict, batchSize: BATCH, deadline: DEADLINE,
        onBatchDone: ({ from, to }) => {
          recordSent(state, sel.meta.slice(from, to), Date.now(), spreadMs);
          sent[label] += to - from;
          if (onNew) for (let i = from; i < to; i++) if (sel.meta[i][2]) onNew(sel.send[i]);
        },
      });
    }
  } finally {
    const pruned = UNFILTERED ? pruneState(state, sel.seen) : 0;
    const ok = writeJsonAtomic(path, state, (err) => console.warn(`[${label}] Zustand nicht gespeichert: ${err.message}`));
    if (ok && pruned) console.log(`[${label}] ${pruned} alte Eintraege aus dem Zustand entfernt`);
  }
}

async function syncSnapshots() {
  // Range filter so cross-day cluster runs (euw1, na1, kr, vn2 all need
  // 18-30h) actually land in Supabase. Previous behaviour was `= $1` which
  // silently dropped yesterday's snapshots when the cluster sync ran the
  // next morning — that's how euw1 lost 7733 snapshots on 2026-06-06.
  const where = REGION_FILTER
    ? 'where snapshot_date >= $1::date and snapshot_date <= $2::date and region = $3'
    : 'where snapshot_date >= $1::date and snapshot_date <= $2::date';
  const params = REGION_FILTER ? [LOWER_BOUND, DATE, REGION_FILTER] : [LOWER_BOUND, DATE];
  const r = await pool.query(
    // set_number und games_played MUESSEN mit: PostgREST baut die
    // Spaltenliste des Upserts aus den Payload-Keys, eine hier ausgelassene
    // Spalte landet beim INSERT auf ihrem Default (NULL). Genau so sind ab
    // dem Set-18-Start 31.521 Supabase-Zeilen ohne set_number entstanden —
    // die Leser filtern auf CURRENT_SET und fielen deshalb auf die
    // Live-Rechnung mit 30 Spielen zurueck (gemessen 30.08.2026).
    // rated aus demselben Grund: fehlt es, landet eine "nicht bewertet"-Zeile
    // in Supabase mit dem Default true und zeigt Marktwert 0 in jeder Liste.
    `select puuid, region, snapshot_date, set_number, game_name, tag_line, tier, rank, lp,
            ladder_rank, base_value, multiplier::float8, final_value, sample_size,
            damping::float8, agents, games_played, rated
       from tft_player_marketvalue_snapshots
       ${where}`,
    params,
  );
  console.log(`[snapshots] ${r.rows.length} rows for ${LOWER_BOUND}…${DATE}${REGION_FILTER ? ` / ${REGION_FILTER}` : ''}`);
  // Normalize snapshot_date to YYYY-MM-DD string (pg returns Date object)
  const rows = r.rows.map(row => ({
    ...row,
    snapshot_date: row.snapshot_date instanceof Date
      ? row.snapshot_date.toISOString().slice(0, 10)
      : row.snapshot_date,
  }));
  await supaUpsert({
    label: 'snapshots', table: 'tft_player_marketvalue_snapshots', rows,
    onConflict: 'puuid,region,snapshot_date', keyCols: ['puuid', 'region', 'snapshot_date'],
    onNew: (row) => deliveredPlayers.add(row.puuid),
  });
  console.log(`[snapshots] pushed ${sent.snapshots} → Supabase`);
}

async function syncSeasonStats() {
  // Same range expansion as snapshots — a cluster that finishes the next day
  // would otherwise skip yesterday's player rows.
  const where = REGION_FILTER
    ? "where updated_at >= $1::date and region = $2"
    : "where updated_at >= $1::date";
  const params = REGION_FILTER ? [LOWER_BOUND, REGION_FILTER] : [LOWER_BOUND];
  const r = await pool.query(
    `select puuid, region, set_number, sample_size,
            avg_placement::float8, top4_rate::float8, top1_rate::float8,
            bottom4_rate::float8, placement_stddev::float8, best_top4_streak,
            unique_comps, dominant_share::float8, meta_pick_share::float8,
            item_slam_score::float8, first_match_at, last_match_at, updated_at
       from tft_player_season_stats
       ${where}`,
    params,
  );
  console.log(`[season_stats] ${r.rows.length} rows updated since ${LOWER_BOUND}`);
  // updated_at zaehlt nicht zum Fingerabdruck: es steigt bei jeder Neuberechnung
  // auch ohne neue Werte. Auf Supabase liest es niemand (player-stats/route.ts
  // waehlt es nicht); es bedeutet dort kuenftig "zuletzt geaendert".
  await supaUpsert({
    label: 'season_stats', table: 'tft_player_season_stats', rows: r.rows,
    onConflict: 'puuid,region,set_number', keyCols: ['puuid', 'region', 'set_number'], omit: ['updated_at'],
  });
  console.log(`[season_stats] pushed ${sent.season_stats} → Supabase`);
}

async function main() {
  const mode = !STATE_DIR ? 'alles (kein Zustandsordner)' : DIFF ? 'nur Geaendertes' : 'alles (--full oder MV_SYNC_DIFF=0)';
  console.log(`=== Hetzner → Supabase sync (range ${LOWER_BOUND} … ${DATE}, ${mode}) ===`);
  let complete = false;
  try {
    await syncSnapshots();
    if (VERBOSE) console.log('---');
    try {
      await syncSeasonStats();
    } catch (err) {
      // season_stats table might not exist on Supabase yet — non-fatal
      if (/relation .* does not exist/i.test(err.message)) {
        console.warn(`[season_stats] Supabase table missing — skipping (apply migration 0011 first)`);
      } else throw err;
    }
    complete = true;
  } finally {
    // Auch nach einem Abbruch: was angekommen ist, sollen die Peaks sehen.
    // Erst NACH dem Upsert — beide Timer sind Persistent= und koennen nach einem
    // Neustart gleichzeitig starten.
    if (STATE_DIR) {
      const warn = (what) => (err) => console.warn(`[peaks-uebergabe] ${what} nicht geschrieben: ${err.message}`);
      writePending(STATE_DIR, deliveredPlayers, { onError: warn('Warteliste') });
      writeHeartbeat(STATE_DIR, { target: TARGET, complete, sent, players: deliveredPlayers.size }, { onError: warn('Herzschlag') });
      console.log(`[peaks-uebergabe] ${deliveredPlayers.size} Spieler mit neuen/geaenderten Zeilen in die Warteliste`);
    }
  }
  await pool.end();

  // Laufzeit-Vertrag: ist der Spiegel wirklich angekommen? Genau dieser Check
  // hätte den toten Sync ab Ende Juli am ersten Tag sichtbar gemacht, statt
  // ihn zwei Wochen später zufällig aufzudecken.
  await assertContracts(['marketvalue/supabase-mirror', 'marketvalue/sync-parity', 'set-achse/marktwert-snapshots'])
    .catch(err => console.error('[contract] Prüfung fehlgeschlagen:', err.message));
}

main().catch(err => {
  console.error('FAIL:', err.message);
  pool.end().catch(() => {});
  process.exit(1);
});
