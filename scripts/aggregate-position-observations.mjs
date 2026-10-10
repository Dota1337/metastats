#!/usr/bin/env node
/**
 * Baut tft_position_comp_cell (Aufstellungs-Karte auf /tft/comps/[slug])
 * aus den Rohbeobachtungen der Overwolf-App neu auf — und entfernt dabei die
 * Riot-Namen aus den Rohbeobachtungen.
 *
 * Bei JEDEM Lauf komplett neu statt aufaddieren (Begruendung in
 * scripts/lib/companion-positions.mjs). Ablauf:
 *   1. Alle Beobachtungen mit echter Riot-Match-ID lesen (LIVE_-IDs loest
 *      vorher scripts/backfill-companion-placements.mjs auf).
 *   2. Je (Match, Beobachter) mit Riot-Namen die Comp bestimmen: zuerst eine
 *      schon versiegelte Gruppe desselben Spiels, dann die alte class-cache.json
 *      (nur noch gelesen), dann Box-Match-Cache, sonst Riot Match-Detail +
 *      classifyComp. Schluessel ist die Familie `<trait>__<carry>` — dieselbe
 *      Ebene, auf der /tft/comps die Comps zeigt.
 *   3. Versiegeln (seit 10.10.2026): steht die Zuordnung fest, oder ist die
 *      Gruppe 48 h alt, schreibt A die Zuordnung an die eigenen Zeilen und
 *      B ersetzt in EINEM Aufruf ueber alle Arten den Namen durch ein Pseudonym
 *      (companion-positions.mjs). B laeuft nur nach erfolgreichem A; stirbt der
 *      Lauf dazwischen, macht der naechste nur noch B. Steht dasselbe Spiel
 *      schon unter dem Pseudonym, fallen die doppelten Zeilen weg.
 *   4. Zellen zaehlen, alles hochladen, Zeilen loeschen, die nicht mehr dazugehoeren.
 *
 * Die Zuordnung steht ab jetzt an den Zeilen; Riot wird je Spiel also genau
 * einmal erfolgreich gefragt, und ein Riot-Ausfall kann die Tabelle nicht mehr
 * schrumpfen lassen — offene Spiele zaehlen einfach noch nicht mit.
 *
 * Exit 1, wenn danach noch ein Riot-Name aelter als die Frist (+2 h) dasteht.
 * Ohne COMPANION_PSEUDONYM_KEY (mind. 32 Zeichen) startet der Lauf gar nicht.
 *
 *   node scripts/aggregate-position-observations.mjs [--dry-run] [--no-box]
 */

import { readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { createRiotClient } from './lib/riot-client.mjs';
import { riotWindowFor } from './lib/riot-limits.mjs';
import { getRegionalRouting, getAccountRouting, isValidRegion } from './lib/regional-routing.mjs';
import { classifyComp } from './lib/tft-classify-comp.mjs';
import {
  familyKeyFromCluster, isRiotMatchId, isRiotHandle, groupKey, aggregateCells, staleRows, regionFromMatchId,
  pseudonym, isPseudonym, shouldSeal, isFinalClass, classColumns, storedClass, collidingIds,
  MIN_PSEUDONYM_KEY, PRIVACY_DEADLINE_MS,
} from './lib/companion-positions.mjs';

function loadEnv() {
  const candidates = ['/etc/metastats-crawler/env', resolve(process.cwd(), '.env.local')];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.includes('=') || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^"|"$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
    break;
  }
}
loadEnv();

