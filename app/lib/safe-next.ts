// Ziel nach einer Anmeldung (`?next=`). Eine Quelle fuer alle Aufrufer:
// Login-Seite, /auth/callback und die Riot-Anmeldung (/auth/riot/*).
//
// Nur Pfade auf der eigenen Seite. Ein reiner Text-Vergleich reicht nicht:
// Browser entfernen Tab und Zeilenumbruch, aus `/\t/evil.com` wird `//evil.com`
// (logic-flow-critic 14.11.2026). Deshalb wird gegen eine feste Herkunft
// geparst und nur Pfad + Query + Anker zurueckgegeben — die Herkunft setzt
// immer der Aufrufer.
//
// Ohne 'server-only': die Login-Seite ist ein Client-Baustein.

const PARSE_ORIGIN = 'https://www.metastats.gg';

export function safeNext(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || raw.length > 2048) return fallback;
  // Steuerzeichen und Backslash: nie ein gueltiger eigener Pfad.
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  let url: URL;
  try {
    url = new URL(raw, PARSE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PARSE_ORIGIN) return fallback;
  // Nie zurueck in die Riot-Anmeldung, sonst startet sie im Kreis.
  if (url.pathname === '/auth/riot' || url.pathname.startsWith('/auth/riot/')) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
