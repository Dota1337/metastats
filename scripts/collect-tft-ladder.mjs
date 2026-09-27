#!/usr/bin/env node
// Taegliche Rangliste ab Smaragd fuer die Aufsteiger-Seite (/tft/rising).
//
// Pro Region: alle Liga-Listen von Smaragd IV bis Challenger holen, als
// Tagesstand in tft_ladder_daily schreiben, Zeilen aelter als 10 Tage
// loeschen. Danach fuer die Spitzenkandidaten (je Region die besten 20 ueber
// 1/3/5 Tage) die Partien des Zeitraums in den Match-Cache nachholen und
// fehlende Namen aufloesen. Mehr Spieler bekommen keinen einzigen Match-Call.
//
// Laeuft bewusst ohne `Conflicts=` neben dem Marktwert-Snapshot: der wuerde
// sonst mitten im Lauf gestoppt. Die Partien laufen deshalb ueber eine kleine
// eigene Decke (RESERVED.ladder in riot-limits.mjs).
//
// Flags:
//   --regions euw1,kr   nur diese Regionen
//   --no-matches        nur die Liste schreiben, keine Partien, keine Namen

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

function loadEnv() {
  const candidates = ['/etc/metastats-crawler/env', resolve(process.cwd(), '.env.local')];
  for (const path of candidates) {
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

const { createRiotClient } = await import('./lib/riot-client.mjs');
const { riotWindowFor, leagueWindow } = await import('./lib/riot-limits.mjs');
const { fetchLadderEntries } = await import('./lib/tft-league-entries.mjs');
const { refreshPlayerMatchCache } = await import('./lib/tft-match-cache-pg.mjs');
const { getRegionalRouting, getAccountRouting } = await import('./lib/regional-routing.mjs');
const { ACTIVE_REGIONS } = await import('./lib/active-regions.mjs');
const { CURRENT_SET, loadSetStartDate } = await import('./lib/current-set.mjs');
const { queryRisingCandidates, RISING_DAYS, RISING_LIMIT } = await import('./lib/tft-rising.mjs');

const API_KEY = process.env.RIOT_API_KEY_TFT;
const DATABASE_URL = process.env.DATABASE_URL;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || null;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || null;
if (!API_KEY) { console.error('RIOT_API_KEY_TFT fehlt'); process.exit(1); }
if (!DATABASE_URL) { console.error('DATABASE_URL fehlt'); process.exit(1); }
if (!CURRENT_SET) { console.error('Aktuelles Set unbekannt'); process.exit(1); }

const args = process.argv.slice(2);
const argVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const REGIONS = argVal('--regions')
  ? argVal('--regions').split(',').map(s => s.trim()).filter(Boolean)
  : ACTIVE_REGIONS;
for (const r of REGIONS) {
  if (!ACTIVE_REGIONS.includes(r)) { console.error(`Unbekannte Region: ${r}`); process.exit(1); }
}
const NO_MATCHES = args.includes('--no-matches');
const RETENTION_DAYS = 10;

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4, statement_timeout: 120_000 });

// Ein Liga-Client pro Plattform (eigene Zaehler je Host), ein Partien-Client
// pro Regional-Route (fuenf Regionen teilen sich europe).
const clusterClients = new Map();
function clusterClient(cluster) {
  let c = clusterClients.get(cluster);
  if (!c) {
    c = createRiotClient({ ...riotWindowFor('ladder'), apiKey: API_KEY, log: () => {} });
    clusterClients.set(cluster, c);
  }
  return c;
}

const today = new Date().toISOString().slice(0, 10);

