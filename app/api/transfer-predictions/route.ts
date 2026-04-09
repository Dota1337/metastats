import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../lib/supabase';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Transfer Predictions — Predicts which players might switch teams
 * Based on: performance trends, market value trajectory, team results, contract data
 */

interface TransferPrediction {
  playerName: string;
  currentTeam: string;
  role: string;
  probability: number; // 0-100
  reasons: string[];
  predictedDirection: 'upgrade' | 'lateral' | 'downgrade' | 'unknown';
  marketValue: number | null;
  marketTrend: 'rising' | 'stable' | 'falling';
  tier: string | null;
  riotId: string | null;
  winrate: number | null;
  region: string;
  teamRegion: string;
  gamesPlayed: number | null;
  teamAvgPlace: number | null;
  contractEnd: string | null;
}

export async function GET() {
  try {
    // Load pro players data
    const proPlayersPath = path.join(process.cwd(), 'public', 'pro-players.json');
    const proTeamsPath = path.join(process.cwd(), 'public', 'pro-teams.json');

    let proPlayers: any[] = [];
    let proTeams: any[] = [];

    try {
      const playersData = JSON.parse(fs.readFileSync(proPlayersPath, 'utf-8'));
      proPlayers = playersData.players || [];
    } catch {}

    try {
      const teamsData = JSON.parse(fs.readFileSync(proTeamsPath, 'utf-8'));
      proTeams = teamsData.teams || [];
    } catch {}

    // Fetch contract data from Leaguepedia
    const contractMap: Record<string, string> = {};
    try {
      const contractRes = await fetch(
        'https://lol.fandom.com/wiki/Special:CargoExport?tables=Tenures&fields=Tenures.Player,Tenures.Team,Tenures.ContractEnd&where=Tenures.IsCurrent=%22Yes%22+AND+Tenures.ContractEnd+IS+NOT+NULL&format=json&limit=500',
        { headers: { 'User-Agent': 'metastats.gg/1.0' } }
      );
      if (contractRes.ok) {
        const contracts = await contractRes.json();
        const seen = new Set<string>();
        for (const c of contracts) {
          const key = String(c.Player || '').toLowerCase();
          if (key && c.ContractEnd && !seen.has(key)) {
            seen.add(key);
            contractMap[key] = c.ContractEnd;
          }
        }
      }
    } catch {}

    // Get players from DB with market value history
    const { data: dbPlayers } = await supabase
      .from('players')
      .select('id, summoner_name, puuid, tier, rank, winrate, market_value, region, updated_at')
      .not('market_value', 'is', null)
      .order('market_value', { ascending: false })
      .limit(200);

    // Get market value history for trend analysis
    const { data: mvHistory } = await supabase
      .from('market_value_history')
      .select('player_id, market_value, recorded_at')
      .order('recorded_at', { ascending: false })
      .limit(1000);

    const mvByPlayer: Record<number, number[]> = {};
    for (const entry of (mvHistory || [])) {
      if (!mvByPlayer[entry.player_id]) mvByPlayer[entry.player_id] = [];
      mvByPlayer[entry.player_id].push(entry.market_value);
    }

    const predictions: TransferPrediction[] = [];

    // Build team performance map
    const teamPerformance: Record<string, { avgPlace: number; recentResults: number }> = {};
    for (const team of proTeams) {
      const recent = (team.results || []).slice(0, 5);
      const avgPlace = recent.length > 0
        ? recent.reduce((s: number, r: any) => s + (typeof r.place === 'number' ? r.place : parseInt(r.place) || 8), 0) / recent.length
        : 8;
      teamPerformance[team.name] = { avgPlace, recentResults: recent.length };
    }

    // Only consider players from Top 30 teams (by prize money)
    const top30Teams = new Set(
      [...proTeams]
        .sort((a: any, b: any) => (b.totalPrizeMoney || 0) - (a.totalPrizeMoney || 0))
        .slice(0, 30)
        .map((t: any) => t.name)
    );

    // Analyze each pro player from top teams
    const gameRoles = new Set(['Top', 'Jungle', 'Mid', 'ADC', 'Support']);
    // Merge players: team rosters first (most up-to-date), then pro-players.json as fallback
    const seenPlayers = new Set<string>();
    const activePros: any[] = [];

    // From team rosters first (pro-teams.json has validated riotIds)
    for (const team of proTeams) {
      if (!top30Teams.has(team.name)) continue;
      for (const m of (team.roster || []).filter((r: any) => r.isPlayer && r.status === 'main')) {
        if (!seenPlayers.has(m.name.toLowerCase()) && gameRoles.has(m.role)) {
          seenPlayers.add(m.name.toLowerCase());
          activePros.push({ proName: m.name, team: team.name, role: m.role, accounts: m.accounts || [], riotId: m.riotId });
        }
      }
    }

    // Then from pro-players.json (fallback for players not in rosters)
    for (const p of proPlayers) {
      if (gameRoles.has(p.role) && p.team && top30Teams.has(p.team) && !seenPlayers.has(p.proName.toLowerCase())) {
        seenPlayers.add(p.proName.toLowerCase());
        activePros.push(p);
      }
    }

    // Resolve ranked data via Riot API for players without DB entry
    const apiKey = process.env.RIOT_API_KEY;
    const riotRankedCache: Record<string, { tier: string; lp: number; wins: number; losses: number } | null> = {};

    async function getRiotRanked(riotId: string, teamRegion: string): Promise<{ tier: string; lp: number; wins: number; losses: number } | null> {
      if (!apiKey || !riotId || !riotId.includes('#')) return null;
      if (riotRankedCache[riotId] !== undefined) return riotRankedCache[riotId];
      try {
        const [name, tag] = riotId.split('#');
        const regional = teamRegion.includes('Korea') || teamRegion.includes('China') || teamRegion.includes('Japan') ? 'asia' :
                         teamRegion.includes('Europe') ? 'europe' : 'americas';
        const platform = regional === 'asia' ? 'kr' : regional === 'europe' ? 'euw1' : 'na1';

        const accRes = await fetch(`https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?api_key=${apiKey}`);
        if (!accRes.ok) { riotRankedCache[riotId] = null; return null; }
        const acc = await accRes.json();

        const rankedRes = await fetch(`https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${acc.puuid}?api_key=${apiKey}`);
        const ranked = rankedRes.ok ? await rankedRes.json() : [];
        const soloQ = ranked.find((r: any) => r.queueType === 'RANKED_SOLO_5x5');
        const result = soloQ ? { tier: soloQ.tier, lp: soloQ.leaguePoints, wins: soloQ.wins, losses: soloQ.losses } : null;
        riotRankedCache[riotId] = result;
        return result;
      } catch { riotRankedCache[riotId] = null; return null; }
    }

    for (const pro of activePros) {
      // Find matching DB player
      const dbPlayer = dbPlayers?.find(db =>
        db.summoner_name?.toLowerCase().includes(pro.proName?.toLowerCase()) ||
        (pro.accounts || []).some((a: string) =>
          db.summoner_name?.toLowerCase().includes(a.toLowerCase())
        )
      );

      // If no DB entry, try Riot API for ranked data
      const teamData0 = proTeams.find((t: any) => t.name === pro.team);
      let riotRanked: { tier: string; lp: number; wins: number; losses: number } | null = null;
      if (!dbPlayer && pro.riotId) {
        riotRanked = await getRiotRanked(pro.riotId, teamData0?.region || '');
      }

      const playerTier = dbPlayer?.tier || riotRanked?.tier || null;
      const playerWinrate = dbPlayer?.winrate || (riotRanked ? Math.round((riotRanked.wins / Math.max(riotRanked.wins + riotRanked.losses, 1)) * 100) : null);

      const reasons: string[] = [];
      let transferProb = 15; // Base probability (any player could transfer)

      // Factor 1: Team performance
      const teamPerf = teamPerformance[pro.team];
      if (teamPerf) {
        if (teamPerf.avgPlace > 6) {
          transferProb += 15;
          reasons.push(`Team performt schwach (Ø Platz ${teamPerf.avgPlace.toFixed(1)})`);
        } else if (teamPerf.avgPlace <= 2) {
          transferProb -= 10; // Unlikely to leave a winning team
        }
      }

      // Factor 2: Market value trend
      let marketTrend: 'rising' | 'stable' | 'falling' = 'stable';
      if (dbPlayer) {
        const history = mvByPlayer[dbPlayer.id];
        if (history && history.length >= 2) {
          const recent = history[0];
          const older = history[Math.min(history.length - 1, 3)];
          const change = ((recent - older) / Math.max(older, 1)) * 100;
          if (change > 20) {
            marketTrend = 'rising';
            transferProb += 10;
            reasons.push(`Marktwert steigt (+${change.toFixed(0)}%) — attraktiv für andere Teams`);
          } else if (change < -20) {
            marketTrend = 'falling';
            transferProb += 8;
            reasons.push(`Marktwert sinkt (${change.toFixed(0)}%) — Team könnte Wechsel erwägen`);
          }
        }

        // Factor 3: Player is significantly better than their team
        if (dbPlayer.market_value && dbPlayer.market_value > 50000 && teamPerf && teamPerf.avgPlace > 4) {
          transferProb += 12;
          reasons.push('Spieler überperformt sein Team — könnte von besserem Angebot profitieren');
        }
      }

      // Factor 4: Winrate drop indicates dissatisfaction or poor synergy
      if (playerWinrate) {
        if (playerWinrate < 45) {
          transferProb += 8;
          reasons.push(`Niedrige Winrate (${playerWinrate}%) — möglicherweise fehlende Team-Synergy`);
        } else if (playerWinrate >= 60) {
          transferProb += 5;
          reasons.push(`Hohe Winrate (${playerWinrate}%) — attraktiv für Top-Teams`);
        }
      }

      // Factor 5: Team recently lost multiple tournaments
      if (teamPerf && teamPerf.recentResults >= 3 && teamPerf.avgPlace > 5) {
        transferProb += 6;
        reasons.push(`Team enttäuscht konsistent (${teamPerf.recentResults} schwache Turniere in Folge)`);
      }

      // Factor 6: Player tier vs team success mismatch
      if (playerTier) {
        const highTiers = ['CHALLENGER', 'GRANDMASTER'];
        if (highTiers.includes(playerTier) && teamPerf && teamPerf.avgPlace > 6) {
          transferProb += 8;
          reasons.push(`${playerTier}-Spieler in schwachem Team — Potenzial wird nicht ausgeschöpft`);
        }
      }

      // Factor 7: Contract ending soon increases transfer probability
      const contractEnd = contractMap[pro.proName.toLowerCase()] || null;
      if (contractEnd) {
        const monthsLeft = Math.round((new Date(contractEnd).getTime() - Date.now()) / (30 * 86400000));
        if (monthsLeft <= 6 && monthsLeft > 0) {
          transferProb += 12;
          reasons.push(`Vertrag läuft in ${monthsLeft} Monaten aus (${contractEnd})`);
        } else if (monthsLeft <= 0) {
          transferProb += 18;
          reasons.push(`Vertrag abgelaufen (${contractEnd}) — Spieler ist Free Agent`);
        }
      }

      // Get team region
      const teamData = proTeams.find((t: any) => t.name === pro.team);
      const teamRegion = teamData?.region || '';

      // Count available data points
      const dataPoints = [
        playerTier,
        playerWinrate,
        dbPlayer?.market_value,
        contractEnd,
        teamPerf?.avgPlace,
        pro.riotId,
      ].filter(Boolean).length;

      // Only include players with enough data (min 4 data points) and at least 4 reasons
      if (transferProb >= 25 && reasons.length >= 4 && dataPoints >= 4) {
        let predictedDirection: 'upgrade' | 'lateral' | 'downgrade' | 'unknown' = 'unknown';
        if (marketTrend === 'rising' && teamPerf?.avgPlace > 4) predictedDirection = 'upgrade';
        if (marketTrend === 'falling') predictedDirection = 'lateral';
        if (playerWinrate && playerWinrate >= 60 && teamPerf?.avgPlace > 4) predictedDirection = 'upgrade';

        predictions.push({
          playerName: pro.proName,
          currentTeam: pro.team,
          role: pro.role,
          probability: Math.min(85, transferProb),
          reasons,
          predictedDirection,
          marketValue: dbPlayer?.market_value || null,
          marketTrend,
          tier: playerTier,
          riotId: pro.riotId || null,
          winrate: playerWinrate,
          region: dbPlayer?.region || '',
          teamRegion,
          gamesPlayed: dbPlayer ? (dbPlayer as any).games_played || null : null,
          teamAvgPlace: teamPerf?.avgPlace || null,
          contractEnd: contractEnd || contractMap[pro.proName.toLowerCase()] || null,
        });
      }
    }

    // Sort by probability
    predictions.sort((a, b) => b.probability - a.probability);

    return NextResponse.json({
      predictions: predictions.slice(0, 30),
      totalAnalyzed: activePros.length,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: 'Transfer-Analyse fehlgeschlagen' }, { status: 500 });
  }
}
