// Patch-Namen der TFT-Tagesstatistik (tft_daily_*) nach Riots Terminplan
// korrigieren. Motor fuer scripts/relabel-tft-bpatch.mjs — von Hand und vom
// Tagestreiber (--auto, einmal am Ende jedes Treiber-Laufs, siehe
// scripts/lib/daily-crawl-post.mjs).
//
// Regeln (Plan 2026-10-04 und Verdicts der Review-Agenten):
//  - geschrieben wird nur, wenn patchForDay den Tag als `trusted` meldet; ein
//    Name aus dem Rueckfall auf latestPatch benennt nie etwas um
//  - der laufende Sammeltag und alles danach bleiben unberuehrt
//  - ein Tag ist EINE Transaktion ueber alle Tabellen: ganz oder gar nicht
//  - gibt es fuer denselben Schluessel eine falsch und eine richtig
//    beschriftete Zeile, gewinnt die richtige; die falsche wird geloescht, nie
//    aufsummiert
//  - die Tabellen kommen aus dem Katalog der Datenbank, nicht aus einer Liste
//    (der alten Liste fehlte tft_daily_comp_outcome)
//  - Vorab-Listen werden nie geloescht und der Publisher nie gestartet — das
//    macht der Aufrufer, wenn changedDays nicht leer ist
//  - jeder umbenannte Tag traegt seine Patch-Namen (alt und neu) in die
//    Markerdatei ein; der Publisher baut diese Patches dann neu, statt den
//    beendeten Vorpatch wiederzuverwenden

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays, baseOf, isDay, patchForDay, scheduleProblems } from './tft-patch-day.mjs';
import { currentWindowDay } from './tft-crawl-window.mjs';

export const AUTO_CAP = 21;          // Tage je --auto-Lauf
export const AUTO_SCAN_DAYS = 14;    // so weit schaut --auto in alle Tabellen
export const MAX_ERRORS = 3;
export const STATUS_FILE = 'tft-patch-relabel-status.json';
export const OFF_FILE = 'tft-patch-relabel.off';
export const LOCK_KEY = 'tft-patch-relabel';
// Fassung von Status- und Markerdatei; der Tagestreiber liest nur diese.
export const STATUS_SCHEMA = 1;
export const CHANGED_MARKER_FILE = 'tft-patch-relabel-changed.json';
export const CHANGED_MARKER_KEEP_DAYS = 14;
const PATCH_NAME_RE = /^([1-9]\d*)\.([1-9]\d*)([a-z]?)$/;

const TIMEOUTS = [
  ['statement_timeout', '150s'],
  ['lock_timeout', '10s'],
  ['idle_in_transaction_session_timeout', '120s'],
];

export const USAGE = `Patch-Namen der TFT-Tagesstatistik nach Riots Terminplan korrigieren.

  node scripts/relabel-tft-bpatch.mjs [Auswahl] [Schreibweise] [Optionen]

Auswahl (eine):
  --deep           alle Tage der Set durchsuchen (Standard)
  --auto           crawl_meta der Set plus die letzten ${AUTO_SCAN_DAYS} Tage aller Tabellen,
                   hoechstens ${AUTO_CAP} Tage je Lauf; bei Zweifeln wird nichts geschrieben
  --days D1,D2     genau diese Sammeltage (YYYY-MM-DD)

Schreibweise (eine):
  --dry-run        nur zaehlen, nichts schreiben (Standard)
  --apply          schreiben, ein Tag = eine Transaktion
  --trial          alles ausfuehren und jeden Tag zurueckrollen

Optionen:
  --set N          andere Set als in public/tft-set.json (nicht mit --auto)
  --run-id ID      Kennung fuer die Statusdatei (setzt der Tagestreiber)
  --expect T=P     nur laufen, wenn der Terminplan dem Tag T den Patch P gibt
                   (setzt der Tagestreiber; sonst --auto: nichts tun, von Hand: Fehler)
  --help           diese Hilfe
`;

