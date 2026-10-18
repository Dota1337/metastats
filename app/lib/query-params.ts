// Whitelists fuer Filter-Parameter, die aus der Query direkt in DB-Abfragen
// und in den Cache-Key wandern.
//
// Die Werte gehen parametrisiert an Postgres, es ist also keine Injection.
// Das Problem ist billiger Missbrauch: `?patch=17.<zufallszahl>` oder ein
// beliebig grosser Zahlenwert erzeugt pro Aufruf eine eigene Abfrage mit einem
// eigenen Cache-Key. Der Edge-Cache faengt davon nichts ab, weil jede Anfrage
// neu aussieht — die Last landet vollstaendig auf der Datenbank. Ein
// geschlossener Wertebereich macht diese Achse wertlos.

// Patch-Strings sehen aus wie "17.5", "14.23" oder mit B-Patch-Suffix "18.1b".
// Alles andere kann kein Patch sein und braucht keine Abfrage.
const PATCH_RE = /^\d{1,2}\.\d{1,2}[bc]?$/;

export function isPatchString(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && PATCH_RE.test(raw);
}

/**
 * Gibt den Patch zurueck, wenn er das Format hat, sonst `fallback`.
 * Wer zusaetzlich gegen die real vorhandenen Patches pruefen kann, sollte das
 * tun — das hier ist die Formatschranke davor.
 */
export function parsePatch(raw: string | null, fallback: string | null = null): string | null {
  return isPatchString(raw) ? raw : fallback;
}

/** Ganzzahl aus der Query mit hartem Ober- und Untergrenzen-Deckel. */
export function parseBoundedInt(
  raw: string | null,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number {
  if (raw === null) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
