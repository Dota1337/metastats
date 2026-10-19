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
// Last (Live-Spur): eine Abfrage zur Zeit (die Instanz hat ohnehin nur 2
// Threads, zwei gleichzeitig bringen keinen Durchsatz), bis zu 8 warten, danach
// 503. Die Frist laeuft ab Eingang (liveBudget in explorer-mask-query.mjs):
// kurze Abfragen warten bis LIVE_TOTAL_MS (32 s) auf den Platz und rechnen
// hoechstens QUERY_TIMEOUT_MS, „alle Patches + Filter" auf dem Masken-Weg hat
// LONG_QUERY_TIMEOUT_MS fuer beides. Die Schlange bedient die frueheste
// Aufgabe zuerst (explorer-lane.mjs). Wer bis Frist minus Mindest-Rest keinen
// Platz hat, verlaesst sie mit 503 „busy" ohne Rechnung. Laeuft dieselbe
// Ansicht schon, wartet eine weitere Anfrage auf diese Rechnung bis zu deren
// Frist + 1 s (joinWaitMs, unter der 35-s-Grenze von refresh-api), statt
// doppelt zu rechnen.
//
// Tages-Teilsummen (Paket 5b): Ansichten ohne Board-Filter (kein Rang, keine
// Unit/Item/Trait, kein Fokus) summiert der Dienst aus agg_rows/agg_head, die
// der Bau je Tag, Patch und Region schreibt — fuer jeden Patch und jede
// Region, bitgleich zur Live-Rechnung. Eigene Spur (4 laufend, 16 wartend,
// AGG_TIMEOUT_MS), damit diese Ansichten nie hinter 15-s-Abfragen warten.
// Genommen nur, wenn die Summen zu dieser Datei gehoeren (loadAgg) und alle
// Tage der Patch-Wahl gedeckt sind; sonst und bei jedem Fehler live.
// EXPLORER_AGG=0 schaltet den Weg ab. Antwort-Kopf X-Explorer-Source: agg|mask|live.
//
// Platz-Masken (Paket 6): Ansichten mit Board-Filter oder Rang rechnet die
// Live-Spur ueber die Masken-Tabellen des Baus (scripts/lib/explorer-mask-query.mjs),
// bitgleich zum heutigen Weg. Nur, wenn die Masken zu dieser Datei gehoeren
// (loadMask) und alle Tage der Patch-Wahl gedeckt sind. Fehlt zur Laufzeit eine
// Tabelle oder Spalte, rechnet dieselbe Anfrage mit der Restfrist wie bisher;
// Zeitgrenze und Speicherfehler bleiben 504/500. EXPLORER_MASKS=0 schaltet den
// Weg ab, /healthz zeigt Schalter und gedeckte Tage.
//
// Startansichten (alle Reiter ohne Filter, neuester Patch) rechnet der Dienst
// nach jedem Laden selbst, mit der eigenen Grenze WARM_TIMEOUT_MS: live
// brauchen units, traits und items gemessen 70-120 s und scheiterten an den
// 15 s bei jedem Laden. Sie liegen je Datei in einer eigenen Ablage, die der
// Zwischenspeicher nicht verdraengt; nach einem Tausch faengt die neue Datei
// leer an.
//
// Brett-Zaehler, Spiele- und Builds-Reiter (Paket B/C): brauchen Spalten des
// neuen Aufbaus (readCaps). Fehlen sie, antwortet der Dienst 409 not_ready,
// alles andere laeuft weiter. EXPLORER_BOARD_COUNTS=0 / EXPLORER_GAMES=0
// schalten Zaehler bzw. Spiele ab, /healthz zeigt caps.
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
import { QUERY_TIMEOUT_MS, ROW_LIMIT, ROW_MIN_BOARDS, ROW_ORDER, bad, summarize, finishRows } from './lib/explorer-query.mjs';
import { LIMITS, TABS, neededCaps, normalizeQuery } from './lib/explorer-normalize.mjs';
import { COUNT_COLS } from './lib/explorer-counts.mjs';
import { LIVE_MIN_LEFT_MS, joinWaitMs, liveBudget, loadMask, runQueryWay, slotTimeout } from './lib/explorer-mask-query.mjs';
import { makeLane } from './lib/explorer-lane.mjs';
import { coplayPairBodies, pickWarmBody, unitWarmBodies, unitsToWarm } from './lib/explorer-unit-warm.mjs';

