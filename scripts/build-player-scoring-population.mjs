#!/usr/bin/env node
// Bezugswerte der Spieler-Bewertung im Vergleich (/tft/compare, Plan
// 2026-10-26), naechtlich auf der Box (metastats-player-scoring.timer).
//
// 1. Raenge nachtragen: offene Lobbys (tft_match_lobby, 0105) bekommen je
//    Teilnehmer den letzten Ranglisten-Stand VOR dem Spiel (tft_ladder_daily,
//    hoechstens 48 h alt, gleiches Set). Staende nach dem Spiel bleiben
//    draussen — sie kennen das Ergebnis schon. Ein passender Stand liegt also
//    immer schon vor, wenn die Lobby erfasst wird; 48 h nach dem Spiel kann
//    keiner mehr dazukommen. Dann wird die Lobby eingefroren und nie wieder
//    angefasst (Rangliste haelt 10 Tage, collect-tft-ladder.mjs).
// 2. Bezugsgruppe: bewertete Marktwert-Spieler (rated = ab Diamant II), per
//    md5 gezogen, mit ihren Set-Spielen ab Tag REF_SKIP_SET_DAYS nach
//    Set-Start (davor spielen sie nach dem Rang-Reset in schwaecheren Lobbys).
// 3. Bezugswerte je (Region, Patch) bauen (tft-player-scoring.mjs) und in EINER
//    Transaktion tauschen. Ohne Zeile „alle Regionen, ganzes Set" wird nichts
//    geschrieben — die alten Werte bleiben stehen.
//
// Flags:
//   --dry-run          nichts schreiben (auch keine Raenge), nur rechnen und melden
//   --max-players N    Bezugsspieler (Standard 1200, Speichergrenze der Unit 500 MB)
//   --max-lobbies N    Lobbys fuer das Lobby-Modell (Standard 80000)

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

const { loadCurrentSet, loadSetStartDate } = await import('./lib/current-set.mjs');
const S = await import('./lib/tft-player-scoring.mjs');

const args = process.argv.slice(2);
const argVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes('--dry-run');
const MAX_PLAYERS = Number(argVal('--max-players') ?? 1200);
const MAX_LOBBIES = Number(argVal('--max-lobbies') ?? 80000);
const LOCK = 'metastats-player-scoring';
const FREEZE_AFTER_MS = 48 * 3_600_000;
const RESOLVE_BATCH = 500;
const PLAYER_BATCH = 50;
const LOBBY_PAGE = 2000;
const RANKED_QUEUE = 1100;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL fehlt'); process.exit(1); }
if (!Number.isInteger(MAX_PLAYERS) || MAX_PLAYERS < 1 || !Number.isInteger(MAX_LOBBIES) || MAX_LOBBIES < 1) {
  console.error('--max-players / --max-lobbies brauchen eine positive ganze Zahl');
  process.exit(1);
}
const SET = loadCurrentSet();
if (!SET) { console.error('Aktuelles Set unbekannt'); process.exit(1); }

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 1, statement_timeout: 300_000 });
pool.on('error', (e) => console.error(`DB-Verbindung verworfen: ${e.message}`));
const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);
const mb = () => `${Math.round(process.memoryUsage().rss / 1e6)} MB`;

// Letzter Stand vor dem Spiel je Teilnehmer, hoechstens 48 h alt, gleiches Set.
const RANK_SQL = `
  with p as (
    select l.match_id, l.set_number, (e.ord - 1)::int as idx, e.v->>'p' as puuid, l.region,
           to_timestamp(l.game_datetime / 1000.0) as at
      from tft_match_lobby l
     cross join lateral jsonb_array_elements(l.participants) with ordinality as e(v, ord)
     where l.match_id = any($1::text[])
  )
  select p.match_id, p.idx, d.tier, d.rank, d.lp
    from p
    join lateral (
      select t.tier, t.rank, t.lp from tft_ladder_daily t
       where t.puuid = p.puuid and t.region = p.region and t.set_number = p.set_number
         and t.fetched_at <= p.at and t.fetched_at >= p.at - interval '48 hours'
       order by t.fetched_at desc limit 1
    ) d on true`;

const UPDATE_SQL = `
  update tft_match_lobby l
     set ranks = v.r, known_count = v.k, ranks_resolved_at = now(), ranks_frozen = v.f
    from jsonb_to_recordset($1::jsonb) as v(m text, r jsonb, k int, f boolean)
   where l.match_id = v.m`;

