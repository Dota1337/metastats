#!/usr/bin/env node
// EINMALIG, 2026-09-27/28 — nicht in einen Timer haengen.
//
// Zweiter Teil der Set-18-Bereinigung (erster Teil: Kopien des alten Sets
// geloescht, Sicherung tft_mv_fix_backup_20260927). Vorlage: backfill-vbzz-set18.mjs.
//
//   backfill  Fuer Riots heutige Challenger + Grandmaster mit mindestens einer
//             echten Set-18-Zeile: fehlende Tage aus dem MetaTFT-Verlauf
//             (Tagesendstand) nachtragen. Master bewusst nicht (User 2026-09-27).
//   reladder  Challenger-Platz je Region+Tag aus unseren Zeilen neu zaehlen
//             (LP absteigend, dann puuid — Riots Siege-Kriterium steht nicht in
//             der Tabelle), Wert neu = round(Grundwert × gespeicherter Multiplikator).
//             Nicht-Challenger verlieren den alten Platz (aendert keinen Wert).
//
// Ohne --apply wird nur gezaehlt. Laeuft auf der Box (DATABASE_URL = Hetzner),
// Supabase danach per sync-marketvalue-to-supabase.mjs --since <Setstart>.
//
// Regeln:
//  - Echte Zeilen werden vom Nachtrag nie ueberschrieben (Update nur, wo die
//    bestehende Zeile den Marker traegt).
//  - Tage, an denen eine Region weniger als 80 % des Median ihrer Challenger-
//    Zeilen hat, bekommen keinen geschaetzten Platz und keine Korrektur — ein
//    duenner Tag machte sonst jeden zum Platz 1 (EUW 13.09.: 1 Zeile).
//  - Geschaetzte Werte werden auf den hoechsten echten Set-18-Wert des Spielers
//    gedeckelt; gedeckelte Tage stehen im Bericht.
//
// Rueckbau:
//   delete from tft_player_marketvalue_snapshots
//    where agents @> '[{"signal":"estimated","basis":"backfill-batch-2026-09-27"}]';
//   reladder: update aus tft_mv_fix_backup_20260927_rank zurueckspielen.

import pg from 'pg';
import { computeBaseValue } from '../lib/tft-marketvalue.mjs';
import { loadCurrentSet, loadSetStartDate } from '../lib/current-set.mjs';
import { ACTIVE_REGIONS } from '../lib/active-regions.mjs';

const args = process.argv.slice(2);
const CMD = args[0];
const APPLY = args.includes('--apply');
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const ONLY_REGION = arg('--region', null);
// Tage ab hier laufen mit frischem Platz aus dem neuen Code — reladder fasst sie nicht an.
const BEFORE = arg('--before', null);

const SET = loadCurrentSet();
const SET_START = loadSetStartDate();
if (!SET || !SET_START) throw new Error('tft-set.json: Set oder Startdatum fehlt');
const MARKER = { signal: 'estimated', available: false, basis: 'backfill-batch-2026-09-27' };
const MARKER_ANY = JSON.stringify([{ signal: 'estimated' }]);
const RIOT_KEY = process.env.RIOT_API_KEY_TFT;
const REGIONS = ACTIVE_REGIONS;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
// Ruhende Verbindungen, die der Server kappt (z. B. DB-Neustart), reissen sonst den Prozess.
pool.on('error', (e) => console.error(`DB-Verbindung verworfen: ${e.message}`));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Platz-Tabelle: je Tag die LP aller Challenger-Zeilen der Region ──────────
async function loadChallengerDays(region) {
  const r = await pool.query(
    `select snapshot_date::text d, puuid, lp from tft_player_marketvalue_snapshots
      where region = $1 and set_number = $2 and tier = 'CHALLENGER'`, [region, SET]);
  const days = new Map();
  for (const row of r.rows) {
    if (!days.has(row.d)) days.set(row.d, []);
    days.get(row.d).push(row);
  }
  const counts = [...days.values()].map(v => v.length).sort((a, b) => a - b);
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
  const covered = d => (days.get(d)?.length ?? 0) >= 0.8 * median;
  return { days, median, covered };
}

// ── MetaTFT: Tagesendstaende ────────────────────────────────────────────────
const TIER_RX = /^(CHALLENGER|GRANDMASTER|MASTER|DIAMOND|EMERALD|PLATINUM|GOLD|SILVER|BRONZE|IRON)\s+(I{1,3}|IV)?\s*(\d+)\s*LP$/i;

