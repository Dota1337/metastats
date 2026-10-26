// Box-Endpunkt POST /player-scoring (refresh-api-server.mjs) fuer die
// Spieler-Bewertung im Vergleich /tft/compare (Plan 2026-10-26).
//
// Ablauf je Spieler:
//   0. Konto bei Riot pruefen (wie /refresh-player) — erfundene Kennungen
//      wuerden sonst Zustandszeilen im Match-Cache anlegen.
//   1. Match-Cache auffrischen (Set-Spiele, hoechstens 200 IDs, nicht oefter als
//      alle 15 Minuten), ueber den gemeinsamen Refresh des Servers. Hoechstens
//      SCORING_BUDGET_MS warten; dauert es laenger, wird mit dem vorhandenen
//      Stand gerechnet und `refreshing: true` gemeldet.
//   2. Rechnen (tft-player-scoring.mjs), hoechstens MAX_PARALLEL gleichzeitig,
//      Ergebnis 5 Minuten aufheben.
// Ohne Bezugswerte (Nachtlauf noch nicht gelaufen, 0105 fehlt):
// { available: false } — die Seite zeigt dann den Block nicht.

import { loadCurrentSet, loadSetStartDate } from './current-set.mjs';
import * as S from './tft-player-scoring.mjs';

export const SCORING_BUDGET_MS = 10_000;
export const RESULT_TTL_MS = 5 * 60_000;
export const REFRESHING_TTL_MS = 20_000;
export const POP_TTL_MS = 10 * 60_000;
export const MAX_PARALLEL = 2;
export const MAX_GAMES = 600;
export const REFRESH_MAX_IDS = 200;
export const REFRESH_MAX_STALE_MIN = 15;
const MAX_RESULTS = 500;
const PUUID_RE = /^[A-Za-z0-9_-]{20,100}$/;
const RANKED_QUEUE = 1100;

const fail = (status, message) => Object.assign(new Error(message), { status });
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });

/**
 * @param {{
 *   pool: { query: Function },
 *   riot: { fetchJson: Function },
 *   regionalOf: (region: string) => string | undefined,
 *   accountRoutingOf: (region: string) => string,
 *   refreshCache: (puuid: string, region: string, opts: object) => Promise<unknown>,
 *   now?: () => number, setOf?: () => number | null, root?: string, budgetMs?: number,
 * }} deps
 */