export function parseArgs(argv) {
  const out = { selection: 'deep', write: 'dry-run', days: [], set: null, runId: null, expect: null, help: false, error: null };
  const selections = new Set();
  const writes = new Set();
  const fail = (error) => ({ ...out, error });
  const BOOL = ['--help', '-h', '--deep', '--auto', '--dry-run', '--apply', '--trial'];
  for (let i = 0; i < argv.length; i++) {
    const raw = String(argv[i]);
    const eq = raw.startsWith('--') ? raw.indexOf('=') : -1;
    const flag = eq > 0 ? raw.slice(0, eq) : raw;
    const inline = eq > 0 ? raw.slice(eq + 1) : undefined;
    const value = () => (inline !== undefined ? inline : argv[++i]);
    if (inline !== undefined && BOOL.includes(flag)) return fail(`${flag} nimmt keinen Wert`);
    switch (flag) {
      case '--help': case '-h': out.help = true; break;
      case '--deep': selections.add('deep'); break;
      case '--auto': selections.add('auto'); break;
      case '--days': {
        selections.add('days');
        const list = String(value() ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        if (!list.length) return fail('--days braucht Tage, z. B. --days 2026-09-23,2026-09-24');
        const bad = list.filter((d) => !isDay(d));
        if (bad.length) return fail(`--days: kein gueltiger Tag: ${bad.join(', ')}`);
        out.days = [...new Set([...out.days, ...list])];
        break;
      }
      case '--set': {
        const v = String(value() ?? '');
        if (!/^[1-9]\d*$/.test(v)) return fail(`--set braucht eine Set-Nummer, nicht ${JSON.stringify(v)}`);
        out.set = Number(v);
        break;
      }
      case '--run-id': {
        const v = String(value() ?? '');
        if (!/^[A-Za-z0-9._:-]{1,80}$/.test(v)) return fail('--run-id: nur Buchstaben, Ziffern und . _ : - (hoechstens 80 Zeichen)');
        out.runId = v;
        break;
      }
      case '--expect': {
        const v = String(value() ?? '');
        const at = v.indexOf('=');
        const day = at > 0 ? v.slice(0, at) : '';
        const patch = at > 0 ? v.slice(at + 1) : '';
        if (!isDay(day) || !PATCH_NAME_RE.test(patch)) {
          return fail(`--expect braucht Tag=Patch, z. B. --expect 2026-09-24=18.3b, nicht ${JSON.stringify(v)}`);
        }
        out.expect = { day, patch };
        break;
      }
      case '--dry-run': writes.add('dry-run'); break;
      case '--apply': writes.add('apply'); break;
      case '--trial': writes.add('trial'); break;
      case '--rollback': return fail('--rollback gibt es nicht mehr — tft-set.json korrigieren und neu laufen lassen');
      default: return fail(`unbekannte Option ${JSON.stringify(raw)}`);
    }
  }
  if (selections.size > 1) return fail(`nur eine Auswahl erlaubt: ${[...selections].map((s) => `--${s}`).join(', ')}`);
  if (writes.size > 1) return fail(`nur eine Schreibweise erlaubt: ${[...writes].map((s) => `--${s}`).join(', ')}`);
  if (selections.size) out.selection = [...selections][0];
  if (writes.size) out.write = [...writes][0];
  if (out.selection === 'auto' && out.set !== null) return fail('--set geht nicht mit --auto — --auto korrigiert nur die laufende Set');
  return out;
}

/** Wohin Statusdatei und Not-Aus gehoeren. Auf der Box duerfen die Sammel-Units
 *  nur unter /etc/metastats-crawler schreiben (ProtectSystem=strict). */
export function defaultStateDir(env = process.env) {
  if (env.TFT_RELABEL_STATE_DIR) return env.TFT_RELABEL_STATE_DIR;
  if (existsSync('/etc/metastats-crawler')) return '/etc/metastats-crawler';
  return join(tmpdir(), 'metastats-tft-relabel');
}

function writeJsonAtomic(stateDir, name, value, what) {
  const file = join(stateDir, name);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
    renameSync(tmp, file);
    return null;
  } catch (err) {
    try { rmSync(tmp, { force: true }); } catch { /* nichts mehr zu retten */ }
    return `${what} ${file} nicht geschrieben: ${err.message}`;
  }
}

