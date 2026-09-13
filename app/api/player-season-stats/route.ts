// Leistungsanalyse ueber alle gespeicherten Ranked-Spiele einer Saison oder
// eines Splits (Phase 2, Plan in .claude/plan-current.md).
//
// Ablauf pro Aufruf:
//   1. Kleine Abfrage: Patch + Zeitpunkt aller Ranked-Spiele des Spielers
//      (drei Zahlen pro Zeile). Daraus: welche Zeitraeume genug Spiele haben,
//      und die Pruefgroessen fuer den gewaehlten Zeitraum.
//   2. Passt die abgelegte Zeile in lol_player_season_stats zu diesen
//      Pruefgroessen und zur Rechen-Version, wird sie direkt ausgeliefert.
//   3. Sonst: volle Zeilen lesen (bis ~950 x ~8 KB), mit derselben Rechnung wie
//      die Live-Matches bewerten, ablegen, ausliefern.
//
// Die Rechnung laeuft bewusst hier und nicht auf dem Server beim Sammeln —
// sonst gaebe es sie zweimal (TS hier, .mjs dort), und die zwei liefen still
// auseinander.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../lib/supabase';
import { processParticipant, type ExtendedMatchData } from '../../lib/match-processor';
import { calculateStatsOverview } from '../../lib/stats-categories';
import { allPeriods, inPeriod, CURRENT_SEASON_ID, type SeasonPeriod } from '../../lib/seasons';
import { cacheHeaders } from '../../lib/api-cache';

// Hochzaehlen, sobald sich an der Bewertung etwas aendert
// (stats-categories.ts, match-processor.ts) — dann rechnet jede Zeile beim
// naechsten Aufruf neu.
const CALC_VERSION = 1;
// Darunter keine Bewertung: bei weniger Spielen schwanken die Kategorien so
// stark, dass die Zahl mehr Zufall als Leistung zeigt.
const MIN_GAMES = 20;
const RANKED_SOLO = 420;
const PAGE = 1000;                       // PostgREST liefert hoechstens 1000 Zeilen je Anfrage
const PUUID_RE = /^[A-Za-z0-9_-]{40,100}$/;

const NO_STORE = { 'Cache-Control': 'no-store' };
const CACHED = {
  ...cacheHeaders('public, s-maxage=600, stale-while-revalidate=3600'),
  'Vercel-Cache-Tag': 'lol-api',
};

interface LightRow { patch_major: number; patch_minor: number; game_creation: string }
interface FullRow {
  match_id: string;
  queue_id: number;
  game_creation: string;
  game_duration: number;
  team_kills: number;
  team_damage: number;
  team_gold: number;
  participant: any;
}

async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message || String(error));
    const rows = data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function toMatch(r: FullRow): ExtendedMatchData {
  return processParticipant(r.participant, {
    matchId: r.match_id,
    // Queue 420 wird ausschliesslich auf der Kluft der Beschwoerer gespielt;
    // die Ablage fuehrt das Feld nicht, und die Bewertung liest es nicht.
    gameMode: 'CLASSIC',
    queueId: r.queue_id,
    gameCreation: Date.parse(r.game_creation),
    gameDuration: r.game_duration,
    teamKills: r.team_kills,
    teamDamage: r.team_damage,
    teamGold: r.team_gold,
  });
}

