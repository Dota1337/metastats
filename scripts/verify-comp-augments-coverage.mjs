#!/usr/bin/env node
/**
 * Comp-Augments-Coverage-Check (manual, DB-Hit). Pulls the Top-N comp
 * families from `tft_daily_comp_stats` and reports which have an editorial
 * slug-map entry in `public/tft-comp-slug-map-{set}.json` and which don't.
 *
 * Why manual (not pre-push):
 *   - Needs DATABASE_URL (pre-push wants 0 network IO)
 *   - Coverage drifts daily as the meta shifts — pre-push would spam noise
 *
 * Run before pushing a new patch's curated slug-map to confirm we've
 * mapped the top-volume families:
 *   node scripts/verify-comp-augments-coverage.mjs [topN=50] [days=7]
 *
 * Output: per-family status (✓ / ✗) + summary + ranked missing-families
 * list so you know what to add to the slug-map next.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readEnv() {
  const envPath = resolve(__dirname, '..', '.env.local');
  if (!existsSync(envPath)) return {};
  const env = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function encodePasswordInPgUrl(url) {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd < 0) return url;
  const after = url.slice(schemeEnd + 3);
  const atIdx = after.lastIndexOf('@');
  if (atIdx < 0) return url;
  const userinfo = after.slice(0, atIdx);
  const rest = after.slice(atIdx);
  const colonIdx = userinfo.indexOf(':');
  if (colonIdx < 0) return url;
  const user = userinfo.slice(0, colonIdx);
  const pwd = userinfo.slice(colonIdx + 1);
  return url.slice(0, schemeEnd + 3) + user + ':' + encodeURIComponent(pwd) + rest;
}

const env = readEnv();
const DATABASE_URL = env.DATABASE_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('FAIL: DATABASE_URL missing (set in .env.local or env)');
  process.exit(1);
}

const args = process.argv.slice(2);
const topN = Math.max(10, Math.min(200, parseInt(args[0] || '50', 10)));
const days = Math.max(1, Math.min(30, parseInt(args[1] || '7', 10)));

const bundle = JSON.parse(readFileSync(resolve(__dirname, '..', 'public', 'tft-assets.json'), 'utf8'));
const set = bundle.set;
const slugMapPath = resolve(__dirname, '..', 'public', `tft-comp-slug-map-${set}.json`);
if (!existsSync(slugMapPath)) {
  console.error(`FAIL: ${slugMapPath} missing — initial editorial map needed`);
  process.exit(1);
}
const slugMap = JSON.parse(readFileSync(slugMapPath, 'utf8'));
const augsPath = resolve(__dirname, '..', 'public', `tft-comp-augments-${set}.json`);
const compAugs = existsSync(augsPath) ? JSON.parse(readFileSync(augsPath, 'utf8')) : null;

function parseFamily(family) {
  const m = /^(.+)@(\d+)_(.+)$/.exec(family);
  if (!m) return null;
  return { trait: m[1], level: Number(m[2]), carry: m[3] };
}

function findMatchingSlug(family) {
  const parts = parseFamily(family);
  if (!parts) return null;
  for (const [slug, entry] of Object.entries(slugMap.slugs || {})) {
    if (parts.carry !== entry.primaryCarry) continue;
    if (entry.primaryTrait && entry.primaryTrait !== '') {
      const traitMatch =
        parts.trait === entry.primaryTrait
        || parts.trait.startsWith(entry.primaryTrait + '_')
        || entry.primaryTrait.startsWith(parts.trait + '_');
      if (!traitMatch) continue;
    }
    return slug;
  }
  return null;
}

async function main() {
  console.log(`Coverage-Check: Top-${topN} Cluster-Families (set ${set}, last ${days}d, master+)\n`);

  const client = new pg.Client({ connectionString: encodePasswordInPgUrl(DATABASE_URL) });
  await client.connect();

  const sql = `
    SELECT
      regexp_replace(cluster_key, '(\\*\\d|~[A-Za-z]+|#.+)', '', 'g') AS family,
      SUM(games)::int AS games
    FROM tft_daily_comp_stats
    WHERE day >= current_date - $1::int
      AND set_number = $2
      AND bucket IN ('master', 'grandmaster', 'challenger')
    GROUP BY family
    HAVING SUM(games) >= 100
    ORDER BY games DESC
    LIMIT $3;
  `;
  const r = await client.query(sql, [days, set, topN]);
  await client.end();

  const matched = [];
  const missing = [];

  for (const row of r.rows) {
    const slug = findMatchingSlug(row.family);
    if (slug) {
      matched.push({ family: row.family, games: row.games, slug });
    } else {
      missing.push({ family: row.family, games: row.games });
    }
  }

  const totalGames = r.rows.reduce((s, x) => s + Number(x.games), 0);
  const matchedGames = matched.reduce((s, x) => s + x.games, 0);
  const familiesCoverage = (matched.length / r.rows.length * 100).toFixed(1);
  const volumeCoverage = (matchedGames / totalGames * 100).toFixed(1);

  console.log(`Families covered:  ${matched.length}/${r.rows.length} (${familiesCoverage} %)`);
  console.log(`Volume covered:    ${matchedGames.toLocaleString()}/${totalGames.toLocaleString()} games (${volumeCoverage} %)`);
  console.log();

  if (missing.length > 0) {
    console.log(`Missing slug-map entries (ranked by games):`);
    for (const m of missing.slice(0, 30)) {
      const parts = parseFamily(m.family);
      const carryName = parts ? parts.carry.replace(/^TFT\d+_/, '') : '?';
      const traitName = parts ? parts.trait.replace(/^TFT\d+_/, '') : '?';
      console.log(`  ✗ ${m.family.padEnd(50)} ${String(m.games).padStart(7)} games  (${traitName} → ${carryName})`);
    }
    if (missing.length > 30) console.log(`    … ${missing.length - 30} more`);
    console.log();
  }

  if (compAugs?.comps) {
    const usedSlugs = new Set(matched.map(x => x.slug));
    const orphans = Object.keys(compAugs.comps).filter(s => !usedSlugs.has(s));
    if (orphans.length > 0) {
      console.log(`Orphan slugs in tft-comp-augments-${set}.json (scraped but not in top-${topN} families):`);
      for (const s of orphans.slice(0, 10)) console.log(`  ◦ ${s}`);
      if (orphans.length > 10) console.log(`    … ${orphans.length - 10} more`);
      console.log();
    }
  }

  // Exit codes for scripting: 0=above 80% volume coverage, 1=below threshold
  if (Number(volumeCoverage) >= 80) {
    console.log(`PASS — volume coverage >= 80 %`);
    process.exit(0);
  } else {
    console.log(`FAIL — volume coverage ${volumeCoverage} % < 80 %. Add slug-map entries for the missing families above.`);
    process.exit(1);
  }
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
