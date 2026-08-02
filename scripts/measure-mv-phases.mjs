#!/usr/bin/env node
// T0 aus infra/specs/2026-08-02-marktwert-inkrementell.md
//
// Beantwortet EINE Frage: Was kostet pro Spieler das reine Lesen der
// Saison-Matches aus der DB plus das Extrahieren der Roh-Metriken?
//
// Warum das die Entscheidung traegt: im inkrementellen Umbau fallen die
// Riot-Calls fuer Inaktive weg. Was NICHT wegfaellt, ist Pass 2 — der braucht
// pro Spieler die Roh-Metriken. Variante B liest sie jedes Mal neu aus dem
// 39-GB-Cache, Variante C persistiert sie. Ist das Lesen billig, reicht B
// (kein Schema-Eingriff). Ist es teuer, brauchen wir C.
//
// Rechnung zum Einordnen: 52.091 Spieler x gemessene ms = Gesamtkosten von
// Pass 2 pro Nacht. Alles ueber ~1h ist fuer B disqualifizierend.
//
// Bewusst OHNE Riot-Calls — reine Lesemessung, kein Quota-Verbrauch, keine
// Nebenwirkung auf den laufenden Snapshot-Prozess ausser DB-Last.
//
// Aufruf:  node scripts/measure-mv-phases.mjs [--region euw1] [--n 200]

import pg from 'pg';
import { listSeasonMatches } from './lib/tft-match-cache-pg.mjs';
import { extractRawMetrics } from './lib/tft-skill-score.mjs';
import { loadCurrentSet } from './lib/tft-marketvalue-pipeline.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const REGION = arg('--region', 'euw1');
const N = parseInt(arg('--n', '200'), 10);
const D2_TIERS = ['DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }

const isRemote = /supabase\.com|pooler\.|aws-/i.test(DATABASE_URL);
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: isRemote ? { rejectUnauthorized: false } : undefined,
  max: 2,
  statement_timeout: 60_000,
});

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

async function main() {
  const setNumber = loadCurrentSet();
  console.log(`=== Pass-2-Kostenmessung === region=${REGION} n=${N} set=${setNumber}`);

  const t0 = Date.now();
  const { rows: players } = await pool.query(
    `with latest as (
       select distinct on (puuid) puuid, tier
       from tft_player_marketvalue_snapshots
       where region = $1
       order by puuid, snapshot_date desc
     )
     select puuid from latest where tier = any($2::text[]) limit $3`,
    [REGION, D2_TIERS, N],
  );
  console.log(`  ${players.length} Spieler geladen in ${Date.now() - t0}ms`);
  if (players.length === 0) { console.log('  keine Spieler — Abbruch'); await pool.end(); return; }

  const readMs = [];
  const extractMs = [];
  let totalMatches = 0;
  let emptyPlayers = 0;

  for (const p of players) {
    const a = Date.now();
    const matches = await listSeasonMatches(pool, p.puuid, setNumber);
    const b = Date.now();
    // ranked=null: wir messen die Extraktion, nicht die Korrektheit der WR.
    extractRawMetrics(matches, { wins: 0, losses: 0 }, null);
    const c = Date.now();

    readMs.push(b - a);
    extractMs.push(c - b);
    totalMatches += matches.length;
    if (matches.length === 0) emptyPlayers++;
  }

  const rs = [...readMs].sort((x, y) => x - y);
  const es = [...extractMs].sort((x, y) => x - y);
  const sum = arr => arr.reduce((s, v) => s + v, 0);
  const avgRead = sum(readMs) / readMs.length;
  const avgExtract = sum(extractMs) / extractMs.length;
  const avgTotal = avgRead + avgExtract;

  console.log('');
  console.log(`  Matches gesamt: ${totalMatches} (Ø ${(totalMatches / players.length).toFixed(1)}/Spieler, ${emptyPlayers} ohne Matches)`);
  console.log(`  DB-Read    Ø ${avgRead.toFixed(1)}ms | p50 ${pct(rs, 50)} | p95 ${pct(rs, 95)} | max ${rs[rs.length - 1]}`);
  console.log(`  Extraktion Ø ${avgExtract.toFixed(1)}ms | p50 ${pct(es, 50)} | p95 ${pct(es, 95)} | max ${es[es.length - 1]}`);
  console.log(`  Pass-2 pro Spieler: Ø ${avgTotal.toFixed(1)}ms`);
  console.log('');

  const POP = 52091;
  const hochStd = (avgTotal * POP) / 1000 / 3600;
  const hochPar4 = hochStd / 4;
  console.log(`  Hochrechnung auf ${POP} Spieler:`);
  console.log(`    seriell:        ${hochStd.toFixed(2)} h`);
  console.log(`    4-fach parallel:${hochPar4.toFixed(2)} h`);
  console.log('');
  console.log(hochPar4 <= 1
    ? '  => Variante B tragfaehig (Roh-Metriken jedes Mal neu lesen, kein Schema-Eingriff).'
    : '  => Variante B zu teuer. Variante C noetig (Roh-Metriken persistieren).');
  console.log('');
  console.log('  HINWEIS: laeuft der Snapshot-Job parallel, sind die Werte pessimistisch');
  console.log('  (DB-Kontention). Das ist die sichere Richtung fuer diese Entscheidung.');

  await pool.end();
}

main().catch(err => { console.error('FAIL:', err); process.exit(1); });
