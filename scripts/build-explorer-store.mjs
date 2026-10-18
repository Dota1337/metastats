#!/usr/bin/env node
// Baut den Analyse-Speicher fuer den TFT Data Explorer (/tft/explorer).
//
// Liest die Set-Partien der letzten N Tage aus der lokalen Postgres der Box
// (tft_player_match_cache) und legt sie flach in eine DuckDB-Datei:
//   boards     — eine Zeile je Spieler-Board (Platz, Level, Runde, Gold, Patch, Region, Rang, Comp-Familie,
//                Spielzeit ts, Brett-Zaehler c_* und tags aus scripts/lib/explorer-counts.mjs)
//   units      — eine Zeile je Unit auf dem Board (Stern, Items, Build-Schluessel bk), sortiert nach Unit
//   traits     — eine Zeile je aktivem Trait (Stufe, Anzahl, Ueberfuellung), sortiert nach Trait
//   board_rank — je Board: Schluessel (Partie+Spieler), Spieler, Sammeltag, Rang
//   players    — Spieler-Hash → puuid (fuer den Spiele-Reiter; Namen holt die Next-Route)
//   day_patch  — Patch je Sammeltag, wie er beim Bau galt
//   meta       — Datenstand, Wasserstand und Fingerabdruecke fuer den naechsten Lauf
//
// Zwei Arten (seit 2026-10-08, vorher taeglich alles neu, 3438 s am 08.10.):
//   Teil-Aufbau — liest nur Zeilen, die seit dem letzten Lauf in Postgres
//     angekommen sind (fetched_at ab Wasserstand − 3 h), haengt die neuen
//     Boards an, wirft Tage vor dem Fenster raus und rechnet Rang (letzte 7
//     Tage) und Patch (geaenderte Tage) nach. Postgres liest trotzdem die ganze
//     Tabelle (kein Index auf fetched_at — einer auf der laufenden
//     Sammler-Tabelle waere das groessere Risiko), aber DuckDB zerlegt nur die
//     neuen Boards.
//   Vollaufbau — alles neu: einmal je Woche und immer dann, wenn der
//     Teil-Aufbau nicht dasselbe Ergebnis liefern koennte (decideMode).
// Warum Ankunftszeit statt Spielzeit: 40–53 % der neu ankommenden Zeilen sind
// Partien, die laenger als 14 Tage zurueckliegen (gemessen 2026-10-08). Die
// Sammler schreiben nur per insert … on conflict do nothing; fetched_at kommt
// immer aus dem Default now().
//
// Trait-Stufe: Riots `tier_current` (nicht `style` — Elderwood 7 und 9 haben
// beide style 5). Ueberfuellung = num_units − minUnits der aktiven Stufe aus
// dem Asset-Bundle; bei Traits mit nur einer Stufe NULL.
//
// Patch je Tag: Supabase-RPC get_tft_available_patches (Service-Key). Rueckfall:
// zuletzt gelesene Bereiche (patch-ranges.json), dann Riots Terminplan plus
// B-Patch-Schnitte aus public/tft-set.json (patchRanges, dieselbe Regel wie der
// Sammler). Ohne alles: Abbruch, alte Datei bleibt. Zugeordnet wird ueber den
// Sammeltag (Spielzeit − 5 h, Fenster ab 05:00 UTC) — so zaehlen auch die
// Patch-Tage in Supabase. Die Spalte `day` bleibt der Kalendertag (UTC).
//
// Rang: naechster Eintrag desselben Spielers innerhalb ±3 Tagen aus
// Marktwert-Snapshot (Diamant+) oder Rangliste tft_ladder_daily (Emerald+);
// bei Gleichstand der fruehere, dann die Rangliste, dann der niedrigere Rang.
// Die Rangliste haelt nur 10 Tage. Deshalb wird der Rang fuer Boards ab
// Stichtag − 7 bei jedem Lauf neu bestimmt (fehlt die Quelle, bleibt der
// alte), aeltere Boards behalten ihn eingefroren aus board_rank.
//
// Datei-Tausch: Bau in <out>.tmp (Teil-Aufbau: Kopie der alten Datei),
// Pruefungen, CHECKPOINT, schliessen, rename. Bei Fehler bleibt die alte Datei
// unangetastet. Doppellauf verhindert <out>.lock (pid + boot_id).
//
// Aufruf: node scripts/build-explorer-store.mjs [--out=/pfad/explorer.duckdb]
//         [--days=45] [--set=18] [--full]
//         Nur Test: [--limit=N] [--asof=YYYY-MM-DD] [--until=<ISO|ms>]
//         (--until = obere Grenze fuer fetched_at). Ein Testlauf zwingt den
//         naechsten echten Lauf zum Vollaufbau.
// Exit: 0 fertig oder anderer Lauf aktiv, 1 Fehler, 2 Vollaufbau noetig, aber
// mit diesem Code-Stand schon gescheitert (mit --full erzwingen), 3 zu wenig
// Platz auf dem Volume (diskGate; Postgres liegt auf derselben Platte).
// Env: EXPLORER_BUILD_MEM (DuckDB-Speichergrenze, Vorgabe 900MB),
//      EXPLORER_DISK_CHECK=0 (Platz-Sperre aus), EXPLORER_DISK_RESERVE_GB,
//      AGG_BUDGET_S, AGG_MASKS, AGG_PART_CAP (scripts/lib/explorer-agg.mjs).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { patchRanges } from './lib/tft-patch-day.mjs';
import { currentWindowDay } from './lib/tft-crawl-window.mjs';
import {
  AGG_SIG, compListSql, aggBudgetS, aggCarryBlocked, aggCarryLate,
} from './lib/explorer-agg.mjs';
import { aggStep, aggBindingReason, aggCarrySave, aggCarryMatch } from './lib/explorer-agg-build.mjs';
import { MASK_SIG } from './lib/explorer-mask.mjs';
import { maskStep } from './lib/explorer-mask-build.mjs';
import { readComponents, componentsHash } from './lib/explorer-components.mjs';
import {
  COUNT_COLS, COUNTS_HASH, TRAITS_JSON_TYPE, UNITS_JSON_TYPE, buildKeySql, countsLists, countsSelectSql, unitIdSql,
} from './lib/explorer-counts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};

const OUT = arg('out', process.env.EXPLORER_DB_PATH || '/mnt/HC_Volume_105869432/explorer/explorer.duckdb');
const DAYS = Number(arg('days', '45'));
const LIMIT = Number(arg('limit', '0'));
const FULL = process.argv.includes('--full');
const ASOF = arg('asof', null);
const UNTIL = arg('until', null);
const DUCKDB_MODULE = process.env.EXPLORER_DUCKDB_MODULE
  || '/opt/metastats-explorer/node_modules/@duckdb/node-api/lib/index.js';
const QUEUE_RANKED = 1100;

// Aendert sich, wenn sich das Ergebnis eines Laufs aendern wuerde — erzwingt
// dann einen Vollaufbau.
// 3 (18.10.2026): Brett-Zaehler, Spielzeit, Build-Schluessel, players (Paket B+C).
export const SCRIPT_VERSION = 3;
export const FREEZE_DAYS = 7;      // Rang ab Stichtag − 7 wird neu bestimmt, davor eingefroren
export const FULL_EVERY_DAYS = 7;  // spaetestens so oft alles neu (raeumt auch geloeschte Zeilen der Datei auf)
// Wochen-Vollaufbau nur bei Start in diesem Fenster (Stunde UTC, Timer So
// 19:30): nachts endet er nach 02:55 und laesst Teilsummen und Masken leer.
export const FULL_WINDOW_UTC = [17, 24];
const MARGIN_MS = 3 * 3_600_000;   // Teil-Aufbau liest ab Wasserstand − 3 h (spaet bestaetigte Schreibvorgaenge)
const SCAN_ALARM_S = 600;          // nur Teil-Aufbau (Tabellen-Scan ~130 s); Vollaufbau ueber TOTAL_ALARM_S
const TOTAL_ALARM_S = 6000;        // Unit-Zeitlimit 9000 s
const TOTAL_ALARM_FULL_S = 8400;   // Vollaufbau im Abendfenster: Kern ~4400–5300 s, danach Summen + Masken
const BUILD_MEM_DEFAULT = '900MB';
// Platz-Sperre (17.10.: Vollaufbau lief bei 27 GB frei in „No space left on
// device"; Postgres und die Sicherungen liegen auf demselben Volume). Bedarf als
// Vielfaches der vorigen Datei: .work war beim Abbruch 22,4 GB bei 4,35 GB Datei
// (×5,2, nur Untergrenze — danach kamen noch Sortier-Auslagerung, traits,
// Teilsummen, Masken). Gemessene Spitze je Lauf in status.json `disk`; Faktor
// danach nachziehen. Teil-Aufbau: Kopie der alten Datei + Block-Kopien.
export const DISK_FULL_FACTOR = 10;
export const DISK_DELTA_FACTOR = 2;
export const DISK_FIRST_BYTES = 40 * 2 ** 30;  // Vollaufbau ohne vorige Datei
export const DISK_SPILL_MIN_BYTES = 5 * 2 ** 30;
const GIB = 2 ** 30;
const DISK_RESERVE_BYTES = (Number(process.env.EXPLORER_DISK_RESERVE_GB) > 0
  ? Number(process.env.EXPLORER_DISK_RESERVE_GB) : 10) * GIB;  // bleibt Postgres immer
const DISK_CHECK = process.env.EXPLORER_DISK_CHECK !== '0';
const DISK_WATCH_MS = 20_000;
const DAY_MS = 86_400_000;
const OPEN_END = '2999-12-31';

// Bau-Skripte, deren Stand die Versuchs-Sperre traegt (decideMode).
export const CODE_FILES = ['build-explorer-store.mjs', 'lib/explorer-agg-build.mjs', 'lib/explorer-mask-build.mjs',
  'lib/explorer-agg.mjs', 'lib/explorer-mask.mjs', 'lib/explorer-counts.mjs'];

function log(...a) { console.log(`[explorer-build ${new Date().toISOString()}]`, ...a); }

// ---------------------------------------------------------------------------
// Reine Hilfen (getestet in build-explorer-store.test.mjs)

