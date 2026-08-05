#!/usr/bin/env node
/**
 * Re-klassifiziert comp_cluster_key + carry_unit + carry_items in
 * tft_player_match_cache mit der unifizierten Klassifikations-Library
 * (scripts/lib/tft-classify-comp.mjs).
 *
 * Hintergrund (2026-06-21): siehe reference_tft_classification_bridge.md.
 *
 * ## Warum der Full-Mode 2026-08-05 neu gebaut wurde
 *
 * Der alte Full-Mode war nicht langsam, er war unausfuehrbar. Gemessen auf der
 * Hetzner-Box:
 *   - `order by match_id` ist NICHT index-gedeckt → jeder Batch sortierte die
 *     halbe Tabelle neu: 114 s fuer 1.000 Zeilen, hochgerechnet ~25 Tage.
 *   - Der Pool lief mit statement_timeout 60 s. Bei 114 s pro Query heisst das:
 *     der Full-Mode ist nie ueber den ersten Batch hinausgekommen. Er war seit
 *     dem ersten Tag tot, nur ohne Fehlermeldung, die das gesagt haette.
 *
 * Der Ersatz ist ein ctid-Range-Cursor: die Tabelle wird physisch in
 * Block-Fenstern gelesen, jedes Fenster ist ein reiner Range-Scan ohne Sort.
 * Gemessen: 909 ms fuer 21.328 Zeilen — Faktor ~2.700 gegenueber vorher.
 *
 * Der Preis, ehrlich benannt: ctid ist eine PHYSISCHE Adresse. Wird eine Zeile
 * aktualisiert, wandert sie ans Tabellenende und damit potenziell hinter den
 * Cursor. Fuer diesen Job ist das unkritisch, weil die Neu-Klassifikation
 * idempotent ist: eine zweimal besuchte Zeile bekommt beim zweiten Mal
 * denselben Wert und zaehlt als `same`. Ein Reclassify, der von seinem eigenen
 * Ergebnis abhinge, duerfte diesen Cursor NICHT benutzen.
 *
 * Weitere Aenderungen im selben Zug:
 *   - Schreiben in EINEM unnest-Update pro Batch statt N Round-Trips.
 *   - VACUUM zwischendrin: jeder Update schreibt eine neue Zeilenversion
 *     (kein HOT, weil comp_cluster_key indiziert ist). Ohne Vacuum waechst die
 *     Tabelle waehrend des Laufs um die Groesse der geaenderten Menge.
 *   - Platten-Wachhund: bricht ab, bevor die Platte volllaeuft, statt
 *     Postgres in den Read-Only-Zustand zu fahren.
 *   - Advisory-Lock: zwei parallele Laeufe wuerden sich gegenseitig die
 *     Zeilen unter dem Cursor wegschreiben.
 *
 * ## Modi
 *  - `--puuids p1,p2,...` (ODER `--puuid-file path`): nur diese puuids.
 *    Schnell-Pfad fuer die Pro-Player-Kohorte (~190 Pros x 500 Matches).
 *    Cursor: (puuid, match_id) — index-gedeckt ueber den PK.
 *  - ohne Filter: Full-Table ueber alle Set-X-Matches. Cursor: ctid-Block.
 *
 * ## Usage
 *   PG_URL=postgres://... node scripts/reclassify-match-cache.mjs [opts]
 *
 * ## Opts
 *   --set <N>             Set-Number (default: aktuelles Set)
 *   --batch <N>           Ziel-Zeilen pro Batch (default: 20000)
 *   --dry-run             Read-only, kein UPDATE, kein VACUUM
 *   --puuids p1,p2,...    Komma-Liste von puuids (Kohorten-Mode)
 *   --puuid-file <path>   Eine puuid pro Zeile (Kohorten-Mode)
 *   --timeout <ms>        statement_timeout (default: 600000)
 *   --vacuum-every <N>    VACUUM nach je N geschriebenen Zeilen (default: 2000000, 0 = aus)
 *   --data-dir <path>     Mountpoint fuer den Platten-Check (default: /var/lib/postgresql)
 *   --min-free-gb <N>     Abbruch unter dieser Freigrenze (default: 8)
 *   --reset-cursor        Cursor-Datei ignorieren und bei 0 anfangen
 */