async function writeLadder(region, entries) {
  const rows = [...entries.values()];
  const CHUNK = 5000;
  for (let k = 0; k < rows.length; k += CHUNK) {
    const part = rows.slice(k, k + CHUNK);
    await pool.query(
      `insert into tft_ladder_daily
         (puuid, region, day, set_number, tier, rank, lp, wins, losses, fetched_at)
       select u.puuid, $1, $2::date, $3, u.tier, u.rank, u.lp, u.wins, u.losses, u.at
         from unnest($4::text[], $5::text[], $6::text[], $7::int[], $8::int[], $9::int[], $10::timestamptz[])
           as u(puuid, tier, rank, lp, wins, losses, at)
       on conflict (puuid, region, day) do update set
         set_number = excluded.set_number, tier = excluded.tier, rank = excluded.rank,
         lp = excluded.lp, wins = excluded.wins, losses = excluded.losses,
         fetched_at = excluded.fetched_at`,
      [
        region, today, CURRENT_SET,
        part.map(e => e.puuid),
        part.map(e => e.tier),
        part.map(e => (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(e.tier) ? null : e.rank)),
        part.map(e => e.lp),
        part.map(e => e.wins),
        part.map(e => e.losses),
        part.map(e => e.at.toISOString()),
      ],
    );
  }
  return rows.length;
}

async function collectRegion(region) {
  const t0 = Date.now();
  const league = createRiotClient({ ...leagueWindow(), apiKey: API_KEY, log: () => {} });
  const { entries, apexLoaded, incomplete, calls } = await fetchLadderEntries(
    region, url => league.fetchJson(url), { log: m => console.log(m) },
  );
  // Ohne eine einzige Apex-Liste waere der Tagesstand der Region wertlos: die
  // Seite nimmt den juengsten Tag als Endstand, und dann fehlten dort alle
  // Master+. Lieber den Tag auslassen — der Vortag bleibt der Endstand.
  if (apexLoaded === 0) {
    console.log(`[${region}] keine Apex-Liste geladen — Tag nicht geschrieben (${calls} Aufrufe)`);
    return { region, written: 0, ok: false };
  }
  const written = await writeLadder(region, entries);
  console.log(`[${region}] ${written} Spieler geschrieben, ${calls} Aufrufe, ${Math.round((Date.now() - t0) / 1000)} s`
    + (incomplete.length ? `, unvollstaendig: ${incomplete.join(' ')}` : ''));
  return { region, written, ok: true };
}

async function missingNames(puuids) {
  if (!SUPA_URL || !SUPA_KEY || puuids.length === 0) return new Set();
  const have = new Set();
  for (let k = 0; k < puuids.length; k += 100) {
    const list = puuids.slice(k, k + 100).map(p => `"${p}"`).join(',');
    const res = await fetch(
      `${SUPA_URL}/rest/v1/tft_player_names?select=puuid&puuid=in.(${encodeURIComponent(list)})`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` }, signal: AbortSignal.timeout(30_000) },
    );
    if (!res.ok) throw new Error(`tft_player_names HTTP ${res.status}`);
    for (const r of await res.json()) have.add(r.puuid);
  }
  return new Set(puuids.filter(p => !have.has(p)));
}

async function resolveNames(cands) {
  if (!SUPA_KEY) { console.log('[names] kein SUPABASE_SERVICE_ROLE_KEY — uebersprungen'); return; }
  try {
    const missing = await missingNames([...new Set(cands.map(c => c.puuid))]);
    const rows = [];
    const seen = new Set();
    for (const c of cands) {
      if (!missing.has(c.puuid) || seen.has(c.puuid)) continue;
      seen.add(c.puuid);
      const acc = await clusterClient(getAccountRouting(c.region)).fetchJson(
        `https://${getAccountRouting(c.region)}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${c.puuid}`,
        { safe: true },
      );
      if (!acc?.gameName || !acc?.tagLine) continue;
      rows.push({
        puuid: c.puuid, game_name: acc.gameName, tag_line: acc.tagLine, region: c.region,
        tier: c.after.tier, division: c.after.rank, lp: c.after.lp,
        last_seen: new Date().toISOString(),
      });
    }
    if (rows.length === 0) { console.log(`[names] ${missing.size} ohne Namen, 0 aufgeloest`); return; }
    const res = await fetch(`${SUPA_URL}/rest/v1/rpc/upsert_tft_player_names`, {
      method: 'POST',
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_rows: rows }),
      signal: AbortSignal.timeout(60_000),
    });
    console.log(`[names] ${missing.size} ohne Namen, ${rows.length} aufgeloest, Schreiben HTTP ${res.status}`);
  } catch (err) {
    console.log(`[names] Fehler: ${err?.message || err}`);
  }
}

