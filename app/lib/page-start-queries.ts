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

// ---------- TFT-Marktwert (/api/tft/marktwert/leaderboard + /sparklines) ----------

/** `tier` leer = alle Raenge. */
export function tftMarktwertQuery(region: string, tier: string): PageQuery {
  const q: PageQuery = { region, limit: '100' };
  if (tier) q.tier = tier;
  return q;
}
export function tftMarktwertSparksQuery(region: string): PageQuery {
  return { region, limit: '100', days: '14' };
}
export const TFT_MARKTWERT_START_REGION = 'euw1';

// ---------- LoL-Marktwert (/api/marktwert) ----------

export function lolMarktwertQuery(region: string, tier: string): PageQuery {
  return { region, tier };
}
export const LOL_MARKTWERT_START = lolMarktwertQuery('all', 'all');

// ---------- LoL-Rangliste (/api/leaderboard) ----------

/** `division` nur ausserhalb der Apex-Ligen und der X+-Gruppen. */
export function lolLeaderboardQuery(tier: string, region: string, division: string | null, page: number): PageQuery {
  const q: PageQuery = { tier, region };
  if (division) q.division = division;
  q.page = String(page);
  return q;
}
export const LOL_LEADERBOARD_START = lolLeaderboardQuery('CHALLENGER', 'euw1', null, 1);

// ---------- TFT-Turniere (/api/tft/tournaments) ----------

/** Leere Werte = kein Filter. */
export function tftTournamentsQuery(region: string, tier: string, set: string): PageQuery {
  const q: PageQuery = {};
  if (region) q.region = region;
  if (tier) q.tier = tier;
  if (set) q.set = set;
  return q;
}
export const TFT_TOURNAMENTS_START = tftTournamentsQuery('', '', '');
