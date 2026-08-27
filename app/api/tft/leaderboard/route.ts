import { NextRequest, NextResponse } from 'next/server';
import { getRegionalRouting, parseRegion } from '../../../lib/regions';
import { riotFetch } from '../../../lib/riot-fetch';
import { cachedJson, STATS_CACHE_CONTROL_FRESH } from '../../../lib/api-cache';

// /api/tft/leaderboard?region=euw1&tier=CHALLENGER
// /api/tft/leaderboard?region=euw1&tier=GOLD&division=II&page=3
//
// Pulls a TFT ranked ladder slice from Riot. The crawler doesn't pre-build
// this — we go to Riot live each request because the data changes constantly.
//
// Zwei Riot-Pfade, weil die League-v1-API zwei Formen hat:
//   Apex (Master/GM/Challenger): /tft/league/v1/{tier} -> ein Objekt mit
//     `entries`, die komplette Liga in einer Antwort, unsortiert.
//   Darunter: /tft/league/v1/entries/{TIER}/{DIVISION}?page=N -> ein blankes
//     Array, 205 Eintraege pro Seite (gemessen 2026-08-27), keine Sortierung
//     und keine Gesamtzahl.
//
// PAGE_SIZE ist bewusst 50 und nicht 205: fuer jede angezeigte Zeile faellt ein
// account-v1-Call zur Namensaufloesung an. 205 Zeilen waeren 206 Riot-Calls pro
// Seitenaufruf auf einem App-Limit von 500 in 10s, das wir uns mit den Crawlern
// teilen. Mit 50 sind es maximal 52.

// Der Abstieg ueber alle Raenge kann bis zu 7 Rang-Gruppen nacheinander holen.
// Der Vercel-Default von 10s reicht dafuer nicht.
export const maxDuration = 60;

const APEX_TIERS = new Set(['CHALLENGER', 'GRANDMASTER', 'MASTER']);
const TIERS = new Set([
  'CHALLENGER', 'GRANDMASTER', 'MASTER',
  'DIAMOND', 'EMERALD', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE', 'IRON',
]);
const DIVISIONS = new Set(['I', 'II', 'III', 'IV']);

const PAGE_SIZE = 50;
const RIOT_PAGE = 205;
// Namensaufloesung in einem Schub statt in drei. Gemessen 2026-08-27: 50
// parallele account-v1-Calls liegen unter dem App-Limit (500 in 10s), sparen
// aber zwei Rundreisen pro Seitenaufruf. riotFetch beachtet Retry-After.
const NAME_BATCH = 50;
const MAX_PAGE = 200;

// Standardansicht "alle Raenge" (2026-08-27).
//
// Riot kennt keine Abfrage "die besten N Spieler einer Region" — es gibt nur
// die drei Apex-Ligen und darunter Tier+Division einzeln. Die Ansicht steigt
// deshalb von oben ab und sammelt, bis die angeforderte Seite voll ist.
// Gemessen am 2026-08-27 (euw1, einen Tag nach dem Set-18-Start): Challenger,
// Grossmeister, Meister und Diamant I sind leer, der hoechste besetzte Rang
// ist Diamant IV. Genau dafuer ist der Abstieg da.
//
// Gedeckelt auf 10 Seiten a 50 = 500 Spieler. Ohne Deckel muesste jede tiefe
// Seite den kompletten Abstieg wiederholen; bei Seite 200 waeren das gemessene
// 64 Riot-Abfragen fuer einen einzigen Aufruf.
const ALL_TIERS = 'ALL';
const MAX_PAGE_ALL = 10;

// Innerhalb einer Gruppe wird parallel geholt, die Gruppen nacheinander —
// so kostet ein Abstieg pro Rang eine Rundreise statt vier.
const LADDER_GROUPS: { tier: string; division: string | null }[][] = [
  [{ tier: 'CHALLENGER', division: null }],
  [{ tier: 'GRANDMASTER', division: null }],
  [{ tier: 'MASTER', division: null }],
  ...['DIAMOND', 'EMERALD', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE', 'IRON'].map(t =>
    ['I', 'II', 'III', 'IV'].map(d => ({ tier: t, division: d })),
  ),
];

