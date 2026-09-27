#!/usr/bin/env node
// EINMALIG, 2026-09-27 — nicht wiederverwenden, nicht in einen Timer haengen.
//
// Traegt fuer Vbzz#EUW die Set-18-Marktwertkurve ab 01.09. (erster Tag in
// Diamond II) nach. Vbzz wurde nie erfasst, weil der Entdeckungs-Crawler seit
// 2026-08-01 aus ist; die erste Zeile (26.09.) war zudem ohne Ladder-Rang
// berechnet. Ausnahme von „keine erfundenen Werte" auf User-Anweisung.
//
// Quellen:
//  - LP/Tier je Tag: MetaTFT ranked_rating_changes, Tagesendstand (gemessen 27.09.)
//  - Ladder-Rang an Challenger-Tagen: geschaetzt = Zahl unserer EUW-Challenger-
//    Zeilen desselben Tages mit mehr LP + 1; 13.09. hat keine Zeilen → Mittel
//    der Nachbartage (55, 39) = 47
//  - Multiplikator: fest 1.616 (Wert der echten Zeilen vom 26./27.09.)
//
// Ausgabe: SQL auf stdout. Dasselbe SQL laeuft gegen Hetzner (Quelle der
// Wahrheit) und danach gegen Supabase — der Sync-Timer (--window 3) traegt
// aeltere Tage nicht nach.
//
// Rueckbau (beide DBs):
//   delete from tft_player_marketvalue_snapshots
//    where puuid = '<PUUID>' and agents @> '[{"signal":"estimated"}]';
// Die echte 27.09.-Zeile bleibt; Peaks danach per freeze-marketvalue-peaks neu.

import { computeBaseValue } from '../lib/tft-marketvalue.mjs';

const PUUID = 'wq5eRu5V64hgWsTnjFAi1EZhBdJcgFNQlgA5HoqsZ1qrAtkTnV5obzo4wdf5JP3TkLqNcTxqlIJdnQ';
const MULT = 1.616;
const CAP = 210080; // echter Wert vom 27.09. — keine Schaetzung darf darueber
const MARKER = { signal: 'estimated', available: false, basis: 'backfill-2026-09-27' };

// [Datum, Tier, Division, LP, Spiele bis Tagesende, geschaetzter Ladder-Rang]
const DAYS = [
  ['2026-09-01', 'DIAMOND', 'II', 0, 50, null],
  ['2026-09-02', 'DIAMOND', 'II', 11, 60, null],
  ['2026-09-03', 'DIAMOND', 'I', 24, 77, null],
  ['2026-09-04', 'MASTER', 'I', 0, 89, null],
  ['2026-09-05', 'MASTER', 'I', 10, 96, null],
  ['2026-09-06', 'MASTER', 'I', 184, 104, null],
  ['2026-09-07', 'GRANDMASTER', 'I', 325, 113, null],
  ['2026-09-08', 'GRANDMASTER', 'I', 385, 125, null],
  ['2026-09-09', 'CHALLENGER', 'I', 595, 132, 146],
  ['2026-09-10', 'CHALLENGER', 'I', 662, 139, 99],
  ['2026-09-11', 'CHALLENGER', 'I', 629, 147, 117],
  ['2026-09-12', 'CHALLENGER', 'I', 802, 154, 55],
  ['2026-09-13', 'CHALLENGER', 'I', 837, 158, 47],
  ['2026-09-14', 'CHALLENGER', 'I', 889, 163, 39],
  ['2026-09-15', 'CHALLENGER', 'I', 939, 164, 36],
  ['2026-09-16', 'CHALLENGER', 'I', 1063, 169, 23],
  ['2026-09-17', 'CHALLENGER', 'I', 1145, 176, 16],
  ['2026-09-18', 'CHALLENGER', 'I', 1097, 182, 17],
  ['2026-09-19', 'CHALLENGER', 'I', 1188, 185, 12],
  ['2026-09-20', 'CHALLENGER', 'I', 1147, 186, 18],
  ['2026-09-21', 'CHALLENGER', 'I', 1180, 195, 19],
  ['2026-09-22', 'CHALLENGER', 'I', 1444, 203, 9],
  ['2026-09-23', 'CHALLENGER', 'I', 1694, 215, 2],
  ['2026-09-24', 'CHALLENGER', 'I', 1746, 219, 1],
  ['2026-09-25', 'CHALLENGER', 'I', 1756, 220, 1],
  ['2026-09-26', 'CHALLENGER', 'I', 1766, 221, 1], // ersetzt die Zeile ohne Rang
];

const q = (s) => (s == null ? 'null' : `'${String(s).replace(/'/g, "''")}'`);

const rows = DAYS.map(([date, tier, rank, lp, games, ladder]) => {
  const b = computeBaseValue({ tier, rank, leaguePoints: lp }, ladder);
  if (!b.rated) throw new Error(`${date}: nicht bewertbar (${b.notRatedReason})`);
  const base = Math.round(b.baseValue);
  const final = Math.round(base * MULT);
  if (final > CAP) throw new Error(`${date}: ${final} > ${CAP}`);
  return { date, tier, rank, lp, games, ladder, base, final };
});

if (process.argv.includes('--dry-run')) {
  for (const r of rows) {
    console.log(r.date, r.tier.padEnd(11), String(r.lp).padStart(4), 'LP',
      `rang=${r.ladder ?? '-'}`.padEnd(9), `base=${r.base}`.padEnd(12), `final=${r.final}`);
  }
  process.exit(0);
}

// agents: echte Signale der 27.09.-Zeile + Marker, damit die Seite dieselben
// Balken zeigt und der Rueckbau die Zeilen findet. Fehlt die Quellzeile,
// schreibt das select nichts — die Pruefzeile am Ende zeigt das.
const out = ['begin;'];
for (const r of rows) {
  out.push(`insert into tft_player_marketvalue_snapshots (
  puuid, region, snapshot_date, set_number, game_name, tag_line, tier, rank, lp, ladder_rank,
  base_value, multiplier, final_value, sample_size, damping, agents, created_at
) select ${q(PUUID)}, 'euw1', ${q(r.date)}, 18, 'Vbzz', 'EUW', ${q(r.tier)}, ${q(r.rank)}, ${r.lp}, ${r.ladder ?? 'null'},
  ${r.base}, ${MULT}, ${r.final}, ${r.games}, 1.000,
  src.agents || ${q(JSON.stringify([MARKER]))}::jsonb, ${q(`${r.date} 20:00:00+00`)}
  from tft_player_marketvalue_snapshots src
 where src.puuid = ${q(PUUID)} and src.region = 'euw1' and src.snapshot_date = '2026-09-27'
on conflict (puuid, region, snapshot_date) do update set
  tier = excluded.tier, rank = excluded.rank, lp = excluded.lp, ladder_rank = excluded.ladder_rank,
  base_value = excluded.base_value, multiplier = excluded.multiplier, final_value = excluded.final_value,
  sample_size = excluded.sample_size, damping = excluded.damping, agents = excluded.agents,
  created_at = excluded.created_at;`);
}
out.push(`select count(*) as geschaetzt, max(final_value) as max_final from tft_player_marketvalue_snapshots
 where puuid = ${q(PUUID)} and agents @> '[{"signal":"estimated"}]';`);
out.push('commit;');
console.log(out.join('\n'));
