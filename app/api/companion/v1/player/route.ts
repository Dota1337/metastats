// Eigener Spielverlauf fuer die Overwolf-App: Spieler suchen, letzte 10 Spiele,
// je Spiel nur die eigene Zeile (Platz, Stufe, Traits, Units mit Items).
// Nutzt die Spieler- und Match-Routen der Seite im selben Prozess.
import { NextRequest } from 'next/server';
import { GET as summonerGET } from '../../../tft/summoner/route';
import { GET as matchesGET } from '../../../tft/matches/route';
import {
  COMPANION_API_VERSION, companionJson, companionPreflight, toCompanionMatch, type CompanionMatch,
} from '../../../../lib/companion-api';

export const maxDuration = 30;

const HISTORY_COUNT = 10;
const NO_STORE = { cdn: 'no-store', browser: 'no-store' };

export function OPTIONS() {
  return companionPreflight();
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const name = (sp.get('name') || '').trim();
  const region = (sp.get('region') || '').trim();
  if (!/^[^#]{1,32}#[^#]{1,8}$/.test(name)) {
    return companionJson({ v: COMPANION_API_VERSION, error: 'bad_name' }, { status: 400, ...NO_STORE });
  }
  const origin = request.nextUrl.origin;
  const sUrl = new URL('/api/tft/summoner', origin);
  sUrl.searchParams.set('name', name);
  if (region) sUrl.searchParams.set('region', region);
  const sRes = await summonerGET(new NextRequest(sUrl));
  const s = await sRes.json().catch(() => null) as {
    summoner?: { name?: string; puuid?: string; profileIconId?: number; summonerLevel?: number };
    ranked?: { tier?: string; rank?: string; leaguePoints?: number; wins?: number; losses?: number } | null;
    matchIds?: string[];
    region?: string;
    code?: string;
  } | null;
  if (!sRes.ok || !s?.summoner?.puuid) {
    const status = sRes.status === 404 || sRes.status === 400 ? sRes.status : 502;
    return companionJson({ v: COMPANION_API_VERSION, error: s?.code || 'player_unavailable' }, { status, ...NO_STORE });
  }
  const puuid = s.summoner.puuid;
  const ids = (s.matchIds || []).slice(0, HISTORY_COUNT);
  let matches: CompanionMatch[] = [];
  if (ids.length > 0) {
    const mUrl = new URL('/api/tft/matches', origin);
    mUrl.searchParams.set('ids', ids.join(','));
    if (s.region) mUrl.searchParams.set('region', s.region);
    const mRes = await matchesGET(new NextRequest(mUrl));
    if (mRes.ok) {
      const m = await mRes.json().catch(() => null) as { matches?: Parameters<typeof toCompanionMatch>[0][] } | null;
      matches = (m?.matches || [])
        .map(x => toCompanionMatch(x, puuid))
        .filter((x): x is CompanionMatch => x != null)
        .sort((a, b) => b.at - a.at);
    }
  }
  return companionJson({
    v: COMPANION_API_VERSION,
    region: s.region ?? region,
    player: {
      name: s.summoner.name ?? name,
      puuid,
      icon: s.summoner.profileIconId ?? null,
      level: s.summoner.summonerLevel ?? null,
    },
    ranked: s.ranked
      ? {
          tier: s.ranked.tier ?? null,
          rank: s.ranked.rank ?? null,
          lp: s.ranked.leaguePoints ?? null,
          wins: s.ranked.wins ?? 0,
          losses: s.ranked.losses ?? 0,
        }
      : null,
    matches,
  }, { cdn: 'public, s-maxage=120, stale-while-revalidate=600', browser: 'private, max-age=60' });
}
