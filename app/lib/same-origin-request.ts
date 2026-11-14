import type { NextRequest } from 'next/server';

// Schreibende Konto-Anfragen nur von der eigenen Seite: der Origin-Kopf muss
// zum Host passen. Fremde Seiten koennen so keine Loeschung ausloesen, selbst
// wenn ein Browser das Sitzungs-Cookie mitschicken sollte.
export function sameOriginRequest(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
