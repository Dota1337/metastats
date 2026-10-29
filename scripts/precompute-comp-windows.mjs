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
 * Seit 0108 (Plan 2026-10-29) in derselben Schleife und mit demselben Endtag
 * auch die Item-Listen (tft_item_list_precomputed, gleiche Fenster) und fuer
 * die Region-Gruppen West/Asien Comps + Items in den schweren Fenstern
 * (precomputeCovers in snapshot-matrix.ts). Reihenfolge: Comps alle → Items
 * alle → Gruppen, jede Tabelle als zusammenhaengender Block (warmer Cache).
 * Fehler zaehlt jede Tabelle selbst, aufgeraeumt wird je Tabelle. Bremse:
 * Gesamtfrist PRECOMPUTE_BUDGET_MIN (Standard 75) und Abbruch nach 3
 * Zeitueberschreitungen in Folge — der Rest faellt dann auf die Live-Abfrage.
 * Notschalter: PRECOMPUTE_ITEMS=0, PRECOMPUTE_REGION_GROUPS=0.
 *
 * Aufruf: node scripts/precompute-comp-windows.mjs [--only <patchKey|current>] [--kinds comps,items,groups] [--end <YYYY-MM-DD>] [--dry-run] [--force]
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import {
  compPrecomputeJobs,
  precomputeCovers,
  establishedPatches,
  previousPatchOf,
  listKey,
  fullDayComplete,
  addDays,
  COMP_PRECOMPUTE_MIN_GAMES,
  META_PULSE_COMPLETE_LOOKBACK_DAYS,
  PRECOMPUTE_GROUP_TARGETS,
} from '../app/lib/snapshot-matrix.generated.mjs';
import { ACTIVE_REGIONS, ACTIVE_REGIONS_WEST, ACTIVE_REGIONS_ASIA } from './lib/active-regions.mjs';
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
// --kinds: Teil-Lauf von Hand (comps = Comps alle, items = Items alle,
// groups = West/Asien). Ohne Angabe alle drei; Teil-Laeufe raeumen nicht auf.
const kindsIdx = args.indexOf('--kinds');
const KINDS_ARG = kindsIdx >= 0 ? new Set(String(args[kindsIdx + 1] ?? '').split(',').filter(Boolean)) : null;
if (KINDS_ARG && [...KINDS_ARG].some(k => !['comps', 'items', 'groups'].includes(k))) {
  console.error(`[precompute] --kinds erwartet comps,items,groups, nicht ${args[kindsIdx + 1]}`);
  process.exit(2);
}
// Erzwungener Neubau beendeter Patches, auch wenn die Spielzahl gleich blieb.
const REBUILD_AFTER_MS = 6 * 24 * 3600 * 1000;
// Bremse (Lehre 01.10.: wiederholte kalte Abfragen legten die DB lahm).
const BUDGET_MS = (Number(process.env.PRECOMPUTE_BUDGET_MIN) || 75) * 60_000;
const MAX_TIMEOUTS_IN_ROW = 3;

// Je Sorte: Zieltabelle, jsonb-Spalte, Schwelle und die Abfrage, deren Zeilen
// unveraendert abgelegt werden. Parameter wie im INSERT unten ($8 = Schwelle,
// $9 Regionen, $10 Raenge, $11 p_days, $12 Patch, $15 Endtag).
const KINDS = {
  comps: {
    table: 'tft_comp_list_precomputed',
    rowsCol: 'comp_rows',
    minGames: COMP_PRECOMPUTE_MIN_GAMES,
    // Benannte Argumente: v2 hat vor p_end_day noch p_min_share/p_min_cap.
    // p_end_day null = altes Fenster (bis heute, ohne Obergrenze).
    rowsSql: `coalesce((select jsonb_agg(to_jsonb(v))
                          from get_tft_comp_stats_list_v2(
                                 p_regions => $9::text[], p_buckets => $10::text[], p_days => $11::int,
                                 p_patch => $12::text, p_set => $2::int, p_min_games => $8::int,
                                 p_end_day => $15::date) v), '[]'::jsonb)`,
  },
  items: {
    table: 'tft_item_list_precomputed',
    rowsCol: 'item_rows',
    // Die Item-RPC kennt keine Schwelle; 0 haelt precomputedEntryUsable passend.
    minGames: 0,
    rowsSql: `coalesce((select jsonb_agg(to_jsonb(v))
                          from get_tft_item_stats_list(
                                 p_regions => $9::text[], p_buckets => $10::text[], p_days => $11::int,
                                 p_patch => $12::text, p_set => $2::int,
                                 p_end_day => $15::date) v), '[]'::jsonb)`,
  },
};

