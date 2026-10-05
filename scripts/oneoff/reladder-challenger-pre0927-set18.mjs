#!/usr/bin/env node
// EINMALIG, 2026-10-05 — nicht in einen Timer haengen.
//
// Set-18-Challenger-Zeilen bis einschliesslich 27.09. bekommen einen geschaetzten
// Platz. Bis Commit 2d7d902 wurde ein veralteter Platz gespeichert; der Lauf
// fuer den 27.09. startete am 26.09. um 19:09 CEST noch mit dem alten Code
// (2d7d902 kam um 01:03 CEST auf die Box). Gegen die echte Rangliste gemessen
// stimmen am 27.09. nur 56 von 358 gespeicherten Plaetzen, ab dem 28.09. passen sie. —
// Loescher stand vom 30.08. bis 26.09. auf Platz 4, ab dem 30.09. mit
// echter Rangliste auf Platz 149–214. Sein Hoechstwert 156.740 (22.09.) kam
// allein daher. recompute-challenger-base-set18.mjs (04.10.) hat den
// gespeicherten Platz weiterverwendet und den Fehler deshalb nicht behoben.
//
// Eine echte Tagesrangliste gibt es erst ab 27.09. (tft_ladder_daily,
// Sicherung tft_ladder_daily_backup_20261005). Deshalb:
//
//   ladder_rank = 1 + Anzahl Challenger derselben Region am 27.09. mit mehr LP
//   base_value  = round(challengerBase(ladder_rank))
//   final_value = round(Grundwert × gespeicherter Multiplikator)
//   agents      = + { signal: 'estimated', available: false, basis: 'ladder_20260927' }
//                 (Zeilen mit schon vorhandenem estimated-Marker behalten ihren)
//
// Der Marker sorgt dafuer, dass refresh-api-server.mjs und
// collect-tft-marketvalues.mjs den geschaetzten Platz nie als letzten echten
// Platz weiterverwenden. Die Schaetzung liegt eher zu niedrig: die LP-Kurve
// steigt ueber den Set-Verlauf, ein frueher Tag wird an einer spaeteren Kurve
// gemessen.
//
// Nur tier = 'CHALLENGER', set_number = 18, snapshot_date bis einschliesslich 27.09.
// Ohne --apply wird nur gezaehlt. Ein zweiter Lauf mit --apply aendert 0 Zeilen.
// Laeuft auf der Box (DATABASE_URL = Hetzner); danach
//   sync-marketvalue-to-supabase.mjs --since 2026-08-27
// und die Set-18-Hoechstwerte auf Supabase loeschen + freeze-marketvalue-peaks.mjs --full
// (das Einfrieren hebt Hoechstwerte nur an).
//
// Rueckbau:
//   update tft_player_marketvalue_snapshots t
//      set ladder_rank = b.ladder_rank, base_value = b.base_value,
//          final_value = b.final_value, agents = b.agents
//     from tft_mv_backup_20261005_reladder b
//    where t.puuid = b.puuid and t.region = b.region and t.snapshot_date = b.snapshot_date;
// danach wieder sync + Hoechstwerte; die alten Set-18-Hoechstwerte liegen auf
// Supabase in tft_mv_peaks_backup_20261005_reladder.
//
// Gelaufen am 2026-10-05 um 22:53 CEST: 16.622 Zeilen geschrieben, zweiter Lauf 0.

import pg from 'pg';
import { challengerBase } from '../lib/tft-marketvalue.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const SET = 18;
const LADDER_DAY = '2026-09-27';
const BEFORE = '2026-09-28';
const BACKUP = 'tft_mv_backup_20261005_reladder';
const MARKER = { signal: 'estimated', available: false, basis: 'ladder_20260927' };
const SAMPLE_NAME = 'loescher';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
pool.on('error', (e) => console.error(`DB-Verbindung verworfen: ${e.message}`));

// Rangliste 27.09.: je Region die LP aller Challenger, absteigend.
const ladder = new Map();
for (const r of (await pool.query(
  `select region, lp from tft_ladder_daily
    where day = $1 and tier = 'CHALLENGER' and set_number = $2`, [LADDER_DAY, SET])).rows) {
  if (!ladder.has(r.region)) ladder.set(r.region, []);
  ladder.get(r.region).push(r.lp);
}
for (const lps of ladder.values()) lps.sort((a, b) => b - a);

// Anzahl Eintraege mit mehr LP (Liste absteigend sortiert).
function countAbove(lps, lp) {
  let lo = 0, hi = lps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lps[mid] > lp) lo = mid + 1; else hi = mid;
  }
  return lo;
}

