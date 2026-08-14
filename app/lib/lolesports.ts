import { NextResponse } from 'next/server';

// Der Lolesports-Web-Client-Key stand bis 2026-08-14 als Literal in drei
// Routen und fuenf Skripten. Riot veroeffentlicht ihn zwar selbst (jeder, der
// auf lolesports.com die Devtools oeffnet, liest ihn mit), aber ein
// Schluessel-Literal in einem oeffentlichen Repo ist ein Fund fuer jeden
// Scanner und muss bei einer Rotation an acht Stellen nachgezogen werden.
//
// Der Wert steht jetzt ausschliesslich in der Env (Vercel Production sowie
// .env.local). Fehlt er, antworten die Routen mit 503 statt still auf einen
// veralteten Wert zurueckzufallen.
export const LOLESPORTS_API_KEY = process.env.LOLESPORTS_API_KEY || '';

export function lolesportsKeyMissingResponse(): NextResponse | null {
  if (LOLESPORTS_API_KEY) return null;
  console.error('[lolesports] LOLESPORTS_API_KEY fehlt in der Env.');
  return NextResponse.json(
    { error: 'lolesports key not configured' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
