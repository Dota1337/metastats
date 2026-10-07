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
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { evaluateGuideCoverage } from './guide-coverage.mjs';

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

/** Neuester Tag STRIKT vor `before` (YYYY-MM-DD), als YYYY-MM-DD. */
async function supaMaxDateBefore(table, col, before) {
  const res = await supaGet(
    `${table}?select=${col}&${col}=lt.${before}&order=${col}.desc.nullslast&limit=1`,
  );
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
      const pool = new pg.Pool({ connectionString: url, max: 2, statement_timeout: 30_000 });
      pool.on('error', (e) => console.error(`DB-Verbindung verworfen: ${e.message}`));
      return pool;
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

async function pgMaxDateBefore(table, col, before) {
  const pool = await hetznerPool();
  const r = await pool.query(
    `select max(${col}) as m from ${table} where ${col} < $1::date`,
    [before],
  );
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
 *
 * `warn` = gelb: etwas weicht ab, ist aber kein Ausfall. Zaehlt nicht fuer den
 * Exit-Code und nicht fuer die Treiber-Warnung, bekommt aber eine Aufgabe
 * (eine Mail je neuem Grund, siehe contracts-alert.mjs).
 * @returns {{id: string, status: 'ok'|'warn'|'broken'|'error'|'skipped', detail: string}}
 */
export async function checkContract(c) {
  return applyArming(c, await runCheck(c));
}

/**
 * Vertraege mit `"armed": false` laufen mit, zaehlen aber nie: jedes Ergebnis
 * wird zu skipped, der eigentliche Befund steht im Text. So laesst sich ein
 * neuer Vertrag gegen echte Daten beobachten, ohne dass er Alarm, Exit-Code
 * oder die Treiber-Warnung ausloest (patch-axis: scharf erst nach dem
 * Negativtest der Datenkorrektur).
 */
export function applyArming(c, res) {
  if (c.armed !== false) return res;
  return { ...res, status: 'skipped', detail: `nicht scharf (Beobachtung) — waere ${res.status}: ${res.detail}` };
}

async function runCheck(c) {
  const r = (status, detail) => ({ id: c.id, owner: c.owner, status, detail });

  try {
    if (c.type === 'mirror') return await checkMirror(c, r);
    if (c.type === 'file') return checkFile(c, r);
    if (c.type === 'endpoint') return await checkEndpoint(c, r);
    if (c.type === 'coverage') return await checkCoverage(c, r);
    if (c.type === 'guide-coverage') return await checkGuideCoverage(c, r);
    if (c.type === 'anon-lockout') return await checkAnonLockout(c, r);
    if (c.type === 'set-axis') return await checkSetAxis(c, r);
    if (c.type === 'patch-axis') return await checkPatchAxis(c, r);
    if (c.type === 'lol-patch-shift') return await checkLolPatchShift(c, r);
    if (c.type === 'box-main') return await checkBoxMain(c, r);

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

    // Standard: Frische am neuesten Tag, Volumen am letzten ABGESCHLOSSENEN.
    //
    // Befund B (2026-08-18): beides am selben Tag zu messen war falsch. Der
    // neueste Tag ist im Normalbetrieb der, der gerade geschrieben wird —
    // marketvalue/hetzner-snapshots läuft über >24h, der Daily-Crawl über
    // Stunden. Die Zeile zählt dann einen Bruchteil und meldet Bruch, obwohl
    // nichts kaputt ist; oder minRows wurde auf den Teilstand heruntergesetzt
    // und der Vertrag prüft faktisch nichts mehr. Frische gehört an den
    // neuesten Tag, Volumen an den letzten fertigen.
    const cutoff = today();   // JS-UTC, dieselbe Definition wie beim Lag
    const latest = isSupa
      ? await supaMaxDate(c.table, c.dateColumn)
      : await pgMaxDate(c.table, c.dateColumn);
    if (!latest) return r('broken', `${c.table} ist leer`);

    const lag = daysBetween(cutoff, latest);
    if (lag > c.maxLagDays) {
      return r('broken', `letzter Tag ${latest} ist ${lag}d alt, erlaubt sind ${c.maxLagDays}d`);
    }

    // Ist `latest` schon der laufende Tag, brauchen wir den Tag davor. Damit
    // sind mindestens zwei Tage Historie nötig; liegt nur der laufende Tag
    // vor, sagen wir das laut, statt einen Teilstand als Vollstand zu werten.
    const countDay = latest < cutoff
      ? latest
      : isSupa
        ? await supaMaxDateBefore(c.table, c.dateColumn, cutoff)
        : await pgMaxDateBefore(c.table, c.dateColumn, cutoff);
    if (!countDay) {
      return r('broken', `${c.table} hat nur den laufenden Tag ${latest}, kein abgeschlossener Tag zum Zählen`);
    }

    // Bei Timestamp-Spalten trifft `eq.<Datum>` nur exakt Mitternacht und
    // zählt deshalb fast immer 0. Der ganze Tag ist ein Halb-offenes Intervall.
    const dayFilter = c.dateType === 'timestamp'
      ? `&${c.dateColumn}=gte.${countDay}T00:00:00&${c.dateColumn}=lt.`
        + `${new Date(Date.parse(countDay) + 86_400_000).toISOString().slice(0, 10)}T00:00:00`
      : `&${c.dateColumn}=eq.${countDay}`;

    const n = isSupa
      ? await supaCount(c.table, dayFilter)
      : await pgCountOnDay(c.table, c.dateColumn, countDay);
    const where = countDay === latest ? countDay : `${countDay} (neuester Tag: ${latest})`;
    return n >= c.minRows
      ? r('ok', `${where}: ${n} Rows (min ${c.minRows}, Lag ${lag}d)`)
      : r('broken', `${where}: nur ${n} Rows, erwartet mindestens ${c.minRows}`);
  } catch (err) {
    // Ein gescheiterter Check ist NICHT grün — sonst hätten wir Silent Success
    // an genau der Stelle, die Silent Success verhindern soll.
    return r('error', err.message);
  }
}

/**
 * Set-Achsen-Vertrag: traegt die Tabelle ueberhaupt eine Set-Spalte, ist sie
 * vollstaendig gefuellt, und stehen dort Zeilen des laufenden Sets?
 *
 * Warum das existiert: bis 2026-08-27 hatten tft_player_marketvalue_snapshots
 * und tft_public_comps keine Set-Spalte. Jeder Leser nahm die neueste Zeile,
 * egal aus welchem Set — auf der Spielerseite standen deshalb nach dem
 * Set-18-Start weiter die 510 Spiele aus Set 17. Kein Waechter sah das, weil
 * alle bestehenden Vertraege nur Frische und Zeilenzahl pruefen, und beides
 * war gruen.
 *
 * `minRows` bewusst klein (Existenz, nicht Menge): unmittelbar nach einem
 * Set-Start ist die neue Population noch im Aufbau. Ueber die Menge wachen die
 * Frische-Vertraege derselben Tabelle.
 */
async function checkSetAxis(c, r) {
  const set = readCurrentSet();
  if (set == null) return r('error', 'public/tft-set.json fehlt oder hat keine Set-Nummer');
  if (c.backend === 'hetzner' && !isOnBox()) return r('skipped', 'nur auf der Hetzner-Box pruefbar');

  const col = c.setColumn || 'set_number';
  const minRows = c.minRows ?? 1;
  let current, nulls;
  if (c.backend === 'supabase') {
    current = await supaCount(c.table, `&${col}=eq.${set}`);
    nulls = await supaCount(c.table, `&${col}=is.null`);
  } else {
    const pool = await hetznerPool();
    const q = await pool.query(
      `select count(*) filter (where ${col} = $1)::int as cur,
              count(*) filter (where ${col} is null)::int as nul
         from ${c.table}`,
      [set],
    );
    current = q.rows[0].cur; nulls = q.rows[0].nul;
  }

  if (nulls > 0) {
    return r('broken', `${nulls} Zeilen ohne ${col} — ein Leser mit Set-Filter uebersieht sie, einer ohne mischt sie ein`);
  }
  if (current < minRows) {
    return r('broken', `keine Zeilen fuer Set ${set} (min ${minRows}) — die Seite zeigt Daten des Vorsets oder nichts`);
  }
  return r('ok', `${current} Zeilen im Set ${set}, 0 ohne ${col}`);
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

/** public/tft-set.json als Ganzes (Terminplan patchStarts/patchCuts), sonst null. */
function readSetMeta() {
  try {
    return JSON.parse(readFileSync(resolve(REPO_ROOT, 'public', 'tft-set.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Kalendertag + n, beides YYYY-MM-DD (UTC). */
function shiftDay(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- Patch-Achse

/**
 * Vertrag patch-axis: tragen die Tagesaggregate den Patch-Namen, den Riots
 * Terminplan (public/tft-set.json patchStarts/patchCuts) fuer den Fenstertag
 * vorgibt? Anlass: 23.09./24.09. standen als 18.2b statt 18.3/18.3b, weil der
 * Name aus dem LoL-Versionsstand kam und der zwei Tage zu spaet umsprang. Frische
 * und Zeilenzahl waren dabei gruen — nur ein Abgleich gegen den Soll-Namen sieht
 * das.
 *
 * Gelesen wird per pg direkt in Supabase (REST kann nicht gruppieren), in einer
 * Nur-Lese-Transaktion. Uebersprungen werden Tage ohne Vertrauen (Rueckfall auf
 * latestPatch, Terminplan unstimmig oder zu Ende), Zeilen aus einem anderen Set
 * und der ganze Lauf, solange die Umbenennung (scripts/relabel-tft-bpatch.mjs)
 * arbeitet — mitten im Wechsel waere jeder Befund ein Fehlalarm.
 */
const PATCH_AXIS_TABLES = ['tft_daily_crawl_meta', 'tft_daily_comp_outcome'];
const RELABEL_RUNNING_MAX_H = 6;   // aelter = abgestuerzter Lauf, Statusdatei zaehlt nicht mehr

// pg_try_advisory_xact_lock(hashtext(k)) legt die bigint-Form an: objsubid 1,
// classid = obere, objid = untere 32 Bit. Gemessen gegen eine echte Sperre.
const RELABEL_LOCK_SQL = `select count(*)::int as n
  from pg_locks l, (select hashtext($1)::bigint as k) h
 where l.locktype = 'advisory' and l.objsubid = 1
   and l.classid::bigint = ((h.k >> 32) & 4294967295)
   and l.objid::bigint = (h.k & 4294967295)`;

/**
 * Reine Auswertung (ohne DB, testbar).
 * rowsByTable: { [tabelle]: [{ day, set_number, patch, n }] }
 * expect(day): Ergebnis von patchForDay — { patch, trusted, ... }
 */
export function evaluatePatchAxis({ rowsByTable, set, expect }) {
  const memo = new Map();
  const want = (day) => {
    if (!memo.has(day)) memo.set(day, expect(day));
    return memo.get(day);
  };
  const wrong = [];
  const checked = new Set();
  const untrusted = new Set();
  let otherSetRows = 0;

  for (const [table, rows] of Object.entries(rowsByTable)) {
    for (const row of rows) {
      const day = String(row.day).slice(0, 10);
      const n = Number(row.n) || 0;
      if (Number(row.set_number) !== Number(set)) { otherSetRows += n; continue; }
      const e = want(day);
      if (!e?.trusted || !e.patch) { untrusted.add(day); continue; }
      checked.add(`${table}|${day}`);
      if (row.patch !== e.patch) wrong.push({ table, day, got: row.patch ?? '(leer)', want: e.patch, n });
    }
  }

  const notes = [];
  if (untrusted.size) notes.push(`${untrusted.size} Tag(e) ohne verlaesslichen Terminplan uebersprungen`);
  if (otherSetRows) notes.push(`${otherSetRows} Zeilen aus anderem Set ignoriert`);
  const tail = notes.length ? ` (${notes.join(', ')})` : '';

  if (wrong.length) {
    const badDays = new Set(wrong.map((w) => `${w.table}|${w.day}`)).size;
    return { status: 'broken', detail: `${badDays} Tabellen-Tag(e) mit falschem Patch-Namen — ${compactWrong(wrong)}${tail}` };
  }
  if (!checked.size) return { status: 'skipped', detail: `keine pruefbaren Tage${tail}` };
  return { status: 'ok', detail: `${checked.size} Tabellen-Tage tragen den Namen aus dem Terminplan${tail}` };
}

/** Fasst aufeinanderfolgende Tage mit gleichem Fehler je Tabelle zusammen. */
function compactWrong(wrong) {
  const sorted = [...wrong].sort((a, b) => a.table.localeCompare(b.table) || a.day.localeCompare(b.day) || a.got.localeCompare(b.got));
  const byTable = new Map();
  for (const w of sorted) {
    const list = byTable.get(w.table) ?? [];
    byTable.set(w.table, list);
    const last = list.findLast((x) => x.got === w.got && x.want === w.want);
    if (last && shiftDay(last.to, 1) === w.day) { last.to = w.day; last.n += w.n; continue; }
    list.push({ from: w.day, to: w.day, got: w.got, want: w.want, n: w.n });
  }
  return [...byTable].map(([table, list]) => `${table}: ${list
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((x) => `${x.from === x.to ? x.from : `${x.from}…${x.to}`} ${x.got} statt ${x.want} (${x.n} Zeilen)`)
    .join(', ')}`).join('; ');
}

/** Laeuft laut Statusdatei gerade eine Umbenennung? Grund als Text, sonst null.
 *  Die DB-Sperre gilt nur je Tag; zwischen zwei Tagen sieht man den Lauf nur hier. */
function relabelRunningReason(relabel, now = Date.now()) {
  let st;
  try {
    const file = join(relabel.defaultStateDir(process.env), relabel.STATUS_FILE);
    if (!existsSync(file)) return null;
    st = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (st?.state !== 'running') return null;
  const ageH = (now - Date.parse(st.startedAt)) / 3_600_000;
  if (!Number.isFinite(ageH) || ageH > RELABEL_RUNNING_MAX_H) return null;
  return `Umbenennung laeuft seit ${Math.round(ageH * 60)} min (Statusdatei) — Namen sind mitten im Wechsel`;
}

async function checkPatchAxis(c, r) {
  const meta = readSetMeta();
  const set = readCurrentSet();
  if (!meta || set == null) return r('error', 'public/tft-set.json fehlt oder hat keine Set-Nummer');

  // Dynamisch: ein kaputter Helfer kippt nur diesen Vertrag, nicht die Treiber,
  // die contracts.mjs fuer ihre eigenen Vertraege laden.
  const [{ patchForDay, addDays }, { currentWindowDay }, { supabasePgUrl }] = await Promise.all([
    import('./tft-patch-day.mjs'), import('./tft-crawl-window.mjs'), import('./pg-url.mjs'),
  ]);
  const relabel = await import('./tft-patch-relabel.mjs').catch(() => null);
  if (!relabel?.LOCK_KEY) return r('error', 'scripts/lib/tft-patch-relabel.mjs nicht ladbar — Umbenennungs-Sperre nicht pruefbar');

  const running = relabelRunningReason(relabel);
  if (running) return r('skipped', running);

  const days = c.days ?? 14;
  const cwd = currentWindowDay(new Date());
  const from = addDays(cwd, -days);
  const to = addDays(cwd, -1);
  const tables = c.tables ?? PATCH_AXIS_TABLES;
  for (const t of tables) if (!/^[a-z_][a-z0-9_]*$/.test(t)) return r('error', `ungueltiger Tabellenname ${t}`);

  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: supabasePgUrl(process.env),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
    application_name: 'contract-patch-axis',
  });
  client.on('error', (e) => console.error(`patch-axis: Verbindung verworfen: ${e.message}`));
  await client.connect();
  const held = async () => (await client.query(RELABEL_LOCK_SQL, [relabel.LOCK_KEY])).rows[0].n > 0;
  const lockMsg = 'Umbenennung haelt gerade die DB-Sperre — Namen sind mitten im Wechsel';
  try {
    // Nur lesen. SET LOCAL statt Sitzungs-SET: haelt auch hinter einem
    // Transaktions-Pooler nur fuer diese eine Transaktion.
    await client.query('begin transaction read only');
    await client.query('set local default_transaction_read_only = on');
    await client.query(`set local statement_timeout = '30s'`);
    if (await held()) return r('skipped', lockMsg);
    const rowsByTable = {};
    for (const t of tables) {
      const q = await client.query(
        `select day::text as day, set_number, patch, count(*)::int as n
           from ${t}
          where day >= $1::date and day <= $2::date
          group by 1, 2, 3`,
        [from, to],
      );
      rowsByTable[t] = q.rows;
    }
    // Zweiter Blick: hat die Umbenennung waehrend des Lesens begonnen?
    if (await held() || relabelRunningReason(relabel)) return r('skipped', lockMsg);
    const res = evaluatePatchAxis({ rowsByTable, set, expect: (d) => patchForDay(d, meta, set) });
    return r(res.status, `${from}…${to}: ${res.detail}`);
  } finally {
    await client.query('rollback').catch(() => {});
    await client.end().catch(() => {});
  }
}

// ---------------------------------------------------------------- LoL-Verschiebung

/**
 * Vertrag lol-patch-shift: ging der LoL-Patch, der zum TFT-Patch gehoert,
 * an demselben Fenstertag live, den der Terminplan fuer TFT nennt? TFT und LoL
 * patchen gemeinsam; zeigen die EUW-Ranglistenspiele der Box den LoL-Patch
 * einen Tag frueher oder spaeter in der Mehrheit, stimmt vermutlich der
 * Terminplan nicht — dann waeren alle Patch-Namen ab dort verschoben.
 *
 * Nur Warnung: die LoL-Stichprobe ist klein und schwankt (seit 20.09. deutlich
 * weniger Spiele). Ein Tag unter `minMatchesPerDay` gilt als unvollstaendig,
 * dann ist das Ergebnis "unbekannt", nicht gruen. Mehrheit statt erstem
 * Auftauchen: einzelne Spiele am Rand des Fensters sollen nichts ausloesen.
 */
const LOL_PATCH_SQL = `select ((game_creation at time zone 'UTC') - interval '5 hours')::date::text as day,
       patch_major || '.' || patch_minor as patch,
       count(distinct match_id)::int as matches
  from lol_match_participant_raw
 where region = $1 and queue_id = $2
   and game_creation >= ($3::date + interval '5 hours') at time zone 'UTC'
   and game_creation < ($4::date + interval '5 hours') at time zone 'UTC'
 group by 1, 2`;

/**
 * Reine Auswertung eines Patchstarts (ohne DB, testbar).
 * start: { patch, from_day }, lol: LoL-Patch (z.B. '16.19'),
 * rows: [{ day, patch, matches }] fuer Vortag bis lastDay.
 * Gibt { state: 'ok'|'warn'|'unknown', text } zurueck.
 */
export function evaluateLolPatchShift({ start, lol, rows, lastDay, minMatchesPerDay = 300, minShare = 0.5 }) {
  const byDay = new Map();
  for (const x of rows) {
    const d = String(x.day).slice(0, 10);
    const e = byDay.get(d) ?? { total: 0, hit: 0 };
    const m = Number(x.matches) || 0;
    e.total += m;
    if (String(x.patch) === lol) e.hit += m;
    byDay.set(d, e);
  }
  const info = (d) => {
    const e = byDay.get(d) ?? { total: 0, hit: 0 };
    return { ...e, complete: e.total >= minMatchesPerDay, share: e.total ? e.hit / e.total : 0 };
  };
  const pct = (s) => `${Math.round(s * 100)} %`;
  const label = `${start.patch} (LoL ${lol})`;
  const goLive = start.from_day;
  const prev = shiftDay(goLive, -1);

  const p = info(prev);
  if (!p.complete) return { state: 'unknown', text: `${label}: Vortag ${prev} unvollstaendig (${p.total} Spiele)` };
  if (p.share >= minShare) {
    return { state: 'warn', text: `${label}: LoL-Patch schon am ${prev} in der Mehrheit (${pct(p.share)}), TFT-Go-live laut Terminplan erst ${goLive}` };
  }
  const g = info(goLive);
  if (!g.complete) return { state: 'unknown', text: `${label}: Go-live-Tag ${goLive} unvollstaendig (${g.total} Spiele)` };
  if (g.share >= minShare) return { state: 'ok', text: `${label}: ab ${goLive} in der Mehrheit (${pct(g.share)}), wie im Terminplan` };
  for (let d = shiftDay(goLive, 1); d <= lastDay; d = shiftDay(d, 1)) {
    const x = info(d);
    if (x.complete && x.share >= minShare) {
      return { state: 'warn', text: `${label}: erst am ${d} in der Mehrheit (${pct(x.share)}), TFT-Go-live laut Terminplan ${goLive} (dort ${pct(g.share)})` };
    }
  }
  return { state: 'warn', text: `${label}: am TFT-Go-live ${goLive} nur ${pct(g.share)}, bis ${lastDay} keine Mehrheit` };
}

/** Mehrere Patchstarts zu einem Vertragsergebnis. */
export function combineLolPatchShift(parts) {
  const warn = parts.filter((x) => x.state === 'warn');
  if (warn.length) return { status: 'warn', detail: warn.map((x) => x.text).join('; ') };
  const text = parts.map((x) => x.text).join('; ');
  if (parts.some((x) => x.state === 'ok')) return { status: 'ok', detail: text };
  return { status: 'skipped', detail: `keine Daten — ${text}` };
}

async function checkLolPatchShift(c, r) {
  if (!isOnBox()) return r('skipped', 'nur auf der Hetzner-Box pruefbar');
  const meta = readSetMeta();
  const set = readCurrentSet();
  if (!meta || set == null) return r('error', 'public/tft-set.json fehlt oder hat keine Set-Nummer');
  const [{ startsFor, lolPatchFor, addDays }, { currentWindowDay }] = await Promise.all([
    import('./tft-patch-day.mjs'), import('./tft-crawl-window.mjs'),
  ]);

  // Nur abgeschlossene Fenstertage. 10 Tage reichen fuer die Entscheidung
  // (spaetestens Go-live + 3) mit Puffer fuer ausgefallene Laeufe, ohne dass zwei
  // Patchstarts (Abstand 14 Tage) gleichzeitig im Fenster liegen — sonst
  // verdeckte eine offene Warnung die naechste mit demselben Grundmuster.
  const lookback = c.lookbackDays ?? 10;
  const cwd = currentWindowDay(new Date());
  const lastDone = addDays(cwd, -1);
  const earliest = addDays(cwd, -lookback);
  const starts = [...startsFor(meta, set), ...startsFor(meta, set + 1)]
    .filter((s) => s.from_day >= earliest && s.from_day <= lastDone);
  if (!starts.length) return r('ok', `kein TFT-Patchstart zwischen ${earliest} und ${lastDone} — nichts zu vergleichen`);

  const pool = await hetznerPool();
  const parts = [];
  for (const s of starts) {
    const lol = lolPatchFor(s.patch);
    if (!lol) { parts.push({ state: 'unknown', text: `${s.patch}: kein LoL-Gegenstueck bekannt` }); continue; }
    const plus3 = addDays(s.from_day, 3);
    const lastDay = plus3 < lastDone ? plus3 : lastDone;
    const q = await pool.query(LOL_PATCH_SQL, [c.region ?? 'euw1', c.queueId ?? 420, addDays(s.from_day, -1), addDays(lastDay, 1)]);
    parts.push(evaluateLolPatchShift({
      start: s, lol, rows: q.rows, lastDay,
      minMatchesPerDay: c.minMatchesPerDay ?? 300, minShare: c.minShare ?? 0.5,
    }));
  }
  const res = combineLolPatchShift(parts);
  return r(res.status, res.detail);
}

// ---------------------------------------------------------------- Box-Stand

/**
 * Vertrag box-main: laeuft auf der Box der Code von main? Ein Deploy, der
 * scheitert oder nie angestossen wird, faellt sonst erst auf, wenn ein Fix
 * "live" ist und nichts bewirkt.
 *
 * Bot-Commits (pro-teams.json, metatft-Dateien) loesen bewusst keinen Deploy
 * aus (Pfadfilter in deploy-hetzner.yml), die Box steht dann zu Recht hinter
 * main. Gezaehlt werden deshalb nur Dateien in den Deploy-Pfaden; die Liste
 * kommt aus dem Workflow selbst, damit sie nicht auseinanderlaeuft.
 * Nur Warnung; GitHub nicht erreichbar = unbekannt.
 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** `paths:`-Liste des push-Ausloesers aus dem Workflow-Text. */
export function deployPathsFrom(yamlText) {
  const lines = String(yamlText).split(/\r?\n/);
  const at = lines.findIndex((l) => /^\s*paths:\s*$/.test(l));
  if (at < 0) return [];
  const out = [];
  for (const l of lines.slice(at + 1)) {
    if (!l.trim() || l.trim().startsWith('#')) continue;
    const m = /^\s*-\s*(['"]?)(.+?)\1\s*(#.*)?$/.exec(l);
    if (!m) break;
    out.push(m[2]);
  }
  return out;
}

/** GitHub-Semantik: spaeteres `!muster` nimmt wieder heraus. */
export function inDeployPaths(file, patterns) {
  let hit = false;
  for (const p of patterns) {
    if (p.startsWith('!')) { if (globToRegExp(p.slice(1)).test(file)) hit = false; }
    else if (globToRegExp(p).test(file)) hit = true;
  }
  return hit;
}

/**
 * Reine Auswertung (ohne Netz, testbar).
 * compare: Antwort von GET /repos/{repo}/compare/{boxHead}...main
 *          (oder { notFound: true }); dirty: lokale Aenderungen auf der Box.
 */
export function evaluateBoxMain({ compare, dirty = false, deployPaths = [], now = Date.now(), graceHours = 2 }) {
  const warn = (detail) => ({ status: 'warn', detail });
  const ok = (detail) => ({ status: 'ok', detail });
  if (dirty) return warn('Arbeitsbaum der Box hat lokale Aenderungen an versionierten Dateien — Box-Stand weicht von main ab');
  if (compare?.notFound) return warn('Box-Stand ist auf GitHub unbekannt (Commit nur auf der Box?)');
  const ahead = Number(compare?.ahead_by) || 0;
  const behind = Number(compare?.behind_by) || 0;
  if (behind > 0) return warn(`Box hat ${behind} Commit(s), die nicht auf main liegen`);
  if (ahead === 0) return ok('Box-Stand = main');

  const files = compare.files ?? [];
  const commits = compare.commits ?? [];
  // GitHub kuerzt bei 300 Dateien / 250 Commits — dann lieber warnen als raten.
  const truncated = files.length >= 300 || commits.length < ahead;
  const relevant = deployPaths.length
    ? files.filter((f) => inDeployPaths(f.filename, deployPaths)
      || (f.previous_filename && inDeployPaths(f.previous_filename, deployPaths)))
    : files;
  if (!relevant.length && !truncated) {
    return ok(`Box ${ahead} Commit(s) hinter main, keiner davon in den Deploy-Pfaden (wird bewusst nicht ausgerollt)`);
  }
  // Ohne Zuordnung Datei -> Commit zaehlt der juengste Commit: ist er frisch,
  // laeuft der Deploy vermutlich noch. Ein haengender Deploy faellt dann einen
  // Lauf spaeter auf.
  const times = commits.map((x) => Date.parse(x?.commit?.committer?.date ?? x?.commit?.author?.date)).filter(Number.isFinite);
  const ageH = times.length ? (now - Math.max(...times)) / 3_600_000 : null;
  if (ageH != null && ageH < graceHours) {
    return ok(`Box ${ahead} Commit(s) hinter main, juengster erst vor ${Math.round(ageH * 60)} min — Deploy vermutlich unterwegs`);
  }
  const age = ageH == null ? 'unbekannt' : `vor ${Math.round(ageH)} h`;
  return warn(`Box-Stand liegt hinter main: ${ahead} Commit(s), davon ${relevant.length} Datei(en) in den Deploy-Pfaden`
    + `${truncated ? ' (Liste von GitHub gekuerzt)' : ''}, juengster Commit ${age} — Deploy gescheitert oder nicht angestossen`);
}

async function checkBoxMain(c, r) {
  if (!isOnBox()) return r('skipped', 'nur auf der Hetzner-Box pruefbar');
  if (!c.repo) return r('error', 'Vertrag ohne repo');
  const git = (...a) => execFileSync('git', ['-C', REPO_ROOT, '--no-optional-locks', ...a], {
    encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const head = git('rev-parse', 'HEAD');
  const dirty = git('status', '--porcelain', '--untracked-files=no') !== '';

  let compare;
  try {
    const res = await fetch(`https://api.github.com/repos/${c.repo}/compare/${head}...${c.branch ?? 'main'}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'metastats-contracts' },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404) compare = { notFound: true };
    else if (!res.ok) return r('skipped', `GitHub antwortet HTTP ${res.status} — Box-Stand unbekannt`);
    else compare = await res.json();
  } catch (e) {
    return r('skipped', `GitHub nicht erreichbar (${e.name}) — Box-Stand unbekannt`);
  }

  let deployPaths = [];
  try {
    deployPaths = deployPathsFrom(readFileSync(resolve(REPO_ROOT, '.github', 'workflows', 'deploy-hetzner.yml'), 'utf8'));
  } catch { /* leer = jede Datei zaehlt, also eher warnen als schweigen */ }
  const v = evaluateBoxMain({ compare, dirty, deployPaths, now: Date.now(), graceHours: c.graceHours ?? 2 });
  return r(v.status, v.detail);
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
  // Absoluter Pfad = eine Datei ausserhalb des Repos, die nur auf der Box
  // existiert (Marker der Crawler-Treiber). Von der Workstation aus ist sie
  // nicht pruefbar — dort `skipped` statt `broken` melden.
  const isAbsolute = relPath.startsWith('/');
  if (isAbsolute && !isOnBox()) return r('skipped', 'nur auf der Hetzner-Box prüfbar');
  const path = isAbsolute ? relPath : resolve(REPO_ROOT, relPath);
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

  if (c.minEntries || c.minPerWave) {
    const raw = body[c.entriesField];
    const n = Array.isArray(raw) ? raw.length : (raw && typeof raw === 'object' ? Object.keys(raw).length : null);
    if (n == null) return r('broken', `Feld ${c.entriesField} fehlt oder ist kein Container`);
    if (c.minEntries && n < c.minEntries) return r('broken', `nur ${n} Einträge (min ${c.minEntries})`);

    // Wellen-Prüfung: die Gesamtsumme ist ein schlechter Wächter, sobald sich
    // die Matrix-Obergrenze verschiebt (Set-Wechsel, Achsen-Revision) — dann
    // wandert die Schwelle mit und niemand merkt, dass eine ganze Welle fehlt.
    // Pro Welle geprüft bleibt die Aussage stabil: der Schlüssel-Präfix vor dem
    // ersten "/" ist der Wellenname (comps, units, items, traits, comps-detail).
    if (c.minPerWave) {
      const keys = Array.isArray(raw) ? raw : Object.keys(raw);
      const seen = {};
      for (const k of keys) {
        const wave = String(k).split('/')[0];
        seen[wave] = (seen[wave] || 0) + 1;
      }
      const short = Object.entries(c.minPerWave)
        .filter(([wave, min]) => (seen[wave] || 0) < min)
        .map(([wave, min]) => `${wave} ${seen[wave] || 0}/${min}`);
      if (short.length) return r('broken', `Welle(n) unter Soll: ${short.join(', ')} (gesamt ${n})`);
    }
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
 * Guide-Abdeckungs-Vertrag: welcher Anteil der gespielten Comps bekommt auf
 * der Comp-Liste eine MetaTFT-Anleitung?
 *
 * Beide Seiten driften unabhängig: MetaTFT clustert neu, unser Meta verschiebt
 * sich mit dem Patch. Sinkt der Schnitt, ist jeder Job grün und die
 * Anleitungen fehlen trotzdem auf einem wachsenden Teil der Comps. Die
 * `datei-frische` daneben sieht das strukturell nicht.
 *
 * Gemessen wird an der ausgelieferten Companion-Route, nicht an DB +
 * familyMap: die Route liefert je Comp das Ergebnis derselben Zuordnung wie
 * die Seite (`guideId` aus resolveGuideId — Familien-Treffer über alle
 * zusammengelegten Familien, sonst passendes MetaTFT-Brett). Die alte Messung
 * zählte nur exakte familyMap-Treffer, lag 08.10.2026 bei 68,2 % gegen 88,9 %
 * auf der Seite und hat an der 64-%-Grenze Fehlalarm-Mails ausgelöst (#19).
 * Die Bewertung steht in scripts/lib/guide-coverage.mjs, die auch
 * `npm run verify:coverage` nutzt.
 */
async function checkGuideCoverage(c, r) {
  // Set aus der Single Source of Truth, nicht aus dem Vertrag: sonst wäre der
  // Vertrag beim Set-Wechsel genau der Ort, an dem niemand nachzieht.
  const set = readCurrentSet();
  if (set == null) return r('error', 'public/tft-set.json fehlt oder hat keine Set-Nummer');
  if (!c.url) return r('error', 'Vertrag ohne url');

  // Ein frischer Aufbau rechnet die ganze Comp-Liste neu (08.10. 5,5 s, bei
  // zaeher DB deutlich mehr), deshalb 60 s und ein zweiter Versuch nach 30 s.
  let body = null;
  let lastErr = '';
  for (let attempt = 0; attempt < 2 && body == null; attempt++) {
    if (attempt > 0) await new Promise((ok) => setTimeout(ok, 30_000));
    try {
      const res = await fetch(c.url, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) body = await res.json();
      else lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = err.message;
    }
  }
  if (body == null) return r('broken', `Comp-Liste nicht erreichbar (2 Versuche, zuletzt ${lastErr}): ${c.url}`);

  const out = evaluateGuideCoverage(body, {
    set,
    minRatio: c.minRatio,
    warnRatio: c.warnRatio,
    minFamilies: c.minFamilies,
    maxAgeHours: c.maxAgeHours,
  });
  return r(out.status, out.detail);
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
  // `current_date` wäre die Uhr des DB-Servers; überall sonst im Modul ist
  // "heute" JS-UTC (`today()`). Zwei Definitionen im selben Lauf können sich
  // um einen Tag unterscheiden, also wird die eine Definition reingereicht.
  const pool = await hetznerPool();
  const q = await pool.query(
    `select ${c.groupColumn} as grp, max(${c.dateColumn}) as newest
       from ${c.table} where ${c.dateColumn}::date < $1::date
       group by ${c.groupColumn}`,
    [today()],
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
