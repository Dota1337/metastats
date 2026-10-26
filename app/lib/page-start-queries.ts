// Abfragen der Uebersichtsseiten mit Startdaten — EINE Quelle fuer den Abruf
// im Browser und die Startdaten des Servers (app/lib/seo/page-start-*.ts).
// Bauten beide ihre Abfrage selbst, verfehlte der Server-Schluessel still die
// Datei der Box (route-mirror.mjs), und die Seite zeigte wieder nur das Geruest.
// Ohne Server-Importe: die Seiten laden diese Datei auch im Browser.

export type PageQuery = Record<string, string>;

export function queryString(q: PageQuery): string {
  return new URLSearchParams(q).toString();
}

/** Gleiche Ansicht? Reihenfolge der Parameter zaehlt nicht. */
export function sameQuery(a: PageQuery, b: PageQuery): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every(k => a[k] === b[k]);
}

// ---------- TFT-Rangliste (/api/tft/leaderboard) ----------

/** `division` nur ausserhalb der Apex-Ligen und der X+-Gruppen. */
export function tftLeaderboardQuery(region: string, tier: string, page: number, division: string | null): PageQuery {
  const q: PageQuery = { region, tier, page: String(page) };
  if (division) q.division = division;
  return q;
}
/** Standardansicht: Welt, alle Raenge, Seite 1. */
export const TFT_LEADERBOARD_START = tftLeaderboardQuery('all', 'ALL', 1, null);

// ---------- TFT-Aufsteiger (/api/tft/rising) ----------

export function risingQuery(days: number, region: string): PageQuery {
  return { days: String(days), region };
}
export const RISING_START = risingQuery(1, 'all');

// ---------- Patch-Gewinner (/api/tft/patch-diff) ----------

/** `region` leer = alle Regionen. */
export function patchWinnersQuery(entity: string, bucket: string, region: string): PageQuery {
  const q: PageQuery = { entity, bucket };
  if (region) q.region = region;
  return q;
}
export const PATCH_WINNERS_START = patchWinnersQuery('unit', 'master_plus', '');
