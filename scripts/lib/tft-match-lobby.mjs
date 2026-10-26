// Lobby eines Matches fuer die Spieler-Bewertung im Vergleich (/tft/compare,
// Plan 2026-10-26, Tabelle tft_match_lobby aus Migration 0105, nur Box).
//
// refreshPlayerMatchCache (tft-match-cache-pg.mjs) hat das volle Riot-Match nur
// in fetchOne in der Hand. Hier werden daraus die Rohfakten aller 8 Teilnehmer
// gezogen. Bewusst NICHT gespeichert: Raenge (traegt der Nachtlauf nach, nur
// Staende vor dem Spiel), Carry und Familie (bildet das Rechen-Modul beim Lesen,
// fuer Spieler und Gegner mit derselben Funktion).
//
// Die Erfassung darf den Match-Cache nie stoeren:
//   - jeder Fehler wird gefangen, der Cache-Write laeuft weiter;
//   - der Insert hat ein eigenes Zeitlimit (der Marktwert-Lauf endet hart um
//     05:15 UTC und hat keine Reserve);
//   - nach LOBBY_MAX_FAILURES Fehlern in Folge schaltet sie sich fuer den Rest
//     des Prozesses ab (eine Logzeile).
// Schalter: LOBBY_CAPTURE=1 in der Box-Env (Standard aus). Steht auch in der
// Positivliste der refresh-api (ENV_KEYS + metastats-refresh-api-env.sh).

import { loadCurrentSet } from './current-set.mjs';

export const LOBBY_STATEMENT_TIMEOUT_MS = 3000;
export const LOBBY_MAX_FAILURES = 5;
const INSERT_BATCH = 100;
const SUMMARY_EVERY_MS = 10 * 60_000;

const state = { failuresInRow: 0, disabled: null, saved: 0, ms: 0, errors: 0, lastSummary: Date.now() };

export function lobbyCaptureEnabled() {
  return process.env.LOBBY_CAPTURE === '1' && !state.disabled;
}

// Set, fuer das erfasst wird. Lobbys alter Sets (Kaltstart ueber 1000 IDs)
// bekaemen nie Raenge und wuerden nur Platz kosten.
export function lobbySet() {
  return loadCurrentSet();
}

/**
 * Kompakte Rohfakten aller Teilnehmer. Schluessel:
 *   p puuid · pl Platz · lv Level · lr letzte Runde · g Restgold (null = fehlt)
 *   u [[characterId, Sterne, [Items]]] · t [[Trait, Stufe, Units, style]] (nur aktive)
 * @returns {null | { match_id: string, region: string, set_number: number, game_datetime: number,
 *                    game_version: string | null, participants: object[] }}
 */
export function buildLobbyRow(raw, region, setNumber) {
  const info = raw?.info;
  const matchId = raw?.metadata?.match_id;
  const parts = Array.isArray(info?.participants) ? info.participants : null;
  if (!matchId || !parts || parts.length !== 8 || !Number.isInteger(setNumber)) return null;
  const set = info.tft_set_number ?? info.tftSetNumber;
  if (Number(set) !== setNumber) return null;
  const participants = parts
    .map((p) => ({
      p: String(p.puuid || ''),
      pl: Number(p.placement) || 0,
      lv: Number(p.level) || 0,
      lr: Number(p.last_round) || 0,
      g: typeof p.gold_left === 'number' ? p.gold_left : null,
      u: (p.units || []).map((u) => [
        String(u.character_id || ''),
        Number(u.tier) || 1,
        Array.isArray(u.itemNames) ? u.itemNames.map(String) : [],
      ]),
      t: (p.traits || [])
        .filter((t) => (t.style ?? 0) > 0)
        .map((t) => [String(t.name || ''), t.tier_current ?? 0, t.num_units ?? 0, t.style ?? 0]),
    }))
    .sort((a, b) => a.pl - b.pl);
  if (participants.some((p) => !p.p || p.pl < 1 || p.pl > 8)) return null;
  return {
    match_id: matchId,
    region,
    set_number: setNumber,
    game_datetime: Number(info.game_datetime ?? info.gameDatetime) || 0,
    game_version: typeof info.game_version === 'string' ? info.game_version : null,
    participants,
  };
}

