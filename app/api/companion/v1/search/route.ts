// Spielersuche ohne #Tag fuer die Overwolf-App (ab 0.8): alle Konten mit
// genau diesem Namen aus dem Namensverzeichnis, ueber alle Server — derselbe
// Weg wie Enter ohne Tag auf der Seite (/tft/search, searchExactNames).
// Kein Riot-Abruf.
import { NextRequest } from 'next/server';
import { searchExactNames } from '../../../../lib/tft-player-search-server';
import {
  COMPANION_API_VERSION, companionJson, companionPreflight, type CompanionSearchResponse,
} from '../../../../lib/companion-api';

export const maxDuration = 15;

const NO_STORE = { cdn: 'no-store', browser: 'no-store' };
const MAX_HITS = 20;

export function OPTIONS() {
  return companionPreflight();
}

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') || '').split('#')[0].trim();
  if (q.length < 1 || q.length > 32) {
    return companionJson({ v: COMPANION_API_VERSION, error: 'bad_query' }, { status: 400, ...NO_STORE });
  }
  const hits = await searchExactNames(q);
  if (hits == null) {
    return companionJson({ v: COMPANION_API_VERSION, error: 'search_unavailable' }, { status: 503, ...NO_STORE });
  }
  const body: CompanionSearchResponse = {
    v: COMPANION_API_VERSION,
    // Ohne Server laesst sich das Profil nicht oeffnen.
    hits: hits.filter(h => h.region).slice(0, MAX_HITS).map(h => ({
      name: `${h.gameName}#${h.tagLine}`,
      region: h.region!,
      tier: h.tier,
      division: h.division,
      lp: h.lp,
    })),
  };
  return companionJson(body, { cdn: 'public, s-maxage=300, stale-while-revalidate=600', browser: 'private, max-age=60' });
}