/** Schreibt die Statusdatei atomar. Gibt bei Erfolg null zurueck, sonst den Grund. */
export function writeStatus(stateDir, status) {
  return writeJsonAtomic(stateDir, STATUS_FILE, status, 'Statusdatei');
}

/**
 * Markerdatei: welche Patch-Namen wann zuletzt umbenannt wurden
 * ({ schema, patches: { '18.2b': ISO } }). null, wenn es sie nicht gibt;
 * wirft, wenn sie unlesbar ist — der Publisher verwendet dann nichts wieder.
 */
export function readChangedMarker(stateDir) {
  const file = join(stateDir, CHANGED_MARKER_FILE);
  if (!existsSync(file)) return null;
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (data?.schema !== STATUS_SCHEMA || !data.patches || typeof data.patches !== 'object' || Array.isArray(data.patches)) {
    throw new Error(`${file}: unbekanntes Format`);
  }
  return data;
}

/**
 * Traegt Patch-Namen mit Zeitstempel in die Markerdatei ein. Eintraege aelter als
 * CHANGED_MARKER_KEEP_DAYS fallen weg. Eine kaputte Datei wird ersetzt.
 * Gibt null zurueck oder den Grund, warum etwas nicht stimmte.
 */
export function recordChangedPatches(stateDir, patches, at = new Date()) {
  let prior = {};
  let note = null;
  try {
    prior = readChangedMarker(stateDir)?.patches ?? {};
  } catch (err) {
    note = `Markerdatei ersetzt: ${err.message}`;
  }
  const cutoff = at.getTime() - CHANGED_MARKER_KEEP_DAYS * 86_400_000;
  const kept = {};
  for (const [p, iso] of Object.entries(prior)) {
    const t = Date.parse(iso);
    if (Number.isFinite(t) && t >= cutoff) kept[p] = iso;
  }
  for (const p of patches) if (p) kept[p] = at.toISOString();
  const why = writeJsonAtomic(stateDir, CHANGED_MARKER_FILE, { schema: STATUS_SCHEMA, patches: kept }, 'Markerdatei');
  return why ?? note;
}

export function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

// Alle tft_daily_*-Tabellen mit set_number, patch und day, je mit ihren
// eindeutigen Indizes. Daraus folgt, welche Zeilen beim Umbenennen
// zusammenstossen koennen.
export const CATALOG_SQL = `select c.relname as tbl,
  coalesce((select json_agg(json_build_object('name', ic.relname, 'partial', i.indpred is not null,
      'expr', i.indexprs is not null, 'nnd', coalesce(i.indnullsnotdistinct, false),
      'cols', (select json_agg(a.attname order by k.ord) from unnest(i.indkey::int2[]) with ordinality k(attnum, ord)
               join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum where k.ord <= i.indnkeyatts)))
     from pg_index i join pg_class ic on ic.oid = i.indexrelid where i.indrelid = c.oid and i.indisunique), '[]'::json) as uniques
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition and c.relname like 'tft\\_daily\\_%'
   and (select count(*) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
         and a.attname in ('set_number', 'patch', 'day')) = 3
 order by 1`;

/**
 * plain: kein eindeutiger Index enthaelt patch — Umbenennen kann nicht
 *        kollidieren. merge: genau einer — Schluessel = dessen Spalten ohne
 *        patch. Alles andere wird abgelehnt, bevor irgendetwas geschrieben wird.
 */
