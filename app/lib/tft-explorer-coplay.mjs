// „Oft zusammen mit …" im Data Explorer: welche Units die Vorschlagszeile
// zeigt. Die Seite (app/components/tft/explorer/ExplorerFilters.tsx) und der
// Abfrage-Dienst (scripts/explorer-duckdb-server.mjs, rechnet die Paare im
// Leerlauf vor, Plan 19.10.2026 S6) lesen dieselbe Regel — sonst rechnet der
// Dienst an der Seite vorbei. Die Box importiert die Datei direkt, deshalb
// steht sie im Pfad-Filter von .github/workflows/deploy-hetzner.yml.

export const COPLAY_MAX = 8;

/**
 * Partner aus den Zeilen des Units-Reiters: Units gesamt (keine Sternstufe),
 * noch nicht gewaehlt, erlaubt, meistgespielte zuerst (stabile Sortierung).
 * Die Seite erlaubt nur spielbare Units; der Dienst kennt die Liste nicht und
 * nimmt dafuer ein paar Zeilen mehr (Obermenge der Seiten-Auswahl).
 * @template {{ key: string, sub?: number | null, games: number }} R
 * @param {R[] | null | undefined} rows
 * @param {{ chosen?: Set<string>, allow?: (id: string) => boolean, max?: number }} [opts]
 * @returns {R[]}
 */
export function coplayPick(rows, { chosen = new Set(), allow = () => true, max = COPLAY_MAX } = {}) {
  return (rows ?? [])
    .filter(r => r && r.sub == null && typeof r.key === 'string' && !chosen.has(r.key) && allow(r.key))
    .sort((a, b) => b.games - a.games)
    .slice(0, max);
}

// „Beste Traeger von {Item}" (Plan 24.10.2026, vom User freigegeben):
// mindestens CARRIER_MIN_GAMES Spiele UND CARRIER_MIN_SHARE der Bretter mit
// dem Item, bester Ø zuerst, hoechstens COPLAY_MAX. Nur die Seite filtert; der
// Dienst liefert alle Traeger aus dem Vorrat (scripts/lib/explorer-carriers.mjs).
export const CARRIER_MIN_GAMES = 200;
export const CARRIER_MIN_SHARE = 0.02;

/**
 * @template {{ key: string, games: number, avg: number }} R
 * @param {R[] | null | undefined} rows
 * @param {{ refGames: number, allow?: (id: string) => boolean, max?: number }} opts
 * @returns {R[]}
 */
export function carrierPick(rows, { refGames, allow = () => true, max = COPLAY_MAX }) {
  if (!(refGames > 0)) return [];
  return (rows ?? [])
    .filter(r => r && typeof r.key === 'string' && allow(r.key)
      && r.games >= CARRIER_MIN_GAMES && r.games >= CARRIER_MIN_SHARE * refGames)
    .sort((a, b) => a.avg - b.avg || b.games - a.games || a.key.localeCompare(b.key))
    .slice(0, max);
}

/**
 * Alle schon gewaehlten Unit-Kennungen (Hauptliste und Kaesten) — die schlaegt die Zeile nicht mehr vor.
 * @param {{ units?: { id: string }[], groups?: { units?: { id: string }[] }[] }} q
 * @returns {Set<string>}
 */
export function coplayChosen(q) {
  return new Set([...(q.units ?? []).map(u => u.id), ...(q.groups ?? []).flatMap(g => (g.units ?? []).map(u => u.id))]);
}
