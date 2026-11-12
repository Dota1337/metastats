#!/usr/bin/env node
/**
 * Befristete Messung (13.–15.11.2026): Wer bremst Supabase morgens aus?
 *
 * Anlass: Am 10. und 11.11.2026 stand die Supabase-Instanz ~05:10–06:45 UTC
 * fast still (79/122 Abbrueche quer durch alle Tabellen, triviale
 * Index-Lookups 20–45 s), am 12.11. nicht. Die Protokolle der Management-API
 * zeigen nur Opfer, keinen Verursacher, und Verlaufswerte fuer CPU/IO gibt es
 * per API nicht. Plan: .claude/plan-current.md Punkt 3.
 *
 * Je Aufruf EINE Journal-Zeile `[probe] {...}`:
 *   m:   Zaehler aus /customer/v1/privileged/metrics (roh; Differenzen erst in
 *        der Auswertung) — Last, CPU-Sekunden je Modus, Platten-Zeit/-Bytes,
 *        freier Speicher, wartende Pool-Clients
 *   act: aktive Abfragen > 5 s (und alle Autovacuum-Worker) aus
 *        pg_stat_activity: Dauer, Warte-Ereignis, Nutzer, Anfang der Abfrage
 *   n:   Anzahl Sitzungen je Zustand
 *
 * Rein lesend: eigene Verbindung mit default_transaction_read_only + 5-s-Grenze.
 * Direkt zur Datenbank (db.<ref>.supabase.co), nicht ueber den Pooler — klemmt
 * morgens der Pooler, waere die Messung sonst genau dann blind; nur wenn der
 * direkte Weg scheitert, einmal ueber SUPABASE_DB_URL.
 * Fehler (Zeitueberschreitung, 504, "too many clients") sind selbst der Befund
 * und landen als eigene Felder in der Zeile. Keine Wiederholungen.
 *
 * `pg` wird erst NACH dem Metrik-Abruf dynamisch geladen: am 13.11. ~05:16
 * laeuft auf der Box ein npm ci (node_modules kurz weg) — dann fehlt nur der
 * Datenbank-Teil, nicht die ganze Minute.
 *
 * Start auf der Box (transient, baut sich nach dem 15.11. selbst ab):
 *   systemd-run --unit=probe-supabase-morning \
 *     --on-calendar='2026-11-13..15 04..07:*:00 UTC' \
 *     --timer-property=AccuracySec=1s --timer-property=RemainAfterElapse=no \
 *     -p Type=oneshot -p TimeoutStartSec=45s -p MemoryMax=150M \
 *     -p EnvironmentFile=/etc/metastats-crawler/env \
 *     -p WorkingDirectory=/opt/metastats-crawler -p Nice=10 \
 *     -p NoNewPrivileges=yes -p ProtectSystem=strict -p ProtectHome=yes -p PrivateTmp=yes \
 *     /usr/bin/node scripts/oneoff/supabase-morning-probe.mjs
 * Auswertung: journalctl -u probe-supabase-morning -o cat | grep '^\[probe\]'
 * neben journalctl -u metastats-health (der Waechter startet Supabase selbst neu).
 *
 * Nach der Auswertung loeschen.
 */

const HARD_EXIT_MS = 40_000;
setTimeout(() => {
  console.log(`[probe] ${JSON.stringify({ t: new Date().toISOString(), err: 'Notbremse nach 40 s' })}`);
  process.exit(3);
}, HARD_EXIT_MS).unref();

const out = { t: new Date().toISOString() };
const secrets = [];
const mask = (s) => {
  let r = String(s ?? '');
  for (const x of secrets) if (x) r = r.split(x).join('***');
  return r;
};

// Verbindungsdaten per Regex, nie per new URL() (Passwort mit Sonderzeichen
// landete sonst in der Fehlermeldung, Vorfall 03.11.2026).
function parsePg(u) {
  const m = String(u ?? '').match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^:@/]+):(\d+)\/([^?]+)/);
  if (!m) return null;
  let pw = m[2];
  try { pw = decodeURIComponent(pw); } catch { /* roh lassen */ }
  return { user: m[1], password: pw, host: m[3], port: Number(m[4]), database: m[5] };
}

