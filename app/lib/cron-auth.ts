import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqualStr, missingSecretFailure } from './secret-policy';

// Auth fuer die Vercel-Cron-Routen.
//
// Vorher stand in jeder Cron-Route:
//   if (authHeader !== `Bearer ${process.env.CRON_SECRET}`)
// Fehlt CRON_SECRET, ergibt das den Vergleich gegen den String
// "Bearer undefined" — wer diesen Header schickt, kommt durch. Ein fehlendes
// Secret darf nicht zur offenen Tuer werden, sondern muss ein Fehler sein.
//
// Zusaetzlich Konstantzeit-Vergleich, damit der Header nicht Zeichen fuer
// Zeichen erraten werden kann. Beides liegt seit dem 19.09.2026 in
// app/lib/secret-policy.ts, weil die Companion-Route dieselbe Frage
// beantworten muss und sie vorher anders beantwortet hat.

/**
 * Gibt eine Fehler-Response zurueck, wenn der Aufruf nicht autorisiert ist,
 * sonst `null`. Ausserhalb von Production (lokale Entwicklung) bleibt der
 * Aufruf wie bisher ohne Header moeglich.
 */
export function cronAuthFailure(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;

  const fehlt = missingSecretFailure('CRON_SECRET', secret);
  if (fehlt) return fehlt;
  if (!secret) return null; // lokale Entwicklung

  const header = request.headers.get('authorization') || '';
  if (timingSafeEqualStr(header, `Bearer ${secret}`)) return null;

  if (process.env.NODE_ENV !== 'production') return null;
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
