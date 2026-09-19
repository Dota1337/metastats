import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { secretMissing } from './secret-policy';

// Zugangspruefung fuer die Companion-Route (Overwolf-App -> unsere Datenbank).
//
// Warum das hier steht und nicht mehr in der Route: der Waechter
// scripts/check-write-routes.mjs hat eine schreibende Route bisher schon dann
// als gedeckt gezaehlt, wenn irgendwo im Text `timingSafeEqual(` vorkam. Dass
// die Pruefung im selben Satz uebersprungen werden konnte (siehe unten), sah
// er nicht. Eine benannte Funktion laesst sich dagegen sauber verlangen — und
// steht genau einmal im Baum.
//
// Das gemeinsame Geheimnis ist nicht wirklich geheim: es liegt in der
// ausgelieferten App, wer sie auspackt, hat es. Zusammen mit dem Zeitfenster
// von fuenf Minuten und dem eindeutigen Schluessel auf der Beobachtungstabelle
// macht es Wiedereinspielen und Spam aber teuer genug.

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;

function verifySignature(secret: string, body: string, providedHex: string): boolean {
  if (!secret || !providedHex) return false;
  let expectedBuf: Buffer;
  let providedBuf: Buffer;
  try {
    expectedBuf = createHmac('sha256', secret).update(body).digest();
    providedBuf = Buffer.from(providedHex, 'hex');
  } catch {
    return false;
  }
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Gibt eine Fehler-Antwort zurueck, wenn der Aufruf nicht autorisiert ist,
 * sonst `null`. `headers` sind die CORS-Kopfzeilen der Route, damit die
 * Ablehnung im Browser der Companion-App ueberhaupt ankommt.
 *
 * Fehlt OVERWOLF_APP_SECRET, gibt es in Produktion 500 statt eines stillen
 * Durchlassens (Sicherheitsdurchsicht 19.09.2026, Befund 5): vorher hing die
 * gesamte Pruefung an `if (APP_SECRET)`, ein vergessener Eintrag in der
 * Umgebung haette Zeitfenster UND Signatur abgeschaltet, und die Route haette
 * weiter mit 200 geantwortet. Lokal ohne Geheimnis bleibt es wie bisher offen.
 */
export function companionAuthFailure(
  request: NextRequest,
  rawBody: string,
  headers: Record<string, string>,
): NextResponse | null {
  const secret = process.env.OVERWOLF_APP_SECRET || '';
  const antwort = (data: unknown, status: number) => NextResponse.json(data, { status, headers });

  if (secretMissing('OVERWOLF_APP_SECRET', secret)) {
    return antwort({ error: 'app secret not configured' }, 500);
  }
  if (!secret) return null; // lokale Entwicklung

  const ts = Number(request.headers.get('x-companion-timestamp') || '');
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TIMESTAMP_WINDOW_MS) {
    return antwort({ error: 'timestamp outside window' }, 401);
  }
  if (!verifySignature(secret, rawBody, request.headers.get('x-companion-signature') || '')) {
    return antwort({ error: 'bad signature' }, 401);
  }
  return null;
}
