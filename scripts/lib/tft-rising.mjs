// Aufsteiger-Logik (/tft/rising), 1:1 nach MetaTFTs /rising.
//
// Gemeinsam genutzt vom Sammler (scripts/collect-tft-ladder.mjs, holt fuer die
// Kandidaten fehlende Partien nach) und vom Box-Endpunkt /rising
// (scripts/refresh-api-server.mjs). Eine Stelle, damit beide dieselben
// Spieler meinen.
//
// Wertungsskala (MetaTFT): Smaragd IV = 2000, jede Division +100, Diamant IV
// = 2400, Master/Grandmaster/Challenger = 2800 + LP. Innerhalb einer Division
// kommen die LP dazu.
// Sortierung: Zuwachs × (Endwert − 400). Wer auf hoeherem Niveau gleich viel
// gewinnt, steht weiter oben.
// Spielstil: Anteil der meistgespielten Comp > 0,65 One-Trick, > 0,4
// Standard-Comp, sonst Flexibel.

export const LADDER_TIERS = ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND', 'EMERALD'];
export const APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
export const RISING_DAYS = [1, 3, 5];
export const RISING_LIMIT = 20;

// Dieselbe Formel als SQL-Ausdruck, fuer ein Tabellen-Alias `a`.
export function ratingSql(a) {
  return `(CASE
    WHEN ${a}.tier IN ('MASTER','GRANDMASTER','CHALLENGER') THEN 2800
    WHEN ${a}.tier = 'DIAMOND' THEN 2400
    WHEN ${a}.tier = 'EMERALD' THEN 2000
    ELSE NULL END
    + CASE WHEN ${a}.tier IN ('DIAMOND','EMERALD') THEN
        CASE ${a}.rank WHEN 'IV' THEN 0 WHEN 'III' THEN 100 WHEN 'II' THEN 200 WHEN 'I' THEN 300 ELSE 0 END
      ELSE 0 END
    + ${a}.lp)`;
}

export function playstyleOf(share) {
  if (share == null) return null;
  if (share > 0.65) return 'oneTrick';
  if (share > 0.4) return 'default';
  return 'flexible';
}

/**
 * Die Aufsteiger eines Zeitraums, sortiert nach MetaTFT-Wertung.
 *
 * Endstand = die Zeile am letzten gesammelten Tag der Region, und der Spieler
 * muss dort Master oder hoeher sein. Startstand = die juengste Zeile mit
 * Tag <= Endtag − days; gibt es keine (die Sammlung ist juenger als der
 * Zeitraum), die aelteste vorhandene davor.
 *
 * @param {import('pg').Pool} pool
 * @param {{ setNumber: number, days: number, region: string|null, limit: number }} opts
 */
export async function queryRisingCandidates(pool, { setNumber, days, region, limit }) {
  const sql = `
    WITH reg_end AS (
      SELECT region, max(day) AS end_day
        FROM tft_ladder_daily
       WHERE set_number = $1 AND ($2::text IS NULL OR region = $2)
       GROUP BY region
    ),
    cur AS (
      SELECT l.*
        FROM tft_ladder_daily l
        JOIN reg_end e ON e.region = l.region AND l.day = e.end_day
       WHERE l.set_number = $1
         AND l.tier IN ('MASTER','GRANDMASTER','CHALLENGER')
    ),
    prev AS (
      SELECT DISTINCT ON (c.puuid, c.region)
             c.puuid, c.region, p.day, p.tier, p.rank, p.lp, p.wins, p.losses, p.fetched_at
        FROM cur c
        JOIN reg_end e ON e.region = c.region
        JOIN tft_ladder_daily p
          ON p.puuid = c.puuid AND p.region = c.region AND p.set_number = $1
         AND p.day < e.end_day
       ORDER BY c.puuid, c.region,
                (p.day <= e.end_day - $3::int) DESC,
                CASE WHEN p.day <= e.end_day - $3::int THEN p.day END DESC,
                p.day ASC
    ),
    scored AS (
      SELECT c.puuid, c.region, c.day AS end_day, p.day AS start_day,
             c.tier AS end_tier, c.rank AS end_rank, c.lp AS end_lp,
             p.tier AS start_tier, p.rank AS start_rank, p.lp AS start_lp,
             (c.wins + c.losses) - (p.wins + p.losses) AS games,
             p.fetched_at AS start_at, c.fetched_at AS end_at,
             ${ratingSql('c')} AS r_end,
             ${ratingSql('p')} AS r_start
        FROM cur c
        JOIN prev p ON p.puuid = c.puuid AND p.region = c.region
    )
    SELECT *,
           (r_end - r_start) AS lp_change,
           ((r_end - r_start)::bigint * (r_end - 400)::bigint) AS score
      FROM scored
     WHERE r_start IS NOT NULL
       AND r_end > r_start
       AND games > 0
     ORDER BY score DESC, puuid
     LIMIT $4
  `;
  const { rows } = await pool.query(sql, [setNumber, region, days, limit]);
  return rows.map(r => ({
    puuid: r.puuid,
    region: r.region,
    startDay: r.start_day,
    endDay: r.end_day,
    before: { tier: r.start_tier, rank: APEX.includes(r.start_tier) ? null : r.start_rank, lp: Number(r.start_lp) },
    after: { tier: r.end_tier, rank: APEX.includes(r.end_tier) ? null : r.end_rank, lp: Number(r.end_lp) },
    lpChange: Number(r.lp_change),
    games: Number(r.games),
    startAt: new Date(r.start_at),
    endAt: new Date(r.end_at),
  }));
}
