import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../lib/supabase';

/**
 * Anomaly Detection — Flags unusual player performances
 * Detects: Market surges/crashes, smurfs, dominant performers, cold streaks
 */

interface Anomaly {
  type: 'market_surge' | 'market_crash' | 'smurf_suspect' | 'hot_streak' | 'cold_streak';
  severity: 'info' | 'notable' | 'significant';
  title: string;
  description: string;
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

const TIER_VALUE: Record<string, number> = {
  IRON: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4,
  EMERALD: 5, DIAMOND: 6, MASTER: 7, GRANDMASTER: 8, CHALLENGER: 9,
};

export async function GET() {
  try {
    const anomalies: Anomaly[] = [];

    // Load all players with stats in one query
    const { data: allPlayers } = await supabase
      .from('players')
      .select('id, summoner_name, puuid, tier, rank, winrate, market_value, region, summoner_level, updated_at')
      .not('tier', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(300);

    const playerMap: Record<number, any> = {};
    if (allPlayers) {
      for (const p of allPlayers) playerMap[p.id] = p;
    }

    // 1. Market value changes
    const { data: mvHistory } = await supabase
      .from('market_value_history')
      .select('player_id, market_value, recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(500);

    if (mvHistory && mvHistory.length > 0) {
      const byPlayer: Record<number, { value: number; date: string }[]> = {};
      for (const entry of mvHistory) {
        if (!byPlayer[entry.player_id]) byPlayer[entry.player_id] = [];
        byPlayer[entry.player_id].push({ value: entry.market_value, date: entry.recorded_at });
      }

      for (const [playerId, history] of Object.entries(byPlayer)) {
        if (history.length < 2) continue;
        const latest = history[0].value;
        const previous = history[1].value;
        if (previous === 0) continue;

        const changePercent = ((latest - previous) / previous) * 100;
        const player = playerMap[Number(playerId)];
        if (!player) continue;

        if (changePercent > 50) {
          anomalies.push(buildAnomaly('market_surge', changePercent > 100 ? 'significant' : 'notable',
            'Marktwert-Explosion',
            `+${changePercent.toFixed(0)}% Marktwert (${formatMoney(previous)} → ${formatMoney(latest)})`,
            player, history[0].date
          ));
        } else if (changePercent < -30) {
          anomalies.push(buildAnomaly('market_crash', changePercent < -50 ? 'significant' : 'notable',
            'Marktwert-Einbruch',
            `${changePercent.toFixed(0)}% Marktwert (${formatMoney(previous)} → ${formatMoney(latest)})`,
            player, history[0].date
          ));
        }
      }
    }

    // 2. Stat-based anomalies
    if (allPlayers) {
      for (const player of allPlayers) {
        const tierVal = TIER_VALUE[player.tier] || 0;
        const wr = player.winrate;
        if (wr == null) continue;

        // Smurf detection: high winrate in low elo
        if (tierVal <= TIER_VALUE.PLATINUM && wr >= 70) {
          anomalies.push(buildAnomaly('smurf_suspect', 'notable',
            'Möglicher Smurf',
            `${wr}% Winrate in ${player.tier} — ungewöhnlich hoch für diese Elo`,
            player, player.updated_at
          ));
        }

        // Dominant high-elo performer
        if (tierVal >= TIER_VALUE.MASTER && wr >= 63) {
          anomalies.push(buildAnomaly('hot_streak', 'significant',
            'Dominante Performance',
            `${wr}% Winrate in ${player.tier} — überdurchschnittlich für High-Elo`,
            player, player.updated_at
          ));
        }

        // Struggling: low winrate in elo
        if (tierVal >= TIER_VALUE.DIAMOND && wr < 42) {
          anomalies.push(buildAnomaly('cold_streak', 'notable',
            'Negativserie',
            `Nur ${wr}% Winrate in ${player.tier} — möglicher Tilt oder Meta-Shift`,
            player, player.updated_at
          ));
        }
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
    });
  } catch (error) {
    return NextResponse.json({ error: 'Anomaly-Erkennung fehlgeschlagen' }, { status: 500 });
  }
}

function buildAnomaly(
  type: Anomaly['type'], severity: Anomaly['severity'],
  title: string, description: string,
  player: any, detectedAt: string
): Anomaly {
  return {
    type, severity, title, description,
    playerName: player.summoner_name,
    playerId: player.id,
    detectedAt,
    tier: player.tier || null,
    rank: player.rank || null,
    winrate: player.winrate ?? null,
    marketValue: player.market_value || null,
    region: player.region || null,
    summonerLevel: player.summoner_level || null,
    puuid: player.puuid || null,
  };
}

function formatMoney(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}k`;
  return `$${value}`;
}
