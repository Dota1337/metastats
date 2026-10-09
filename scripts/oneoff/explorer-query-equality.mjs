#!/usr/bin/env node
// Abgleich der Explorer-Abfrage (Paket 6, Akzeptanzkriterium 2) auf einer
// LOKALEN KOPIE der Explorer-Datei. Fasst die Quelle nie an: sie wird in den
// --tmp-Ordner kopiert und die Kopie nur lesend geoeffnet.
//
// Wege, die gegeneinander rechnen (Ergebnis komplett, ohne ms/cached/src):
//   alt  runQuery aus Commit --ref (Standard c7123bf: vor dem Herausziehen
//        von liveRows), per `git show` samt explorer-agg.mjs desselben Stands
//   neu  runQuery aus dem Arbeitsstand scripts/lib/explorer-query.mjs
//   weitere per --way=<name>=<modul.mjs>: das Modul exportiert
//        makeWay(ctx) → async (q) => Ergebnis wie runQuery. ctx siehe unten;
//        so steckt Runde 2 den Masken-Weg ein, ohne dieses Skript umzubauen.
// Jeder Fall laeuft je Reiter: Uebersicht, Units, Units Sterne, Items, Items
// mit Fokus, Traits, Traits Uebercap, Comps, Level, Runde. Verglichen wird
// jeder Weg gegen den ersten.
//
// Aufruf: node scripts/oneoff/explorer-query-equality.mjs --duckdb=<.../node-api/lib/index.js>
//           --src=<explorer.duckdb> --tmp=<Ordner> [--ref=c7123bf] [--way=name=modul.mjs]...
//           [--only=fall,fall] [--tabs=Units,Items] [--threads=2] [--mem=1GB] [--keep] [--skip-old]
// --keep laesst die Kopie liegen (sonst am Ende geloescht). --skip-old laesst
// den Weg alt weg (dann ist neu der Bezug). --threads/--mem gelten fuer die
// gemeinsame Instanz (alt, neu); eingesteckte Wege koennen eigene oeffnen.
// Exit 0 = alles gleich, 1 = Abweichung oder Fehler.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readComponents, componentsHash } from '../lib/explorer-components.mjs';
import * as current from '../lib/explorer-query.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const args = (n) => process.argv.filter((a) => a.startsWith(`--${n}=`)).map((a) => a.slice(n.length + 3));
const DUCK = arg('duckdb');
const SRC = arg('src');
const TMP = arg('tmp');
const REF = arg('ref') || 'c7123bf';
const KEEP = process.argv.includes('--keep');
const SKIP_OLD = process.argv.includes('--skip-old');
const THREADS = arg('threads') || '2';
const MEM = arg('mem') || '1GB';
if (!DUCK || !SRC || !TMP) { console.error('--duckdb, --src und --tmp angeben'); process.exit(1); }
const fwd = (p) => p.split(path.sep).join('/');
const log = (...a) => console.log(`[query-eq ${new Date().toISOString().slice(11, 19)}]`, ...a);
// Ohne Zeitgrenze im Abgleich: eine lokale Rechnung darf laenger als 15 s brauchen.
const TIMEOUT_MS = 3_600_000;

const { DuckDBInstance } = await import(pathToFileURL(DUCK).href);
fs.mkdirSync(TMP, { recursive: true });
const P = (f) => path.join(TMP, f);
// Dateiname = Datenbank-Name in DuckDB (current_database() im Masken-Weg).
const COPY = P('query_eq.duckdb');
for (const x of [COPY, `${COPY}.wal`]) fs.rmSync(x, { force: true });
fs.copyFileSync(SRC, COPY);

// Alter Stand: beide Dateien aus dem Commit in einen eigenen Ordner, damit der
// Import von explorer-agg.mjs auf denselben Stand zeigt.
let old = null;
if (!SKIP_OLD) {
  const OLD = P(`old-${REF}`);
  fs.mkdirSync(OLD, { recursive: true });
  for (const f of ['explorer-query.mjs', 'explorer-agg.mjs']) {
    fs.writeFileSync(path.join(OLD, f), execFileSync('git', ['show', `${REF}:scripts/lib/${f}`], { cwd: ROOT }));
  }
  old = await import(pathToFileURL(path.join(OLD, 'explorer-query.mjs')).href);
}

