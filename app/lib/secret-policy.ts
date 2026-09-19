import 'server-only';
import { NextResponse } from 'next/server';

// Was passiert, wenn ein Geheimnis fehlt?
//
// Die Frage klingt akademisch, ist aber der Unterschied zwischen einer
// geschlossenen und einer offenen Tuer. Zwei Muster standen bis zur
// Sicherheitsdurchsicht am 19.09.2026 nebeneinander im Baum:
//
//   cron-auth.ts:            fehlt CRON_SECRET, gibt es in Produktion 500.
//   tft/positions/submit:    fehlt OVERWOLF_APP_SECRET, entfaellt die gesamte
//                            Pruefung — Zeitfenster und Signatur inklusive.
//
// Das zweite ist die gefaehrliche Variante: ein vergessener Eintrag in der
// Umgebung macht aus einer signierten Route eine offene, ohne dass irgendwo
// ein Fehler auftaucht. Die Route antwortet weiter mit 200.
//
// Deshalb hier EINE gemeinsame Regel: in Produktion ist ein fehlendes
// Geheimnis ein Fehler der Route, in der lokalen Entwicklung nicht.

/**
 * Zeichenweiser Vergleich in konstanter Zeit — die Laufzeit haengt nicht davon
 * ab, ab welchem Zeichen zwei Werte auseinandergehen. Ohne das laesst sich ein
 * Header ueber viele Versuche Zeichen fuer Zeichen erraten.
 *
 * Bewusst von Hand statt ueber `crypto.timingSafeEqual`: die Funktion wird auch
 * in der Edge-Umgebung benutzt, in der `node:crypto` nicht vollstaendig da ist.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Fehlt das Geheimnis an einer Stelle, an der es die Zugangspruefung traegt?
 * In Produktion ja (und die Route muss den Dienst verweigern), lokal nein.
 */
export function secretMissing(name: string, wert: string | undefined | null): boolean {
  if (wert) return false;
  if (process.env.NODE_ENV !== 'production') return false;
  console.error(`[secret] ${name} fehlt — die Route verweigert den Dienst.`);
  return true;
}

/**
 * Dieselbe Frage fuer Routen, die keine eigenen Kopfzeilen an die Antwort
 * haengen muessen: gibt eine fertige 500er-Antwort zurueck, sonst `null`.
 */
export function missingSecretFailure(name: string, wert: string | undefined | null): NextResponse | null {
  if (!secretMissing(name, wert)) return null;
  return NextResponse.json({ error: `${name} not configured` }, { status: 500 });
}
