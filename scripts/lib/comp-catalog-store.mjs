// Comp-Katalog: Lesen und Schreiben in Supabase (Postgres) fuer den
// Tagestreiber und scripts/build-comp-catalog.mjs. Reine IO-Schicht — was an
// welchem Tag gebaut wird, entscheidet scripts/lib/comp-catalog-day.mjs.
//
// Versionen (0099/0101): scope 'day' = gueltig ab Tag `day`, scope_key
// `<Patch-Familie>:<Tag>`, patch = Patch-Familie (18.5b → 18.5); nie ersetzt
// oder geloescht. scope 'patch' = von Hand gebaute Patch-Kataloge (bis 18.4).

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOG_RULES, catalogHash, familyOfCluster } from '../../app/lib/tft-comp-catalog.mjs';

/** Patch-Familie: B-Patch gehoert zum Grund-Patch (18.5b → 18.5). */
export const patchFamily = patch => String(patch || '').replace(/[a-z]$/, '');

/** scope_key einer Tages-Version. */
export const dayScopeKey = (family, day) => `${family}:${day}`;

// Pflanzen (Elderwood) und Beschwoerungen haben Kosten 0 und sind keine Units.
export function unitCheckForSet(set, cwd = process.cwd()) {
  const path = resolve(cwd, `public/tft-assets-${set}.json`);
  if (!existsSync(path)) throw new Error(`${path} fehlt`);
  const champs = JSON.parse(readFileSync(path, 'utf8')).champions || {};
  const re = /^(?:TFT\d+|Set\d+|DA)_(?:\d+_)?[A-Z]/;
  return id => re.test(id) && (champs[id]?.cost ?? 0) > 0;
}

/** Zeilen von get_tft_comp_classic_input zu klassischen Familien zusammenlegen. */
export function familiesFromInputRows(rows) {
  const fams = new Map();
  for (const row of rows) {
    const fam = familyOfCluster(row.key);
    const e = fams.get(fam) ?? { fam, games: 0, sumPlacement: 0, units: {}, top4ByLevel: {} };
    e.games += Number(row.games) || 0;
    e.sumPlacement += Number(row.sum_placement) || 0;
    for (const [id, v] of Object.entries(row.units || {})) {
      const x = e.units[id] ?? { g: 0, s3: 0 };
      x.g += Number(v?.[0]) || 0;
      x.s3 += Number(v?.[1]) || 0;
      e.units[id] = x;
    }
    for (const [lvl, n] of Object.entries(row.top4_by_level || {})) {
      e.top4ByLevel[lvl] = (e.top4ByLevel[lvl] || 0) + (Number(n) || 0);
    }
    fams.set(fam, e);
  }
  return [...fams.values()];
}

const COMP_COLS = `comp_key as key, core, reroll, carries, target_level as "targetLevel", members, adopted, games`;

/**
 * @param {import('pg').Client} client
 */
