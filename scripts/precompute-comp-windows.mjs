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
 * Volle Tage (Migration 0095): der Endtag E (letzter Tag, den alle lebenden
 * Regionen geliefert haben) wird hier EINMAL gepinnt, jede Liste unter
 * window_end abgelegt und E per data-end-handoff.mjs an den Publisher derselben
 * Unit weitergereicht. Die Vortags-Generation bleibt beim Aufraeumen stehen:
 * bis der Publisher sein neues Manifest schreibt (~1,5 h), lesen Besucher noch
 * mit dem alten Endtag.
 *
 * Aufruf: node scripts/precompute-comp-windows.mjs [--only <patchKey|current>] [--end <YYYY-MM-DD>] [--dry-run] [--force]
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import {
  compPrecomputeJobs,
  establishedPatches,
  previousPatchOf,
  listKey,
  fullDayComplete,
  addDays,
  COMP_PRECOMPUTE_MIN_GAMES,
  META_PULSE_COMPLETE_LOOKBACK_DAYS,
} from '../app/lib/snapshot-matrix.generated.mjs';
import { ACTIVE_REGIONS } from './lib/active-regions.mjs';
import { CURRENT_SET } from './lib/current-set.mjs';
import { supabasePgUrl } from './lib/pg-url.mjs';
import { isIsoDay, writeDataEndHandoff } from './lib/data-end-handoff.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const onlyIdx = args.indexOf('--only');
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
const endIdx = args.indexOf('--end');
const END_ARG = endIdx >= 0 ? args[endIdx + 1] : null;
if (END_ARG != null && !isIsoDay(END_ARG)) {
  console.error(`[precompute] --end erwartet YYYY-MM-DD, nicht ${END_ARG}`);
  process.exit(2);
}
// --force: laufenden Patch immer neu rechnen, auch wenn er bestaetigt werden koennte
// (z. B. nach einer Reklassifizierung, die keine Spielzahl aendert).
const FORCE = args.includes('--force');
// Erzwungener Neubau beendeter Patches, auch wenn die Spielzahl gleich blieb.
const REBUILD_AFTER_MS = 6 * 24 * 3600 * 1000;

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

// Nur Supabase: auf der Box zeigt DATABASE_URL auf die Hetzner-PG, die die
// Tagestabellen nicht hat. supabasePgUrl prueft den Host und kodiert das Passwort.
let DB_URL;
try {
  DB_URL = supabasePgUrl(process.env);
} catch (err) {
  console.error(`[precompute] ${err.message}`);
  process.exit(1);
}

// Prozesse, die tft_daily_comp_stats schreiben. Laeuft einer davon, darf eine
// Liste weder bestaetigt noch als bestaetigbar markiert werden: der Writer
// schreibt crawl_meta VOR comp_stats (tft-supabase-writer.mjs), der
// Fingerabdruck liefe den Daten also voraus. Ohne /proc (nicht Linux) gilt
// "aktiv" — dann wird wie frueher immer gerechnet.
const WRITER_SCRIPTS = ['collect-tft-allranks', 'import-tft-json-to-supabase', 'relabel-tft-bpatch'];
function statsWriterActive() {
  let pids;
  try { pids = readdirSync('/proc').filter(d => /^\d+$/.test(d)); } catch { return true; }
  for (const pid of pids) {
    let cmd;
    try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { continue; }
    if (WRITER_SCRIPTS.some(w => cmd.includes(w))) return true;
  }
  return false;
}

const client = new pg.Client({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 120_000,
});

