// Shared Marktwert-Pipeline-Library — extrahiert aus collect-tft-marketvalues.mjs.
//
// Zwei Driver konsumieren das hier:
//   • scripts/collect-tft-marketvalues.mjs (alter Cold-Sweep + Population-Build)
//   • scripts/daily-marketvalue-snapshot.mjs (neuer Daily-Lauf, Phase A4)
//
// Die Funktionen sind bewusst pool/riot/ctx-driven (keine globalen Module-State),
// damit beide Driver dieselben Code-Pfade nutzen ohne Verhalten zu kopieren.
//
// Memory-Anker:
//   • reference_marketvalue_skill_score_spec.md — wieso die Population pro Region
//     persistiert wird und welche Felder agents jsonb enthält.
//   • reference_crawler_architecture.md — wo dieses Lib in der Hetzner-Pipeline lebt.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeBaseValue } from './tft-marketvalue.mjs';
import { extractRawMetrics, scoreSkill } from './tft-skill-score.mjs';
import { refreshPlayerMatchCache, listSeasonMatches } from './tft-match-cache-pg.mjs';
import { upsertSeasonStats } from './tft-season-aggregator.mjs';

// Platform-Routing → regional cluster (für Account-V1 + Match-V1). Single-Source
// in ./regional-routing.mjs (Audit drift-#5). Re-Export hält die bestehende API
// (REGIONAL_CLUSTER + getRegionalCluster) für collect-tft-marketvalues +
// daily-marketvalue-snapshot erhalten.
export {
  REGIONAL_ROUTING as REGIONAL_CLUSTER,
  getRegionalRouting as getRegionalCluster,
} from './regional-routing.mjs';

// Aktuelles Set aus public/tft-set.json laden — Single-Source-of-Truth fürs
// Setnummer-Lookup. Returns null wenn das File fehlt oder kaputt ist.
export function loadCurrentSet(repoRoot = process.cwd()) {
  const path = resolve(repoRoot, 'public', 'tft-set.json');
  if (!existsSync(path)) return null;
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    return j.currentSet?.number ?? j.setNumber ?? null;
  } catch { return null; }
}