export function classifyTables(rows) {
  const tables = [];
  const refused = [];
  for (const row of rows ?? []) {
    const name = String(row.tbl);
    const uniques = Array.isArray(row.uniques) ? row.uniques : [];
    const odd = uniques.find((u) => u.partial || u.expr);
    if (odd) {
      refused.push({ name, reason: `eindeutiger Index ${odd.name} ist ${odd.partial ? 'partiell' : 'ein Ausdrucks-Index'}` });
      continue;
    }
    const withPatch = uniques.filter((u) => Array.isArray(u.cols) && u.cols.includes('patch'));
    if (!withPatch.length) {
      tables.push({ name, mode: 'plain', keyCols: [], index: null });
      continue;
    }
    if (withPatch.length > 1) {
      refused.push({ name, reason: `${withPatch.length} eindeutige Indizes mit patch (${withPatch.map((u) => u.name).join(', ')})` });
      continue;
    }
    const [u] = withPatch;
    if (u.nnd) {
      refused.push({ name, reason: `eindeutiger Index ${u.name} ist NULLS NOT DISTINCT` });
      continue;
    }
    const keyCols = u.cols.filter((c) => c !== 'patch');
    if (!keyCols.includes('day') || !keyCols.includes('set_number')) {
      refused.push({ name, reason: `eindeutiger Index ${u.name} enthaelt day oder set_number nicht` });
      continue;
    }
    tables.push({ name, mode: 'merge', keyCols, index: u.name });
  }
  return { tables, refused };
}

// Parameter aller Tages-Abfragen: [$1 set_number, $2 day, $3 richtiger Patch].
const WRONG = (a) => `${a}.set_number = $1 and ${a}.day = $2::date and ${a}.patch is distinct from $3`;
const targetJoin = (t, w, keyCols) =>
  [`${t}.patch = $3`, ...keyCols.map((c) => `${t}.${quoteIdent(c)} = ${w}.${quoteIdent(c)}`)].join(' and ');

/** Falsch beschriftete Zeilen je Patch, davon mit richtig beschriftetem Zwilling. */
export function planSql({ name, mode, keyCols }) {
  const T = quoteIdent(name);
  const collide = mode === 'merge'
    ? `count(*) filter (where exists (select 1 from ${T} t where ${targetJoin('t', 'w', keyCols)}))::int`
    : '0';
  return `select w.patch, count(*)::int as n, ${collide} as collide from ${T} w where ${WRONG('w')} group by w.patch order by w.patch`;
}

/** Schluessel, die ohne Zwilling mehrfach falsch beschriftet sind — Umbenennen
 *  waere dort nicht eindeutig. */
export function ambiguousSql({ name, keyCols }) {
  const T = quoteIdent(name);
  const cols = keyCols.map((c) => `w.${quoteIdent(c)}`).join(', ');
  return `select count(*)::int as n from (select 1 from ${T} w where ${WRONG('w')} and not exists (select 1 from ${T} t where ${targetJoin('t', 'w', keyCols)}) group by ${cols} having count(*) > 1) x`;
}

export function deleteSql({ name, keyCols }) {
  const T = quoteIdent(name);
  return `delete from ${T} w using ${T} t where ${WRONG('w')} and ${targetJoin('t', 'w', keyCols)}`;
}

export function updateSql({ name }) {
  return `update ${quoteIdent(name)} set patch = $3 where set_number = $1 and day = $2::date and patch is distinct from $3`;
}

export function remainingSql({ name }) {
  return `select count(*)::int as n from ${quoteIdent(name)} where set_number = $1 and day = $2::date and patch is distinct from $3`;
}

/** Zeilen je Tag und Patch; ranged: Parameter [$1 set, $2 von, $3 bis]. */
export function scanSql({ name }, ranged) {
  return `select day::text as day, patch, count(*)::int as n from ${quoteIdent(name)} where set_number = $1${ranged ? ' and day >= $2::date and day <= $3::date' : ''} group by 1, 2`;
}

export async function planDay(client, tables, params) {
  const perTable = [];
  let n = 0;
  let collide = 0;
  let ambiguous = 0;
  for (const t of tables) {
    const { rows } = await client.query(planSql(t), params);
    const wrong = {};
    let tn = 0;
    let tc = 0;
    for (const r of rows) {
      wrong[r.patch] = Number(r.n);
      tn += Number(r.n);
      tc += Number(r.collide);
    }
    let amb = 0;
    if (t.mode === 'merge' && tn > tc) {
      const { rows: a } = await client.query(ambiguousSql(t), params);
      amb = Number(a[0]?.n ?? 0);
    }
    perTable.push({ table: t.name, wrong, n: tn, collide: tc, ambiguous: amb, deleted: 0, updated: 0 });
    n += tn;
    collide += tc;
    ambiguous += amb;
  }
  return { perTable, n, collide, ambiguous };
}

