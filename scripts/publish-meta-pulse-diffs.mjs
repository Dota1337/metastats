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
// Stuendlich per systemd-Timer (metastats-meta-pulse-diffs.timer). Rechnet nur
// neu, wenn der Blob fehlt, seine Spielzahl/sein letzter Tag nicht mehr zur
// Patch-Liste passt oder er aelter als 12 h ist — sonst kostet ein Lauf eine
// einzige kleine Abfrage.
//
// Env: SUPABASE_DB_URL, BLOB_READ_WRITE_TOKEN, SNAPSHOT_MANIFEST_URL.
// Flags: --dry-run (rechnen, nicht hochladen), --force (alles neu rechnen).
import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';
import { put } from '@vercel/blob';
import { ACTIVE_REGIONS } from './lib/active-regions.mjs';
import {
  establishedPatches,
  metaPulseDiffPath,
  isValidMetaPulseDiff,
  META_PULSE_DIFF_BUCKETS,
  META_PULSE_DIFF_MIN_GAMES,
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
const PATCH_COUNT = 3;
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;

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
  statement_timeout: 120_000,
  query_timeout: 130_000,
  connectionTimeoutMillis: 15_000,
});

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
  const patches = establishedPatches(raw).slice(0, PATCH_COUNT);
  if (patches.length === 0) throw new Error('keine Patches');
  const regions = [...ACTIVE_REGIONS];
  let computed = 0, skipped = 0, failed = 0;

  for (const p of patches) {
    for (const [bucketLabel, buckets] of Object.entries(META_PULSE_DIFF_BUCKETS)) {
      const path = metaPulseDiffPath(p.patch, bucketLabel);
      const want = {
        set: Number(p.set_number), patch: p.patch, lastDay: isoDay(p.last_day),
        totalMatches: Number(p.total_matches), regions, buckets, now: Date.now(),
      };
      if (!FORCE) {
        const old = await existing(path);
        if (isValidMetaPulseDiff(old, want)
          && Number(old.totalMatches) === want.totalMatches
          && Date.now() - Date.parse(old.generatedAt) < REFRESH_AFTER_MS) {
          skipped++;
          continue;
        }
      }
      const t0 = Date.now();
      try {
        // Fenster ab dem ersten Patch-Tag (current_date wie in der Route).
        const { rows } = await pool.query(
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
        log(`${path}: ${rows.length} Comps in ${((Date.now() - t0) / 1000).toFixed(1)} s${DRY_RUN ? ' (dry-run)' : ''}`);
      } catch (e) {
        failed++;
        log(`FEHLER ${path}: ${e.message}`);
      }
    }
  }
  log(`fertig: ${computed} neu, ${skipped} aktuell, ${failed} Fehler (Patches ${patches.map(p => p.patch).join(', ')})`);
  return failed;
}

main()
  .then(async (failed) => { await pool.end(); process.exit(failed > 0 ? 1 : 0); })
  .catch(async (e) => { log(`abgebrochen: ${e.message}`); await pool.end().catch(() => {}); process.exit(1); });
