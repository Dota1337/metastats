import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../lib/supabase';
import * as fs from 'fs';
import * as path from 'path';
import { riotFetch } from '../../lib/riot-fetch';
import { parseRegion } from '../../lib/regions';
import { cacheHeaders, DEGRADED_CACHE_CONTROL } from '../../lib/api-cache';
import { latestSplitRowsByPlayer, MV_HISTORY_COLUMNS, type MvHistoryRow } from '../../lib/marketvalue-history';

/**
 * Transfer Predictions — Predicts which players might switch teams
 * Based on: performance trends, market value trajectory, team results, contract data
 *
 * Gruende kommen als Code + Werte, der Text steht in i18n (mi.r.*).
 * Antwort liegt 6 h im Edge-Cache; der erste Aufruf danach ist durch die
 * Zeitbudgets unten gedeckelt (vorher 43 s durch Riot-Abrufe in Serie).
 */

export const maxDuration = 30;

const CACHE_CONTROL = 'public, s-maxage=21600, stale-while-revalidate=86400';
// Riot nur fuer Pros ohne Konto in unserer DB. Der LoL-Schluessel teilt sich
// 100 Abrufe / 2 min mit allen LoL-Seiten; je Pro sind es 3 Abrufe.
const RIOT_MAX_PROS = 15;
const RIOT_CONCURRENCY = 3;
const RIOT_CALL_MS = 4000;
const RIOT_BUDGET_MS = 8000;
const CONTRACT_MS = 5000;
const DB_PAGE = 1000;

type Reason = { code: string; vals?: Record<string, string | number> };

interface TransferPrediction {
  playerName: string;
  currentTeam: string;
  role: string;
  probability: number; // 0-100
  reasons: Reason[];
  predictedDirection: 'upgrade' | 'lateral' | 'downgrade' | 'unknown';
  marketValue: number | null;
  marketTrend: 'rising' | 'stable' | 'falling';
  tier: string | null;
  riotId: string | null;
  winrate: number | null;
  region: string;
  teamRegion: string;
  teamAvgPlace: number | null;
  contractEnd: string | null;
}

type DbPlayer = { id: number; summoner_name: string; tier: string | null; winrate: number | null; market_value: number | null; region: string | null };
type Ranked = { tier: string; wins: number; losses: number; region: string };

// Turnier-Platz als Zahl: "3" -> 3, "5-8" -> 6.5, "NQ" (nicht qualifiziert)
// -> 9. "Q"/"DQ"/"DNS" sagen nichts ueber die Staerke -> null.
// Gemessen in pro-teams.json: neben Zahlen v. a. Bereiche ("5-8" 758x,
// "3-4" 507x), 847x Q, 837x NQ.
function placeValue(place: unknown): number | null {
  if (typeof place === 'number') return Number.isFinite(place) && place > 0 ? place : null;
  const s = String(place ?? '').trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10) || null;
  const range = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) return (parseInt(range[1], 10) + parseInt(range[2], 10)) / 2;
  if (s.toUpperCase() === 'NQ') return 9;
  return null;
}

// Leaguepedia: neuestes Vertragsende je Spieler. Zwei Seiten parallel (760
// Zeilen gemessen; eine Seite war abgeschnitten). Player kann eine Zahl sein,
// Namen tragen teils einen Zusatz "Alvaro (Álvaro Fernández)".
async function loadContracts(): Promise<Map<string, string>> {
  const base = 'https://lol.fandom.com/wiki/Special:CargoExport?tables=Tenures&fields=Tenures.Player,Tenures.Team,Tenures.ContractEnd&where=Tenures.IsCurrent=%22Yes%22+AND+Tenures.ContractEnd+IS+NOT+NULL&format=json&limit=500';
  const pages = await Promise.all([0, 500].map(async offset => {
    try {
      const res = await fetch(`${base}&offset=${offset}`, {
        headers: { 'User-Agent': 'metastats.gg/1.0' },
        signal: AbortSignal.timeout(CONTRACT_MS),
      });
      return res.ok ? ((await res.json()) as Array<{ Player?: unknown; ContractEnd?: string }>) : [];
    } catch { return []; }
  }));
  const map = new Map<string, string>();
  const put = (key: string, end: string) => {
    const prev = map.get(key);
    if (!prev || Date.parse(end) > Date.parse(prev)) map.set(key, end);
  };
  for (const c of pages.flat()) {
    const name = String(c.Player ?? '').trim().toLowerCase();
    const end = String(c.ContractEnd ?? '');
    if (!name || !Number.isFinite(Date.parse(end))) continue;
    put(name, end);
    const short = name.split(' (')[0].trim();
    if (short && short !== name) put(short, end);
  }
  return map;
}