async function metatftDays(region, name, tag) {
  const url = `https://api.metatft.com/public/profile/lookup_by_riotid/${region.toUpperCase()}/`
    + `${encodeURIComponent(name)}/${encodeURIComponent(tag)}?source=full_profile&tft_set=TFTSet${SET}`;
  const res = await fetch(url, { headers: {
    'User-Agent': 'metastats.gg/1.0', Origin: 'https://www.metatft.com', Referer: 'https://www.metatft.com',
  } });
  if (res.status === 404) return { err: 'unbekannt' };
  if (!res.ok) return { err: `HTTP ${res.status}` };
  const j = await res.json().catch(() => null);
  const list = j?.ranked_rating_changes;
  if (!Array.isArray(list)) return { err: 'kein Verlauf' };
  const byDay = new Map();
  for (const e of list) {
    if (e.tft_set_name !== `TFTSet${SET}` || e.queue_id !== 1100) continue;
    const m = TIER_RX.exec((e.rating_text || '').trim());
    if (!m) continue;
    const d = String(e.created_timestamp).slice(0, 10);   // MetaTFT liefert UTC ohne Zone
    const prev = byDay.get(d);
    if (!prev || e.created_timestamp > prev.ts) {
      byDay.set(d, { ts: e.created_timestamp, tier: m[1].toUpperCase(), rank: (m[2] || 'I').toUpperCase(), lp: +m[3], games: e.num_games ?? null });
    }
  }
  return { byDay };
}