export function createCatalogStore(client) {
  async function compsOf(catalogId) {
    const r = await client.query(`select ${COMP_COLS} from public.tft_comp_catalog_entry where catalog_id = $1`, [catalogId]);
    return r.rows.map(c => ({ ...c, games: Number(c.games) || 0 }));
  }
  async function withComps(head) {
    if (!head) return null;
    const catalog = { version: head.rules_version, comps: await compsOf(head.catalog_id) };
    return { catalogId: Number(head.catalog_id), hash: head.hash, day: head.day, patch: head.patch, scope: head.scope, catalog };
  }
  const HEAD = `catalog_id, hash, rules_version, patch, scope, day::text as day`;

  return {
    /** Tage (mit Patch-Label) der Patch-Familie laut crawl_meta, aufsteigend. */
    async patchDays(set, family) {
      const r = await client.query(
        `select distinct day::text as day, patch from public.tft_daily_crawl_meta
          where set_number = $1 and regexp_replace(patch, '[a-z]$', '') = $2 order by 1, 2`, [set, family]);
      return r.rows;
    },
    /** Patch-Label eines Tages laut crawl_meta (nach der Umbenennung), sonst null. */
    async dayPatch(set, day) {
      const r = await client.query(
        `select patch from public.tft_daily_crawl_meta where set_number = $1 and day = $2::date
          group by patch order by count(*) desc, patch limit 1`, [set, day]);
      return r.rows[0]?.patch ?? null;
    },
    /** Gibt es im Set schon einen Tag nach `day`? (dann ist `day` ein Nachholtag) */
    async hasLaterDay(set, day) {
      const r = await client.query(
        `select exists(select 1 from public.tft_daily_crawl_meta where set_number = $1 and day > $2::date) as x`, [set, day]);
      return r.rows[0]?.x === true;
    },
    /** Klassische Familien der Patches im Fenster (Schatten bevorzugt, 0101). */
    async loadFamilies(set, patches, start, end) {
      const rows = [];
      for (const p of patches) {
        const r = await client.query('select * from public.get_tft_comp_classic_input($1, $2, $3::date, $4::date)', [set, p, start, end]);
        rows.push(...r.rows);
      }
      const families = familiesFromInputRows(rows);
      return { families, totalGames: families.reduce((s, f) => s + f.games, 0) };
    },
    /** Tages-Version der Familie fuer genau diesen Tag. */
    async version(set, family, day) {
      const r = await client.query(
        `select ${HEAD} from public.tft_comp_catalog where set_number = $1 and scope = 'day' and scope_key = $2`,
        [set, dayScopeKey(family, day)]);
      return withComps(r.rows[0]);
    },
    async versionById(catalogId) {
      const r = await client.query(`select ${HEAD} from public.tft_comp_catalog where catalog_id = $1`, [catalogId]);
      return withComps(r.rows[0]);
    },
    /**
     * Neueste Version vor `beforeDay` (exklusiv; `inclusive` → bis einschliesslich).
     * Mit `family`: nur diese Patch-Familie (Tages-Versionen, sonst ihr
     * Patch-Katalog). Ohne: neueste des Sets (Namen fuer einen neuen Patch).
     */
    async latestVersion(set, { family = null, beforeDay, inclusive = false }) {
      const op = inclusive ? '<=' : '<';
      const r = await client.query(
        `select ${HEAD} from public.tft_comp_catalog
          where set_number = $1 and ($2::text is null or patch = $2)
            and ((scope = 'day' and day ${op} $3::date) or (scope = 'patch' and coalesce(input_to, $3::date) ${op} $3::date))
          order by coalesce(day, input_to) desc nulls last, (scope = 'day') desc, built_at desc, catalog_id desc
          limit 1`, [set, family, beforeDay]);
      return withComps(r.rows[0]);
    },
    /**
     * Tages-Version speichern; steht fuer (Set, Familie, Tag) schon eine, bleibt
     * sie und wird zurueckgegeben (ON CONFLICT DO NOTHING, nie ersetzt).
     */
    async insertVersion({ set, family, day, catalog, inputFrom, inputTo, families }) {
      const hash = catalogHash(catalog);
      await client.query('begin');
      try {
        await client.query("set local lock_timeout = '5s'");
        const head = await client.query(
          `insert into public.tft_comp_catalog (set_number, scope, scope_key, patch, day, rules_version, hash, input_from, input_to, families)
           values ($1, 'day', $2, $3, $4::date, $5, $6, $7::date, $8::date, $9)
           on conflict (set_number, scope, scope_key) do nothing
           returning catalog_id`,
          [set, dayScopeKey(family, day), family, day, catalog.version ?? CATALOG_RULES.version, hash, inputFrom, inputTo, families]);
        const id = head.rows[0]?.catalog_id;
        if (!id) {
          await client.query('rollback');
          return { ...(await this.version(set, family, day)), stored: false };
        }
        for (const c of catalog.comps) {
          await client.query(
            `insert into public.tft_comp_catalog_entry (catalog_id, comp_key, core, reroll, carries, target_level, members, adopted, games)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [id, c.key, c.core, c.reroll, c.carries, c.targetLevel, c.members, c.adopted || [], c.games]);
        }
        await client.query('commit');
        return { catalogId: Number(id), hash, day, patch: family, scope: 'day', catalog, stored: true };
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      }
    },
  };
}
