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
 *   node scripts/collect-lol-matches.mjs --rank-only --rank-calls 50   # nur Rang-Stichprobe
 *
 * Rang-Stichprobe (fuer die Champion-Builds je Rang, /champions/[id]):
 * Mit --rank-calls N wechselt sich nach jedem Spieler ein Rang-Zyklus mit
 * hoechstens N Riot-Anfragen ab. Er zieht Spieler aus der EUW-Rangliste
 * (Emerald bis Challenger), holt ihre juengsten Ranked-Solo-Spiele und legt ALLE
 * zehn Teilnehmer im Box-Postgres ab (lol_match_participant_raw, Migration 0082).
 * Auch die Spieler-Historie oben legt ihre Ranked-Solo-Spiele des aktuellen und
 * vorigen Patches dort ab. Verdichtet wird das von scripts/aggregate-lol-builds.mjs.
 * Die Stichprobe ist pro Stufe gedeckelt (RANK_QUOTA), nicht nach Spielerzahl
 * gewichtet — Master+ ist in "Emerald+" damit bewusst ueberrepraesentiert.
 * --no-rank schaltet sie ab.
 *
 * Laufzeit: Riot erlaubt 100 Anfragen pro 2 Minuten fuer den ganzen Key; der
 * Sammler nimmt sich davon 35 (LOL_DEV_KEY_BATCH), der Rest bleibt der Live-Seite.
 * Ein Spieler mit ~950 Spielen dauert damit rund 55 Minuten — mehr als etwa 25
 * Spieler am Tag sind nicht drin. Bei 1.431 Zeilen in `players` (gemessen
 * 2026-09-11) brauchte der erste volle Durchlauf bei 95 rund drei Wochen, bei 35
 * entsprechend knapp dreimal so lange.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

import { createRiotClient } from './lib/riot-client.mjs';
import { LOL_DEV_KEY_BATCH } from './lib/riot-limits.mjs';
import { getRegionalRouting, normalizeRegion, isValidRegion } from './lib/regional-routing.mjs';
import { tryAcquire, releaseLock, wantPending } from './lib/advisory-lock.mjs';
import { recentPatches } from './lib/lol-items.mjs';

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

// Rang-Stichprobe
const RANK_ONLY = hasFlag('--rank-only');
const NO_RANK = hasFlag('--no-rank');
const RANK_CALLS = Number(getArg('--rank-calls', RANK_ONLY ? '900' : '0'));
const RANK_REGION = 'euw1';              // User-Entscheid: vorerst nur EUW
const RANK_PENDING_MAX = 2000;           // darueber keine neuen Stichproben-Spieler
const RANK_IDS_PER_PLAYER = 20;
const RANK_CLAIM_BATCH = 20;
// Spieler je Stufe und Nachfuell-Runde.
const RANK_QUOTA = [
  ['EMERALD', 4], ['DIAMOND', 3], ['MASTER', 2], ['GRANDMASTER', 1], ['CHALLENGER', 1],
];
const APEX_PATH = { MASTER: 'masterleagues', GRANDMASTER: 'grandmasterleagues', CHALLENGER: 'challengerleagues' };

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
  // Client-seitige Zeitlimits. Vom 20.09. bis 30.09.2026 hing der Lauf zehn
  // Tage auf einer halb-offenen Verbindung zum Pooler: auf der Box ESTAB, auf
  // der DB-Seite keine Sitzung mehr. statement_timeout allein wirkt dann nicht,
  // weil der Server die Anfrage nie gesehen hat. query_timeout bricht auf der
  // Client-Seite ab, statement_timeout liegt knapp darunter, damit eine echte
  // langsame Abfrage sauber vom Server abgebrochen wird statt die Verbindung
  // zu zerstoeren. keepAlive laesst den Kernel tote Sockets ueberhaupt melden.
  statement_timeout: 110_000,
  query_timeout: 120_000,
  connectionTimeoutMillis: 15_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 30_000,
});
// Pflicht: eine nach dem Timeout weggeworfene Verbindung meldet ihren Fehler
// spaeter ueber den Pool. Ohne Listener stuerzt der Prozess mitten im naechsten
// Spieler ab.
pool.on('error', (err) => log(`DB-Verbindung verworfen: ${err.message}`));