const inst = await DuckDBInstance.create(COPY, {
  access_mode: 'READ_ONLY', threads: THREADS, memory_limit: MEM, temp_directory: fwd(P('spill')),
});
const one = async (sql) => {
  const c = await inst.connect();
  try { return (await c.runAndReadAll(sql)).getRowObjectsJS()[0]; } finally { c.closeSync?.(); }
};
const setNumber = Number((await one('SELECT set_number::DOUBLE AS v FROM meta')).v);
const components = readComponents(ROOT, setNumber, log);
const holder = { instance: inst, components, compHash: componentsHash(components), warmConn: null, retired: false };
// Neuester Patch wie im Dienst ("latest"): der mit dem juengsten Tag.
const LATEST = (await one(`SELECT patch FROM boards WHERE patch IS NOT NULL GROUP BY patch ORDER BY max(day) DESC, patch DESC LIMIT 1`)).patch;
log(`Set ${setNumber}, neuester Patch ${LATEST}, ${components.length} Komponenten, Kopie ${COPY}`);

const ways = [
  ...(old ? [{ name: 'alt', run: (q) => old.runQuery(holder, q, { timeoutMs: TIMEOUT_MS }) }] : []),
  { name: 'neu', run: (q) => current.runQuery(holder, q, { timeoutMs: TIMEOUT_MS }) },
];
// ctx fuer weitere Wege: eigene Instanz/Datei duerfen sie selbst oeffnen.
const ctx = {
  DuckDBInstance, holder, copyPath: COPY, tmp: TMP, root: ROOT, log, timeoutMs: TIMEOUT_MS, query: current, threads: THREADS, mem: MEM,
  // Eigene Instanzen hier anmelden: sie werden vor dem Loeschen der Kopie geschlossen.
  onClose: (f) => closers.push(f),
};
const closers = [];
for (const spec of args('way')) {
  const i = spec.indexOf('=');
  const name = spec.slice(0, i);
  const mod = await import(pathToFileURL(path.resolve(spec.slice(i + 1))).href);
  ways.push({ name, run: await mod.makeWay(ctx) });
}

// Kanonische Form wie normalizeQuery im Dienst (der Treiber wird nicht importiert).
const sortJson = (a) => [...a].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
function norm(q) {
  return {
    region: q.region ?? 'all',
    ranks: [...new Set(q.ranks ?? [])].sort(),
    patches: q.patches ?? [LATEST],
    units: sortJson((q.units ?? []).map((u) => ({
      id: u.id, x: u.x === true, s: u.s ?? null, se: u.se === true, n: u.n ?? null,
      it: [...new Set(u.it ?? [])].sort(), nit: [...new Set(u.nit ?? [])].sort(),
    }))),
    items: sortJson((q.items ?? []).map((i) => ({ id: i.id, x: i.x === true }))),
    traits: sortJson((q.traits ?? []).map((t) => ({ id: t.id, x: t.x === true, l: t.l ?? null, le: t.le === true }))),
    tab: q.tab ?? 'summary',
    focus: q.focus ?? null,
    split: q.split === 'star' || q.split === 'over' ? q.split : null,
    combo: q.combo ?? 1,
  };
}

// Faelle nach Kriterium 2. IDs gegen die lokale Datei geprueft (Set 18).
// Ohne patches gilt der neueste Patch; "alle Patches" = patches: [].
const FOCUS = 'DA_18_Diana';
const CASES = [
  ['region', { region: 'euw1' }],
  ['rang-unknown', { ranks: ['unknown'] }],
  ['raenge', { ranks: ['CHALLENGER', 'GRANDMASTER'] }],
  ['unit-stern-genau', { units: [{ id: 'DA_18_Diana', s: 2, se: true }] }],
  ['unit-stern-ab+itemzahl', { units: [{ id: 'DA_Amumu18', s: 2, n: 2 }] }],
  ['unit-items+ohne-items', { units: [{ id: 'DA_18_Diana', it: ['DA_SpearOfShojin'], nit: ['DA_GuinsoosRageblade'] }] }],
  ['unit-ausgeschlossen', { units: [{ id: 'DA_18_Diana' }, { id: 'DA_Amumu18', x: true }] }],
  ['item+item-ausgeschlossen', { items: [{ id: 'DA_ThiefsGloves' }, { id: 'DA_Artifact_LightshieldCrest', x: true }] }],
  ['trait-stufe-genau+ausgeschlossen', { traits: [{ id: 'DA_18_Inferno', l: 2, le: true }, { id: 'DA_Juggernaut18', x: true }] }],
  ['trait-stufe-ab', { traits: [{ id: 'DA_18_Invoker', l: 2 }] }],
  ['alle-patches', { region: 'oc1', patches: [] }],
  ['alle-patches+unit', { region: 'oc1', patches: [], units: [{ id: 'DA_18_Diana' }] }],
  ['leer', { items: [{ id: 'DA_ThiefsGloves' }, { id: 'DA_ThiefsGloves', x: true }] }],
];
const TABS = [
  ['Uebersicht', { tab: 'summary' }],
  ['Units', { tab: 'units' }],
  ['Units Sterne', { tab: 'units', split: 'star' }],
  ['Items', { tab: 'items' }],
  ['Items mit Fokus', { tab: 'items', focus: FOCUS }],
  ['Traits', { tab: 'traits' }],
  ['Traits Uebercap', { tab: 'traits', split: 'over' }],
  ['Comps', { tab: 'comps' }],
  ['Level', { tab: 'level' }],
  ['Runde', { tab: 'round' }],
];
const only = arg('only')?.split(',');
const tabsOnly = arg('tabs')?.split(',');