// Endtag E wie die Seite (resolveDataEnd fuer den Publisher): letzter Tag,
// den alle lebenden Regionen geliefert haben, ohne Wartezeit — der Lauf
// startet erst nach dem Crawl. null = altes Fenster (Notschalter
// FULL_DAY_WINDOW=0 oder crawl_meta nicht lesbar).
async function pinDataEnd(runStart) {
  if (process.env.FULL_DAY_WINDOW === '0') return null;
  if (END_ARG) return END_ARG;
  const today = runStart.toISOString().slice(0, 10);
  try {
    const { rows } = await client.query(
      `select region, day::text as day, finished_at
         from tft_daily_crawl_meta
        where day >= $1::date and region = any($2::text[])`,
      [addDays(today, -(META_PULSE_COMPLETE_LOOKBACK_DAYS + 2)), ACTIVE_REGIONS],
    );
    const meta = rows.map(r => ({
      region: r.region,
      day: r.day,
      finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    }));
    return fullDayComplete(meta, ACTIVE_REGIONS, runStart.getTime(), 0);
  } catch (e) {
    console.error(`[precompute] crawl_meta nicht lesbar, altes Fenster: ${e.message}`);
    return null;
  }
}

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
  const dataEnd = await pinDataEnd(runStart);
  // Auch bei Teil-Laeufen (nicht bei --dry-run): der Publisher nimmt denselben Tag.
  if (!DRY) writeDataEndHandoff(dataEnd);
  let jobs = compPrecomputeJobs({ patches, setNumber: CURRENT_SET, today: runStart, dataEnd });
  if (ONLY) jobs = jobs.filter(j => (ONLY === 'current' ? j.patchKey === '' : j.patchKey === ONLY));
  // Vorpatch nach derselben Regel wie die Seite (previousPatchOf); ein dabei
  // uebersprungener Kurz-Patch wird nicht vorgerechnet und hier genannt.
  const prevPatch = previousPatchOf(patches, patches[0].patch);
  const prevIdx = prevPatch ? patches.indexOf(prevPatch) : patches.length;
  const skippedPatches = patches.slice(1, prevIdx).map(p => p.patch);
  console.log(`[precompute] set ${CURRENT_SET}, letzter Tag ${latestDay}, Endtag ${dataEnd ?? '— (altes Fenster)'}, ${jobs.length} Abfragen`
    + ` (Patches: ${[patches[0].patch, prevPatch?.patch].filter(Boolean).join(', ')}`
    + `${skippedPatches.length ? `; uebersprungen, zu kurz: ${skippedPatches.join(', ')}` : ''})`);
  if (DRY) {
    for (const j of jobs) console.log(`  ${j.patchKey || 'aktuell'} ${j.bucketLabel} p_days=${j.days} ${j.dataStart}..${j.windowEnd}${j.fullDay ? '' : ' (altes Fenster)'}`);
    return 0;
  }

  // Beendete Patches (alles ausser dem neuesten) bekommen hoechstens noch
  // Nachzuegler-Spiele. Ihre Zeile wird nur neu gerechnet, wenn sich die
  // Spielzahl geaendert hat oder sie aelter als REBUILD_AFTER_MS ist; sonst
  // nur bestaetigt (Migration 0084). Der laufende Patch wird immer gerechnet.
  const matchesByPatch = new Map(patches.map(p => [p.patch, Number(p.total_matches)]));
  const endedPatches = new Set(patches.slice(1).map(p => p.patch));
  // Fingerabdruck fuer den Fall ohne Patchfilter: alle Patches, auch die unter
  // der 100k-Schwelle von establishedPatches — deren Spiele stecken mit drin.
  const allMatches = rawPatches.reduce((n, p) => n + Number(p.total_matches), 0);

  let failed = 0;
  let confirmed = 0;
  for (const j of jobs) {
    const t0 = Date.now();
    const patchMatches = j.patchFilter ? (matchesByPatch.get(j.patchFilter) ?? null) : null;
    try {
      if (j.patchFilter && endedPatches.has(j.patchFilter) && patchMatches != null) {
        const u = await client.query(
          `update tft_comp_list_precomputed
              set last_day = $6::date, computed_at = now()
            where patch_key = $1 and set_number = $2 and regions_key = $3 and buckets_key = $4 and data_start = $5
              and window_end = $10::date
              and patch_matches = $7 and min_games = $8 and built_at > now() - make_interval(secs => $9)`,
          [j.patchKey, CURRENT_SET, regionsKey, listKey(j.tiers), j.dataStart, latestDay,
            patchMatches, COMP_PRECOMPUTE_MIN_GAMES, REBUILD_AFTER_MS / 1000, j.windowEnd],
        );
        if (u.rowCount === 1) {
          confirmed++;
          console.log(`  = ${j.patchKey} ${j.bucketLabel} ${j.days}d ab ${j.dataStart}: unveraendert (${patchMatches} Spiele), bestaetigt`);
          continue;
        }
      }
      // Laufender Patch: Wiederholungslaeufe am selben Tag (Resume, Catchup,
      // manueller Start) bestaetigen nur, wenn seit dem Rechnen nachweislich
      // nichts geschrieben wurde. Jede Bedingung, die nicht sicher erfuellt
      // ist, fuehrt zum Neurechnen wie bisher.
      const ended = Boolean(j.patchFilter && endedPatches.has(j.patchFilter));
      const fingerprint = ended ? patchMatches : (j.patchFilter ? patchMatches : allMatches);
      const writerActive = ended ? false : statsWriterActive();
      if (!ended && !FORCE && !writerActive && fingerprint != null) {
        const u = await client.query(
          `update tft_comp_list_precomputed
              set computed_at = now()
            where patch_key = $1 and set_number = $2 and regions_key = $3 and buckets_key = $4 and data_start = $5
              and window_end = $9::date
              and last_day = $6::date and patch_matches = $7 and min_games = $8
              and built_at > now() - interval '20 hours'
              and built_at > (select max(finished_at) from tft_daily_crawl_meta where set_number = $2) + interval '2 minutes'`,
          [j.patchKey, CURRENT_SET, regionsKey, listKey(j.tiers), j.dataStart, latestDay,
            fingerprint, COMP_PRECOMPUTE_MIN_GAMES, j.windowEnd],
        );
        if (u.rowCount === 1) {
          confirmed++;
          console.log(`  = ${j.patchKey || 'aktuell'} ${j.bucketLabel} ${j.days}d ab ${j.dataStart}: seit dem Rechnen nichts Neues, bestaetigt`);
          continue;
        }
      }
      // Waehrend ein Writer laeuft, gerechnete Zeilen nie bestaetigbar machen.
      const storedMatches = ended ? patchMatches : (writerActive ? null : fingerprint);
      await client.query('begin');
      // Nur genau dieses Fenster ersetzen: die Vortags-Generation (anderes
      // window_end, bei Patch-Fenstern evtl. gleiches data_start) bleibt stehen.
      await client.query(
        `delete from tft_comp_list_precomputed
          where patch_key = $1 and set_number = $2 and regions_key = $3 and buckets_key = $4 and data_start = $5
            and window_end = $6::date`,
        [j.patchKey, CURRENT_SET, regionsKey, listKey(j.tiers), j.dataStart, j.windowEnd],
      );
      // Benannte Argumente: v2 hat vor p_end_day noch p_min_share/p_min_cap.
      // p_end_day null = altes Fenster (bis heute, ohne Obergrenze).
      const r = await client.query(
        `insert into tft_comp_list_precomputed
           (patch_key, set_number, regions_key, buckets_key, data_start, window_end, patch_first_day, last_day, min_games, comp_rows, computed_at, patch_matches, built_at)
         select $1, $2, $3, $4, $5::date, $14::date, $6::date, $7::date, $8,
                coalesce((select jsonb_agg(to_jsonb(v))
                            from get_tft_comp_stats_list_v2(
                                   p_regions => $9::text[], p_buckets => $10::text[], p_days => $11::int,
                                   p_patch => $12::text, p_set => $2::int, p_min_games => $8::int,
                                   p_end_day => $15::date) v), '[]'::jsonb),
                now(), $13::bigint, now()
         returning jsonb_array_length(comp_rows) as n, pg_column_size(comp_rows) as bytes`,
        [j.patchKey, CURRENT_SET, regionsKey, listKey(j.tiers), j.dataStart, j.patchFirstDay, latestDay,
          COMP_PRECOMPUTE_MIN_GAMES, ACTIVE_REGIONS, [...j.tiers], j.days, j.patchFilter, storedMatches,
          j.windowEnd, j.fullDay ? j.windowEnd : null],
      );
      await client.query('commit');
      console.log(`  ✓ ${j.patchKey || 'aktuell'} ${j.bucketLabel} ${j.days}d ${j.dataStart}..${j.windowEnd}: `
        + `${r.rows[0].n} Comps, ${Math.round(r.rows[0].bytes / 1024)} KB, ${Date.now() - t0} ms`);
    } catch (e) {
      failed++;
      await client.query('rollback').catch(() => {});
      console.error(`  ✗ ${j.patchKey || 'aktuell'} ${j.bucketLabel} ${j.days}d ab ${j.dataStart}: ${e.message}`);
    }
  }

  // Aufraeumen: Eintraege aus frueheren Laeufen, die heute nicht neu gerechnet
  // wurden (anderer Tag, alter Patch, altes Set). Bei Fehlern bleiben die alten
  // stehen — die Route prueft ohnehin das Fenster-Ende. Mit Endtag bleibt die
  // Generation E-1 stehen (window_end >= E-1): Besucher lesen bis zum neuen
  // Manifest des Publishers noch mit dem alten Endtag.
  if (failed === 0 && !ONLY) {
    const del = dataEnd
      ? await client.query(
        'delete from tft_comp_list_precomputed where computed_at < $1 and window_end < $2::date',
        [runStart, addDays(dataEnd, -1)],
      )
      : await client.query('delete from tft_comp_list_precomputed where computed_at < $1', [runStart]);
    console.log(`[precompute] ${del.rowCount} alte Eintraege entfernt`);
  }
  console.log(`[precompute] fertig: ${jobs.length - failed - confirmed} gerechnet, ${confirmed} unveraendert bestaetigt, ${failed} Fehler, ${Math.round((Date.now() - runStart) / 1000)} s`);
  return failed === 0 ? 0 : 1;
}

main()
  .then(code => client.end().finally(() => process.exit(code)))
  .catch(e => {
    console.error('[precompute] abgebrochen:', e.message);
    client.end().finally(() => process.exit(1));
  });
