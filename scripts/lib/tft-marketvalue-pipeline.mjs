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
import { timed, bump } from './perf-timing.mjs';

// Platform-Routing → regional cluster (für Account-V1 + Match-V1). Single-Source
// in ./regional-routing.mjs (Audit drift-#5). Re-Export hält die bestehende API
// (REGIONAL_CLUSTER + getRegionalCluster) für collect-tft-marketvalues +
// daily-marketvalue-snapshot erhalten.
export {
  REGIONAL_ROUTING as REGIONAL_CLUSTER,
  getRegionalRouting as getRegionalCluster,
} from './regional-routing.mjs';
import { getAccountRouting } from './regional-routing.mjs';

// Aktuelles Set aus public/tft-set.json — die Implementierung liegt seit dem
// Set-18-Umbau in ./current-set.mjs, damit sie nicht zum dritten Mal kopiert
// wird (sie stand hier und identisch in refresh-api-server.mjs). Re-Export,
// damit die bestehenden Importeure unveraendert bleiben.
export { loadCurrentSet } from './current-set.mjs';
import { loadCurrentSet } from './current-set.mjs';

// Optional Knowledge-Graph für eine Region — region-spezifisch, daher kein
// Default-Pfad. Driver lädt das selbst und gibt's via ctx an gatherPlayer weiter.
//
// "Optional" hiess bisher auch "lautlos": bei null liefern buildHotCompKeys und
// buildRecommendedItems ihrerseits null, der Lauf schreibt Snapshots ohne
// Comp-Kontext weiter und im Log steht nichts. Die Graph-Files sind untracked,
// remote-deploy.sh kann sie im `git clean`-Fallback mitnehmen — genau der Fall,
// den man Tage später an dünnen Daten merkt statt sofort am Log. Deshalb warnen
// wir und benennen den erwarteten Pfad; abbrechen wäre falsch, der Rest des
// Snapshots ist ohne Graph vollständig.
export function loadGraph(region, repoRoot = process.cwd()) {
  const path = resolve(repoRoot, 'public', `tft-graph-${region}.json`);
  if (!existsSync(path)) {
    console.warn(`  [warn] Kein Knowledge-Graph für ${region} (${path}) — hot_comp_keys und recommended_items bleiben null`);
    return null;
  }
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) {
    console.warn(`  [warn] Knowledge-Graph für ${region} unlesbar (${path}): ${e.message} — hot_comp_keys und recommended_items bleiben null`);
    return null;
  }
}