const DRY_RUN = process.argv.includes('--dry-run');
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HETZNER_DB = process.env.DATABASE_URL;
// Strikt der TFT-Key, wie im Backfill (Begruendung dort).
const RIOT_KEY = process.env.RIOT_API_KEY_TFT;
// Nie aendern: ein neuer Schluessel gibt neue Pseudonyme, und ein spaeter
// zweiter Upload eines schon versiegelten Spiels wuerde doppelt zaehlen.
const PSEUDONYM_KEY = process.env.COMPANION_PSEUDONYM_KEY;
if (!SUPA_URL || !SUPA_KEY) { console.error('SUPABASE env vars required'); process.exit(1); }
if (!RIOT_KEY) { console.error('RIOT_API_KEY_TFT required'); process.exit(1); }
if (!PSEUDONYM_KEY || PSEUDONYM_KEY.length < MIN_PSEUDONYM_KEY) {
  console.error(`COMPANION_PSEUDONYM_KEY fehlt oder ist kuerzer als ${MIN_PSEUDONYM_KEY} Zeichen — ohne ihn keine Versiegelung.`);
  process.exit(1);
}

const SOURCE_KEY = 'tft_position_observations';
const PAGE = 1000;
const STATE_DIR = process.env.STATE_DIRECTORY || join(tmpdir(), 'metastats-companion');
// Bis 0.8.2 stand die Zuordnung nur hier, mit Riot-Namen als Schluessel. Wird
// nur noch gelesen und geloescht, sobald keine Klartext-Gruppe mehr offen ist.
const OLD_CACHE_FILE = join(STATE_DIR, 'class-cache.json');
const ALARM_MS = PRIVACY_DEADLINE_MS + 2 * 60 * 60 * 1000;

// Box-Cache ist optional: ohne DATABASE_URL (oder lokal mit --no-box) faellt alles auf Riot.
const pool = HETZNER_DB && !process.argv.includes('--no-box') ? new pg.Pool({ connectionString: HETZNER_DB, max: 3, statement_timeout: 60_000 }) : null;
// Ruhende Verbindungen, die der Server kappt (z. B. DB-Neustart), reissen sonst den Prozess.
pool?.on('error', (e) => console.error(`DB-Verbindung verworfen: ${e.message}`));
// Teilt sich das Budget mit dem Backfill (laufen nie gleichzeitig lange).
const riot = createRiotClient({ ...riotWindowFor('companion-backfill'), apiKey: RIOT_KEY });

const sbHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };
const OBS = 'tft_position_observations';

async function supaSelectAll(table, query) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${SUPA_URL}/rest/v1/${table}?${query}&offset=${offset}&limit=${PAGE}`, { headers: sbHeaders });
    if (!res.ok) throw new Error(`Supabase ${table} GET: HTTP ${res.status}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function supaUpsert(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 200) {
    const res = await fetch(`${SUPA_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 200)),
    });
    if (!res.ok) throw new Error(`Supabase upsert ${table}: HTTP ${res.status} ${await res.text()}`);
  }
}

async function supaDelete(table, filter) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
  });
  if (!res.ok) throw new Error(`Supabase delete ${table}: HTTP ${res.status} ${await res.text()}`);
}

/** PATCH ohne Wurf: der Aufrufer entscheidet je Status (409 = Duplikat). */
async function supaPatch(table, filter, body) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...sbHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, text: res.ok ? '' : (await res.text()).slice(0, 160) };
}

function loadOldCache() {
  try {
    return JSON.parse(readFileSync(OLD_CACHE_FILE, 'utf8')).groups || {};
  } catch {
    return {};
  }
}

// Voruebergehend = spaeter nochmal versuchen. 401/403 gehoeren dazu: ein
// ungueltiger Schluessel ist kein Urteil ueber das Spiel.
const isTransient = (status) => status == null || status === 401 || status === 403 || status === 429 || status >= 500;

class TransientError extends Error {}

// `label` statt URL in Meldungen: die Konto-Abfrage traegt den Riot-Namen im Pfad.
async function riotJson(url, label) {
  const j = await riot.fetchJson(url, { safe: true });
  if (j == null) throw new TransientError(`${label}: Netzfehler`);
  if (j._status) {
    if (isTransient(j._status)) throw new TransientError(`${label}: HTTP ${j._status}`);
    return { _status: j._status };
  }
  return j;
}

const handles = new Map(); // Riot-Name → Konto-ID, nur fuer diesen Lauf

async function resolvePuuid(observer, region) {
  if (isPseudonym(observer)) return null; // versiegelt: nie wieder nachschlagen
  if (!isRiotHandle(observer)) return observer; // aeltere App-Versionen: schon Konto-ID
  if (handles.has(observer)) return handles.get(observer);
  const [gameName, tagLine] = observer.split('#');
  const acc = await riotJson(
    `https://${getAccountRouting(region)}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    'account-v1',
  );
  const puuid = acc._status ? null : acc.puuid || null;
  handles.set(observer, puuid);
  return puuid;
}