async function loadAllPlayers(): Promise<DbPlayer[]> {
  const rows: DbPlayer[] = [];
  for (let from = 0; ; from += DB_PAGE) {
    const { data, error } = await supabase
      .from('players')
      .select('id, summoner_name, tier, winrate, market_value, region')
      .not('summoner_name', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + DB_PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data || []) as DbPlayer[]));
    if (!data || data.length < DB_PAGE) return rows;
  }
}

interface RosterEntry { name: string; role: string; isPlayer?: boolean; status?: string; accounts?: string[]; riotId?: string }
interface ProTeam { name: string; region?: string; totalPrizeMoney?: number; roster?: RosterEntry[]; results?: { place?: string | number }[] }
interface ActivePro { proName: string; team: string; role: string; accounts?: string[]; riotId?: string }

export async function GET() {
  try {
    // Load pro players data
    let proPlayers: ActivePro[] = [];
    let proTeams: ProTeam[] = [];
    try {
      proPlayers = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'pro-players.json'), 'utf-8')).players || [];
    } catch {}
    try {
      proTeams = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'pro-teams.json'), 'utf-8')).teams || [];
    } catch {}

    const [contractMap, dbPlayers, mvRes] = await Promise.all([
      loadContracts(),
      loadAllPlayers(),
      supabase
        .from('market_value_history')
        .select(MV_HISTORY_COLUMNS)
        .order('recorded_at', { ascending: false })
        .limit(1000),
    ]);
    if (mvRes.error) throw new Error(mvRes.error.message);

    // Trend nur innerhalb eines Splits, neueste zuerst wie bisher.
    const mvByPlayer: Record<string, number[]> = {};
    for (const [pid, rows] of latestSplitRowsByPlayer((mvRes.data || []) as MvHistoryRow[])) {
      mvByPlayer[pid] = rows.map(r => r.market_value);
    }

    // Exakte Zuordnung statt Teilstring (vorher bekam z. B. ein Pro mit dem
    // Konto "pt4" den Marktwert eines beliebigen Kontos mit "pt4" im Namen).
    // Mehrdeutig -> kein Treffer.
    const byFull = new Map<string, DbPlayer[]>();
    const byGame = new Map<string, DbPlayer[]>();
    for (const p of dbPlayers) {
      const full = p.summoner_name.trim().toLowerCase();
      const game = full.split('#')[0];
      byFull.set(full, [...(byFull.get(full) || []), p]);
      byGame.set(game, [...(byGame.get(game) || []), p]);
    }
    const unique = (list: DbPlayer[] | undefined) => (list && list.length === 1 ? list[0] : null);
    const findDb = (riotId: string | undefined, accounts: string[]): DbPlayer | null => {
      if (riotId) {
        const hit = unique(byFull.get(riotId.trim().toLowerCase()));
        if (hit) return hit;
      }
      const hits = new Set<DbPlayer>();
      for (const a of accounts) {
        const name = String(a || '').trim().toLowerCase();
        if (!name) continue;
        const hit = name.includes('#') ? unique(byFull.get(name)) : unique(byGame.get(name));
        if (hit) hits.add(hit);
      }
      return hits.size === 1 ? [...hits][0] : null;
    };

    // Team performance map: die letzten 5 wertbaren Turniere.
    const teamPerformance: Record<string, { avgPlace: number; recentResults: number }> = {};
    for (const team of proTeams) {
      const places: number[] = [];
      for (const r of team.results || []) {
        const v = placeValue(r.place);
        if (v != null) places.push(v);
        if (places.length === 5) break;
      }
      if (places.length > 0) {
        teamPerformance[team.name] = { avgPlace: places.reduce((s, v) => s + v, 0) / places.length, recentResults: places.length };
      }
    }

    // Top 30 Teams nach Preisgeld — nur Teams mit aktuellem Kader (sonst
    // belegen aufgeloeste Teams Plaetze, gemessen: J Team, 100 Thieves).
    const gameRoles = new Set(['Top', 'Jungle', 'Mid', 'ADC', 'Support']);
    const hasMain = (t: ProTeam) => (t.roster || []).some(r => r.isPlayer && r.status === 'main');
    const top30Teams = new Set(
      [...proTeams]
        .filter(hasMain)
        .sort((a, b) => (b.totalPrizeMoney || 0) - (a.totalPrizeMoney || 0))
        .slice(0, 30)
        .map(t => t.name)
    );
    const teamByName = new Map<string, ProTeam>(proTeams.map(t => [t.name, t]));

    // Merge players: team rosters first (most up-to-date), then pro-players.json as fallback
    const seenPlayers = new Set<string>();
    const activePros: ActivePro[] = [];
    for (const team of proTeams) {
      if (!top30Teams.has(team.name)) continue;
      for (const m of (team.roster || []).filter(r => r.isPlayer && r.status === 'main')) {
        if (!seenPlayers.has(m.name.toLowerCase()) && gameRoles.has(m.role)) {
          seenPlayers.add(m.name.toLowerCase());
          activePros.push({ proName: m.name, team: team.name, role: m.role, accounts: m.accounts || [], riotId: m.riotId });
        }
      }
    }
    for (const p of proPlayers) {
      if (gameRoles.has(p.role) && p.team && top30Teams.has(p.team) && !seenPlayers.has(p.proName.toLowerCase())) {
        seenPlayers.add(p.proName.toLowerCase());
        activePros.push(p);
      }
    }

    const dbOf = new Map<ActivePro, DbPlayer | null>();
    for (const pro of activePros) dbOf.set(pro, findDb(pro.riotId, pro.accounts || []));

    // Riot-Rueckfall fuer Pros ohne DB-Konto: Server fragt Riot selbst
    // (statt aus der Team-Region zu raten, die bei 492 von 521 Teams leer ist).
    // Gedeckelt, parallel begrenzt, ein gemeinsames Zeitbudget, ohne 429-Warten.
    const apiKey = process.env.RIOT_API_KEY;
    const riotOf = new Map<ActivePro, Ranked | null>();
    let degraded = false;
    const candidates = activePros
      .filter(p => !dbOf.get(p) && typeof p.riotId === 'string' && p.riotId.includes('#'))
      .slice(0, RIOT_MAX_PROS);
    if (apiKey && candidates.length > 0) {
      const budget = AbortSignal.timeout(RIOT_BUDGET_MS);
      const call = (url: string) => riotFetch(url, apiKey, { signal: AbortSignal.any([budget, AbortSignal.timeout(RIOT_CALL_MS)]) }, 0);
      const lookup = async (riotId: string): Promise<Ranked | null> => {
        const [name, tag] = riotId.split('#');
        const acc = await call(`https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name.trim())}/${encodeURIComponent(tag.trim())}`);
        if (acc.status === 404) return null;
        if (!acc.ok) throw new Error(String(acc.status));
        const { puuid } = await acc.json();
        const reg = await call(`https://europe.api.riotgames.com/riot/account/v1/region/by-game/lol/by-puuid/${encodeURIComponent(puuid)}`);
        if (!reg.ok) throw new Error(String(reg.status));
        const region = parseRegion((await reg.json())?.region);
        if (!region) return null;
        const league = await call(`https://${region}.api.riotgames.com/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`);
        if (!league.ok) throw new Error(String(league.status));
        const solo = ((await league.json()) as { queueType: string; tier: string; rank: string; wins: number; losses: number }[]).find(r => r.queueType === 'RANKED_SOLO_5x5');
        return solo ? { tier: solo.tier, wins: solo.wins, losses: solo.losses, region } : null;
      };
      let next = 0;
      await Promise.all(Array.from({ length: RIOT_CONCURRENCY }, async () => {
        while (next < candidates.length && !budget.aborted) {
          const pro = candidates[next++];
          try { riotOf.set(pro, await lookup(pro.riotId as string)); }
          catch { degraded = true; }
        }
      }));
      if (budget.aborted) degraded = true;
    }

    const predictions: TransferPrediction[] = [];
    const todayStart = new Date(new Date().toISOString().slice(0, 10)).getTime();

    for (const pro of activePros) {
      const dbPlayer = dbOf.get(pro) || null;
      const riotRanked = riotOf.get(pro) || null;

      const playerTier = dbPlayer?.tier || riotRanked?.tier || null;
      const dbWr = dbPlayer?.winrate != null ? Math.round(Number(dbPlayer.winrate)) : null;
      const playerWinrate = dbWr ?? (riotRanked ? Math.round((riotRanked.wins / Math.max(riotRanked.wins + riotRanked.losses, 1)) * 100) : null);

      const reasons: Reason[] = [];
      let transferProb = 15; // Base probability (any player could transfer)

      // Factor 1: Team performance
      const teamPerf = teamPerformance[pro.team];
      if (teamPerf) {
        if (teamPerf.avgPlace > 6) {
          transferProb += 15;
          reasons.push({ code: 'teamWeak', vals: { place: teamPerf.avgPlace } });
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
            reasons.push({ code: 'mvRising', vals: { pct: Math.round(change) } });
          } else if (change < -20) {
            marketTrend = 'falling';
            transferProb += 8;
            reasons.push({ code: 'mvFalling', vals: { pct: Math.round(change) } });
          }
        }

        // Factor 3: Player is significantly better than their team
        if (dbPlayer.market_value && dbPlayer.market_value > 50000 && teamPerf && teamPerf.avgPlace > 4) {
          transferProb += 12;
          reasons.push({ code: 'outperforms' });
        }
      }

      // Factor 4: Winrate drop indicates dissatisfaction or poor synergy
      if (playerWinrate != null) {
        if (playerWinrate < 45) {
          transferProb += 8;
          reasons.push({ code: 'lowWinrate', vals: { wr: playerWinrate } });
        } else if (playerWinrate >= 60) {
          transferProb += 5;
          reasons.push({ code: 'highWinrate', vals: { wr: playerWinrate } });
        }
      }

      // Factor 5: Team recently lost multiple tournaments
      if (teamPerf && teamPerf.recentResults >= 3 && teamPerf.avgPlace > 5) {
        transferProb += 6;
        reasons.push({ code: 'teamSlump', vals: { n: teamPerf.recentResults } });
      }

      // Factor 6: Player tier vs team success mismatch
      if (playerTier && ['CHALLENGER', 'GRANDMASTER'].includes(playerTier) && teamPerf && teamPerf.avgPlace > 6) {
        transferProb += 8;
        reasons.push({ code: 'tierWeakTeam', vals: { tier: playerTier } });
      }

      // Factor 7: Contract ending soon increases transfer probability
      const contractEnd = contractMap.get(String(pro.proName).toLowerCase()) || null;
      if (contractEnd) {
        const end = Date.parse(contractEnd);
        if (end < todayStart) {
          transferProb += 18;
          reasons.push({ code: 'contractExpired', vals: { date: contractEnd } });
        } else if (end - Date.now() <= 182 * 86400000) {
          transferProb += 12;
          reasons.push({ code: 'contractSoon', vals: { date: contractEnd } });
        }
      }

      const teamRegion = teamByName.get(pro.team)?.region || '';

      // Count available data points
      const dataPoints = [
        playerTier,
        playerWinrate,
        dbPlayer?.market_value,
        contractEnd,
        teamPerf?.avgPlace,
        pro.riotId,
      ].filter(v => v != null && v !== '').length;

      // Only include players with enough data (min 4 data points) and at least 4 reasons
      if (transferProb >= 25 && reasons.length >= 4 && dataPoints >= 4) {
        let predictedDirection: 'upgrade' | 'lateral' | 'downgrade' | 'unknown' = 'unknown';
        const weakish = !!teamPerf && teamPerf.avgPlace > 4;
        if (marketTrend === 'rising' && weakish) predictedDirection = 'upgrade';
        if (marketTrend === 'falling') predictedDirection = 'lateral';
        if (playerWinrate != null && playerWinrate >= 60 && weakish) predictedDirection = 'upgrade';

        predictions.push({
          playerName: pro.proName,
          currentTeam: pro.team,
          role: pro.role,
          probability: Math.min(85, transferProb),
          reasons,
          predictedDirection,
          marketValue: dbPlayer?.market_value ?? null,
          marketTrend,
          tier: playerTier,
          // Link-Ziel: Riot-ID des Pros, sonst das zugeordnete DB-Konto.
          riotId: pro.riotId || (dbPlayer?.summoner_name.includes('#') ? dbPlayer.summoner_name : null),
          winrate: playerWinrate,
          region: parseRegion(dbPlayer?.region) || riotRanked?.region || '',
          teamRegion,
          teamAvgPlace: teamPerf ? Math.round(teamPerf.avgPlace * 10) / 10 : null,
          contractEnd,
        });
      }
    }

    predictions.sort((a, b) => b.probability - a.probability);

    return NextResponse.json({
      predictions: predictions.slice(0, 30),
      totalAnalyzed: activePros.length,
      lastUpdated: new Date().toISOString(),
    }, { headers: cacheHeaders(degraded ? DEGRADED_CACHE_CONTROL : CACHE_CONTROL, 'lol-api') });
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: cacheHeaders(DEGRADED_CACHE_CONTROL, 'lol-api') });
  }
}