// "18.3b" → "18.3" wuerde den B-Patch-Namen wegwerfen. Das passiert nur, wenn
// ein Schnitt aus tft-set.json verschwunden ist — automatisch nie.
function isDowngrade(perTable, expected) {
  return perTable.some((t) => Object.keys(t.wrong).some((p) => p !== expected && baseOf(p) === expected));
}

async function safeRollback(client) {
  try { await client.query('rollback'); } catch { /* Verbindung weg — der Server rollt selbst zurueck */ }
}

/**
 * Einen Sammeltag in EINER Transaktion umbenennen. Wirft bei jedem Zweifel und
 * rollt dann zurueck: Lock belegt, nicht eindeutig, Zeilenzahl weicht vom Plan
 * ab, danach noch falsche Zeilen uebrig.
 */
export async function relabelDay(client, tables, set, day, expected, { trial = false, auto = false } = {}) {
  const params = [set, day, expected];
  await client.query('begin');
  try {
    for (const [k, v] of TIMEOUTS) await client.query(`set local ${k} = '${v}'`);
    const { rows: lock } = await client.query('select pg_try_advisory_xact_lock(hashtext($1)) as ok', [LOCK_KEY]);
    if (!lock[0]?.ok) {
      const err = new Error('ein anderer Lauf korrigiert gerade (Lock belegt)');
      err.code = 'LOCK_BUSY';
      throw err;
    }
    const plan = await planDay(client, tables, params);
    if (plan.ambiguous > 0) throw new Error(`nicht eindeutig: ${plan.ambiguous} Schluessel mehrfach falsch beschriftet`);
    const downgrade = isDowngrade(plan.perTable, expected);
    if (downgrade && auto) {
      await client.query('rollback');
      return { ...plan, skipped: true, downgrade };
    }
    for (const t of plan.perTable) {
      if (t.n === 0) continue;
      const def = tables.find((x) => x.name === t.table);
      if (t.collide > 0) {
        const r = await client.query(deleteSql(def), params);
        if (r.rowCount !== t.collide) throw new Error(`${t.table}: ${r.rowCount} statt ${t.collide} Zwillinge geloescht`);
        t.deleted = r.rowCount;
      }
      const u = await client.query(updateSql(def), params);
      if (u.rowCount !== t.n - t.collide) throw new Error(`${t.table}: ${u.rowCount} statt ${t.n - t.collide} Zeilen umbenannt`);
      t.updated = u.rowCount;
      const { rows: rest } = await client.query(remainingSql(def), params);
      const left = Number(rest[0]?.n ?? 0);
      if (left !== 0) throw new Error(`${t.table}: nach dem Umbenennen noch ${left} falsche Zeilen`);
    }
    await client.query(trial ? 'rollback' : 'commit');
    return { ...plan, skipped: false, downgrade };
  } catch (err) {
    await safeRollback(client);
    throw err;
  }
}

async function closeClient(client) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => client.end()),
      new Promise((resolve) => { timer = setTimeout(resolve, 5_000); timer.unref?.(); }),
    ]);
  } catch { /* beim Schliessen ist nichts mehr zu retten */ } finally {
    clearTimeout(timer);
  }
}

const fmt = (n) => Number(n).toLocaleString('de-DE');
const short = (name) => name.replace(/^tft_daily_/, '');

function describeDay(e) {
  const tables = Object.values(e.tables);
  const sum = (f) => tables.reduce((s, t) => s + f(t), 0);
  switch (e.status) {
    case 'clean': return 'sauber';
    case 'planned': {
      const n = sum((t) => Object.values(t.wrong).reduce((a, b) => a + b, 0));
      const twins = sum((t) => t.collide);
      return `${fmt(n)} Zeilen falsch beschriftet${twins ? `, davon ${fmt(twins)} mit richtigem Zwilling (wuerden geloescht)` : ''}`;
    }
    case 'changed':
    case 'trial': {
      const del = sum((t) => t.deleted);
      return `${fmt(sum((t) => t.updated))} Zeilen umbenannt${del ? `, ${fmt(del)} Zwillinge geloescht` : ''}${e.status === 'trial' ? ' — Probe, zurueckgerollt' : ''}`;
    }
    default: return e.message ?? e.status;
  }
}

