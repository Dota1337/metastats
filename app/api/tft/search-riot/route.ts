import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '../../../lib/rate-limit';
import { cachedRiotNames, probeRiotNames } from '../../../lib/riot-name-probe';

// /api/tft/search-riot?q=Winter            (TFT, /tft/search)
// /api/tft/search-riot?q=Winter&game=lol   (LoL, /search)
// /api/tft/search-riot?q=Winter&game=lol&src=suggest   (LoL-Dropdown)
//
// Ersatzsuche, wenn die Namensverzeichnisse keinen Treffer haben:
// Name#<Standard-Tag> je Region direkt bei Riot (riot-name-probe.ts). Beide
// Spiele mit dem TFT-Schluessel; LoL-Treffer ohne puuid.
//
// Bremsen: eine gespeicherte Antwort kostet nichts. Sonst 10 Anfragen pro
// Minute und IP — Enter und Dropdown je eigener Topf, beide Spiele teilen
// sich den Enter-Topf —, dazu die Bremse je Instanz in riot-name-probe.ts.
// Abschalter: TFT_SEARCH_RIOT_PROBE=off, LOL_SEARCH_RIOT_PROBE=off.
//
// Antwort { players, complete }: complete=false heisst, die Probe durfte nicht
// laufen oder Riot hat nicht ueberall geantwortet — „keine Treffer" ist dann
// nicht belegt, die Seite zeigt, was sie sonst hat.

const MAX_QUERY = 40;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const game = params.get('game') === 'lol' ? 'lol' : 'tft';
  const src = params.get('src') === 'suggest' ? 'suggest' : 'enter';
  const q = (params.get('q') || '').slice(0, MAX_QUERY).split('#')[0].trim();
  if (!q) return NextResponse.json({ players: [], complete: true }, { headers: NO_STORE });

  const known = cachedRiotNames(q, game);
  if (known) return NextResponse.json({ players: known, complete: true }, { headers: NO_STORE });

  const limited = checkRateLimit(request, {
    key: src === 'suggest' ? 'search-riot-suggest' : 'tft-search-riot',
    max: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const r = await probeRiotNames(q, game, src);
  return NextResponse.json({ players: r.hits, complete: r.complete }, { headers: NO_STORE });
}
