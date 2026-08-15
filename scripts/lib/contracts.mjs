/**
 * Laufzeit-Verträge — Prüflogik.
 *
 * Register: infra/contracts.json
 * CLI:      scripts/check-contracts.mjs
 *
 * Ein Vertrag sagt, was eine Pipeline zu produzieren verspricht (Frische +
 * Volumen). Geprüft wird gegen die echte DB, nicht gegen Logs — ein Service
 * kann „success" exiten und trotzdem nichts geschrieben haben. Genau so lief
 * der Pro-Crawl 5 Wochen in Fehler 23505 und der Marktwert-Supabase-Sync seit
 * Ende Juli ins Leere.
 *
 * Backend-Falle: DATABASE_URL zeigt auf der Hetzner-Box auf das lokale PG,
 * auf einer Workstation auf Supabase. Deshalb wird Supabase IMMER über REST
 * geprüft (überall identisch) und 'hetzner' nur, wenn wir wirklich auf der
 * Box sind. Sonst würden wir lokal Supabase messen und Hetzner draufschreiben.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const BOX_ENV = '/etc/metastats-crawler/env';

/** Lädt env aus /etc/metastats-crawler/env (Box) oder .env.local (lokal). */
export function loadEnv() {
  for (const path of [BOX_ENV, resolve(REPO_ROOT, '.env.local')]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      if (!line.includes('=') || line.trimStart().startsWith('#')) continue;
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
    break;
  }
}

/** Auf der Box zeigt DATABASE_URL aufs lokale PG — nur dort ist 'hetzner' prüfbar. */
export function isOnBox() {
  return existsSync(BOX_ENV);
}

export function loadContracts() {
  const raw = readFileSync(resolve(REPO_ROOT, 'infra', 'contracts.json'), 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.contracts) || parsed.contracts.length === 0) {
    throw new Error('infra/contracts.json enthält keine Verträge');
  }
  return parsed.contracts;
}

const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) =>
  Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

// ---------------------------------------------------------------- Supabase

function supaHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY fehlt');
  return { apikey: key, Authorization: `Bearer ${key}` };
}

function supaBase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL fehlt');
  return `${url}/rest/v1`;
}

