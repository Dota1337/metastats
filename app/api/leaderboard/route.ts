import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../lib/supabase';

import { getAccountRouting, parseRegion, REGION_ALL } from '../../lib/regions';
import { riotFetch } from '../../lib/riot-fetch';
import { cachedJson } from '../../lib/api-cache';
import { APEX_ORDER, LOL_LADDER, isLolRankGroup, lolTiersTopDown } from '../../lib/rank-groups';

// Riot oder Datenbank nicht erreichbar: ehrlich 503 statt leerer oder
// ersatzweise sortierter Liste. Die Seite zeigt dann „nicht erreichbar“.
function unavailable() {
  return NextResponse.json(
    { error: 'Rangliste gerade nicht erreichbar', entries: [] },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } },
  );
}

const DIVISION_ORDER = ['I', 'II', 'III', 'IV'];
// Diamond+ / Emerald+ / Platinum+: hoechstens 5 Seiten a 100 = 500 Spieler,
// je Division hoechstens 3 Riot-Seiten a 205 (Dev-Key-Limit).
const DESCENT_MAX_PAGE = 5;
const DESCENT_DIVISION_PAGES = 3;

// Master+ holt drei Ligen parallel plus bis zu 80 Namensaufloesungen.
export const maxDuration = 60;

// In-memory cache for PUUID -> Riot ID (gameName#tagLine)
const nameCache: Record<string, string> = {};
// Hoechstens so viele Namen je Anfrage und nur bis zur Frist: der Dev-Key
// (100 Abfragen je 2 min) wird mit dem Match-Sammler auf der Box geteilt.
// Zeilen ohne Namen verlinken auf /api/leaderboard/resolve.
const NAME_RESOLVE_BATCH = 40;
const NAME_RESOLVE_BUDGET_MS = 12_000;
// Spieler-Abgleich mit der Datenbank in Stuecken, damit die URL kurz bleibt.
const KNOWN_CHUNK = 50;