const DB_PATH = process.env.EXPLORER_DB_PATH || '/mnt/HC_Volume_105869432/explorer/explorer.duckdb';
const PORT = Number(process.env.EXPLORER_PORT || 4110);
const DUCKDB_MODULE = process.env.EXPLORER_DUCKDB_MODULE
  || '/opt/metastats-explorer/node_modules/@duckdb/node-api/lib/index.js';
const MAX_RUNNING = 1;
const MAX_QUEUE = 8;
const WARM_TIMEOUT_MS = Number(process.env.EXPLORER_WARM_TIMEOUT_MS || 300_000);
const WAIT_MS = 18_000;
const WARM_RETRY_PAUSE_MS = 60_000;
const POLL_MS = 60_000;
const CACHE_MAX = 400;
const AGG_ON = process.env.EXPLORER_AGG !== '0';
const MASK_ON = process.env.EXPLORER_MASKS !== '0';
const AGG_RUNNING = 4;
const AGG_QUEUE = 16;
const AGG_TIMEOUT_MS = Number(process.env.EXPLORER_AGG_TIMEOUT_MS || 2000);
const AGG_WARM_TIMEOUT_MS = 30_000;
// Notschalter Paket B/C: Zaehler-Filter bzw. Spiele-Reiter aus (Antwort 409).
const COUNTS_ON = process.env.EXPLORER_BOARD_COUNTS !== '0';
const GAMES_ON = process.env.EXPLORER_GAMES !== '0';
// Unit-Detailseiten vorwaermen (warmUnits); 0 = aus.
const UNIT_WARM_ON = process.env.EXPLORER_UNIT_WARM !== '0';
// Explorer-Auswahl je Unit vorwaermen (warmUnits, Plan 19.10.2026 S1); 0 = aus.
const PICK_WARM_ON = process.env.EXPLORER_PICK_WARM !== '0';
// Vorschlags-Paare nach einer echten Auswahl im Leerlauf vorrechnen (S6); 0 = aus.
const COPLAY_WARM_ON = process.env.EXPLORER_COPLAY_WARM !== '0';
// Teurere Auswahl (z. B. alle Patches) hat ebenso teure Paare — dann keine.
const COPLAY_MAX_ANCHOR_MS = 10_000;
// Hoechstens so lange je Paar; laenger hielte es die einzige Spur fuer Besucher.
const COPLAY_TIMEOUT_MS = QUERY_TIMEOUT_MS;
// So lange auf eine freie Spur warten, danach ist die Auswahl vermutlich alt.
const COPLAY_IDLE_MAX_MS = 20_000;
const COPLAY_JOBS_MAX = 3;
// Liegt waehrend eines Baus neben der Datei (build-explorer-store.mjs).
const BUILD_LOCK = `${DB_PATH}.lock`;
const UNIT_WARM_IDLE_MS = 2_000;
const UNIT_WARM_BUILD_MS = 60_000;

const { DuckDBInstance } = await import(DUCKDB_MODULE);

function log(...a) { console.log(`[explorer-api ${new Date().toISOString()}]`, ...a); }

// ─── Instanz + Tausch ──────────────────────────────────────────────────────

let current = null; // { instance, ino, refs, retired, meta, components, compHash, agg, mask, caps, bkOk, pinned, warmConn }

// Was die Datei kann (Paket B/C): Spalten des neuen Aufbaus. Eine Datei vom
// alten Aufbau hat sie nicht; Anfragen, die sie brauchen, bekommen 409
// not_ready (neededCaps), alle anderen laufen wie bisher. bk zaehlt nur, wenn
// der Bau dieselbe Komponenten-Liste nutzte wie der Dienst.
async function readCaps(conn) {
  const cols = (await conn.runAndReadAll(
    `SELECT table_name AS t, column_name AS c FROM duckdb_columns()
     WHERE database_name = current_database() AND schema_name = 'main'`)).getRowObjectsJS();
  const has = (t, c) => cols.some(r => r.t === t && r.c === c);
  const bkHash = has('meta', 'bk_comp_hash')
    ? (await conn.runAndReadAll('SELECT bk_comp_hash AS h FROM meta')).getRowObjectsJS()[0]?.h ?? null
    : null;
  const counts = [...Object.values(COUNT_COLS), 'tags'].every(c => has('boards', c));
  const games = has('boards', 'ts') && has('board_rank', 'ph') && has('players', 'puuid');
  return { counts, games, bk: has('units', 'bk') ? bkHash : null };
}

