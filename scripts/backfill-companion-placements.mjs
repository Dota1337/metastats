#!/usr/bin/env node
/**
 * Ersetzt in tft_position_observations die Behelfs-ID der Overwolf-App
 * (`LIVE_<startMs>_<name>`) durch die echte Riot-Match-ID und traegt die
 * Platzierung nach. Erst danach kann scripts/aggregate-position-observations.mjs
 * die Beobachtungen einer Comp zuordnen.
 *
 * Je Behelfs-ID:
 *   1. Beobachter (`Name#TAG`) → Konto-ID ueber account-v1.
 *   2. Riot-Spiele dieses Kontos im Zeitfenster um den Startzeitpunkt
 *      (startTime/endTime statt "die letzten 30" — sonst rutschen aeltere
 *      Spiele nach ein paar Tagen aus der Liste und bleiben fuer immer offen).
 *   3. Spiel, in dessen Laufzeit der Startzeitpunkt faellt (pickMatch in
 *      lib/companion-match-pick.mjs) → match_id + Platzierung setzen.
 *   4. Nichts gefunden und Startzeit aelter als GIVE_UP_MS → als "nicht
 *      aufloesbar" in der Statusdatei vermerken, damit es nicht jeden Lauf
 *      wieder Riot-Abfragen kostet.
 *
 * Statusdatei liegt im StateDirectory der Unit. Laeuft per Timer alle 10 Min.
 *
 * Datenschutz (seit 10.10.2026): Behelfs-Zeilen tragen den Riot-Namen, bis sie
 * aufgeloest sind. Was 48 h nach dem Hochladen (observed_at, Serverzeit — die
 * Zeit in der ID kommt von der Uhr des Spieler-PCs) noch offen ist, wird
 * geloescht. Die Statusdatei fuehrt keine Riot-Namen mehr, die Logs auch nicht.
 * Den Namen der aufgeloesten Zeilen ersetzt der Aggregator.
 *
 *   node scripts/backfill-companion-placements.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { getRegionalRouting, getAccountRouting, isValidRegion } from './lib/regional-routing.mjs';
import { createRiotClient } from './lib/riot-client.mjs';
import { riotWindowFor } from './lib/riot-limits.mjs';
import { isRiotHandle, regionFromMatchId, PRIVACY_DEADLINE_MS } from './lib/companion-positions.mjs';
import { pickMatch, shouldRetryUnresolvable, MATCH_ALGO_VERSION } from './lib/companion-match-pick.mjs';

function loadEnv() {
  const candidates = ['/etc/metastats-crawler/env', resolve(process.cwd(), '.env.local')];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
    }
    break;
  }
}
loadEnv();

const DRY_RUN = process.argv.includes('--dry-run');
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Strikt der TFT-Key, KEIN Fallback auf RIOT_API_KEY (geaendert 2026-09-02).
// Der LoL-Dev-Key ist auf TFT-Endpunkten naemlich gueltig — gemessen:
// GET euw1/tft/league/v1/challenger mit dem LoL-Key => HTTP 200. Der Fallback
// hat also nicht gebrochen, sondern still degradiert: X-App-Rate-Limit
// 100:120,20:1 statt 500:10,30000:600, und das aus dem Kontingent, das die
// LoL-Crawler brauchen — alle 10 Minuten, ohne jedes Signal. Dieselbe
// Begruendung wie in scripts/lib/riot-client.mjs:72-76. Waechter dagegen:
// scripts/check-drift.mjs, Block "Riot-Key-Vermischung".
const RIOT_KEY = process.env.RIOT_API_KEY_TFT;
if (!SUPA_URL || !SUPA_KEY || !RIOT_KEY) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RIOT_API_KEY_TFT');
  process.exit(1);
}

// Riots game_datetime ist das Spielende, die Behelfs-ID traegt den Moment, in
// dem die App das Spiel zuerst gesehen hat — bei Einstieg mitten im Spiel weit
// nach dem Start. Treffer ist deshalb jedes Spiel, in dessen Laufzeit (Start
// minus 15 Min bis Ende) dieser Moment faellt; bei mehreren gewinnt der naechste
// Start. Regel und Messung: scripts/lib/companion-match-pick.mjs.
// Riot listet ein Spiel erst nach seinem Ende; bis dahin ist "nicht gefunden"
// kein Endzustand.
const GIVE_UP_MS = 24 * 60 * 60 * 1000;
const PAGE = 1000;
const STATE_DIR = process.env.STATE_DIRECTORY || join(tmpdir(), 'metastats-companion');
const STATE_FILE = join(STATE_DIR, 'backfill-state.json');

// Dieser Job lief bis 2026-08-04 komplett ungedrosselt: kein Limiter, alle
// 10 Minuten per Timer, und er ruft mit `/tft/match/v1/matches/{id}` genau den
// method-limitierten Endpoint auf, um den sich alle anderen Prozesse streiten.
// Er steht ausserdem in keinem `Conflicts=`, kann also jederzeit mitten in
// einen Batch-Lauf hineinfunken. Sein Budget ist in riot-limits.mjs reserviert
// — bisher war die Reservierung eine Annahme, jetzt wird sie durchgesetzt.
const riot = createRiotClient({ ...riotWindowFor('companion-backfill'), apiKey: RIOT_KEY });

const sb = (path, init = {}) => fetch(`${SUPA_URL}${path}`, {
  ...init,
  headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, ...(init.headers || {}) },
});

async function riotFetch(url, label) {
  const res = await riot.fetch(url);
  if (!res.ok) {
    // Riots 404 auf account-v1 wiederholt den gesuchten Namen — der gehoert nicht ins Log.
    const body = label.startsWith('account') ? '' : `: ${(await res.text()).slice(0, 100)}`;
    throw new Error(`riot ${label} ${res.status}${body}`);
  }
  return res.json();
}

// Nur `unresolvable` wird gespeichert. Bis 0.8.2 stand hier auch
// `clusterByHandle` (Riot-Name → Weltregion); das faellt beim Laden weg.
function loadState() {
  try { return { unresolvable: JSON.parse(readFileSync(STATE_FILE, 'utf8')).unresolvable || {} }; } catch { return { unresolvable: {} }; }
}
function saveState(state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify({ unresolvable: state.unresolvable }));
  renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
}

// Weltregion des letzten Treffers je Beobachter, nur fuer diesen Lauf.
const clusterByHandle = new Map();

// Behelfs-IDs der App bis 0.8.2 enden mit den ersten 8 Zeichen des Namens.
const maskLive = (liveId) => liveId.replace(/^(LIVE_\d+_).*$/, '$1…');

const puuidCache = new Map();
async function resolvePuuid(handle, region) {
  if (puuidCache.has(handle)) return puuidCache.get(handle);
  const [gameName, tagLine] = handle.split('#');
  // Konten sind global — ohne Region reicht europe.
  const accountCluster = region ? getAccountRouting(region) : 'europe';
  const account = await riotFetch(
    `https://${accountCluster}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    'account-v1',
  );
  puuidCache.set(handle, account.puuid);
  return account.puuid;
}

const detailCache = new Map();
async function getMatchDetail(matchId, cluster) {
  if (!detailCache.has(matchId)) {
    detailCache.set(matchId, await riotFetch(
      `https://${cluster}.api.riotgames.com/tft/match/v1/matches/${matchId}`, `match-detail ${matchId}`));
  }
  return detailCache.get(matchId);
}

//   LIVE_<seedMs>_<handlePrefix>
function liveIdToTimestampMs(liveId) {
  const m = /^LIVE_(\d+)_/.exec(liveId);
  return m ? Number(m[1]) : null;
}

/** Alle offenen Behelfs-IDs, seitenweise (PostgREST liefert max. 1000 je Abruf). */
async function getPending() {
  const byId = new Map();
  for (let offset = 0; ; offset += PAGE) {
    const res = await sb(`/rest/v1/tft_position_observations?select=match_id,observer_puuid,region` +
      `&match_id=like.LIVE_*&order=id.asc&offset=${offset}&limit=${PAGE}`);
    if (!res.ok) throw new Error(`Supabase GET: HTTP ${res.status}`);
    const rows = await res.json();
    // Seit App 0.3.0 (Spiel 28164) kommt die Region oft leer — Overwolf
    // liefert dort keine Server-Angabe. Solche Zeilen bleiben drin, die
    // Weltregion wird unten durchprobiert.
    for (const r of rows) {
      if (!r.observer_puuid) continue;
      const k = `${r.match_id}|${r.observer_puuid}`;
      if (!byId.has(k)) byId.set(k, { liveId: r.match_id, handle: r.observer_puuid, region: r.region });
    }
    if (rows.length < PAGE) break;
  }
  return [...byId.values()];
}