const dayMs = (day) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day, n) => new Date(dayMs(day) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((dayMs(b) - dayMs(a)) / DAY_MS);

// Stichtag N (UTC-Datum), Fensteranfang W = N − days (00:00 UTC), Frost-Grenze
// F = N − 7. Gelesen werden Spiele ab W bis vor N + 1.
export function buildWindow({ asof = null, days, now = Date.now() }) {
  const n = asof || new Date(now).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n) || Number.isNaN(dayMs(n))) throw new Error(`Stichtag ${n} ungueltig`);
  if (!Number.isInteger(days) || days < 1) throw new Error(`--days=${days} ungueltig`);
  const w = addDays(n, -days);
  return { n, w, f: addDays(n, -FREEZE_DAYS), wMs: dayMs(w), endMs: dayMs(addDays(n, 1)) };
}

// Patch je Sammeltag fuer from..to: der Bereich mit dem spaetesten Start, bei
// gleichem Start der groessere Patch; Wechseltag, wenn mehr als ein Bereich
// passt; ohne Bereich NULL.
export function dayPatchRows(ranges, from, to) {
  const rows = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const hits = ranges.filter((r) => r.from <= d && d <= (r.to ?? OPEN_END));
    let best = null;
    for (const r of hits) {
      if (!best || r.from > best.from || (r.from === best.from && r.patch > best.patch)) best = r;
    }
    rows.push({ pday: d, patch: best ? best.patch : null, edge: hits.length > 1 });
  }
  return rows;
}

// Sammeltage, die in beiden Listen stehen und deren Patch oder Wechseltag-
// Markierung sich geaendert hat. Neue und weggefallene Tage zaehlen nicht.
export function diffDayPatch(prevRows, curRows) {
  const prev = new Map(prevRows.map((r) => [r.pday, r]));
  return curRows
    .filter((r) => prev.has(r.pday)
      && ((prev.get(r.pday).patch ?? null) !== (r.patch ?? null) || Boolean(prev.get(r.pday).edge) !== Boolean(r.edge)))
    .map((r) => r.pday);
}

export const inFullWindow = (hourUtc) => Number.isInteger(hourUtc)
  && hourUtc >= FULL_WINDOW_UTC[0] && hourUtc < FULL_WINDOW_UTC[1];

// Code-Stand der Bau-Skripte fuer die Versuchs-Sperre.
export function buildCodeHash(read = (f) => fs.readFileSync(path.join(__dirname, f))) {
  const h = crypto.createHash('sha1');
  for (const f of CODE_FILES) h.update(`${f}\0`).update(read(f)).update('\0');
  return h.digest('hex').slice(0, 12);
}

// Teil- oder Vollaufbau. prev.kind: none | unreadable | legacy | ok. Ein
// Pflichtgrund bedeutet: ein Teil-Aufbau koennte vom Vollaufbau abweichen.
// Ist mit demselben Code-Stand schon ein Vollaufbau angelaufen und nicht
// fertig geworden (Stempel mit gleichem cur.code, aber die Datei ist aelter),
// wird nicht noch einer gestartet: Pflicht → skip, Wochen-Turnus →
// Teil-Aufbau. Neuer Code → neuer Versuch. (Bis 17.10. galt die Sperre nur am
// selben Tag — beim Tages-Timer lief so jede Nacht ein Vollaufbau in den
// Speicher.) Der Wochen-Turnus laeuft nur im Abendfenster (hourUtc).
export function decideMode({ full = false, marker = false, prev, cur, patchChanged = [], f, stamp = null, hourUtc }) {
  const must = [];
  if (full) must.push('--full');
  if (marker) must.push('Markierung force-full');
  const kind = prev?.kind || 'none';
  if (kind === 'none') must.push('keine vorige Datei');
  else if (kind === 'unreadable') must.push(`vorige Datei unlesbar (${prev.error}) — eingefrorene Raenge verloren`);
  else if (kind === 'legacy') must.push('vorige Datei im alten Format');
  else {
    const m = prev.meta;
    if (m.watermarkMs == null) must.push('kein Wasserstand');
    if (!(m.nextBid >= 1)) must.push('keine naechste Board-Nummer');
    if (m.scriptVersion !== cur.scriptVersion) must.push(`Skriptversion ${m.scriptVersion} → ${cur.scriptVersion}`);
    if (m.duckdbVersion !== cur.duckdbVersion) must.push(`DuckDB ${m.duckdbVersion} → ${cur.duckdbVersion}`);
    for (const [k, v] of Object.entries(cur.hashes)) {
      if (m.hashes?.[k] !== v) must.push(`geaendert: ${k}`);
    }
    if (cur.nTupUpd == null || m.nTupUpd == null) must.push('Aenderungszaehler von Postgres unbekannt');
    else if (m.nTupUpd !== cur.nTupUpd) must.push(`Postgres meldet geaenderte Zeilen (${m.nTupUpd} → ${cur.nTupUpd})`);
    if (m.testRun && !cur.testRun) must.push('vorige Datei stammt aus einem Testlauf');
    const old = patchChanged.filter((d) => d < f);
    if (old.length) must.push(`Patch alter Tage geaendert: ${old.join(', ')}`);
    if (m.nDay && cur.n < m.nDay) must.push(`Stichtag ${cur.n} vor dem der vorigen Datei (${m.nDay})`);
  }
  const lastFullDay = kind === 'ok' ? prev.meta.lastFullDay : null;
  const cycle = !must.length && (!lastFullDay || daysBetween(lastFullDay, cur.n) >= FULL_EVERY_DAYS);
  const lastFullMs = kind === 'ok' ? Number(prev.meta.lastFullMs) : NaN;
  const blocked = !full && stamp?.code != null && stamp.code === cur.code && !(lastFullMs >= Number(stamp.startedMs));
  const failed = 'Vollaufbau mit diesem Code-Stand schon angelaufen und nicht fertig geworden';
  if (must.length) return blocked ? { mode: 'skip', reasons: [...must, failed], blocked } : { mode: 'full', reasons: must };
  if (cycle) {
    if (blocked) return { mode: 'delta', reasons: [`Wochen-Vollaufbau faellig, aber ${failed}`], blocked };
    if (!inFullWindow(hourUtc)) {
      return { mode: 'delta', reasons: [`Wochen-Vollaufbau faellig, Start ausserhalb ${FULL_WINDOW_UTC[0]}–${FULL_WINDOW_UTC[1]} Uhr UTC`] };
    }
    return { mode: 'full', reasons: [CYCLE_REASON] };
  }
  return { mode: 'delta', reasons: [] };
}
export const CYCLE_REASON = 'Wochen-Vollaufbau';

const gb = (b) => `${(b / GIB).toFixed(1)} GB`;
// Platz-Pruefung nach decideMode und VOR dem Versuchs-Stempel: wird der Stempel
// trotz Rueckstufung geschrieben, sperrt die Pruefung den eigenen Code-Stand
// (decideMode, blocked). Zu wenig Platz fuer den Vollaufbau → Wochen-Turnus
// wird Teil-Aufbau, Pflichtgrund → skip; zu wenig fuer den Teil-Aufbau → skip,
// die alte Datei bleibt. Ohne vorige Datei gilt DISK_FIRST_BYTES. Bekannte
// Grenze: nach einem Set-Wechsel misst die Schaetzung die Datei des alten Sets
// (zu hoch — skip statt Bau nur bei knapper Platte).
export function diskGate({ decision, freeBytes, prevBytes, reserveBytes }) {
  if (decision.mode === 'skip' || !Number.isFinite(freeBytes)) return { ...decision, disk: null };
  const need = (mode) => reserveBytes + (prevBytes > 0
    ? Math.ceil(prevBytes * (mode === 'full' ? DISK_FULL_FACTOR : DISK_DELTA_FACTOR))
    : (mode === 'full' ? DISK_FIRST_BYTES : 0));
  const disk = (mode) => ({ freeBytes, needBytes: need(mode) });
  if (freeBytes >= need(decision.mode)) return { ...decision, disk: disk(decision.mode) };
  const alarm = `zu wenig Platz fuer ${decision.mode === 'full' ? 'Vollaufbau' : 'Teil-Aufbau'}:`
    + ` frei ${gb(freeBytes)}, noetig ${gb(need(decision.mode))}`;
  const cycle = decision.mode === 'full' && decision.reasons.length === 1 && decision.reasons[0] === CYCLE_REASON;
  if (cycle && freeBytes >= need('delta')) {
    return { mode: 'delta', reasons: [`${CYCLE_REASON} faellig, aber ${alarm}`], disk: disk('delta'), diskAlarm: alarm };
  }
  return { mode: 'skip', reasons: [...decision.reasons, alarm], disk: disk(decision.mode), diskAlarm: alarm, diskSkip: true };
}

// Grenze fuer DuckDBs Auslagerungs-Ordner: was nach Reserve und Arbeitsdatei
// (Vollaufbau ~7 × alte Datei fuer .work + .tmp, Teil-Aufbau ~2 ×) uebrig ist,
// mindestens DISK_SPILL_MIN_BYTES. Ohne Grenze darf DuckDB 90 % des freien
// Platzes belegen und frisst die Postgres-Reserve.
export function spillCapBytes({ mode, freeBytes, prevBytes, reserveBytes }) {
  const work = (prevBytes > 0 ? prevBytes : DISK_FIRST_BYTES / DISK_FULL_FACTOR) * (mode === 'full' ? 7 : 2);
  return Math.max(DISK_SPILL_MIN_BYTES, Math.floor(freeBytes - reserveBytes - work));
}

