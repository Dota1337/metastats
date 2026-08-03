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
 * Datei-Vertrag: statische Produktionsdaten im Repo, die eine Seite live
 * ausliefert. Nicht jeder Datenbestand liegt in einer DB — public/pro-teams.json
 * stand vom 21.05. bis 03.08.2026 still, während /teams und /ligen sie weiter
 * anzeigten. Geprüft wird das Feld aus `dateField` (Default `updatedAt`).
 */
function checkFile(c, r) {
  const path = resolve(REPO_ROOT, c.path);
  if (!existsSync(path)) return r('broken', `${c.path} existiert nicht`);

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return r('broken', `${c.path} ist kein gültiges JSON: ${err.message}`);
  }

  const stamp = parsed[c.dateField || 'updatedAt'];
  if (!stamp) return r('broken', `${c.path} hat kein Feld ${c.dateField || 'updatedAt'}`);

  const ageDays = Math.floor((Date.now() - Date.parse(stamp)) / 86_400_000);
  if (Number.isNaN(ageDays)) return r('broken', `${c.path}: ${stamp} ist kein Datum`);

  if (c.minEntries) {
    const n = Array.isArray(parsed[c.entriesField]) ? parsed[c.entriesField].length : null;
    if (n == null) return r('broken', `${c.path}: Feld ${c.entriesField} ist keine Liste`);
    if (n < c.minEntries) return r('broken', `${c.path}: nur ${n} Einträge (min ${c.minEntries})`);
  }

  return ageDays <= c.maxAgeDays
    ? r('ok', `${c.path} ist ${ageDays}d alt (max ${c.maxAgeDays}d)`)
    : r('broken', `${c.path} ist ${ageDays}d alt, erlaubt sind ${c.maxAgeDays}d — Aktualisierung ausgefallen`);
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

/** Spiegel-Vertrag: Ziel muss ~so viele Rows haben wie die Quelle. */
async function checkMirror(c, r) {
  if (!isOnBox()) return r('skipped', 'Mirror-Vergleich braucht beide DBs (nur auf der Box)');

  const srcDay = await pgMaxDate(c.table, c.dateColumn);
  if (!srcDay) return r('broken', `Quelle ${c.table} ist leer`);

  const src = await pgCountOnDay(c.table, c.dateColumn, srcDay);
  const dst = await supaCount(c.table, `&${c.dateColumn}=eq.${srcDay}`);
  const ratio = src === 0 ? 1 : dst / src;

  return ratio >= c.minRatio
    ? r('ok', `${srcDay}: Supabase ${dst} / Hetzner ${src} (${(ratio * 100).toFixed(0)}%)`)
    : r('broken',
        `${srcDay}: Supabase hat nur ${dst} von ${src} Hetzner-Rows ` +
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
