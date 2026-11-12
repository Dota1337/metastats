// Passwoerter mit Sonderzeichen brechen den URL-Parser von pg — das Passwort
// wird deshalb einmal sauber kodiert (bereits kodierte bleiben gleich).
export function encodePasswordInPgUrl(url) {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd < 0) return url;
  const after = url.slice(schemeEnd + 3);
  const atIdx = after.lastIndexOf('@');
  if (atIdx < 0) return url;
  const userinfo = after.slice(0, atIdx);
  const colon = userinfo.indexOf(':');
  if (colon < 0) return url;
  const user = userinfo.slice(0, colon);
  const pass = userinfo.slice(colon + 1);
  let decoded = pass;
  try { decoded = decodeURIComponent(pass); } catch { /* roh lassen */ }
  return `${url.slice(0, schemeEnd + 3)}${user}:${encodeURIComponent(decoded)}@${after.slice(atIdx + 1)}`;
}

/** Host ohne Port, klein geschrieben; null, wenn die URL keinen hat. */
export function pgUrlHost(url) {
  const s = String(url ?? '');
  const schemeEnd = s.indexOf('://');
  if (schemeEnd < 0) return null;
  const after = s.slice(schemeEnd + 3);
  // Das Passwort darf '/', '?' oder '@' enthalten — deshalb ab dem LETZTEN '@'
  // lesen, genau wie encodePasswordInPgUrl.
  const authority = after.slice(after.lastIndexOf('@') + 1).split(/[/?#]/)[0];
  const host = authority.startsWith('[')
    ? authority.slice(0, authority.indexOf(']') + 1)
    : authority.replace(/:\d*$/, '');
  return host ? host.toLowerCase() : null;
}

const SUPABASE_HOST_RE = /(^|\.)supabase\.(co|com)$/;

/**
 * Zeitgrenze je Abfrage, die auch ueber den Supabase-Pooler ankommt.
 *
 * Warum nicht die pg-Option `statement_timeout`: pg schickt sie als
 * Startparameter (node_modules/pg/lib/client.js), und Supavisor verwirft ihn.
 * Gemessen 12.11.2026 ueber den Pooler (Port 5432) mit Option 600000:
 * `current_setting('statement_timeout')` = 2min, der Server-Standard. Folge:
 * freeze-marketvalue-peaks scheiterte jedes ~3. Mal nach 2 min, lol-builds
 * bei langsamer Datenbank. Direkt an der Box-PG wirkt die Option, ein `SET`
 * nach dem Verbinden wirkt ueberall — deshalb dieser Weg fuer beide.
 *
 * `pgStatementTimeout(ms)` liefert die Pool-Option `onConnect` (pg-pool wartet
 * sie ab, bevor der Client herausgegeben wird; scheitert sie, bekommt der
 * Aufrufer den Fehler statt still 2 min). Fuer einen einzelnen pg.Client:
 * nach `connect()` `await applyStatementTimeout(client, ms)`.
 */
export function statementTimeoutValue(ms) {
  if (!Number.isInteger(ms) || ms <= 0) {
    throw new Error(`statement_timeout braucht eine positive ganze Zahl in ms, nicht ${ms}`);
  }
  return String(ms);
}

export async function applyStatementTimeout(client, ms) {
  const value = statementTimeoutValue(ms);
  await client.query("select set_config('statement_timeout', $1, false)", [value]);
}

export function pgStatementTimeout(ms) {
  statementTimeoutValue(ms); // ungueltige Werte schon beim Bau des Pools melden
  return { onConnect: (client) => applyStatementTimeout(client, ms) };
}

/**
 * Verbindung zur Supabase-Datenbank, in der die Tagesstatistik (tft_daily_*)
 * liegt. Auf der Box zeigt DATABASE_URL auf die Hetzner-PG (127.0.0.1), nur
 * SUPABASE_DB_URL auf Supabase — ein blindes `SUPABASE_DB_URL || DATABASE_URL`
 * landete dort ohne SUPABASE_DB_URL still in der falschen Datenbank. Deshalb:
 * SUPABASE_DB_URL zuerst; DATABASE_URL nur, wenn ihr Host erkennbar Supabase
 * ist; sonst ein Fehler mit dem Host (nie mit dem Passwort).
 */
export function supabasePgUrl(env = process.env) {
  const own = String(env.SUPABASE_DB_URL ?? '').trim();
  if (own) {
    if (!pgUrlHost(own)) throw new Error('SUPABASE_DB_URL ist keine Postgres-URL mit Host');
    return encodePasswordInPgUrl(own);
  }
  const generic = String(env.DATABASE_URL ?? '').trim();
  if (!generic) throw new Error('weder SUPABASE_DB_URL noch DATABASE_URL gesetzt');
  const host = pgUrlHost(generic);
  if (!host || !SUPABASE_HOST_RE.test(host)) {
    throw new Error(`DATABASE_URL zeigt nicht auf Supabase (Host ${host ?? 'fehlt'}) — SUPABASE_DB_URL setzen`);
  }
  return encodePasswordInPgUrl(generic);
}
