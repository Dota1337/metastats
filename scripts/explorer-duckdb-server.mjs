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
// Last (Live-Spur): hoechstens 2 Abfragen gleichzeitig, bis zu 8 warten, danach 503.
// Besucher-Abfragen werden nach QUERY_TIMEOUT_MS abgebrochen. Laeuft dieselbe
// Ansicht schon, wartet eine weitere Anfrage auf diese Rechnung (hoechstens
// WAIT_MS, unter der 20-s-Grenze von refresh-api), statt doppelt zu rechnen.
//
// Tages-Teilsummen (Paket 5b): Ansichten ohne Board-Filter (kein Rang, keine
// Unit/Item/Trait, kein Fokus) summiert der Dienst aus agg_rows/agg_head, die
// der Bau je Tag, Patch und Region schreibt — fuer jeden Patch und jede
// Region, bitgleich zur Live-Rechnung. Eigene Spur (4 laufend, 16 wartend,
// AGG_TIMEOUT_MS), damit diese Ansichten nie hinter 15-s-Abfragen warten.
// Genommen nur, wenn die Summen zu dieser Datei gehoeren (loadAgg) und alle
// Tage der Patch-Wahl gedeckt sind; sonst und bei jedem Fehler live.
// EXPLORER_AGG=0 schaltet den Weg ab. Antwort-Kopf X-Explorer-Source: agg|live.
//
// Startansichten (alle Reiter ohne Filter, neuester Patch) rechnet der Dienst
// nach jedem Laden selbst, mit der eigenen Grenze WARM_TIMEOUT_MS: live
// brauchen units, traits und items gemessen 70-120 s und scheiterten an den
// 15 s bei jedem Laden. Sie liegen je Datei in einer eigenen Ablage, die der
// Zwischenspeicher nicht verdraengt; nach einem Tausch faengt die neue Datei
// leer an.
//
// Vertrauensbereich: Mehrere unserer Spieler sitzen in derselben Partie (im
// Schnitt ~2,5 je Lobby), ihre Platzierungen sind also nicht unabhaengig. Die
// Fehlerrechnung laeuft deshalb ueber Partien als Klumpen (cluster-robust),
// siehe rowStats().

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { readComponents as readComponentsFrom, componentsHash } from './lib/explorer-components.mjs';
import { AGG_SIG, aggEligible, aggDaysFor } from './lib/explorer-agg.mjs';
import { AGG_SUM_COLS, AGG_HEAD_COLS } from './lib/explorer-agg-build.mjs';
import { ROW_LIMIT, ROW_MIN_BOARDS, ROW_ORDER, bad, summarize, runQuery, finishRows } from './lib/explorer-query.mjs';

const DB_PATH = process.env.EXPLORER_DB_PATH || '/mnt/HC_Volume_105869432/explorer/explorer.duckdb';
const PORT = Number(process.env.EXPLORER_PORT || 4110);
const DUCKDB_MODULE = process.env.EXPLORER_DUCKDB_MODULE
  || '/opt/metastats-explorer/node_modules/@duckdb/node-api/lib/index.js';
const MAX_RUNNING = 2;
const MAX_QUEUE = 8;
const WARM_TIMEOUT_MS = Number(process.env.EXPLORER_WARM_TIMEOUT_MS || 300_000);
const WAIT_MS = 18_000;
const WARM_RETRY_PAUSE_MS = 60_000;
const POLL_MS = 60_000;
const CACHE_MAX = 400;
const AGG_ON = process.env.EXPLORER_AGG !== '0';
const AGG_RUNNING = 4;
const AGG_QUEUE = 16;
const AGG_TIMEOUT_MS = Number(process.env.EXPLORER_AGG_TIMEOUT_MS || 2000);
const AGG_WARM_TIMEOUT_MS = 30_000;

const { DuckDBInstance } = await import(DUCKDB_MODULE);

function log(...a) { console.log(`[explorer-api ${new Date().toISOString()}]`, ...a); }

// ─── Instanz + Tausch ──────────────────────────────────────────────────────

