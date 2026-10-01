import { NextRequest, NextResponse } from 'next/server';
import { processMatch, toLegacyMatchData, extractParticipants, extractBans, type ExtendedMatchData } from '../../lib/match-processor';
import { calculateStatsOverview } from '../../lib/stats-categories';

import { getRegionalRouting, parseRegion } from '../../lib/regions';
import { riotFetch } from '../../lib/riot-fetch';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid') || '';
  const region = parseRegion(searchParams.get('region'), { fallback: 'euw1' });
  const apiKey = process.env.RIOT_API_KEY!;
  const start = parseInt(searchParams.get('start') || '0', 10);
  const count = parseInt(searchParams.get('count') || '30', 10);
  if (!region) {
    return NextResponse.json(
      { error: 'Ungültige Region' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const regional = getRegionalRouting(region);

  try {
    const matchListRes = await riotFetch(`https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=${start}&count=${Math.min(count, 30)}`, apiKey);

    if (!matchListRes.ok) {
      const st = matchListRes.status;
      const retryAfter = matchListRes.headers.get('Retry-After');
      if (st === 404 || st === 400) {
        return NextResponse.json({ error: 'Match History nicht gefunden' }, { status: 404 });
      }
      // Limit, Schluessel- oder Riot-Ausfall ist kein „nicht gefunden".
      const code = st === 429 ? 'rate_limited' : (st === 401 || st === 403) ? 'riot_auth' : 'riot_upstream';
      return NextResponse.json(
        { error: `Riot API Fehler (${st})`, code },
        { status: 503, headers: { 'Cache-Control': 'no-store', ...(retryAfter ? { 'Retry-After': retryAfter } : {}) } },
      );
    }

    const matchIds: string[] = await matchListRes.json();

    // In Zehnerbloecken wie /api/summoner — 30 gleichzeitige Abrufe treiben den
    // Schluessel selbst ins Limit.
    // null = voruebergehend fehlend (429/5xx/Netz) -> spaeter nachholbar,
    // undefined = gibt es bei Riot nicht (404) -> endgueltig ueberspringen.
    const rawMatches: any[] = [];
    for (let i = 0; i < matchIds.length; i += 10) {
      const batch = await Promise.all(
        matchIds.slice(i, i + 10).map(async (id) => {
          try {
            // Eine statt zwei Wiederholungen: bei Ueberlast sonst bis zu 90 Abrufe pro
            // Klick — die Luecke holt der Knopf nach.
            const res = await riotFetch(`https://${regional}.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(id)}`, apiKey, {}, 1);
            if (res.ok) return await res.json();
            return res.status === 404 ? undefined : null;
          } catch {
            return null;
          }
        })
      );
      rawMatches.push(...batch);
    }
    const firstMissing = rawMatches.findIndex((r) => r === null);
    const missing = rawMatches.filter((r) => r === null).length;

    const extended = rawMatches
      .filter(Boolean)
      .map(raw => processMatch(raw, puuid))
      .filter(Boolean);

    // Build participant + ban maps for detailed match view
    const participantsMap: Record<string, any> = {};
    const bansMap: Record<string, any> = {};
    for (const raw of rawMatches.filter(Boolean)) {
      if (!raw?.metadata?.matchId) continue;
      participantsMap[raw.metadata.matchId] = extractParticipants(raw);
      bansMap[raw.metadata.matchId] = extractBans(raw);
    }

    // Return both extended data and legacy format for backwards compatibility
    const legacy = (extended as ExtendedMatchData[]).map(m => ({
      ...toLegacyMatchData(m!),
      // der Coach misst Objektiv-Kontrolle daran (wie /api/summoner)
      damageDealtToObjectives: m!.damageDealtToObjectives,
      damageDealtToBuildings: m!.damageDealtToBuildings,
      participants: participantsMap[m!.matchId] || [],
      bans: bansMap[m!.matchId] || [],
    }));
    const statsOverview = calculateStatsOverview(extended as ExtendedMatchData[], null);

    // Versatz fuer „mehr laden" nach Zahl der IDs, nicht der gelieferten Spiele
    // (verworfene Spiele verschoeben sonst die naechste Seite). Fehlen Details
    // voruebergehend (429), beginnt die naechste Seite beim ersten fehlenden
    // Spiel — die Seite holt die Luecke so nach und filtert Doppelte per matchId.
    // Gleiche Rechnung: matchesNextStart in /api/summoner.
    return NextResponse.json(
      {
        matches: legacy, extended, statsOverview,
        nextStart: start + (firstMissing >= 0 ? firstMissing : matchIds.length),
        hasMore: missing > 0 || matchIds.length >= Math.min(count, 30),
        missing,
      },
      missing > 0 ? { headers: { 'Cache-Control': 'no-store' } } : undefined,
    );

  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}