import { writeFileSync, readFileSync, existsSync, statfsSync } from 'node:fs';
import pg from 'pg';
import { classifyComp } from './lib/tft-classify-comp.mjs';
import { CURRENT_SET } from './lib/current-set.mjs';

const args = process.argv.slice(2);
function argv(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
const SET = Number(argv('--set')) || CURRENT_SET;
const BATCH = Number(argv('--batch')) || 20_000;
const DRY = args.includes('--dry-run');
const RESET_CURSOR = args.includes('--reset-cursor');
const PUUIDS_INLINE = argv('--puuids');
const PUUID_FILE = argv('--puuid-file');
const TIMEOUT_MS = Number(argv('--timeout')) || 600_000;
const VACUUM_EVERY = argv('--vacuum-every') !== null ? Number(argv('--vacuum-every')) : 2_000_000;
const DATA_DIR = argv('--data-dir') || '/var/lib/postgresql';
const MIN_FREE_GB = Number(argv('--min-free-gb')) || 8;

const TABLE = 'tft_player_match_cache';
// Beliebige, aber stabile Zahl — zwei Laeufe mit demselben Wert schliessen
// sich gegenseitig aus. Bei Aenderung verlieren laufende Jobs den Schutz.
const ADVISORY_LOCK_KEY = 782_610_517;

let PUUID_FILTER = null;
if (PUUIDS_INLINE) {
  PUUID_FILTER = PUUIDS_INLINE.split(',').map(s => s.trim()).filter(Boolean);
} else if (PUUID_FILE) {
  PUUID_FILTER = readFileSync(PUUID_FILE, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
}
const CURSOR_FILE = PUUID_FILTER ? '.reclassify-cursor-cohort' : '.reclassify-cursor';

const PG_URL = process.env.PG_URL || process.env.DATABASE_URL;
if (!PG_URL) {
  console.error('FAIL: PG_URL or DATABASE_URL env required (Hetzner-Local-PG)');
  process.exit(1);
}

const EMPTY_CURSOR = { lastPuuid: '', lastMatchId: '', lastBlock: 0, processed: 0, updated: 0 };
function loadCursor() {
  if (RESET_CURSOR || !existsSync(CURSOR_FILE)) return { ...EMPTY_CURSOR };
  try { return { ...EMPTY_CURSOR, ...JSON.parse(readFileSync(CURSOR_FILE, 'utf8')) }; }
  catch { return { ...EMPTY_CURSOR }; }
}
function saveCursor(state) {
  writeFileSync(CURSOR_FILE, JSON.stringify(state, null, 2));
}

/**
 * Freier Plattenplatz in GB, oder null wenn der Pfad nicht existiert (z.B.
 * beim Dry-Run auf der Workstation). null heisst „nicht pruefbar", nicht „ok"
 * — der Aufrufer entscheidet, und beim Dry-Run wird ohnehin nichts
 * geschrieben.
 */
function freeGb(path) {
  try {
    const s = statfsSync(path);
    return (Number(s.bavail) * Number(s.bsize)) / 1024 ** 3;
  } catch { return null; }
}

function assertDiskHeadroom() {
  if (DRY) return;
  const free = freeGb(DATA_DIR);
  if (free === null) {
    console.warn(`[reclassify] WARN: ${DATA_DIR} nicht statfs-bar — Platten-Wachhund inaktiv.`);
    return;
  }
  if (free < MIN_FREE_GB) {
    throw new Error(
      `Platten-Abbruch: nur noch ${free.toFixed(1)} GB frei auf ${DATA_DIR} (Grenze ${MIN_FREE_GB} GB). `
      + 'Erst `vacuum full` oder Platz schaffen, dann mit demselben Cursor weiterlaufen lassen.',
    );
  }
}

/** VACUUM braucht eine eigene Verbindung ohne Transaktion und ohne Timeout. */
async function runVacuum(analyze) {
  if (DRY) return;
  const client = new pg.Client({ connectionString: PG_URL, statement_timeout: 0 });
  await client.connect();
  const t0 = Date.now();
  try {
    await client.query(`vacuum ${analyze ? '(analyze) ' : ''}${TABLE}`);
    console.log(`[reclassify] vacuum${analyze ? ' (analyze)' : ''} fertig in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  } finally {
    await client.end();
  }
}

/** Reklassifiziert eine Batch-Zeilenmenge; liefert die zu schreibenden Updates. */
function classifyRows(rows, counters) {
  const updates = [];
  for (const row of rows) {
    counters.processed++;
    // Participant-Shape aus persistiertem JSONB. Cache-Shape (units):
    // { characterId, tier, items } — classifyComp akzeptiert beide Casings.
    const cls = classifyComp({
      traits: row.traits || [],
      units: row.units || [],
      augments: row.augments || [],
      level: row.level ?? 0,
    }, { currentSet: SET, withAugmentSuffix: false });
    const newKey = cls?.clusterKey ?? null;
    const newCarry = cls?.carryUnit ?? null;

    if (row.comp_cluster_key === newKey && row.carry_unit === newCarry) {
      counters.same++;
    } else {
      counters.delta++;
      updates.push({
        puuid: row.puuid,
        match_id: row.match_id,
        comp_cluster_key: newKey,
        carry_unit: newCarry,
        carry_items: cls?.carryItems ?? [],
      });
    }
  }
  return updates;
}

/**
 * Ein einziger Round-Trip pro Batch statt einer Query je Zeile. Bei 20.000
 * Zeilen und ~0,3 ms Netz-Latenz waren das vorher 6 s reines Warten pro Batch.
 */
async function writeUpdates(client, updates) {
  if (DRY || updates.length === 0) return 0;
  const r = await client.query(
    `update ${TABLE} t
        set comp_cluster_key = u.comp_cluster_key,
            carry_unit       = u.carry_unit,
            carry_items      = u.carry_items
       from (
         select * from unnest(
           $1::text[], $2::text[], $3::text[], $4::text[], $5::jsonb[]
         ) as x(puuid, match_id, comp_cluster_key, carry_unit, carry_items)
       ) u
      where t.puuid = u.puuid and t.match_id = u.match_id`,
    [
      updates.map(u => u.puuid),
      updates.map(u => u.match_id),
      updates.map(u => u.comp_cluster_key),
      updates.map(u => u.carry_unit),
      updates.map(u => JSON.stringify(u.carry_items)),
    ],
  );
  return r.rowCount ?? 0;
}

async function main() {
  const pool = new pg.Pool({ connectionString: PG_URL, statement_timeout: TIMEOUT_MS, max: 2 });
  const state = loadCursor();
  const mode = PUUID_FILTER ? `cohort(${PUUID_FILTER.length} puuids)` : 'full-table';
  console.log(`[reclassify] set=${SET} batch=${BATCH} dry=${DRY} mode=${mode} timeout=${TIMEOUT_MS}ms`);

  // Lock-Client wird fuer die gesamte Laufzeit gehalten — Advisory-Locks
  // haengen an der Session, nicht an der Transaktion.
  const lockClient = await pool.connect();
  const lock = await lockClient.query('select pg_try_advisory_lock($1) as ok', [ADVISORY_LOCK_KEY]);
  if (!lock.rows[0].ok) {
    lockClient.release();
    await pool.end();
    console.error('FAIL: es laeuft bereits ein Reclassify auf dieser DB (advisory lock belegt).');
    process.exit(1);
  }

  // Parallel-Scan bringt hier nichts (Range-Scan ueber wenige Bloecke), kostet
  // aber Worker, die der laufende Crawl braucht.
  const client = await pool.connect();
  await client.query('set max_parallel_workers_per_gather = 0');

  const counters = { processed: state.processed, same: 0, delta: 0 };
  let totalUpdated = state.updated;
  let sinceVacuum = 0;
  const t0 = Date.now();

  try {
    assertDiskHeadroom();

    if (PUUID_FILTER) {
      console.log(`[reclassify] resume: puuid=${state.lastPuuid || '(none)'} match=${state.lastMatchId || '(none)'}`);
      while (true) {
        const r = await client.query(
          `select puuid, match_id, comp_cluster_key, carry_unit, units, traits, augments, level
             from ${TABLE}
            where set_number = $1
              and puuid = any($2::text[])
              and (puuid, match_id) > ($3, $4)
            order by puuid, match_id
            limit $5`,
          [SET, PUUID_FILTER, state.lastPuuid, state.lastMatchId, BATCH],
        );
        if (r.rows.length === 0) break;

        const updates = classifyRows(r.rows, counters);
        totalUpdated += await writeUpdates(client, updates);

        const last = r.rows[r.rows.length - 1];
        state.lastPuuid = last.puuid;
        state.lastMatchId = last.match_id;
        state.processed = counters.processed;
        state.updated = totalUpdated;
        saveCursor(state);
        console.log(`[reclassify] +${r.rows.length} — delta=${counters.delta} same=${counters.same} updated=${totalUpdated}`);
      }
    } else {
      // Block-Fenster so waehlen, dass ein Fenster ~BATCH Zeilen trifft.
      // reltuples/relpages ist eine Schaetzung aus dem letzten ANALYZE — das
      // genuegt, weil ein zu grosses oder zu kleines Fenster nur die
      // Batch-Groesse verschiebt, nie die Korrektheit.
      const stat = await client.query(
        `select greatest(relpages, 1) as relpages, greatest(reltuples, 1) as reltuples,
                pg_relation_size($1::regclass) / current_setting('block_size')::bigint as blocks
           from pg_class where oid = $1::regclass`,
        [TABLE],
      );
      const relpages = Number(stat.rows[0].relpages);
      const reltuples = Number(stat.rows[0].reltuples);
      const totalBlocks = Number(stat.rows[0].blocks);
      const rowsPerBlock = Math.max(1, reltuples / relpages);
      const blockStep = Math.max(1, Math.ceil(BATCH / rowsPerBlock));
      console.log(`[reclassify] full-table: ${totalBlocks} Bloecke, ~${rowsPerBlock.toFixed(1)} Zeilen/Block, Schritt=${blockStep}`);
      console.log(`[reclassify] resume: block=${state.lastBlock}/${totalBlocks}`);

      for (let block = state.lastBlock; block < totalBlocks; block += blockStep) {
        const end = Math.min(block + blockStep, totalBlocks);
        // Der set_number-Filter steht bewusst NACH dem ctid-Range: der Range
        // waehlt die Bloecke, der Filter wirft aus dem gelesenen Fenster die
        // Fremd-Set-Zeilen weg. Umgekehrt gaebe es wieder einen Full-Scan.
        const r = await client.query(
          `select puuid, match_id, comp_cluster_key, carry_unit, units, traits, augments, level
             from ${TABLE}
            where ctid >= $1::tid and ctid < $2::tid
              and set_number = $3`,
          [`(${block},0)`, `(${end},0)`, SET],
        );

        if (r.rows.length > 0) {
          const updates = classifyRows(r.rows, counters);
          const written = await writeUpdates(client, updates);
          totalUpdated += written;
          sinceVacuum += written;
        }

        state.lastBlock = end;
        state.processed = counters.processed;
        state.updated = totalUpdated;
        saveCursor(state);

        const pct = ((end / totalBlocks) * 100).toFixed(2);
        const mins = ((Date.now() - t0) / 60000).toFixed(1);
        console.log(`[reclassify] block ${end}/${totalBlocks} (${pct} %) +${r.rows.length} — delta=${counters.delta} same=${counters.same} updated=${totalUpdated} [${mins} min]`);

        if (VACUUM_EVERY > 0 && sinceVacuum >= VACUUM_EVERY) {
          assertDiskHeadroom();
          await runVacuum(false);
          sinceVacuum = 0;
        }
      }
    }

    // ANALYZE am Ende ist Pflicht, nicht Kosmetik: nach Millionen geaenderter
    // comp_cluster_key-Werte sind die Statistiken fuer genau die Spalte falsch,
    // ueber die alle Aggregat-Queries gruppieren.
    if (!DRY && totalUpdated > 0) await runVacuum(true);
  } finally {
    client.release();
    try { await lockClient.query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]); } catch { /* Verbindung evtl. schon tot */ }
    lockClient.release();
    await pool.end();
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`[reclassify] DONE — processed=${counters.processed} delta=${counters.delta} same=${counters.same} updated=${totalUpdated} dry=${DRY} [${mins} min]`);
}

main().catch(err => { console.error('FAIL:', err); process.exit(1); });