const rows = (await pool.query(
  `select puuid, region, snapshot_date::text d, lower(coalesce(game_name, '')) name, lp, ladder_rank,
          base_value, multiplier, final_value, agents
     from tft_player_marketvalue_snapshots
    where set_number = $1 and tier = 'CHALLENGER' and snapshot_date < $2::date`, [SET, BEFORE])).rows;

const missingRegions = [...new Set(rows.map(r => r.region))].filter(r => !ladder.has(r));
if (missingRegions.length) {
  throw new Error(`Rangliste ${LADDER_DAY} fehlt fuer ${missingRegions.join(', ')} — Abbruch, nichts geschrieben`);
}

const changes = [];
let ohneLp = 0;
for (const r of rows) {
  if (r.lp == null) { ohneLp++; continue; }
  const agents = Array.isArray(r.agents) ? r.agents : [];
  r.newRank = 1 + countAbove(ladder.get(r.region), r.lp);
  r.newBase = Math.round(challengerBase(r.newRank));
  r.newFinal = Math.round(challengerBase(r.newRank) * Number(r.multiplier));
  const hasEstimated = agents.some(a => a && a.signal === 'estimated');
  r.newAgents = hasEstimated ? null : JSON.stringify([...agents, MARKER]);
  if (r.newRank !== r.ladder_rank || r.newBase !== r.base_value || r.newFinal !== r.final_value || r.newAgents) {
    changes.push(r);
  }
}

const sum = (list, f) => list.reduce((s, r) => s + Number(f(r)), 0);
const stats = {
  zeilen: rows.length,
  spieler: new Set(rows.map(r => `${r.region}|${r.puuid}`)).size,
  geaendert: changes.length,
  hoeher: changes.filter(c => c.newFinal > c.final_value).length,
  niedriger: changes.filter(c => c.newFinal < c.final_value).length,
  ohneLp,
  summeVorher: sum(changes, c => c.final_value),
  summeNachher: sum(changes, c => c.newFinal),
};
console.log(`Set ${SET}, Rangliste ${LADDER_DAY}${APPLY ? ' — SCHREIBT' : ' — nur zaehlen'}: ${JSON.stringify(stats)}`);
console.log(`Challenger am ${LADDER_DAY}: ${[...ladder].map(([r, l]) => `${r} ${l.length}`).join(', ')}`);
for (const c of [...changes].sort((a, b) => (a.newFinal - a.final_value) - (b.newFinal - b.final_value)).slice(0, 5)) {
  console.log(`  groesster Rueckgang: ${c.region} ${c.d} ${c.lp} LP Platz ${c.ladder_rank ?? '-'} → ${c.newRank}: ${c.final_value} → ${c.newFinal}`);
}
for (const c of rows.filter(r => r.name === SAMPLE_NAME).sort((a, b) => a.d.localeCompare(b.d)).slice(-8)) {
  console.log(`  ${SAMPLE_NAME} ${c.d}: ${c.lp} LP Platz ${c.ladder_rank ?? '-'} → ${c.newRank}, ${c.final_value} → ${c.newFinal}`);
}

if (APPLY && changes.length) {
  const client = await pool.connect();
  let written = 0;
  try {
    await client.query('begin');
    await client.query(`create table if not exists ${BACKUP} (like tft_player_marketvalue_snapshots including defaults)`);
    for (let i = 0; i < changes.length; i += 2000) {
      const part = changes.slice(i, i + 2000);
      const k = [part.map(c => c.puuid), part.map(c => c.region), part.map(c => c.d)];
      // Nur die erste Sicherung einer Zeile behalten — sie traegt den Wert vor dem Eingriff.
      await client.query(
        `insert into ${BACKUP}
         select t.* from tft_player_marketvalue_snapshots t
           join unnest($1::text[], $2::text[], $3::date[]) k(p, r, d)
             on t.puuid = k.p and t.region = k.r and t.snapshot_date = k.d
          where not exists (select 1 from ${BACKUP} b
                             where b.puuid = t.puuid and b.region = t.region and b.snapshot_date = t.snapshot_date)`, k);
      const u = await client.query(
        `update tft_player_marketvalue_snapshots t
            set ladder_rank = k.lr, base_value = k.b, final_value = k.f,
                agents = coalesce(k.a::jsonb, t.agents)
           from unnest($1::text[], $2::text[], $3::date[], $4::int[], $5::int[], $6::int[], $7::text[])
                  k(p, r, d, lr, b, f, a)
          where t.puuid = k.p and t.region = k.r and t.snapshot_date = k.d
            and t.tier = 'CHALLENGER' and t.set_number = ${SET} and t.snapshot_date < '${BEFORE}'`,
        [...k, part.map(c => c.newRank), part.map(c => c.newBase), part.map(c => c.newFinal), part.map(c => c.newAgents)]);
      written += u.rowCount;
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  console.log(`geschrieben: ${written}`);
}
await pool.end();