// Vergleichsform: ohne ms/cached/src; bigint, -0, NaN/Infinity sichtbar statt
// stillschweigend gleich.
function canon(out) {
  const { ms, cached, src, ...rest } = out;
  return JSON.stringify(rest, (k, v) => {
    if (typeof v === 'bigint') return `${v}n`;
    if (typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0))) return String(Object.is(v, -0) ? '-0' : v);
    return v;
  });
}
function firstDiff(a, b, at = '') {
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return Object.is(a, b) ? null : `${at || '.'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) { const d = firstDiff(a[k], b[k], `${at}.${k}`); if (d) return d; }
  return null;
}

let same = 0, differ = 0, failed = 0, runs = 0;
const times = Object.fromEntries(ways.map((w) => [w.name, 0]));
for (const [cname, cq] of CASES) {
  if (only && !only.includes(cname)) continue;
  for (const [tname, tq] of TABS) {
    if (tabsOnly && !tabsOnly.includes(tname)) continue;
    const q = norm({ ...cq, ...tq });
    runs++;
    const res = [];
    for (const w of ways) {
      const t = Date.now();
      try {
        // Kopie je Weg: runQuery fasst q nicht an, ein eingesteckter Weg vielleicht schon.
        const out = await w.run(structuredClone(q));
        res.push({ w: w.name, ms: Date.now() - t, out, c: canon(out) });
      } catch (err) {
        res.push({ w: w.name, ms: Date.now() - t, err: String(err?.message || err).slice(0, 300) });
      }
      times[w.name] += Date.now() - t;
    }
    const lab = `${cname} / ${tname}`;
    const tl = res.map((r) => `${r.w} ${r.ms} ms`).join(', ');
    if (res.some((r) => r.err)) {
      failed++;
      log(`FEHLER ${lab} (${tl}): ${res.filter((r) => r.err).map((r) => `${r.w}: ${r.err}`).join(' | ')}`);
      continue;
    }
    const a = res[0];
    const bad = res.slice(1).filter((r) => r.c !== a.c);
    const info = `${a.out.summary.games} Boards, ${a.out.rows?.length ?? '-'} Zeilen`;
    if (bad.length) {
      differ++;
      for (const r of bad) {
        const f = P(`diff-${runs}-${r.w}.json`);
        fs.writeFileSync(f, JSON.stringify({ q, [a.w]: JSON.parse(a.c), [r.w]: JSON.parse(r.c) }, null, 1));
        log(`ABWEICHUNG ${lab} (${tl}, ${info}): ${r.w} gegen ${a.w}, erste Stelle ${firstDiff(JSON.parse(a.c), JSON.parse(r.c))} → ${f}`);
      }
    } else {
      same++;
      log(`IDENTISCH ${lab} (${tl}, ${info})`);
    }
  }
}

log(`${runs} Laeufe je Weg (${ways.map((w) => w.name).join(', ')}): ${same} identisch, ${differ} abweichend, ${failed} Fehler.`
  + ` Rechenzeit ${ways.map((w) => `${w.name} ${Math.round(times[w.name] / 1000)} s`).join(', ')}`);
for (const f of closers) { try { f(); } catch { /* schon zu */ } }
inst.closeSync?.();
if (!KEEP) for (const x of [COPY, `${COPY}.wal`]) fs.rmSync(x, { force: true });
fs.rmSync(P('spill'), { recursive: true, force: true });
process.exit(differ || failed || !runs ? 1 : 0);
