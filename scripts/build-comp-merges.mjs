#!/usr/bin/env node
// Welche Comp gehoert zu welcher Grund-Comp (Regeln: app/lib/tft-comp-merge.mjs),
// gespeichert in tft_comp_merge (Migration 0109), fest je Patch-Familie: es kommen
// nur Zugaenge dazu, eine gespeicherte Zuordnung aendert sich nicht.
//
// Laeuft als ExecStartPre von metastats-snapshot-publisher.service, damit Vorrat
// und Comp-Listen danach denselben Stand sehen. Ein Fehler blockiert den Publisher
// nicht: die Seite bleibt beim gespeicherten Stand.
//
// Aufruf:
//   node scripts/build-comp-merges.mjs                  # laufende Patch-Familie
//   node scripts/build-comp-merges.mjs --family 18.4    # eine bestimmte
//   node scripts/build-comp-merges.mjs --dry-run        # nur rechnen und ausgeben
//
// Eingabe: Tageszeilen Diamond+ aller Regionen, die letzten Tage der Patch-Familie
// (hoechstens 7), Tag fuer Tag gelesen, damit der Speicher der Box reicht.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { CURRENT_SET } from './lib/current-set.mjs';
import { supabasePgUrl } from './lib/pg-url.mjs';
import { aliasMap, familyOfCluster } from '../app/lib/tft-comp-catalog.mjs';
import { createCatalogStore, patchFamily } from './lib/comp-catalog-store.mjs';
import { addMergeRow, mergePairs, newMergeInput, resolveMerges, MERGE_RULES } from '../app/lib/tft-comp-merge.mjs';

const MAX_DAYS = 7;
// Unter so vielen Spielen im Fenster ist nichts gesichert: die Zuordnung waere fuer
// den ganzen Patch fest (ein normaler Tag hat ~270.000, gemessen 24.–30.10.2026).
const MIN_TOTAL_GAMES = 50_000;
const BUCKETS = ['diamond', 'master', 'grandmaster', 'challenger'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const familyArg = args.includes('--family') ? args[args.indexOf('--family') + 1] : null;

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

function assetsFor(set) {
  const path = resolve(process.cwd(), `public/tft-assets-${set}.json`);
  if (!existsSync(path)) throw new Error(`${path} fehlt`);
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const champs = { ...(raw.champions || {}), ...(raw.active?.champions || {}) };
  const items = { ...(raw.items || {}), ...(raw.active?.items || {}) };
  return {
    costOf: id => champs[id]?.cost,
    isComponent: id => !!items[id]?.tags?.includes('component'),
  };
}

async function main() {
  loadEnvFile('.env.local');
  const set = CURRENT_SET;
  const { costOf, isComponent } = assetsFor(set);
  const client = new pg.Client({
    connectionString: supabasePgUrl(process.env),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();
  try {
    await client.query('SET statement_timeout = 120000');
    const store = createCatalogStore(client);
    const latest = await client.query(
      `select patch from public.tft_daily_crawl_meta where set_number = $1 order by day desc, patch desc limit 1`, [set]);
    const family = familyArg ?? patchFamily(latest.rows[0]?.patch);
    if (!family) { console.log('[comp-merge] keine Patch-Familie, nichts zu tun'); return; }

    const days = (await store.patchDays(set, family)).map(d => d.day);
    const window = [...new Set(days)].sort().slice(-MAX_DAYS);
    if (window.length === 0) { console.log(`[comp-merge] ${family}: keine Tage`); return; }

    const version = await store.latestVersion(set, { family, beforeDay: window[window.length - 1], inclusive: true })
      ?? await store.latestVersion(set, { beforeDay: window[window.length - 1], inclusive: true });
    if (!version) { console.log(`[comp-merge] ${family}: kein Katalog`); return; }
    const lookup = aliasMap(version.catalog);

    const input = newMergeInput();
    let total = 0;
    let unmapped = 0;
    for (const day of window) {
      const r = await client.query(
        `select cluster_key, games, typical_units from public.tft_daily_comp_stats
          where set_number = $1 and day = $2::date and bucket = any($3::text[])`, [set, day, BUCKETS]);
      for (const row of r.rows) {
        const comp = lookup.get(familyOfCluster(row.cluster_key));
        const games = Number(row.games) || 0;
        if (!comp) { unmapped += games; continue; }
        total += games;
        addMergeRow(input, comp, { games, units: row.typical_units || [] }, isComponent);
      }
    }
    console.log(`[comp-merge] ${family} Tage ${window[0]}..${window[window.length - 1]} (${window.length}), Comps ${input.size}, Spiele ${total}, ohne Comp ${unmapped}, Regeln v${MERGE_RULES.version}`);
    if (total < MIN_TOTAL_GAMES) { console.log(`[comp-merge] unter ${MIN_TOTAL_GAMES} Spielen, nichts gespeichert`); return; }

    const fixedRows = await client.query(
      `select from_key as "from", to_key as "to", rule from public.tft_comp_merge where set_number = $1 and patch_family = $2`, [set, family]);
    const added = resolveMerges(mergePairs(input, costOf), input, fixedRows.rows);
    for (const m of added) console.log(`  ${m.rule} ${m.from} (${m.fromGames}) -> ${m.to} (${m.toGames})`);
    console.log(`[comp-merge] gespeichert bisher ${fixedRows.rows.length}, neu ${added.length}${dryRun ? ' (nur Probelauf)' : ''}`);
    if (dryRun || added.length === 0) return;

    await client.query('begin');
    try {
      await client.query("set local lock_timeout = '5s'");
      for (const m of added) {
        await client.query(
          `insert into public.tft_comp_merge (set_number, patch_family, from_key, to_key, rule, from_games, to_games)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict (set_number, patch_family, from_key) do nothing`,
          [set, family, m.from, m.to, m.rule, m.fromGames, m.toGames]);
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch(err => {
  console.error('[comp-merge] Fehler:', err?.message ?? err);
  process.exit(1);
});