async function fromBoxCache(matchId, puuid) {
  if (!pool) return null;
  const r = await pool.query(
    `select comp_cluster_key, set_number, queue_id, placement
       from tft_player_match_cache where match_id = $1 and puuid = $2 limit 1`,
    [matchId, puuid],
  );
  const row = r.rows[0];
  if (!row?.comp_cluster_key) return null;
  return {
    clusterKey: row.comp_cluster_key, familyKey: familyKeyFromCluster(row.comp_cluster_key),
    set: row.set_number, queue: row.queue_id, placement: row.placement, src: 'box',
  };
}

async function fromRiot(matchId, puuid, region) {
  const md = await riotJson(`https://${getRegionalRouting(region)}.api.riotgames.com/tft/match/v1/matches/${matchId}`, `match ${matchId}`);
  if (md._status) return { skip: `match_${md._status}` };
  const p = (md.info?.participants || []).find(x => x.puuid === puuid);
  if (!p) return { skip: 'not_in_match' };
  const set = Number(md.info.tft_set_number);
  let cls = null;
  try { cls = classifyComp(p, { currentSet: set }); } catch (e) { return { skip: `classify_error:${e.message.slice(0, 60)}` }; }
  if (!cls?.clusterKey) return { skip: 'unclassified', set, queue: md.info.queue_id };
  return {
    clusterKey: cls.clusterKey, familyKey: familyKeyFromCluster(cls.clusterKey),
    set, queue: md.info.queue_id, placement: p.placement, src: 'riot',
  };
}

async function classifyPlain(g) {
  if (!g.region) return { skip: 'region' };
  const puuid = await resolvePuuid(g.observer, g.region);
  if (!puuid) return { skip: 'no_account' };
  return (await fromBoxCache(g.matchId, puuid)) || (await fromRiot(g.matchId, puuid, g.region));
}

/** Zeilen je (Match, Beobachter); nur echte Match-IDs mit Beobachter. */
function groupRows(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!isRiotMatchId(r.match_id) || !r.observer_puuid) continue;
    const gk = groupKey(r.match_id, r.observer_puuid);
    let g = groups.get(gk);
    if (!g) {
      g = { matchId: r.match_id, observer: r.observer_puuid, region: null, rows: [], own: false, oldest: r.observed_at, stored: null };
      groups.set(gk, g);
    }
    g.rows.push(r);
    if (!g.region) g.region = isValidRegion(r.region) ? r.region : regionFromMatchId(r.match_id);
    if (r.observed_at < g.oldest) g.oldest = r.observed_at;
    if (r.kind === 'own') {
      g.own = true;
      g.stored ??= storedClass(r);
    }
  }
  return groups;
}

/**
 * A + B fuer eine Klartext-Gruppe. Gibt das Pseudonym zurueck, oder null wenn
 * es diesmal nicht geklappt hat (naechster Lauf versucht es wieder).
 */