// Optional Knowledge-Graph für eine Region — region-spezifisch, daher kein
// Default-Pfad. Driver lädt das selbst und gibt's via ctx an gatherPlayer weiter.
export function loadGraph(region, repoRoot = process.cwd()) {
  const path = resolve(repoRoot, 'public', `tft-graph-${region}.json`);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

// Account-Lookup für game_name + tag_line. Wird in snapshotPlayer aufgerufen.
// Returns null bei Fehler (snapshot bleibt mit name/tag = null geschrieben).
export async function fetchAccount(riot, regional, puuid, apiKey) {
  const r = await riot.fetchJson(
    `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}?api_key=${apiKey}`,
    { safe: true },
  );
  if (!r || r._status) return null;
  return { gameName: r.gameName || null, tagLine: r.tagLine || null };
}

/**
 * Pass 1 — refresh den Match-Cache des Spielers und extrahiere die Roh-Metriken
 * für die spätere Population-Berechnung.
 *
 * @param {pg.Pool} pool
 * @param {ReturnType<typeof createRiotClient>} riot
 * @param {{ puuid: string, wins?: number, losses?: number, tier?: string, rank?: string, lp?: number, ladderRank?: number }} player
 * @param {{
 *   region: string,
 *   regional: string,
 *   setNumber: number,
 *   hotCompKeys?: Set<string>,
 *   recommendedItems?: Record<string, string[]>,
 *   startTimeSec?: number,        // Riot match-V1 startTime — filtert Set-Range
 *   maxIds?: number,              // Cap fürs Cold-Backfill
 *   concurrency?: number,         // Match-Detail-Fetch-Concurrency (default 6)
 *   force?: boolean,              // Force-Refresh (ignoriert recent-staleness-check)
 *   skipCacheRefresh?: boolean,   // Cache-Refresh ganz überspringen (z.B. wenn anderer Lauf das macht)
 *   verbose?: boolean,
 * }} ctx
 * @returns {Promise<{ skip?: boolean, sampleSize: number, raw?: any }>}
 */
export async function gatherPlayer(pool, riot, player, ctx) {
  const {
    region, regional, setNumber, hotCompKeys, recommendedItems,
    startTimeSec, maxIds, concurrency = 6,
    force = false, skipCacheRefresh = false, verbose = false,
  } = ctx;

  if (!skipCacheRefresh) {
    await refreshPlayerMatchCache(pool, player.puuid, region, regional, riot, {
      force,
      startTimeSec,
      maxIds,
      concurrency,
      log: verbose ? (msg) => console.log(`    ${msg}`) : undefined,
    });
  }
  const matches = await listSeasonMatches(pool, player.puuid, setNumber);
  // Season-Stats immer schreiben (auch <5 → 0-sample-row die UI ehrlich zeigt)
  await upsertSeasonStats(pool, player.puuid, region, setNumber, {
    matches, hotCompKeys, recommendedItems,
  });
  if (matches.length < 5) return { skip: true, sampleSize: matches.length };
  return {
    raw: extractRawMetrics(matches, { wins: player.wins, losses: player.losses }, null),
    sampleSize: matches.length,
  };
}

/**
 * Persistiere die Population (medians + expected_dmg + comp_meta) für eine
 * Region/Set-Kombination auf Hetzner-PG und spiegele optional nach Supabase.
 *
 * Wird vom alten Crawler nach Pass-1 + buildPopulation aufgerufen. Der neue
 * Daily-Lauf wird das täglich aus der aktiven Sub-Kohorte neu berechnen
 * (siehe Verdict metastats-architect: 7-Tage-Drift ohne tägliche Re-Calc).
 *
 * @param {pg.Pool} pool
 * @param {string} region
 * @param {number} setNumber
 * @param {{ medians: any, expectedDmg: any }} pop
 * @param {Map<string, { avgPlacement: number, games: number }>} compMeta
 * @param {number} playerCount
 * @param {{ supaUrl?: string|null, supaKey?: string|null }} [mirror]
 */
export async function persistPopulation(pool, region, setNumber, pop, compMeta, playerCount, mirror = {}) {
  await pool.query(
    `insert into tft_mv_population_stats (region, set_number, medians, expected_dmg, comp_meta, player_count, computed_at)
     values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, now())
     on conflict (region, set_number) do update set
       medians = excluded.medians, expected_dmg = excluded.expected_dmg,
       comp_meta = excluded.comp_meta, player_count = excluded.player_count, computed_at = now()`,
    [
      region, setNumber,
      JSON.stringify(pop.medians), JSON.stringify(pop.expectedDmg),
      JSON.stringify(Object.fromEntries(compMeta)), playerCount,
    ],
  );
  // Best-effort Supabase-Mirror — der Vercel-Live-Calc-Fallback liest hier.
  const { supaUrl, supaKey } = mirror;
  if (supaUrl && supaKey) {
    try {
      const r = await fetch(`${supaUrl}/rest/v1/tft_mv_population_stats?on_conflict=region,set_number`, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: {
          apikey: supaKey, Authorization: `Bearer ${supaKey}`,
          'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify([{
          region, set_number: setNumber,
          medians: pop.medians, expected_dmg: pop.expectedDmg,
          comp_meta: Object.fromEntries(compMeta), player_count: playerCount,
        }]),
      });
      if (!r.ok) console.error(`  [pop→supabase] HTTP ${r.status}`);
    } catch (e) {
      console.error(`  [pop→supabase] ${e.message}`);
    }
  }
}