const CLUSTERS = ['europe', 'americas', 'asia', 'sea'];

/** Behelfs-Zeilen, die 48 h nach dem Hochladen noch offen sind, loeschen. Gibt die Anzahl zurueck. */
async function deleteExpired() {
  const cutoff = new Date(Date.now() - PRIVACY_DEADLINE_MS).toISOString();
  const filter = `match_id=like.LIVE_*&observed_at=lt.${encodeURIComponent(cutoff)}`;
  if (DRY_RUN) {
    const res = await sb(`/rest/v1/tft_position_observations?select=id&${filter}`);
    if (!res.ok) throw new Error(`Supabase GET abgelaufen: HTTP ${res.status}`);
    return (await res.json()).length;
  }
  const res = await sb(`/rest/v1/tft_position_observations?select=id&${filter}`, {
    method: 'DELETE', headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) throw new Error(`Supabase DELETE abgelaufen: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  return (await res.json()).length;
}

async function resolveOne({ liveId, handle, region }, state) {
  const seed = liveIdToTimestampMs(liveId);
  if (seed == null) return { unresolvable: 'no_timestamp' };
  if (region && !isValidRegion(region)) return { unresolvable: `region:${region}` };
  if (!isRiotHandle(handle)) return { unresolvable: 'observer_not_handle' };
  const puuid = await resolvePuuid(handle, region);

  // Bekannte Region zuerst, dann die beim letzten Treffer gemerkte Weltregion,
  // dann die uebrigen. Der Tag (#EUW) ist frei waehlbar, also nur ein Hinweis.
  const hinted = [region && getRegionalRouting(region), clusterByHandle.get(handle)].filter(Boolean);
  const order = [...new Set([...hinted, ...CLUSTERS])];

  const startTime = Math.floor((seed - 30 * 60 * 1000) / 1000);
  const endTime = Math.floor((seed + 90 * 60 * 1000) / 1000);
  let seen = 0;
  for (const cluster of order) {
    const ids = await riotFetch(
      `https://${cluster}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuid}/ids?start=0&count=20&startTime=${startTime}&endTime=${endTime}`,
      `match-ids ${cluster}`,
    );
    seen += ids.length;
    const details = [];
    for (const id of ids) details.push(await getMatchDetail(id, cluster));
    const best = pickMatch(seed, details, puuid);
    if (!best) continue;
    clusterByHandle.set(handle, cluster);
    const riotId = best.md.metadata.match_id;
    const p = best.md.info.participants.find(x => x.puuid === puuid);
    return { riotId, placement: p ? p.placement : null, delta: best.delta, region: region || regionFromMatchId(riotId) };
  }
  return Date.now() - seed > GIVE_UP_MS ? { unresolvable: `no_match_in_window(${seen})` } : { pending: true };
}