async function supaGet(path, extraHeaders = {}) {
  const res = await fetch(`${supaBase()}/${path}`, {
    headers: { ...supaHeaders(), ...extraHeaders },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Supabase HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res;
}

/** Neuester Wert einer Datums-/Timestamp-Spalte, als YYYY-MM-DD. */
async function supaMaxDate(table, col) {
  const res = await supaGet(`${table}?select=${col}&order=${col}.desc.nullslast&limit=1`);
  const rows = await res.json();
  const v = rows[0]?.[col];
  return v ? String(v).slice(0, 10) : null;
}

async function supaCount(table, filter = '') {
  // Range 0-0 + count=exact: wir wollen nur den Header, keine Rows.
  const res = await supaGet(`${table}?select=*${filter}`, {
    Prefer: 'count=exact',
    Range: '0-0',
  });
  const cr = res.headers.get('content-range'); // "0-0/12345" oder "*/12345"
  const total = cr?.split('/')?.[1];
  if (!total || total === '*') throw new Error(`kein content-range für ${table}`);
  return Number(total);
}

/** Distinct-Tage ab `from`, als YYYY-MM-DD. Paginiert, damit grosse Tabellen nicht abschneiden. */
async function supaDistinctDays(table, col, from) {
  const seen = new Set();
  const PAGE = 1000;
  for (let offset = 0; offset < 200_000; offset += PAGE) {
    const res = await supaGet(
      `${table}?select=${col}&${col}=gte.${from}&order=${col}.asc&limit=${PAGE}&offset=${offset}`,
    );
    const rows = await res.json();
    for (const row of rows) if (row[col]) seen.add(String(row[col]).slice(0, 10));
    if (rows.length < PAGE) break;
  }
  return [...seen];
}

/**
 * Ruft eine Postgres-Funktion über PostgREST auf.
 *
 * Der Weg über ein RPC ist kein Umweg, sondern der einzige: PostgREST kann
 * weder GROUP BY noch regexp_replace, und Aggregate wie die Familien-Abdeckung
 * lassen sich nicht aus Einzelabfragen zusammenstückeln, ohne die Aggregation
 * ein zweites Mal in JS nachzubauen — und damit zwei Definitionen derselben
 * Kennzahl zu haben, die auseinanderlaufen.
 */
async function supaRpc(fn, args) {
  const res = await fetch(`${supaBase()}/rpc/${fn}`, {
    method: 'POST',
    headers: { ...supaHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Supabase RPC ${fn} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

// ------------------------------------------------------- Anon-Rolle (Sperre)

/**
 * Header fuer die oeffentliche Rolle. Bewusst KEIN Merge ueber supaHeaders():
 * dort steht `Authorization: Bearer <service-role>`, und PostgREST wertet
 * genau den aus. Ein Merge wuerde die Sperr-Probe still in eine
 * Service-Role-Probe verwandeln — sie meldete dann Bruch, obwohl die Sperre
 * haelt.
 */
function anonHeaders() {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY fehlt — ohne den oeffentlichen '
      + 'Schluessel laesst sich nicht pruefen, was die Oeffentlichkeit sieht');
  }
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/** Wirft nicht bei !ok — die Ablehnung IST hier das erwartete Ergebnis. */
async function rawFetch(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* PostgREST antwortet nicht immer JSON */ }
  return { status: res.status, body, text: text.slice(0, 200) };
}

/**
 * Echte Rechte-Ablehnung — und NUR die.
 *
 * `!== 200` als Gutfall zu lesen waere die gefaehrlichste Abkuerzung an dieser
 * Stelle: ein Timeout, ein 502 waehrend eines Supabase-Ausfalls oder ein
 * ungueltig gewordener Anon-Schluessel ("Invalid API key", ebenfalls 401)
 * saehen dann aus wie eine funktionierende Sperre. Postgres' 42501 ist der
 * einzige Beleg dafuer, dass die Datenbank aktiv verweigert hat.
 */
function isPermissionDenied(res) {
  return (res.status === 401 || res.status === 403) && res.body?.code === '42501';
}

/**
 * Anon-Lockout: sieht die Oeffentlichkeit noch Daten?
 *
 * Zwei Aussagen in einem Vertrag, weil keine allein reicht:
 *
 * 1. KATALOG (`security_anon_leaks`, Migration 0056) — invertiert gefragt:
 *    worauf haben `anon`/`authenticated` in `public` ueberhaupt noch
 *    Leserechte? Eine Liste der geschuetzten Objekte abzutasten wuerde den
 *    wahrscheinlichsten Rueckfall verpassen: eine neue Tabelle aus Supabase
 *    Studio, angelegt mit der Default-Policy "enable read access for all
 *    users" — ohne Commit, ohne Diff, ohne Probe.
 *
 * 2. LIVE-PROBE mit dem oeffentlichen Schluessel — der Katalog sieht nicht, ob
 *    PostgREST seinen Schema-Cache neu geladen hat. Genau dafuer steht das
 *    `notify pgrst, 'reload schema'` am Ende von 0055.
 *
 * Jede Probe laeuft zweirollig: erst mit der Service-Role (muss Zeilen
 * liefern), dann mit dem Anon-Schluessel (muss abgelehnt werden). Ohne die
 * Gegenprobe waere ein leerer Treffer nicht von einer Sperre zu unterscheiden
 * — der Vertrag meldete gruen, weil nirgends Daten sind.
 */
async function checkAnonLockout(c, r) {
  const anon = anonHeaders();
  const base = supaBase();
  const svc = supaHeaders();

  // Lebt der oeffentliche Schluessel ueberhaupt? Ein abgelaufener oder
  // vertippter Schluessel bekommt auf ALLES 401 — ohne diese Kontrolle wuerde
  // der Vertrag mit jedem Wegdriften des Schluessels gruener statt roter.
  const alive = await rawFetch(
    `${base}/${c.liveness.table}?select=${c.liveness.column}&limit=1`,
    { headers: anon },
  );
  if (alive.status !== 200) {
    return r('error', `Anon-Schluessel antwortet auf ${c.liveness.table} mit HTTP `
      + `${alive.status} (${alive.text}) — erwartet 200. Sperr-Probe waere wertlos.`);
  }

  // --- 1. Katalog
  const leaks = await supaRpc(c.rpc, {});
  if (!Array.isArray(leaks)) return r('error', `${c.rpc} lieferte kein Array`);
  const allowed = new Set(c.allowedOpen || []);
  const open = leaks
    .filter(x => x.severity === 'offen')
    .filter(x => !allowed.has(`${x.kind}:${x.object_name}:${x.role_name}`));
  const onlyGrant = leaks.filter(x => x.severity === 'nur-grant').length;
  if (open.length > 0) {
    const list = open.slice(0, 6)
      .map(x => `${x.object_name}→${x.role_name} (${x.detail})`)
      .join('; ');
    return r('broken', `${open.length} offene Leserechte fuer die oeffentliche Rolle: ${list}`
      + (open.length > 6 ? ` … +${open.length - 6}` : ''));
  }

  // --- 2. Live-Proben
  for (const p of c.probes || []) {
    const path = `${p.table}?select=${p.column || '*'}&limit=1`;
    const control = await rawFetch(`${base}/${path}`, { headers: svc });
    if (control.status !== 200 || !Array.isArray(control.body) || control.body.length === 0) {
      return r('error', `Gegenprobe auf ${p.table} liefert keine Zeilen `
        + `(HTTP ${control.status}) — die Sperre laesst sich daran nicht belegen`);
    }
    const res = await rawFetch(`${base}/${path}`, { headers: anon });
    if (res.status === 200) {
      // Auch 200 mit leerem Array ist ein Bruch: dann ist der SELECT-Grant
      // zurueck und nur noch RLS haelt. Ein Dashboard-Klick weiter ist die
      // Tabelle offen.
      const n = Array.isArray(res.body) ? res.body.length : '?';
      return r('broken', `anon darf ${p.table} wieder abfragen (HTTP 200, ${n} Zeilen) `
        + '— SELECT-Grant ist zurueck');
    }
    if (!isPermissionDenied(res)) {
      return r('error', `${p.table}: unerwartete Antwort HTTP ${res.status} (${res.text}) `
        + '— weder Ablehnung (42501) noch Zugriff');
    }
  }

  for (const p of c.rpcProbes || []) {
    const url = `${base}/rpc/${p.fn}`;
    const init = { method: 'POST', body: JSON.stringify(p.args || {}) };
    const control = await rawFetch(url, { ...init, headers: { ...svc, 'Content-Type': 'application/json' } });
    if (control.status !== 200) {
      return r('error', `Gegenprobe auf ${p.fn} scheitert (HTTP ${control.status}: ${control.text})`);
    }
    const res = await rawFetch(url, { ...init, headers: { ...anon, 'Content-Type': 'application/json' } });
    if (res.status === 200) {
      return r('broken', `anon darf ${p.fn} wieder aufrufen — EXECUTE-Grant ist zurueck`);
    }
    if (!isPermissionDenied(res)) {
      return r('error', `${p.fn}: unerwartete Antwort HTTP ${res.status} (${res.text})`);
    }
  }

  const probes = (c.probes || []).length + (c.rpcProbes || []).length;
  return r('ok', `keine offenen Leserechte (${allowed.size} bewusste Ausnahme(n), `
    + `${onlyGrant}× Grant ohne Wirkung durch RLS), ${probes} Live-Proben abgelehnt`);
}

// ---------------------------------------------------------------- Hetzner

let pgPoolPromise = null;
async function hetznerPool() {
  if (!pgPoolPromise) {
    pgPoolPromise = (async () => {
      const { default: pg } = await import('pg');
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error('DATABASE_URL fehlt');
      return new pg.Pool({ connectionString: url, max: 2, statement_timeout: 30_000 });
    })();
  }
  return pgPoolPromise;
}

export async function closePools() {
  if (pgPoolPromise) {
    const pool = await pgPoolPromise.catch(() => null);
    if (pool) await pool.end().catch(() => {});
    pgPoolPromise = null;
  }
}

async function pgMaxDate(table, col) {
  const pool = await hetznerPool();
  const r = await pool.query(`select max(${col}) as m from ${table}`);
  const v = r.rows[0]?.m;
  if (!v) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

async function pgDistinctDays(table, col, from) {
  const pool = await hetznerPool();
  const r = await pool.query(
    `select distinct ${col}::date as d from ${table} where ${col} >= $1::date order by d`,
    [from],
  );
  return r.rows.map(x => (x.d instanceof Date ? x.d.toISOString().slice(0, 10) : String(x.d)));
}

async function pgCountAll(table) {
  const pool = await hetznerPool();
  const r = await pool.query(`select count(*)::int as c from ${table}`);
  return r.rows[0].c;
}

async function pgCountOnDay(table, col, day) {
  const pool = await hetznerPool();
  const r = await pool.query(
    `select count(*)::int as c from ${table} where ${col}::date = $1::date`,
    [day],
  );
  return r.rows[0].c;
}

async function pgCountInRange(table, col, from, to) {
  const pool = await hetznerPool();
  const r = await pool.query(
    `select count(*)::int as c from ${table}
      where ${col}::date >= $1::date and ${col}::date <= $2::date`,
    [from, to],
  );
  return r.rows[0].c;
}

/** Tag relativ zu heute, UTC, als YYYY-MM-DD. `utcDay(-1)` = gestern. */
function utcDay(offsetDays) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- Prüfung

/**
 * Prüft einen Vertrag.
 * @returns {{id: string, status: 'ok'|'broken'|'error'|'skipped', detail: string}}
 */
export async function checkContract(c) {
  const r = (status, detail) => ({ id: c.id, owner: c.owner, status, detail });

  try {
    if (c.type === 'mirror') return await checkMirror(c, r);
    if (c.type === 'file') return checkFile(c, r);
    if (c.type === 'endpoint') return await checkEndpoint(c, r);
    if (c.type === 'coverage') return await checkCoverage(c, r);
    if (c.type === 'guide-coverage') return await checkGuideCoverage(c, r);
    if (c.type === 'anon-lockout') return await checkAnonLockout(c, r);

    if (c.backend === 'hetzner' && !isOnBox()) {
      return r('skipped', 'nur auf der Hetzner-Box prüfbar');
    }
    const isSupa = c.backend === 'supabase';

    // Reiner Bestandsvertrag ohne Datumsspalte (z.B. Pro-Roster-Grösse).
    if (c.totalRowsMin != null && !c.dateColumn) {
      const n = isSupa ? await supaCount(c.table) : await pgCountAll(c.table);
      return n >= c.totalRowsMin
        ? r('ok', `${n} Rows (min ${c.totalRowsMin})`)
        : r('broken', `nur ${n} Rows, erwartet mindestens ${c.totalRowsMin}`);
    }

    // Rollierendes Fenster auf einer Timestamp-Spalte (z.B. in 7d validiert).
    if (c.windowDays) {
      const since = new Date(Date.now() - c.windowDays * 86_400_000).toISOString();
      const n = isSupa
        ? await supaCount(c.table, `&${c.dateColumn}=gte.${since}`)
        : await (async () => {
            const pool = await hetznerPool();
            const q = await pool.query(
              `select count(*)::int as c from ${c.table} where ${c.dateColumn} >= $1`,
              [since],
            );
            return q.rows[0].c;
          })();
      return n >= c.minRows
        ? r('ok', `${n} Rows in ${c.windowDays}d (min ${c.minRows})`)
        : r('broken', `nur ${n} Rows in ${c.windowDays}d, erwartet mindestens ${c.minRows}`);
    }

    // Lückenprüfung: fehlt in den letzten N Tagen ein Tag ganz? Die
    // Frischeprüfung unten sieht nur den neuesten Tag und übersieht Löcher in
    // der Historie — so blieb der komplett fehlende 27.07. unbemerkt, weil ein
    // abgebrochener Lauf keinen OnSuccess-Catchup auslöst.
    if (c.noGapsInDays) {
      const from = new Date(Date.now() - c.noGapsInDays * 86_400_000).toISOString().slice(0, 10);
      const upto = new Date(Date.now() - c.maxLagDays * 86_400_000).toISOString().slice(0, 10);
      const present = new Set(
        isSupa
          ? (await supaDistinctDays(c.table, c.dateColumn, from)).map(d => d.slice(0, 10))
          : (await pgDistinctDays(c.table, c.dateColumn, from)).map(d => d.slice(0, 10)),
      );
      // Bewusst akzeptierte Lücken (Daten nicht mehr nachziehbar) zählen nicht
      // als Bruch — ein dauerhaft roter Vertrag wird ignoriert und schützt dann
      // gar nichts mehr. Sie laufen automatisch aus dem Fenster.
      const accepted = new Set(c.knownGaps || []);
      const missing = [];
      for (let t = Date.parse(from); t <= Date.parse(upto); t += 86_400_000) {
        const day = new Date(t).toISOString().slice(0, 10);
        if (!present.has(day) && !accepted.has(day)) missing.push(day);
      }
      const stillAccepted = [...accepted].filter(d => d >= from && d <= upto);
      const suffix = stillAccepted.length ? ` (akzeptiert: ${stillAccepted.join(', ')})` : '';
      return missing.length === 0
        ? r('ok', `keine neuen Lücken in ${c.noGapsInDays}d${suffix}`)
        : r('broken', `fehlende Tage: ${missing.join(', ')}${suffix}`);
    }

    // Standard: Frische + Volumen am neuesten vorhandenen Tag.
    const latest = isSupa
      ? await supaMaxDate(c.table, c.dateColumn)
      : await pgMaxDate(c.table, c.dateColumn);
    if (!latest) return r('broken', `${c.table} ist leer`);

    const lag = daysBetween(today(), latest);
    if (lag > c.maxLagDays) {
      return r('broken', `letzter Tag ${latest} ist ${lag}d alt, erlaubt sind ${c.maxLagDays}d`);
    }

    // Bei Timestamp-Spalten trifft `eq.<Datum>` nur exakt Mitternacht und
    // zählt deshalb fast immer 0. Der ganze Tag ist ein Halb-offenes Intervall.
    const dayFilter = c.dateType === 'timestamp'
      ? `&${c.dateColumn}=gte.${latest}T00:00:00&${c.dateColumn}=lt.`
        + `${new Date(Date.parse(latest) + 86_400_000).toISOString().slice(0, 10)}T00:00:00`
      : `&${c.dateColumn}=eq.${latest}`;

    const n = isSupa
      ? await supaCount(c.table, dayFilter)
      : await pgCountOnDay(c.table, c.dateColumn, latest);
    return n >= c.minRows
      ? r('ok', `${latest}: ${n} Rows (min ${c.minRows}, Lag ${lag}d)`)
      : r('broken', `${latest}: nur ${n} Rows, erwartet mindestens ${c.minRows}`);
  } catch (err) {
    // Ein gescheiterter Check ist NICHT grün — sonst hätten wir Silent Success
    // an genau der Stelle, die Silent Success verhindern soll.
    return r('error', err.message);
  }
}

/**
 * Laufendes Set aus der Single Source of Truth. Bewusst ohne den
 * tft-assets.json-Notnagel aus scripts/lib/current-set.mjs: ein Vertrag, der
 * sich auf eine Ersatzquelle stuetzt, meldet im Zweifel gruen fuer das falsche
 * Set. Hier ist "weiss ich nicht" das ehrlichere Ergebnis.
 * Gibt null zurueck, wenn die Datei fehlt oder keine Nummer enthaelt.
 */
function readCurrentSet() {
  const setPath = resolve(REPO_ROOT, 'public', 'tft-set.json');
  if (!existsSync(setPath)) return null;
  let json;
  try {
    json = JSON.parse(readFileSync(setPath, 'utf8'));
  } catch {
    return null;
  }
  const set = Number(json.setNumber ?? json.currentSet?.number ?? json.set ?? json.current);
  return Number.isFinite(set) ? set : null;
}

/**
 * Datei-Vertrag: statische Produktionsdaten im Repo, die eine Seite live
 * ausliefert. Nicht jeder Datenbestand liegt in einer DB — public/pro-teams.json
 * stand vom 21.05. bis 03.08.2026 still, während /teams und /ligen sie weiter
 * anzeigten. Geprüft wird das Feld aus `dateField` (Default `updatedAt`).
 */
function checkFile(c, r) {
  // `{set}` im Pfad wird aus public/tft-set.json aufgeloest. Ohne das stuende
  // die Set-Nummer im Vertragsregister — also genau dort, wo sie beim
  // Set-Wechsel niemand nachzieht, waehrend der Vertrag weiter gruen meldet,
  // weil er die alte (eingefrorene) Datei prueft.
  let relPath = c.path;
  if (relPath.includes('{set}')) {
    const set = readCurrentSet();
    if (set == null) return r('error', 'public/tft-set.json fehlt oder hat keine Set-Nummer');
    relPath = relPath.replace('{set}', String(set));
  }
  const path = resolve(REPO_ROOT, relPath);
  if (!existsSync(path)) return r('broken', `${relPath} existiert nicht`);

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return r('broken', `${relPath} ist kein gültiges JSON: ${err.message}`);
  }

  const stamp = parsed[c.dateField || 'updatedAt'];
  if (!stamp) return r('broken', `${relPath} hat kein Feld ${c.dateField || 'updatedAt'}`);

  const ageDays = Math.floor((Date.now() - Date.parse(stamp)) / 86_400_000);
  if (Number.isNaN(ageDays)) return r('broken', `${relPath}: ${stamp} ist kein Datum`);

  if (c.minEntries) {
    const n = Array.isArray(parsed[c.entriesField]) ? parsed[c.entriesField].length : null;
    if (n == null) return r('broken', `${relPath}: Feld ${c.entriesField} ist keine Liste`);
    if (n < c.minEntries) return r('broken', `${relPath}: nur ${n} Einträge (min ${c.minEntries})`);
  }

  // Verschachtelte Liste (z.B. teams[].results): fängt Deckelungen, die die
  // Top-Level-Zahl nicht sieht. Ein `slice(0, N)` im Crawler lässt die
  // Teamzahl unverändert und schneidet trotzdem Jahre an Historie ab.
  if (c.subListField) {
    const rows = Array.isArray(parsed[c.entriesField]) ? parsed[c.entriesField] : null;
    if (!rows) return r('broken', `${relPath}: Feld ${c.entriesField} ist keine Liste`);
    const counts = rows
      .map(row => (Array.isArray(row?.[c.subListField]) ? row[c.subListField].length : 0))
      .filter(n => n > 0);
    if (counts.length === 0) return r('broken', `${relPath}: kein Eintrag hat ${c.subListField}`);

    if (c.minAvgSubEntries) {
      const avg = counts.reduce((s, n) => s + n, 0) / counts.length;
      if (avg < c.minAvgSubEntries) {
        return r('broken', `${relPath}: nur ${avg.toFixed(1)} ${c.subListField}/Eintrag (min ${c.minAvgSubEntries})`);
      }
    }

    // Modus-Spitze: ein Deckel erzeugt zwangsläufig eine unnatürliche Häufung
    // auf genau einem Wert (gemessen: 50 -> 43 Teams = 8,7 % im Fehlerfall,
    // 26 -> 8 Teams = 2,1 % im gesunden Zustand). Teamzahl-normiert und damit
    // unabhängig davon, wie viele Teams Leaguepedia gerade führt — im
    // Gegensatz zu einer absoluten Summenschwelle.
    if (c.maxModeShare) {
      const floor = c.modeMinCount || 25;
      const hist = new Map();
      for (const n of counts) {
        if (n >= floor) hist.set(n, (hist.get(n) || 0) + 1);
      }
      let peakVal = null, peakN = 0;
      for (const [val, n] of hist) if (n > peakN) { peakN = n; peakVal = val; }
      const share = peakN / counts.length;
      if (peakVal != null && share > c.maxModeShare) {
        return r('broken',
          `${relPath}: ${peakN} von ${counts.length} Einträgen haben exakt ${peakVal} ${c.subListField} `
          + `(${(share * 100).toFixed(1)} %, max ${(c.maxModeShare * 100).toFixed(0)} %) — sieht nach einem Deckel aus`);
      }
    }
  }

  // Felder, die leer sein MÜSSEN. Der Crawler schreibt dort hinein, was er
  // still verschluckt hat (z.B. unbekannte Währungen, die als 0 zählen).
  for (const path of c.mustBeEmpty || []) {
    const val = path.split('.').reduce((o, k) => (o == null ? o : o[k]), parsed);
    const n = Array.isArray(val) ? val.length : (val ? 1 : 0);
    if (n > 0) return r('broken', `${relPath}: ${path} ist nicht leer (${JSON.stringify(val)})`);
  }

  return ageDays <= c.maxAgeDays
    ? r('ok', `${relPath} ist ${ageDays}d alt (max ${c.maxAgeDays}d)`)
    : r('broken', `${relPath} ist ${ageDays}d alt, erlaubt sind ${c.maxAgeDays}d — Aktualisierung ausgefallen`);
}

/**
 * Endpoint-Vertrag: veröffentlichte Artefakte, die weder in einer DB noch im
 * Repo liegen. Das Snapshot-Manifest im Vercel-Blob ist beides — Perf-Schicht
 * und Ausfallpuffer, wenn Supabase klemmt. Veraltet es unbemerkt, liefert die
 * Seite im Ernstfall alte Daten aus und niemand weiß, seit wann.
 */
async function checkEndpoint(c, r) {
  // Env hat Vorrang: zieht der Blob-Store um, wird die Umgebung angepasst,
  // nicht das Vertragsregister. `url` ist nur der Fallback für Umgebungen,
  // in denen die Variable nicht gesetzt ist (Workstation, CI).
  const url = process.env[c.urlEnv || ''] || c.url;
  if (!url) return r('error', `keine URL (weder url noch ${c.urlEnv})`);

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return r('broken', `${url} antwortet HTTP ${res.status}`);

  const body = await res.json();
  const stamp = body[c.dateField];
  if (!stamp) return r('broken', `Antwort hat kein Feld ${c.dateField}`);

  const ageDays = (Date.now() - Date.parse(stamp)) / 86_400_000;
  if (Number.isNaN(ageDays)) return r('broken', `${c.dateField}=${stamp} ist kein Datum`);

  if (c.minEntries) {
    const raw = body[c.entriesField];
    const n = Array.isArray(raw) ? raw.length : (raw && typeof raw === 'object' ? Object.keys(raw).length : null);
    if (n == null) return r('broken', `Feld ${c.entriesField} fehlt oder ist kein Container`);
    if (n < c.minEntries) return r('broken', `nur ${n} Einträge (min ${c.minEntries})`);
  }

  return ageDays <= c.maxAgeDays
    ? r('ok', `${ageDays.toFixed(1)}d alt (max ${c.maxAgeDays}d)`)
    : r('broken', `${ageDays.toFixed(1)}d alt, erlaubt sind ${c.maxAgeDays}d — Veröffentlichung ausgefallen`);
}

/**
 * Abdeckungs-Vertrag: KEINE Gruppe darf zurückfallen.
 *
 * Ein Gesamt-Frischecheck sieht nur die jüngste Zeile und ist deshalb blind
 * dafür, dass einzelne Gruppen seit Wochen leer ausgehen. Genau so standen am
 * 03.08.2026 fünf Regionen auf Marktwerten vom 12.06. (52 Tage), während die
 * Tabelle insgesamt taufrisch aussah — der Driver arbeitete die Regionen in
 * fester Reihenfolge ab und kam nie hinten an.
 */
async function checkCoverage(c, r) {
  if (c.backend === 'hetzner' && !isOnBox()) {
    return r('skipped', 'nur auf der Hetzner-Box prüfbar');
  }
  if (c.compareTo) return checkCoverageLag(c, r);
  const isSupa = c.backend === 'supabase';

  let rows;
  if (isSupa) {
    // PostgREST kann kein GROUP BY — je Gruppe die jüngste Zeile holen.
    rows = [];
    for (const g of c.groups) {
      const res = await supaGet(
        `${c.table}?select=${c.dateColumn}&${c.groupColumn}=eq.${g}`
        + `&order=${c.dateColumn}.desc&limit=1`,
      );
      const j = await res.json();
      rows.push({ grp: g, newest: j[0]?.[c.dateColumn] ?? null });
    }
  } else {
    const pool = await hetznerPool();
    const q = await pool.query(
      `select ${c.groupColumn} as grp, max(${c.dateColumn}) as newest
         from ${c.table} group by ${c.groupColumn}`,
    );
    rows = q.rows;
  }

  const seen = new Map(rows.map(x => [
    String(x.grp),
    x.newest ? Math.floor((Date.now() - Date.parse(x.newest)) / 86_400_000) : null,
  ]));

  const stale = [];
  for (const g of c.groups) {
    const age = seen.get(g);
    if (age == null) stale.push(`${g}(nie)`);
    else if (age > c.maxLagDays) stale.push(`${g}(${age}d)`);
  }

  if (stale.length === 0) {
    const worst = Math.max(...[...seen.values()].filter(v => v != null), 0);
    return r('ok', `alle ${c.groups.length} ${c.groupColumn}s ≤ ${c.maxLagDays}d (ältestes ${worst}d)`);
  }
  return r('broken',
    `${stale.length}/${c.groups.length} ${c.groupColumn}s über ${c.maxLagDays}d: ${stale.join(' ')}`);
}

/**
 * Guide-Abdeckungs-Vertrag: deckt die Comp-Guide-Quelle noch das ab, was
 * tatsächlich gespielt wird?
 *
 * Der einzige Vertrag, der eine DB-Aggregation gegen eine Repo-Datei hält —
 * beide Seiten können unabhängig voneinander wegdriften, und die interessante
 * Größe ist ihr Schnitt. Die Guides kommen aus MetaTFTs Auto-Clustering, die
 * gespielten Familien aus unseren eigenen Match-Daten. Verschiebt ein Patch das
 * Meta, sinkt die Abdeckung ohne dass irgendein Job fehlschlägt: das Bundle ist
 * frisch, die Tabelle ist frisch, nur passen sie nicht mehr zueinander. Die
 * `datei-frische` daneben sieht das strukturell nicht.
 *
 * Die Aggregation steht in der DB (Migration 0054) und wird vom Verifier
 * (`npm run verify:coverage`) mit denselben Parametern aufgerufen — der Vertrag
 * misst also exakt die Zahl, die man lokal nachstellen kann.
 *
 * Die Schwelle ist bewusst locker: gemessen über 37 Fenster lag die Abdeckung
 * bei 67,4 % ± 0,7 pp. Ein Gate auf dem aktuellen Wert wäre an jedem einzelnen
 * historischen Fenster rot gewesen. 64 % liegt ~5 sd unter dem Mittel und
 * schlägt erst an, wenn wirklich etwas kaputt ist — ein Meta-Shift ohne
 * MetaTFT-Refresh, ein Import mit halber Familien-Map, ein Set-Wechsel, bei dem
 * das Bundle nachhinkt.
 */
async function checkGuideCoverage(c, r) {
  // Set aus der Single Source of Truth, nicht aus dem Vertrag: sonst wäre der
  // Vertrag beim Set-Wechsel genau der Ort, an dem niemand nachzieht.
  const set = readCurrentSet();
  if (set == null) return r('error', 'public/tft-set.json fehlt oder hat keine Set-Nummer');

  const bundlePath = (c.bundlePath || 'public/tft-metatft-comps-{set}.json')
    .replace('{set}', String(set));
  const abs = resolve(REPO_ROOT, bundlePath);
  if (!existsSync(abs)) return r('broken', `${bundlePath} existiert nicht`);

  let familyMap;
  try {
    familyMap = JSON.parse(readFileSync(abs, 'utf8')).familyMap;
  } catch (err) {
    return r('broken', `${bundlePath} ist kein gültiges JSON: ${err.message}`);
  }
  if (!familyMap || Object.keys(familyMap).length === 0) {
    return r('broken', `${bundlePath} hat keine familyMap — Import unvollständig`);
  }

  const rows = await supaRpc(c.rpc, {
    p_days: c.days ?? 7,
    p_set: set,
    p_top: c.top ?? 50,
  });
  if (!Array.isArray(rows)) return r('error', `${c.rpc} lieferte kein Array`);

  // Ohne Datenlage ist ein Verhältnis bedeutungslos: 3 von 3 wären 100 %. Der
  // Fall tritt real auf, wenn der Daily-Crawl steht oder das Set frisch
  // gewechselt hat — beides soll hier laut sein, nicht grün.
  const minFamilies = c.minFamilies ?? Math.floor((c.top ?? 50) * 0.8);
  if (rows.length < minFamilies) {
    return r('broken',
      `nur ${rows.length} Familien über der Spielgrenze (min ${minFamilies}) — `
      + `zu dünne Datenlage für eine Abdeckungs-Aussage, Set ${set}`);
  }

  // Gemessen wird der Anteil der SPIELE mit Guide, nicht der Anteil der
  // Familien. Beides ist verfügbar und die Zahlen liegen weit auseinander —
  // aktuell 28/50 Familien (56 %) bei 70 % Volumen —, weil die gedeckten
  // Familien die grossen sind. Für die Frage „wie oft steht ein Spieler vor
  // einer Comp-Seite ohne Guide" zählt das Volumen; der Familien-Zähler würde
  // eine Long-Tail-Familie mit 120 Spielen genauso gewichten wie DRX__Kindred
  // mit 44.865. Der Familien-Stand steht trotzdem im Detail, weil er die
  // schnellere Diagnose ist.
  const missing = rows.filter(x => !familyMap[x.family_key]);
  const matchedRows = rows.length - missing.length;
  const totalGames = rows.reduce((s, x) => s + Number(x.total_games), 0);
  const missingGames = missing.reduce((s, x) => s + Number(x.total_games), 0);
  if (totalGames === 0) return r('error', `${c.rpc} lieferte nur Zeilen ohne Spiele`);

  const ratio = (totalGames - missingGames) / totalGames;
  const pct = (ratio * 100).toFixed(1);
  const min = (c.minRatio * 100).toFixed(0);
  const stand = `${pct} % Volumen (min ${min} %), ${matchedRows}/${rows.length} Familien`;

  if (ratio >= c.minRatio) return r('ok', stand);

  const worst = missing
    .slice(0, 3)
    .map(x => `${x.family_key.replace(/TFT\d+_/g, '')}(${x.total_games})`);
  return r('broken', `nur ${stand} — grösste Lücken: ${worst.join(' ')}`);
}

/**
 * Abdeckungs-Vertrag im Differenz-Modus (`compareTo`): misst je Gruppe NUR den
 * Spiegelverzug Ziel↔Quelle, nicht das absolute Alter.
 *
 * Vorher mass der Supabase-Abdeckungsvertrag beides in einer Zahl — Quellalter
 * PLUS Spiegelverzug. Am 04.08.2026 meldete er oc1 mit 53 Tagen, obwohl oc1
 * am selben Tag gelaufen war und 951 Snapshots geschrieben hatte; es fehlte
 * nur der Spiegellauf. Eine Zahl, zwei Ursachen, keine Diagnose.
 *
 * Jetzt gilt die Arbeitsteilung: `*-hetzner` (maxLagDays 2) wacht über die
 * Frische an der Quelle, dieser hier über die Kette Quelle→Spiegel. Jeder
 * Vertrag sagt genau eine Sache. Wichtig: der Verzug wird gegen die Quelle
 * gemessen, nicht gegen heute — eine Region, die an der Quelle seit Wochen
 * still steht, ist hier korrekt grün und drüben rot.
 */
async function checkCoverageLag(c, r) {
  if (!isOnBox()) return r('skipped', 'Differenz-Vergleich braucht beide DBs (nur auf der Box)');

  // Der laufende Tag ist quellseitig ausgeschlossen: eine Region, die vor
  // Minuten fertig geschrieben wurde, wartet zwangsläufig bis zum nächsten
  // 6h-Spiegellauf. Ohne diesen Ausschluss meldet der Vertrag genau den
  // Normalbetrieb als Bruch — dieselbe Fehlalarm-Klasse, die er beheben soll,
  // nur durch die Hintertür (beim ersten Testlauf am 05.08. prompt passiert:
  // sg2 wurde 13:5x fertig und stand sofort mit "54d hinter Hetzner" drin).
  const pool = await hetznerPool();
  const q = await pool.query(
    `select ${c.groupColumn} as grp, max(${c.dateColumn}) as newest
       from ${c.table} where ${c.dateColumn}::date < current_date
       group by ${c.groupColumn}`,
  );
  const srcDay = new Map(q.rows.map(x => [
    String(x.grp),
    x.newest ? String(x.newest instanceof Date ? x.newest.toISOString().slice(0, 10) : x.newest).slice(0, 10) : null,
  ]));

  const behind = [];
  for (const g of c.groups) {
    const src = srcDay.get(g);
    if (!src) continue;   // an der Quelle nie vorhanden → Sache des Frische-Vertrags
    const res = await supaGet(
      `${c.table}?select=${c.dateColumn}&${c.groupColumn}=eq.${g}`
      + `&order=${c.dateColumn}.desc&limit=1`,
    );
    const j = await res.json();
    const dst = j[0]?.[c.dateColumn] ? String(j[0][c.dateColumn]).slice(0, 10) : null;
    if (!dst) { behind.push(`${g}(nie gespiegelt)`); continue; }
    const lag = Math.round((Date.parse(src) - Date.parse(dst)) / 86_400_000);
    if (lag > c.maxLagDays) behind.push(`${g}(${lag}d hinter Hetzner)`);
  }

  return behind.length === 0
    ? r('ok', `alle ${c.groups.length} ${c.groupColumn}s ≤ ${c.maxLagDays}d hinter der Quelle`)
    : r('broken',
        `${behind.length}/${c.groups.length} ${c.groupColumn}s über ${c.maxLagDays}d Spiegelverzug: ${behind.join(' ')}`);
}

/**
 * Spiegel-Vertrag: Ziel muss ~so viele Rows haben wie die Quelle.
 *
 * Geprüft wird ein FENSTER (Default 7 Tage), das den laufenden Tag ausschliesst
 * — nicht der neueste Tag. Drei Gründe, alle am 05.08.2026 gemessen:
 *
 * 1. `max(snapshot_date)` ist per Konstruktion der Tag, der GERADE geschrieben
 *    wird. Der Spiegel läuft auf einem eigenen 6h-Timer (01/07/13/19:15 UTC),
 *    der zentrale Vertragslauf um 23:00. Am 04.08. meldete dieser Vertrag
 *    deshalb "72%, Sync läuft nicht", während jeder Sync-Lauf selbst 100%
 *    Parität meldete und beide DBs für alle 19 Tage seit dem 15.07.
 *    zeilengleich waren. Ein Vertrag mit vier Fehlalarmen pro Tag wird
 *    stummgeschaltet und schützt dann gar nichts.
 * 2. Ein Einzeltag kann im Rundlauf leer sein (am 04.08. hatten 13 von 15
 *    Regionen null Rows). Bei `src === 0` ging die alte Ratio auf 1 und der
 *    Vertrag wurde vakuum-grün.
 * 3. Das Sync-Script hat ein rollierendes Fenster (`--window 3`). Fällt der
 *    Sync länger als drei Tage aus, ist der herausgefallene Tag DAUERHAFT
 *    ungespiegelt — genau die Klasse des Vorfalls 24.07.–03.08. (38.197
 *    nachgezogene Snapshots). Ein Einzeltags-Check sah das nach der Recovery
 *    nie wieder; die Fenstersumme sieht es.
 *
 * `minRatio` bleibt bewusst unangetastet — der Fehler lag im Messzeitpunkt,
 * nicht in der Schwelle. Die Schwelle ratio-basiert zu definieren ("neuester
 * Tag, der die Ratio erfüllt") wäre eine Tautologie: der Vertrag könnte dann
 * per Konstruktion nie brechen.
 */
async function checkMirror(c, r) {
  if (!isOnBox()) return r('skipped', 'Mirror-Vergleich braucht beide DBs (nur auf der Box)');

  const windowDays = c.windowDays ?? 7;
  const from = utcDay(-windowDays);
  const to = utcDay(-1);
  const span = `${from}…${to}`;

  const src = await pgCountInRange(c.table, c.dateColumn, from, to);
  // src === 0 ist KEIN Erfolg: dann hat die Quelle eine ganze Woche nichts
  // produziert. Das ist ein Fall für den Frische-Vertrag, aber stillschweigend
  // grün darf er hier nicht werden.
  if (src === 0) {
    return r('broken', `${span}: Hetzner hat im Fenster keine Rows — Quelle prüfen`);
  }

  const dst = await supaCount(
    c.table,
    `&${c.dateColumn}=gte.${from}&${c.dateColumn}=lte.${to}`,
  );
  const ratio = dst / src;

  return ratio >= c.minRatio
    ? r('ok', `${span}: Supabase ${dst} / Hetzner ${src} (${(ratio * 100).toFixed(0)}%)`)
    : r('broken',
        `${span}: Supabase hat nur ${dst} von ${src} Hetzner-Rows ` +
        `(${(ratio * 100).toFixed(0)}%, erwartet ${(c.minRatio * 100).toFixed(0)}%) — Sync läuft nicht`);
}

/**
 * Für Driver: prüft am Ende des Laufs den eigenen Vertrag.
 *
 * Default ist BEWUSST nicht-fatal. Die Marktwert- und Crawl-Units hängen über
 * `OnSuccess=` aneinander; ein Exit != 0 wegen Vertragsbruch würde die Kette
 * abreissen und damit mehr kaputtmachen, als die Meldung wert ist. Der Driver
 * meldet also laut ins Journal, und der zentrale Timer-Lauf
 * (`check-contracts.mjs`, hängt in keiner Kette) ist der, der hart failt.
 *
 * `{ strict: true }` nur für Driver verwenden, an denen kein OnSuccess hängt.
 */
export async function assertContracts(ids, { strict = false } = {}) {
  loadEnv();
  const wanted = new Set(Array.isArray(ids) ? ids : [ids]);
  const all = loadContracts().filter(c => wanted.has(c.id));
  const missing = [...wanted].filter(id => !all.some(c => c.id === id));
  if (missing.length) throw new Error(`Unbekannter Vertrag: ${missing.join(', ')}`);

  const results = [];
  for (const c of all) results.push(await checkContract(c));
  await closePools();

  const bad = results.filter(x => x.status === 'broken' || x.status === 'error');
  for (const x of results) console.log(`[contract] ${x.status.padEnd(7)} ${x.id} — ${x.detail}`);
  if (bad.length) {
    const msg = `Vertrag verletzt: ${bad.map(b => `${b.id} (${b.detail})`).join('; ')}`;
    if (strict) throw new Error(msg);
    console.error(`[contract] WARNUNG — ${msg}`);
    console.error('[contract] Lauf wird nicht abgebrochen (OnSuccess-Kette). '
      + 'Der zentrale Check meldet das hart.');
  }
  return results;
}
