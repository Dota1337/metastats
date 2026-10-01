import { NextRequest, NextResponse } from 'next/server';
import { parseRegion } from '../../../lib/regions';
import { riotFetch } from '../../../lib/riot-fetch';
import { pickSoloRank, type SoloRank } from '../../../lib/rank-format';

// Solo-Raenge der Mitspieler eines Live-Spiels in EINEM Aufruf. Ersetzt den
// frueheren vollen /api/summoner-Abruf je Teilnehmer (bis ~65 Riot-Abrufe und
// Schreibvorgaenge pro Kopf). Ohne Nachholen bei 429: der Schluessel ist dann
// ausgelastet, der Spieler bekommt „unknown“ statt eines falschen „Unranked“.
const MAX_PUUIDS = 10;
const PUUID_RE = /^[A-Za-z0-9_-]{20,100}$/;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = parseRegion(searchParams.get('region'), { fallback: 'euw1' });
  const puuids = [...new Set((searchParams.get('puuids') || '').split(',').filter(Boolean))];

  if (!region || puuids.length === 0 || puuids.length > MAX_PUUIDS || !puuids.every((p) => PUUID_RE.test(p))) {
    return NextResponse.json(
      { error: 'Ungültige Anfrage' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const apiKey = process.env.RIOT_API_KEY!;
  const ranks: Record<string, SoloRank | null | 'unknown'> = {};
  await Promise.all(
    puuids.map(async (puuid) => {
      try {
        const res = await riotFetch(
          `https://${region}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`,
          apiKey, {}, 0,
        );
        ranks[puuid] = res.ok ? pickSoloRank(await res.json()) : 'unknown';
      } catch {
        ranks[puuid] = 'unknown';
      }
    }),
  );

  const partial = Object.values(ranks).includes('unknown');
  return NextResponse.json(
    { ranks },
    { headers: { 'Cache-Control': partial ? 'no-store' : 'private, max-age=30' } },
  );
}