const WANT = [
  ['load1', /^node_load1\b/],
  ['cpu', /^node_cpu_seconds_total\{/],
  ['ioTime', /^node_disk_io_time_seconds_total\{/],
  ['ioWeighted', /^node_disk_io_time_weighted_seconds_total\{/],
  ['readB', /^node_disk_read_bytes_total\{/],
  ['writeB', /^node_disk_written_bytes_total\{/],
  ['memAvail', /^node_memory_MemAvailable_bytes\b/],
  ['poolWaiting', /^pgbouncer_pools_client_waiting_connections\b/],
  ['poolActive', /^pgbouncer_pools_client_active_connections\b/],
  ['supavisorActive', /^supavisor_connections_active\b/],
];

function parseMetrics(text) {
  const m = {};
  const cpu = {};
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const val = Number(line.slice(line.lastIndexOf(' ') + 1));
    if (!Number.isFinite(val)) continue;
    for (const [key, re] of WANT) {
      if (!re.test(line)) continue;
      if (key === 'cpu') {
        const mode = (line.match(/mode="([^"]+)"/) || [])[1];
        if (mode) cpu[mode] = Math.round(((cpu[mode] || 0) + val) * 10) / 10;
      } else {
        m[key] = Math.round(((m[key] || 0) + val) * 1000) / 1000;
      }
    }
  }
  m.cpu = cpu;
  return m;
}

async function metrics() {
  const base = String(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return { err: 'NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlt' };
  secrets.push(key);
  const t0 = Date.now();
  try {
    const r = await fetch(`${base}/customer/v1/privileged/metrics`, {
      headers: { Authorization: `Basic ${Buffer.from(`service_role:${key}`).toString('base64')}` },
      signal: AbortSignal.timeout(20_000),
    });
    const ms = Date.now() - t0;
    if (!r.ok) return { err: `HTTP ${r.status}`, ms };
    return { ...parseMetrics(await r.text()), ms };
  } catch (e) {
    return { err: mask(e?.name === 'TimeoutError' ? 'Zeitueberschreitung 20 s' : e?.message), ms: Date.now() - t0 };
  }
}

const ACTIVITY_SQL = `
  select s.pid, s.usename as u, s.application_name as app, s.backend_type as bt, s.state as st,
         s.wait_event_type as wt, s.wait_event as we,
         extract(epoch from now() - s.query_start)::int as dur,
         extract(epoch from now() - s.xact_start)::int as xact,
         left(regexp_replace(s.query, '\\s+', ' ', 'g'), 120) as q
    from pg_stat_activity s
   where s.pid <> pg_backend_pid()
     and (s.backend_type = 'autovacuum worker'
          or (s.state <> 'idle' and s.query_start < now() - interval '5 seconds'))
   order by s.query_start nulls last
   limit 15`;
const COUNT_SQL = `
  select coalesce(state, backend_type) as k, count(*)::int as n
    from pg_stat_activity where pid <> pg_backend_pid()
   group by 1 order by 2 desc`;

async function activity() {
  let pg;
  try {
    pg = (await import('pg')).default;
  } catch (e) {
    return { err: `pg nicht ladbar (npm ci?): ${mask(e?.code || e?.message)}` };
  }
  const pooled = parsePg(process.env.SUPABASE_DB_URL);
  if (!pooled) return { err: 'SUPABASE_DB_URL nicht lesbar' };
  secrets.push(pooled.password, encodeURIComponent(pooled.password));
  const ref = (pooled.user.match(/^postgres\.([a-z0-9]+)$/) || [])[1];
  const routes = [];
  if (ref) routes.push({ via: 'direkt', ...pooled, user: 'postgres', host: `db.${ref}.supabase.co`, port: 5432 });
  routes.push({ via: 'pooler', ...pooled });
  const errors = [];
  for (const r of routes) {
    const client = new pg.Client({
      user: r.user, password: r.password, host: r.host, port: r.port, database: r.database,
      ssl: { rejectUnauthorized: false },
      application_name: 'probe-supabase-morning',
      connectionTimeoutMillis: 5_000,
      query_timeout: 7_000,
    });
    client.on('error', () => {});
    const t0 = Date.now();
    try {
      await client.connect();
      const connMs = Date.now() - t0;
      await client.query("select set_config('statement_timeout', '5000', false), set_config('default_transaction_read_only', 'on', false)");
      const act = await client.query(ACTIVITY_SQL);
      const cnt = await client.query(COUNT_SQL);
      return {
        via: r.via, connMs, qMs: Date.now() - t0 - connMs,
        n: Object.fromEntries(cnt.rows.map((x) => [x.k, x.n])),
        act: act.rows.map((x) => ({
          pid: x.pid, u: x.u, app: x.app || undefined, bt: x.bt === 'client backend' ? undefined : x.bt,
          st: x.st, w: x.wt ? `${x.wt}:${x.we}` : undefined, dur: x.dur, xact: x.xact, q: mask(x.q),
        })),
        ...(errors.length ? { errs: errors } : {}),
      };
    } catch (e) {
      errors.push(`${r.via}: ${mask(e?.message).slice(0, 160)} (${Date.now() - t0} ms)`);
    } finally {
      await client.end().catch(() => {});
    }
  }
  return { err: errors.join(' | ') };
}

try {
  out.m = await metrics();
  const a = await activity();
  Object.assign(out, a.err ? { dbErr: a.err } : a);
} catch (e) {
  out.err = mask(e?.message);
}
console.log(`[probe] ${mask(JSON.stringify(out))}`);
process.exit(0);