async function openStore() {
  const st = fs.statSync(DB_PATH);
  const instance = await DuckDBInstance.create(DB_PATH, {
    access_mode: 'READ_ONLY',
    threads: '2',
    memory_limit: '1GB',
    temp_directory: path.join(path.dirname(DB_PATH), 'tmp-api'),
  });
  const holder = {
    instance, ino: st.ino, refs: 0, retired: false, meta: null, components: [], compHash: null, agg: null, mask: null,
    caps: new Set(), bkOk: false, pinned: new Map(), warmConn: null,
  };
  const conn = await instance.connect();
  let fileCaps;
  try {
    fileCaps = await readCaps(conn);
    holder.agg = AGG_ON ? await loadAgg(conn) : null;
    holder.mask = MASK_ON ? await loadMask({ all: async s => (await conn.runAndReadAll(s)).getRowObjectsJS(), log }) : null;
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
  holder.bkOk = fileCaps.bk != null && fileCaps.bk === holder.compHash;
  if (fileCaps.counts && COUNTS_ON) holder.caps.add('counts');
  if (fileCaps.games && GAMES_ON) holder.caps.add('games');
  if (holder.bkOk) holder.caps.add('builds');
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
      + `Teilsummen ${next.agg ? `${next.agg.coveredDays}/${next.agg.total} Tage` : (AGG_ON ? 'keine' : 'aus')}, `
      + `Masken ${next.mask ? `${next.mask.coveredDays}/${next.mask.total} Tage` : (MASK_ON ? 'keine' : 'aus')}, `
      + `kann ${[...next.caps].join('+') || 'nur Grundfilter'}`);
    if (prev) {
      prev.retired = true;
      // Laufendes Vorwaermen der alten Datei abbrechen, sonst haelt es bis zu
      // WARM_TIMEOUT_MS einen Platz fuer Zahlen, die niemand mehr abruft.
      try { prev.warmConn?.interrupt(); } catch { /* bereits fertig */ }
      if (prev.refs === 0) closeHolder(prev);
    }
    warmUp(next).then(() => warmUnits(next)).catch(err => log('Vorwaermen abgebrochen:', err.message));
  } catch (err) {
    log('Laden fehlgeschlagen, alte Datei bleibt:', err.message);
  } finally {
    swapping = false;
  }
}

// ─── Warteschlange ─────────────────────────────────────────────────────────

// Zwei Spuren: live (1 laufend, 8 wartend) und Teilsummen (4/16). Eine
// Summen-Abfrage braucht Millisekunden und soll nie hinter einer
// 15-s-Live-Rechnung warten. makeLane: scripts/lib/explorer-lane.mjs.
const liveLane = makeLane(MAX_RUNNING, MAX_QUEUE);
const aggLane = makeLane(AGG_RUNNING, AGG_QUEUE);

