import { NextRequest, NextResponse } from 'next/server';
import { loadPlayerTournamentHistory } from '../../../lib/tft-tournament-history';

// Turnierhistorie eines Spielers (Pro-JSON + Ergebniszeilen + Name→Konto-Zuordnung).
// no-store wie die Einzel-Pro-Abfrage in /api/tft/pros — pro Konto, kaum Cache-Treffer.
export async function GET(request: NextRequest) {
  const puuid = new URL(request.url).searchParams.get('puuid');
  if (!puuid || puuid.length > 100) {
    return NextResponse.json({ error: 'puuid required' }, { status: 400 });
  }
  try {
    const history = await loadPlayerTournamentHistory(puuid);
    return NextResponse.json(history, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