let current = null; // { instance, ino, refs, retired, meta, components, compHash, agg, pinned, warmConn }

async function openStore() {
  const st = fs.statSync(DB_PATH);
  const instance = await DuckDBInstance.create(DB_PATH, {
    access_mode: 'READ_ONLY',
    threads: '2',
    memory_limit: '1GB',
    temp_directory: path.join(path.dirname(DB_PATH), 'tmp-api'),
  });
  const holder = {
    instance, ino: st.ino, refs: 0, retired: false, meta: null, components: [], compHash: null, agg: null,
    pinned: new Map(), warmConn: null,
  };
  const conn = await instance.connect();
  try {
    holder.agg = AGG_ON ? await loadAgg(conn) : null;
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
    // nicht die Spalten von der Platte holen muss — mit Teilsummen deren
    // Tabelle, aus der die Startansichten dann kommen.
    await conn.runAndReadAll(holder.agg
      ? `SELECT variant, sum(n1) FROM agg_rows GROUP BY variant`
      : `SELECT unit, count(*) FROM units GROUP BY unit`);
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
  holder.compHash = componentsHash(holder.components);
  return holder;
}

// Teilsummen nur, wenn sie zu genau dieser Datei gehoeren: gleiche
// Definition (AGG_SIG), Kennung = meta.agg_token, gerechnet bis zum Stand
// dieser Datei (base_next_bid = meta.next_bid). Sonst live, nie halb.
async function loadAgg(conn) {
  try {
    const am = (await conn.runAndReadAll(
      `SELECT sig, token, base_next_bid::DOUBLE AS base, comp_hash FROM agg_meta`)).getRowObjectsJS();
    const mm = (await conn.runAndReadAll(
      `SELECT agg_token, next_bid::DOUBLE AS next_bid FROM meta`)).getRowObjectsJS();
    const a = am[0];
    const why = am.length !== 1 ? `${am.length} Kennungen`
      : a.sig !== AGG_SIG ? 'andere Definition'
      : !a.token ? 'ohne Kennung'
      : mm.length !== 1 || a.token !== mm[0].agg_token ? 'Kennung passt nicht zur Datei'
      : a.base == null || a.base !== mm[0].next_bid ? 'anderer Stand'
      : null;
    if (why) { log(`Teilsummen unbenutzt (${why}), rechne live`); return null; }
    const covered = new Set((await conn.runAndReadAll(
      `SELECT CAST(day AS VARCHAR) AS day FROM agg_days`)).getRowObjectsJS().map(r => r.day));
    const dayPatches = (await conn.runAndReadAll(
      `SELECT CAST(day AS VARCHAR) AS day, patch FROM day_patches`)).getRowObjectsJS();
    const total = new Set(dayPatches.map(r => r.day)).size;
    return { covered, dayPatches, compHash: a.comp_hash, total, coveredDays: covered.size };
  } catch (err) {
    log(`Teilsummen nicht lesbar, rechne live: ${err.message}`);
    return null;
  }
}

// Komponenten (Schwert, Bogen …) fliegen aus Item-Paaren und -Trios. Welche
// das sind, steht im Bundle: alles, was in der Rezeptur eines aktiven
// Items vorkommt. Gemessen fuer Set 18: 10 Stueck (DA_Component_*).
// Liste und Hash kommen aus scripts/lib/explorer-components.mjs, die auch der
// Bau fuer die Tages-Teilsummen nutzt.
function readComponents(setNumber) {
  return readComponentsFrom(process.cwd(), setNumber, log);
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
    log(`Datei geladen: Stand ${next.meta.builtAt}, ${next.meta.boards} Boards, Inode ${next.ino}, `
      + `Teilsummen ${next.agg ? `${next.agg.coveredDays}/${next.agg.total} Tage` : (AGG_ON ? 'keine' : 'aus')}`);
    if (prev) {
      prev.retired = true;
      // Laufendes Vorwaermen der alten Datei abbrechen, sonst haelt es bis zu
      // WARM_TIMEOUT_MS einen Platz fuer Zahlen, die niemand mehr abruft.
      try { prev.warmConn?.interrupt(); } catch { /* bereits fertig */ }
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

// Zwei Spuren: live (2 laufend, 8 wartend) und Teilsummen (4/16). Eine
// Summen-Abfrage braucht Millisekunden und soll nie hinter einer
// 15-s-Live-Rechnung warten.
// wait: das Vorwaermen stellt sich immer an, statt mit 503 abgewiesen zu werden.
function makeLane(max, maxQueue) {
  const lane = { running: 0, queue: [] };
  lane.acquire = ({ wait = false } = {}) => {
    if (lane.running < max) { lane.running++; return Promise.resolve(); }
    if (!wait && lane.queue.length >= maxQueue) {
      const e = new Error('busy'); e.status = 503; throw e;
    }
    return new Promise(resolve => lane.queue.push(resolve));
  };
  lane.release = () => {
    const next = lane.queue.shift();
    if (next) next(); else lane.running--;
  };
  return lane;
}
const liveLane = makeLane(MAX_RUNNING, MAX_QUEUE);
const aggLane = makeLane(AGG_RUNNING, AGG_QUEUE);

// ─── Eingaben pruefen ──────────────────────────────────────────────────────

const ID_RE = /^[A-Za-z0-9_]{1,64}$/;
const REGION_RE = /^[a-z0-9]{2,5}$/;
const PATCH_RE = /^\d{1,2}\.\d{1,2}[a-z]?$/;
// 'unknown' nur noch fuer alte Links; die Oberflaeche bietet es nicht mehr an.
const RANKS = ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND', 'EMERALD', 'unknown'];
const TABS = ['summary', 'units', 'items', 'traits', 'comps', 'level', 'round', 'gold', 'region', 'rank'];

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

// Filterlose Ansicht aus den Tages-Teilsummen. days = alle Tage der
// Patch-Wahl (aggDaysFor), alle gedeckt. Tag, Patch und Region sind je
// Partie fest, die Summen ganzzahlig unter 2^53 — die Summe ueber Tage ist
// also exakt die Live-Summe, Zeile fuer Zeile.
async function runAggQuery(holder, q, days, { timeoutMs = AGG_TIMEOUT_MS, warm = false } = {}) {
  const conn = await holder.instance.connect();
  if (warm) holder.warmConn = conn;
  const timer = setTimeout(() => { try { conn.interrupt(); } catch { /* bereits fertig */ } }, timeoutMs);
  try {
    if (warm && holder.retired) throw new Error('swapped');
    let f = { matches: 0, n: 0, s: 0, ss: 0, sn: 0, nn: 0, hist: Array(8).fill(0) };
    const p = [...days];
    const w = ['day IN (SELECT day FROM agg_days)', `day IN (${days.map(() => 'CAST(? AS DATE)').join(', ')})`];
    if (q.region !== 'all') { w.push('region = ?'); p.push(q.region); }
    if (q.patches.length) { w.push(`patch IN (${q.patches.map(() => '?').join(', ')})`); p.push(...q.patches); }
    if (days.length) {
      const h = (await conn.runAndReadAll(
        `SELECT ${AGG_HEAD_COLS.map(c => `coalesce(sum(${c}), 0)::DOUBLE AS ${c}`).join(', ')}
         FROM agg_head WHERE ${w.join(' AND ')}`, p)).getRowObjectsJS()[0];
      f = { matches: h.matches, n: h.n, s: h.s, ss: h.ss, sn: h.sn, nn: h.nn, hist: [h.h1, h.h2, h.h3, h.h4, h.h5, h.h6, h.h7, h.h8] };
    }
    const out = { summary: summarize(f), base: summarize(f), headDelta: null, rows: null, refGames: null };
    if (f.n > 0) {
      const variants = aggEligible(q);
      const rows = (await conn.runAndReadAll(
        `SELECT key, sub, sub2, ${AGG_SUM_COLS.map(c => `sum("${c}")::DOUBLE AS "${c}"`).join(', ')}
         FROM agg_rows
         WHERE variant IN (${variants.map(() => '?').join(', ')}) AND ${w.join(' AND ')}
         GROUP BY key, sub, sub2
         HAVING sum(n1) >= ?
         ${ROW_ORDER}
         LIMIT ?`, [...variants, ...p, ROW_MIN_BOARDS, ROW_LIMIT])).getRowObjectsJS();
      finishRows(out, rows, f);
      // 3★-Anteil: n3 = Boards mit der Unit auf 3★ (hoechste Kopie), n1 = alle.
      if (q.tab === 'units' && q.split !== 'star') {
        rows.forEach((r, i) => { out.rows[i].star3 = r.n3 / r.n1; });
      }
    } else {
      out.rows = [];
      out.refGames = 0;
    }
    return out;
  } finally {
    clearTimeout(timer);
    if (holder.warmConn === conn) holder.warmConn = null;
    conn.closeSync?.();
  }
}

// Tage fuer den Summen-Weg oder null (dann live): nur filterlose Ansichten,
// Items nur mit derselben Komponenten-Liste wie beim Bau.
function aggDays(holder, q) {
  const a = holder.agg;
  if (!a || !aggEligible(q)) return null;
  if (q.tab === 'items' && a.compHash !== holder.compHash) return null;
  return aggDaysFor(q.patches, a.dayPatches, a.covered);
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

// Laufende Rechnungen je Schluessel. Der Eintrag entsteht vor dem Platz-Holen,
// damit auch eine Anfrage aus der Warteschlange gefunden wird.
const pending = new Map();

// Rechnet q oder haengt sich an eine laufende Rechnung derselben Ansicht.
// Deren Fehler gehen an alle Wartenden; ein Besucher, der nur mitwartet, gibt
// nach WAIT_MS auf (504), die Rechnung selbst laeuft weiter.
function compute(holder, q, key, { warm = false } = {}) {
  const inflight = pending.get(key);
  if (inflight) return warm ? inflight : withDeadline(inflight, WAIT_MS);
  const p = (async () => {
    // Erst die Teilsummen in ihrer eigenen Spur; scheitert das (auch an der
    // 2-s-Grenze), rechnet dieselbe Anfrage live. Ist die Summen-Spur voll,
    // gibt es 503 wie bei der Live-Spur.
    const days = aggDays(holder, q);
    if (days) {
      await aggLane.acquire({ wait: warm });
      try {
        return await execute(holder, q, key, warm, days);
      } catch (err) {
        if (err.message === 'swapped') throw err;
        log(`Teilsummen-Weg gescheitert, rechne live: ${err.message} bei ${JSON.stringify(q)}`);
      } finally {
        aggLane.release();
      }
    }
    await liveLane.acquire({ wait: warm });
    try {
      return await execute(holder, q, key, warm);
    } finally {
      liveLane.release();
    }
  })();
  pending.set(key, p);
  const clear = () => { if (pending.get(key) === p) pending.delete(key); };
  p.then(clear, clear);
  return p;
}

function withDeadline(p, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { const e = new Error('timeout'); e.status = 504; reject(e); }, ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
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
    const a = current?.agg;
    return send(res, current ? 200 : 503, {
      ok: !!current, meta: current?.meta ?? null, running: liveLane.running, queued: liveLane.queue.length,
      agg: a ? { covered: a.coveredDays, total: a.total, running: aggLane.running, queued: aggLane.queue.length } : null,
    });
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
  const hit = holder.pinned.get(key) ?? cacheGet(key);
  // X-Explorer-Source bleibt auf der Box: refresh-api reicht nur Built-At und
  // Retry-After durch. Fuer Diagnose und den Abgleich agg gegen live.
  if (hit) return send(res, 200, { meta: holder.meta, query: q, ...hit, cached: true }, { ...headers, 'X-Explorer-Source': hit.src ?? 'live' });

  const t0 = Date.now();
  try {
    const result = await compute(holder, q, key);
    send(res, 200, { meta: holder.meta, query: q, ...result, cached: false }, { ...headers, 'X-Explorer-Source': result.src ?? 'live' });
  } catch (err) {
    if (err.status === 503) return send(res, 503, { error: 'busy' }, { 'Retry-After': '5' });
    const interrupted = /interrupt/i.test(err.message || '');
    log(`Fehler (${Date.now() - t0} ms): ${err.message} bei ${JSON.stringify(q)}`);
    send(res, interrupted ? 504 : (err.status || 500), { error: interrupted ? 'timeout' : (err.status ? err.message : 'internal') });
  }
});

function resolveLatest(holder, q) {
  if (q.patches[0] === 'latest') q.patches = holder.meta.patches[0] ? [holder.meta.patches[0].patch] : [];
}
function cacheKey(holder, q) { return `${holder.ino}|${JSON.stringify(q)}`; }

// Laeuft mit belegtem Slot; der Aufrufer gibt ihn frei.
// days gesetzt = Summen-Weg (aggDays), sonst live.
async function execute(holder, q, key, warm = false, days = null) {
  holder.refs++;
  const t0 = Date.now();
  try {
    const result = days
      ? await runAggQuery(holder, q, days, warm ? { timeoutMs: AGG_WARM_TIMEOUT_MS, warm: true } : {})
      : await runQuery(holder, q, warm ? { timeoutMs: WARM_TIMEOUT_MS, warm: true } : {});
    // Nicht aufzaehlbar: steht nicht im JSON, nur im Antwort-Kopf.
    Object.defineProperty(result, 'src', { value: days ? 'agg' : 'live', enumerable: false });
    result.ms = Date.now() - t0;
    if (warm) holder.pinned.set(key, result); else cacheSet(key, result);
    if (result.ms > 3000) log(`langsam ${result.ms} ms: ${JSON.stringify(q)}`);
    return result;
  } finally {
    release(holder);
  }
}

// Nach jedem Laden die Startansichten (alle Reiter ohne Filter, neuester
// Patch) rechnen und festhalten; Besucher schicken dieselbe Anfrage, also
// denselben Schluessel. Nimmt immer nur einen Slot seiner Spur, der Rest
// bleibt fuer echte Anfragen frei. Mit Teilsummen sind das Millisekunden je
// Reiter. Was scheitert, kommt nach einer Pause noch einmal dran.
async function warmUp(holder) {
  const t0 = Date.now();
  let n = 0;
  let todo = TABS.filter(x => x !== 'summary');
  for (let round = 0; round < 2 && todo.length; round++) {
    if (round > 0) await new Promise(r => setTimeout(r, WARM_RETRY_PAUSE_MS));
    const failed = [];
    for (const tab of todo) {
      if (current !== holder) return;
      const q = normalizeQuery({ tab, patches: ['latest'] });
      resolveLatest(holder, q);
      try {
        await warmOne(holder, q, cacheKey(holder, q));
        n++;
      } catch (err) {
        if (current !== holder) return;
        log(`Vorwaermen ${tab} fehlgeschlagen: ${err.message}`);
        failed.push(tab);
      }
    }
    todo = failed;
  }
  log(`vorgewaermt: ${n} Startansichten in ${Date.now() - t0} ms${todo.length ? ` (fehlgeschlagen: ${todo.join(', ')})` : ''}`);
}

async function warmOne(holder, q, key) {
  if (holder.pinned.has(key)) return;
  let result = cacheGet(key);
  if (!result) {
    // Rechnet gerade ein Besucher dieselbe Ansicht, erst auf ihn warten; laeuft
    // er in seine 15 s, rechnen wir mit der langen Grenze selbst.
    const other = pending.get(key);
    if (other) result = await other.catch(() => null);
    if (!result) {
      if (current !== holder) throw new Error('swapped');
      result = await compute(holder, q, key, { warm: true });
    }
  }
  holder.pinned.set(key, result);
}

fs.mkdirSync(path.join(path.dirname(DB_PATH), 'tmp-api'), { recursive: true });
await pollSwap();
if (!current) log(`WARNUNG: ${DB_PATH} nicht ladbar — Dienst antwortet 503, bis eine Datei da ist`);
setInterval(pollSwap, POLL_MS).unref();
server.listen(PORT, '127.0.0.1', () => log(`lauscht auf 127.0.0.1:${PORT}`));