// Mehrere Spieler einer Kohorte koennen im selben Match sitzen: nach match_id
// entdoppeln (ein Insert mit doppelter ID bricht ab) und sortieren (feste
// Sperr-Reihenfolge zwischen gleichzeitigen Prozessen).
export function dedupeLobbies(rows) {
  const byId = new Map();
  for (const r of rows) if (r) byId.set(r.match_id, r);
  return [...byId.values()].sort((a, b) => (a.match_id < b.match_id ? -1 : a.match_id > b.match_id ? 1 : 0));
}

async function withClient(db, fn) {
  // Pool: eigene Verbindung fuer die Transaktion. Client: direkt.
  if (typeof db.connect === 'function' && typeof db.release !== 'function' && 'totalCount' in db) {
    const client = await db.connect();
    try { return await fn(client); } finally { client.release(); }
  }
  return fn(db);
}

export async function insertLobbies(db, rows) {
  const list = dedupeLobbies(rows);
  if (!list.length) return 0;
  return withClient(db, async (client) => {
    await client.query('begin');
    try {
      await client.query(`set local statement_timeout = ${LOBBY_STATEMENT_TIMEOUT_MS}`);
      for (let i = 0; i < list.length; i += INSERT_BATCH) {
        const batch = list.slice(i, i + INSERT_BATCH);
        const values = [];
        const params = [];
        let n = 1;
        for (const r of batch) {
          values.push(`($${n++}, $${n++}, $${n++}, $${n++}, $${n++}, $${n++}::jsonb)`);
          params.push(r.match_id, r.region, r.set_number, r.game_datetime, r.game_version, JSON.stringify(r.participants));
        }
        await client.query(
          `insert into tft_match_lobby (match_id, region, set_number, game_datetime, game_version, participants)
           values ${values.join(',')}
           on conflict (match_id) do nothing`,
          params,
        );
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    }
    return list.length;
  });
}

function summary(force = false) {
  const now = Date.now();
  if (!force && now - state.lastSummary < SUMMARY_EVERY_MS) return;
  state.lastSummary = now;
  console.log(`[lobby] ${state.saved} Lobbys gesichert, ${state.ms} ms, ${state.errors} Fehler${state.disabled ? ` — abgeschaltet (${state.disabled})` : ''}`);
}

/** Wirft nie. Gibt die Zahl der gesendeten Lobbys zurueck (0 bei Fehler/aus). */
export async function saveLobbies(db, rows, log = () => {}) {
  if (!rows.length || state.disabled) return 0;
  const t0 = Date.now();
  try {
    const n = await insertLobbies(db, rows);
    state.failuresInRow = 0;
    state.saved += n;
    state.ms += Date.now() - t0;
    summary();
    return n;
  } catch (e) {
    noteLobbyFailure(e, log);
    return 0;
  }
}

export function noteLobbyFailure(err, log = () => {}) {
  state.errors++;
  state.failuresInRow++;
  // Der erste Fehler einer Serie immer ins Journal — die Treiber reichen oft
  // kein log durch, und still darf die Erfassung nicht ausfallen.
  if (state.failuresInRow === 1) console.log(`[lobby] Fehler: ${err?.message || err}`);
  else log(`[lobby] Fehler: ${err?.message || err}`);
  if (state.failuresInRow >= LOBBY_MAX_FAILURES && !state.disabled) {
    state.disabled = `${LOBBY_MAX_FAILURES} Fehler in Folge, zuletzt: ${err?.message || err}`;
    summary(true);
  }
}

// Nur fuer Tests.
export function _resetLobbyState() {
  Object.assign(state, { failuresInRow: 0, disabled: null, saved: 0, ms: 0, errors: 0, lastSummary: Date.now() });
}