// ─── Eingaben pruefen ──────────────────────────────────────────────────────
// normalizeQuery: scripts/lib/explorer-normalize.mjs (kanonische Form =
// Cache-Schluessel, unbekannte Felder → 400).

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
// 1 s nach der Frist dieser Rechnung auf (504) — vorher kommt ihr Ergebnis
// oder ihr Fehler. Beim Vorwaermen (keine Besucher-Frist) nach WAIT_MS. Die
// Rechnung selbst laeuft weiter. Wer in der Schlange aufgibt oder beim Platz
// weniger als den Mindest-Rest hat, bekommt 503 „busy" (queued).
function compute(holder, q, key, { warm = false, pin = warm, warmTimeoutMs = WARM_TIMEOUT_MS } = {}) {
  const inflight = pending.get(key);
  if (inflight) {
    if (warm) return inflight;
    return withDeadline(inflight, joinWaitMs(inflight.deadlineAt, Date.now(), WAIT_MS));
  }
  const t0 = Date.now();
  const budget = warm ? null : liveBudget(holder, q);
  const deadlineAt = budget ? t0 + budget.timeoutMs : null;
  const p = (async () => {
    // Erst die Teilsummen in ihrer eigenen Spur; scheitert das (auch an der
    // 2-s-Grenze), rechnet dieselbe Anfrage live. Ist die Summen-Spur voll,
    // gibt es 503 wie bei der Live-Spur.
    const days = aggDays(holder, q);
    if (days) {
      await aggLane.acquire({ wait: warm });
      try {
        return await execute(holder, q, key, warm, days, undefined, { pin, warmTimeoutMs });
      } catch (err) {
        if (err.message === 'swapped') throw err;
        log(`Teilsummen-Weg gescheitert, rechne live: ${err.message} bei ${JSON.stringify(q)}`);
      } finally {
        aggLane.release();
      }
    }
    // Wartet hoechstens bis Frist minus Mindest-Rest, dann 504 ohne Platz.
    await liveLane.acquire({ wait: warm, giveUpAt: budget ? deadlineAt - budget.minLeftMs : null });
    try {
      // Frist ab Eingang: was vor dem Platz verging (Warten in der Schlange,
      // ein gescheiterter Summen-Versuch), geht von der Frist ab; die eigene
      // Rechnung hoechstens computeMaxMs (slotTimeout). Die Startansichten
      // behalten ihre eigene Grenze.
      let timeoutMs;
      if (budget) {
        const waited = Date.now() - t0;
        timeoutMs = slotTimeout(budget, deadlineAt);
        if (timeoutMs == null) {
          log(`Frist verbraucht nach ${waited} ms Wartezeit, 503 ohne Rechnung: ${JSON.stringify(q)}`);
          const e = new Error('busy'); e.status = 503; e.queued = true; throw e;
        }
        if (budget.long) log(`lange Frist ${budget.timeoutMs} ms (Rest ${timeoutMs} ms): ${JSON.stringify(q)}`);
        else if (waited >= 2000) log(`kurz nach ${waited} ms Wartezeit dran (Rechnung bis ${timeoutMs} ms): ${JSON.stringify(q)}`);
      }
      return await execute(holder, q, key, warm, null, timeoutMs, { pin, warmTimeoutMs });
    } finally {
      liveLane.release();
    }
  })();
  if (deadlineAt != null) p.deadlineAt = deadlineAt;
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
      masks: { on: MASK_ON, covered: current?.mask?.coveredDays ?? null, total: current?.mask?.total ?? null },
      caps: current ? [...current.caps] : [],
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
  if (neededCaps(q).some(c => !holder.caps.has(c))) return send(res, 409, { error: 'not_ready' }, headers);
  const key = cacheKey(holder, q);
  const hit = holder.pinned.get(key) ?? cacheGet(key);
  // X-Explorer-Source bleibt auf der Box: refresh-api reicht nur Built-At und
  // Retry-After durch. Fuer Diagnose und den Abgleich agg gegen live.
  if (hit) {
    send(res, 200, { meta: holder.meta, query: q, ...hit, cached: true }, { ...headers, 'X-Explorer-Source': hit.src ?? 'live' });
    scheduleCoplay(holder, q, hit);
    return;
  }

  const t0 = Date.now();
  // Die Datei schon ab hier halten, nicht erst ab execute: eine Anfrage, die
  // ueber den naechtlichen Tausch hinweg in der Schlange wartet, liefe sonst
  // auf eine geschlossene Instanz (pollSwap schliesst bei refs 0).
  holder.refs++;
  try {
    const result = await compute(holder, q, key);
    send(res, 200, { meta: holder.meta, query: q, ...result, cached: false }, { ...headers, 'X-Explorer-Source': result.src ?? 'live' });
    scheduleCoplay(holder, q, result);
  } catch (err) {
    if (err.status === 503) {
      if (err.queued) log(`ausgelastet nach ${Date.now() - t0} ms in der Schlange, 503: ${JSON.stringify(q)}`);
      return send(res, 503, { error: 'busy' }, { 'Retry-After': '5' });
    }
    const interrupted = /interrupt/i.test(err.message || '');
    log(`Fehler (${Date.now() - t0} ms): ${err.message} bei ${JSON.stringify(q)}`);
    send(res, interrupted ? 504 : (err.status || 500), { error: interrupted ? 'timeout' : (err.status ? err.message : 'internal') });
  } finally {
    release(holder);
  }
});

function resolveLatest(holder, q) {
  if (q.patches[0] === 'latest') q.patches = holder.meta.patches[0] ? [holder.meta.patches[0].patch] : [];
}
function cacheKey(holder, q) { return `${holder.ino}|${JSON.stringify(q)}`; }