async function main() {
  const state = loadState();
  const expired = await deleteExpired();
  if (expired) console.log(`${expired} Behelfs-Zeilen aelter als 48 h ${DRY_RUN ? 'wuerden geloescht' : 'geloescht'}`);
  const all = await getPending();
  // Status nur fuer IDs, die es noch gibt — geloeschte nehmen ihren Eintrag mit.
  const live = new Set(all.map(p => p.liveId));
  for (const id of Object.keys(state.unresolvable)) if (!live.has(id)) delete state.unresolvable[id];
  // Aufgegebene IDs bleiben draussen — ausser `no_match_*` einer aelteren
  // Zuordnungsregel, die bekommen genau einen neuen Versuch (Eintrag traegt `v`).
  const pending = all.filter(p => shouldRetryUnresolvable(state.unresolvable[p.liveId]));
  if (pending.length === 0) {
    if (!DRY_RUN) saveState(state);
    console.log('keine offenen LIVE_-IDs — fertig.');
    return;
  }
  console.log(`${pending.length} offene LIVE_-IDs`);
  let done = 0, failed = 0;
  for (const p of pending) {
    const shown = maskLive(p.liveId);
    let r;
    try {
      r = await resolveOne(p, state);
    } catch (e) {
      failed++;
      console.warn(`  ${shown}: ${e.message}`);
      continue;
    }
    if (r.pending) { console.log(`  ${shown}: noch kein Riot-Spiel, naechster Lauf`); continue; }
    if (r.unresolvable) {
      console.log(`  ${shown}: nicht aufloesbar (${r.unresolvable})`);
      if (!DRY_RUN) state.unresolvable[p.liveId] = { reason: r.unresolvable, v: MATCH_ALGO_VERSION, at: new Date().toISOString() };
      continue;
    }
    // Doppelter Upload desselben Spiels (gemessen 2026-10-02: 2 von 8 offenen
    // IDs, Startzeit < 1 Min neben einem schon aufgeloesten Spiel desselben
    // Beobachters). Umschreiben wuerde doppelt zaehlen bzw. am Unique-Index
    // scheitern — die Behelfs-Zeilen bleiben liegen, der Aggregator ignoriert sie.
    const dup = await sb(`/rest/v1/tft_position_observations?select=id&match_id=eq.${encodeURIComponent(r.riotId)}` +
      `&observer_puuid=eq.${encodeURIComponent(p.handle)}&limit=1`);
    if (!dup.ok) { failed++; console.warn(`    Doppel-Pruefung fehlgeschlagen: ${dup.status}`); continue; }
    if ((await dup.json()).length > 0) {
      console.log(`  ${shown}: doppelt hochgeladen, ${r.riotId} ist schon da`);
      if (!DRY_RUN) state.unresolvable[p.liveId] = { reason: `duplicate_of:${r.riotId}`, v: MATCH_ALGO_VERSION, at: new Date().toISOString() };
      continue;
    }
    console.log(`  ${shown} → ${r.riotId} (Platz ${r.placement}, ${Math.round(r.delta / 1000)} s Abstand)`);
    if (DRY_RUN) continue;
    const upd = await sb(
      `/rest/v1/tft_position_observations?match_id=eq.${encodeURIComponent(p.liveId)}&observer_puuid=eq.${encodeURIComponent(p.handle)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ match_id: r.riotId, observer_placement: r.placement, ...(r.region ? { region: r.region } : {}) }),
      },
    );
    if (!upd.ok) { failed++; console.warn(`    Update fehlgeschlagen: ${upd.status} ${(await upd.text()).slice(0, 120)}`); continue; }
    done++;
  }
  if (!DRY_RUN) saveState(state);
  console.log(`aufgeloest ${done}, Fehler ${failed}${DRY_RUN ? ' (Probelauf, nichts geschrieben)' : ''}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
