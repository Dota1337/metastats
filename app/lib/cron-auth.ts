import 'server-only';
import { NextRequest, NextResponse } from 'next/server';

// Auth fuer die Vercel-Cron-Routen.
//
// Vorher stand in jeder Cron-Route:
//   if (authHeader !== `Bearer ${process.env.CRON_SECRET}`)
// Fehlt CRON_SECRET, ergibt das den Vergleich gegen den String
// "Bearer undefined" — wer diesen Header schickt, kommt durch. Ein fehlendes
// Secret darf nicht zur offenen Tuer werden, sondern muss ein Fehler sein.
//
// Zusaetzlich Konstantzeit-Vergleich, damit der Header nicht Zeichen fuer
// Zeichen erraten werden kann.

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Gibt eine Fehler-Response zurueck, wenn der Aufruf nicht autorisiert ist,
 * sonst `null`. Ausserhalb von Production (lokale Entwicklung) bleibt der
 * Aufruf wie bisher ohne Header moeglich.
 */
export function cronAuthFailure(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV !== 'production') return null;
    console.error('[cron] CRON_SECRET fehlt — Route verweigert den Dienst.');
    return NextResponse.json({ error: 'cron secret not configured' }, { status: 500 });
  }

  const header = request.headers.get('authorization') || '';
  if (timingSafeEqualStr(header, `Bearer ${secret}`)) return null;

  if (process.env.NODE_ENV !== 'production') return null;
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
