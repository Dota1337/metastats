#!/usr/bin/env node
// Baut den Comp-Katalog je Patch aus den klassischen Tageszeilen und speichert
// ihn in Supabase (tft_comp_catalog + tft_comp_catalog_entry, Migration 0099).
// Regeln: app/lib/tft-comp-catalog.mjs. Die Seite legt mit dem Katalog die
// klassischen Familien (`<trait>__<carry>`) auf die neuen Comps um.
//
// Aufruf:
//   node scripts/build-comp-catalog.mjs --patch 18.4            # einen Patch
//   node scripts/build-comp-catalog.mjs --all                   # alle Patches des Sets, aelteste zuerst
//   … --set 18 --replace                                        # vorhandenen Katalog ersetzen
//   … --dry-run                                                 # nur rechnen und ausgeben
//
// Namen: jeder Patch uebernimmt die Namen des Vorpatches, wenn die Kerne zu
// mindestens 70 % gleich sind (carryNames) — sonst zerfiele dieselbe Comp in
// einem Fenster ueber die Patch-Grenze in zwei Zeilen.
// Ohne --replace bleibt ein vorhandener Katalog unveraendert (ON CONFLICT DO
// NOTHING): die Seite und der Vorrat duerfen nicht still umspringen.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { CURRENT_SET } from './lib/current-set.mjs';
import { supabasePgUrl } from './lib/pg-url.mjs';
import { buildCatalog, catalogHash, aliasMap, CATALOG_RULES } from '../app/lib/tft-comp-catalog.mjs';
import { createCatalogStore, unitCheckForSet } from './lib/comp-catalog-store.mjs';

const args = process.argv.slice(2);
const argOf = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const SET = Number(argOf('--set') || CURRENT_SET);
const ONE_PATCH = argOf('--patch');
const ALL = args.includes('--all');
const REPLACE = args.includes('--replace');
const DRY = args.includes('--dry-run');

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

// Patches aus crawl_meta (nach der Umbenennung), aelteste zuerst.
async function patchesOf(client, set) {
  const r = await client.query(
    `select patch, min(day)::text as first_day, max(day)::text as last_day
       from public.tft_daily_crawl_meta where set_number = $1 group by patch order by min(day)`, [set]);
  return r.rows;
}

// Eingabe wie der Tagestreiber (get_tft_comp_classic_input, 0101): Schatten-
// zaehlung, fuer Tage ohne Schatten und ohne Marker die klassischen Zeilen.
async function classicFamilies(client, set, p) {
  const { families } = await createCatalogStore(client).loadFamilies(set, [p.patch], p.first_day, p.last_day);
  return families;
}

async function loadCatalog(client, set, patch) {
  const r = await client.query('select comps from public.get_tft_comp_catalogs($1, $2)', [set, [patch]]);
  const comps = r.rows[0]?.comps;
  return comps ? { version: CATALOG_RULES.version, comps } : null;
}

async function storeCatalog(client, { set, patch, catalog, families, from, to }) {
  const hash = catalogHash(catalog);
  await client.query('begin');
  try {
    await client.query("set local lock_timeout = '5s'");
    if (REPLACE) {
      await client.query(`delete from public.tft_comp_catalog where set_number = $1 and scope = 'patch' and scope_key = $2`, [set, patch]);
    }
    const head = await client.query(
      `insert into public.tft_comp_catalog (set_number, scope, scope_key, patch, rules_version, hash, input_from, input_to, families)
       values ($1, 'patch', $2, $2, $3, $4, $5, $6, $7)
       on conflict (set_number, scope, scope_key) do nothing
       returning catalog_id`,
      [set, patch, catalog.version, hash, from, to, families]);
    const id = head.rows[0]?.catalog_id;
    if (!id) {
      await client.query('rollback');
      return { stored: false, hash };
    }
    for (const c of catalog.comps) {
      await client.query(
        `insert into public.tft_comp_catalog_entry (catalog_id, comp_key, core, reroll, carries, target_level, members, adopted, games)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, c.key, c.core, c.reroll, c.carries, c.targetLevel, c.members, c.adopted, c.games]);
    }
    await client.query('commit');
    return { stored: true, hash, id };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  }
}

async function main() {
  if (!ONE_PATCH && !ALL) {
    console.error('[comp-catalog] --patch <P> oder --all angeben');
    process.exit(2);
  }
  loadEnv();
  const client = new pg.Client({ connectionString: supabasePgUrl(process.env), ssl: { rejectUnauthorized: false }, statement_timeout: 240_000 });
  await client.connect();
  try {
    const isUnit = unitCheckForSet(SET);
    const all = await patchesOf(client, SET);
    const todo = ALL ? all : all.filter(p => p.patch === ONE_PATCH);
    if (todo.length === 0) throw new Error(`Patch ${ONE_PATCH} hat in Set ${SET} keine Tageszeilen`);
    // Im selben Lauf gebauter Vorpatch zuerst (bei --dry-run steht er nicht in der Datenbank).
    let lastBuilt = null;
    for (const p of todo) {
      const idx = all.findIndex(x => x.patch === p.patch);
      const prevPatch = idx > 0 ? all[idx - 1].patch : null;
      const names = !prevPatch ? null
        : lastBuilt?.patch === prevPatch ? lastBuilt.catalog : await loadCatalog(client, SET, prevPatch);
      const t0 = Date.now();
      const families = await classicFamilies(client, SET, p);
      const catalog = buildCatalog(families, { isUnit, names });
      lastBuilt = { patch: p.patch, catalog };
      const am = aliasMap(catalog);
      const games = families.reduce((s, f) => s + f.games, 0);
      const mapped = families.filter(f => am.has(f.fam)).reduce((s, f) => s + f.games, 0);
      const adopted = catalog.comps.reduce((s, c) => s + c.adopted.length, 0);
      const prevKeys = new Set((names?.comps || []).map(c => c.key));
      const renamed = catalog.comps.filter(c => prevKeys.has(c.key)).length;
      console.log(`[comp-catalog] ${SET}/${p.patch} (${p.first_day}–${p.last_day}): ${families.length} Familien, ${catalog.comps.length} Comps,`
        + ` ${adopted} fest zugeordnet, ${renamed} Namen wie im Vorpatch${prevPatch ? ` ${prevPatch}` : ''};`
        + ` ${(mapped / Math.max(1, games) * 100).toFixed(1)} % der Spiele mit Comp (${Date.now() - t0} ms)`);
      if (DRY) continue;
      const res = await storeCatalog(client, { set: SET, patch: p.patch, catalog, families: families.length, from: p.first_day, to: p.last_day });
      console.log(res.stored
        ? `[comp-catalog]   gespeichert als ${res.id}, Pruefsumme ${res.hash}`
        : `[comp-catalog]   schon vorhanden, unveraendert (--replace zum Ersetzen)`);
    }
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(`[comp-catalog] ${err.message}`);
  process.exit(1);
});
