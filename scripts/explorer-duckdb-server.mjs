#!/usr/bin/env node
// Abfrage-Dienst fuer den TFT-Data-Explorer.
//
// Liest die naechtlich gebaute DuckDB-Datei (scripts/build-explorer-store.mjs)
// nur lesend und beantwortet POST /explore mit Kopfzahlen, Platz-Verteilung und
// einer Tabelle je Reiter. Lauscht nur auf 127.0.0.1 — von aussen kommt man
// ausschliesslich ueber refresh-api-server.mjs (/explore), das den Token prueft.
//
// Datei-Tausch: der Build ersetzt die Datei per rename. Wir pruefen alle 60 s
// die Inode; bei einer neuen oeffnen wir die neue Datei, waermen sie mit einer
// Abfrage an und tauschen erst dann. Die alte Instanz wird geschlossen, sobald
// keine Abfrage sie mehr haelt (Referenzzaehler).
//
// Last: hoechstens 2 Abfragen gleichzeitig, bis zu 8 warten, danach 503.
// Jede Abfrage wird nach QUERY_TIMEOUT_MS abgebrochen.
//
// Vertrauensbereich: Mehrere unserer Spieler sitzen in derselben Partie (im
// Schnitt ~2,5 je Lobby), ihre Platzierungen sind also nicht unabhaengig. Die
// Fehlerrechnung laeuft deshalb ueber Partien als Klumpen (cluster-robust),
// siehe rowStats().

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.EXPLORER_DB_PATH || '/mnt/HC_Volume_105869432/explorer/explorer.duckdb';
const PORT = Number(process.env.EXPLORER_PORT || 4110);
const DUCKDB_MODULE = process.env.EXPLORER_DUCKDB_MODULE
  || '/opt/metastats-explorer/node_modules/@duckdb/node-api/lib/index.js';
const MAX_RUNNING = 2;
const MAX_QUEUE = 8;
const QUERY_TIMEOUT_MS = Number(process.env.EXPLORER_QUERY_TIMEOUT_MS || 15_000);
const POLL_MS = 60_000;
const CACHE_MAX = 400;
const ROW_LIMIT = 500;
const ROW_MIN_BOARDS = 5;

const { DuckDBInstance } = await import(DUCKDB_MODULE);

function log(...a) { console.log(`[explorer-api ${new Date().toISOString()}]`, ...a); }

// ─── Instanz + Tausch ──────────────────────────────────────────────────────

let current = null; // { instance, ino, refs, retired, meta, components }