// Fuer Nutzer frei (bavail): Postgres laeuft nicht als root und sieht nur diesen Wert.
function freeBytesOf(dir) {
  try { const s = fs.statfsSync(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

// Lese-Alarm nur im Teil-Aufbau: der Vollaufbau liest alle Boards des Sets und
// waechst mit ihnen (08.10.: 990 s fuer 11,8 Mio) — dort wacht die Gesamtgrenze.
export function scanAlarm({ mode, scanS }) {
  if (mode !== 'delta' || !(scanS > SCAN_ALARM_S)) return null;
  return `Postgres-Lesen ${Math.round(scanS)} s (Grenze ${SCAN_ALARM_S} s)`;
}

// Sperre: veraltet, wenn der Rechner neu gestartet wurde, der Prozess nicht
// mehr lebt oder unter der pid inzwischen etwas anderes laeuft.
export function lockIsStale(info, env) {
  if (!info || !Number.isInteger(info.pid)) return true;
  if (env.bootId && info.bootId && info.bootId !== env.bootId) return true;
  if (!env.isAlive(info.pid)) return true;
  const cmd = env.cmdline(info.pid);
  return cmd != null && !cmd.includes('build-explorer-store');
}

// Abfrage an Postgres. sinceMs/untilMs begrenzen fetched_at (Teil-Aufbau bzw.
// Test), game_datetime das Fenster.
export function rawSql({ setNumber, wMs, endMs, sinceMs = null, untilMs = null, limit = 0 }) {
  return `select match_id, puuid, game_datetime, (extract(epoch from fetched_at) * 1000)::bigint as fetched_ms,
      placement, level, last_round, gold_left, total_damage,
      comp_cluster_key, units::text as units, traits::text as traits
    from tft_player_match_cache
    where set_number = ${setNumber} and queue_id = ${QUEUE_RANKED}
      and game_datetime >= ${wMs} and game_datetime < ${endMs}`
    + (sinceMs != null ? `\n      and fetched_at >= to_timestamp(${sinceMs / 1000})` : '')
    + (untilMs != null ? `\n      and fetched_at < to_timestamp(${untilMs / 1000})` : '')
    + (limit ? `\n    limit ${limit}` : '');
}

// Nebendateien aus dem Zielpfad. status.json behaelt fuer die Live-Datei
// seinen Namen (Vertrag explorer/datei-frische), Testdateien bekommen eigene.
export function filesFor(out) {
  const dir = path.dirname(out);
  const base = path.basename(out).replace(/\.duckdb$/, '');
  return {
    dir,
    lock: `${out}.lock`,
    work: `${out}.work`,
    tmp: `${out}.tmp`,
    spill: `${out}.spill`,
    aggwork: `${out}.aggwork`,   // Arbeitskopie je Tages-Block der Teilsummen
    aggtry: `${out}.aggtry`,     // Versuchs-Stempel: bleibt nur nach Absturz im Teilsummen-Schritt liegen
    maskwork: `${out}.maskwork`, // Arbeitskopie je Tages-Block der Platz-Masken
    masktry: `${out}.masktry`,   // Versuchs-Stempel des Masken-Schritts
    stamp: `${out}.full-attempt.json`,
    marker: path.join(dir, 'force-full'),
    status: path.join(dir, base === 'explorer' ? 'status.json' : `${base}.status.json`),
    ext: path.join(dir, 'ext'),
    rangeCache: path.join(dir, 'patch-ranges.json'),
  };
}

// ---------------------------------------------------------------------------
// Eingaben aus dem Repo und Supabase

function readSetNumber() {
  const override = arg('set', null);
  if (override) return Number(override);
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/tft-set.json'), 'utf8'));
  const n = Number(j.setNumber);
  if (!Number.isInteger(n) || n < 1) throw new Error('tft-set.json: Set-Nummer nicht lesbar');
  return n;
}

// Stufen-Schwellen je Trait aus dem Asset-Bundle. Nur Traits mit >1 Stufe
// bekommen eine Ueberfuellung; einstufige (UniqueTrait, Solar …) nicht.
function readTraitThresholds(setNumber) {
  const p = path.join(ROOT, `public/tft-assets-${setNumber}.json`);
  const a = JSON.parse(fs.readFileSync(p, 'utf8'));
  const rows = [];
  for (const [id, t] of Object.entries(a.traits || {})) {
    const mins = (t.tiers || []).map((x) => Number(x.minUnits)).filter(Number.isFinite);
    mins.forEach((m, i) => rows.push({ id, lvl: i + 1, min: m, tiers: mins.length }));
  }
  if (!rows.length) throw new Error(`${p}: keine Trait-Stufen`);
  return rows;
}

// Abweichende Riot-Kennungen (`aliasOf` im Bundle, z. B. TFT18_Akali →
// DA_18_Akali_AD). Die Auswahlliste zeigt nur die Quelle; ohne Umschreiben
// waeren die Spiele unter der alten Kennung im Explorer nicht erreichbar.
// Listen fuer die Brett-Zaehler (Kosten, Eigen-Traits, Formen, Tags).
function readCountsLists(setNumber) {
  const p = path.join(ROOT, `public/tft-assets-${setNumber}.json`);
  const L = countsLists(JSON.parse(fs.readFileSync(p, 'utf8')));
  if (!Object.keys(L.native).length || [1, 2, 3, 4, 5].some((k) => !L.costIds[k].length)) {
    throw new Error(`${p}: keine Kosten oder Eigen-Traits fuer die Brett-Zaehler`);
  }
  return L;
}

function readUnitAliases(setNumber) {
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, `public/tft-assets-${setNumber}.json`), 'utf8'));
  return Object.entries(a.champions || {})
    .filter(([, c]) => typeof c?.aliasOf === 'string')
    .map(([id, c]) => [id, c.aliasOf]);
}

const RANGE_CACHE = filesFor(OUT).rangeCache;

// Der juengste Patch endet bei Supabase am letzten Aggregat-Tag (meist
// gestern); nach vorn offen, sonst fehlt der heutige Tag.
function openNewest(ranges) {
  const newest = ranges.reduce((a, b) => (b.from > a.from ? b : a));
  newest.to = OPEN_END;
  return ranges;
}

// Roh-Bereiche (echtes last_day) je Set, nur fuer den Rueckfall. Ein Fehler
// beim Schreiben bricht den Build nicht ab.
function writeRangeCache(setNumber, ranges) {
  try {
    const tmp = `${RANGE_CACHE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ set: setNumber, savedAt: new Date().toISOString(), ranges }));
    fs.renameSync(tmp, RANGE_CACHE);
  } catch (e) {
    log('Patch-Cache nicht geschrieben', e.message);
  }
}

function readRangeCache(setNumber) {
  try {
    const c = JSON.parse(fs.readFileSync(RANGE_CACHE, 'utf8'));
    if (Number(c.set) === setNumber && Array.isArray(c.ranges) && c.ranges.length) return c;
  } catch { /* kein Cache */ }
  return null;
}

// Bereiche aus Riots Terminplan (patchRanges) im Format des Builds: nur
// Patches, die bis zum Sammeltag `today` gestartet sind, der juengste offen.
// Ohne Terminplan fuer das Set: [].
export function scheduleRanges(meta, setNumber, today) {
  const ranges = patchRanges(meta, setNumber)
    .filter((r) => r.from_day <= today)
    .map((r) => ({ patch: r.patch, from: r.from_day, to: r.to_day ?? OPEN_END }));
  return ranges.length ? openNewest(ranges) : [];
}

// Patch-Bereiche [{patch, from, to}] fuer das Set. Tage, die in zwei Bereichen
// liegen, markiert der Build als Wechseltag.
async function readPatchRanges(setNumber, today) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/get_tft_available_patches`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_days: DAYS + 10 }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const rows = (await res.json()).filter((r) => Number(r.set_number) === setNumber && r.patch);
        if (rows.length) {
          const ranges = rows.map((r) => ({ patch: r.patch, from: r.first_day, to: r.last_day }));
          writeRangeCache(setNumber, ranges);
          return { source: 'supabase', ranges: openNewest(ranges) };
        }
      } else {
        log('Patch-RPC HTTP', res.status);
      }
    } catch (e) {
      log('Patch-RPC Fehler', e.message);
    }
  }
  // Rueckfall 1: die zuletzt von Supabase gelesenen Bereiche (echte Tage je
  // Patch), ergaenzt um Schnitte, die danach dazukamen. patchCuts allein kennen
  // den Starttag eines Basis-Patches nicht — bei mehreren Schnitten landeten
  // z. B. die 18.2-Tage sonst unter 18.1b.
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/tft-set.json'), 'utf8'));
  const cuts = (j.patchCuts || []).filter((c) => Number(c.set) === setNumber && c.from_day);
  const cache = readRangeCache(setNumber);
  if (cache) {
    const ranges = cache.ranges.map((r) => ({ ...r }));
    for (const c of [...cuts].sort((a, b) => a.from_day.localeCompare(b.from_day))) {
      const newestFrom = ranges.reduce((m, r) => (r.from > m ? r.from : m), '');
      if (c.from_day <= newestFrom || ranges.some((r) => r.patch === c.patch)) continue;
      // Vorherige Bereiche am Schnitt schliessen (ein Tag Ueberlappung =
      // Wechseltag), sonst traegt jeder spaetere Tag zwei Patches.
      for (const r of ranges) if (r.to > c.from_day) r.to = c.from_day;
      ranges.push({ patch: c.patch, from: c.from_day, to: c.from_day });
    }
    return { source: `Cache vom ${cache.savedAt}`, ranges: openNewest(ranges) };
  }
  // Rueckfall 2: Terminplan plus Schnitte. Kennt auch die Basis-Tage zwischen
  // zwei B-Patches, die patchCuts allein fehlen.
  const sched = scheduleRanges(j, setNumber, today);
  if (sched.length) return { source: 'Terminplan (tft-set.json)', ranges: sched };
  // Rueckfall 3: ohne Terminplan nur patchCuts. Bei mehr als einem Schnitt
  // fehlen die Basis-Tage dazwischen — dann lieber abbrechen, alte Datei bleibt.
  if (cuts.length > 1) throw new Error('Patch-RPC aus, kein Cache und mehrere B-Patches — Abbruch, alte Datei bleibt');
  if (cuts.length) {
    cuts.sort((a, b) => a.from_day.localeCompare(b.from_day));
    const ranges = [];
    if (j.setStartDate && j.setStartDate < cuts[0].from_day) ranges.push({ patch: cuts[0].base, from: j.setStartDate, to: null });
    cuts.forEach((c) => ranges.push({ patch: c.patch, from: c.from_day, to: null }));
    for (let i = 0; i < ranges.length - 1; i++) ranges[i].to = ranges[i + 1].from;
    ranges[ranges.length - 1].to = OPEN_END;
    return { source: 'tft-set.json', ranges };
  }
  throw new Error('keine Patch-Quelle erreichbar — Abbruch, alte Datei bleibt');
}