function badRequest(error: string) {
  return NextResponse.json({ error, entries: [] }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
}

// Eintrag aus Riots league-v4 (Apex-Liga oder Division), um Rang ergaenzt.
type RiotEntry = { tier?: string; rank?: string; leaguePoints: number; [k: string]: unknown };

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // 'all' ist hier ein legitimer Modus (Regionen-übergreifende Ansicht) und
  // wird weiter unten auf euw1 als Riot-Platform gemappt.
  const region = parseRegion(searchParams.get('region'), { fallback: 'euw1', allowAll: true });
  const tier = searchParams.get('tier') || 'CHALLENGER';
  if (!region) {
    return NextResponse.json(
      { error: 'Ungültige Region' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const division = searchParams.get('division') || '';
  const parsedPage = parseInt(searchParams.get('page') || '1', 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
  const search = (searchParams.get('search') || '').trim();
  const PAGE_SIZE = 100;
  const apiKey = process.env.RIOT_API_KEY;

  try {
    // Search mode: find players by name in Supabase
    if (search) {
      if (search.length < 2) return badRequest('Suchbegriff zu kurz');
      // % und _ sind in ilike Platzhalter — als normale Zeichen suchen.
      const pattern = search.replace(/[\\%_]/g, (c) => '\\' + c);
      let searchQuery = supabase
        .from('players')
        .select('summoner_name, region, tier, rank, winrate, market_value, summoner_level, profile_icon_id')
        .ilike('summoner_name', `%${pattern}%`);
      if (region !== REGION_ALL) searchQuery = searchQuery.eq('region', region);
      const { data: searchResults, error: searchError } = await searchQuery
        .order('market_value', { ascending: false, nullsFirst: false })
        .limit(20);
      if (searchError) return unavailable();

      return NextResponse.json({
        entries: (searchResults || []).map((p, i) => ({
          rank: i + 1,
          summonerName: p.summoner_name,
          region: p.region,
          tier: p.tier,
          playerRank: p.rank,
          winrate: p.winrate || 0,
          marketValue: p.market_value,
          level: p.summoner_level,
          profileIcon: p.profile_icon_id,
        })),
        source: 'search',
        tier: null,
      });
    }

    if (!(LOL_LADDER as readonly string[]).includes(tier) && !isLolRankGroup(tier)) return badRequest('Ungültiger Rang');
    if (division && !DIVISION_ORDER.includes(division)) return badRequest('Ungültige Division');

    // Primary: fetch from Riot API
    if (apiKey) {
      const riotRegion = region === REGION_ALL ? 'euw1' : region;
      // X+-Gruppen (app/lib/rank-groups.ts) mischen mehrere Ligen. Reicht eine
      // Gruppe unter Master (Diamond+ und tiefer), wird unterhalb der
      // Apex-Ligen Division fuer Division von oben abgestiegen.
      const groupTiers = isLolRankGroup(tier) ? lolTiersTopDown(tier) : null;
      const isApex = groupTiers !== null || APEX_ORDER.includes(tier);
      const apexTiers = groupTiers ? groupTiers.filter(x => APEX_ORDER.includes(x)) : [tier];
      const lowerTiers = groupTiers ? groupTiers.filter(x => !APEX_ORDER.includes(x)) : [];
      const isDescent = lowerTiers.length > 0;
      let descentLeft = false;
      let peekFailed = false;

      let riotRes: Response;
      if (isApex) {
        // Alle Ligen parallel, alles oder nichts: fehlt eine, waere die
        // Rangfolge still falsch — dann 503 statt einer Teil-Rangliste.
        const leagues: (RiotEntry[] | null)[] = await Promise.all(apexTiers.map(async (tr) => {
          const tierEndpoint = tr === 'GRANDMASTER' ? 'grandmasterleagues'
            : tr === 'MASTER' ? 'masterleagues'
            : 'challengerleagues';
          const r = await riotFetch(`https://${riotRegion}.api.riotgames.com/lol/league/v4/${tierEndpoint}/by-queue/RANKED_SOLO_5x5`, apiKey);
          if (!r.ok) return null;
          const l = await r.json();
          return (l.entries || []).map((e: RiotEntry) => ({ ...e, tier: tr }));
        }));
        if (isDescent && !leagues.some(l => l === null)) {
          // Abstieg bis die angeforderte Seite voll ist, gedeckelt auf
          // DESCENT_MAX_PAGE Seiten. Divisionen eines Rangs parallel.
          const need = Math.min(page, DESCENT_MAX_PAGE) * PAGE_SIZE;
          let collected = leagues.reduce((n, l) => n + (l?.length || 0), 0);
          for (const tr of lowerTiers) {
            if (collected >= need) { descentLeft = true; break; }
            const divs = await Promise.all(['I', 'II', 'III', 'IV'].map(async (div) => {
              const out: RiotEntry[] = [];
              for (let p = 1; p <= DESCENT_DIVISION_PAGES; p++) {
                const r = await riotFetch(`https://${riotRegion}.api.riotgames.com/lol/league/v4/entries/RANKED_SOLO_5x5/${tr}/${div}?page=${p}`, apiKey);
                if (!r.ok) return null;
                const list = await r.json();
                const arr = Array.isArray(list) ? list : [];
                out.push(...arr.map((e: RiotEntry) => ({ ...e, tier: tr, rank: e.rank || div })));
                if (arr.length < 205) break;
              }
              return out;
            }));
            leagues.push(...divs);
            collected += divs.reduce((n, l) => n + (l?.length || 0), 0);
            if (divs.some(l => l === null)) break;
          }
        }
        riotRes = leagues.some(l => l === null)
          ? new Response(null, { status: 502 })
          : new Response(JSON.stringify({ tier, entries: leagues.flat() }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
      } else {
        // For Diamond and below: fetch the specific division + page from Riot API
        const div = division || 'I';
        const riotPageRes = await riotFetch(`https://${riotRegion}.api.riotgames.com/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${div}?page=${page}`, apiKey);
        if (!riotPageRes.ok) return unavailable();
        const pageList = await riotPageRes.json();
        const pageEntries = Array.isArray(pageList) ? pageList : [];

        // Gibt es eine naechste Seite? Scheitert der Blick, gilt eine volle
        // Seite als „vermutlich mehr“ — und die Antwort wird nur kurz gecacht.
        let hasNextPage = false;
        if (pageEntries.length >= 205) {
          const peekRes = await riotFetch(`https://${riotRegion}.api.riotgames.com/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${div}?page=${page + 1}`, apiKey, {}, 0);
          if (peekRes.ok) {
            const peek = await peekRes.json();
            hasNextPage = Array.isArray(peek) && peek.length > 0;
          } else {
            hasNextPage = true;
            peekFailed = true;
          }
        }

        const combinedEntries = pageEntries.map((e: any) => ({
          puuid: e.puuid || null,
          summonerName: e.summonerName || null,
          leaguePoints: e.leaguePoints || 0,
          rank: e.rank,
          wins: e.wins || 0,
          losses: e.losses || 0,
          veteran: e.veteran || false,
          hotStreak: e.hotStreak || false,
          freshBlood: e.freshBlood || false,
        }));
        // Create a synthetic Response
        riotRes = new Response(JSON.stringify({ tier, entries: combinedEntries, _page: page, _hasNextPage: hasNextPage, _division: div }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (riotRes.ok) {
        const league = await riotRes.json();
        // Erst nach Rang (Challenger vor Grandmaster …), dann Division, dann LP.
        const sortedAll = (league.entries || [])
          .sort((a: RiotEntry, b: RiotEntry) => {
            const ra = (LOL_LADDER as readonly string[]).indexOf(a.tier ?? '');
            const rb = (LOL_LADDER as readonly string[]).indexOf(b.tier ?? '');
            if (ra !== rb) return ra - rb;
            const da = (DIVISION_ORDER as readonly string[]).indexOf(a.rank ?? '');
            const db = (DIVISION_ORDER as readonly string[]).indexOf(b.rank ?? '');
            if (da !== db) return da - db;
            return b.leaguePoints - a.leaguePoints;
          });

        // For apex tiers: paginate server-side. For non-apex: already paginated by Riot API.
        let pageEntries: any[];
        let totalPlayers: number;
        let hasNextPage: boolean;
        let currentPage: number;
        let startRank: number;

        if (isApex) {
          totalPlayers = sortedAll.length;
          const start = (page - 1) * PAGE_SIZE;
          pageEntries = sortedAll.slice(start, start + PAGE_SIZE);
          hasNextPage = start + PAGE_SIZE < totalPlayers && (!isDescent || page < DESCENT_MAX_PAGE);
          currentPage = page;
          startRank = start;
        } else {
          pageEntries = sortedAll;
          totalPlayers = pageEntries.length; // we don't know the total for non-apex
          hasNextPage = league._hasNextPage || false;
          currentPage = league._page || page;
          startRank = (currentPage - 1) * 205; // Riot uses 205 per page
        }

        // Bekannte Spieler nur fuer die gezeigte Seite nachschlagen (die ganze
        // Region liefe in den 1000-Zeilen-Deckel von Supabase).
        const pagePuuids = pageEntries.map((e: { puuid?: string | null }) => e.puuid).filter(Boolean) as string[];
        const chunks: string[][] = [];
        for (let i = 0; i < pagePuuids.length; i += KNOWN_CHUNK) chunks.push(pagePuuids.slice(i, i + KNOWN_CHUNK));
        const knownPlayers = (await Promise.all(chunks.map(async (c) => {
          const { data } = await supabase
            .from('players')
            .select('puuid, summoner_name, market_value, profile_icon_id, summoner_level')
            .eq('region', riotRegion)
            .in('puuid', c);
          return data || [];
        }))).flat();

        const knownMap: Record<string, any> = {};
        for (const p of knownPlayers || []) {
          if (p.puuid) {
            knownMap[p.puuid] = p;
            if (p.summoner_name && !nameCache[p.puuid]) {
              nameCache[p.puuid] = p.summoner_name;
            }
          }
        }

        // Resolve missing names via Account API (batched)
        // account-v1 kennt kein sea — OCE/SEA-Namen liegen auf europe.
        const regional = getAccountRouting(riotRegion);
        const unresolvedPuuids = pageEntries
          .map((e: any) => e.puuid)
          .filter((puuid: string) => puuid && !nameCache[puuid]);

        const toResolve = unresolvedPuuids.slice(0, NAME_RESOLVE_BATCH);
        const deadline = Date.now() + NAME_RESOLVE_BUDGET_MS;
        if (toResolve.length > 0) {
          for (let i = 0; i < toResolve.length; i += 10) {
            const left = deadline - Date.now();
            if (left <= 500) break;
            const batch = toResolve.slice(i, i + 10);
            await Promise.all(
              batch.map(async (puuid: string) => {
                try {
                  const accRes = await riotFetch(`https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}`, apiKey, { signal: AbortSignal.timeout(left) });
                  if (accRes.ok) {
                    const acc = await accRes.json();
                    if (acc.gameName) {
                      nameCache[puuid] = `${acc.gameName}#${acc.tagLine || ''}`;
                    }
                  }
                } catch {}
              })
            );
          }
        }

        const entries = pageEntries.map((e: any, i: number) => {
          const known = e.puuid ? knownMap[e.puuid] : null;
          const cachedName = e.puuid ? nameCache[e.puuid] : null;
          const wr = (e.wins + e.losses) > 0
            ? Math.round((e.wins / (e.wins + e.losses)) * 100)
            : 0;

          return {
            rank: startRank + i + 1,
            summonerName: cachedName || known?.summoner_name || null,
            puuid: e.puuid || null,
            region: riotRegion,
            tier: e.tier || league.tier,
            playerRank: e.rank,
            leaguePoints: e.leaguePoints,
            wins: e.wins,
            losses: e.losses,
            winrate: wr,
            marketValue: known?.market_value || null,
            level: known?.summoner_level || 0,
            profileIcon: known?.profile_icon_id || 0,
            veteran: e.veteran,
            hotStreak: e.hotStreak,
            freshBlood: e.freshBlood,
          };
        });

        return cachedJson({
          entries,
          source: 'riot',
          tier: league.tier,
          // Beim Abstieg ist die Zahl nur echt, wenn die ganze Gruppe gelesen wurde.
          totalPlayers: isApex && !(isDescent && descentLeft) ? totalPlayers : undefined,
          page: currentPage,
          hasNextPage,
          hasPrevPage: currentPage > 1,
          region: riotRegion,
        // stale-if-error: faellt Riot spaeter aus, darf der Rand die letzte
        // gute Liste noch zehn Minuten weiterzeigen.
        }, { cache: 'public, s-maxage=300, stale-while-revalidate=600, stale-if-error=600', degraded: entries.length === 0 || peekFailed });
      }
    }

    // Kein Key oder eine Liga fehlt. Frueher stand hier eine Ersatzliste nach
    // Marktwert mit Rang 1-50 — die sah aus wie die Rangliste, war es aber nicht.
    return unavailable();

  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler', entries: [] }, { status: 500 });
  }
}