function dayRange(from, to) {           // beide inklusive, 'YYYY-MM-DD'
  const out = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// oc1/sg2/tw2/vn2 speichern keinen Namen in der Zeile → Riot-Konto (jeder Cluster kennt jede puuid).
async function riotName(puuid) {
  const res = await fetch(`https://europe.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}`, { headers: { 'X-Riot-Token': RIOT_KEY } });
  if (!res.ok) return null;
  const j = await res.json();
  return j.gameName && j.tagLine ? { name: j.gameName, tag: j.tagLine } : null;
}

async function riotApex(region) {
  const out = [];
  for (const tier of ['challenger', 'grandmaster']) {
    const res = await fetch(`https://${region}.api.riotgames.com/tft/league/v1/${tier}`, { headers: { 'X-Riot-Token': RIOT_KEY } });
    if (!res.ok) throw new Error(`${region} ${tier}: HTTP ${res.status}`);
    const j = await res.json();
    for (const e of j.entries || []) out.push(e.puuid);
  }
  return out;
}

// ── backfill ────────────────────────────────────────────────────────────────
async function backfillRegion(region, stats) {
  const apex = await riotApex(region);
  const lad = await loadChallengerDays(region);
  const rows = (await pool.query(
    `select puuid, snapshot_date::text d, game_name, tag_line, multiplier, damping, final_value, agents,
            agents @> $3::jsonb as est
       from tft_player_marketvalue_snapshots
      where region = $1 and set_number = $2 and puuid = any($4::text[])
      order by puuid, snapshot_date`, [region, SET, MARKER_ANY, apex])).rows;
  const byPlayer = new Map();
  for (const r of rows) {
    if (!byPlayer.has(r.puuid)) byPlayer.set(r.puuid, []);
    byPlayer.get(r.puuid).push(r);
  }
  for (const [puuid, list] of byPlayer) {
    const real = list.filter(r => !r.est);
    if (real.length === 0) continue;                  // ohne echten Anker kein Nachtrag
    const anchor = real[real.length - 1];             // juengste echte Zeile
    const realDays = new Set(real.map(r => r.d));
    const cap = Math.max(...real.map(r => r.final_value));
    stats.players++;
    const who = anchor.game_name ? { name: anchor.game_name, tag: anchor.tag_line } : await riotName(puuid);
    if (!who) { stats.metatftErr['kein Name'] = (stats.metatftErr['kein Name'] || 0) + 1; continue; }
    const mt = await metatftDays(region, who.name, who.tag);
    await sleep(1100);
    if (mt.err) { stats.metatftErr[mt.err] = (stats.metatftErr[mt.err] || 0) + 1; continue; }
    // Tagesendstand vortragen: an Tagen ohne Spiel gilt der Stand des Vortags.
    let state = null;
    const planned = [];
    for (const d of dayRange(SET_START, anchor.d)) {
      if (mt.byDay.has(d)) state = mt.byDay.get(d);
      if (d >= anchor.d || realDays.has(d) || !state) continue;
      let ladder = null;
      if (state.tier === 'CHALLENGER') {
        if (!lad.covered(d)) { stats.thinDay++; continue; }
        ladder = 1 + lad.days.get(d).filter(o => o.puuid !== puuid && o.lp > state.lp).length;
      }
      const b = computeBaseValue({ tier: state.tier, rank: state.rank, leaguePoints: state.lp }, ladder);
      if (!b.rated) continue;
      const base = Math.round(b.baseValue);
      let final = Math.round(base * Number(anchor.multiplier));
      if (final > cap) { final = cap; stats.capped++; }
      planned.push({ d, ...state, ladder, base, final });
    }
    stats.rows += planned.length;
    if (planned.length) stats.withRows++;
    if (!APPLY || planned.length === 0) continue;
    const agents = JSON.stringify([...(anchor.agents || []).filter(a => a.signal !== 'estimated'), MARKER]);
    for (const p of planned) {
      const r = await pool.query(
        `insert into tft_player_marketvalue_snapshots as t (
           puuid, region, snapshot_date, set_number, game_name, tag_line, tier, rank, lp, ladder_rank,
           base_value, multiplier, final_value, sample_size, damping, agents, created_at, games_played)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,($3::date + time '20:00') at time zone 'UTC',$17)
         on conflict (puuid, region, snapshot_date) do update set
           tier = excluded.tier, rank = excluded.rank, lp = excluded.lp, ladder_rank = excluded.ladder_rank,
           base_value = excluded.base_value, multiplier = excluded.multiplier, final_value = excluded.final_value,
           sample_size = excluded.sample_size, damping = excluded.damping, agents = excluded.agents,
           games_played = excluded.games_played
         where t.agents @> $18::jsonb
           and (t.tier, t.lp, t.ladder_rank, t.final_value) is distinct from
               (excluded.tier, excluded.lp, excluded.ladder_rank, excluded.final_value)`,
        [puuid, region, p.d, SET, anchor.game_name, anchor.tag_line, p.tier, p.rank, p.lp, p.ladder,
         p.base, anchor.multiplier, p.final, p.games ?? 0, anchor.damping, agents, p.games, MARKER_ANY]);
      stats.written += r.rowCount;
    }
  }
}

// ── reladder ────────────────────────────────────────────────────────────────
async function reladderRegion(region, stats) {
  const lad = await loadChallengerDays(region);
  const r = await pool.query(
    `select puuid, snapshot_date::text d, tier, rank, lp, ladder_rank, base_value, multiplier, final_value
       from tft_player_marketvalue_snapshots
      where region = $1 and set_number = $2 and ($3::date is null or snapshot_date < $3::date)
        and (tier = 'CHALLENGER' or ladder_rank is not null)`, [region, SET, BEFORE]);
  const changes = [];
  const byDay = new Map();
  for (const row of r.rows) {
    if (row.tier !== 'CHALLENGER') {                   // Platz gilt nur fuer Challenger
      changes.push({ ...row, ladder: null, base: row.base_value, final: row.final_value });
      continue;
    }
    if (!byDay.has(row.d)) byDay.set(row.d, []);
    byDay.get(row.d).push(row);
  }
  for (const [d, list] of byDay) {
    if (!lad.covered(d)) { stats.thinDay++; continue; }
    list.sort((a, b) => b.lp - a.lp || (a.puuid < b.puuid ? -1 : 1));
    list.forEach((row, i) => {
      const ladder = i + 1;
      if (row.ladder_rank === ladder) return;
      const base = Math.round(computeBaseValue({ tier: row.tier, rank: row.rank, leaguePoints: row.lp }, ladder).baseValue);
      changes.push({ ...row, ladder, base, final: Math.round(base * Number(row.multiplier)) });
    });
  }
  stats.rows += changes.length;
  stats.valueUp += changes.filter(c => c.final > c.final_value).length;
  stats.valueDown += changes.filter(c => c.final < c.final_value).length;
  if (!APPLY || changes.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`create table if not exists tft_mv_fix_backup_20260927_rank
                          (like tft_player_marketvalue_snapshots including defaults)`);
    for (let i = 0; i < changes.length; i += 2000) {
      const part = changes.slice(i, i + 2000);
      const keys = { p: part.map(c => c.puuid), d: part.map(c => c.d) };
      await client.query(
        `insert into tft_mv_fix_backup_20260927_rank
         select t.* from tft_player_marketvalue_snapshots t
           join unnest($2::text[], $3::date[]) k(p, d) on t.puuid = k.p and t.snapshot_date = k.d
          where t.region = $1`, [region, keys.p, keys.d]);
      const u = await client.query(
        `update tft_player_marketvalue_snapshots t
            set ladder_rank = k.l, base_value = k.b, final_value = k.f
           from unnest($2::text[], $3::date[], $4::int[], $5::int[], $6::int[]) k(p, d, l, b, f)
          where t.region = $1 and t.puuid = k.p and t.snapshot_date = k.d`,
        [region, keys.p, keys.d, part.map(c => c.ladder), part.map(c => c.base), part.map(c => c.final)]);
      stats.written += u.rowCount;
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

// ── main ────────────────────────────────────────────────────────────────────
const fn = { backfill: backfillRegion, reladder: reladderRegion }[CMD];
if (!fn) {
  console.error('Aufruf: backfill|reladder [--apply] [--region r] [--before YYYY-MM-DD]');
  process.exit(2);
}
console.log(`${CMD} Set ${SET} ab ${SET_START}${APPLY ? ' — SCHREIBT' : ' — nur zaehlen'}${BEFORE ? `, vor ${BEFORE}` : ''}`);
for (const region of ONLY_REGION ? [ONLY_REGION] : REGIONS) {
  const stats = { players: 0, withRows: 0, rows: 0, written: 0, capped: 0, thinDay: 0, valueUp: 0, valueDown: 0, metatftErr: {} };
  try {
    await fn(region, stats);
  } catch (e) {
    console.log(`${region}: FEHLER ${e.message}`);
    continue;
  }
  console.log(`${region}: ${JSON.stringify(stats)}`);
}
await pool.end();