// ---------------------------------------------------------------------------
// Sperre, Stempel, Dateien

const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

// Alt-Tage loeschen (Teil-Aufbau) scheibenweise: units/traits sind nach
// Unit/Trait sortiert, ein Alt-Tag steckt also in fast jedem 2048er-Block,
// und DuckDB haelt die Loesch-Vermerke je Block bis zum CHECKPOINT im
// Speicher. 18.10.: DELETE units am Stueck (328.549 Boards, 137 Mio Zeilen)
// lief nach 7 s in die 900-MB-Grenze; an einer Kopie in Scheiben zu 12
// Units/Traits 52 s, Spitze 689 MB. Scheiben nach Zeilen, nicht nach
// Schluesseln: ein Schluessel ueber der Grenze bildet eine eigene Scheibe.
export const DELETE_SLICE_ROWS = 8_000_000;
export function sliceKeys(groups, maxRows = DELETE_SLICE_ROWS) {
  const out = [];
  let cur = [];
  let n = 0;
  for (const g of groups) {
    const c = Number(g.n);
    if (cur.length && n + c > maxRows) { out.push(cur); cur = []; n = 0; }
    cur.push(g.k);
    n += c;
  }
  if (cur.length) out.push(cur);
  return out;
}
// Bedingung fuer eine Scheibe; NULL-Schluessel (Trait ohne Namen) eigens.
export function sliceCond(col, keys) {
  const named = keys.filter((k) => k != null);
  const parts = [];
  if (named.length) parts.push(`${col} IN (${named.map(sqlStr).join(', ')})`);
  if (named.length < keys.length) parts.push(`${col} IS NULL`);
  return parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0];
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(p, obj) {
  fs.writeFileSync(`${p}.tmp`, JSON.stringify(obj, null, 2));
  fs.renameSync(`${p}.tmp`, p);
}

// Arbeitsdateien eines Laufs. Nie Stempel, aggtry, masktry oder force-full —
// das sind absichtliche Absturzspuren. Nur aufrufen, solange die Sperre gehalten
// wird (sonst trifft es die Dateien eines parallelen Hand-Laufs).
function cleanupFiles(files) {
  for (const f of [files.tmp, `${files.tmp}.wal`, files.work, `${files.work}.wal`, files.aggwork, `${files.aggwork}.wal`,
    files.maskwork, `${files.maskwork}.wal`]) {
    fs.rmSync(f, { force: true });
  }
  fs.rmSync(files.spill, { recursive: true, force: true });
}

function scratchSizes(files) {
  const size = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
  let spill = 0;
  try { for (const n of fs.readdirSync(files.spill)) spill += size(path.join(files.spill, n)); } catch { /* kein Ordner */ }
  return `work ${gb(size(files.work))}, tmp ${gb(size(files.tmp))}, Auslagerung ${gb(spill)}`;
}

// Lauf ohne neue Datei (skip, Fehler): Alarm in status.json, Datenstand
// (builtAt, lastFullAt, bytes) aus dem vorigen Eintrag — sonst wird
// explorer/datei-frische faelschlich gruen oder vollaufbau-frische zurueckgesetzt.
function writeStatusAlarm(files, { mode, reasons, alarms }) {
  const prev = readJson(files.status) || { builtAt: null, lastFullAt: null };
  writeJsonAtomic(files.status, {
    ...prev, alarms, lastRun: { at: new Date().toISOString(), mode, reasons, newFile: false },
  });
}

const procEnv = {
  bootId: (() => { try { return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch { return null; } })(),
  isAlive: (pid) => {
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
  },
  cmdline: (pid) => {
    try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch { return null; }
  },
};

function acquireLock(lockPath) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, bootId: procEnv.bootId, startedAt: new Date().toISOString() }));
      fs.closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const info = readJson(lockPath);
    // Halb geschriebene Sperre eines gerade startenden Laufs nicht wegraeumen.
    let young = false;
    try { young = Date.now() - fs.statSync(lockPath).mtimeMs < 60_000; } catch { /* weg */ }
    if (!info && young) return false;
    if (info && !lockIsStale(info, procEnv)) {
      log(`Sperre gehalten von pid ${info.pid} seit ${info.startedAt}`);
      return false;
    }
    log(`veraltete Sperre entfernt (${JSON.stringify(info)})`);
    fs.rmSync(lockPath, { force: true });
  }
  return false;
}

function releaseLock(lockPath) {
  const info = readJson(lockPath);
  if (info?.pid === process.pid) fs.rmSync(lockPath, { force: true });
}

// ---------------------------------------------------------------------------
// SQL-Bausteine, gleich fuer Voll- und Teil-Aufbau

// Boards aus den Rohzeilen. bid fortlaufend ab startBid, mid = Partie (fuer
// den Vertrauensbereich je Partie, weil ~2,5 unserer Spieler je Lobby sitzen),
// ph = Spieler, beide als 64-bit-Hash — stabil ueber Laeufe.
// Units und Traits werden hier EINMAL typisiert zerlegt (ul, tl); nu, nt und
// die Brett-Zaehler lesen daraus (Paket B, Stichprobe 18.10.: nu/nt bitgleich
// zu json_extract + ->>, Zaehler gleich der JS-Fassung bei 200.000 Brettern).
const b0Sql = (src, startBid, L) => `CREATE TABLE b0 AS
  ${countsSelectSql(`(SELECT (row_number() OVER () + ${startBid - 1})::UINTEGER AS bid, * EXCLUDE (units, traits),
    from_json(units, ${UNITS_JSON_TYPE}) AS ul, from_json(traits, ${TRAITS_JSON_TYPE}) AS tl,
    CAST(to_timestamp(game_datetime / 1000) AT TIME ZONE 'UTC' AS DATE) AS day,
    CAST(to_timestamp(game_datetime / 1000 - 18000) AT TIME ZONE 'UTC' AS DATE) AS pday,
    md5_number_upper(match_id) AS mid,
    md5_number_upper(puuid) AS ph
  FROM ${src})`, L)}`;

// Naechster Rang-Eintrag binnen ±3 Tagen je Spieler+Tag (erst je Paar, dann an
// die Boards — spart den Join ueber alle Boards). Reihenfolge: Abstand, frueher
// vor spaeter, Rangliste vor Snapshot, niedrigerer Rang.
const pdSql = (pairs) => `CREATE TABLE pd AS
  SELECT p.ph, p.day,
    arg_min(o.tier, (abs(date_diff('day', o.day, p.day)) * 2 + CASE WHEN o.day > p.day THEN 1 ELSE 0 END) * 100
      + o.src * 10 + o.tord) AS rank
  FROM ${pairs} p
  JOIN obs o ON o.ph = p.ph AND o.day BETWEEN p.day - INTERVAL 3 DAY AND p.day + INTERVAL 3 DAY
  GROUP BY p.ph, p.day`;

const boardsSql = `CREATE TABLE nb AS
  SELECT b.bid, b.mid, b.day, dp.patch, coalesce(dp.patch_edge, false) AS patch_edge,
    lower(regexp_extract(b.match_id, '^([A-Za-z0-9]+)_', 1)) AS region,
    rk.rank,
    b.placement::UTINYINT AS placement, b.level::UTINYINT AS level, b.last_round::USMALLINT AS last_round,
    b.gold_left::SMALLINT AS gold_left, b.total_damage::USMALLINT AS damage,
    b.comp_cluster_key AS comp_key,
    (b.game_datetime // 1000)::UINTEGER AS ts,
    ${[...Object.values(COUNT_COLS), 'tags'].map((c) => `b.${c}`).join(', ')},
    CASE WHEN regexp_matches(b.comp_cluster_key, '^(.+)@(\\d+)_([^#*~]+)')
      THEN regexp_extract(b.comp_cluster_key, '^(.+)@(\\d+)_([^#*~]+)', 1) || '__' || regexp_extract(b.comp_cluster_key, '^(.+)@(\\d+)_([^#*~]+)', 3)
      ELSE b.comp_cluster_key END AS family
  FROM b0 b
  LEFT JOIN day_patch dp USING (pday)
  LEFT JOIN rk USING (bid)`;

// units: characterId, Stern, bis zu 3 Items, Build-Schluessel (Items ohne
// Bauteile, sortiert — Builds-Reiter und „komplette Builds"). Alias-Kennungen
// werden auf ihre Quelle umgeschrieben (readUnitAliases).
const unitsSql = (aliases, compList) => `CREATE TABLE nu AS
    SELECT bid, ${unitIdSql('u.characterId', aliases)} AS unit, u.tier AS star,
      len(u.items)::UTINYINT AS n_items,
      u.items[1] AS i1, u.items[2] AS i2, u.items[3] AS i3,
      ${buildKeySql('u.items[1]', 'u.items[2]', 'u.items[3]', compList)} AS bk
    FROM (SELECT bid, unnest(ul) AS u FROM b0)
    WHERE u.characterId IS NOT NULL`;

// traits: nur aktive (tier_current > 0, num_units > 0).
const traitsSql = `CREATE TABLE nt AS
  WITH t AS (
    SELECT bid, x.name AS trait, x.tier_current AS lvl, x.num_units AS num_units
    FROM (SELECT bid, unnest(tl) AS x FROM b0)
  )
  SELECT t.bid, t.trait, t.lvl, t.num_units,
    CASE WHEN tm.tiers > 1 THEN (t.num_units::TINYINT - tm.min_units::TINYINT) END AS overcap
  FROM t LEFT JOIN trait_min tm ON tm.trait = t.trait AND tm.lvl = t.lvl
  WHERE t.lvl > 0 AND t.num_units > 0`;

const boardRankSql = `CREATE TABLE nbr AS
  SELECT b.rk_key AS k, b.bid, b.ph, b.pday, nb.rank FROM b0 b JOIN nb USING (bid)`;

// Spieler der neuen Boards (ph → puuid), fuer den Spiele-Reiter.
const playersSql = `CREATE TABLE np AS SELECT DISTINCT ph, puuid FROM b0 WHERE puuid IS NOT NULL`;