async function seal(g, cls, groups, nowIso) {
  const p = pseudonym(g.matchId, g.observer, PSEUDONYM_KEY);
  const twin = groups.get(groupKey(g.matchId, p));
  const base = `match_id=eq.${encodeURIComponent(g.matchId)}&observer_puuid=eq.${encodeURIComponent(g.observer)}`;
  const label = `${g.matchId} (${g.rows.length} Zeilen)`;
  if (DRY_RUN) {
    const dup = twin ? collidingIds(g.rows, twin.rows).length : 0;
    console.log(`  Probelauf: wuerde versiegeln ${label}${g.own && !g.stored ? `, Zuordnung ${cls?.familyKey ?? 'keine'}` : ''}${dup ? `, ${dup} doppelte Zeilen loeschen` : ''}`);
    return null;
  }
  if (g.own && !g.stored) {
    const a = await supaPatch(OBS, `${base}&kind=eq.own`, classColumns(cls, nowIso));
    if (!a.ok) { console.warn(`  Zuordnung schreiben fehlgeschlagen: ${label} — HTTP ${a.status} ${a.text}`); return null; }
  }
  const renamed = { observer_puuid: p, observer_placement: null };
  let b = await supaPatch(OBS, base, renamed);
  if (b.status === 409 && twin) {
    const ids = collidingIds(g.rows, twin.rows);
    for (let i = 0; i < ids.length; i += 200) await supaDelete(OBS, `id=in.(${ids.slice(i, i + 200).join(',')})`);
    console.log(`  ${label}: zweiter Upload, ${ids.length} doppelte Zeilen geloescht`);
    b = await supaPatch(OBS, base, renamed);
  }
  if (!b.ok) { console.warn(`  Versiegeln fehlgeschlagen: ${label} — HTTP ${b.status} ${b.text}`); return null; }
  return p;
}