async function resolveRanks(db) {
  let lastAt = -1;
  let lastId = '';
  let seen = 0, frozen = 0, known = 0;
  for (;;) {
    const { rows: open } = await db.query(
      `select match_id, game_datetime from tft_match_lobby
        where not ranks_frozen and set_number = $1 and (game_datetime, match_id) > ($2::bigint, $3::text)
        order by game_datetime, match_id limit $4`,
      [SET, lastAt, lastId, RESOLVE_BATCH],
    );
    if (open.length === 0) break;
    lastAt = Number(open[open.length - 1].game_datetime);
    lastId = open[open.length - 1].match_id;
    const { rows } = await db.query(RANK_SQL, [open.map((r) => r.match_id)]);
    const ranks = S.lobbyRanks(rows);
    const now = Date.now();
    const upd = open.map(({ match_id, game_datetime }) => {
      const r = ranks.get(match_id) || new Array(8).fill(null);
      const k = r.filter((v) => v != null).length;
      const f = now - Number(game_datetime) > FREEZE_AFTER_MS;
      if (f) frozen++;
      if (k >= S.KNOWN_MIN_RANKS) known++;
      return { m: match_id, r, k, f };
    });
    seen += open.length;
    if (!DRY) await db.query(UPDATE_SQL, [JSON.stringify(upd)]);
  }
  log(`Raenge: ${seen} offene Lobbys, ${known} davon bekannt (≥ ${S.KNOWN_MIN_RANKS}/8), ${frozen} eingefroren${DRY ? ' (dry-run, nicht geschrieben)' : ''}`);
}

async function loadLobbies(db, ctx) {
  const { rows: [{ n }] } = await db.query(
    'select count(*)::int as n from tft_match_lobby where set_number = $1 and known_count >= $2',
    [SET, S.KNOWN_MIN_RANKS],
  );
  const keep = Math.min(1, MAX_LOBBIES / Math.max(1, n));
  const out = [];
  let last = '';
  for (;;) {
    const { rows } = await db.query(
      `select match_id, region, game_datetime, participants, ranks from tft_match_lobby
        where set_number = $1 and known_count >= $2 and match_id > $3
        order by match_id limit $4`,
      [SET, S.KNOWN_MIN_RANKS, last, LOBBY_PAGE],
    );
    if (rows.length === 0) break;
    last = rows[rows.length - 1].match_id;
    for (const row of rows) {
      if (keep < 1 && S.seedOf(row.match_id) / 4294967296 >= keep) continue;
      const e = S.lobbyEntry(row, row.participants[0]?.p, ctx);
      if (!e || !e.lpts) continue;
      out.push({ region: row.region, patch: S.patchOfGame(Number(row.game_datetime), ctx), lpts: e.lpts, placements: e.placements, carries: e.carries });
    }
  }
  log(`Lobby-Modell: ${out.length} von ${n} bekannten Lobbys (${mb()})`);
  return out;
}

