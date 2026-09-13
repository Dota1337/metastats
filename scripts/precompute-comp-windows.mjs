#!/usr/bin/env node
/**
 * Rechnet die schweren Comp-Listen vorab und legt sie in
 * tft_comp_list_precomputed ab (Migration 0070, Plan D 2026-09-13).
 *
 * Warum: get_tft_comp_stats_list_v2 braucht fuer Region „alle" x breite
 * Rang-Gruppen bis 21 s. Besucher haben 8 s, der Publisher 20 s — beide
 * bekamen 502. Hier laeuft jede Abfrage direkt an der DB mit eigener
 * 120-s-Grenze, eine nach der anderen, und die Route liest nur noch das
 * fertige Ergebnis.
 *
 * Welche Kombinationen, und welches Tagesfenster, rechnet
 * compPrecomputeJobs() in app/lib/snapshot-matrix.ts — dieselbe Funktion,
 * mit der die Route ihr Fenster bestimmt. Deshalb nie hier nachbauen.
 *
 * Laeuft als ExecStartPre von metastats-snapshot-publisher.service, damit
 * die Snapshots danach die frischen Listen sehen. Ein Fehler hier blockiert
 * den Publisher nicht; die Route rechnet dann live.
 *
 * Aufruf: node scripts/precompute-comp-windows.mjs [--only <patchKey|current>] [--dry-run]
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import {
  compPrecomputeJobs,
  establishedPatches,
  listKey,
  COMP_PRECOMPUTE_MIN_GAMES,
} from '../app/lib/snapshot-matrix.generated.mjs';
import { ACTIVE_REGIONS } from './lib/active-regions.mjs';
import { CURRENT_SET } from './lib/current-set.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

function loadEnv() {
  for (const path of ['/etc/metastats-crawler/env', resolve(process.cwd(), '.env.local')]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.includes('=') || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
    }
    break;
  }
}
loadEnv();

const DB_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('[precompute] weder SUPABASE_DB_URL noch DATABASE_URL gesetzt');
  process.exit(1);
}

// Passwoerter mit Sonderzeichen brechen den URL-Parser von pg.
function encodePasswordInPgUrl(url) {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd < 0) return url;
  const after = url.slice(schemeEnd + 3);
  const atIdx = after.lastIndexOf('@');
  if (atIdx < 0) return url;
  const userinfo = after.slice(0, atIdx);
  const colon = userinfo.indexOf(':');
  if (colon < 0) return url;
  const user = userinfo.slice(0, colon);
  const pass = userinfo.slice(colon + 1);
  let decoded = pass;
  try { decoded = decodeURIComponent(pass); } catch { /* roh lassen */ }
  return `${url.slice(0, schemeEnd + 3)}${user}:${encodeURIComponent(decoded)}@${after.slice(atIdx + 1)}`;
}

const client = new pg.Client({
  connectionString: encodePasswordInPgUrl(DB_URL),
  ssl: { rejectUnauthorized: false },
  statement_timeout: 120_000,
});

async function main() {
  const runStart = new Date();
  await client.connect();
  const { rows: rawPatches } = await client.query(
    'select patch, set_number, first_day::text as first_day, last_day::text as last_day, total_matches from get_tft_available_patches(30)',
  );
  const patches = establishedPatches(rawPatches);
  if (patches.length === 0) {
    console.error('[precompute] keine Patches gefunden — nichts zu tun');
    return 1;
  }
  const latestDay = patches[0].last_day;
  const regionsKey = listKey(ACTIVE_REGIONS);
  let jobs = compPrecomputeJobs({ patches, setNumber: CURRENT_SET, today: runStart });
  if (ONLY) jobs = jobs.filter(j => (ONLY === 'current' ? j.patchKey === '' : j.patchKey === ONLY));
  console.log(`[precompute] set ${CURRENT_SET}, letzter Tag ${latestDay}, ${jobs.length} Abfragen`
    + ` (Patches: ${patches.slice(0, 2).map(p => p.patch).join(', ')})`);
  if (DRY) {
    for (const j of jobs) console.log(`  ${j.patchKey || 'aktuell'} ${j.bucketLabel} p_days=${j.days} ab ${j.dataStart}`);
    return 0;
  }

  let failed = 0;
  for (const j of jobs) {
    const t0 = Date.now();
    try {
      await client.query('begin');
      await client.query(
        `delete from tft_comp_list_precomputed
          where patch_key = $1 and set_number = $2 and regions_key = $3 and buckets_key = $4 and data_start = $5`,
        [j.patchKey, CURRENT_SET, regionsKey, listKey(j.tiers), j.dataStart],
      );
      const r = await client.query(
        `insert into tft_comp_list_precomputed
           (patch_key, set_number, regions_key, buckets_key, data_start, patch_first_day, last_day, min_games, comp_rows, computed_at)
         select $1, $2, $3, $4, $5::date, $6::date, $7::date, $8,
                coalesce((select jsonb_agg(to_jsonb(v))
                            from get_tft_comp_stats_list_v2($9::text[], $10::text[], $11::int, $12::text, $2::int, $8::int) v), '[]'::jsonb),
                now()
         returning jsonb_array_length(comp_rows) as n, pg_column_size(comp_rows) as bytes`,
        [j.patchKey, CURRENT_SET, regionsKey, listKey(j.tiers), j.dataStart, j.patchFirstDay, latestDay,
          COMP_PRECOMPUTE_MIN_GAMES, ACTIVE_REGIONS, [...j.tiers], j.days, j.patchFilter],
      );
      await client.query('commit');
      console.log(`  ✓ ${j.patchKey || 'aktuell'} ${j.bucketLabel} ${j.days}d ab ${j.dataStart}: `
        + `${r.rows[0].n} Comps, ${Math.round(r.rows[0].bytes / 1024)} KB, ${Date.now() - t0} ms`);
    } catch (e) {
      failed++;
      await client.query('rollback').catch(() => {});
      console.error(`  ✗ ${j.patchKey || 'aktuell'} ${j.bucketLabel} ${j.days}d ab ${j.dataStart}: ${e.message}`);
    }
  }

  // Aufraeumen: Eintraege aus frueheren Laeufen, die heute nicht neu gerechnet
  // wurden (anderer Tag, alter Patch, altes Set). Bei Fehlern bleiben die alten
  // stehen — die Route prueft ohnehin den letzten Datentag.
  if (failed === 0 && !ONLY) {
    const del = await client.query('delete from tft_comp_list_precomputed where computed_at < $1', [runStart]);
    console.log(`[precompute] ${del.rowCount} alte Eintraege entfernt`);
  }
  console.log(`[precompute] fertig: ${jobs.length - failed} ok, ${failed} Fehler, ${Math.round((Date.now() - runStart) / 1000)} s`);
  return failed === 0 ? 0 : 1;
}

main()
  .then(code => client.end().finally(() => process.exit(code)))
  .catch(e => {
    console.error('[precompute] abgebrochen:', e.message);
    client.end().finally(() => process.exit(1));
  });