// ---------------------------------------------------------------------------

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL fehlt');
  const t0 = Date.now();
  const untilMs = UNTIL == null ? null : (/^\d+$/.test(UNTIL) ? Number(UNTIL) : Date.parse(UNTIL));
  if (UNTIL != null && !Number.isFinite(untilMs)) throw new Error(`--until=${UNTIL} ungueltig`);
  const win = buildWindow({ asof: ASOF, days: DAYS, now: t0 });
  const testRun = Boolean(ASOF || LIMIT || untilMs != null);
  const files = filesFor(OUT);
  fs.mkdirSync(files.dir, { recursive: true });
  if (!acquireLock(files.lock)) { log('anderer Lauf aktiv — Ende ohne Bau'); return 0; }
  try {
    return await build({ t0, win, testRun, untilMs, files });
  } catch (e) {
    // Innerhalb der Sperre und nach close() (finally in build): Arbeitsdateien
    // weg — am 17.10. blieben 22 GB .work liegen und hielten die Platte voll.
    // Ein harter Abbruch (Speichergrenze, Zeitlimit) erreicht das nicht; dann
    // raeumt der naechste Start auf.
    try { log(`Aufraeumen nach Fehler: ${scratchSizes(files)}`); cleanupFiles(files); } catch (ce) { log(`Aufraeumen gescheitert: ${ce.message}`); }
    try {
      const msg = String(e?.message || e).replace(/\s+/g, ' ').slice(0, 200);
      writeStatusAlarm(files, { mode: 'error', reasons: [], alarms: [`Aufbau gescheitert: ${msg}`] });
    } catch (se) { log(`status.json nicht geschrieben: ${se.message}`); }
    throw e;
  } finally {
    releaseLock(files.lock);
  }
}

