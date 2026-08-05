// Server-seitige Instrumentierung. register() laeuft einmal beim Start jeder
// Server-Instanz und muss abgeschlossen sein, bevor Requests bedient werden —
// es liegt damit im Cold-Start-Pfad aller Node-Lambdas. Deshalb wird pro
// Runtime nur die eine passende Config geladen, nicht beides.
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Faengt geworfene Fehler aus Server-Components, Route-Handlern und Actions.
//
// Wichtige Grenze, damit hier niemand falsche Erwartungen hat: eine regulaere
// Fehler-Antwort (401, 500 via NextResponse.json) ist KEINE geworfene
// Exception und taucht hier NICHT auf. Solche Faelle brauchen ein explizites
// captureMessage an der Stelle — siehe app/api/internal/revalidate/route.ts.
export const onRequestError = Sentry.captureRequestError;