// Laeuft mit belegtem Slot; der Aufrufer gibt ihn frei.
// days gesetzt = Summen-Weg (aggDays), sonst Masken-Weg oder live
// (runQueryWay). timeoutMs = Restfrist der Live-Spur (compute); fehlt sie,
// gilt QUERY_TIMEOUT_MS. Der Rueckfall nach einem Strukturfehler bekommt
// hoechstens QUERY_TIMEOUT_MS, auch bei langer Frist.
// pin: Ergebnis fest ablegen (Vorwaermen) statt im verdraengbaren Zwischenspeicher;
// die Vorschlags-Paare rechnen wie das Vorwaermen, landen aber im Zwischenspeicher.
async function execute(holder, q, key, warm = false, days = null, timeoutMs = undefined,
  { pin = warm, warmTimeoutMs = WARM_TIMEOUT_MS } = {}) {
  holder.refs++;
  const t0 = Date.now();
  try {
    const { result, src } = days
      ? { result: await runAggQuery(holder, q, days, warm ? { timeoutMs: AGG_WARM_TIMEOUT_MS, warm: true } : {}), src: 'agg' }
      : await runQueryWay(holder, q, warm
        ? { timeoutMs: warmTimeoutMs, warm: true, log }
        : { timeoutMs, minLeftMs: LIVE_MIN_LEFT_MS, fallbackMaxMs: QUERY_TIMEOUT_MS, log });
    // Nicht aufzaehlbar: steht nicht im JSON, nur im Antwort-Kopf.
    Object.defineProperty(result, 'src', { value: src, enumerable: false });
    result.ms = Date.now() - t0;
    if (pin) holder.pinned.set(key, result); else cacheSet(key, result);
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
// Spiele und Builds nicht: Builds braucht einen Traeger, Spiele sind eine
// kurze Abfrage ohne Teilsummen.
async function warmUp(holder) {
  const t0 = Date.now();
  let n = 0;
  let todo = TABS.filter(x => !['summary', 'games', 'builds'].includes(x));
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

// Unit-Detailseiten (Plan 19.10.2026): die drei Abfragen der Standardansicht
// (scripts/lib/explorer-unit-warm.mjs) je Unit mit genug Brettern, meistgespielte
// zuerst — die Liste kommt aus der Startansicht des Units-Reiters. Laeuft nach
// den Startansichten und nur, wenn niemand wartet: vor jeder Abfrage Pause,
// solange die Live-Spur belegt ist oder ein Bau laeuft (Speicher der Box).
// Drei Fehler in Folge beenden den Durchgang. Ergebnisse liegen in der festen
// Ablage der Datei wie die Startansichten.
// Davor (S1, eine Abfrage je Unit, ~4 min): die Explorer-Auswahl je Unit — der
// erste Klick auf einen Suchtreffer kostet sonst 3–8 s Rechnen.
async function warmUnits(holder) {
  if ((!UNIT_WARM_ON && !PICK_WARM_ON) || current !== holder) return;
  const start = normalizeQuery({ tab: 'units', patches: ['latest'] });
  resolveLatest(holder, start);
  const ids = unitsToWarm(holder.pinned.get(cacheKey(holder, start))?.rows);
  if (!ids.length) { log('Unit-Vorwaermen uebersprungen: keine Startansicht Units'); return; }
  const steps = [
    ...(PICK_WARM_ON ? ids.map(id => ({ id, body: pickWarmBody(id), pick: true })) : []),
    ...(UNIT_WARM_ON ? ids.flatMap(id => unitWarmBodies(id).map(body => ({ id, body, pick: false }))) : []),
  ];
  const t0 = Date.now();
  let n = 0;
  let picks = 0;
  let fails = 0;
  for (const { id, body, pick } of steps) {
    if (!(await warmIdle(holder))) return;
    const q = normalizeQuery(body);
    resolveLatest(holder, q);
    if (neededCaps(q).some(c => !holder.caps.has(c))) continue;
    try {
      await warmOne(holder, q, cacheKey(holder, q));
      n++;
      fails = 0;
      if (pick && ++picks === ids.length) log(`Explorer-Auswahl vorgewaermt: ${picks} Units in ${Date.now() - t0} ms`);
    } catch (err) {
      if (current !== holder) return;
      log(`Vorwaermen Unit ${id} (${pick ? 'Auswahl' : q.tab}) fehlgeschlagen: ${err.message}`);
      if (++fails >= 3) { log(`Unit-Vorwaermen nach 3 Fehlern in Folge beendet (${n} Abfragen fertig)`); return; }
    }
  }
  log(`Unit-Seiten vorgewaermt: ${n} Abfragen fuer ${ids.length} Units in ${Date.now() - t0} ms`);
}

// Vorschlags-Paare (Plan 19.10.2026, S6): nach jeder Antwort im Units-Reiter,
// zu der die Seite „Oft zusammen mit …" zeigt, die Paar-Anfragen der
// Vorschlaege im Leerlauf rechnen — meistgespielte zuerst, in den normalen
// Zwischenspeicher. Gilt fuer jeden Rang, Patch und jede Region. Die juengste
// Auswahl hat Vorrang: kommt eine neue, endet die laufende nach ihrem Paar.
// Waehrend eines Baus nichts (Speicher der Box). Eine laufende Paar-Rechnung
// laesst einen neuen Besucher hoechstens ihren Rest warten (~3 s gemessen).
const coplayJobs = [];
let coplayRunning = false;
// Zaehlt jede neue Auswahl. Die laufende Rechnung endet nur, wenn danach eine
// neue kam — nicht wegen aelterer, die noch in der Schlange warten.
let coplaySeq = 0;

function scheduleCoplay(holder, q, result) {
  if (!COPLAY_WARM_ON || current !== holder || !result?.rows) return;
  if ((result.ms ?? 0) > COPLAY_MAX_ANCHOR_MS) return;
  const bodies = coplayPairBodies(q, result.rows, { maxUnits: LIMITS.units, maxTotal: LIMITS.total });
  if (!bodies.length) return;
  const anchor = cacheKey(holder, q);
  if (coplayJobs.some(j => j.anchor === anchor)) return;
  coplayJobs.push({ holder, anchor, bodies });
  coplaySeq++;
  while (coplayJobs.length > COPLAY_JOBS_MAX) coplayJobs.shift();
  if (!coplayRunning) runCoplay().catch(err => log('Vorschlags-Paare abgebrochen:', err.message));
}

async function runCoplay() {
  coplayRunning = true;
  try {
    while (coplayJobs.length) {
      const { holder, bodies } = coplayJobs.pop();
      const seq = coplaySeq;
      const t0 = Date.now();
      let n = 0;
      for (const body of bodies) {
        if (coplaySeq !== seq || current !== holder) break;
        if (!(await coplayIdle(holder))) break;
        let q;
        try { q = normalizeQuery(body); } catch { continue; }
        const key = cacheKey(holder, q);
        if (holder.pinned.has(key) || cache.has(key) || pending.has(key)) continue;
        try {
          await compute(holder, q, key, { warm: true, pin: false, warmTimeoutMs: COPLAY_TIMEOUT_MS });
          n++;
        } catch (err) {
          log(`Vorschlags-Paar fehlgeschlagen (${Date.now() - t0} ms): ${err.message}`);
          break;
        }
      }
      if (n) log(`Vorschlags-Paare vorgerechnet: ${n} in ${Date.now() - t0} ms`);
    }
  } finally {
    coplayRunning = false;
  }
}

// Wie warmIdle, aber mit Obergrenze und ohne Warten auf einen Bau.
async function coplayIdle(holder) {
  const until = Date.now() + COPLAY_IDLE_MAX_MS;
  for (;;) {
    if (current !== holder || fs.existsSync(BUILD_LOCK)) return false;
    if (liveLane.running === 0 && liveLane.queue.length === 0) return true;
    if (Date.now() >= until) return false;
    await new Promise(r => setTimeout(r, 250));
  }
}

// Wartet, bis die Live-Spur leer ist und kein Bau laeuft; false nach einem Tausch.
// Vorschlags-Paare gehen vor: sie gehoeren zu einem Besucher, der gerade klickt.
async function warmIdle(holder) {
  let told = false;
  for (;;) {
    if (current !== holder) return false;
    const building = fs.existsSync(BUILD_LOCK);
    if (!building && !coplayRunning && liveLane.running === 0 && liveLane.queue.length === 0) return true;
    if (building && !told) { log('Unit-Vorwaermen wartet: Bau laeuft'); told = true; }
    await new Promise(r => setTimeout(r, building ? UNIT_WARM_BUILD_MS : UNIT_WARM_IDLE_MS));
  }
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