// Zweite Verbindung: das Box-Postgres fuer die Rohdaten der Champion-Builds
// (alle zehn Teilnehmer je Match — zu viel fuer Supabase). Nur auf der Box
// vorhanden: dort zeigt DATABASE_URL lokal und SUPABASE_DB_URL auf Supabase.
// Lokal zeigt DATABASE_URL auf Supabase — dann gibt es keine Rohablage, und
// LOL_RAW_DB_URL kann sie fuer Tests explizit setzen.
const RAW_DB_URL = process.env.LOL_RAW_DB_URL
  || (process.env.SUPABASE_DB_URL && process.env.DATABASE_URL !== process.env.SUPABASE_DB_URL ? process.env.DATABASE_URL : null);
const rawPool = RAW_DB_URL ? new pg.Pool({
  connectionString: encodePasswordInPgUrl(RAW_DB_URL),
  ssl: /@(127\.0\.0\.1|localhost)[:/]/.test(RAW_DB_URL) ? false : { rejectUnauthorized: false },
  max: 2,
  statement_timeout: 110_000,
  query_timeout: 120_000,
  connectionTimeoutMillis: 15_000,
}) : null;
rawPool?.on('error', (err) => log(`Rohablage-Verbindung verworfen: ${err.message}`));

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

// Vorfahrt fuer den Marktwert-Lauf: er meldet sich mit `<lock>.want`, dann
// nimmt der Sammler die Sperre nicht neu, sondern wartet, bis der Lauf durch
// ist (~6 h). Ohne das gewinnt der Sammler jedes Rennen, weil er die Sperre
// nach einer einzigen DB-Abfrage wieder nimmt (siehe advisory-lock.mjs).
const TURN_POLL_MS = 10_000;
const TURN_MAX_WAIT_MS = 8 * 3_600_000;
async function waitForTurn() {
  const start = Date.now();
  let lastLog = 0;
  for (;;) {
    if (!wantPending(LOCK_PATH) && acquire()) return true;
    const waited = Date.now() - start;
    if (waited >= TURN_MAX_WAIT_MS) return false;
    if (waited - lastLog >= 600_000 || lastLog === 0) {
      lastLog = waited || 1;
      log(`warte auf ${LOCK_PATH} (Marktwert-Lauf hat Vorrang, ${Math.round(waited / 60_000)} min).`);
    }
    await new Promise((r) => setTimeout(r, TURN_POLL_MS));
  }
}
process.on('SIGTERM', () => process.exit(143));
process.on('SIGINT', () => process.exit(130));

// --------------------------------------------------------------------------
// Riot
// --------------------------------------------------------------------------
let riotKey = process.env.RIOT_API_KEY;
if (!riotKey && !SHOW_STATUS && !SEED_ONLY) {
  console.error('RIOT_API_KEY nicht gesetzt — ohne Key gibt es nichts zu holen.');
  process.exit(1);
}
let riot = riotKey ? createRiotClient({ ...LOL_DEV_KEY_BATCH, apiKey: riotKey, log: (m) => log(m) }) : null;
let riotCalls = 0;

// Ein abgelaufener Key ist der haeufigste Fehlerfall (LoL-Dev-Key laeuft taeglich
// ab). Er darf NICHT als "Spieler hat keine Spiele" durchgehen, sonst waere die
// Warteschlangenzeile faelschlich auf `done`.
class RiotAuthError extends Error {}
// Riot ueberlastet, 5xx, Netz weg: die Zeile war nicht schuld und geht zurueck
// auf `pending` statt auf `failed`.
class RiotTransientError extends Error {}

