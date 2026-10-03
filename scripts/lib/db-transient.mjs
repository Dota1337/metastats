// Erkennt DB-Fehler, die von selbst vorbeigehen (Verbindungsabbruch, Neustart
// des Postgres, Supabase-Pooler ueberlastet), und wartet sie ab.
//
// Anlass 2026-10-03: metastats-lol-matchfill starb um 05:11 CEST an
// "Failed to connect to database: {:error, :timeout}" und sammelte ~4,5 h
// nichts, weil die Unit bewusst nicht von selbst neu startet.

const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'EHOSTUNREACH',
  '57P01', '57P02', '57P03', // Server faehrt runter / startet gerade
  '53300',                   // zu viele Verbindungen
  '08000', '08001', '08003', '08004', '08006',
]);

const TRANSIENT_MESSAGE = new RegExp([
  'Connection terminated',
  'connection to database not available',
  'Failed to connect to database',
  'timeout exceeded when trying to connect',
  'Connection ended unexpectedly',
  'EAUTHQUERY',
  'the database system is (starting up|shutting down|in recovery mode)',
  'terminating connection due to administrator command',
  'too many clients',
  'Max client connections reached',
].join('|'), 'i');

export function isTransientDbError(err) {
  if (!err) return false;
  if (err.code && TRANSIENT_CODES.has(String(err.code))) return true;
  return TRANSIENT_MESSAGE.test(String(err.message || err));
}

// Ein Wartebudget je Ausfall: `pause()` wartet einmal und meldet false, sobald
// der Ausfall laenger als maxMs dauert. `ok()` nach jedem erfolgreichen
// DB-Zugriff setzt das Budget zurueck.
export function createDbOutageBudget({ maxMs = 15 * 60_000, pauseMs = 60_000, log = console.log, sleep } = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let since = null;
  return {
    ok() { since = null; },
    async pause(err, what) {
      if (since === null) since = Date.now();
      const down = Date.now() - since;
      if (down >= maxMs) {
        log(`DB seit ${Math.round(down / 60_000)} min nicht erreichbar (${what}: ${err.message}) — Lauf endet.`);
        return false;
      }
      log(`DB-Aussetzer bei ${what} (${err.message}) — warte ${Math.round(pauseMs / 1000)} s und versuche es erneut.`);
      await wait(pauseMs);
      return true;
    },
  };
}

// Fuehrt fn aus und wiederholt bei voruebergehenden DB-Fehlern im Rahmen des
// Budgets. Andere Fehler und ein erschoepftes Budget werfen weiter.
export async function withDbRetry(budget, what, fn) {
  for (;;) {
    try {
      const out = await fn();
      budget.ok();
      return out;
    } catch (err) {
      if (!isTransientDbError(err)) throw err;
      if (!(await budget.pause(err, what))) { err.dbOutage = true; throw err; }
    }
  }
}