function isStatementTimeout(e) {
  return e?.code === '57014' || /statement timeout/i.test(String(e?.message ?? ''));
}

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
  connectionTimeoutMillis: 20_000,
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
  const dataEnd = await pinDataEnd(runStart);
  // Auch bei Teil-Laeufen (nicht bei --dry-run): der Publisher nimmt denselben Tag.
  if (!DRY) writeDataEndHandoff(dataEnd);
  const onlyPatch = j => !ONLY || (ONLY === 'current' ? j.patchKey === '' : j.patchKey === ONLY);
  const base = { patches, setNumber: CURRENT_SET, today: runStart, dataEnd };
  const allJobs = compPrecomputeJobs(base).filter(onlyPatch);
  const want = k => !KINDS_ARG || KINDS_ARG.has(k);
  const itemsOn = process.env.PRECOMPUTE_ITEMS !== '0';
  const groupsOn = process.env.PRECOMPUTE_REGION_GROUPS !== '0';
  // Eine Zeile je Abfrage, in Rechen-Reihenfolge: Comps alle, Items alle,
  // dann die Gruppen — je Tabelle zusammenhaengend, damit ihr Cache warm bleibt.
  const work = [];
  if (want('comps')) for (const job of allJobs) work.push({ kind: 'comps', region: 'all', regions: ACTIVE_REGIONS, job });
  if (want('items') && itemsOn) for (const job of allJobs) work.push({ kind: 'items', region: 'all', regions: ACTIVE_REGIONS, job });
  if (want('groups') && groupsOn) {
    const groupRegions = { west: ACTIVE_REGIONS_WEST, asia: ACTIVE_REGIONS_ASIA };
    for (const kind of itemsOn ? ['comps', 'items'] : ['comps']) {
      for (const region of PRECOMPUTE_GROUP_TARGETS.regionLabels) {
        const regions = groupRegions[region];
        if (!regions) throw new Error(`keine Regionsliste fuer Gruppe ${region}`);
        const jobs = compPrecomputeJobs({ ...base, include: c => precomputeCovers({ regionLabel: region, ...c }) })
          .filter(onlyPatch);
        for (const job of jobs) work.push({ kind, region, regions, job });
      }
    }
  }
  // Vorpatch nach derselben Regel wie die Seite (previousPatchOf); ein dabei
  // uebersprungener Kurz-Patch wird nicht vorgerechnet und hier genannt.
  const prevPatch = previousPatchOf(patches, patches[0].patch);
  const prevIdx = prevPatch ? patches.indexOf(prevPatch) : patches.length;
  const skippedPatches = patches.slice(1, prevIdx).map(p => p.patch);
  console.log(`[precompute] set ${CURRENT_SET}, letzter Tag ${latestDay}, Endtag ${dataEnd ?? '— (altes Fenster)'}, ${work.length} Abfragen`
    + ` (Patches: ${[patches[0].patch, prevPatch?.patch].filter(Boolean).join(', ')}`
    + `${skippedPatches.length ? `; uebersprungen, zu kurz: ${skippedPatches.join(', ')}` : ''})`);
  if (DRY) {
    for (const { kind, region, job: j } of work) {
      console.log(`  ${kind} ${region} ${j.patchKey || 'aktuell'} ${j.bucketLabel} ${j.requestedDays}d p_days=${j.days} ${j.dataStart}..${j.windowEnd}${j.fullDay ? '' : ' (altes Fenster)'}`);
    }
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

  // Zaehler je Tabelle: ein Item-Fehler darf das Aufraeumen der Comps nicht blockieren.
  const stats = Object.fromEntries(Object.keys(KINDS).map(k => [k, { computed: 0, confirmed: 0, failed: 0, skipped: 0 }]));
  let timeoutsInRow = 0;
  let stopReason = null;
  for (const { kind, region, regions, job: j } of work) {
    const K = KINDS[kind];
    const st = stats[kind];
    if (!stopReason && Date.now() - runStart.getTime() > BUDGET_MS) stopReason = `Gesamtfrist ${BUDGET_MS / 60_000} min erreicht`;
    if (stopReason) {
      st.skipped++;
      continue;
    }
    const regionsKey = listKey(regions);
    // Comps fuer alle behalten das bisherige Log-Format, alles andere traegt Sorte/Region.
    const tag = `${kind === 'comps' && region === 'all' ? '' : `${kind}/${region} `}${j.patchKey || 'aktuell'} ${j.bucketLabel}`;
    const t0 = Date.now();
    const patchMatches = j.patchFilter ? (matchesByPatch.get(j.patchFilter) ?? null) : null;
    try {
      if (j.patchFilter && endedPatches.has(j.patchFilter) && patchMatches != null) {
        const u = await client.query(
          `update ${K.table}
              set last_day = $6::date, computed_at = now()
            where patch_key = $1 and set_number = $2 and regions_key = $3 and buckets_key = $4 and data_start = $5
              and window_end = $10::date
              and patch_matches = $7 and min_games = $8 and built_at > now() - make_interval(secs => $9)`,
          [j.patchKey, CURRENT_SET, regionsKey, listKey(j.tiers), j.dataStart, latestDay,
            patchMatches, K.minGames, REBUILD_AFTER_MS / 1000, j.windowEnd],
        );
        if (u.rowCount === 1) {
          st.confirmed++;
          timeoutsInRow = 0;
          console.log(`  = ${tag} ${j.days}d ab ${j.dataStart}: unveraendert (${patchMatches} Spiele), bestaetigt`);
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
          `update ${K.table}
              set computed_at = now()
            where patch_key = $1 and set_number = $2 and regions_key = $3 and buckets_key = $4 and data_start = $5
              and window_end = $9::date
              and last_day = $6::date and patch_matches = $7 and min_games = $8
              and built_at > now() - interval '20 hours'
              and built_at > (select max(finished_at) from tft_daily_crawl_meta where set_number = $2) + interval '2 minutes'`,
          [j.patchKey, CURRENT_SET, regionsKey, listKey(j.tiers), j.dataStart, latestDay,
            fingerprint, K.minGames, j.windowEnd],
        );
        if (u.rowCount === 1) {
          st.confirmed++;
          timeoutsInRow = 0;
          console.log(`  = ${tag} ${j.days}d ab ${j.dataStart}: seit dem Rechnen nichts Neues, bestaetigt`);
          continue;
        }
      }
      // Waehrend ein Writer laeuft, gerechnete Zeilen nie bestaetigbar machen.
      const storedMatches = ended ? patchMatches : (writerActive ? null : fingerprint);
      await client.query('begin');
      // Nur genau dieses Fenster ersetzen: die Vortags-Generation (anderes
      // window_end, bei Patch-Fenstern evtl. gleiches data_start) bleibt stehen.
      await client.query(
        `delete from ${K.table}
          where patch_key = $1 and set_number = $2 and regions_key = $3 and buckets_key = $4 and data_start = $5
            and window_end = $6::date`,
        [j.patchKey, CURRENT_SET, regionsKey, listKey(j.tiers), j.dataStart, j.windowEnd],
      );
      const r = await client.query(
        `insert into ${K.table}
           (patch_key, set_number, regions_key, buckets_key, data_start, window_end, patch_first_day, last_day, min_games, ${K.rowsCol}, computed_at, patch_matches, built_at)
         select $1, $2, $3, $4, $5::date, $14::date, $6::date, $7::date, $8,
                ${K.rowsSql},
                now(), $13::bigint, now()
         returning jsonb_array_length(${K.rowsCol}) as n, pg_column_size(${K.rowsCol}) as bytes`,
        [j.patchKey, CURRENT_SET, regionsKey, listKey(j.tiers), j.dataStart, j.patchFirstDay, latestDay,
          K.minGames, regions, [...j.tiers], j.days, j.patchFilter, storedMatches,
          j.windowEnd, j.fullDay ? j.windowEnd : null],
      );
      await client.query('commit');
      st.computed++;
      timeoutsInRow = 0;
      console.log(`  ✓ ${tag} ${j.days}d ${j.dataStart}..${j.windowEnd}: `
        + `${r.rows[0].n} ${kind === 'items' ? 'Items' : 'Comps'}, ${Math.round(r.rows[0].bytes / 1024)} KB, ${Date.now() - t0} ms`);
    } catch (e) {
      st.failed++;
      await client.query('rollback').catch(() => {});
      console.error(`  ✗ ${tag} ${j.days}d ab ${j.dataStart}: ${e.message}`);
      if (!isStatementTimeout(e)) timeoutsInRow = 0;
      else if (++timeoutsInRow >= MAX_TIMEOUTS_IN_ROW) stopReason = `${MAX_TIMEOUTS_IN_ROW} Zeitueberschreitungen in Folge`;
    }
  }
  const total = key => Object.values(stats).reduce((n, s) => n + s[key], 0);
  if (stopReason) {
    console.error(`[precompute] Bremse: ${stopReason} — ${total('skipped')} Abfragen uebersprungen, die Route rechnet sie live`);
  }

  // Aufraeumen je Tabelle: Eintraege aus frueheren Laeufen, die heute nicht neu
  // gerechnet wurden (anderer Tag, alter Patch, altes Set). Nur wenn diese
  // Tabelle heute vollstaendig ist — bei Fehlern oder Bremse bleiben die alten
  // stehen, die Route prueft ohnehin das Fenster-Ende. Mit Endtag bleibt die
  // Generation E-1 stehen (window_end >= E-1): Besucher lesen bis zum neuen
  // Manifest des Publishers noch mit dem alten Endtag. Teil-Laeufe und
  // abgeschaltete Sorten raeumen nicht auf.
  for (const [kind, K] of Object.entries(KINDS)) {
    const st = stats[kind];
    if (ONLY || KINDS_ARG || st.failed > 0 || st.skipped > 0) continue;
    if (kind === 'items' && !itemsOn) continue;
    const del = dataEnd
      ? await client.query(
        `delete from ${K.table} where computed_at < $1 and window_end < $2::date`,
        [runStart, addDays(dataEnd, -1)],
      )
      : await client.query(`delete from ${K.table} where computed_at < $1`, [runStart]);
    console.log(`[precompute] ${kind}: ${del.rowCount} alte Eintraege entfernt`);
  }
  for (const [kind, st] of Object.entries(stats)) {
    console.log(`[precompute] ${kind}: ${st.computed} gerechnet, ${st.confirmed} bestaetigt, ${st.failed} Fehler, ${st.skipped} uebersprungen`);
  }
  console.log(`[precompute] fertig: ${total('computed')} gerechnet, ${total('confirmed')} unveraendert bestaetigt, ${total('failed')} Fehler, ${Math.round((Date.now() - runStart) / 1000)} s`);
  return total('failed') === 0 && total('skipped') === 0 ? 0 : 1;
}

main()
  .then(code => client.end().finally(() => process.exit(code)))
  .catch(e => {
    console.error('[precompute] abgebrochen:', e.message);
    client.end().finally(() => process.exit(1));
  });