/**
 * Ein ganzer Lauf. Gibt { exitCode, status } zurueck und wirft nie.
 * exitCode 1: Fehler, oder ein ausdruecklich verlangter Tag blieb liegen.
 * --auto endet bei unsicheren Eingaben mit 0 und schreibt nichts.
 */
export async function runRelabel({ args, meta, metaError = null, connect, now = new Date(), stateDir = defaultStateDir(), log = console }) {
  const dry = args.write === 'dry-run';
  const trial = args.write === 'trial';
  const auto = args.selection === 'auto';
  const explicit = args.selection === 'days';
  const status = {
    schema: STATUS_SCHEMA,
    runId: args.runId ?? `manual-${now.toISOString()}`,
    selection: args.selection,
    write: args.write,
    set: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    state: 'running',
    days: [],
    changedDays: [],
    errors: 0,
    problems: [],
    warnings: [],
  };
  const warn = (msg) => { status.warnings.push(msg); log.warn(`[relabel] ⚠ ${msg}`); };
  const problem = (msg) => { status.errors++; status.problems.push(msg); log.error(`[relabel] ✗ ${msg}`); };
  const finish = (state, code) => {
    status.state = state;
    status.finishedAt = new Date().toISOString();
    status.changedDays = status.days.filter((d) => d.status === 'changed').map((d) => d.day);
    const why = writeStatus(stateDir, status);
    if (why) log.warn(`[relabel] ⚠ ${why}`);
    return { exitCode: code, status };
  };

  if (!dry && existsSync(join(stateDir, OFF_FILE))) {
    log.log(`[relabel] Not-Aus liegt (${join(stateDir, OFF_FILE)}) — nichts geschrieben`);
    return finish('off', 0);
  }

  const metaSet = Number(meta?.setNumber);
  if (metaError || !meta || !Number.isInteger(metaSet) || metaSet <= 0) {
    warn(`public/tft-set.json unbrauchbar: ${metaError ?? 'setNumber fehlt'}`);
    return auto ? finish('skipped', 0) : finish('failed', 1);
  }
  const set = args.set ?? metaSet;
  status.set = set;
  if (auto && set !== metaSet) {
    warn(`--auto korrigiert nur die laufende Set ${metaSet}, nicht ${set}`);
    return finish('skipped', 0);
  }
  const scheduleIssues = scheduleProblems(meta, set);
  for (const p of scheduleIssues) warn(p);
  if (auto && scheduleIssues.length) {
    warn('Terminplan in public/tft-set.json nicht stimmig — --auto schreibt nichts');
    return finish('skipped', 0);
  }
  // Der Tagestreiber hat beim Sammeln einen Namen vergeben; sagt der Terminplan
  // inzwischen etwas anderes (Datei mitten im Lauf getauscht), wird nichts angefasst.
  if (args.expect) {
    const r = patchForDay(args.expect.day, meta, set);
    if (r.patch !== args.expect.patch) {
      warn(`erwartet ${args.expect.day} = ${args.expect.patch}, der Terminplan sagt ${r.patch ?? '–'} — nichts geschrieben`);
      return auto ? finish('skipped', 0) : finish('failed', 1);
    }
  }

  { const why = writeStatus(stateDir, status); if (why) log.warn(`[relabel] ⚠ ${why}`); }

  let client;
  try {
    client = await connect();
  } catch (err) {
    problem(`keine Verbindung zur Datenbank: ${err.message}`);
    return finish('failed', 1);
  }

  try {
    for (const [k, v] of TIMEOUTS) await client.query(`set ${k} = '${v}'`);
    const { rows: catalog } = await client.query(CATALOG_SQL);
    const { tables, refused } = classifyTables(catalog);
    for (const r of refused) problem(`${r.name}: ${r.reason} — Lauf abgebrochen, nichts geschrieben`);
    if (!tables.length) problem('keine tft_daily_*-Tabelle mit set_number, patch und day gefunden');
    if (status.errors) return finish('failed', 1);
    log.log(`[relabel] Set ${set}, ${tables.length} Tabellen: ${tables.map((t) => short(t.name) + (t.mode === 'plain' ? ' (Schluessel ohne patch)' : '')).join(', ')}`);

    // Welche Tage tragen welche Namen?
    const cwd = currentWindowDay(now);
    const observed = new Map();
    const note = (rows) => {
      for (const r of rows) {
        if (!observed.has(r.day)) observed.set(r.day, new Map());
        const m = observed.get(r.day);
        m.set(r.patch, (m.get(r.patch) ?? 0) + Number(r.n));
      }
    };
    let candidates;
    if (explicit) {
      candidates = [...args.days];
    } else {
      if (auto) {
        const crawlMeta = tables.find((t) => t.name === 'tft_daily_crawl_meta');
        if (crawlMeta) note((await client.query(scanSql(crawlMeta, false), [set])).rows);
        else warn('tft_daily_crawl_meta fehlt — --auto sieht nur die letzten Tage');
        const from = addDays(cwd, -AUTO_SCAN_DAYS);
        const to = addDays(cwd, -1);
        for (const t of tables) note((await client.query(scanSql(t, true), [set, from, to])).rows);
      } else {
        for (const t of tables) note((await client.query(scanSql(t, false), [set])).rows);
      }
      candidates = [...observed.keys()];
    }
    candidates.sort().reverse();

    const expectedCache = new Map();
    const expectedOf = (day) => {
      if (!expectedCache.has(day)) expectedCache.set(day, patchForDay(day, meta, set));
      return expectedCache.get(day);
    };
    const seenWrong = (day, expected) => [...(observed.get(day)?.keys() ?? [])].some((p) => p !== expected);
    const seenText = (day) => [...(observed.get(day)?.entries() ?? [])].map(([p, n]) => `${p}: ${fmt(n)}`).join(', ');

    const work = [];
    const untrusted = [];
    let explicitSkipped = false;
    for (const day of candidates) {
      const r = expectedOf(day);
      if (day >= cwd) {
        if (explicit) {
          status.days.push({ day, expected: r.patch, source: r.source, status: 'skipped', tables: {}, message: 'laufender Sammeltag — wird erst nach dem Sammeln korrigiert' });
          explicitSkipped = true;
        } else if (seenWrong(day, r.patch)) {
          log.log(`[relabel] ${day}: laufender Sammeltag (${seenText(day)}) — nicht angefasst`);
        }
        continue;
      }
      if (!r.trusted) {
        const why = r.warnings.filter((w) => !scheduleIssues.includes(w)).join(' | ') || 'Terminplan nicht stimmig';
        if (explicit || seenWrong(day, r.patch)) untrusted.push(`${day}${observed.has(day) ? ` (${seenText(day)})` : ''}: ${why}`);
        if (explicit) {
          status.days.push({ day, expected: r.patch, source: r.source, status: 'skipped', tables: {}, message: why });
          explicitSkipped = true;
        }
        continue;
      }
      if (!explicit && !seenWrong(day, r.patch)) continue;
      work.push({ day, expected: r.patch, source: r.source });
    }
    if (untrusted.length) {
      const lines = untrusted.slice(0, 5);
      if (untrusted.length > 5) lines.push(`und ${untrusted.length - 5} weitere`);
      warn(`${untrusted.length} Tag(e) nicht angefasst, weil der Terminplan sie nicht sicher abdeckt:\n    ${lines.join('\n    ')}`);
    }
    if (auto && work.length > AUTO_CAP) {
      warn(`${work.length - AUTO_CAP} weitere Tage warten auf den naechsten Lauf (hoechstens ${AUTO_CAP} je Lauf)`);
      work.length = AUTO_CAP;
    }

    let aborted = null;
    for (const w of work) {
      const entry = { day: w.day, expected: w.expected, source: w.source, status: null, tables: {}, message: null };
      status.days.push(entry);
      if (aborted) {
        entry.status = 'skipped';
        entry.message = aborted;
        continue;
      }
      const record = (res) => {
        for (const t of res.perTable) {
          if (t.n > 0) entry.tables[t.table] = { wrong: t.wrong, collide: t.collide, deleted: t.deleted, updated: t.updated };
        }
      };
      try {
        if (dry) {
          const plan = await planDay(client, tables, [set, w.day, w.expected]);
          record(plan);
          if (plan.ambiguous > 0) throw new Error(`nicht eindeutig: ${plan.ambiguous} Schluessel mehrfach falsch beschriftet`);
          entry.status = plan.n > 0 ? 'planned' : 'clean';
          if (isDowngrade(plan.perTable, w.expected)) {
            entry.message = auto ? 'B-Patch-Name ginge verloren — --auto liesse den Tag liegen' : 'B-Patch-Name entfiele';
          }
        } else {
          const res = await relabelDay(client, tables, set, w.day, w.expected, { trial, auto });
          record(res);
          if (res.skipped) {
            entry.status = 'skipped';
            entry.message = 'B-Patch-Name ginge verloren — nur von Hand mit --days';
            warn(`${w.day}: ${entry.message}`);
          } else {
            entry.status = res.n === 0 ? 'clean' : trial ? 'trial' : 'changed';
            if (res.downgrade) entry.message = 'B-Patch-Name entfaellt';
          }
        }
      } catch (err) {
        entry.status = 'error';
        entry.message = err.message + (err.code ? ` (${err.code})` : '');
        problem(`${w.day}: ${entry.message}`);
        if (err.code === 'LOCK_BUSY') aborted = 'abgebrochen: ein anderer Lauf korrigiert gerade';
        else if (status.errors >= MAX_ERRORS) aborted = `abgebrochen nach ${MAX_ERRORS} Fehlern`;
        if (aborted) log.error(`[relabel] ✗ ${aborted}`);
        continue;
      }
      log.log(`[relabel] ${w.day} → ${w.expected}: ${describeDay(entry)}${entry.message && entry.status !== 'skipped' ? ` (${entry.message})` : ''}`);
      for (const [name, t] of Object.entries(entry.tables)) {
        const from = Object.entries(t.wrong).map(([p, n]) => `${p} ${fmt(n)}`).join(', ');
        log.log(`    ${short(name)}: ${from}${t.collide ? ` — ${fmt(t.collide)} mit richtigem Zwilling` : ''}`);
      }
      if (!dry) {
        // Nach jedem Tag festhalten, was schon geschrieben ist — bricht der Lauf
        // ab (Zeitlimit des Treibers), weiss der Aufrufer trotzdem davon.
        status.changedDays = status.days.filter((d) => d.status === 'changed').map((d) => d.day);
        const why = writeStatus(stateDir, status);
        if (why) log.warn(`[relabel] ⚠ ${why}`);
        if (entry.status === 'changed') {
          const names = [w.expected, ...Object.values(entry.tables).flatMap((t) => Object.keys(t.wrong))];
          const whyMarker = recordChangedPatches(stateDir, names);
          if (whyMarker) warn(whyMarker);
        }
      }
    }

    const changed = status.days.filter((d) => d.status === 'changed');
    if (!work.length) log.log('[relabel] nichts zu korrigieren');
    if (dry && status.days.some((d) => d.status === 'planned')) log.log('[relabel] Probelauf — nichts geschrieben. Schreiben mit --apply');
    if (!auto && changed.length) {
      const touched = [...new Set(changed.flatMap((d) => Object.keys(d.tables)))].sort();
      log.log('[relabel] Danach:');
      log.log(`    VACUUM (ANALYZE) ${touched.join(', ')};`);
      log.log('    node scripts/precompute-comp-windows.mjs');
      log.log('    auf der Box: systemctl start metastats-explorer-build.service');
      log.log('    auf der Box: systemctl start metastats-snapshot-publisher.service');
    }
    return finish(status.errors ? 'failed' : 'done', status.errors || explicitSkipped ? 1 : 0);
  } catch (err) {
    problem(err.message);
    return finish('failed', 1);
  } finally {
    await closeClient(client);
  }
}
