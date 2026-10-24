// Fehlertexte nach aussen (Sicherheitsdurchsicht 24.10.2026).
//
// Bis dahin gaben gut 30 Routen `error: e.message` an den Browser. Darin
// standen Antworttexte von Supabase (Funktionsname, Parameterliste, bis 300
// Zeichen Body) und der Box (refresh-api-server.mjs schreibt err.message in
// seine Antwort). Jetzt geht der Rohtext nur ins Server-Log, der Browser
// bekommt einen festen Code. Codes, die Clients auswerten (bad_region,
// rate_limited, riot_auth …), bleiben unberuehrt.
//
// scripts/check-error-leaks.mjs (pre-push) haelt neue `error: e.message` fern.

/** Rohtext ins Server-Log, fester Code nach aussen. */
export function publicError(where: string, e: unknown, code: string): string {
  const raw = e instanceof Error ? e.message : (e as { message?: unknown } | null)?.message ?? e;
  console.error(`[${where}]`, raw);
  return code;
}