async function main() {
  const t0 = Date.now();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const all = await supaSelectAll(OBS,
    'select=id,match_id,observer_puuid,region,kind,unit,cell,round,client_version,observed_at,' +
    'cluster_key,family_key,queue_id,classified_at&order=id.asc');
  const groups = groupRows(all);
  const plain = [...groups.values()].filter(g => !isPseudonym(g.observer));
  console.log(`Beobachtungen: ${all.length}, Spiele mit echter Match-ID: ${groups.size}, davon mit Riot-Namen ${plain.length}`);

  // 2. Zuordnen — nur Klartext-Gruppen mit eigenem Brett und ohne gespeicherte Zuordnung.
  const oldCache = loadOldCache();
  const classes = new Map(); // groupKey → Zuordnung (gespeichert oder frisch)
  const skips = {};
  let transient = 0;
  for (const [gk, g] of groups) if (g.stored) classes.set(gk, g.stored);
  for (const g of plain) {
    if (!g.own || g.stored) continue;
    const gk = groupKey(g.matchId, g.observer);
    const twin = groups.get(groupKey(g.matchId, pseudonym(g.matchId, g.observer, PSEUDONYM_KEY)));
    const cached = oldCache[gk];
    let c = twin?.stored ?? (cached?.clusterKey ? cached : null);
    if (!c) {
      try {
        c = await classifyPlain(g);
      } catch (e) {
        if (!(e instanceof TransientError)) throw e;
        transient++;
        console.warn(`  voruebergehend fehlgeschlagen: ${g.matchId} — ${e.message}`);
        c = { transient: true };
      }
    }
    classes.set(gk, c);
    if (c.skip) skips[c.skip] = (skips[c.skip] || 0) + 1;
  }
  console.log(`zugeordnet ${[...classes.values()].filter(c => c.familyKey).length}, offen ${JSON.stringify(skips)}, voruebergehend ${transient}`);

  // 3. Versiegeln.
  let sealed = 0, failed = 0, waiting = 0;
  for (const g of plain) {
    const gk = groupKey(g.matchId, g.observer);
    const cls = g.stored ?? classes.get(gk);
    if (!shouldSeal(g, cls, now)) { waiting++; continue; }
    const p = await seal(g, isFinalClass(cls) ? cls : null, groups, nowIso);
    if (!p) { if (!DRY_RUN) failed++; continue; }
    sealed++;
    // Im Speicher nachziehen: Zaehlung unten und spaetere Zwillinge in diesem Lauf.
    const pk = groupKey(g.matchId, p);
    const after = g.stored ?? (g.own ? storedClass(classColumns(isFinalClass(cls) ? cls : null, nowIso)) : null);
    const twin = groups.get(pk);
    for (const r of g.rows) r.observer_puuid = p;
    if (twin) twin.rows.push(...g.rows);
    else groups.set(pk, { ...g, observer: p, stored: after });
    groups.delete(gk);
    classes.delete(gk);
    if (after && !classes.has(pk)) classes.set(pk, after);
  }
  console.log(`versiegelt ${sealed}, wartet auf Zuordnung ${waiting}, fehlgeschlagen ${failed}`);

  // 4. Zellen.
  const observations = all.filter(o => o.kind === 'own' && isRiotMatchId(o.match_id) && o.observer_puuid);
  const { rows, used, skipped } = aggregateCells(observations, classes);
  const families = new Set(rows.map(r => r.cluster_key));
  console.log(`Zellen: ${rows.length} in ${families.size} Comps (${used} Beobachtungen gezaehlt, ${skipped} nicht)`);

  const existing = await supaSelectAll('tft_position_comp_cell', 'select=cluster_key,unit,cell&order=cluster_key.asc,unit.asc,cell.asc');
  const stale = staleRows(existing, rows);
  console.log(`Tabelle vorher: ${existing.length} Zeilen, davon ${stale.length} veraltet`);

  if (DRY_RUN) {
    for (const f of families) {
      const fr = rows.filter(r => r.cluster_key === f);
      console.log(`  ${f}: ${fr.length} Zellen, ${Math.max(...fr.map(r => r.distinct_matches))} Spiele`);
    }
    console.log('Probelauf — nichts geschrieben.');
    return;
  }

  await supaUpsert('tft_position_comp_cell', rows, 'cluster_key,unit,cell');

  // Ganze Comps, die nicht mehr vorkommen, in einem Aufruf; Rest einzeln.
  const goneClusters = [...new Set(stale.map(r => r.cluster_key))].filter(c => !families.has(c));
  for (const c of goneClusters) await supaDelete('tft_position_comp_cell', `cluster_key=eq.${encodeURIComponent(c)}`);
  for (const r of stale.filter(r => families.has(r.cluster_key))) {
    await supaDelete('tft_position_comp_cell',
      `cluster_key=eq.${encodeURIComponent(r.cluster_key)}&unit=eq.${encodeURIComponent(r.unit)}&cell=eq.${r.cell}`);
  }

  const lastObserved = observations.reduce((m, o) => (o.observed_at > m ? o.observed_at : m), '1970-01-01T00:00:00Z');
  await supaUpsert('tft_position_aggregator_state',
    [{ source: SOURCE_KEY, last_observed_at: lastObserved, last_run_at: new Date().toISOString() }], 'source');
  console.log(`geschrieben: ${rows.length} Zellen, ${stale.length} geloescht (${Math.round((Date.now() - t0) / 1000)} s)`);

  // 5. Frist pruefen und die alte Datei mit Riot-Namen loswerden.
  const left = [...groups.values()].filter(g => !isPseudonym(g.observer));
  const overdue = left.filter(g => now - Date.parse(g.oldest) >= ALARM_MS);
  if (left.length === 0 && existsSync(OLD_CACHE_FILE)) {
    rmSync(OLD_CACHE_FILE);
    console.log('class-cache.json geloescht (keine Riot-Namen mehr offen)');
  }
  if (overdue.length > 0) {
    console.error(`FRIST UEBERSCHRITTEN: ${overdue.length} Spiele tragen noch einen Riot-Namen (${overdue.map(g => g.matchId).join(', ')})`);
    process.exitCode = 1;
  }
}

main()
  .catch(err => {
    console.error('FAIL:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(() => pool?.end().catch(() => {}));