export async function GET(request: NextRequest) {
  if (process.env.LOL_SEASON_STATS_ENABLED !== 'true') {
    return NextResponse.json({ enabled: false }, { headers: NO_STORE });
  }

  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid') || '';
  if (!PUUID_RE.test(puuid)) {
    return NextResponse.json({ error: 'Ungültige puuid' }, { status: 400, headers: NO_STORE });
  }
  const requested = searchParams.get('period');

  try {
    // 1. Welche Zeitraeume hat der Spieler, und mit wie vielen Spielen?
    const light = await readAll<LightRow>((from, to) =>
      supabaseAdmin
        .from('lol_player_match_cache')
        .select('patch_major,patch_minor,game_creation')
        .eq('puuid', puuid)
        .eq('queue_id', RANKED_SOLO)
        .order('game_creation', { ascending: false })
        .range(from, to),
    );

    const periods = allPeriods();
    const counts = new Map<string, { games: number; newest: number }>();
    for (const row of light) {
      const t = Date.parse(row.game_creation);
      for (const p of periods) {
        if (!inPeriod(p, row.patch_major, row.patch_minor)) continue;
        const c = counts.get(p.id) || { games: 0, newest: 0 };
        c.games++;
        if (t > c.newest) c.newest = t;
        counts.set(p.id, c);
      }
    }
    const available = periods.filter(p => (counts.get(p.id)?.games || 0) >= MIN_GAMES);
    const periodList = available.map(p => ({ id: p.id, label: p.label, games: counts.get(p.id)!.games }));

    if (available.length === 0) {
      return NextResponse.json(
        { enabled: true, periods: [], period: null, overview: null, coverage: null },
        { headers: CACHED },
      );
    }

    const period: SeasonPeriod | undefined =
      (requested && available.find(p => p.id === requested)) ||
      available.find(p => p.id === CURRENT_SEASON_ID) ||
      available[0];
    const check = counts.get(period.id)!;

    // 2. Abgelegte Zeile noch gueltig?
    const { data: stored, error: storedErr } = await supabaseAdmin
      .from('lol_player_season_stats')
      .select('games_raw,newest_match_at,calc_version,games_analyzed,first_game_at,last_game_at,overview')
      .eq('puuid', puuid)
      .eq('period_id', period.id)
      .maybeSingle();
    if (storedErr) throw new Error(storedErr.message);

    if (
      stored &&
      stored.calc_version === CALC_VERSION &&
      stored.games_raw === check.games &&
      stored.newest_match_at && Date.parse(stored.newest_match_at) === check.newest
    ) {
      return NextResponse.json({
        enabled: true,
        periods: periodList,
        period: period.id,
        overview: stored.overview,
        coverage: stored.games_analyzed
          ? { games: stored.games_analyzed, from: stored.first_game_at, to: stored.last_game_at }
          : null,
      }, { headers: CACHED });
    }

    // 3. Neu rechnen
    const full = await readAll<FullRow>((from, to) => {
      let q = supabaseAdmin
        .from('lol_player_match_cache')
        .select('match_id,queue_id,game_creation,game_duration,team_kills,team_damage,team_gold,participant')
        .eq('puuid', puuid)
        .eq('queue_id', RANKED_SOLO)
        .eq('patch_major', period.major);
      if (period.minMinor !== null) q = q.gte('patch_minor', period.minMinor);
      if (period.endMinor !== null) q = q.lt('patch_minor', period.endMinor);
      return q.order('game_creation', { ascending: false }).range(from, to);
    });

    // Remakes (Aufgabe in den ersten Minuten) sagen nichts ueber die Leistung.
    const matches = full.map(toMatch).filter(m => !m.gameEndedInEarlySurrender);
    const overview = matches.length >= MIN_GAMES ? calculateStatsOverview(matches, null) : null;

    let firstAt: string | null = null;
    let lastAt: string | null = null;
    if (matches.length) {
      const times = matches.map(m => m.gameCreation);
      firstAt = new Date(Math.min(...times)).toISOString();
      lastAt = new Date(Math.max(...times)).toISOString();
    }

    const { error: upErr } = await supabaseAdmin.from('lol_player_season_stats').upsert({
      puuid,
      period_id: period.id,
      games_raw: check.games,
      newest_match_at: new Date(check.newest).toISOString(),
      calc_version: CALC_VERSION,
      games_analyzed: matches.length,
      first_game_at: firstAt,
      last_game_at: lastAt,
      overview,
      computed_at: new Date().toISOString(),
    }, { onConflict: 'puuid,period_id' });
    // Ablegen ist nur Beschleunigung — scheitert es, liefern wir trotzdem aus.
    if (upErr) console.error('[player-season-stats] ablegen fehlgeschlagen:', upErr.message);

    return NextResponse.json({
      enabled: true,
      periods: periodList,
      period: period.id,
      overview,
      coverage: matches.length ? { games: matches.length, from: firstAt, to: lastAt } : null,
    }, { headers: CACHED });
  } catch (err: unknown) {
    console.error('[player-season-stats]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500, headers: NO_STORE });
  }
}
