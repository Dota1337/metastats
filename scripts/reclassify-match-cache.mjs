#!/usr/bin/env node
/**
 * Re-klassifiziert comp_cluster_key + carry_unit in tft_player_match_cache mit
 * der unifizierten Klassifikations-Library (scripts/lib/tft-classify-comp.mjs).
 *
 * Hintergrund (2026-06-21): siehe reference_tft_classification_bridge.md.
 * Probe-Ergebnis 1000 rows: delta=794 (79.4%) → erhebliche Drift im Bestand.
 *
 * Modi:
 *  - `--puuids p1,p2,...` (ODER `--puuid-file path`): nur diese puuids
 *    re-klassifizieren. Schnell-Pfad fuer Pro-Player-Cohort (~190 Pros × 500
 *    matches = ~95k rows statt 16M).
 *  - ohne Filter: full-table re-classify ueber alle Set-X-Matches (sehr lang,
 *    Tage-Lauf — fuer Bestands-Bereinigung in Hintergrund-Job).
 *
 * Cursor:
 *  - Filter-Mode: (puuid, match_id)-Cursor nutzt PK-Index
 *  - Full-Mode: match_id-Cursor (Sequential-Scan, langsam)
 *
 * Usage:
 *   PG_URL=postgres://... node scripts/reclassify-match-cache.mjs [opts]
 *
 * Opts:
 *   --set <N>             Set-Number (default: 17)
 *   --batch <N>           Batch-Groesse (default: 1000)
 *   --dry-run             Read-only, kein UPDATE
 *   --puuids p1,p2,...    Komma-Liste von puuids (Filter-Mode)
 *   --puuid-file <path>   Eine puuid pro Zeile (Filter-Mode)
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import pg from 'pg';
import { classifyComp } from './lib/tft-classify-comp.mjs';

const args = process.argv.slice(2);
function argv(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
const SET = Number(argv('--set')) || 17;
const BATCH = Number(argv('--batch')) || 1000;
const DRY = args.includes('--dry-run');
const PUUIDS_INLINE = argv('--puuids');
const PUUID_FILE = argv('--puuid-file');

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

function loadCursor() {
  if (!existsSync(CURSOR_FILE)) return { lastPuuid: '', lastMatchId: '', processed: 0, updated: 0 };
  try { return JSON.parse(readFileSync(CURSOR_FILE, 'utf8')); }
  catch { return { lastPuuid: '', lastMatchId: '', processed: 0, updated: 0 }; }
}
function saveCursor(state) {
  writeFileSync(CURSOR_FILE, JSON.stringify(state, null, 2));
}

async function main() {
  const pool = new pg.Pool({ connectionString: PG_URL, statement_timeout: 60_000 });
  const state = loadCursor();
  const mode = PUUID_FILTER ? `cohort(${PUUID_FILTER.length} puuids)` : 'full-table';
  console.log(`[reclassify] set=${SET} batch=${BATCH} dry=${DRY} mode=${mode}`);
  console.log(`[reclassify] resume-cursor=puuid=${state.lastPuuid || '(none)'} match=${state.lastMatchId || '(none)'}`);
  console.log(`[reclassify] already-processed: ${state.processed}, already-updated: ${state.updated}`);

  let totalDelta = 0;
  let totalSame = 0;
  let totalUpdated = state.updated;
  let totalProcessed = state.processed;

  while (true) {
    let r;
    if (PUUID_FILTER) {
      // Cohort-Mode: (puuid, match_id)-Cursor nutzt PK-Index, dramatisch schneller.
      r = await pool.query(
        `select puuid, match_id, comp_cluster_key, carry_unit, units, traits, augments, level
           from tft_player_match_cache
           where set_number = $1
             and puuid = any($2::text[])
             and (puuid, match_id) > ($3, $4)
           order by puuid, match_id
           limit $5`,
        [SET, PUUID_FILTER, state.lastPuuid, state.lastMatchId, BATCH],
      );
    } else {
      r = await pool.query(
        `select puuid, match_id, comp_cluster_key, carry_unit, units, traits, augments, level
           from tft_player_match_cache
           where set_number = $1 and match_id > $2
           order by match_id
           limit $3`,
        [SET, state.lastMatchId, BATCH],
      );
    }
    if (r.rows.length === 0) break;

    const updates = [];
    for (const row of r.rows) {
      totalProcessed++;
      // Re-build participant shape from persistierter JSONB.
      // Cache-Shape (units): { characterId, tier, items }
      // Aggregator nimmt traits + units + augments + level → classifyCompUnified akzeptiert beide.
      const participant = {
        traits: row.traits || [],
        units: row.units || [],
        augments: row.augments || [],
        level: row.level ?? 0,
      };
      const cls = classifyComp(participant, { currentSet: SET, withAugmentSuffix: false });
      const newKey = cls?.clusterKey ?? null;
      const newCarry = cls?.carryUnit ?? null;

      if (row.comp_cluster_key === newKey && row.carry_unit === newCarry) {
        totalSame++;
      } else {
        totalDelta++;
        updates.push({
          puuid: row.puuid,
          match_id: row.match_id,
          comp_cluster_key: newKey,
          carry_unit: newCarry,
          carry_items: cls?.carryItems ?? [],
        });
      }
    }

    if (!DRY && updates.length > 0) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const u of updates) {
          await client.query(
            `update tft_player_match_cache
               set comp_cluster_key = $1, carry_unit = $2, carry_items = $3::jsonb
             where puuid = $4 and match_id = $5`,
            [u.comp_cluster_key, u.carry_unit, JSON.stringify(u.carry_items), u.puuid, u.match_id],
          );
        }
        await client.query('commit');
        totalUpdated += updates.length;
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    }

    const last = r.rows[r.rows.length - 1];
    state.lastPuuid = last.puuid;
    state.lastMatchId = last.match_id;
    state.processed = totalProcessed;
    state.updated = totalUpdated;
    saveCursor(state);

    console.log(`[reclassify] +${r.rows.length} processed (cursor=${state.lastMatchId.slice(0, 16)}…) — delta=${totalDelta} same=${totalSame} updated=${totalUpdated}`);
  }

  await pool.end();
  console.log(`[reclassify] DONE — processed=${totalProcessed} delta=${totalDelta} same=${totalSame} updated=${totalUpdated} dry=${DRY}`);
}

main().catch(err => { console.error('FAIL:', err); process.exit(1); });