async function openStore() {
  const st = fs.statSync(DB_PATH);
  const instance = await DuckDBInstance.create(DB_PATH, {
    access_mode: 'READ_ONLY',
    threads: '2',
    memory_limit: '1GB',
    temp_directory: path.join(path.dirname(DB_PATH), 'tmp-api'),
  });
  const holder = { instance, ino: st.ino, refs: 0, retired: false, meta: null, components: [] };
  const conn = await instance.connect();
  try {
    const m = (await conn.runAndReadAll(
      `SELECT CAST(built_at AS VARCHAR) AS built_at, set_number, days,
              CAST(min_day AS VARCHAR) AS min_day, CAST(max_day AS VARCHAR) AS max_day,
              boards::DOUBLE AS boards, matches::DOUBLE AS matches
       FROM meta`)).getRowObjectsJS()[0];
    const patches = (await conn.runAndReadAll(
      `SELECT patch, count(*)::DOUBLE AS boards, CAST(min(day) AS VARCHAR) AS d_from, CAST(max(day) AS VARCHAR) AS d_to
       FROM boards WHERE patch IS NOT NULL GROUP BY patch ORDER BY min(day) DESC`)).getRowObjectsJS();
    const regions = (await conn.runAndReadAll(
      `SELECT region, count(*)::DOUBLE AS boards FROM boards GROUP BY region ORDER BY boards DESC`)).getRowObjectsJS();
    const ranks = (await conn.runAndReadAll(
      `SELECT coalesce(rank, 'unknown') AS rank, count(*)::DOUBLE AS boards FROM boards GROUP BY 1 ORDER BY boards DESC`)).getRowObjectsJS();
    // Anwaermen: eine typische Gruppierung, damit die erste echte Anfrage
    // nicht die Spalten von der Platte holen muss.
    await conn.runAndReadAll(`SELECT unit, count(*) FROM units GROUP BY unit`);
    holder.meta = {
      // DuckDB liefert "2026-09-28 19:43:25.07+00" — Safari/Firefox lesen das nicht.
      builtAt: new Date(String(m.built_at).replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toISOString(), setNumber: Number(m.set_number), days: Number(m.days),
      minDay: m.min_day, maxDay: m.max_day, boards: m.boards, matches: m.matches,
      patches, regions, ranks,
    };
  } finally {
    conn.closeSync?.();
  }
  holder.components = readComponents(holder.meta.setNumber);
  return holder;
}

// Komponenten (Schwert, Bogen …) fliegen aus Item-Paaren und -Trios. Welche
// das sind, steht im Bundle: alles, was in der Rezeptur eines aktiven
// Items vorkommt. Gemessen fuer Set 18: 10 Stueck (DA_Component_*).
function readComponents(setNumber) {
  try {
    const a = JSON.parse(fs.readFileSync(path.join(process.cwd(), `public/tft-assets-${setNumber}.json`), 'utf8'));
    const active = new Set(a.active?.items || []);
    const comp = new Set();
    for (const id of active) {
      const c = a.items?.[id]?.composition;
      if (Array.isArray(c) && c.length === 2) c.forEach(x => comp.add(x));
    }
    if (comp.size === 0) log(`WARNUNG: keine Komponenten im Bundle fuer Set ${setNumber}`);
    return [...comp];
  } catch (err) {
    log(`WARNUNG: Bundle fuer Set ${setNumber} nicht lesbar (${err.message}) — Paare enthalten Komponenten`);
    return [];
  }
}

function release(holder) {
  holder.refs--;
  if (holder.retired && holder.refs === 0) closeHolder(holder);
}

function closeHolder(holder) {
  try { holder.instance.closeSync?.(); } catch (err) { log('Schliessen fehlgeschlagen:', err.message); }
  log(`alte Datei (Inode ${holder.ino}) geschlossen`);
}

let swapping = false;
async function pollSwap() {
  if (swapping) return;
  let st;
  try { st = fs.statSync(DB_PATH); } catch { return; }
  if (current && st.ino === current.ino) return;
  swapping = true;
  try {
    const next = await openStore();
    const prev = current;
    current = next;
    cache.clear();
    log(`Datei geladen: Stand ${next.meta.builtAt}, ${next.meta.boards} Boards, Inode ${next.ino}`);
    if (prev) {
      prev.retired = true;
      if (prev.refs === 0) closeHolder(prev);
    }
    warmUp(next).catch(err => log('Vorwaermen abgebrochen:', err.message));
  } catch (err) {
    log('Laden fehlgeschlagen, alte Datei bleibt:', err.message);
  } finally {
    swapping = false;
  }
}

// ─── Warteschlange ─────────────────────────────────────────────────────────

let running = 0;
const queue = [];

function acquireSlot() {
  if (running < MAX_RUNNING) { running++; return Promise.resolve(); }
  if (queue.length >= MAX_QUEUE) {
    const e = new Error('busy'); e.status = 503; throw e;
  }
  return new Promise(resolve => queue.push(resolve));
}
function releaseSlot() {
  const next = queue.shift();
  if (next) next(); else running--;
}

// ─── Eingaben pruefen ──────────────────────────────────────────────────────

const ID_RE = /^[A-Za-z0-9_]{1,64}$/;
const REGION_RE = /^[a-z0-9]{2,5}$/;
const PATCH_RE = /^\d{1,2}\.\d{1,2}[a-z]?$/;
const RANKS = ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND', 'unknown'];
const TABS = ['summary', 'units', 'items', 'traits', 'comps', 'level', 'round', 'gold', 'region', 'rank'];

function bad(msg) { const e = new Error(msg); e.status = 400; return e; }
const id = (v, what) => { if (typeof v !== 'string' || !ID_RE.test(v)) throw bad(`invalid_${what}`); return v; };
const ids = (v, what, max) => {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max) throw bad(`invalid_${what}`);
  return [...new Set(v.map(x => id(x, what)))].sort();
};
const int = (v, lo, hi, what) => {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw bad(`invalid_${what}`);
  return n;
};