async function loadReference(db, ctx) {
  const { rows: refs } = await db.query(
    `select puuid, region from (
       select distinct on (puuid) puuid, region, rated
         from tft_player_marketvalue_snapshots
        where snapshot_date >= current_date - 3
        order by puuid, snapshot_date desc
     ) s
     where rated
     order by md5(puuid)
     limit $1`,
    [MAX_PLAYERS],
  );
  const setStart = Date.parse(`${loadSetStartDate()}T00:00:00Z`);
  const from = Number.isFinite(setStart) ? setStart + S.REF_SKIP_SET_DAYS * 86_400_000 : 0;
  const players = [];
  let games = 0, withLobby = 0;
  for (let i = 0; i < refs.length; i += PLAYER_BATCH) {
    const part = refs.slice(i, i + PLAYER_BATCH);
    const { rows } = await db.query(
      `select puuid, match_id, region, game_datetime, placement, level, last_round, gold_left,
              total_damage, players_eliminated, units, traits
         from tft_player_match_cache
        where puuid = any($1::text[]) and set_number = $2 and queue_id = $3 and game_datetime >= $4`,
      [part.map((r) => r.puuid), SET, RANKED_QUEUE, from],
    );
    const ids = [...new Set(rows.map((r) => r.match_id))];
    const { rows: lobbies } = ids.length
      ? await db.query(
        `select match_id, region, game_datetime, participants, ranks from tft_match_lobby
          where match_id = any($1::text[]) and known_count >= $2`,
        [ids, S.KNOWN_MIN_RANKS],
      )
      : { rows: [] };
    const lobbyById = new Map(lobbies.map((l) => [l.match_id, l]));
    const byPlayer = new Map();
    for (const r of rows) {
      const list = byPlayer.get(r.puuid) || [];
      list.push(r);
      byPlayer.set(r.puuid, list);
    }
    for (const ref of part) {
      const list = (byPlayer.get(ref.puuid) || []).sort((a, b) => Number(b.game_datetime) - Number(a.game_datetime));
      if (list.length === 0) continue;
      const entries = list.map((r) => {
        const lobbyRow = lobbyById.get(r.match_id);
        const lobby = lobbyRow ? S.lobbyEntry(lobbyRow, ref.puuid, ctx) : null;
        if (lobby) withLobby++;
        return { f: S.gameFeatures(S.gameFromCacheRow(r), ctx), lobby };
      });
      games += entries.length;
      players.push({ puuid: ref.puuid, region: ref.region, entries });
    }
  }
  log(`Bezugsgruppe: ${players.length} Spieler (von ${refs.length} gezogen), ${games} Spiele, ${withLobby} mit bekannter Lobby (${mb()})`);
  return players;
}

function report(rows) {
  const all = rows.find((r) => r.region === 'all' && r.patch === '*');
  log(`Zeilen: ${rows.length} (${rows.map((r) => `${r.region}|${r.patch}`).join(', ')})`);
  if (!all) return;
  const lm = all.dists.lobby;
  log(`Lobby-Modell: ${lm ? `β ${lm.beta} (SE ${lm.se}), ${lm.lobbies} Lobbys, ${lm.buckets.length} E-Stufen, π ${JSON.stringify(lm.pi)}` : 'keins (zu wenig oder zu unsicher)'}`);
  log(`Schaden ${all.dists.dmg ? 'geliefert' : 'nicht geliefert'}, K.o.s ${all.dists.elim ? 'geliefert' : 'nicht geliefert'}`);
  for (const [id, d] of Object.entries(all.dists.players || {})) {
    if (!d) continue;
    log(`  ${id}: n=${d.n} p5=${d.q[5]} p50=${d.q[50]} p95=${d.q[95]}`);
  }
}

async function writeRows(db, rows) {
  if (!rows.some((r) => r.region === 'all' && r.patch === '*')) {
    log('keine Zeile „alle, ganzes Set" — nichts geschrieben, alte Werte bleiben');
    return;
  }
  await db.query('begin');
  try {
    await db.query("set local statement_timeout = '120s'");
    await db.query('delete from tft_player_scoring_population where set_number = $1', [SET]);
    for (const r of rows) {
      await db.query(
        `insert into tft_player_scoring_population (region, set_number, patch, computed_at, dists)
         values ($1, $2, $3, now(), $4::jsonb)`,
        [r.region, SET, r.patch, JSON.stringify(r.dists)],
      );
    }
    await db.query('commit');
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  }
  log(`geschrieben: ${rows.length} Zeilen fuer Set ${SET}`);
}

async function main() {
  const db = await pool.connect();
  try {
    const { rows: [{ ok }] } = await db.query("select to_regclass('public.tft_match_lobby') is not null as ok");
    if (!ok) { log('Migration 0105 fehlt — nichts zu tun'); return; }
    const { rows: [{ locked }] } = await db.query('select pg_try_advisory_lock(hashtext($1)) as locked', [LOCK]);
    if (!locked) { log('laeuft schon — Abbruch'); return; }
    try {
      const t0 = Date.now();
      await resolveRanks(db);
      const ctx = S.loadScoringContext(SET);
      const lobbies = await loadLobbies(db, ctx);
      const players = await loadReference(db, ctx);
      const rows = S.buildPopulation(players, lobbies, ctx);
      report(rows);
      if (!DRY) await writeRows(db, rows);
      log(`fertig in ${Math.round((Date.now() - t0) / 1000)} s (${mb()})`);
    } finally {
      await db.query('select pg_advisory_unlock(hashtext($1))', [LOCK]).catch(() => {});
    }
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
