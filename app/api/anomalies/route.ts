import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../lib/supabase';
import { cacheHeaders, SLOW_CACHE_CONTROL, DEGRADED_CACHE_CONTROL } from '../../lib/api-cache';
import { latestSplitRowsByPlayer, MV_HISTORY_COLUMNS, type MvHistoryRow } from '../../lib/marketvalue-history';

/**
 * Anomaly Detection — Flags unusual player performances
 * Detects: Market surges/crashes, smurfs, dominant performers, cold streaks
 *
 * Titel und Beschreibung kommen als Typ + Werte (vals), der Text steht in
 * i18n (mi.a.* / mi.d.*). Grundlage ist der ganze Verlauf des aktuellen
 * Splits (vorher nur die neuesten 500 Zeilen und 300 Spieler — so fehlten
 * Marktwert-Ausreisser fast immer).
 */

export const maxDuration = 30;

// Winrate-Auffaelligkeiten erst ab so vielen ausgewerteten Spielen im Split;
// 70 % aus 10 Spielen ist kein Smurf. Fehlt die Zahl (aeltere Bewertungslaeufe
// haben sie nicht), wird nicht geraten.
const MIN_GAMES = 20;
const DB_PAGE = 1000;

interface Anomaly {
  type: 'market_surge' | 'market_crash' | 'smurf_suspect' | 'hot_streak' | 'cold_streak';
  severity: 'info' | 'notable' | 'significant';
  vals: Record<string, string | number>;
  playerName: string;
  playerId: number;
  detectedAt: string;
  // Extended player info
  tier: string | null;
  rank: string | null;
  winrate: number | null;
  marketValue: number | null;
  region: string | null;
  summonerLevel: number | null;
  puuid: string | null;
}

type HistoryRow = MvHistoryRow & { games_analyzed: number | null };

const TIER_VALUE: Record<string, number> = {
  IRON: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4,
  EMERALD: 5, DIAMOND: 6, MASTER: 7, GRANDMASTER: 8, CHALLENGER: 9,
};

async function pages<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += DB_PAGE) {
    const { data, error } = await query(from, from + DB_PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < DB_PAGE) return rows;
  }
}

export async function GET() {
  try {
    const anomalies: Anomaly[] = [];

    // Aktueller Split = Split der neuesten Verlaufszeile.
    const { data: newest, error: newestErr } = await supabase
      .from('market_value_history')
      .select('split_id')
      .not('split_id', 'is', null)
      .order('recorded_at', { ascending: false })
      .limit(1);
    if (newestErr) throw new Error(newestErr.message);
    const split = newest?.[0]?.split_id as string | undefined;

    const [history, allPlayers] = await Promise.all([
      split
        ? pages<HistoryRow>((from, to) => supabase
            .from('market_value_history')
            .select(`${MV_HISTORY_COLUMNS}, games_analyzed`)
            .eq('split_id', split)
            .order('recorded_at', { ascending: false })
            .order('player_id', { ascending: true })
            .range(from, to) as unknown as PromiseLike<{ data: HistoryRow[] | null; error: { message: string } | null }>)
        : Promise.resolve([] as HistoryRow[]),
      pages<any>((from, to) => supabase
        .from('players')
        .select('id, summoner_name, puuid, tier, rank, winrate, market_value, region, summoner_level, updated_at')
        .not('tier', 'is', null)
        .order('id', { ascending: true })
        .range(from, to)),
    ]);

    const playerMap: Record<string, any> = {};
    for (const p of allPlayers) playerMap[p.id] = p;

    // Gruppen trennen geschaetzte und echte Split-Werte (siehe Lib).
    const byPlayer = latestSplitRowsByPlayer(history);

    // 1. Market value changes
    for (const [playerId, rows] of byPlayer) {
      if (rows.length < 2) continue;
      const latest = rows[0].market_value;
      const previous = rows[1].market_value;
      if (!previous) continue;
      const player = playerMap[playerId];
      if (!player) continue;

      const changePercent = ((latest - previous) / previous) * 100;
      const vals = { pct: Math.round(changePercent), from: previous, to: latest };
      // Grosse Wertzahl = letzter Wert aus dem Text, nicht der aktuelle Spielerwert
      // (der kann aus einer anderen Bewertung stammen, z. B. 77.281 neben 68.796).
      const mvPlayer = { ...player, market_value: latest };
      if (changePercent > 50) {
        anomalies.push(buildAnomaly('market_surge', changePercent > 100 ? 'significant' : 'notable', vals, mvPlayer, rows[0].recorded_at));
      } else if (changePercent < -30) {
        anomalies.push(buildAnomaly('market_crash', changePercent < -50 ? 'significant' : 'notable', vals, mvPlayer, rows[0].recorded_at));
      }
    }

    // 2. Stat-based anomalies — nur mit genug ausgewerteten Spielen.
    for (const [playerId, rows] of byPlayer) {
      const games = rows[0].games_analyzed;
      if (games == null || games < MIN_GAMES) continue;
      const player = playerMap[playerId];
      if (!player || player.winrate == null) continue;
      const tierVal = TIER_VALUE[player.tier] ?? 0;
      const wr = Math.round(Number(player.winrate));
      const vals = { wr, tier: player.tier, games };

      // Smurf detection: high winrate in low elo
      if (tierVal <= TIER_VALUE.PLATINUM && wr >= 70) {
        anomalies.push(buildAnomaly('smurf_suspect', 'notable', vals, player, player.updated_at));
      }
      // Dominant high-elo performer
      if (tierVal >= TIER_VALUE.MASTER && wr >= 63) {
        anomalies.push(buildAnomaly('hot_streak', 'significant', vals, player, player.updated_at));
      }
      // Struggling: low winrate in elo
      if (tierVal >= TIER_VALUE.DIAMOND && wr < 42) {
        anomalies.push(buildAnomaly('cold_streak', 'notable', vals, player, player.updated_at));
      }
    }

    // Sort: significant first, then by date
    const severityOrder = { significant: 0, notable: 1, info: 2 };
    anomalies.sort((a, b) => {
      const sev = severityOrder[a.severity] - severityOrder[b.severity];
      if (sev !== 0) return sev;
      return new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime();
    });

    return NextResponse.json({
      anomalies: anomalies.slice(0, 50),
      totalDetected: anomalies.length,
      lastChecked: new Date().toISOString(),
    }, { headers: cacheHeaders(SLOW_CACHE_CONTROL, 'lol-api') });
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: cacheHeaders(DEGRADED_CACHE_CONTROL, 'lol-api') });
  }
}

function buildAnomaly(
  type: Anomaly['type'], severity: Anomaly['severity'],
  vals: Anomaly['vals'], player: any, detectedAt: string
): Anomaly {
  return {
    type, severity, vals,
    playerName: player.summoner_name,
    playerId: player.id,
    detectedAt,
    tier: player.tier || null,
    rank: player.rank || null,
    winrate: player.winrate != null ? Math.round(Number(player.winrate)) : null,
    marketValue: player.market_value || null,
    region: player.region || null,
    summonerLevel: player.summoner_level || null,
    puuid: player.puuid || null,
  };
}