// Seitenwaechter je Division. Eine volle Gold-IV-Division hat mehrere tausend
// Eintraege; wir brauchen hoechstens 500 und brechen deshalb frueh ab.
const DIVISION_PAGE_GUARD = 5;

// Holt eine komplette Liga-Stufe und sortiert sie nach LP. Gibt null zurueck,
// wenn Riot einen Fehler liefert — der Aufrufer macht daraus einen 502.
async function fetchBucket(region: string, apiKey: string, tier: string, division: string | null): Promise<any[] | null> {
  const out: any[] = [];
  if (division === null) {
    const res = await riotFetch(`https://${region}.api.riotgames.com/tft/league/v1/${tier.toLowerCase()}`, apiKey);
    if (!res.ok) return null;
    const league = await res.json();
    out.push(...(league.entries || []).map((e: any) => ({ ...e, tier })));
  } else {
    for (let p = 1; p <= DIVISION_PAGE_GUARD; p++) {
      const url = `https://${region}.api.riotgames.com/tft/league/v1/entries/${tier}/${division}?page=${p}`;
      const res = await riotFetch(url, apiKey);
      if (!res.ok) return null;
      const arr = await res.json();
      const list = Array.isArray(arr) ? arr : [];
      out.push(...list.map((e: any) => ({ ...e, tier, rank: e.rank || division })));
      if (list.length < RIOT_PAGE) break;
    }
  }
  return out.filter((e: any) => e.puuid).sort((a: any, b: any) => b.leaguePoints - a.leaguePoints);
}