/**
 * Pass 2 — base × multiplier → final, dann Snapshot-Row upserten.
 *
 * Spec: reference_marketvalue_skill_score_spec.md
 *   - rated nur ab Diamond II (computeBaseValue setzt rated=false sonst)
 *   - agents jsonb = signals-Array (z, contribution, detail je Signal)
 *   - PK (puuid, region, snapshot_date) → idempotent für Re-Runs am selben Tag
 *
 * @param {pg.Pool} pool
 * @param {ReturnType<typeof createRiotClient>} riot
 * @param {{ puuid: string, tier: string, rank?: string, lp?: number, wins?: number, losses?: number, ladderRank?: number }} player
 * @param {any} raw       extractRawMetrics-Output (mit applyMeta bereits aufgerufen)
 * @param {any} pop       buildPopulation-Output
 * @param {{ region: string, regional: string, apiKey: string, snapshotDate?: string|null }} ctx
 * @returns {Promise<{ snapshotted: boolean, finalValue?: number, reason?: string }>}
 */
export async function snapshotPlayer(pool, riot, player, raw, pop, ctx) {
  const { region, regional, apiKey, snapshotDate = null } = ctx;

  const base = computeBaseValue(
    { tier: player.tier, rank: player.rank || 'I', leaguePoints: player.lp, wins: player.wins, losses: player.losses },
    player.tier === 'CHALLENGER' ? player.ladderRank : undefined,
  );
  if (!base.rated) return { snapshotted: false, reason: base.notRatedReason };

  const sk = scoreSkill(raw, pop);
  const baseValue = Math.round(base.baseValue);
  const finalValue = Math.round(base.baseValue * sk.multiplier);

  const acc = await fetchAccount(riot, regional, player.puuid, apiKey);
  const snapshotDateExpr = snapshotDate ? '$3::date' : 'current_date';
  const baseParams = snapshotDate ? [snapshotDate] : [];

  await pool.query(
    `insert into tft_player_marketvalue_snapshots (
       puuid, region, snapshot_date, game_name, tag_line, tier, rank, lp, ladder_rank,
       base_value, multiplier, final_value, sample_size, damping, agents, games_played
     ) values ($1, $2, ${snapshotDateExpr}, $${3 + baseParams.length}, $${4 + baseParams.length}, $${5 + baseParams.length}, $${6 + baseParams.length}, $${7 + baseParams.length}, $${8 + baseParams.length}, $${9 + baseParams.length}, $${10 + baseParams.length}, $${11 + baseParams.length}, $${12 + baseParams.length}, $${13 + baseParams.length}, $${14 + baseParams.length}::jsonb, $${15 + baseParams.length})
     on conflict (puuid, region, snapshot_date) do update set
       game_name   = excluded.game_name,
       tag_line    = excluded.tag_line,
       tier        = excluded.tier,
       rank        = excluded.rank,
       lp          = excluded.lp,
       ladder_rank = excluded.ladder_rank,
       base_value  = excluded.base_value,
       multiplier  = excluded.multiplier,
       final_value = excluded.final_value,
       sample_size = excluded.sample_size,
       damping     = excluded.damping,
       agents      = excluded.agents,
       -- coalesce: ein Pfad ohne Spielzaehler (refresh-api-Button, aelterer
       -- Caller) darf einen bereits gespeicherten Wert NICHT auf NULL
       -- zuruecksetzen — sonst gilt der Spieler beim naechsten Lauf faelschlich
       -- als aktiv und wird unnoetig neu gecrawlt.
       games_played = coalesce(excluded.games_played, tft_player_marketvalue_snapshots.games_played)`,
    [
      player.puuid, region,
      ...baseParams,
      acc?.gameName ?? null, acc?.tagLine ?? null,
      player.tier, player.rank ?? 'I', player.lp ?? 0, player.ladderRank ?? null,
      baseValue, sk.multiplier, finalValue,
      sk.sampleSize, sk.damping, JSON.stringify(sk.signals),
      player.gamesPlayed ?? null,
    ],
  );
  return { snapshotted: true, finalValue };
}