export function createPlayerScoring(deps) {
  const {
    pool, riot, regionalOf, accountRoutingOf, refreshCache,
    now = Date.now, setOf = loadCurrentSet, root = process.cwd(), budgetMs = SCORING_BUDGET_MS,
  } = deps;
  const results = new Map();
  const computing = new Map();
  const popCache = new Map();
  let running = 0;
  const waiting = [];

  async function limited(fn) {
    while (running >= MAX_PARALLEL) await new Promise((r) => waiting.push(r));
    running++;
    try {
      return await fn();
    } finally {
      running--;
      waiting.shift()?.();
    }
  }

  async function populationRows(set) {
    const hit = popCache.get(set);
    if (hit && now() - hit.at < POP_TTL_MS) return hit.rows;
    let rows = [];
    try {
      ({ rows } = await pool.query(
        'select region, patch, computed_at, dists from tft_player_scoring_population where set_number = $1',
        [set],
      ));
    } catch (e) {
      if (e?.code !== '42P01') throw e;   // Tabelle fehlt: 0105 nicht eingespielt
    }
    popCache.set(set, { at: now(), rows });
    return rows;
  }

  async function compute(puuid, region, set) {
    const rows = await populationRows(set);
    const ctx = S.loadScoringContext(set, root);
    const pop = S.populationLookup(rows, region, ctx);
    if (pop.empty) return { available: false, reason: 'no_population', set };
    const { rows: games } = await pool.query(
      `select match_id, region, game_datetime, placement, level, last_round, gold_left,
              total_damage, players_eliminated, units, traits
         from tft_player_match_cache
        where puuid = $1 and set_number = $2 and queue_id = $3
        order by game_datetime desc
        limit $4`,
      [puuid, set, RANKED_QUEUE, MAX_GAMES],
    );
    const ids = games.map((g) => g.match_id);
    const { rows: lobbies } = ids.length
      ? await pool.query(
        'select match_id, region, game_datetime, participants, ranks from tft_match_lobby where match_id = any($1::text[])',
        [ids],
      )
      : { rows: [] };
    const lobbyById = new Map(lobbies.map((l) => [l.match_id, l]));
    const entries = games.map((r) => {
      const l = lobbyById.get(r.match_id);
      return { f: S.gameFeatures(S.gameFromCacheRow(r), ctx), lobby: l ? S.lobbyEntry(l, puuid, ctx) : null };
    });
    const all = rows.find((r) => r.region === 'all' && r.patch === '*');
    const populationAt = rows.reduce((m, r) => (r.computed_at && new Date(r.computed_at) > m ? new Date(r.computed_at) : m), new Date(0));
    return {
      available: true,
      set,
      populationAt: populationAt.toISOString(),
      damageAvailable: !!all?.dists?.dmg,
      elimAvailable: !!all?.dists?.elim,
      lobbyModel: !!pop.lobby(entries[0]?.f.patch ?? null),
      ...S.scorePlayer(entries, pop, ctx, { puuid }),
    };
  }

  async function run(puuid, region, set, key) {
    // Ohne Bezugswerte gibt es nichts zu bewerten — dann auch keinen Riot-Abruf.
    const pre = S.populationLookup(await populationRows(set), region, S.loadScoringContext(set, root));
    if (pre.empty) return { available: false, reason: 'no_population', set };

    const acct = await riot.fetchJson(
      `https://${accountRoutingOf(region)}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`,
      { safe: true },
    );
    const riotOk = !!acct && !acct._status;
    if (!riotOk && (acct?._status === 400 || acct?._status === 404)) throw fail(404, 'unknown_player');

    let refreshing = false;
    if (riotOk) {
      const start = Date.parse(`${loadSetStartDate(root)}T00:00:00Z`);
      const refresh = Promise.resolve().then(() => refreshCache(puuid, region, {
        startTimeSec: Number.isFinite(start) ? Math.floor(start / 1000) : undefined,
        maxIds: REFRESH_MAX_IDS,
        maxStaleMinutes: REFRESH_MAX_STALE_MIN,
      }));
      const outcome = await Promise.race([
        refresh.then(() => 'done', () => 'failed'),
        sleep(budgetMs).then(() => 'timeout'),
      ]);
      refreshing = outcome === 'timeout';
    }

    const value = await limited(() => compute(puuid, region, set));
    // Riot nicht erreichbar und nichts im Cache: ehrlich „nicht verfuegbar"
    // statt einer Bewertung aus null Spielen.
    if (!riotOk && value.available && value.games === 0) throw fail(503, 'riot_unavailable');
    value.refreshing = refreshing;
    if (results.size >= MAX_RESULTS) {
      for (const [k, v] of results) if (now() - v.at >= RESULT_TTL_MS) results.delete(k);
      if (results.size >= MAX_RESULTS) results.delete(results.keys().next().value);
    }
    results.set(key, { at: now(), value });
    return value;
  }

  async function handle(body) {
    const puuid = typeof body?.puuid === 'string' ? body.puuid : '';
    const region = typeof body?.region === 'string' ? body.region : '';
    if (!PUUID_RE.test(puuid)) throw fail(400, 'puuid required');
    if (!regionalOf(region)) throw fail(400, 'unknown region');
    const set = setOf();
    if (set == null) throw fail(503, 'no current set');
    const key = `${puuid}|${region}|${set}`;
    const hit = results.get(key);
    if (hit && now() - hit.at < (hit.value.refreshing ? REFRESHING_TTL_MS : RESULT_TTL_MS)) return hit.value;
    if (computing.has(key)) return computing.get(key);
    const p = run(puuid, region, set, key).finally(() => computing.delete(key));
    computing.set(key, p);
    return p;
  }

  return { handle };
}