async function build({ t0, win, testRun, untilMs, files }) {
  const setNumber = readSetNumber();
  const thresholds = readTraitThresholds(setNumber);
  const aliases = readUnitAliases(setNumber);
  const patches = await readPatchRanges(setNumber, ASOF || currentWindowDay());
  const dayPatch = dayPatchRows(patches.ranges, addDays(win.w, -1), win.n);
  const hashes = {
    aliases: sha1(JSON.stringify(aliases)),
    thresholds: sha1(JSON.stringify(thresholds)),
    set: String(setNumber),
    days: String(DAYS),
    counts: COUNTS_HASH,
  };
  const countLists = readCountsLists(setNumber);
  log(`Set ${setNumber}, Fenster ${win.w}..${win.n} (${DAYS} Tage), Rang frei ab ${win.f}, Patch-Quelle ${patches.source}`
    + ` (${patches.ranges.length} Bereiche), Ziel ${OUT}${testRun ? ', TESTLAUF' : ''}`);

  const { DuckDBInstance } = await import(DUCKDB_MODULE);
  const cleanup = () => cleanupFiles(files);
  cleanup();

  // Arbeitsdatei fuer Rohdaten + Zwischenschritte (5 GB Text passen nicht in
  // den RAM). Sie wird am Ende geloescht.
  const diskStart = freeBytesOf(files.dir);
  const db = await DuckDBInstance.create(files.work);
  const c = await db.connect();
  // Zweite Linie hinter diskGate: faellt der freie Platz unter die halbe
  // Reserve, wird die laufende Anweisung abgebrochen und jede weitere wirft.
  // Dauerhaft, weil Teilsummen und Masken Fehler abfangen und weiterlaufen.
  // diskMin = gemessene Spitze (status.json `disk`), Grundlage fuer die Faktoren.
  let diskAbort = null;
  let diskMin = diskStart;
  const watch = diskStart == null ? null : setInterval(() => {
    const f = freeBytesOf(files.dir);
    if (f == null) return;
    if (f < diskMin) diskMin = f;
    if (DISK_CHECK && !diskAbort && f < DISK_RESERVE_BYTES / 2) {
      diskAbort = `Platte fast voll (frei ${gb(f)}) — Aufbau abgebrochen, Reserve fuer Postgres`;
      log(diskAbort);
      try { c.interrupt(); } catch { /* nichts laeuft */ }
    }
  }, DISK_WATCH_MS);
  watch?.unref?.();
  const halt = (e) => (diskAbort ? new Error(diskAbort) : e);
  let tStep = Date.now();
  const head = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 110);
  const run = async (s) => {
    let r;
    try {
      if (diskAbort) throw halt();
      r = await c.run(s);
    } catch (e) {
      log(`  FEHLER nach ${((Date.now() - tStep) / 1000).toFixed(1)} s: ${head(s)}`);
      throw halt(e);
    }
    const m = /^\s*(CREATE (?:TEMP )?TABLE [\w.]+|INSERT INTO [\w.]+|UPDATE [\w.]+|DELETE FROM [\w.]+)/.exec(s);
    if (m) log(`  ${m[1]} ${((Date.now() - tStep) / 1000).toFixed(1)} s`);
    tStep = Date.now();
    return r;
  };
  const all = async (s) => {
    if (diskAbort) throw halt();
    try { return (await c.runAndReadAll(s)).getRowObjects(); } catch (e) { throw halt(e); }
  };
  // Schritt-Log fuer Teilsummen und Masken: Anweisungen ab 2 s mit Dauer, bei
  // Fehler die Anweisung selbst (Speicher-Abbrueche 14.10. waren ohne das
  // keiner Stelle zuzuordnen).
  const logged = (fn) => async (s) => {
    const t = Date.now();
    try {
      if (diskAbort) throw halt();
      const r = await fn(s);
      if (Date.now() - t >= 2000) log(`  ${head(s)} — ${((Date.now() - t) / 1000).toFixed(1)} s`);
      return r;
    } catch (e) {
      log(`  FEHLER nach ${((Date.now() - t) / 1000).toFixed(1)} s: ${head(s)}`);
      throw halt(e);
    }
  };
  const stepExec = logged((s) => c.run(s));
  const stepAll = logged(all);
  const one = async (s) => (await all(s))[0];
  const num = (v) => (v == null ? null : Number(v));
  let closed = false;
  const close = () => { if (!closed) { closed = true; c.closeSync?.(); db.closeSync?.(); } };

  try {
    const mem = /^\d+(\.\d+)?\s*(MB|GB|MiB|GiB)$/i.test(process.env.EXPLORER_BUILD_MEM || '')
      ? process.env.EXPLORER_BUILD_MEM : BUILD_MEM_DEFAULT;
    await run(`SET memory_limit=${sqlStr(mem)}`);
    await run(`SET threads=1`);
    await run(`SET preserve_insertion_order=false`);
    await run(`SET temp_directory=${sqlStr(files.spill)}`);
    await run(`SET extension_directory=${sqlStr(files.ext)}`);
    await run(`INSTALL postgres; LOAD postgres;`);
    await run(`ATTACH ${sqlStr(process.env.DATABASE_URL)} AS pg (TYPE postgres, READ_ONLY)`);
    const duckdbVersion = String((await one('SELECT version() AS v')).v);

    // Aenderungszaehler VOR dem Lesen: was danach geaendert wird, sieht der
    // naechste Lauf als Abweichung und baut voll.
    let nTupUpd = null;
    try {
      const r = await one(`SELECT n_tup_upd::DOUBLE AS n FROM postgres_query('pg',
        ${sqlStr("select n_tup_upd from pg_stat_user_tables where relname = 'tft_player_match_cache'")})`);
      nTupUpd = num(r?.n);
    } catch (e) {
      log(`Aenderungszaehler nicht lesbar (${e.message})`);
    }

    // Vorige Datei: Format, Wasserstand, Patch je Tag.
    let prev = { kind: 'none' };
    let prevAttached = false;
    if (fs.existsSync(OUT)) {
      try {
        await run(`ATTACH ${sqlStr(OUT)} AS prev (READ_ONLY)`);
        prevAttached = true;
        const tables = (await all(`SELECT table_name FROM duckdb_tables() WHERE database_name = 'prev'`)).map((r) => r.table_name);
        const metaCols = (await all(`SELECT column_name FROM duckdb_columns() WHERE database_name = 'prev' AND table_name = 'meta'`))
          .map((r) => r.column_name);
        if (!metaCols.includes('watermark_ms') || !tables.includes('day_patch') || !tables.includes('board_rank')) {
          prev = { kind: 'legacy', hasRank: tables.includes('board_rank') };
        } else {
          const m = await one(`SELECT watermark_ms::DOUBLE AS wm, script_version, duckdb_version, hashes,
            n_tup_upd::DOUBLE AS n_tup_upd, last_full_ms::DOUBLE AS last_full_ms, last_full_day::VARCHAR AS last_full_day,
            n_day::VARCHAR AS n_day, next_bid::DOUBLE AS next_bid, test_run FROM prev.meta`);
          const dp = await all(`SELECT pday::VARCHAR AS pday, patch, patch_edge AS edge FROM prev.day_patch`);
          prev = {
            kind: 'ok',
            hasRank: true,
            dayPatch: dp,
            meta: {
              watermarkMs: num(m.wm), scriptVersion: num(m.script_version), duckdbVersion: m.duckdb_version,
              hashes: (() => { try { return JSON.parse(m.hashes); } catch { return null; } })(),
              nTupUpd: num(m.n_tup_upd), lastFullMs: num(m.last_full_ms), lastFullDay: m.last_full_day,
              nDay: m.n_day, nextBid: num(m.next_bid), testRun: Boolean(m.test_run),
            },
          };
        }
      } catch (e) {
        prev = { kind: 'unreadable', error: e.message };
        if (prevAttached) { try { await run('DETACH prev'); } catch { /* egal */ } prevAttached = false; }
      }
    }

    const patchChanged = prev.kind === 'ok' ? diffDayPatch(prev.dayPatch, dayPatch) : [];
    const stamp = readJson(files.stamp);
    let markerMtime = null;
    try { markerMtime = fs.statSync(files.marker).mtimeMs; } catch { /* keine Markierung */ }
    const todayUtc = new Date().toISOString().slice(0, 10);
    const hourUtc = new Date(t0).getUTCHours();
    const code = buildCodeHash();
    const modeDecision = decideMode({
      full: FULL, marker: markerMtime != null, prev,
      cur: { scriptVersion: SCRIPT_VERSION, duckdbVersion, hashes, nTupUpd, testRun, n: win.n, code },
      patchChanged, f: win.f, stamp, hourUtc,
    });
    const prevBytes = (() => { try { return fs.statSync(OUT).size; } catch { return 0; } })();
    const decision = DISK_CHECK
      ? diskGate({ decision: modeDecision, freeBytes: diskStart, prevBytes, reserveBytes: DISK_RESERVE_BYTES })
      : { ...modeDecision, disk: null };
    const mode = decision.mode;
    log(`Art: ${mode}${decision.reasons.length ? ` — ${decision.reasons.join('; ')}` : ''} (Code ${code}, Speicher ${mem}`
      + `${decision.disk ? `, Platte frei ${gb(decision.disk.freeBytes)} / noetig ${gb(decision.disk.needBytes)}` : ''})`);
    // Vollaufbau im Abendfenster darf laenger (Summen + Masken nach dem Kern);
    // nachts (nur Pflichtgruende) gilt die alte Grenze.
    const totalAlarmS = mode === 'full' && inFullWindow(hourUtc) ? TOTAL_ALARM_FULL_S : TOTAL_ALARM_S;
    const alarms = [];
    if (modeDecision.blocked) alarms.push(`Vollaufbau gesperrt: mit Code ${code} schon gescheitert — Code aendern oder --full`);
    if (decision.diskAlarm) alarms.push(decision.diskAlarm);
    if (prev.kind === 'unreadable') {
      log(`ACHTUNG: vorige Datei unlesbar (${prev.error}) — Raenge vor ${win.f} werden aus den heutigen Quellen neu bestimmt`);
      alarms.push('vorige Datei unlesbar, eingefrorene Raenge verloren');
    }
    if (mode === 'skip') {
      log(decision.diskSkip
        ? `kein Bau: ${decision.diskAlarm} — alte Datei bleibt`
        : 'kein Bau: Vollaufbau noetig, aber mit diesem Code-Stand schon gescheitert — mit --full erzwingen');
      if (prevAttached) await run('DETACH prev');
      close();
      cleanup();
      writeStatusAlarm(files, { mode, reasons: decision.reasons, alarms });
      return decision.diskSkip ? 3 : 2;
    }
    if (diskStart != null && DISK_CHECK) {
      const cap = spillCapBytes({ mode, freeBytes: diskStart, prevBytes, reserveBytes: DISK_RESERVE_BYTES });
      await run(`SET max_temp_directory_size=${sqlStr(`${Math.floor(cap / GIB)}GiB`)}`);
      log(`Auslagerung hoechstens ${Math.floor(cap / GIB)} GiB`);
    }
    if (mode === 'full') writeJsonAtomic(files.stamp, { day: todayUtc, startedMs: Date.now(), code });

    // Hilfstabellen: Patch je Sammeltag (in JS bestimmt), Trait-Schwellen.
    await run(`CREATE TABLE day_patch(pday DATE, patch VARCHAR, patch_edge BOOLEAN)`);
    await run(`INSERT INTO day_patch VALUES ${dayPatch
      .map((r) => `(${sqlStr(r.pday)}::DATE, ${r.patch == null ? 'NULL' : sqlStr(r.patch)}, ${r.edge})`).join(',')}`);
    await run(`CREATE TABLE trait_min(trait VARCHAR, lvl UTINYINT, min_units UTINYINT, tiers UTINYINT)`);
    await run(`INSERT INTO trait_min VALUES ${thresholds.map((t) => `(${sqlStr(t.id)}, ${t.lvl}, ${t.min}, ${t.tiers})`).join(',')}`);

    const components = readComponents(ROOT, setNumber, log);
    const compList = compListSql(components);
    const compHash = componentsHash(components);

    // Voll: Rang aus der vorigen Datei (auch alte Form, dort nur bekannte
    // Raenge). Teil: vorige Datei wird die Arbeitskopie.
    const outdb = 'outdb';
    // Vollaufbau mit Uebernahme (Paket 5c): carryPrep = gesicherte Summen +
    // Tages-Fingerabdruck der vorigen Datei; carryInfo fuer Log und status.json.
    let carryPrep = null;
    const carryInfo = { reason: mode === 'full' ? null : 'Teil-Aufbau', fpOldS: null, fpNewS: null };
    const dropCarry = async () => {
      for (const t of ['cv_rows', 'cv_head', 'cv_kd', 'cv_nkd', 'cv_nb']) {
        try { await run(`DROP TABLE IF EXISTS ${t}`); } catch { /* egal */ }
      }
    };
    if (mode === 'full') {
      if (prev.hasRank) {
        // GROUP BY statt DISTINCT ON … ORDER BY: gleiche Bedeutung (kleinster
        // Rang je k, NULL nur ohne Rang), aber ohne Sortierung von 14,9 Mio
        // Zeilen — die lief ab 15.10. in die Speichergrenze (Messung 17.10.:
        // DISTINCT ON Abbruch nach 33 s, GROUP BY 27,6 s).
        await run(`CREATE TABLE prev_rank AS SELECT k, min(rank) AS rank FROM prev.board_rank GROUP BY k`);
      } else {
        await run(`CREATE TABLE prev_rank(k UBIGINT, rank VARCHAR)`);
      }
      carryInfo.reason = aggCarryBlocked({
        prevKind: prev.kind, prevTestRun: prev.meta?.testRun, testRun, carryEnv: process.env.AGG_CARRY,
        budgetS: aggBudgetS(process.env.AGG_BUDGET_S), aggtryExists: fs.existsSync(files.aggtry),
      });
      if (!carryInfo.reason) {
        try {
          carryInfo.reason = await aggBindingReason({ all, db: 'prev', nextBid: prev.meta.nextBid, compHash });
          if (!carryInfo.reason) {
            carryPrep = await aggCarrySave({ exec: run, all, db: 'prev', f: win.f });
            carryInfo.fpOldS = carryPrep.s;
            log(`Teilsummen-Uebernahme: vorige Summen gesichert, ${carryPrep.covered.length} Tage gedeckt, Fingerabdruck alt ${carryPrep.s} s`);
          }
        } catch (e) {
          carryInfo.reason = `Vorbereitung gescheitert: ${e.message}`;
          alarms.push(`Teilsummen-Uebernahme gescheitert: ${e.message}`);
          carryPrep = null;
          await dropCarry();
        }
      }
      if (carryInfo.reason) log(`Teilsummen-Uebernahme: nein (${carryInfo.reason})`);
      if (prevAttached) { await run('DETACH prev'); prevAttached = false; }
      await run(`ATTACH ${sqlStr(files.tmp)} AS ${outdb}`);
    } else {
      await run('DETACH prev');
      prevAttached = false;
      fs.copyFileSync(OUT, files.tmp);
      await run(`ATTACH ${sqlStr(files.tmp)} AS ${outdb}`);
    }

    // 1) Rohdaten in einem einzigen Lauf holen. jsonb kommt als Text und wird
    //    in DuckDB zerlegt — Postgres macht nur den Scan.
    const scanStart = Date.now();
    const sinceMs = mode === 'delta' ? prev.meta.watermarkMs - MARGIN_MS : null;
    const pgSql = rawSql({ setNumber, wMs: win.wMs, endMs: win.endMs, sinceMs, untilMs, limit: LIMIT });
    await run(`CREATE TABLE raw AS SELECT * FROM postgres_query('pg', ${sqlStr(pgSql)})`);
    const scanS = (Date.now() - scanStart) / 1000;
    const rawStats = await one('SELECT count(*) AS n, max(fetched_ms)::DOUBLE AS wm FROM raw');
    const rawN = Number(rawStats.n);
    log(`Rohdaten: ${rawN} Zeilen in ${scanS.toFixed(1)} s${sinceMs != null ? ` (angekommen ab ${new Date(sinceMs).toISOString()})` : ''}`);
    if (mode === 'full' && rawN === 0) throw new Error('0 Boards gelesen — Abbruch, alte Datei bleibt');
    const scanAlarmText = scanAlarm({ mode, scanS });
    if (scanAlarmText) alarms.push(scanAlarmText);
    await run(`CREATE TABLE rawk AS SELECT md5_number_upper(match_id || puuid) AS rk_key, * FROM raw`);
    await run('DROP TABLE raw');
    let src = 'rawk';
    if (mode === 'delta') {
      // Schon in der Datei (Ueberlappung durch die 3 h Vorlauf): weglassen.
      await run(`CREATE TABLE fresh AS SELECT r.* FROM rawk r
        WHERE NOT EXISTS (SELECT 1 FROM ${outdb}.board_rank br WHERE br.k = r.rk_key)`);
      await run('DROP TABLE rawk');
      src = 'fresh';
    }

    // Rang-Quellen: Marktwert-Snapshot (Diamant+) und Rangliste (Emerald+,
    // taeglich 04:30, nach 10 Tagen geloescht).
    const snapSql = `select puuid, snapshot_date, tier from tft_player_marketvalue_snapshots
      where set_number = ${setNumber} and tier in ('DIAMOND','MASTER','GRANDMASTER','CHALLENGER')`;
    await run(`CREATE TABLE snaps AS SELECT * FROM postgres_query('pg', ${sqlStr(snapSql)})`);
    const ladderSql = `select puuid, day, tier from tft_ladder_daily
      where set_number = ${setNumber} and tier in ('EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER')`;
    await run(`CREATE TABLE ladder AS SELECT * FROM postgres_query('pg', ${sqlStr(ladderSql)})`);
    await run('DETACH pg');
    const tord = `CASE tier WHEN 'EMERALD' THEN 1 WHEN 'DIAMOND' THEN 2 WHEN 'MASTER' THEN 3 WHEN 'GRANDMASTER' THEN 4 ELSE 5 END`;
    await run(`CREATE TABLE obs AS
      SELECT md5_number_upper(puuid) AS ph, snapshot_date::DATE AS day, tier, 1 AS src, ${tord} AS tord FROM snaps
      UNION ALL SELECT md5_number_upper(puuid), day::DATE, tier, 0, ${tord} FROM ladder`);
    await run('DROP TABLE snaps');
    await run('DROP TABLE ladder');

    // 2) Neue Boards.
    const startBid = mode === 'delta' ? prev.meta.nextBid : 1;
    await run(b0Sql(src, startBid, countLists));
    await run(`DROP TABLE ${src}`);
    const fLit = `DATE ${sqlStr(win.f)}`;

    if (mode === 'full') {
      await run(pdSql('(SELECT DISTINCT ph, day FROM b0)'));
      // Ab Stichtag − 7 frisch (fehlt die Quelle, der alte Rang), davor der
      // eingefrorene, wenn das Board schon in der vorigen Datei stand.
      await run(`CREATE TABLE rk AS
        SELECT b.bid,
          CASE WHEN b.day >= ${fLit} THEN coalesce(pd.rank, pr.rank)
               WHEN pr.k IS NOT NULL THEN pr.rank
               ELSE pd.rank END AS rank
        FROM b0 b
        LEFT JOIN pd ON pd.ph = b.ph AND pd.day = b.day
        LEFT JOIN prev_rank pr ON pr.k = b.rk_key`);
    } else {
      // Vorhandene Boards ab Stichtag − 7: Rang neu bestimmen.
      await run(`CREATE TABLE ex AS
        SELECT br.bid, br.ph, b.day, br.rank AS old_rank
        FROM ${outdb}.board_rank br JOIN ${outdb}.boards b ON b.bid = br.bid
        WHERE b.day >= ${fLit}`);
      await run(pdSql('(SELECT ph, day FROM ex UNION SELECT ph, day FROM b0)'));
      await run(`CREATE TABLE rk AS SELECT b.bid, pd.rank FROM b0 b LEFT JOIN pd ON pd.ph = b.ph AND pd.day = b.day`);
    }
    await run(boardsSql);
    await run(unitsSql(aliases, compList));
    await run(traitsSql);
    await run(boardRankSql);
    await run(playersSql);
    await run('DROP TABLE b0');

    if (mode === 'full') {
      // Sortiert kopieren: units nach Unit, traits nach Trait — Filter "mit
      // Unit X" lesen dann nur die passenden Bloecke.
      await run(`CREATE TABLE ${outdb}.boards AS SELECT * FROM nb ORDER BY bid`);
      await run(`CREATE TABLE ${outdb}.units AS SELECT * FROM nu ORDER BY unit, bid`);
      await run(`CREATE TABLE ${outdb}.traits AS SELECT * FROM nt ORDER BY trait, bid`);
      await run(`CREATE TABLE ${outdb}.board_rank AS SELECT * FROM nbr ORDER BY bid`);
      await run(`CREATE TABLE ${outdb}.players AS SELECT * FROM np ORDER BY ph`);
      await run(`CREATE TABLE ${outdb}.day_patch AS SELECT * FROM day_patch ORDER BY pday`);
    } else {
      // Tage vor dem Fenster raus.
      await run(`CREATE TABLE gone AS SELECT bid FROM ${outdb}.boards WHERE day < DATE ${sqlStr(win.w)}`);
      const nGone = Number((await one('SELECT count(*) AS n FROM gone')).n);
      if (nGone) {
        // Nach jeder Scheibe bzw. Tabelle CHECKPOINT: gibt die Loesch-Vermerke
        // frei, bevor die naechste beginnt (11.–13.10. lief DELETE traits
        // direkt nach DELETE units in die Speichergrenze, 18.10. schon DELETE
        // units allein — sliceKeys). Neuschreiben per CREATE … AS SELECT
        // waere 520 s statt ~60 s und blaeht die Datei um 1 GB auf (17.10.).
        for (const [t, col] of [['units', 'unit'], ['traits', 'trait']]) {
          const groups = await all(`SELECT ${col} AS k, count(*) AS n FROM ${outdb}.${t} GROUP BY 1 ORDER BY 1`);
          for (const keys of sliceKeys(groups)) {
            await run(`DELETE FROM ${outdb}.${t} WHERE ${sliceCond(col, keys)} AND bid IN (SELECT bid FROM gone)`);
            await run(`CHECKPOINT ${outdb}`);
          }
        }
        for (const t of ['board_rank', 'boards']) {
          await run(`DELETE FROM ${outdb}.${t} WHERE bid IN (SELECT bid FROM gone)`);
          await run(`CHECKPOINT ${outdb}`);
        }
      }
      // Rang der letzten 7 Tage: nur geaenderte Zeilen schreiben.
      await run(`CREATE TABLE chg AS
        SELECT ex.bid, coalesce(pd.rank, ex.old_rank) AS rank
        FROM ex LEFT JOIN pd ON pd.ph = ex.ph AND pd.day = ex.day
        WHERE coalesce(pd.rank, ex.old_rank) IS DISTINCT FROM ex.old_rank`);
      const nChg = Number((await one('SELECT count(*) AS n FROM chg')).n);
      if (nChg) {
        await run(`UPDATE ${outdb}.boards AS t SET rank = c.rank FROM chg AS c WHERE t.bid = c.bid`);
        await run(`UPDATE ${outdb}.board_rank AS t SET rank = c.rank FROM chg AS c WHERE t.bid = c.bid`);
      }
      // Patch der Tage, deren Zuordnung sich geaendert hat (alte Tage →
      // Vollaufbau, siehe decideMode).
      if (patchChanged.length) {
        await run(`CREATE TABLE pchg AS
          SELECT br.bid, d.patch, d.patch_edge FROM ${outdb}.board_rank br JOIN day_patch d ON d.pday = br.pday
          WHERE br.pday IN (${patchChanged.map((d) => `DATE ${sqlStr(d)}`).join(', ')})`);
        await run(`UPDATE ${outdb}.boards AS t SET patch = p.patch, patch_edge = p.patch_edge FROM pchg AS p WHERE t.bid = p.bid`);
      }
      log(`Teil-Aufbau: ${nGone} Boards vor ${win.w} entfernt, ${nChg} Raenge neu, Patch neu fuer ${patchChanged.join(', ') || 'keinen Tag'}`);
      await run(`INSERT INTO ${outdb}.boards BY NAME SELECT * FROM nb ORDER BY bid`);
      await run(`INSERT INTO ${outdb}.units BY NAME SELECT * FROM nu ORDER BY unit, bid`);
      await run(`INSERT INTO ${outdb}.traits BY NAME SELECT * FROM nt ORDER BY trait, bid`);
      await run(`INSERT INTO ${outdb}.board_rank BY NAME SELECT * FROM nbr ORDER BY bid`);
      // Spieler bleiben, auch wenn ihre alten Boards aus dem Fenster fallen
      // (der Wochen-Vollaufbau raeumt auf); neu nur, wer noch fehlt.
      await run(`INSERT INTO ${outdb}.players SELECT * FROM np n
        WHERE NOT EXISTS (SELECT 1 FROM ${outdb}.players p WHERE p.ph = n.ph)`);
      await run(`DELETE FROM ${outdb}.day_patch`);
      await run(`INSERT INTO ${outdb}.day_patch SELECT * FROM day_patch ORDER BY pday`);
    }

    // Pruefungen vor dem Tausch.
    const stats = await one(`SELECT count(*) AS boards, count(DISTINCT bid) AS bids, count(DISTINCT mid) AS matches,
      max(bid)::DOUBLE AS max_bid, count(rank) AS ranked, count(*) - count(patch) AS no_patch,
      min(day)::VARCHAR AS min_day, max(day)::VARCHAR AS max_day FROM ${outdb}.boards`);
    const boards = Number(stats.boards);
    const matches = Number(stats.matches);
    if (boards === 0) throw new Error('0 Boards in der neuen Datei — kein Tausch');
    if (Number(stats.bids) !== boards) throw new Error(`Board-Nummern doppelt (${stats.bids} / ${boards}) — kein Tausch`);
    const perMatch = boards / Math.max(1, matches);
    if (!(perMatch >= 1 && perMatch <= 8)) throw new Error(`Boards je Partie ${perMatch} unplausibel — kein Tausch`);
    const maxPerMatch = Number((await one(`SELECT max(n) AS n FROM (SELECT count(*) AS n FROM ${outdb}.boards GROUP BY mid)`)).n);
    if (maxPerMatch > 8) throw new Error(`${maxPerMatch} Boards in einer Partie — kein Tausch`);
    const br = await one(`SELECT count(*) AS n, count(DISTINCT k) AS nk FROM ${outdb}.board_rank`);
    if (Number(br.n) !== Number(br.nk)) throw new Error(`board_rank-Schluessel doppelt (${br.nk} / ${br.n}) — kein Tausch`);
    if (Number(br.n) !== boards) throw new Error(`board_rank ${br.n} Zeilen, boards ${boards} — kein Tausch`);
    // Paket B+C: neue Spalten nie NULL, jeder Spieler eindeutig und vorhanden.
    const newCols = [...Object.values(COUNT_COLS), 'tags', 'ts'];
    const nulls = await one(`SELECT ${newCols.map((col) => `count(*) - count(${col}) AS ${col}`).join(', ')} FROM ${outdb}.boards`);
    const nullCols = newCols.filter((col) => Number(nulls[col]));
    if (nullCols.length) throw new Error(`NULL in boards.${nullCols.join('/')} — kein Tausch`);
    const pl = await one(`SELECT count(*) AS n, count(DISTINCT ph) AS nph,
      (SELECT count(*) FROM ${outdb}.board_rank br WHERE NOT EXISTS (SELECT 1 FROM ${outdb}.players p WHERE p.ph = br.ph)) AS miss
      FROM ${outdb}.players`);
    if (Number(pl.n) !== Number(pl.nph)) throw new Error(`players-Schluessel doppelt (${pl.nph} / ${pl.n}) — kein Tausch`);
    if (Number(pl.miss)) throw new Error(`${pl.miss} Boards ohne Spieler — kein Tausch`);
    if (mode === 'delta') {
      const orphans = await one(`SELECT
        (SELECT count(*) FROM ${outdb}.board_rank x WHERE NOT EXISTS (SELECT 1 FROM ${outdb}.boards b WHERE b.bid = x.bid)) AS br,
        (SELECT count(*) FROM ${outdb}.units x WHERE NOT EXISTS (SELECT 1 FROM ${outdb}.boards b WHERE b.bid = x.bid)) AS u,
        (SELECT count(*) FROM ${outdb}.traits x WHERE NOT EXISTS (SELECT 1 FROM ${outdb}.boards b WHERE b.bid = x.bid)) AS t`);
      if (Number(orphans.br) || Number(orphans.u) || Number(orphans.t)) {
        throw new Error(`Zeilen ohne Board (board_rank ${orphans.br}, units ${orphans.u}, traits ${orphans.t}) — kein Tausch`);
      }
    }
    const nNoTraitMin = Number((await one(`SELECT count(*) AS n FROM nt t WHERE NOT EXISTS
      (SELECT 1 FROM trait_min m WHERE m.trait = t.trait)`)).n);

    // Datenstand + Fingerabdruecke. Die ersten acht Spalten liest der
    // Explorer-Dienst (scripts/explorer-duckdb-server.mjs).
    const finishedMs = Date.now();
    const watermark = Math.max(prev.kind === 'ok' && mode === 'delta' ? prev.meta.watermarkMs : -Infinity,
      rawStats.wm == null ? -Infinity : Number(rawStats.wm));
    const lastFullMs = mode === 'full' ? finishedMs : prev.meta.lastFullMs;
    const lastFullDay = mode === 'full' ? win.n : prev.meta.lastFullDay;
    // Nummern nie wiederverwenden, auch wenn das hoechste Board rausgefallen ist.
    const nextBid = Math.max(Number(stats.max_bid) + 1, mode === 'delta' ? prev.meta.nextBid : 1);

    // Vollaufbau mit Uebernahme: Fingerabdruck der alten Boards (Schluessel k
    // schon in der vorigen Datei) in der neuen Datei. Gleich je Tag → die
    // vorigen Summen des Tages gelten; neue Boards (cv_nb) kommen ueber das
    // Partie-Delta dazu. Zeitgrenze ist die harte Grenze (aggCarryLate).
    let carry = null;
    let maskCarry = null;
    if (carryPrep) {
      try {
        if (aggCarryLate({ nowMs: Date.now(), t0Ms: t0, fpOldS: carryInfo.fpOldS })) {
          carryInfo.reason = 'zu spaet fuer den Fingerabdruck';
        } else {
          const r = await aggCarryMatch({ exec: run, all, outdb, prevKeys: 'prev_rank', f: win.f, prep: carryPrep });
          carryInfo.fpNewS = r.s;
          carry = { days: r.days, rows: 'cv_rows', head: 'cv_head' };
          // Masken-Uebernahme: dieselben Tages-Fingerabdruecke, Quelle = vorige Datei.
          maskCarry = { path: OUT, oldFp: carryPrep.oldFp, newFp: r.newFp };
          if (!r.days.length) carryInfo.reason = 'kein Tag gleich';
          log(`Teilsummen-Uebernahme: ${r.days.length}/${r.nDays} Tage gleich, ${r.differ.length} anders`
            + `${r.differ.length ? ` (${r.differ.join(', ')})` : ''}, ${r.uncovered.length} ungedeckt, ${r.noOld.length} ohne alte Boards,`
            + ` Fingerabdruck neu ${r.s} s, ${r.nNew} neue Boards`);
        }
      } catch (e) {
        carry = null;
        carryInfo.reason = `Fingerabdruck gescheitert: ${e.message}`;
        alarms.push(`Teilsummen-Uebernahme gescheitert: ${e.message}`);
      }
      if (!carry) log(`Teilsummen-Uebernahme: nein (${carryInfo.reason})`);
    }

    // Tages-Teilsummen fuer die filterlosen Ansichten (Paket 5b). Liest die
    // alte meta (Kennung) und laeuft deshalb davor. Scheitert er, bleibt die
    // Datei gueltig — ohne Summen, der Dienst rechnet dann live.
    const tAgg = Date.now();
    const agg = await aggStep({
      exec: stepExec, all: stepAll, log, outdb, mode, win, startBid, nextBid, patchChanged, t0Ms: t0, files,
      compList, compHash, newBoards: carry ? 'cv_nb' : 'nb', carry,
    });
    alarms.push(...agg.alarms);

    // Platz-Masken fuer gefilterte Ansichten (Paket 6): nur im Rest des
    // Teilsummen-Budgets, im Vollaufbau nie ueber den Laufzeit-Alarm. Liest
    // ebenfalls die alte meta. Scheitert er, bleibt die Datei gueltig — ohne
    // Masken, der Dienst rechnet dann wie bisher.
    const mask = await maskStep({
      exec: stepExec, all: stepAll, log, outdb, mode, win, newBoards: carry ? 'cv_nb' : 'nb', t0Ms: t0, aggStartMs: tAgg,
      files, compList, compHash, carry: carry ? maskCarry : null,
      capMs: mode === 'full' ? t0 + (totalAlarmS - 600) * 1000 : null,
    });
    alarms.push(...mask.alarms);
    await dropCarry();
    tStep = Date.now();

    await run(`DROP TABLE IF EXISTS ${outdb}.meta`);
    await run(`CREATE TABLE ${outdb}.meta AS SELECT
      now() AS built_at, ${setNumber}::INTEGER AS set_number, ${DAYS}::INTEGER AS days,
      ${sqlStr(patches.source)} AS patch_source,
      ${boards}::BIGINT AS boards, ${matches}::BIGINT AS matches,
      ${sqlStr(stats.min_day)}::DATE AS min_day, ${sqlStr(stats.max_day)}::DATE AS max_day,
      ${Number.isFinite(watermark) ? watermark : 'NULL'}::BIGINT AS watermark_ms,
      ${SCRIPT_VERSION}::INTEGER AS script_version, ${sqlStr(duckdbVersion)} AS duckdb_version,
      ${sqlStr(JSON.stringify(hashes))} AS hashes, ${nTupUpd == null ? 'NULL' : nTupUpd}::BIGINT AS n_tup_upd,
      ${lastFullMs == null ? 'NULL' : lastFullMs}::BIGINT AS last_full_ms,
      ${lastFullDay ? sqlStr(lastFullDay) : 'NULL'}::DATE AS last_full_day,
      ${sqlStr(win.n)}::DATE AS n_day, ${nextBid}::BIGINT AS next_bid,
      ${testRun} AS test_run, ${sqlStr(mode)} AS mode, ${agg.token ? sqlStr(agg.token) : 'NULL'}::VARCHAR AS agg_token,
      ${mask.token ? sqlStr(mask.token) : 'NULL'}::VARCHAR AS mask_token,
      ${sqlStr(compHash)}::VARCHAR AS bk_comp_hash`);
    await run(`CHECKPOINT ${outdb}`);
    await run(`DETACH ${outdb}`);
    close();
    const freeEnd = freeBytesOf(files.dir);  // .work + .tmp voll: meist die Spitze
    if (freeEnd != null && diskMin != null && freeEnd < diskMin) diskMin = freeEnd;

    fs.renameSync(files.tmp, OUT);
    cleanup();
    if (mode === 'full' && markerMtime != null && markerMtime <= scanStart) fs.rmSync(files.marker, { force: true });
    const size = fs.statSync(OUT).size;
    const totalS = (Date.now() - t0) / 1000;
    if (totalS > totalAlarmS) alarms.push(`Laufzeit ${Math.round(totalS)} s (Grenze ${totalAlarmS} s)`);
    // Datenstand fuer die Vertraege explorer/datei-frische und
    // explorer/vollaufbau-frische (infra/contracts.json).
    writeJsonAtomic(files.status, {
      builtAt: new Date().toISOString(), setNumber, boards, matches,
      minDay: stats.min_day, maxDay: stats.max_day, bytes: size,
      mode, reasons: decision.reasons, lastFullAt: lastFullMs == null ? null : new Date(lastFullMs).toISOString(),
      durations: {
        totalS: Math.round(totalS), scanS: Math.round(scanS), aggS: agg.s, fpOldS: carryInfo.fpOldS, fpNewS: carryInfo.fpNewS,
        maskS: mask.s, maskCopyS: mask.copyS, maskCalcS: mask.calcS,
      },
      aggDays: { covered: agg.covered, total: agg.total }, aggNew: agg.newDays, aggSig: agg.token ? AGG_SIG : null,
      aggCarried: agg.carried, aggCarryReason: carryInfo.reason, aggPartCapped: agg.partCapped,
      maskDays: { covered: mask.covered, total: mask.total }, maskNew: mask.newDays, maskCarried: mask.carried,
      maskPartCapped: mask.partCapped,
      maskFailed: mask.failed, maskSig: mask.token ? MASK_SIG : null,
      // Platz: Spitze = frei beim Start − kleinster gemessener Wert (alle 20 s);
      // Grundlage fuer DISK_FULL_FACTOR / DISK_DELTA_FACTOR.
      disk: diskStart == null ? null : {
        freeStartGb: +(diskStart / GIB).toFixed(1), minFreeGb: +(diskMin / GIB).toFixed(1),
        peakUsedGb: +((diskStart - diskMin) / GIB).toFixed(1), prevBytes,
        needGb: decision.disk ? +(decision.disk.needBytes / GIB).toFixed(1) : null,
      },
      alarms,
    });
    log(`fertig (${mode}) in ${totalS.toFixed(1)} s: ${boards} Boards / ${matches} Partien, Rang bekannt ${stats.ranked},`
      + ` ohne Patch ${stats.no_patch}, neue Traits ohne Bundle-Schwelle ${nNoTraitMin}, ${stats.min_day}..${stats.max_day},`
      + ` Teilsummen ${agg.token ? `${agg.covered}/${agg.total} Tage` : 'keine'},`
      + ` Masken ${mask.token ? `${mask.covered}/${mask.total} Tage` : 'keine'},`
      + ` ${(size / 1e6).toFixed(0)} MB${alarms.length ? `, ALARM: ${alarms.join('; ')}` : ''}`);
    return 0;
  } finally {
    if (watch) clearInterval(watch);
    // Nach „Platte voll" kann schon das Schliessen werfen — der eigentliche
    // Fehler soll nicht verdeckt werden (main raeumt danach auf).
    try { close(); } catch (e) { log(`Schliessen gescheitert: ${e.message}`); }
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main().then((code) => process.exit(code)).catch((e) => {
    console.error(`[explorer-build] FEHLER: ${e.stack || e.message}`);
    process.exit(1);
  });
}
