import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '../../../lib/rate-limit';
import { probeRiotDefaultTags } from '../../../lib/tft-player-search-server';

// /api/tft/search-riot?q=Winter
//
// Ersatzsuche fuer /tft/search, wenn das Namensverzeichnis keinen Treffer hat:
// Name#<Standard-Tag> je Region direkt bei Riot. Bremsen: 10 Anfragen pro
// Minute und IP hier, dazu die globale Bremse und der Zwischenspeicher in
// tft-player-search-server.ts. Abschalter: TFT_SEARCH_RIOT_PROBE=off.
//
// Antwort { players, complete }: complete=false heisst, die Probe durfte nicht
// laufen — die Seite zeigt dann, was sie sonst hat.

const MAX_QUERY = 40;

export async function GET(request: NextRequest) {
  const limited = checkRateLimit(request, { key: 'tft-search-riot', max: 10, windowMs: 60_000 });
  if (limited) return limited;

  const q = (new URL(request.url).searchParams.get('q') || '').slice(0, MAX_QUERY).split('#')[0].trim();
  if (!q) return NextResponse.json({ players: [], complete: true }, { headers: { 'Cache-Control': 'no-store' } });

  const players = await probeRiotDefaultTags(q);
  return NextResponse.json(
    { players: players || [], complete: players !== null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