// Account-Lookup für game_name + tag_line. Wird in snapshotPlayer aufgerufen.
// Returns null bei Fehler (snapshot bleibt mit name/tag = null geschrieben).
export async function fetchAccount(riot, regional, puuid, apiKey) {
  const r = await riot.fetchJson(
    `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}`,
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

  // Die drei Schritte nach dem Cache-Refresh laufen für JEDEN Spieler, auch
  // für die ~84 %, die seit dem letzten Lauf nichts gespielt haben. Ob das der
  // eigentliche Kostentreiber ist, entscheidet die Messung — nicht die
  // Vermutung. Siehe scripts/lib/perf-timing.mjs.
  bump(skipCacheRefresh ? 'players.cacheOnly' : 'players.fetching');

  if (!skipCacheRefresh) {
    await refreshPlayerMatchCache(pool, player.puuid, region, regional, riot, {
      force,
      startTimeSec,
      maxIds,
      concurrency,
      log: verbose ? (msg) => console.log(`    ${msg}`) : undefined,
    });
  }
  const matches = await timed('listSeasonMatches', () => listSeasonMatches(pool, player.puuid, setNumber));
  // Season-Stats immer schreiben (auch <5 → 0-sample-row die UI ehrlich zeigt)
  await timed('upsertSeasonStats', () => upsertSeasonStats(pool, player.puuid, region, setNumber, {
    matches, hotCompKeys, recommendedItems,
  }));
  if (matches.length < 5) return { skip: true, sampleSize: matches.length };
  return {
    raw: timed('extractRawMetrics', () => extractRawMetrics(matches, { wins: player.wins, losses: player.losses }, null)),
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
  const r = await pool.query(
    `insert into tft_mv_population_stats (region, set_number, medians, expected_dmg, comp_meta, player_count, computed_at)
     values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, now())
     on conflict (region, set_number) do update set
       medians = excluded.medians, expected_dmg = excluded.expected_dmg,
       comp_meta = excluded.comp_meta, player_count = excluded.player_count, computed_at = now()
     returning computed_at`,
    [
      region, setNumber,
      JSON.stringify(pop.medians), JSON.stringify(pop.expectedDmg),
      JSON.stringify(Object.fromEntries(compMeta)), playerCount,
    ],
  );
  // Best-effort Supabase-Mirror — der Vercel-Live-Calc-Fallback liest hier.
  // computed_at geht mit, damit beide Seiten dasselbe Alter tragen: der
  // Behalten-Pfad (syncKeptPopulation) erkennt einen verpassten Spiegel daran.
  await mirrorPopulation(mirror, {
    region, set_number: setNumber,
    medians: pop.medians, expected_dmg: pop.expectedDmg,
    comp_meta: Object.fromEntries(compMeta), player_count: playerCount,
    computed_at: r.rows[0]?.computed_at ?? new Date(),
  });
}

async function mirrorPopulation({ supaUrl, supaKey } = {}, row) {
  if (!supaUrl || !supaKey) return false;
  try {
    const r = await fetch(`${supaUrl}/rest/v1/tft_mv_population_stats?on_conflict=region,set_number`, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: {
        apikey: supaKey, Authorization: `Bearer ${supaKey}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([row]),
    });
    if (!r.ok) { console.error(`  [pop→supabase] HTTP ${r.status}`); return false; }
    return true;
  } catch (e) {
    console.error(`  [pop→supabase] ${e.message}`);
    return false;
  }
}

/**
 * Gespeicherte Vergleichsgruppe einer Region (Hetzner). null, wenn es keine gibt.
 * playerCount + computedAt braucht die Speicher-Entscheidung
 * (tft-mv-population-guard.mjs), pop + compMeta der Behalten-Pfad und der
 * Aktualisieren-Knopf in refresh-api-server.mjs.
 */
export async function loadPopulation(pool, region, setNumber) {
  const r = await pool.query(
    `select medians, expected_dmg, comp_meta, player_count, computed_at
     from tft_mv_population_stats where region = $1 and set_number = $2`,
    [region, setNumber],
  );
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  return {
    pop: { medians: row.medians, expectedDmg: row.expected_dmg },
    compMeta: new Map(Object.entries(row.comp_meta || {})),
    playerCount: row.player_count,
    computedAt: row.computed_at,
  };
}

/**
 * Bewertete Spieler einer Region im aktuellen Set: juengste Zeile je Spieler,
 * davon die bewerteten, die in den letzten 48 h geschrieben wurden. Nenner der
 * Haelfte-Regel in shouldPersistPopulation. Nicht bewertete Zeilen
 * (rated = false) zaehlen nicht — sie sind genau die Abgestiegenen.
 */
export async function countRatedPopulation(pool, region, setNumber) {
  const r = await pool.query(
    `with latest as (
       select distinct on (puuid) puuid, rated, created_at
       from tft_player_marketvalue_snapshots
       where region = $1 and set_number = $2
       order by puuid, snapshot_date desc, created_at desc
     )
     select count(*)::int as n from latest
     where rated and created_at > now() - interval '48 hours'`,
    [region, setNumber],
  );
  return r.rows[0]?.n ?? 0;
}

/**
 * Behalten-Pfad: die Hetzner-Gruppe bleibt, Supabase soll aber dieselbe tragen.
 * Gespiegelt wird nur, wenn Supabase keine Zeile hat, eine andere Spielerzahl
 * oder eine aeltere Zeit — dann ist ein frueherer Spiegel fehlgeschlagen.
 */
export async function syncKeptPopulation(mirror, region, setNumber, stored) {
  const { supaUrl, supaKey } = mirror ?? {};
  if (!supaUrl || !supaKey || !stored) return false;
  try {
    const r = await fetch(
      `${supaUrl}/rest/v1/tft_mv_population_stats?region=eq.${encodeURIComponent(region)}&set_number=eq.${setNumber}&select=computed_at,player_count`,
      { signal: AbortSignal.timeout(15_000), headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } },
    );
    if (!r.ok) { console.error(`  [pop→supabase] Abgleich HTTP ${r.status}`); return false; }
    const [remote] = await r.json();
    const localMs = new Date(stored.computedAt).getTime();
    const same = remote
      && Number(remote.player_count) === Number(stored.playerCount)
      && new Date(remote.computed_at).getTime() >= localMs - 60_000;
    if (same) return false;
  } catch (e) {
    console.error(`  [pop→supabase] Abgleich ${e.message}`);
    return false;
  }
  return mirrorPopulation(mirror, {
    region, set_number: setNumber,
    medians: stored.pop.medians, expected_dmg: stored.pop.expectedDmg,
    comp_meta: Object.fromEntries(stored.compMeta), player_count: stored.playerCount,
    computed_at: stored.computedAt,
  });
}

/**
 * Schreibt die "nicht bewertet"-Zeile fuer einen Spieler, der unter Diamond II
 * gefallen ist (oder keinen Rang mehr hat). Ohne sie bliebe seine letzte
 * bewertete Zeile die juengste, und jede Liste zeigte den alten Marktwert
 * weiter an, als waere nichts passiert.
 *
 * Nur fuer Spieler, die schon eine Zeile in dieser Region haben — wer nie
 * bewertet war, taucht in keiner Liste auf und braucht keine Markierung. Name
 * und Spielzaehler werden nicht mit NULL ueberschrieben (coalesce).
 *
 * @returns {Promise<boolean>} true, wenn eine Zeile geschrieben wurde
 */
export async function writeUnratedMarker(pool, player, { region, setNumber, snapshotDate = null, reason }) {
  if (!Number.isInteger(setNumber)) throw new Error('[writeUnratedMarker] kein gueltiges Set');
  const dateExpr = snapshotDate ? '$3::date' : 'current_date';
  const o = snapshotDate ? 1 : 0;
  const r = await pool.query(
    `insert into tft_player_marketvalue_snapshots (
       puuid, region, snapshot_date, set_number, game_name, tag_line, tier, rank, lp, ladder_rank,
       base_value, multiplier, final_value, sample_size, damping, agents, games_played, rated
     )
     select $1, $2, ${dateExpr}, ${setNumber},
            coalesce($${3 + o}::text, prev.game_name), coalesce($${4 + o}::text, prev.tag_line),
            $${5 + o}, $${6 + o}, $${7 + o}, null,
            0, 1, 0, 0, 1, $${8 + o}::jsonb, coalesce($${9 + o}::int, prev.games_played), false
     from (
       -- Juengste Vorzeile: liefert Namen und Spielzahl, wenn der Aufrufer sie
       -- nicht kennt (Aktualisieren-Knopf). Keine Vorzeile → keine Markierung.
       select game_name, tag_line, games_played from tft_player_marketvalue_snapshots
       where puuid = $1 and region = $2
       order by snapshot_date desc, created_at desc limit 1
     ) prev
     on conflict (puuid, region, snapshot_date) do update set
       set_number   = excluded.set_number,
       game_name    = coalesce(excluded.game_name, tft_player_marketvalue_snapshots.game_name),
       tag_line     = coalesce(excluded.tag_line, tft_player_marketvalue_snapshots.tag_line),
       tier         = excluded.tier,
       rank         = excluded.rank,
       lp           = excluded.lp,
       ladder_rank  = excluded.ladder_rank,
       base_value   = excluded.base_value,
       multiplier   = excluded.multiplier,
       final_value  = excluded.final_value,
       sample_size  = excluded.sample_size,
       damping      = excluded.damping,
       agents       = excluded.agents,
       games_played = coalesce(excluded.games_played, tft_player_marketvalue_snapshots.games_played),
       rated        = excluded.rated,
       created_at   = now()`,
    [
      player.puuid, region,
      ...(snapshotDate ? [snapshotDate] : []),
      player.gameName ?? null, player.tagLine ?? null,
      player.tier || 'UNRANKED', player.rank ?? null, player.lp ?? 0,
      JSON.stringify([{ signal: 'unrated', reason: reason ?? 'unknown' }]),
      player.gamesPlayed ?? null,
    ],
  );
  return r.rowCount > 0;
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
 * @returns {Promise<{ snapshotted: boolean, finalValue?: number, marker?: boolean, reason?: string }>}
 */
export async function snapshotPlayer(pool, riot, player, raw, pop, ctx) {
  // Set-Stempel der Zeile. Ohne ihn kann kein Leser die Snapshots des alten
  // Sets von denen des neuen trennen — genau daran hing der eingefrorene
  // Marktwert nach dem Set-18-Start am 26.08.2026.
  const setNumber = Number(ctx.setNumber ?? loadCurrentSet());
  if (!Number.isInteger(setNumber)) throw new Error('[snapshotPlayer] kein gueltiges Set');
  const { region, regional, apiKey, snapshotDate = null } = ctx;

  const base = computeBaseValue(
    { tier: player.tier, rank: player.rank || 'I', leaguePoints: player.lp, wins: player.wins, losses: player.losses },
    player.tier === 'CHALLENGER' ? player.ladderRank : undefined,
  );
  if (!base.rated) {
    // Abgestiegen: "nicht bewertet"-Zeile statt stillem Ueberspringen, sonst
    // bliebe der alte Marktwert die juengste Zeile (Paket W3, Migration 0088).
    const marker = await writeUnratedMarker(pool, player, { region, setNumber, snapshotDate, reason: base.notRatedReason });
    return { snapshotted: false, marker, reason: base.notRatedReason };
  }

  const sk = scoreSkill(raw, pop);
  const baseValue = Math.round(base.baseValue);
  const finalValue = Math.round(base.baseValue * sk.multiplier);

  const acc = await fetchAccount(riot, getAccountRouting(region), player.puuid, apiKey);
  const snapshotDateExpr = snapshotDate ? '$3::date' : 'current_date';
  const baseParams = snapshotDate ? [snapshotDate] : [];

  await pool.query(
    `insert into tft_player_marketvalue_snapshots (
       puuid, region, snapshot_date, set_number, game_name, tag_line, tier, rank, lp, ladder_rank,
       base_value, multiplier, final_value, sample_size, damping, agents, games_played, rated
     ) values ($1, $2, ${snapshotDateExpr}, ${setNumber},$${3 + baseParams.length}, $${4 + baseParams.length}, $${5 + baseParams.length}, $${6 + baseParams.length}, $${7 + baseParams.length}, $${8 + baseParams.length}, $${9 + baseParams.length}, $${10 + baseParams.length}, $${11 + baseParams.length}, $${12 + baseParams.length}, $${13 + baseParams.length}, $${14 + baseParams.length}::jsonb, $${15 + baseParams.length}, true)
     on conflict (puuid, region, snapshot_date) do update set
       set_number  = excluded.set_number,
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
       games_played = coalesce(excluded.games_played, tft_player_marketvalue_snapshots.games_played),
       -- Eine am selben Tag vorher geschriebene "nicht bewertet"-Zeile wird
       -- wieder zur bewerteten (Wiederaufstieg innerhalb eines Tages).
       rated = excluded.rated,
       -- created_at traegt seit 2026-08-04 den ZULETZT-geschrieben-Zeitpunkt,
       -- nicht den ersten. Es ist der einzige Zeitstempel der Tabelle, und der
       -- Rundlauf im Daily-Driver braucht Stunden-Aufloesung: snapshot_date ist
       -- eine DATE-Spalte und kann 25h nicht von 47h unterscheiden. Ohne diese
       -- Zeile wuerde der Wert beim ersten Insert des Tages stehenbleiben und
       -- ueber die Frische luegen.
       created_at = now()`,
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
