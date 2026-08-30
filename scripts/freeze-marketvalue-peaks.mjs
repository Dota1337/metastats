#!/usr/bin/env node
/**
 * Haelt tft_player_marketvalue_peaks aktuell: pro Spieler und Set die
 * vollstaendige Snapshot-Zeile mit dem hoechsten final_value.
 *
 * Warum eine eigene Tabelle (uebernommen aus 0061 / der abgeloesten
 * scripts/sql/freeze-marketvalue-peaks-set17.sql): ein Peak ist die GANZE
 * Zeile, nicht nur die Zahl. base_value/multiplier/damping/sample_size wandern
 * mit, weil final_value allein spaeter weder erklaerbar noch reproduzierbar ist
 * — final_value ist base_value x multiplier, base_value ist reine Rang/LP-Kurve
 * (scripts/lib/tft-marketvalue-pipeline.mjs). Der Peak ist damit faktisch
 * "bester Ladder-Stand des Sets", nicht "bestes Skill-Fenster".
 * Peak pro puuid, nicht pro (puuid, region): genau 1 von 53.312 puuids hatte
 * ueberhaupt mehr als eine Region.
 *
 * Warum kein Stichtag mehr: die Vorgaenger-SQL zog die Set-Grenze ueber
 * `snapshot_date <= '2026-08-25'`. Seit Migration 0063 hat die Snapshot-Tabelle
 * eine echte set_number — ein Datum daneben waere eine zweite, konkurrierende
 * Wahrheit. Beim naechsten Set-Bump waere sie ausserdem still falsch geworden:
 * public/tft-roadmap.json ist stale und hat keinen Key fuer Set 19, ein aus
 * setStartDate abgeleiteter Cutoff haette auf 2026-08-25 festgehangen und NULL
 * Zeilen erfasst — bei Exit-Code 0.
 *
 * Und darum laeuft das hier laufend statt einmal am Set-Ende: der Peak wird
 * inkrementell hochgezogen, ein bestehender Wert nur bei einem echt hoeheren
 * ueberschrieben. Ein Set-Wechsel braucht damit keinen Trigger — sobald keine
 * Snapshots des alten Sets mehr dazukommen, ist es von selbst eingefroren.
 *
 * --min-sample 40 stammt aus der Set-17-Erstbefuellung und bleibt Default,
 * damit bestehende Zeilen nicht still neu bewertet werden. Vorsicht bei der
 * Begruendung im alten Kopfkommentar ("unter 40 Spielen ist der Multiplier
 * systematisch ueberhoeht"): nachgemessen am 30.08.2026 liegt der hoechste
 * Durchschnitts-Multiplier in Set 17 im Bucket 40-99 (1,501) gegen 1,029 bei
 * >=100, in Set 18 faellt er ueber alle Buckets monoton. Die Schwelle trennt
 * also nicht das, was der Kommentar behauptete.
 *
 * Verwendung:
 *   node scripts/freeze-marketvalue-peaks.mjs                # laufendes Set, letzte 7 Tage
 *   node scripts/freeze-marketvalue-peaks.mjs --set 17 --full
 *   node scripts/freeze-marketvalue-peaks.mjs --since 2026-08-26 --dry-run
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const args = process.argv.slice(2);
const arg = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };

function loadEnv() {
  for (const path of ['/etc/metastats-crawler/env', resolve(process.cwd(), '.env.local')]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.includes('=') || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
    }
    break;
  }
}
loadEnv();

// Die Peaks-Tabelle liegt NUR auf Supabase (auf der Box gemessen: to_regclass
// = NULL). Auf der Box zeigt DATABASE_URL auf das lokale Postgres, deshalb hat
// SUPABASE_DB_URL Vorrang; lokal existiert nur DATABASE_URL und der zeigt
// bereits auf Supabase.
const DB_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('Weder SUPABASE_DB_URL noch DATABASE_URL gesetzt');
  process.exit(1);
}

function currentSet() {
  const p = resolve(process.cwd(), 'public/tft-set.json');
  if (!existsSync(p)) return null;
  const n = JSON.parse(readFileSync(p, 'utf8')).setNumber;
  return Number.isInteger(n) ? n : null;
}

const SET = parseInt(arg('--set', String(currentSet() ?? NaN)), 10);
const MIN_SAMPLE = parseInt(arg('--min-sample', '40'), 10);
const FULL = args.includes('--full');
const DRY_RUN = args.includes('--dry-run');
const SINCE = FULL
  ? null
  : (arg('--since', null) || new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10));

if (!Number.isInteger(SET)) {
  console.error('Kein Set: --set N angeben oder public/tft-set.json bereitstellen');
  process.exit(1);
}

const T = 'tft_player_marketvalue_peaks';
// Peak-Spalten nur bei einem echt hoeheren Wert uebernehmen; bei Gleichstand
// gewinnt der frueher erreichte Eintrag (dieselbe Regel wie das order by unten).
const keepIfLower = (col) =>
  `${col} = case when excluded.final_value > ${T}.final_value then excluded.${col} else ${T}.${col} end`;

// cand: welche Spieler das Fenster ueberhaupt beruehrt hat.
// peak: bester Wert IM FENSTER — der historische Peak steckt bereits in der
//       Zieltabelle und wird unten nur bei einem hoeheren Wert ersetzt.
// cov:  Abdeckung ueber das GANZE Set, nicht nur ueber das Fenster, sonst waere
//       snapshot_count vom Laufzeitpunkt abhaengig statt idempotent. Der
//       Set-Filter fehlte in der alten SQL — dort zaehlte sie ueber Sets hinweg.
const SQL = `
with cand as (
  select distinct puuid
    from tft_player_marketvalue_snapshots
   where set_number = $1 and sample_size >= $2
     and ($3::date is null or snapshot_date >= $3::date)
),
cov as (
  select s.puuid,
         count(*)::int        as snapshot_count,
         min(s.snapshot_date) as first_snapshot_date,
         max(s.snapshot_date) as last_snapshot_date
    from tft_player_marketvalue_snapshots s
    join cand c on c.puuid = s.puuid
   where s.set_number = $1
   group by s.puuid
),
peak as (
  select distinct on (s.puuid)
         s.puuid, s.region, s.game_name, s.tag_line, s.snapshot_date,
         s.tier, s.rank, s.lp, s.ladder_rank,
         s.base_value, s.multiplier, s.final_value, s.sample_size, s.damping
    from tft_player_marketvalue_snapshots s
    join cand c on c.puuid = s.puuid
   where s.set_number = $1 and s.sample_size >= $2
     and ($3::date is null or s.snapshot_date >= $3::date)
   order by s.puuid, s.final_value desc, s.snapshot_date asc
)
insert into ${T} (
  puuid, set_number, region, game_name, tag_line, snapshot_date,
  tier, rank, lp, ladder_rank,
  base_value, multiplier, final_value, sample_size, damping,
  low_confidence, snapshot_count, first_snapshot_date, last_snapshot_date
)
select p.puuid, $1, p.region, p.game_name, p.tag_line, p.snapshot_date,
       p.tier, p.rank, p.lp, p.ladder_rank,
       p.base_value, p.multiplier, p.final_value, p.sample_size, p.damping,
       (p.damping < 1), c.snapshot_count, c.first_snapshot_date, c.last_snapshot_date
  from peak p
  join cov c on c.puuid = p.puuid
on conflict (puuid, set_number) do update set
  ${[
    'region', 'game_name', 'tag_line', 'snapshot_date', 'tier', 'rank', 'lp',
    'ladder_rank', 'base_value', 'multiplier', 'sample_size', 'damping', 'low_confidence',
  ].map(keepIfLower).join(',\n  ')},
  frozen_at = case when excluded.final_value > ${T}.final_value then now() else ${T}.frozen_at end,
  final_value = greatest(excluded.final_value, ${T}.final_value),
  snapshot_count      = excluded.snapshot_count,
  first_snapshot_date = least(excluded.first_snapshot_date, ${T}.first_snapshot_date),
  last_snapshot_date  = greatest(excluded.last_snapshot_date, ${T}.last_snapshot_date)
`;

// Bewusst kopiert statt importiert: dieselbe Funktion steht bereits in
// db-exec.mjs, apply-supabase-migrations.mjs, daily-marketvalue-snapshot.mjs
// und drei weiteren Scripts. Das Supabase-Passwort enthaelt Sonderzeichen; ohne
// das Encoding wirft pg "Invalid URL".
function encodePasswordInPgUrl(url) {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd < 0) return url;
  const after = url.slice(schemeEnd + 3);
  const atIdx = after.lastIndexOf('@');
  if (atIdx < 0) return url;
  const userinfo = after.slice(0, atIdx);
  const rest = after.slice(atIdx);
  const colonIdx = userinfo.indexOf(':');
  if (colonIdx < 0) return url;
  return `${url.slice(0, schemeEnd + 3)}${userinfo.slice(0, colonIdx)}:${encodeURIComponent(userinfo.slice(colonIdx + 1))}${rest}`;
}

const pool = new pg.Pool({
  connectionString: encodePasswordInPgUrl(DB_URL),
  ssl: { rejectUnauthorized: false },
  max: 2,
  statement_timeout: 600_000,
});

async function main() {
  console.log(`=== Marktwert-Peaks Set ${SET} (${FULL ? 'ganzes Set' : `ab ${SINCE}`}, min sample ${MIN_SAMPLE}) ===`);
  const before = await pool.query(`select count(*)::int as n from ${T} where set_number = $1`, [SET]);

  if (DRY_RUN) {
    const c = await pool.query(
      `select count(distinct puuid)::int as n
         from tft_player_marketvalue_snapshots
        where set_number = $1 and sample_size >= $2
          and ($3::date is null or snapshot_date >= $3::date)`,
      [SET, MIN_SAMPLE, SINCE],
    );
    console.log(`[dry-run] ${c.rows[0].n} Kandidaten, ${before.rows[0].n} Zeilen bereits vorhanden`);
    await pool.end();
    return;
  }

  const t0 = process.hrtime.bigint();
  const res = await pool.query(SQL, [SET, MIN_SAMPLE, SINCE]);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const after = await pool.query(`select count(*)::int as n from ${T} where set_number = $1`, [SET]);
  console.log(`[peaks] ${res.rowCount} Zeilen beruehrt in ${Math.round(ms)} ms`);
  console.log(`[peaks] Set ${SET}: ${before.rows[0].n} -> ${after.rows[0].n} Zeilen`);
  await pool.end();
}

main().catch(err => {
  console.error('FAIL:', err.message);
  pool.end().catch(() => {});
  process.exit(1);
});