// Liefert eine kanonische Form: gleiche Anfrage → gleicher Cache-Schluessel.
export function normalizeQuery(q) {
  if (!q || typeof q !== 'object') throw bad('invalid_body');
  const region = q.region == null || q.region === 'all' ? 'all'
    : (typeof q.region === 'string' && REGION_RE.test(q.region) ? q.region : (() => { throw bad('invalid_region'); })());
  const ranks = q.ranks == null ? [] : (Array.isArray(q.ranks) && q.ranks.every(r => RANKS.includes(r))
    ? [...new Set(q.ranks)].sort() : (() => { throw bad('invalid_ranks'); })());
  // ['latest'] = neuester Patch im Speicher; wird im Handler aufgeloest.
  const patches = q.patches == null ? [] : Array.isArray(q.patches) && q.patches.length === 1 && q.patches[0] === 'latest' ? ['latest']
    : (Array.isArray(q.patches) && q.patches.length <= 12 && q.patches.every(p => typeof p === 'string' && PATCH_RE.test(p))
    ? [...new Set(q.patches)].sort() : (() => { throw bad('invalid_patches'); })());
  const units = (Array.isArray(q.units) ? q.units : []).slice(0, 9);
  if (Array.isArray(q.units) && q.units.length > 9) throw bad('too_many_units');
  const nUnits = units.map(u => ({
    id: id(u?.id, 'unit'),
    x: u?.x === true,
    s: int(u?.s, 1, 4, 'star'),
    se: u?.se === true,
    n: int(u?.n, 0, 3, 'item_count'),
    it: ids(u?.it, 'item', 3),
    nit: ids(u?.nit, 'item', 3),
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (Array.isArray(q.items) && q.items.length > 6) throw bad('too_many_items');
  const nItems = (Array.isArray(q.items) ? q.items : []).map(i => ({ id: id(i?.id, 'item'), x: i?.x === true }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (Array.isArray(q.traits) && q.traits.length > 6) throw bad('too_many_traits');
  const nTraits = (Array.isArray(q.traits) ? q.traits : []).map(t => ({
    id: id(t?.id, 'trait'), x: t?.x === true, l: int(t?.l, 1, 6, 'trait_level'), le: t?.le === true,
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const tab = q.tab == null ? 'summary' : (TABS.includes(q.tab) ? q.tab : (() => { throw bad('invalid_tab'); })());
  const focus = q.focus == null ? null : id(q.focus, 'focus');
  const split = q.split === 'star' || q.split === 'over' ? q.split : null;
  const combo = int(q.combo, 1, 3, 'combo') ?? 1;
  return { region, ranks, patches, units: nUnits, items: nItems, traits: nTraits, tab, focus, split, combo };
}

// ─── SQL bauen ─────────────────────────────────────────────────────────────

// Grundmenge: nur Region / Rang / Patch.
function scopeWhere(q, params) {
  const w = [];
  if (q.region !== 'all') { w.push('b.region = ?'); params.push(q.region); }
  if (q.ranks.length) {
    const named = q.ranks.filter(r => r !== 'unknown');
    const parts = [];
    if (named.length) { parts.push(`b.rank IN (${named.map(() => '?').join(',')})`); params.push(...named); }
    if (q.ranks.includes('unknown')) parts.push('b.rank IS NULL');
    w.push(`(${parts.join(' OR ')})`);
  }
  if (q.patches.length) { w.push(`b.patch IN (${q.patches.map(() => '?').join(',')})`); params.push(...q.patches); }
  return w;
}

function unitCond(u, params) {
  const c = ['unit = ?']; params.push(u.id);
  if (u.s != null) { c.push(u.se ? 'star = ?' : 'star >= ?'); params.push(u.s); }
  if (u.n != null) { c.push('n_items >= ?'); params.push(u.n); }
  for (const it of u.it) { c.push('list_contains([i1, i2, i3], ?)'); params.push(it); }
  for (const it of u.nit) { c.push('NOT list_contains([i1, i2, i3], ?)'); params.push(it); }
  return `SELECT bid FROM units WHERE ${c.join(' AND ')}`;
}

function filterWhere(q, params) {
  const w = [];
  for (const u of q.units) w.push(`b.bid ${u.x ? 'NOT IN' : 'IN'} (${unitCond(u, params)})`);
  for (const i of q.items) {
    w.push(`b.bid ${i.x ? 'NOT IN' : 'IN'} (SELECT bid FROM units WHERE list_contains([i1, i2, i3], ?))`);
    params.push(i.id);
  }
  for (const t of q.traits) {
    const c = ['trait = ?']; params.push(t.id);
    if (!t.x && t.l != null) { c.push(t.le ? 'lvl = ?' : 'lvl >= ?'); params.push(t.l); }
    w.push(`b.bid ${t.x ? 'NOT IN' : 'IN'} (SELECT bid FROM traits WHERE ${c.join(' AND ')})`);
  }
  return w;
}

function fbCte(q, params, { withFilters = true } = {}) {
  const w = scopeWhere(q, params);
  if (withFilters) w.push(...filterWhere(q, params));
  return `fb AS (SELECT b.* FROM boards b${w.length ? ` WHERE ${w.join(' AND ')}` : ''})`;
}

// Kopfzahlen einer Menge: Summen je Partie fuer die Fehlerrechnung plus
// Platz-Verteilung.
async function setStats(conn, cteSql, params, from = 'fb') {
  const r = (await conn.runAndReadAll(`
    WITH ${cteSql},
    cl AS (SELECT mid, count(*) AS n, sum(placement) AS s FROM ${from} GROUP BY mid)
    SELECT count(*)::DOUBLE AS matches, coalesce(sum(n), 0)::DOUBLE AS n, coalesce(sum(s), 0)::DOUBLE AS s,
           coalesce(sum(s * s), 0)::DOUBLE AS ss, coalesce(sum(s * n), 0)::DOUBLE AS sn, coalesce(sum(n * n), 0)::DOUBLE AS nn
    FROM cl`, params)).getRowObjectsJS()[0];
  const hist = (await conn.runAndReadAll(`
    WITH ${cteSql}
    SELECT placement::INTEGER AS p, count(*)::DOUBLE AS c FROM ${from} GROUP BY 1 ORDER BY 1`, params)).getRowObjectsJS();
  const h = Array(8).fill(0);
  for (const x of hist) if (x.p >= 1 && x.p <= 8) h[x.p - 1] = x.c;
  return { ...r, hist: h };
}

// Schluessel je Reiter: liefert Zeilen (bid, mid, placement, key, sub, sub2)
// aus der Referenzmenge `ref`. DISTINCT, weil eine Unit doppelt auf dem
// Board stehen kann.
function keySql(q, params, components) {
  switch (q.tab) {
    case 'units':
      return q.split === 'star'
        ? `SELECT DISTINCT r.bid, r.mid, r.placement, u.unit AS key, u.star::INTEGER AS sub, NULL::INTEGER AS sub2 FROM ref r JOIN units u USING (bid)`
        : `SELECT DISTINCT r.bid, r.mid, r.placement, u.unit AS key, NULL::INTEGER AS sub, NULL::INTEGER AS sub2 FROM ref r JOIN units u USING (bid)`;
    case 'items': {
      if (!q.focus) {
        return `SELECT DISTINCT bid, mid, placement, item AS key, NULL::INTEGER AS sub, NULL::INTEGER AS sub2 FROM (
                  SELECT r.bid, r.mid, r.placement, unnest([u.i1, u.i2, u.i3]) AS item FROM ref r JOIN units u USING (bid))
                WHERE item IS NOT NULL`;
      }
      // Komponenten stammen aus dem Bundle und sind per ID_RE geprueft,
      // deshalb als Literal statt als Listen-Parameter.
      const compList = `[${components.filter(c => ID_RE.test(c)).map(c => `'${c}'`).join(', ')}]::VARCHAR[]`;
      const its = `list_sort(list_filter([u.i1, u.i2, u.i3], x -> x IS NOT NULL AND NOT list_contains(${compList}, x)))`;
      const base = `SELECT r.bid, r.mid, r.placement, ${its} AS its FROM ref r JOIN units u USING (bid) WHERE u.unit = ?`;
      params.push(q.focus);
      if (q.combo === 1) {
        return `SELECT DISTINCT bid, mid, placement, key, NULL::INTEGER AS sub, NULL::INTEGER AS sub2 FROM (
                  SELECT bid, mid, placement, unnest(its) AS key FROM (${base}))`;
      }
      if (q.combo === 2) {
        return `SELECT DISTINCT bid, mid, placement, key, NULL::INTEGER AS sub, NULL::INTEGER AS sub2 FROM (
                  SELECT bid, mid, placement, unnest(CASE
                    WHEN len(its) = 2 THEN [its[1] || '|' || its[2]]
                    WHEN len(its) = 3 THEN [its[1] || '|' || its[2], its[1] || '|' || its[3], its[2] || '|' || its[3]]
                    ELSE []::VARCHAR[] END) AS key FROM (${base}))`;
      }
      return `SELECT DISTINCT bid, mid, placement, its[1] || '|' || its[2] || '|' || its[3] AS key, NULL::INTEGER AS sub, NULL::INTEGER AS sub2
              FROM (${base}) WHERE len(its) = 3`;
    }
    case 'traits':
      return q.split === 'over'
        ? `SELECT DISTINCT r.bid, r.mid, r.placement, t.trait AS key, t.lvl::INTEGER AS sub, t.overcap::INTEGER AS sub2 FROM ref r JOIN traits t USING (bid)`
        : `SELECT DISTINCT r.bid, r.mid, r.placement, t.trait AS key, t.lvl::INTEGER AS sub, NULL::INTEGER AS sub2 FROM ref r JOIN traits t USING (bid)`;
    case 'comps':
      return `SELECT bid, mid, placement, family AS key, NULL::INTEGER AS sub, NULL::INTEGER AS sub2 FROM ref WHERE family IS NOT NULL`;
    case 'level':
      return `SELECT bid, mid, placement, CAST(level AS VARCHAR) AS key, NULL::INTEGER AS sub, NULL::INTEGER AS sub2 FROM ref`;
    case 'round':
      return `SELECT bid, mid, placement, CAST(last_round AS VARCHAR) AS key, NULL::INTEGER AS sub, NULL::INTEGER AS sub2 FROM ref`;
    case 'gold':
      return `SELECT bid, mid, placement, CASE
                WHEN gold_left <= 0 THEN '0' WHEN gold_left < 10 THEN '1-9' WHEN gold_left < 20 THEN '10-19'
                WHEN gold_left < 30 THEN '20-29' WHEN gold_left < 50 THEN '30-49' ELSE '50+' END AS key,
              NULL::INTEGER AS sub, NULL::INTEGER AS sub2 FROM ref`;
    case 'region':
      return `SELECT bid, mid, placement, region AS key, NULL::INTEGER AS sub, NULL::INTEGER AS sub2 FROM ref`;
    case 'rank':
      return `SELECT bid, mid, placement, coalesce(rank, 'unknown') AS key, NULL::INTEGER AS sub, NULL::INTEGER AS sub2 FROM ref`;
    default:
      throw bad('invalid_tab');
  }
}

// Kennzahlen je Zeile. Referenzmenge R (gefilterte Boards; im Item-Reiter mit
// Traeger nur Boards mit dieser Unit), Zeile = Teilmenge "mit", Rest "ohne".
//
// Fehlerrechnung ueber Partien als Klumpen: Fuer jede Partie g sei n/S Anzahl
// und Platzsumme in R, n1/S1 dasselbe in der Zeile. Die Abweichung
// m1 − m0 hat die Varianz Σ_g z_g² mit z_g = (S1−m1·n1)/N1 − (S0−m0·n0)/N0.
// Ausmultipliziert braucht das nur Summen ueber die Partien, in denen die
// Zeile vorkommt, plus drei Summen ueber ganz R (ref.ss/sn/nn).
function rowStats(r, ref) {
  const N1 = r.n1, S1 = r.s1;
  const m1 = S1 / N1;
  const sumE2 = r.ss11 - 2 * m1 * r.sn11 + m1 * m1 * r.nn11;
  const seWith = Math.sqrt(Math.max(0, sumE2)) / N1;
  const out = {
    games: N1, matches: r.m1, avg: m1, top4: r.t4 / N1, top1: r.t1 / N1, half: 1.96 * seWith,
    dOut: null, dOutHalf: null, dBase: null, dBaseHalf: null,
  };
  const N0 = ref.n - N1;
  if (N0 > 0) {
    const m0 = (ref.s - S1) / N0;
    const sumED = r.s1S - m0 * r.s1N - m1 * r.n1S + m1 * m0 * r.n1N;
    const sumEF = r.ss11 - (m0 + m1) * r.sn11 + m1 * m0 * r.nn11;
    const sumF2 = r.ss11 - 2 * m0 * r.sn11 + m0 * m0 * r.nn11;
    const sumDF = r.s1S - m0 * r.n1S - m0 * r.s1N + m0 * m0 * r.n1N;
    const dAll = ref.ss - 2 * m0 * ref.sn + m0 * m0 * ref.nn;
    const v = sumE2 / (N1 * N1) - 2 * (sumED - sumEF) / (N1 * N0) + (sumF2 - 2 * sumDF + dAll) / (N0 * N0);
    out.dOut = m1 - m0;
    out.dOutHalf = 1.96 * Math.sqrt(Math.max(0, v));
    out.top4Out = out.top4 - (ref.t4 - r.t4) / N0;
  }
  if (ref.n > 0) {
    const m = ref.s / ref.n;
    const sumED = r.s1S - m * r.s1N - m1 * r.n1S + m1 * m * r.n1N;
    const dAll = ref.ss - 2 * m * ref.sn + m * m * ref.nn;
    const v = sumE2 / (N1 * N1) - 2 * sumED / (N1 * ref.n) + dAll / (ref.n * ref.n);
    out.dBase = m1 - m;
    out.dBaseHalf = 1.96 * Math.sqrt(Math.max(0, v));
    out.top4Base = out.top4 - ref.t4 / ref.n;
  }
  return out;
}

function summarize(s) {
  const n = s.n;
  if (!n) return { games: 0, matches: 0, avg: null, top4: null, top1: null, half: null, hist: s.hist };
  const m = s.s / n;
  const sumE2 = s.ss - 2 * m * s.sn + m * m * s.nn;
  const t4 = s.hist.slice(0, 4).reduce((a, b) => a + b, 0);
  return {
    games: n, matches: s.matches, avg: m, top4: t4 / n, top1: s.hist[0] / n,
    half: 1.96 * Math.sqrt(Math.max(0, sumE2)) / n, hist: s.hist,
  };
}

// ─── Abfrage ───────────────────────────────────────────────────────────────

async function runQuery(holder, q) {
  const conn = await holder.instance.connect();
  const timer = setTimeout(() => { try { conn.interrupt(); } catch { /* bereits fertig */ } }, QUERY_TIMEOUT_MS);
  try {
    const hasFilters = q.units.length + q.items.length + q.traits.length > 0;

    const pF = []; const cteF = fbCte(q, pF);
    const filtered = await setStats(conn, cteF, pF);

    let base = filtered;
    if (hasFilters) {
      const pB = []; const cteB = fbCte(q, pB, { withFilters: false });
      base = await setStats(conn, cteB, pB);
    }

    // Kopfzeile: gefiltert gegen den Rest der Grundmenge (disjunkt) — gleiche
    // Rechnung wie je Zeile, mit "Zeile" = gefilterte Boards.
    let headDelta = null;
    if (hasFilters && filtered.n > 0) {
      const p = [];
      const cteB = fbCte(q, p, { withFilters: false });
      const fw = filterWhere(q, p);
      const r = (await conn.runAndReadAll(`
        WITH ${cteB},
        cl AS (SELECT mid, count(*) AS n, sum(placement) AS s FROM fb GROUP BY mid),
        kg AS (SELECT mid, count(*) AS n1, sum(placement) AS s1 FROM fb b WHERE ${fw.join(' AND ')} GROUP BY mid)
        SELECT sum(s1 * cl.s)::DOUBLE AS "s1S", sum(s1 * cl.n)::DOUBLE AS "s1N",
               sum(n1 * cl.s)::DOUBLE AS "n1S", sum(n1 * cl.n)::DOUBLE AS "n1N"
        FROM kg JOIN cl USING (mid)`, p)).getRowObjectsJS()[0];
      const row = {
        n1: filtered.n, s1: filtered.s, m1: filtered.matches, ss11: filtered.ss, sn11: filtered.sn, nn11: filtered.nn,
        s1S: r.s1S, s1N: r.s1N, n1S: r.n1S, n1N: r.n1N,
        t4: filtered.hist.slice(0, 4).reduce((a, b) => a + b, 0), t1: filtered.hist[0],
      };
      const ref = { ...base, t4: base.hist.slice(0, 4).reduce((a, b) => a + b, 0) };
      headDelta = rowStats(row, ref);
    }

    const out = {
      summary: summarize(filtered),
      base: summarize(base),
      headDelta: headDelta && { dOut: headDelta.dOut, dOutHalf: headDelta.dOutHalf, dBase: headDelta.dBase, dBaseHalf: headDelta.dBaseHalf },
      rows: null,
      refGames: null,
    };

    if (q.tab !== 'summary' && filtered.n > 0) {
      const p = [];
      const cte = fbCte(q, p);
      let refCte = 'ref AS (SELECT * FROM fb)';
      let ref = filtered;
      if (q.tab === 'items' && q.focus) {
        refCte = 'ref AS (SELECT * FROM fb WHERE bid IN (SELECT bid FROM units WHERE unit = ?))';
        p.push(q.focus);
        const pr = [...p];
        ref = await setStats(conn, `${cte}, ${refCte}`, pr, 'ref');
      }
      const ks = keySql(q, p, holder.components);
      p.push(ROW_MIN_BOARDS, ROW_LIMIT);
      const rows = ref.n === 0 ? [] : (await conn.runAndReadAll(`
        WITH ${cte}, ${refCte},
        cl AS (SELECT mid, count(*) AS n, sum(placement) AS s FROM ref GROUP BY mid),
        k AS (${ks}),
        kg AS (SELECT key, sub, sub2, mid, count(*) AS n1, sum(placement) AS s1,
                      count(*) FILTER (WHERE placement <= 4) AS t4, count(*) FILTER (WHERE placement = 1) AS t1
               FROM k GROUP BY key, sub, sub2, mid)
        SELECT key, sub, sub2, count(*)::DOUBLE AS m1, sum(n1)::DOUBLE AS n1, sum(s1)::DOUBLE AS s1,
               sum(t4)::DOUBLE AS t4, sum(t1)::DOUBLE AS t1,
               sum(s1 * s1)::DOUBLE AS ss11, sum(s1 * n1)::DOUBLE AS sn11, sum(n1 * n1)::DOUBLE AS nn11,
               sum(s1 * cl.s)::DOUBLE AS "s1S", sum(s1 * cl.n)::DOUBLE AS "s1N",
               sum(n1 * cl.s)::DOUBLE AS "n1S", sum(n1 * cl.n)::DOUBLE AS "n1N"
        FROM kg JOIN cl USING (mid)
        GROUP BY key, sub, sub2
        HAVING sum(n1) >= ?
        ORDER BY n1 DESC
        LIMIT ?`, p)).getRowObjectsJS();
      const refT = { ...ref, t4: ref.hist.slice(0, 4).reduce((a, b) => a + b, 0) };
      out.refGames = ref.n;
      out.rows = rows.map(r => ({ key: r.key, sub: r.sub, sub2: r.sub2, ...rowStats(r, refT) }));
    } else if (q.tab !== 'summary') {
      out.rows = [];
      out.refGames = 0;
    }
    return out;
  } finally {
    clearTimeout(timer);
    conn.closeSync?.();
  }
}

// ─── Cache ─────────────────────────────────────────────────────────────────

const cache = new Map();
function cacheGet(k) {
  const v = cache.get(k);
  if (v !== undefined) { cache.delete(k); cache.set(k, v); }
  return v;
}
function cacheSet(k, v) {
  cache.set(k, v);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// ─── HTTP ──────────────────────────────────────────────────────────────────

function send(res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 65_536) reject(bad('body_too_large')); });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    return send(res, current ? 200 : 503, { ok: !!current, meta: current?.meta ?? null, running, queued: queue.length });
  }
  if (req.method !== 'POST' || req.url !== '/explore') return send(res, 404, { error: 'not_found' });
  if (!current) return send(res, 503, { error: 'explorer_unavailable' });

  let q;
  try {
    q = normalizeQuery(JSON.parse(await readBody(req) || '{}'));
  } catch (err) {
    return send(res, err.status || 400, { error: err.status ? err.message : 'invalid_json' });
  }

  const holder = current;
  resolveLatest(holder, q);
  const headers = { 'X-Explorer-Built-At': holder.meta.builtAt };
  const key = cacheKey(holder, q);
  const hit = cacheGet(key);
  if (hit) return send(res, 200, { meta: holder.meta, query: q, ...hit, cached: true }, headers);

  try {
    await acquireSlot();
  } catch (err) {
    return send(res, 503, { error: 'busy' }, { 'Retry-After': '5' });
  }
  const t0 = Date.now();
  try {
    const result = await execute(holder, q, key);
    send(res, 200, { meta: holder.meta, query: q, ...result, cached: false }, headers);
  } catch (err) {
    const interrupted = /interrupt/i.test(err.message || '');
    log(`Fehler (${Date.now() - t0} ms): ${err.message} bei ${JSON.stringify(q)}`);
    send(res, interrupted ? 504 : (err.status || 500), { error: interrupted ? 'timeout' : (err.status ? err.message : 'internal') });
  } finally {
    releaseSlot();
  }
});

function resolveLatest(holder, q) {
  if (q.patches[0] === 'latest') q.patches = holder.meta.patches[0] ? [holder.meta.patches[0].patch] : [];
}
function cacheKey(holder, q) { return `${holder.ino}|${JSON.stringify(q)}`; }

// Laeuft mit belegtem Slot; der Aufrufer gibt ihn frei.
async function execute(holder, q, key) {
  holder.refs++;
  const t0 = Date.now();
  try {
    const result = await runQuery(holder, q);
    result.ms = Date.now() - t0;
    cacheSet(key, result);
    if (result.ms > 3000) log(`langsam ${result.ms} ms: ${JSON.stringify(q)}`);
    return result;
  } finally {
    release(holder);
  }
}

// Nach jedem Laden die Startansichten (alle Reiter ohne Filter, neuester
// Patch) einmal rechnen, damit der erste Besucher nicht 2-3 s wartet. Nimmt
// immer nur einen Slot, der zweite bleibt fuer echte Anfragen frei.
async function warmUp(holder) {
  const t0 = Date.now();
  let n = 0;
  for (const tab of TABS.filter(x => x !== 'summary')) {
    if (current !== holder) return;
    const q = normalizeQuery({ tab, patches: ['latest'] });
    resolveLatest(holder, q);
    const key = cacheKey(holder, q);
    if (cacheGet(key)) continue;
    try { await acquireSlot(); } catch { continue; }
    try { await execute(holder, q, key); n++; } catch (err) { log(`Vorwaermen ${tab} fehlgeschlagen: ${err.message}`); } finally { releaseSlot(); }
  }
  log(`vorgewaermt: ${n} Startansichten in ${Date.now() - t0} ms`);
}

fs.mkdirSync(path.join(path.dirname(DB_PATH), 'tmp-api'), { recursive: true });
await pollSwap();
if (!current) log(`WARNUNG: ${DB_PATH} nicht ladbar — Dienst antwortet 503, bis eine Datei da ist`);
setInterval(pollSwap, POLL_MS).unref();
server.listen(PORT, '127.0.0.1', () => log(`lauscht auf 127.0.0.1:${PORT}`));
