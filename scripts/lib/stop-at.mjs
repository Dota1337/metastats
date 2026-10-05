// Zeitgrenze fuer lange Laeufe: "HH:MM" (UTC) einlesen und die Millisekunden
// bis zum naechsten Erreichen dieser Uhrzeit berechnen. Liegt die Uhrzeit heute
// schon hinter `now` (oder genau darauf), gilt sie fuer morgen — ein Lauf, der
// abends startet, endet also am naechsten Morgen.

export function parseStopAt(s) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(s ?? ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, min };
}

export function msUntilUtc({ h, min }, now = new Date()) {
  const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, min);
  const ms = t - now.getTime();
  return ms > 0 ? ms : ms + 86_400_000;
}
