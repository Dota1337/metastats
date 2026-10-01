import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../../lib/supabase';
import { getAccountRouting, parseRegion } from '../../../lib/regions';
import { riotFetch } from '../../../lib/riot-fetch';
import { checkRateLimit } from '../../../lib/rate-limit';
import { cacheHeaders } from '../../../lib/api-cache';

// Rangliste: Zeilen, deren Name beim Laden nicht aufgeloest wurde, verlinken
// hierher. Erst beim Klick wird die Riot-ID geholt und auf die Spielerseite
// weitergeleitet — so kostet nur ein echter Klick eine Riot-Abfrage.
const PUUID_RE = /^[A-Za-z0-9_-]{20,100}$/;

function back(request: NextRequest) {
  return NextResponse.redirect(new URL('/leaderboard', request.url), {
    status: 307,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function toPlayer(request: NextRequest, riotId: string, region: string) {
  const [name, tag] = riotId.split('#');
  const path = '/player/' + encodeURIComponent(name) + '--' + encodeURIComponent(tag || '') + '?region=' + region;
  return NextResponse.redirect(new URL(path, request.url), {
    status: 307,
    // Wiederholte Klicks sollen Riot nicht erneut fragen. Eine Stunde statt
    // eines Tages: nach einer Umbenennung zeigte der Link sonst bis zu 24 h auf
    // den alten Namen, und die Spielerseite meldete "nicht gefunden".
    headers: cacheHeaders('public, s-maxage=3600, stale-while-revalidate=3600'),
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = (searchParams.get('puuid') || '').trim();
  const region = parseRegion(searchParams.get('region'), { fallback: 'euw1' });
  if (!region || !PUUID_RE.test(puuid)) {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const limited = checkRateLimit(request, { key: 'leaderboard-resolve', max: 10, windowMs: 60_000 });
  if (limited) return limited;

  const { data: known } = await supabase
    .from('players')
    .select('summoner_name')
    .eq('puuid', puuid)
    .eq('region', region)
    .limit(1);
  const knownName = known?.[0]?.summoner_name as string | undefined;
  if (knownName && knownName.includes('#')) return toPlayer(request, knownName, region);

  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) return back(request);
  try {
    const res = await riotFetch(
      `https://${getAccountRouting(region)}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}`,
      apiKey,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return back(request);
    const acc = await res.json();
    if (!acc.gameName) return back(request);
    return toPlayer(request, `${acc.gameName}#${acc.tagLine || ''}`, region);
  } catch {
    return back(request);
  }
}
