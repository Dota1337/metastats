#!/usr/bin/env node
// EINMALIG, 2026-10-04 — nicht in einen Timer haengen.
//
// Rechnet alle Set-18-Challenger-Tageswerte mit der neuen Grundwert-Kurve nach
// (User-Vorgabe 2026-10-04: Platz 1 → 130k, Platz 100 → 60k, Platz 300+ und
// ohne Platz → 30k; siehe challengerBase in scripts/lib/tft-marketvalue.mjs).
//
//   base_value  = round(Grundwert neu)
//   final_value = round(Grundwert neu × gespeicherter Multiplikator)
//   Geschaetzte Zeilen (Marker "estimated") werden danach wieder auf den
//   hoechsten echten Set-18-Wert desselben Spielers gedeckelt — mit den
//   NEUEN echten Werten.
//
// Nur tier = 'CHALLENGER'. Platz, LP, Multiplikator, created_at bleiben.
// Ohne --apply wird nur gezaehlt. Ein zweiter Lauf mit --apply aendert 0 Zeilen.
// Laeuft auf der Box (DATABASE_URL = Hetzner); Supabase danach per
// sync-marketvalue-to-supabase.mjs --since <Setstart>, Peaks per
// freeze-marketvalue-peaks.mjs --full.
//
// Rueckbau:
//   update tft_player_marketvalue_snapshots t set base_value = b.base_value, final_value = b.final_value
//     from tft_mv_backup_20261004_challbase b
//    where t.puuid = b.puuid and t.region = b.region and t.snapshot_date = b.snapshot_date;

import pg from 'pg';
import { computeBaseValue } from '../lib/tft-marketvalue.mjs';
import { loadCurrentSet } from '../lib/current-set.mjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const SET = Number(args.includes('--set') ? args[args.indexOf('--set') + 1] : loadCurrentSet());
if (SET !== 18) throw new Error(`Nur fuer Set 18 gedacht, nicht fuer Set ${SET}`);
const MARKER_ANY = JSON.stringify([{ signal: 'estimated' }]);
const BACKUP = 'tft_mv_backup_20261004_challbase';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
pool.on('error', (e) => console.error(`DB-Verbindung verworfen: ${e.message}`));

const rows = (await pool.query(
  `select puuid, region, snapshot_date::text d, tier, rank, lp, ladder_rank, base_value, multiplier,
          final_value, agents @> $2::jsonb as est
     from tft_player_marketvalue_snapshots
    where set_number = $1`, [SET, MARKER_ANY])).rows;

// 1) Neuer Wert je Zeile (Nicht-Challenger bleiben, zaehlen aber fuer die Deckelung).
for (const r of rows) {
  r.newBase = r.base_value;
  r.newFinal = r.final_value;
  if (r.tier !== 'CHALLENGER') continue;
  const b = computeBaseValue({ tier: r.tier, rank: r.rank || 'I', leaguePoints: r.lp }, r.ladder_rank ?? undefined);
  r.newBase = Math.round(b.baseValue);
  r.newFinal = Math.round(b.baseValue * Number(r.multiplier));
}

// 2) Geschaetzte Zeilen auf den hoechsten neuen echten Wert des Spielers deckeln.
const cap = new Map();
for (const r of rows) {
  if (r.est) continue;
  const k = `${r.region}|${r.puuid}`;
  cap.set(k, Math.max(cap.get(k) ?? 0, r.newFinal));
}
let capped = 0;
for (const r of rows) {
  if (!r.est || r.tier !== 'CHALLENGER') continue;
  const c = cap.get(`${r.region}|${r.puuid}`);
  if (c != null && r.newFinal > c) { r.newFinal = c; capped++; }
}

const changes = rows.filter(r => r.tier === 'CHALLENGER' && (r.newBase !== r.base_value || r.newFinal !== r.final_value));
const chall = rows.filter(r => r.tier === 'CHALLENGER');
const stats = {
  challengerZeilen: chall.length,
  geaendert: changes.length,
  hoeher: changes.filter(c => c.newFinal > c.final_value).length,
  niedriger: changes.filter(c => c.newFinal < c.final_value).length,
  geschaetztGedeckelt: capped,
  ohnePlatz: chall.filter(r => r.ladder_rank == null).length,
  platzUeber300: chall.filter(r => r.ladder_rank > 300).length,
};
console.log(`Set ${SET}${APPLY ? ' — SCHREIBT' : ' — nur zaehlen'}: ${JSON.stringify(stats)}`);
for (const c of changes.slice(0, 5)) {
  console.log(`  z.B. ${c.region} ${c.d} Platz ${c.ladder_rank ?? '-'}: ${c.base_value}/${c.final_value} → ${c.newBase}/${c.newFinal}`);
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
            set base_value = k.b, final_value = k.f
           from unnest($1::text[], $2::text[], $3::date[], $4::int[], $5::int[]) k(p, r, d, b, f)
          where t.puuid = k.p and t.region = k.r and t.snapshot_date = k.d
            and t.tier = 'CHALLENGER' and t.set_number = ${SET}`,
        [...k, part.map(c => c.newBase), part.map(c => c.newFinal)]);
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
