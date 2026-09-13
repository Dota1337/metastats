#!/usr/bin/env node
// Benennt Tageszeilen nach einem B-Patch-Schnitt um (patchCuts in
// public/tft-set.json, geschrieben von scripts/detect-tft-bpatches.mjs).
//
// Riot liefert im Match keinen Patch; der Crawler stempelt jeden Sammeltag mit
// dem Patch aus tft-set.json. Ein Mid-Patch-Balance-Update wird erst erkannt,
// wenn die Notes es melden — die Tage davor tragen dann noch den Basis-Patch.
// Dieses Skript zieht sie nach: patch base → cut.patch fuer day >= from_day.
//
// Idempotent (WHERE patch = base), tageweise in kleinen Stuecken, damit kein
// Statement an das Zeitlimit stoesst. Danach werden die Vorab-Listen des
// Basis-Patches geloescht; Vorab-Rechnung und Publisher laufen separat.
//
//   node scripts/relabel-tft-bpatch.mjs [--dry-run]
//   node scripts/relabel-tft-bpatch.mjs --rollback [--dry-run]

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRY = process.argv.includes('--dry-run');
const ROLLBACK = process.argv.includes('--rollback');

// Alle Tabellen mit (set_number, patch, day). patch steht in jedem
// Primaerschluessel ausser crawl_meta (dort ohne patch) — keine Kollision.
const TABLES = [
  'tft_daily_unit_stats', 'tft_daily_item_stats', 'tft_daily_augment_stats',
  'tft_daily_trait_stats', 'tft_daily_comp_stats', 'tft_daily_comp_pairs',
  'tft_daily_trait_unitcount_stats', 'tft_daily_unit_top_items', 'tft_daily_crawl_meta',
];

function readEnv() {
  const envPath = resolve(__dirname, '..', '.env.local');
  const env = { ...process.env };
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !env[m[1]]) env[m[1]] = m[2];
    }
  }
  return env;
}

// Wie db-exec.mjs: Sonderzeichen im Passwort muessen URL-kodiert sein.
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

async function main() {
  const setMeta = JSON.parse(readFileSync(resolve(__dirname, '..', 'public/tft-set.json'), 'utf8'));
  const cuts = setMeta.patchCuts || [];
  if (!cuts.length) { console.log('Keine patchCuts in tft-set.json — nichts zu tun.'); return; }

  const env = readEnv();
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL fehlt');
  const client = new pg.Client({ connectionString: encodePasswordInPgUrl(env.DATABASE_URL), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const cut of cuts) {
      const from = ROLLBACK ? cut.patch : cut.base;
      const to = ROLLBACK ? cut.base : cut.patch;
      console.log(`Set ${cut.set}: ${from} → ${to}${ROLLBACK ? '' : ` ab ${cut.from_day}`}${DRY ? ' (dry-run)' : ''}`);
      // Beim Rueckweg alle Tage des B-Patches, auf dem Hinweg nur ab from_day.
      const { rows: dayRows } = await client.query(
        `select distinct day::text as day from tft_daily_crawl_meta
          where set_number = $1 and patch = $2 ${ROLLBACK ? '' : 'and day >= $3'} order by 1`,
        ROLLBACK ? [cut.set, from] : [cut.set, from, cut.from_day],
      );
      // crawl_meta kennt nicht zwingend jeden Tag jeder Tabelle: zusaetzlich
      // einen Sammel-Lauf ohne Tagesgrenze pro Tabelle am Ende.
      const where = `set_number = $1 and patch = $2 ${ROLLBACK ? '' : 'and day >= $3'}`;
      const args = ROLLBACK ? [cut.set, from] : [cut.set, from, cut.from_day];
      for (const table of TABLES) {
        if (DRY) {
          const { rows } = await client.query(`select count(*)::int n from ${table} where ${where}`, args);
          console.log(`  ${table}: ${rows[0].n} Zeilen betroffen`);
          continue;
        }
        let total = 0;
        for (const { day } of dayRows) {
          const r = await client.query(
            `update ${table} set patch = $4 where set_number = $1 and patch = $2 and day = $3`, [cut.set, from, day, to]);
          total += r.rowCount;
        }
        // Rest ohne Tagesgrenze (Tage, die crawl_meta nicht kennt) — meist 0.
        const r = await client.query(`update ${table} set patch = $${args.length + 1} where ${where}`, [...args, to]);
        total += r.rowCount;
        console.log(`  ${table}: ${total} Zeilen umbenannt`);
      }
      // Vorab-Listen des alten Patch-Schluessels sind jetzt falsch zugeschnitten.
      if (!DRY) {
        const r = await client.query('delete from tft_comp_list_precomputed where patch_key = $1', [from]);
        console.log(`  tft_comp_list_precomputed: ${r.rowCount} Vorab-Listen fuer ${from} geloescht`);
      }
    }
  } finally {
    await client.end();
  }
  if (!DRY) console.log('Danach: node scripts/precompute-comp-windows.mjs und den Publisher laufen lassen.');
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
