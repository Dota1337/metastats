#!/usr/bin/env node
/**
 * Baut tft_position_comp_cell (Aufstellungs-Karte auf /tft/comps/[slug])
 * aus den Rohbeobachtungen der Overwolf-App neu auf.
 *
 * Bei JEDEM Lauf komplett neu statt aufaddieren (Begruendung in
 * scripts/lib/companion-positions.mjs). Ablauf:
 *   1. Alle eigenen Brett-Beobachtungen mit echter Riot-Match-ID lesen
 *      (LIVE_-IDs loest vorher scripts/backfill-companion-placements.mjs auf).
 *   2. Je (Match, Beobachter) die Comp bestimmen: Box-Match-Cache, sonst Riot
 *      Match-Detail + classifyComp. Schluessel ist die Familie `<trait>__<carry>`
 *      — dieselbe Ebene, auf der /tft/comps die Comps zeigt.
 *   3. Zellen zaehlen, alles hochladen, Zeilen loeschen, die nicht mehr dazugehoeren.
 *
 * Die Zuordnung je (Match, Beobachter) landet in einer Datei im
 * StateDirectory der Unit — sie aendert sich nie, Riot wird je Spiel also
 * genau einmal gefragt.
 *
 * Schlaegt eine Riot-Abfrage voruebergehend fehl (429, 5xx, Netz), schreibt
 * der Lauf NICHT: eine unvollstaendige Neuberechnung wuerde die Tabelle
 * schrumpfen lassen. Der naechste Lauf holt es nach.
 *
 *   node scripts/aggregate-position-observations.mjs [--dry-run] [--no-box]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { createRiotClient } from './lib/riot-client.mjs';
import { riotWindowFor } from './lib/riot-limits.mjs';
import { getRegionalRouting, getAccountRouting, isValidRegion } from './lib/regional-routing.mjs';
import { classifyComp } from './lib/tft-classify-comp.mjs';
import {
  familyKeyFromCluster, isRiotMatchId, isRiotHandle, groupKey, aggregateCells, staleRows,
} from './lib/companion-positions.mjs';

function loadEnv() {
  const candidates = ['/etc/metastats-crawler/env', resolve(process.cwd(), '.env.local')];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.includes('=') || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^"|"$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
    break;
  }
}
loadEnv();

const DRY_RUN = process.argv.includes('--dry-run');
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HETZNER_DB = process.env.DATABASE_URL;
// Strikt der TFT-Key, wie im Backfill (Begruendung dort).
const RIOT_KEY = process.env.RIOT_API_KEY_TFT;
if (!SUPA_URL || !SUPA_KEY) { console.error('SUPABASE env vars required'); process.exit(1); }
if (!RIOT_KEY) { console.error('RIOT_API_KEY_TFT required'); process.exit(1); }

const SOURCE_KEY = 'tft_position_observations';
const PAGE = 1000;
const STATE_DIR = process.env.STATE_DIRECTORY || join(tmpdir(), 'metastats-companion');
const CACHE_FILE = join(STATE_DIR, 'class-cache.json');

// Box-Cache ist optional: ohne DATABASE_URL (oder lokal mit --no-box) faellt alles auf Riot.
const pool = HETZNER_DB && !process.argv.includes('--no-box') ?new pg.Pool({ connectionString: HETZNER_DB, max: 3, statement_timeout: 60_000 }) : null;
// Ruhende Verbindungen, die der Server kappt (z. B. DB-Neustart), reissen sonst den Prozess.
pool?.on('error', (e) => console.error(`DB-Verbindung verworfen: ${e.message}`));
// Teilt sich das Budget mit dem Backfill (laufen nie gleichzeitig lange).
const riot = createRiotClient({ ...riotWindowFor('companion-backfill'), apiKey: RIOT_KEY });

const sbHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };

async function supaSelectAll(table, query) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${SUPA_URL}/rest/v1/${table}?${query}&offset=${offset}&limit=${PAGE}`, { headers: sbHeaders });
    if (!res.ok) throw new Error(`Supabase ${table} GET: HTTP ${res.status}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function supaUpsert(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 200) {
    const res = await fetch(`${SUPA_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 200)),
    });
    if (!res.ok) throw new Error(`Supabase upsert ${table}: HTTP ${res.status} ${await res.text()}`);
  }
}

async function supaDelete(table, filter) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
  });
  if (!res.ok) throw new Error(`Supabase delete ${table}: HTTP ${res.status} ${await res.text()}`);
}

function loadCache() {
  try {
    const j = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    return { handles: j.handles || {}, groups: j.groups || {} };
  } catch {
    return { handles: {}, groups: {} };
  }
}

function saveCache(cache) {
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${CACHE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache));
  renameSync(tmp, CACHE_FILE);
}

// Voruebergehend = spaeter nochmal versuchen. Alles andere ist endgueltig.
const isTransient = (status) => status == null || status === 429 || status >= 500;

class TransientError extends Error {}

async function riotJson(url) {
  const j = await riot.fetchJson(url, { safe: true });
  if (j == null) throw new TransientError(`Netzfehler: ${url}`);
  if (j._status) {
    if (isTransient(j._status)) throw new TransientError(`HTTP ${j._status}: ${url}`);
    return { _status: j._status };
  }
  return j;
}

async function resolvePuuid(observer, region, cache) {
  if (!isRiotHandle(observer)) return observer; // aeltere App-Versionen: schon Konto-ID
  if (observer in cache.handles) return cache.handles[observer];
  const [gameName, tagLine] = observer.split('#');
  const acc = await riotJson(
    `https://${getAccountRouting(region)}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
  );
  const puuid = acc._status ? null : acc.puuid || null;
  cache.handles[observer] = puuid;
  return puuid;
}

async function fromBoxCache(matchId, puuid) {
  if (!pool) return null;
  const r = await pool.query(
    `select comp_cluster_key, set_number, queue_id, placement
       from tft_player_match_cache where match_id = $1 and puuid = $2 limit 1`,
    [matchId, puuid],
  );
  const row = r.rows[0];
  if (!row?.comp_cluster_key) return null;
  return {
    clusterKey: row.comp_cluster_key, familyKey: familyKeyFromCluster(row.comp_cluster_key),
    set: row.set_number, queue: row.queue_id, placement: row.placement, src: 'box',
  };
}

async function fromRiot(matchId, puuid, region) {
  const md = await riotJson(`https://${getRegionalRouting(region)}.api.riotgames.com/tft/match/v1/matches/${matchId}`);
  if (md._status) return { skip: `match_${md._status}` };
  const p = (md.info?.participants || []).find(x => x.puuid === puuid);
  if (!p) return { skip: 'not_in_match' };
  const set = Number(md.info.tft_set_number);
  let cls = null;
  try { cls = classifyComp(p, { currentSet: set }); } catch (e) { return { skip: `classify_error:${e.message.slice(0, 60)}` }; }
  if (!cls?.clusterKey) return { skip: 'unclassified', set, queue: md.info.queue_id };
  return {
    clusterKey: cls.clusterKey, familyKey: familyKeyFromCluster(cls.clusterKey),
    set, queue: md.info.queue_id, placement: p.placement, src: 'riot',
  };
}

async function classifyGroup(matchId, observer, region, cache) {
  const gk = groupKey(matchId, observer);
  if (cache.groups[gk]) return cache.groups[gk];
  if (!isValidRegion(region)) return (cache.groups[gk] = { skip: `region:${region}` });
  const puuid = await resolvePuuid(observer, region, cache);
  if (!puuid) return (cache.groups[gk] = { skip: 'no_account' });
  const res = (await fromBoxCache(matchId, puuid)) || (await fromRiot(matchId, puuid, region));
  cache.groups[gk] = res;
  return res;
}

async function main() {
  const t0 = Date.now();
  const all = await supaSelectAll('tft_position_observations',
    'select=match_id,observer_puuid,region,unit,cell,round,client_version,observed_at&kind=eq.own&order=id.asc');
  const observations = all.filter(o => isRiotMatchId(o.match_id) && o.observer_puuid);
  console.log(`Beobachtungen: ${all.length} eigene, davon ${observations.length} mit echter Match-ID`);

  const groups = new Map();
  for (const o of observations) {
    const gk = groupKey(o.match_id, o.observer_puuid);
    if (!groups.has(gk)) groups.set(gk, o);
  }

  const cache = loadCache();
  const classes = new Map();
  const skips = {};
  let transient = 0;
  for (const [gk, o] of groups) {
    try {
      const c = await classifyGroup(o.match_id, o.observer_puuid, o.region, cache);
      classes.set(gk, c);
      if (c.skip) skips[c.skip] = (skips[c.skip] || 0) + 1;
    } catch (e) {
      if (!(e instanceof TransientError)) throw e;
      transient++;
      console.warn(`  voruebergehend fehlgeschlagen: ${gk} — ${e.message}`);
    }
  }
  saveCache(cache);
  console.log(`Spiele: ${groups.size}, zugeordnet ${[...classes.values()].filter(c => c.familyKey).length}, ` +
    `uebersprungen ${JSON.stringify(skips)}, voruebergehend fehlgeschlagen ${transient}`);

  const { rows, used, skipped } = aggregateCells(observations, classes);
  const families = new Set(rows.map(r => r.cluster_key));
  console.log(`Zellen: ${rows.length} in ${families.size} Comps (${used} Beobachtungen gezaehlt, ${skipped} nicht)`);

  if (transient > 0) {
    console.error(`ABBRUCH vor dem Schreiben: ${transient} Spiele nicht abfragbar — Tabelle bleibt unveraendert.`);
    process.exitCode = 1;
    return;
  }

  const existing = await supaSelectAll('tft_position_comp_cell', 'select=cluster_key,unit,cell&order=cluster_key.asc,unit.asc,cell.asc');
  const stale = staleRows(existing, rows);
  console.log(`Tabelle vorher: ${existing.length} Zeilen, davon ${stale.length} veraltet`);

  if (DRY_RUN) {
    for (const f of families) {
      const fr = rows.filter(r => r.cluster_key === f);
      console.log(`  ${f}: ${fr.length} Zellen, ${Math.max(...fr.map(r => r.distinct_matches))} Spiele`);
    }
    console.log('Probelauf — nichts geschrieben.');
    return;
  }

  await supaUpsert('tft_position_comp_cell', rows, 'cluster_key,unit,cell');

  // Ganze Comps, die nicht mehr vorkommen, in einem Aufruf; Rest einzeln.
  const goneClusters = [...new Set(stale.map(r => r.cluster_key))].filter(c => !families.has(c));
  for (const c of goneClusters) await supaDelete('tft_position_comp_cell', `cluster_key=eq.${encodeURIComponent(c)}`);
  for (const r of stale.filter(r => families.has(r.cluster_key))) {
    await supaDelete('tft_position_comp_cell',
      `cluster_key=eq.${encodeURIComponent(r.cluster_key)}&unit=eq.${encodeURIComponent(r.unit)}&cell=eq.${r.cell}`);
  }

  const lastObserved = observations.reduce((m, o) => (o.observed_at > m ? o.observed_at : m), '1970-01-01T00:00:00Z');
  await supaUpsert('tft_position_aggregator_state',
    [{ source: SOURCE_KEY, last_observed_at: lastObserved, last_run_at: new Date().toISOString() }], 'source');
  console.log(`geschrieben: ${rows.length} Zellen, ${stale.length} geloescht (${Math.round((Date.now() - t0) / 1000)} s)`);
}

main()
  .catch(err => {
    console.error('FAIL:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(() => pool?.end().catch(() => {}));