async function fillMatches(region, setStartSec) {
  const byPuuid = new Map();
  for (const days of RISING_DAYS) {
    const cands = await queryRisingCandidates(pool, { setNumber: CURRENT_SET, days, region, limit: RISING_LIMIT });
    for (const c of cands) {
      const prev = byPuuid.get(c.puuid);
      if (!prev || c.startAt < prev.startAt) byPuuid.set(c.puuid, c);
    }
  }
  const cands = [...byPuuid.values()];
  const regional = getRegionalRouting(region);
  const riot = clusterClient(regional);
  let fresh = 0;
  let failed = 0;
  for (const c of cands) {
    // Eine Stunde Vorlauf: der Stand am Starttag kann vor seiner letzten
    // Partie abgerufen worden sein, die Partie selbst liegt dann knapp davor.
    const startSec = Math.max(Math.floor(c.startAt.getTime() / 1000) - 3600, setStartSec ?? 0);
    try {
      const r = await refreshPlayerMatchCache(pool, c.puuid, region, regional, riot, {
        startTimeSec: startSec, maxIds: 200, maxStaleMinutes: 60, concurrency: 4, syncSupabase: false,
      });
      fresh += r.newMatches;
    } catch (err) {
      failed++;
      console.log(`[${region}] Partien ${c.puuid.slice(0, 8)}: ${err.message}`);
    }
  }
  console.log(`[${region}] ${cands.length} Kandidaten, ${fresh} neue Partien${failed ? `, ${failed} Fehler` : ''}`);
  return cands;
}

async function main() {
  const started = Date.now();
  console.log(`=== Rangliste ${today} — Set ${CURRENT_SET}, ${REGIONS.length} Regionen ===`);

  const results = await Promise.all(REGIONS.map(r => collectRegion(r).catch(err => {
    console.log(`[${r}] Fehler: ${err.message}`);
    return { region: r, written: 0, ok: false };
  })));

  const del = await pool.query(
    `delete from tft_ladder_daily where day < $1::date - $2::int`, [today, RETENTION_DAYS],
  );
  console.log(`[aufraeumen] ${del.rowCount} Zeilen aelter als ${RETENTION_DAYS} Tage geloescht`);

  if (!NO_MATCHES) {
    const setStart = loadSetStartDate();
    const setStartSec = setStart ? Math.floor(Date.parse(`${setStart}T00:00:00Z`) / 1000) : null;
    // Regionen parallel, die Decke pro Route begrenzt ohnehin.
    const all = await Promise.all(results.filter(r => r.ok).map(r => fillMatches(r.region, setStartSec).catch(err => {
      console.log(`[${r.region}] Kandidaten: ${err.message}`);
      return [];
    })));
    await resolveNames(all.flat());
  }

  const size = await pool.query(`select pg_size_pretty(pg_total_relation_size('tft_ladder_daily')) as s, count(*)::int as n from tft_ladder_daily`);
  console.log(`[tabelle] ${size.rows[0].n} Zeilen, ${size.rows[0].s}`);
  const failed = results.filter(r => !r.ok).map(r => r.region);
  console.log(`=== fertig in ${Math.round((Date.now() - started) / 1000)} s${failed.length ? `, ohne Stand: ${failed.join(' ')}` : ''} ===`);
  await pool.end();
  // Mehr als die Haelfte der Regionen ohne Stand ist kein Einzelausfall mehr.
  if (failed.length > REGIONS.length / 2) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  try { await pool.end(); } catch {}
  process.exit(1);
});
