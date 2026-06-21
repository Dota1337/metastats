#!/usr/bin/env node
/**
 * Re-klassifiziert comp_cluster_key + carry_unit in tft_player_match_cache mit
 * der unifizierten Klassifikations-Library (scripts/lib/tft-classify-comp.mjs).
 *
 * Hintergrund (2026-06-21): die alte Cache-Klassifikation (inline in
 * tft-marketvalue.mjs#classifyComp) hatte KEINEN UniqueTrait-Filter und einfache
 * most-items-Carry-Detection. Aggregator hatte UniqueTrait-Filter + Hero-
 * Augment + Cost-Aware-Swap → Pro-Cache-Top war `BlitzcrankUniqueTrait@1_...`
 * (Single-Unit-Fragment), Aggregator-Top war `TFT17_GravesTrait@1_TFT17_Vex`
 * (echte Comp) → Cross-Join 0 Matches.
 *
 * Script:
 *  - Liest tft_player_match_cache rows in Batches (Default 1000)
 *  - Klassifiziert aus persistierter units/traits/augments JSONB neu
 *  - UPDATE comp_cluster_key + carry_unit + carry_items
 *  - Idempotent (wenn nichts ändert: no-op)
 *  - Reentrant via match_id-Cursor (gespeichert in `.reclassify-cursor`)
 *
 * Usage:
 *   PG_URL=postgres://... node scripts/reclassify-match-cache.mjs [--set 17] [--batch 1000] [--dry-run]
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import pg from 'pg';
import { classifyComp } from './lib/tft-classify-comp.mjs';

const args = process.argv.slice(2);
const SET = Number(args[args.indexOf('--set') + 1]) || 17;
const BATCH = Number(args[args.indexOf('--batch') + 1]) || 1000;
const DRY = args.includes('--dry-run');
const CURSOR_FILE = '.reclassify-cursor';

const PG_URL = process.env.PG_URL || process.env.DATABASE_URL;
if (!PG_URL) {
  console.error('FAIL: PG_URL or DATABASE_URL env required (Hetzner-Local-PG)');
  process.exit(1);
}

function loadCursor() {
  if (!existsSync(CURSOR_FILE)) return { lastMatchId: '', processed: 0, updated: 0 };
  try { return JSON.parse(readFileSync(CURSOR_FILE, 'utf8')); }
  catch { return { lastMatchId: '', processed: 0, updated: 0 }; }
}
function saveCursor(state) {
  writeFileSync(CURSOR_FILE, JSON.stringify(state, null, 2));
}

async function main() {
  const pool = new pg.Pool({ connectionString: PG_URL });
  const state = loadCursor();
  console.log(`[reclassify] set=${SET} batch=${BATCH} dry=${DRY} resume-cursor=${state.lastMatchId || '(none)'}`);
  console.log(`[reclassify] already-processed: ${state.processed}, already-updated: ${state.updated}`);

  let totalDelta = 0;
  let totalSame = 0;
  let totalUpdated = state.updated;
  let totalProcessed = state.processed;

  while (true) {
    const r = await pool.query(
      `select puuid, match_id, comp_cluster_key, carry_unit, units, traits, augments, level
         from tft_player_match_cache
         where set_number = $1 and match_id > $2
         order by match_id
         limit $3`,
      [SET, state.lastMatchId, BATCH],
    );
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

    state.lastMatchId = r.rows[r.rows.length - 1].match_id;
    state.processed = totalProcessed;
    state.updated = totalUpdated;
    saveCursor(state);

    console.log(`[reclassify] +${r.rows.length} processed (cursor=${state.lastMatchId.slice(0, 16)}…) — delta=${totalDelta} same=${totalSame} updated=${totalUpdated}`);
  }

  await pool.end();
  console.log(`[reclassify] DONE — processed=${totalProcessed} delta=${totalDelta} same=${totalSame} updated=${totalUpdated} dry=${DRY}`);
}

main().catch(err => { console.error('FAIL:', err); process.exit(1); });