// Der Key wird taeglich rotiert (scripts/refresh-riot-key.mjs schreibt die
// Env-Datei und startet den Dienst neu). Liegt schon ein neuer Key in der Datei,
// wird er uebernommen statt den Lauf abzubrechen.
function reloadRiotKey() {
  for (const path of ['/etc/metastats-crawler/env', resolve(process.cwd(), '.env.local')]) {
    if (!existsSync(path)) continue;
    const line = readFileSync(path, 'utf8').split(/\r?\n/).find((l) => l.startsWith('RIOT_API_KEY='));
    const key = line ? line.slice('RIOT_API_KEY='.length).trim() : null;
    if (key && key !== riotKey) {
      riotKey = key;
      riot = createRiotClient({ ...LOL_DEV_KEY_BATCH, apiKey: key, log: (m) => log(m) });
      return true;
    }
    return false;
  }
  return false;
}

async function riotJson(url, keyRetried = false) {
  let res;
  riotCalls++;
  try {
    res = await riot.fetch(url, {});
  } catch (err) {
    throw new RiotTransientError(`Netzfehler bei ${url.split('?')[0]}: ${err.message}`);
  }
  if (res.status === 401 || res.status === 403) {
    if (!keyRetried && reloadRiotKey()) {
      log('Riot lehnt den Schluessel ab — neuer Schluessel aus der Env-Datei geladen, zweiter Versuch.');
      return riotJson(url, true);
    }
    throw new RiotAuthError(`Riot lehnt den Schluessel ab (HTTP ${res.status})`);
  }
  if (res.status === 404) return null;
  if (res.status === 429 || res.status >= 500) {
    throw new RiotTransientError(`HTTP ${res.status} bei ${url.split('?')[0]}`);
  }
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

// Nachhol-Weg (Phase 2): Wer einmal fertig war, spielt weiter — ohne neuen Lauf
// fehlten seine neuen Spiele in der Saison-Analyse, und nach ~950 weiteren
// Spielen gibt Riot die dazwischen gar nicht mehr her. 24 Stunden nach dem
// letzten Lauf kommt er deshalb zurueck in die Warteschlange. fillPlayer holt
// dann nur, was noch fehlt (bekannte IDs werden uebersprungen). updated_at =
// now() stellt ihn hinter alle gleich oft gesuchten, noch nie gefuellten Spieler;
// wer oefter gesucht wurde, hat ueber `priority` weiter Vorrang.
async function requeueFinished() {
  const res = await pool.query(`
    update lol_match_fill_queue
       set status = 'pending', claimed_at = null, updated_at = now()
     where status = 'done'
       and finished_at < now() - interval '24 hours'
  `);
  if (res.rowCount) log(`${res.rowCount} fertige Spieler zum Nachholen neuer Spiele eingereiht.`);
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

// --------------------------------------------------------------------------
// Rohablage fuer die Champion-Builds (Box-Postgres)
// --------------------------------------------------------------------------
let rawPatchFloor = null;                   // {major, minor} des vorigen Patches
async function loadRawPatchFloor() {
  if (!rawPool || rawPatchFloor) return;
  const [, prev] = await recentPatches(2);
  rawPatchFloor = prev;
  log(`Rohablage: nimmt Ranked Solo ab Patch ${prev.major}.${prev.minor}.`);
}
const patchAtLeast = (p, floor) => p.major > floor.major || (p.major === floor.major && p.minor >= floor.minor);

// Reihenfolge der Runen: primary, keystone, p1, p2, p3, secondary, s1, s2, offense, flex, defense
function runeTuple(perks) {
  const [pri, sec] = perks?.styles || [];
  const sel = (st, i) => st?.selections?.[i]?.perk ?? 0;
  const sp = perks?.statPerks || {};
  return [pri?.style ?? 0, sel(pri, 0), sel(pri, 1), sel(pri, 2), sel(pri, 3),
    sec?.style ?? 0, sel(sec, 0), sel(sec, 1), sp.offense ?? 0, sp.flex ?? 0, sp.defense ?? 0];
}

const RAW_COLS = [
  'match_id', 'participant_id', 'puuid', 'region', 'queue_id', 'game_creation', 'game_duration',
  'early_surrender', 'patch_major', 'patch_minor', 'champion_id', 'team_id', 'team_position',
  'win', 'items', 'runes', 'summoners',
];

// null = gehoert nicht in die Rohablage (anderer Modus, zu alter Patch, kaputt).
function buildRawRows(raw, region) {
  const info = raw?.info;
  if (!info || info.queueId !== 420 || !Array.isArray(info.participants) || info.participants.length !== 10) return null;
  const patch = parsePatch(info.gameVersion);
  if (!patch || !rawPatchFloor || !patchAtLeast(patch, rawPatchFloor)) return null;
  const created = new Date(info.gameCreation || info.gameStartTimestamp || 0);
  return info.participants.map((p, i) => [
    raw.metadata.matchId,
    p.participantId || i + 1,
    p.puuid,
    region,
    info.queueId,
    created,
    info.gameDuration || 0,
    Boolean(p.gameEndedInEarlySurrender),
    patch.major,
    patch.minor,
    p.championId || 0,
    p.teamId || 0,
    p.teamPosition || '',
    Boolean(p.win),
    [p.item0, p.item1, p.item2, p.item3, p.item4, p.item5].map((x) => Number(x) || 0),
    runeTuple(p.perks),
    [p.summoner1Id || 0, p.summoner2Id || 0],
  ]);
}

// Rohzeilen schreiben und die Match-Zeile der Rang-Warteschlange auf `done`
// setzen — in EINER Transaktion, damit ein Abbruch nie "done ohne Zeilen"
// hinterlaesst. Ein Match, das die Rang-Stichprobe schon kennt, behaelt dabei
// seinen Rang (seed_tier) — nur der Status wird gesetzt.
async function writeRaw(matchId, region, rows) {
  const client = await rawPool.connect();
  try {
    await client.query('begin');
    if (rows) {
      const values = [];
      const params = [];
      rows.forEach((row, r) => {
        values.push('(' + row.map((_, c) => `$${r * RAW_COLS.length + c + 1}`).join(',') + ')');
        params.push(...row);
      });
      await client.query(
        `insert into lol_match_participant_raw (${RAW_COLS.join(',')}) values ${values.join(',')}
         on conflict (match_id, participant_id) do nothing`, params);
    }
    await client.query(`
      insert into lol_rank_match_queue (match_id, region, status, last_error)
      values ($1, $2, $3, $4)
      on conflict (match_id) do update
         set status = excluded.status, last_error = excluded.last_error,
             claimed_at = null, updated_at = now()`,
      [matchId, region, rows ? 'done' : 'failed', rows ? null : 'kein Ranked Solo / Patch zu alt']);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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

  // Rohablage nur fuer die Region der Rang-Stichprobe: nur dort bekommen Matches
  // einen Rang, und nur dort spart die Ablage der Stichprobe spaeter Anfragen.
  const keepRaw = rawPool && rawPatchFloor && norm === RANK_REGION;
  let batch = [];
  let written = 0;
  let skipped = 0;
  let rawWritten = 0;
  try {
    for (const id of missing) {
      const raw = await riotJson(`https://${routing}.api.riotgames.com/lol/match/v5/matches/${id}`);
      if (!raw) { skipped++; continue; }
      const row = buildRow(raw, puuid, norm);
      if (!row) { skipped++; continue; }
      if (keepRaw) {
        const rawRows = buildRawRows(raw, norm);
        if (rawRows) { await writeRaw(id, norm, rawRows); rawWritten++; }
      }
      batch.push(row);
      if (batch.length >= INSERT_BATCH) {
        written += await insertRows(batch);
        batch = [];
        log(`  ${written}/${missing.length} geschrieben`);
      }
    }
  } finally {
    // Auch bei Abbruch (Key weg, Riot ueberlastet) das schon Geholte behalten.
    if (batch.length) written += await insertRows(batch);
  }
  if (skipped) log(`  ${skipped} Spiele ausgelassen (kein Teilnehmer-Datensatz oder keine Patch-Angabe)`);
  if (rawWritten) log(`  ${rawWritten} Ranked-Solo-Spiele zusaetzlich in die Rohablage`);

  const agg = await pool.query(`
    select count(*)::int as n, min(game_creation) as oldest, max(game_creation) as newest
      from lol_player_match_cache where puuid = $1
  `, [puuid]);
  const a = agg.rows[0];
  log(a.n
    ? `  fertig: ${a.n} Spiele in der Ablage (${a.oldest.toISOString().slice(0, 10)} bis ${a.newest.toISOString().slice(0, 10)})`
    : '  fertig: keine Spiele in der Ablage');
  return { idsSeen: ids.length, cached: a.n, oldest: a.oldest, newest: a.newest };
}

// --------------------------------------------------------------------------
// Rang-Stichprobe
// --------------------------------------------------------------------------
const PLATFORM = `https://${RANK_REGION}.api.riotgames.com`;
const RANK_ROUTING = getRegionalRouting(RANK_REGION);
const leagueCache = new Map();              // Stufe -> Liste von puuids (je Lauf einmal)
const pick = (arr, n) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
};

async function leaguePuuids(tier) {
  if (APEX_PATH[tier]) {
    if (!leagueCache.has(tier)) {
      const l = await riotJson(`${PLATFORM}/lol/league/v4/${APEX_PATH[tier]}/by-queue/RANKED_SOLO_5x5`);
      leagueCache.set(tier, (l?.entries || []).map((e) => e.puuid).filter(Boolean));
    }
    return leagueCache.get(tier);
  }
  // Emerald/Diamond: vier Divisionen mit je vielen Seiten — jedes Mal eine
  // zufaellige Division und eine der ersten drei Seiten (je ~200 Spieler).
  const div = ['I', 'II', 'III', 'IV'][Math.floor(Math.random() * 4)];
  const page = 1 + Math.floor(Math.random() * 3);
  const l = await riotJson(`${PLATFORM}/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${div}?page=${page}`);
  return (Array.isArray(l) ? l : []).map((e) => e.puuid).filter(Boolean);
}

// Beginn des vorigen Patches, damit Riot keine Spiele aelterer Patches nennt.
// Aus der eigenen Ablage; wenn die noch leer ist, 28 Tage (zwei Patches).
let rankStartTime = null;
async function loadRankStartTime() {
  if (rankStartTime) return;
  const r = await rawPool.query(
    `select extract(epoch from min(game_creation))::bigint as t from lol_match_participant_raw
      where patch_major = $1 and patch_minor = $2`, [rawPatchFloor.major, rawPatchFloor.minor]);
  rankStartTime = Number(r.rows[0]?.t) || Math.floor(Date.now() / 1000) - 28 * 86400;
}

async function seedRankQueue() {
  await loadRankStartTime();
  let queued = 0;
  for (const [tier, n] of RANK_QUOTA) {
    const puuids = pick(await leaguePuuids(tier), n);
    for (const puuid of puuids) {
      const ids = await riotJson(
        `https://${RANK_ROUTING}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&startTime=${rankStartTime}&count=${RANK_IDS_PER_PLAYER}`);
      if (!Array.isArray(ids) || ids.length === 0) continue;
      // Neu: pending mit Rang. Schon bekannt ohne Rang (kam ueber die
      // Spieler-Historie): nur den Rang nachtragen, nicht neu abrufen.
      const res = await rawPool.query(`
        insert into lol_rank_match_queue (match_id, region, seed_puuid, seed_tier)
        select unnest($1::text[]), $2, $3, $4
        on conflict (match_id) do update
           set seed_puuid = excluded.seed_puuid, seed_tier = excluded.seed_tier, updated_at = now()
         where lol_rank_match_queue.seed_tier is null`,
        [ids, RANK_REGION, puuid, tier]);
      queued += res.rowCount;
    }
  }
  return queued;
}

// Haengengebliebene Rang-Zeilen: ein Match dauert Sekunden, 30 Minuten
// bedeuten sicher einen abgebrochenen Lauf.
async function reclaimRankClaims() {
  const res = await rawPool.query(`
    update lol_rank_match_queue set status = 'pending', claimed_at = null, updated_at = now()
     where status = 'running' and claimed_at < now() - interval '30 minutes'`);
  if (res.rowCount) log(`Rang: ${res.rowCount} haengengebliebene Match-Zeile(n) zurueckgelegt.`);
}

async function claimRankBatch(n) {
  const res = await rawPool.query(`
    update lol_rank_match_queue q
       set status = 'running', claimed_at = now(), attempts = q.attempts + 1, updated_at = now()
     where q.match_id in (
       select match_id from lol_rank_match_queue
        where status = 'pending' and seed_tier is not null
        order by created_at limit $1
        for update skip locked)
    returning q.match_id, q.region`, [n]);
  return res.rows;
}

async function unclaimRank(ids, msg) {
  if (!ids.length) return;
  await rawPool.query(`
    update lol_rank_match_queue set status = 'pending', claimed_at = null, last_error = $2, updated_at = now()
     where match_id = any($1::text[]) and status = 'running'`, [ids, msg]);
}

// Ein Zyklus: hoechstens `budget` Riot-Anfragen. Wirft RiotAuthError weiter.
async function rankCycle(budget) {
  const stop = riotCalls + budget;
  await reclaimRankClaims();
  let fetched = 0, stored = 0, failed = 0, seeded = 0;
  while (riotCalls < stop) {
    let batch = await claimRankBatch(Math.min(RANK_CLAIM_BATCH, stop - riotCalls));
    if (!batch.length) {
      const { rows } = await rawPool.query(
        `select count(*)::int as n from lol_rank_match_queue where status = 'pending'`);
      if (rows[0].n >= RANK_PENDING_MAX) break;
      const q = await seedRankQueue();
      seeded += q;
      if (!q) break;                        // Rangliste liefert nichts Neues
      continue;
    }
    const open = batch.map((b) => b.match_id);
    try {
      for (const { match_id: id, region } of batch) {
        if (riotCalls >= stop) break;
        const raw = await riotJson(`https://${RANK_ROUTING}.api.riotgames.com/lol/match/v5/matches/${id}`);
        fetched++;
        const rows = raw ? buildRawRows(raw, region) : null;
        await writeRaw(id, region, rows);
        open.splice(open.indexOf(id), 1);
        if (rows) stored++; else failed++;
      }
    } finally {
      // Budget erschoepft, Key weg oder Riot ueberlastet: Rest zurueck auf pending.
      await unclaimRank(open, 'nicht abgearbeitet');
    }
  }
  const { rows } = await rawPool.query(
    `select status, count(*)::int as n from lol_rank_match_queue group by status order by status`);
  log(`Rang: ${fetched} Matches geholt, ${stored} abgelegt, ${failed} verworfen, ${seeded} neu eingereiht — `
    + rows.map((r) => `${r.status}=${r.n}`).join(' '));
}

async function runRankCycle() {
  if (!(await waitForTurn())) {
    log(`Sperre ${LOCK_PATH} nach ${TURN_MAX_WAIT_MS / 3_600_000} h nicht frei — Rang-Zyklus entfaellt.`);
    return 'stop';
  }
  try {
    await rankCycle(RANK_CALLS);
    return 'ok';
  } catch (err) {
    if (err instanceof RiotAuthError) { log(`ABBRUCH: ${err.message}`); return 'auth'; }
    if (err instanceof RiotTransientError) { log(`Rang: Riot antwortet nicht (${err.message}) — naechster Zyklus.`); return 'transient'; }
    throw err;
  } finally {
    release();
  }
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

  // Rohablage vorbereiten. Faellt DDragon aus, laeuft die Spieler-Historie
  // trotzdem weiter — nur ohne Rohablage und Rang-Stichprobe.
  if (rawPool) {
    try { await loadRawPatchFloor(); } catch (err) { log(`Rohablage aus: ${err.message}`); }
  } else if (RANK_ONLY || RANK_CALLS > 0) {
    log('Keine Rohablage konfiguriert (DATABASE_URL lokal / LOL_RAW_DB_URL) — Rang-Stichprobe aus.');
  }
  const rankOn = Boolean(rawPool && rawPatchFloor && RANK_CALLS > 0 && !NO_RANK);

  if (RANK_ONLY) {
    if (!rankOn) return 1;
    const r = await runRankCycle();
    return r === 'auth' ? 1 : 0;
  }

  await reclaimStaleClaims();
  await requeueFinished();

  let done = 0;
  let playersLeft = true;
  let transientStreak = 0;
  for (let i = 0; i < PLAYER_BUDGET; i++) {
    if (playersLeft) {
      // Erst die Sperre, dann die Zeile: wer wartet, haelt keine Zeile fest.
      if (!(await waitForTurn())) {
        log(`Sperre ${LOCK_PATH} nach ${TURN_MAX_WAIT_MS / 3_600_000} h nicht frei — Lauf endet.`);
        break;
      }
      const row = await claimPlayer();
      if (!row) {
        release();
        log(rankOn ? 'Spieler-Warteschlange leer — weiter nur mit der Rang-Stichprobe.' : 'Warteschlange leer — nichts zu tun.');
        playersLeft = false;
        if (!rankOn) break;
      } else {
        log(`Spieler ${row.puuid.slice(0, 8)}… (${row.region}, Versuch ${row.attempts})`);
        try {
          const stats = await fillPlayer(row.puuid, row.region);
          await finishPlayer(row.puuid, 'done', stats, null);
          done++;
          transientStreak = 0;
        } catch (err) {
          if (err instanceof RiotAuthError || err instanceof RiotTransientError) {
            // Key weg oder Riot ueberlastet: der Spieler war nicht schuld. Zeile
            // zurueck auf `pending`, der naechste Lauf macht genau hier weiter.
            await pool.query(
              `update lol_match_fill_queue set status='pending', claimed_at=null,
                      last_error=$2, updated_at=now() where puuid=$1`, [row.puuid, err.message]);
            release();
            if (err instanceof RiotAuthError) { log(`ABBRUCH: ${err.message}`); return 1; }
            log(`Riot antwortet nicht (${err.message}) — Spieler zurueckgelegt.`);
            if (++transientStreak >= 3) { log('Dreimal in Folge keine Antwort von Riot — Lauf endet.'); break; }
            continue;
          }
          await finishPlayer(row.puuid, 'failed', null, String(err.message).slice(0, 500));
          log(`FEHLER bei ${row.puuid.slice(0, 8)}…: ${err.message}`);
        } finally {
          release();
        }
      }
    }

    if (rankOn) {
      const r = await runRankCycle();
      if (r === 'auth') return 1;
      if (r === 'stop') break;
      if (r === 'transient' && ++transientStreak >= 3) { log('Dreimal in Folge keine Antwort von Riot — Lauf endet.'); break; }
    }
  }

  log(`Lauf beendet: ${done} Spieler abgearbeitet.`);
  return 0;
}

const endPools = () => Promise.all([pool.end(), rawPool?.end()]).catch(() => {});
main()
  .then(async (code) => { await endPools(); process.exit(code); })
  .catch(async (err) => { console.error('ERROR:', err.stack || err.message); await endPools(); process.exit(1); });
