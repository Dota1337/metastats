#!/usr/bin/env node
/**
 * Sammelt die LoL-Matches eines Spielers dauerhaft in `lol_player_match_cache`.
 *
 * WARUM: Die Leistungsanalyse auf /player/[slug] rechnet heute ueber die letzten
 * 30 Spiele. Der User will die ganze Saison. Riot gibt pro Account aber hoechstens
 * ~950 Match-IDs heraus (gemessen 2026-09-11 ueber 6 Accounts: 951/925/921/920/909/776),
 * und aeltere Spiele sind ueber KEINEN Parameter mehr erreichbar. Jeder Tag ohne
 * eigene Ablage ist endgueltig verlorene Historie — deshalb einmal holen, behalten.
 *
 * Gespeichert wird der Teilnehmer-Datensatz DIESES Spielers plus die Teamsummen,
 * die app/lib/match-processor.ts sonst aus den Mitspielern rechnen wuerde. Alle
 * Spielmodi kommen rein (User-Entscheid), angezeigt wird spaeter Ranked Solo (420).
 *
 * Der Sammler geht NIE ueber metastats.gg — er spricht direkt mit Riot. Die
 * Website darf von einem Hintergrundjob nicht abhaengig gemacht werden.
 *
 * Aufruf:
 *   node scripts/collect-lol-matches.mjs --seed            # Warteschlange aus `players` fuellen
 *   node scripts/collect-lol-matches.mjs --players 3       # drei Spieler abarbeiten
 *   node scripts/collect-lol-matches.mjs --puuid <p> --region euw1 --max-ids 20   # Rauchtest
 *   node scripts/collect-lol-matches.mjs --status          # Warteschlange anzeigen
 *
 * Laufzeit: Riot erlaubt 100 Anfragen pro 2 Minuten, der Client drosselt auf 95.
 * Ein Spieler mit ~950 Spielen dauert damit rund 20 Minuten — mehr als etwa 70
 * Spieler am Tag sind nicht drin. Bei 1.431 Zeilen in `players` (gemessen
 * 2026-09-11) braucht der erste volle Durchlauf rund drei Wochen.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

import { createRiotClient } from './lib/riot-client.mjs';
import { getRegionalRouting, normalizeRegion, isValidRegion } from './lib/regional-routing.mjs';
import { tryAcquire, releaseLock } from './lib/advisory-lock.mjs';

const args = process.argv.slice(2);
const getArg = (k, def = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
const hasFlag = (k) => args.includes(k);

const SEED_ONLY = hasFlag('--seed-only');
const DO_SEED = hasFlag('--seed') || SEED_ONLY;
const SHOW_STATUS = hasFlag('--status');
const DRY_RUN = hasFlag('--dry-run');
const PLAYER_BUDGET = Number(getArg('--players', '1'));
const ONE_PUUID = getArg('--puuid');
const ONE_REGION = getArg('--region');
// Riot gibt ohnehin nicht mehr her; der Deckel ist nur fuer Rauchtests da.
const MAX_IDS = Number(getArg('--max-ids', '1000'));
const ID_PAGE = 100;                     // Riots Maximum pro Anfrage
const INSERT_BATCH = 200;

const log = (msg) => console.log(`[lol-matches ${new Date().toISOString()}] ${msg}`);

// --------------------------------------------------------------------------
// Umgebung. Auf der Box liegt die Konfiguration in /etc/metastats-crawler/env,
// lokal in .env.local — dasselbe Muster wie scripts/freeze-marketvalue-peaks.mjs.
// --------------------------------------------------------------------------
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

// Auf der Box zeigt DATABASE_URL auf das lokale Postgres, die Match-Ablage liegt
// aber auf Supabase. Deshalb hat SUPABASE_DB_URL Vorrang; lokal existiert nur
// DATABASE_URL und der zeigt bereits dorthin.
const DB_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('Weder SUPABASE_DB_URL noch DATABASE_URL gesetzt');
  process.exit(1);
}

// Supabase-Passwoerter enthalten oft Zeichen, die in einer URL reserviert sind.
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
  return `${url.slice(0, schemeEnd + 3)}${userinfo.slice(0, colonIdx)}:${encodeURIComponent(userinfo.slice(colonIdx + 1))}${rest}`;
}

const pool = new pg.Pool({
  connectionString: encodePasswordInPgUrl(DB_URL),
  ssl: { rejectUnauthorized: false },
  max: 2,
  statement_timeout: 600_000,
});

// --------------------------------------------------------------------------
// Sperre. Der Marktwert-Dienst benutzt denselben LoL-Key und dasselbe
// Anfrage-Kontingent bei Riot. Laufen beide gleichzeitig, halbiert sich der
// Durchsatz beider und beide kassieren 429er. Die Sperre wird PRO SPIELER
// genommen und danach sofort wieder freigegeben, damit der Marktwert-Lauf
// hoechstens einen Spieler lang wartet und nicht Stunden.
//
// Bewusst KEIN `Conflicts=` in der Unit: das wirkt in beide Richtungen und
// wuerde den Sammler bei jeder Key-Rotation abschiessen.
const LOCK_PATH = process.env.LOL_RIOT_LOCK
  || (existsSync('/run/lock') ? '/run/lock/metastats-lol-riot.lock' : '.lol-riot.lock');
let lockHeld = false;
function acquire() { lockHeld = tryAcquire(LOCK_PATH); return lockHeld; }
function release() { if (lockHeld) { releaseLock(LOCK_PATH); lockHeld = false; } }
process.on('exit', release);
process.on('SIGTERM', () => process.exit(143));
process.on('SIGINT', () => process.exit(130));

// --------------------------------------------------------------------------
// Riot
// --------------------------------------------------------------------------
const RIOT_KEY = process.env.RIOT_API_KEY;
if (!RIOT_KEY && !SHOW_STATUS && !SEED_ONLY) {
  console.error('RIOT_API_KEY nicht gesetzt — ohne Key gibt es nichts zu holen.');
  process.exit(1);
}
const riot = RIOT_KEY ? createRiotClient({ apiKey: RIOT_KEY, log: (m) => log(m) }) : null;

// Ein abgelaufener Key ist der haeufigste Fehlerfall (LoL-Dev-Key laeuft taeglich
// ab). Er darf NICHT als "Spieler hat keine Spiele" durchgehen, sonst waere die
// Warteschlangenzeile faelschlich auf `done`.
class RiotAuthError extends Error {}

async function riotJson(url) {
  const res = await riot.fetch(url, {});
  if (res.status === 401 || res.status === 403) {
    throw new RiotAuthError(`Riot lehnt den Schluessel ab (HTTP ${res.status})`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} bei ${url.split('?')[0]}`);
  return res.json();
}

// '16.17.810.4348' -> { major: 16, minor: 17 }
function parsePatch(gameVersion) {
  const m = String(gameVersion || '').match(/^(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

// --------------------------------------------------------------------------
// Warteschlange
// --------------------------------------------------------------------------
async function seedQueue() {
  // priority = Anzahl der Nutzer, die den Spieler gesucht haben. Oft gesuchte
  // Spieler sind zuerst vollstaendig — bei drei Wochen Erstbefuellung ist die
  // Reihenfolge das Einzige, was der Nutzer ueberhaupt merkt.
  const res = await pool.query(`
    insert into lol_match_fill_queue (puuid, region, priority)
    select p.puuid,
           p.region,
           coalesce(array_length(p.searched_by, 1), 0)
      from players p
     where p.puuid is not null
       and p.region is not null
    on conflict (puuid) do update
       set priority = greatest(lol_match_fill_queue.priority, excluded.priority),
           region   = excluded.region,
           updated_at = now()
    returning (xmax = 0) as inserted
  `);
  const inserted = res.rows.filter(r => r.inserted).length;
  log(`Warteschlange gefuellt: ${inserted} neu, ${res.rowCount - inserted} aktualisiert.`);
}

async function showStatus() {
  const q = await pool.query(`
    select status, count(*)::int as n, sum(matches_cached)::bigint as matches
      from lol_match_fill_queue group by status order by status
  `);
  const c = await pool.query(`
    select count(*)::bigint as rows,
           count(distinct puuid)::bigint as spieler,
           min(game_creation) as aeltestes,
           max(fetched_at)    as zuletzt
      from lol_player_match_cache
  `);
  log('Warteschlange: ' + (q.rows.map(r => `${r.status}=${r.n}`).join(' ') || 'leer'));
  const s = c.rows[0];
  log(`Ablage: ${s.rows} Zeilen / ${s.spieler} Spieler, aeltestes Spiel ${s.aeltestes || '—'}, zuletzt geholt ${s.zuletzt || '—'}`);
}

// Ein abgewuergter Lauf (Deploy, Neustart, SIGKILL) laesst seine Zeile auf
// 'running' stehen — sie wuerde nie wieder gezogen. Der Marktwert-Dienst und
// dieser Sammler stehen bewusst in KEINER der Deploy-Sperrlisten
// (infra/hetzner/remote-deploy.sh crawl_running, metastats-marketvalue-watchdog.sh),
// weil beide stundenlang laufen und sonst jeden Deploy blockieren wuerden.
// Statt den Deploy zu bremsen, raeumt der naechste Lauf hier auf. 3 Stunden,
// weil ein einzelner Spieler hoechstens ~20 Minuten dauert.
async function reclaimStaleClaims() {
  const res = await pool.query(`
    update lol_match_fill_queue
       set status = 'pending', claimed_at = null, updated_at = now(),
           last_error = 'Lauf abgebrochen, Zeile zurueckgelegt'
     where status = 'running'
       and claimed_at < now() - interval '3 hours'
  `);
  if (res.rowCount) log(`${res.rowCount} haengengebliebene Zeile(n) zurueckgelegt.`);
}

// Holt EINEN Spieler aus der Warteschlange. `for update skip locked` sorgt
// dafuer, dass zwei parallele Laeufe nie denselben Spieler ziehen.
async function claimPlayer() {
  const res = await pool.query(`
    update lol_match_fill_queue q
       set status = 'running',
           claimed_at = now(),
           attempts = q.attempts + 1,
           updated_at = now()
     where q.puuid = (
       select puuid from lol_match_fill_queue
        where status = 'pending'
        order by priority desc, updated_at asc
        limit 1
        for update skip locked
     )
    returning q.puuid, q.region, q.attempts
  `);
  return res.rows[0] || null;
}

async function finishPlayer(puuid, status, stats, errorMsg) {
  await pool.query(`
    update lol_match_fill_queue
       set status = $2,
           ids_seen = coalesce($3, ids_seen),
           matches_cached = coalesce($4, matches_cached),
           oldest_match_at = coalesce($5, oldest_match_at),
           newest_match_at = coalesce($6, newest_match_at),
           last_error = $7,
           finished_at = case when $2 in ('done', 'failed') then now() else null end,
           updated_at = now()
     where puuid = $1
  `, [puuid, status, stats?.idsSeen ?? null, stats?.cached ?? null,
      stats?.oldest ?? null, stats?.newest ?? null, errorMsg ?? null]);
}

// --------------------------------------------------------------------------
// Ein Spieler
// --------------------------------------------------------------------------
async function fetchAllIds(routing, puuid) {
  const ids = [];
  for (let start = 0; start < MAX_IDS; start += ID_PAGE) {
    const count = Math.min(ID_PAGE, MAX_IDS - start);
    const page = await riotJson(
      `https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}`,
    );
    if (!Array.isArray(page) || page.length === 0) break;
    ids.push(...page);
    // Riot liefert weniger als angefragt, wenn die Historie zu Ende ist.
    if (page.length < count) break;
  }
  return ids;
}

function buildRow(raw, puuid, region) {
  const info = raw?.info;
  const p = info?.participants?.find((x) => x.puuid === puuid);
  if (!p) return null;                       // Spieler nicht im Match (sollte nicht vorkommen)
  const patch = parsePatch(info.gameVersion);
  if (!patch) return null;                   // ohne Patch keine Saison-Zuordnung — lieber auslassen

  // Dieselben Teamsummen wie app/lib/match-processor.ts:239-242. Sie werden
  // hier einmal gerechnet, damit die Ablage nicht alle zehn Teilnehmer braucht.
  const mates = info.participants.filter((x) => x.teamId === p.teamId);
  const sum = (f) => mates.reduce((s, x) => s + (x[f] || 0), 0);

  return [
    puuid,
    raw.metadata.matchId,
    region,
    info.queueId || 0,
    new Date(info.gameCreation || info.gameStartTimestamp || 0),
    info.gameDuration || 0,
    patch.major,
    patch.minor,
    String(info.gameVersion || ''),
    Boolean(p.win),
    p.championName || '',
    p.individualPosition || p.teamPosition || 'UNKNOWN',
    sum('kills'),
    sum('totalDamageDealtToChampions'),
    sum('goldEarned'),
    JSON.stringify(p),
  ];
}

const COLS = [
  'puuid', 'match_id', 'region', 'queue_id', 'game_creation', 'game_duration',
  'patch_major', 'patch_minor', 'game_version', 'win', 'champion', 'role',
  'team_kills', 'team_damage', 'team_gold', 'participant',
];

async function insertRows(rows) {
  if (rows.length === 0) return 0;
  const values = [];
  const params = [];
  rows.forEach((row, r) => {
    values.push('(' + row.map((_, c) => `$${r * COLS.length + c + 1}`).join(',') + ')');
    params.push(...row);
  });
  // `do nothing`: ein zweiter Lauf ueber denselben Spieler darf nicht scheitern
  // und soll auch nichts ueberschreiben — was einmal geholt wurde, bleibt.
  const res = await pool.query(
    `insert into lol_player_match_cache (${COLS.join(',')}) values ${values.join(',')}
     on conflict (puuid, match_id) do nothing`,
    params,
  );
  return res.rowCount;
}

async function fillPlayer(puuid, region) {
  const norm = normalizeRegion(region);
  if (!isValidRegion(norm)) throw new Error(`Unbekannte Region "${region}"`);
  const routing = getRegionalRouting(norm);

  const ids = await fetchAllIds(routing, puuid);
  log(`  Riot nennt ${ids.length} Spiele`);

  const known = await pool.query('select match_id from lol_player_match_cache where puuid = $1', [puuid]);
  const have = new Set(known.rows.map(r => r.match_id));
  const missing = ids.filter(id => !have.has(id));
  log(`  davon ${have.size} schon da, ${missing.length} zu holen`);

  if (DRY_RUN) return { idsSeen: ids.length, cached: have.size, oldest: null, newest: null };

  let batch = [];
  let written = 0;
  let skipped = 0;
  for (const id of missing) {
    const raw = await riotJson(`https://${routing}.api.riotgames.com/lol/match/v5/matches/${id}`);
    if (!raw) { skipped++; continue; }
    const row = buildRow(raw, puuid, norm);
    if (!row) { skipped++; continue; }
    batch.push(row);
    if (batch.length >= INSERT_BATCH) {
      written += await insertRows(batch);
      batch = [];
      log(`  ${written}/${missing.length} geschrieben`);
    }
  }
  if (batch.length) written += await insertRows(batch);
  if (skipped) log(`  ${skipped} Spiele ausgelassen (kein Teilnehmer-Datensatz oder keine Patch-Angabe)`);

  const agg = await pool.query(`
    select count(*)::int as n, min(game_creation) as oldest, max(game_creation) as newest
      from lol_player_match_cache where puuid = $1
  `, [puuid]);
  const a = agg.rows[0];
  log(`  fertig: ${a.n} Spiele in der Ablage (${a.oldest?.toISOString?.().slice(0, 10)} bis ${a.newest?.toISOString?.().slice(0, 10)})`);
  return { idsSeen: ids.length, cached: a.n, oldest: a.oldest, newest: a.newest };
}

// --------------------------------------------------------------------------
async function main() {
  if (SHOW_STATUS) { await showStatus(); return 0; }
  if (DO_SEED) { await seedQueue(); if (SEED_ONLY) return 0; }

  // Einzelspieler-Modus fuer Rauchtests — laeuft an der Warteschlange vorbei.
  if (ONE_PUUID) {
    if (!ONE_REGION) { console.error('--puuid braucht auch --region'); return 1; }
    if (!acquire()) { log(`Sperre ${LOCK_PATH} ist belegt — nichts getan.`); return 0; }
    try { await fillPlayer(ONE_PUUID, ONE_REGION); } finally { release(); }
    return 0;
  }

  await reclaimStaleClaims();

  let done = 0;
  for (let i = 0; i < PLAYER_BUDGET; i++) {
    const row = await claimPlayer();
    if (!row) { log('Warteschlange leer — nichts zu tun.'); break; }

    if (!acquire()) {
      // Der Marktwert-Lauf haelt den Key gerade. Zeile zuruecklegen, nicht
      // als Fehlversuch zaehlen — sonst fiele sie nach genug Kicks auf `failed`.
      await pool.query(
        `update lol_match_fill_queue set status='pending', attempts = greatest(attempts - 1, 0),
                claimed_at = null, updated_at = now() where puuid = $1`, [row.puuid]);
      log(`Sperre ${LOCK_PATH} ist belegt — ${row.puuid.slice(0, 8)}… zurueckgelegt.`);
      break;
    }

    log(`Spieler ${row.puuid.slice(0, 8)}… (${row.region}, Versuch ${row.attempts})`);
    try {
      const stats = await fillPlayer(row.puuid, row.region);
      await finishPlayer(row.puuid, 'done', stats, null);
      done++;
    } catch (err) {
      if (err instanceof RiotAuthError) {
        // Der Key ist weg. Zeile zurueck auf `pending`, damit der naechste Lauf
        // nach der Key-Rotation genau hier weitermacht, und laut abbrechen.
        await pool.query(
          `update lol_match_fill_queue set status='pending', claimed_at=null,
                  last_error=$2, updated_at=now() where puuid=$1`, [row.puuid, err.message]);
        log(`ABBRUCH: ${err.message}`);
        release();
        return 1;
      }
      await finishPlayer(row.puuid, 'failed', null, String(err.message).slice(0, 500));
      log(`FEHLER bei ${row.puuid.slice(0, 8)}…: ${err.message}`);
    } finally {
      release();
    }
  }

  log(`Lauf beendet: ${done} Spieler abgearbeitet.`);
  return 0;
}

main()
  .then(async (code) => { await pool.end(); process.exit(code); })
  .catch(async (err) => { console.error('ERROR:', err.stack || err.message); await pool.end(); process.exit(1); });