function bad(error: string, code: string) {
  return NextResponse.json({ error, code }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = parseRegion(searchParams.get('region'), { fallback: 'euw1' });
  const tier = (searchParams.get('tier') || 'CHALLENGER').toUpperCase();
  const division = (searchParams.get('division') || 'I').toUpperCase();
  const isAll = tier === ALL_TIERS;
  const page = Math.max(1, Math.min(isAll ? MAX_PAGE_ALL : MAX_PAGE, parseInt(searchParams.get('page') || '1', 10) || 1));

  const apiKey = process.env.RIOT_API_KEY_TFT;
  if (!apiKey) {
    return NextResponse.json({ error: 'Riot API Key fehlt', code: 'no_key' }, { status: 503 });
  }
  if (!region) return bad('Ungueltige Region', 'bad_region');
  if (!isAll && !TIERS.has(tier)) return bad(`Tier ${tier} nicht unterstuetzt.`, 'bad_tier');
  const isApex = !isAll && APEX_TIERS.has(tier);
  if (!isAll && !isApex && !DIVISIONS.has(division)) return bad(`Division ${division} nicht unterstuetzt.`, 'bad_division');

  const startIdx = (page - 1) * PAGE_SIZE;

  try {
    let slice: any[] = [];
    let hasNextPage = false;
    let totalPlayers: number | null = null;

    if (isAll) {
      // Von oben nach unten sammeln, bis die angeforderte Seite voll ist.
      // Jede angefasste Stufe wird komplett geholt (bis zum Seitenwaechter),
      // deshalb ist die Reihenfolge Rang -> Division -> LP durchgaengig echt
      // und die laufende Platznummer belastbar.
      const need = startIdx + PAGE_SIZE;
      const collected: any[] = [];
      let groupsLeft = false;
      for (const group of LADDER_GROUPS) {
        if (collected.length >= need) { groupsLeft = true; break; }
        const buckets = await Promise.all(group.map(b => fetchBucket(region, apiKey, b.tier, b.division)));
        for (const b of buckets) {
          if (b === null) return NextResponse.json({ error: 'Riot API Fehler' }, { status: 502 });
          collected.push(...b);
        }
      }
      slice = collected.slice(startIdx, startIdx + PAGE_SIZE);
      // Nur wenn die komplette Leiter abgelaufen wurde, ist die Zahl echt.
      totalPlayers = groupsLeft ? null : collected.length;
      hasNextPage = page < MAX_PAGE_ALL && collected.length > startIdx + PAGE_SIZE;
    } else if (isApex) {
      const res = await riotFetch(`https://${region}.api.riotgames.com/tft/league/v1/${tier.toLowerCase()}`, apiKey);
      if (!res.ok) {
        return NextResponse.json({ error: `Riot API Fehler (${res.status})` }, { status: 502 });
      }
      const league = await res.json();
      const all = (league.entries || [])
        .filter((e: any) => e.puuid)
        .sort((a: any, b: any) => b.leaguePoints - a.leaguePoints);
      totalPlayers = all.length;
      slice = all.slice(startIdx, startIdx + PAGE_SIZE);
      hasNextPage = startIdx + PAGE_SIZE < all.length;
    } else {
      // Das gewuenschte 50er-Fenster kann ueber die Grenze einer 205er-
      // Riot-Seite laufen (50 teilt 205 nicht), deshalb ggf. zwei Seiten holen.
      const firstRiotPage = Math.floor(startIdx / RIOT_PAGE) + 1;
      const lastRiotPage = Math.floor((startIdx + PAGE_SIZE - 1) / RIOT_PAGE) + 1;
      const bucketStart = (firstRiotPage - 1) * RIOT_PAGE;
      let bucket: any[] = [];
      let exhausted = false;
      for (let p = firstRiotPage; p <= lastRiotPage; p++) {
        const url = `https://${region}.api.riotgames.com/tft/league/v1/entries/${tier}/${division}?page=${p}`;
        const res = await riotFetch(url, apiKey);
        if (!res.ok) {
          return NextResponse.json({ error: `Riot API Fehler (${res.status})` }, { status: 502 });
        }
        const arr = await res.json();
        const list = Array.isArray(arr) ? arr : [];
        bucket = bucket.concat(list);
        if (list.length < RIOT_PAGE) { exhausted = true; break; }
      }
      const offset = startIdx - bucketStart;
      // Nur innerhalb der Seite nach LP sortiert. Riot liefert die Eintraege
      // unsortiert und ohne Gesamtzahl; eine ligaweite Reihenfolge liesse sich
      // nur mit dem kompletten Abzug der Division herstellen. Deshalb steht
      // unterhalb von Master auch keine Rangnummer in der Antwort.
      slice = bucket
        .filter((e: any) => e.puuid)
        .slice(offset, offset + PAGE_SIZE)
        .sort((a: any, b: any) => b.leaguePoints - a.leaguePoints);
      hasNextPage = exhausted ? offset + PAGE_SIZE < bucket.length : true;
    }

    // Namen in Schueben aufloesen, hoechstens PAGE_SIZE Stueck.
    const idMap: Record<string, { gameName: string; tagLine: string }> = {};
    const regional = getRegionalRouting(region);
    for (let i = 0; i < slice.length; i += NAME_BATCH) {
      const batch = slice.slice(i, i + NAME_BATCH);
      await Promise.all(batch.map(async (e: any) => {
        try {
          const r = await riotFetch(`https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${e.puuid}`, apiKey);
          if (r.ok) idMap[e.puuid] = await r.json();
        } catch {}
      }));
    }

    const players = slice.map((e: any, idx: number) => ({
      rank: (isApex || isAll) ? startIdx + idx + 1 : null,
      puuid: e.puuid,
      gameName: idMap[e.puuid]?.gameName || null,
      tagLine: idMap[e.puuid]?.tagLine || null,
      tier: e.tier || tier,
      division: APEX_TIERS.has(e.tier || tier) ? null : (e.rank || (isAll ? null : division)),
      leaguePoints: e.leaguePoints,
      wins: e.wins,
      losses: e.losses,
    }));

    return cachedJson(
      { region, tier, division: (isAll || isApex) ? null : division, page, pageSize: PAGE_SIZE, hasNextPage, totalPlayers, players },
      // Leere Antwort nur 10s cachen: nach einem Set-Start sind die Apex-Ligen
      // tagelang leer und fuellen sich dann innerhalb von Stunden. Ein 5-min-TTL
      // wuerde die erste gefuellte Ladder verzoegern.
      { cache: STATS_CACHE_CONTROL_FRESH, degraded: players.length === 0 },
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
