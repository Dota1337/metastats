#!/usr/bin/env node
/**
 * Verdichtet die LoL-Rohdaten (Box-Postgres, lol_match_participant_raw) zu den
 * Summen je Champion + Rolle + Rang + Patch auf Supabase (lol_champion_build_stats).
 * Die Seite /champions/[id] liest nur die Summen; das Item-Urteil rechnet die
 * Route daraus (app/lib/lol-item-verdict.ts).
 *
 * Gezaehlt wird jeder Teilnehmer eines Stichproben-Matches mit dem Rang, ueber den
 * das Match gefunden wurde (lol_rank_match_queue.seed_tier) — ausser dem
 * Stichproben-Spieler selbst. Matches ohne Rang (nur aus der Spieler-Historie)
 * zaehlen nicht. Remakes (<5 min) und Frueh-Aufgaben fallen raus.
 *
 * Jeder Lauf rechnet die zwei neuesten Patches der Rohablage komplett neu und
 * ersetzt sie auf Supabase in einer Transaktion (loeschen + einfuegen) — die
 * Seite sieht also nie einen halben Stand.
 *
 * Aufruf:
 *   node scripts/aggregate-lol-builds.mjs            # zwei neueste Patches
 *   node scripts/aggregate-lol-builds.mjs --dry-run  # nur zaehlen, nichts schreiben
 *
 * Keine Riot-Anfragen, deshalb keine Riot-Sperre.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

import { bootIds, fetchItemData, finishedItemIds, latestDdragonVersion, classifyInventory, stratumOf } from './lib/lol-items.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const PATCHES = 2;
const FETCH = 20_000;
const INSERT_BATCH = 1000;
const MIN_REMAKE_SEC = 300;
const ROLES = new Set(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']);
const TIERS = new Set(['EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER']);
// Seltene Auspraegungen fliegen raus (Summe ueber alle Raenge und Schichten je
// Champion + Rolle). Ein Urteil braucht ohnehin >= 100 Spiele mit dem Item.
const MIN_KEEP = { item: 20, boots: 10, build: 10, rune: 10, keystone: 10, spells: 10, vs: 5 };
const MIN_ROLE_GAMES = 10;

const log = (msg) => console.log(`[lol-builds ${new Date().toISOString()}] ${msg}`);

function loadEnv() {
  for (const path of ['/etc/metastats-crawler/env', resolve(process.cwd(), '.env.local')]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      if (!line.includes('=') || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
    }
    break;
  }
}
loadEnv();

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

// Gleiche Aufteilung wie scripts/collect-lol-matches.mjs: Rohdaten auf der Box
// (DATABASE_URL), Summen auf Supabase (SUPABASE_DB_URL).
const RAW_DB_URL = process.env.LOL_RAW_DB_URL
  || (process.env.SUPABASE_DB_URL && process.env.DATABASE_URL !== process.env.SUPABASE_DB_URL ? process.env.DATABASE_URL : null);
const SUPA_DB_URL = process.env.SUPABASE_DB_URL;
if (!RAW_DB_URL || !SUPA_DB_URL) {
  console.error('Rohablage (DATABASE_URL auf der Box / LOL_RAW_DB_URL) und SUPABASE_DB_URL muessen gesetzt sein.');
  process.exit(1);
}
const isLocal = (u) => /@(127\.0\.0\.1|localhost)[:/]/.test(u);
const mkPool = (url) => new pg.Pool({
  connectionString: encodePasswordInPgUrl(url),
  ssl: isLocal(url) ? false : { rejectUnauthorized: false },
  max: 1,
  statement_timeout: 300_000,
  query_timeout: 320_000,
  connectionTimeoutMillis: 15_000,
  keepAlive: true,
});
const rawPool = mkPool(RAW_DB_URL);
const supa = mkPool(SUPA_DB_URL);
rawPool.on('error', (e) => log(`Rohablage-Verbindung verworfen: ${e.message}`));
supa.on('error', (e) => log(`Supabase-Verbindung verworfen: ${e.message}`));

// --------------------------------------------------------------------------
function bump(map, k, win) {
  const e = map.get(k);
  if (e) { e[0]++; if (win) e[1]++; } else map.set(k, [1, win ? 1 : 0]);
}

// Ein Teilnehmer -> alle Zaehler. Schluessel: champion|role|tier|dim|key|stratum
function countParticipant(map, r, finishedSet, bootSet) {
  const { finished, boots } = classifyInventory(r.items, finishedSet, bootSet);
  const s = stratumOf(finished.length, r.game_duration);
  const base = `${r.champion_id}|${r.team_position}|${r.seed_tier}|`;
  const w = r.win;
  bump(map, `${base}total||${s}`, w);
  for (const f of finished) bump(map, `${base}item|${f}|${s}`, w);
  bump(map, `${base}boots|${boots ?? 0}|0`, w);
  if (finished.length >= 3) bump(map, `${base}build|${[...finished].sort((a, b) => a - b).join(',')}|0`, w);
  if (Array.isArray(r.runes) && r.runes[1]) {
    bump(map, `${base}rune|${r.runes.join(',')}|0`, w);
    bump(map, `${base}keystone|${r.runes[1]}|0`, w);
  }
  const sp = (r.summoners || []).filter(Boolean).sort((a, b) => a - b);
  if (sp.length === 2) bump(map, `${base}spells|${sp.join(',')}|0`, w);
  if (r.opp_champion && r.opp_champion !== r.champion_id) bump(map, `${base}vs|${r.opp_champion}|0`, w);
}

// Seltene Auspraegungen entfernen (Summe ueber Raenge + Schichten).
function prune(map) {
  const sums = new Map();
  const roleGames = new Map();
  for (const [k, [g]] of map) {
    const [c, role, , dim, key] = k.split('|');
    if (dim === 'total') { roleGames.set(`${c}|${role}`, (roleGames.get(`${c}|${role}`) || 0) + g); continue; }
    const sk = `${c}|${role}|${dim}|${key}`;
    sums.set(sk, (sums.get(sk) || 0) + g);
  }
  const out = [];
  for (const [k, [g, w]] of map) {
    const [c, role, tier, dim, key, stratum] = k.split('|');
    if ((roleGames.get(`${c}|${role}`) || 0) < MIN_ROLE_GAMES) continue;
    if (dim !== 'total' && (sums.get(`${c}|${role}|${dim}|${key}`) || 0) < MIN_KEEP[dim]) continue;
    out.push([Number(c), role, tier, dim, key, Number(stratum), g, w]);
  }
  return out;
}

async function aggregatePatch(region, major, minor, runStart, finishedSet, bootSet) {
  const map = new Map();
  const client = await rawPool.connect();
  let n = 0;
  try {
    await client.query('begin');
    // Gegner derselben Rolle ueber den Selbst-Join; der Stichproben-Spieler
    // selbst zaehlt nicht (seine Spiele sind nicht zufaellig gezogen).
    await client.query(`
      declare c no scroll cursor for
      select r.champion_id, r.team_position, r.win, r.items, r.runes, r.summoners,
             r.game_duration, q.seed_tier,
             (select o.champion_id from lol_match_participant_raw o
               where o.match_id = r.match_id and o.team_id <> r.team_id
                 and o.team_position = r.team_position limit 1) as opp_champion
        from lol_match_participant_raw r
        join lol_rank_match_queue q on q.match_id = r.match_id
       where r.patch_major = $1 and r.patch_minor = $2 and r.region = $4
         and q.seed_tier is not null
         and r.puuid is distinct from q.seed_puuid
         and r.game_duration >= ${MIN_REMAKE_SEC}
         and not r.early_surrender
         and r.team_position <> ''
         and r.game_creation < $3`, [major, minor, runStart, region]);
    for (;;) {
      const { rows } = await client.query(`fetch ${FETCH} from c`);
      if (!rows.length) break;
      for (const r of rows) {
        if (!ROLES.has(r.team_position) || !TIERS.has(r.seed_tier)) continue;
        countParticipant(map, r, finishedSet, bootSet);
        n++;
      }
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { rows: prune(map), participants: n };
}

async function writePatch(region, patch, rows) {
  const client = await supa.connect();
  try {
    await client.query('begin');
    await client.query('delete from lol_champion_build_stats where region = $1 and patch = $2', [region, patch]);
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const chunk = rows.slice(i, i + INSERT_BATCH);
      const values = [];
      const params = [];
      chunk.forEach((r, j) => {
        const o = j * 10;
        values.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10})`);
        params.push(region, patch, ...r);
      });
      await client.query(
        `insert into lol_champion_build_stats (region, patch, champion, role, tier, dim, key, stratum, games, wins)
         values ${values.join(',')}`, params);
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const runStart = new Date();
  const version = await latestDdragonVersion();
  const items = await fetchItemData(version);
  const finishedSet = finishedItemIds(items);
  const bootSet = bootIds(items);
  log(`DDragon ${version}: ${finishedSet.size} fertige Items, ${bootSet.size} Stiefel.`);

  const { rows: patches } = await rawPool.query(`
    select distinct r.region, r.patch_major, r.patch_minor
      from lol_match_participant_raw r
     where (r.patch_major, r.patch_minor) in (
       select patch_major, patch_minor from lol_match_participant_raw
        group by 1, 2 order by 1 desc, 2 desc limit ${PATCHES})`);
  if (!patches.length) { log('Rohablage leer — nichts zu tun.'); return 0; }

  for (const p of patches) {
    const patch = `${p.patch_major}.${p.patch_minor}`;
    const t0 = Date.now();
    const { rows, participants } = await aggregatePatch(p.region, p.patch_major, p.patch_minor, runStart, finishedSet, bootSet);
    const games = rows.filter((r) => r[3] === 'total').reduce((s, r) => s + r[6], 0);
    log(`${p.region} ${patch}: ${participants} Teilnehmer, ${games} gezaehlt, ${rows.length} Zeilen (${Math.round((Date.now() - t0) / 1000)} s)`);
    if (DRY_RUN || !rows.length) continue;
    await writePatch(p.region, patch, rows);
    log(`${p.region} ${patch}: auf Supabase ersetzt.`);
  }
  return 0;
}

const endPools = () => Promise.all([rawPool.end(), supa.end()]).catch(() => {});
main()
  .then(async (code) => { await endPools(); process.exit(code); })
  .catch(async (err) => { console.error('ERROR:', err.stack || err.message); await endPools(); process.exit(1); });
