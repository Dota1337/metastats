import { NextRequest, NextResponse } from 'next/server';
import { getAccountRouting, getRegionalRouting, isValidRegion, normalizeRegion, parseRegion } from '../../../lib/regions';
import { riotFetch } from '../../../lib/riot-fetch';

// Lightweight TFT summoner endpoint — resolves Riot ID to puuid, pulls TFT
// solo (1100) ranked entry and the latest match IDs. The match details are
// loaded via /api/tft/matches separately so the player page can render the
// header instantly while match cards stream in.
//
// Stage 2 deliberately keeps this stateless (no Supabase persistence yet) —
// caching + market value bookkeeping land in stage 3c where the marketvalue
// pipeline is wired up.

const TFT_RANKED_SOLO_QUEUE = 'RANKED_TFT';

interface RankedEntry {
  queueType: string;
  tier?: string;
  rank?: string;
  leaguePoints?: number;
  wins?: number;
  losses?: number;
}

// Region ist optional. Fehlt sie, wird der Account ueber einen beliebigen
// Cluster aufgeloest (account-v1 ist global) und der TFT-Server des Spielers
// ueber region/by-game/tft/by-puuid ermittelt — kein euw1-Standard mehr, der
// bei KR-/SEA-Spielern ein leeres Profil gezeigt hat.
//
// ?puuid= ist der Rueckfall fuer umbenannte Konten: findet der Name nichts,
// wird ueber die puuid aus dem Namensverzeichnis nachgeschlagen.
const AUTO_ACCOUNT_CLUSTER = 'europe';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name') || '';
  const rawRegion = normalizeRegion(searchParams.get('region'));
  const explicitRegion = rawRegion ? parseRegion(rawRegion) : null;
  const puuidHint = (searchParams.get('puuid') || '').trim();
  const apiKey = process.env.RIOT_API_KEY_TFT;
  if (!apiKey) {
    return NextResponse.json({ error: 'Riot API Key fehlt', code: 'no_key' }, { status: 503 });
  }
  if (rawRegion && !explicitRegion) {
    return NextResponse.json(
      { error: 'Ungültige Region', code: 'bad_region' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (puuidHint && !/^[A-Za-z0-9_-]{20,100}$/.test(puuidHint)) {
    return NextResponse.json(
      { error: 'Ungültige puuid', code: 'bad_puuid' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const accountCluster = explicitRegion ? getAccountRouting(explicitRegion) : AUTO_ACCOUNT_CLUSTER;

  const decoded = decodeURIComponent(name);
  const parts = decoded.split('#');
  const gameName = parts[0]?.trim();
  const tagLine = (parts[1] || 'EUW').trim();
  if (!gameName) {
    return NextResponse.json({ error: 'Kein Name angegeben', code: 'missing_name' }, { status: 400 });
  }

  try {
    // Riot Account is game-agnostic — same endpoint as LoL
    let accountRes = await riotFetch(`https://${accountCluster}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`, apiKey);
    if (accountRes.status === 404 && puuidHint) {
      accountRes = await riotFetch(`https://${accountCluster}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuidHint)}`, apiKey);
    }
    if (!accountRes.ok) {
      if (accountRes.status === 401 || accountRes.status === 403) {
        return NextResponse.json({ error: 'Riot API Key ungültig', code: 'riot_auth' }, { status: 503 });
      }
      if (accountRes.status === 404) {
        return NextResponse.json({ error: 'Spieler nicht gefunden', code: 'not_found' }, { status: 404 });
      }
      if (accountRes.status === 429) {
        return NextResponse.json({ error: 'Daten in Kürze wieder verfügbar', code: 'riot_rate_limit' }, { status: 429 });
      }
      return NextResponse.json({ error: `Riot API Fehler (${accountRes.status})`, code: 'riot_upstream' }, { status: 502 });
    }
    const account = await accountRes.json();
    const puuid: string = account.puuid;

    let region = explicitRegion;
    if (!region) {
      const regionRes = await riotFetch(`https://${AUTO_ACCOUNT_CLUSTER}.api.riotgames.com/riot/account/v1/region/by-game/tft/by-puuid/${puuid}`, apiKey);
      if (regionRes.status === 429) {
        return NextResponse.json({ error: 'Daten in Kürze wieder verfügbar', code: 'riot_rate_limit' }, { status: 429 });
      }
      if (regionRes.status === 404) {
        // Konto existiert, hat aber nie TFT gespielt.
        return NextResponse.json({ error: 'Spieler nicht gefunden', code: 'not_found' }, { status: 404 });
      }
      if (!regionRes.ok) {
        return NextResponse.json({ error: `Riot API Fehler (${regionRes.status})`, code: 'riot_upstream' }, { status: 502 });
      }
      const found = normalizeRegion((await regionRes.json())?.region);
      if (!isValidRegion(found)) {
        return NextResponse.json({ error: 'Unbekannter Server', code: 'riot_upstream' }, { status: 502 });
      }
      region = found;
    }
    const regional = getRegionalRouting(region);

    // Three calls in parallel: TFT summoner-by-puuid (icon, level), TFT ranked
    // entries (solo + double-up + hyperroll), recent match IDs (queue 1100).
    // count=120 covers the 4-page pagination (30 per page) on the player page;
    // Riot's match-v1 endpoint accepts up to 200 in a single call.
    const [summonerRes, rankedRes, matchIdsRes] = await Promise.all([
      riotFetch(`https://${region}.api.riotgames.com/tft/summoner/v1/summoners/by-puuid/${puuid}`, apiKey),
      riotFetch(`https://${region}.api.riotgames.com/tft/league/v1/by-puuid/${puuid}`, apiKey),
      riotFetch(`https://${regional}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuid}/ids?count=120`, apiKey),
    ]);

    const summoner = summonerRes.ok ? await summonerRes.json() : null;
    const rankedAll: RankedEntry[] = rankedRes.ok ? await rankedRes.json() : [];
    const matchIds: string[] = matchIdsRes.ok ? await matchIdsRes.json() : [];

    // Filter to the standard solo queue — that's what we display & later use
    // for market value. Double Up / Hyper Roll deliberately out-of-scope.
    const soloRanked = Array.isArray(rankedAll)
      ? rankedAll.find(r => r.queueType === TFT_RANKED_SOLO_QUEUE) || null
      : null;

    // Spielerbezogene Antwort — nichts, was eine Zwischenspeicherung verträgt.
    // Ohne diese Zeile setzt Next gar keine Angabe, und dann entscheidet jede
    // Zwischenstation selbst; der 400er-Zweig oben (Z. 36) macht es seit jeher
    // richtig, der Erfolgsfall war die Lücke.
    return NextResponse.json({
      summoner: {
        name: `${account.gameName}#${account.tagLine}`,
        puuid,
        profileIconId: summoner?.profileIconId ?? null,
        summonerLevel: summoner?.summonerLevel ?? null,
        tier: soloRanked?.tier || null,
        rank: soloRanked?.rank || null,
      },
      ranked: soloRanked,
      matchIds,
      region,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('TFT summoner error:', err);
    return NextResponse.json({ error: 'Server Fehler', code: 'server_error' }, { status: 500 });
  }
}
