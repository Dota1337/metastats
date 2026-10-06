#!/usr/bin/env node
/**
 * Holt TFT-Turniere von Liquipedia und schreibt sie nach Supabase.
 *
 * Ablauf (Wochenlauf):
 *   1) Seitenliste: handgepflegte Startliste (traegt Region/Set/Tier) plus
 *      Seiten aus Category:S-Tier_Tournaments + A-Tier (+ B-Tier mit
 *      --include-b-tier). Fertige Turniere mit Ergebnissen werden nach 14 Tagen
 *      uebersprungen, die 10 am laengsten nicht geprueften trotzdem geladen.
 *   2) Je Seite action=parse (ohne Cache, Weiterleitungen aufgeloest):
 *      {{Infobox league}} fuer die Kopfdaten, die Prize-Pool-Vorlagen fuer die
 *      Plaetze (Parser: scripts/lib/tft-tournament-parse.mjs).
 *   3) Verknuepfung Zeile → Pro ueber den Liquipedia-Link der Zeile
 *      (link= / pNlink=, sonst die gleichnamige Seite) gegen source_page der
 *      Pros. Gleiche Namen werden nie direkt verknuepft.
 *   4) Erst schreiben, dann nur Verschwundenes loeschen — und das nur, wenn
 *      Infobox und Prize Pool heil sind. Alles andere landet als [pruefen].
 *
 *   Sonderpreise (AwardPrizePool, z. B. "1 Win Bounty") gehen nach
 *   tft_tournament_awards (0087), nicht in die Plaetze.
 *
 * --repair (D13): alte Turniere ohne Ergebniszeilen, Stapelabruf mit 50 Titeln
 *   je Anfrage. Schreibt nur Ergebniszeilen, Sonderpreise + num_participants,
 *   nie die Kopfdaten, nie standings_sources, loescht nichts.
 *
 * Liquipedia: hoechstens 1 Parse-Anfrage je 30 s (Sperre in
 * lib/liquipedia-tft.mjs). Nie von der Hetzner-Box aus starten.
 *
 * Exit 1: Sperre/429, Zeitlimit eines Schritts, mehr als 3 Schreibfehler,
 * mehr als 20 % fehlgeschlagene Seiten. Ende per --deadline-min ist Exit 0.
 *
 * Aufruf:
 *   node scripts/crawl-tft-tournaments.mjs                  # Wochenlauf
 *   node scripts/crawl-tft-tournaments.mjs --limit 5        # Probelauf
 *   node scripts/crawl-tft-tournaments.mjs --no-supabase    # Trockenlauf (liest, schreibt nicht)
 *   node scripts/crawl-tft-tournaments.mjs --no-discover    # nur Startliste
 *   node scripts/crawl-tft-tournaments.mjs --include-b-tier # auch B-Tier
 *   node scripts/crawl-tft-tournaments.mjs --pages "Foo,Bar"
 *   node scripts/crawl-tft-tournaments.mjs --full           # auch fertige Turniere
 *   node scripts/crawl-tft-tournaments.mjs --post-only      # nur Nachlaeufe
 *   node scripts/crawl-tft-tournaments.mjs --repair         # D13
 *   node scripts/crawl-tft-tournaments.mjs --deadline-min 80
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getUsdRate } from './lib/fx-rates.mjs';
import { reconvertStored, rebuildPlayerLinks, setDryRun, normName } from './lib/tft-tournament-postpass.mjs';
import {
  liquipediaJson,
  liquipediaCategoryMembers,
  expandTemplates as sharedExpandTemplates,
  LiquipediaCooldownError,
  cooldownStatus,
} from './lib/liquipedia-tft.mjs';
import {
  chunk, parseInfobox, unwiki, unwikiTemplateOnly, parseDate, parsePrize, detectPageCurrency,
  deriveStatus, deriveSetNumber, countParticipants, participantsFromInfobox, numericTierToLetter,
  standingsSources, pageToSlug, extractPrizePoolPlacements, extractAwards, parsePlacementTableHtml,
  fetchWikitextBatch, fetchHtmlFresh, LiquipediaApiError, resolveTitles, fetchRedirectAliases,
} from './lib/tft-tournament-parse.mjs';
import { normalizePage, withTimeout, StepTimeoutError } from './lib/tft-pro-history.mjs';

// Fertige Turniere mit Ergebnissen werden uebersprungen, sobald ihr Ende
// laenger als diese Karenz her ist — Liquipedia traegt nach Turnierende oft
// noch Tage nach. Die ROTATION aeltesten davon werden je Lauf trotzdem geladen,
// damit spaete Korrekturen ankommen.
const SKIP_GRACE_DAYS = 14;
const ROTATION = 10;

// D4/Probe 6: Liquipedia teilt den Team-Preis auf die Spieler (Loescher-Infobox
// 16.779 $ passt nur mit Teilung). Duo (D2) bleibt voller Slot-Preis je Spieler.
export const TEAM_PRIZE_MODE = 'split';

// Zeitlimit je Liquipedia-Schritt. Danach haelt der Lauf an: der abgehaengte
// Abruf laeuft weiter und die Wartesperre ist nicht gegen Gleichzeitigkeit geschuetzt.
const STEP_TIMEOUT_MS = 13 * 60_000;
const DB_TIMEOUT_MS = 60_000;
const MAX_WRITE_ERRORS = 3;
const MAX_FAIL_RATE = 0.2;
const DAY_MS = 86_400_000;

function loadEnv() {
  const p = resolve(process.cwd(), '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line.includes('=') || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed list — hand-curated for V1 because Liquipedia's
// Category:S-Tier_Tournaments listing is incomplete for TFT. Update this list
// when Liquipedia adds new big events; eventually we can derive it from the
// Portal:Statistics/<year> page which lists every event of the year.
// Tier mapping per Liquipedia: S/A/B/C.

export const SEED_TOURNAMENTS = [
  // S-Tier — premier events
  { page: 'Esports_World_Cup/2026', tier: 'S', region: 'INT' },
  { page: 'Esports_World_Cup/2025', tier: 'S', region: 'INT' },
  { page: 'Into_the_Arcane/Tacticians_Crown', tier: 'S', region: 'INT', setNumber: 14 },
  { page: 'K.O._Coliseum/Tacticians_Crown', tier: 'S', region: 'INT', setNumber: 15 },
  { page: 'Space_Gods/Tacticians_Crown', tier: 'S', region: 'INT', setNumber: 16 },
  // A-Tier — regional finals + pro circuit majors
  { page: 'Space_Gods/AMER/Regional_Finals', tier: 'A', region: 'AMER', setNumber: 16 },
  { page: 'Space_Gods/EMEA/Regional_Finals', tier: 'A', region: 'EMEA', setNumber: 16 },
  { page: 'Space_Gods/APAC/Regional_Finals', tier: 'A', region: 'APAC', setNumber: 16 },
  { page: 'Space_Gods/TFT_Pro_Circuit/AMER/Anima_Cup', tier: 'A', region: 'AMER', setNumber: 16 },
  { page: 'Space_Gods/TFT_Pro_Circuit/AMER/Tactical_Cup', tier: 'A', region: 'AMER', setNumber: 16 },
  { page: 'Space_Gods/TFT_Pro_Circuit/AMER/Crystal_Cup', tier: 'A', region: 'AMER', setNumber: 16 },
  { page: 'Space_Gods/TFT_Pro_Circuit/EMEA/Anima_Cup', tier: 'A', region: 'EMEA', setNumber: 16 },
  { page: 'Space_Gods/TFT_Pro_Circuit/EMEA/Tactical_Cup', tier: 'A', region: 'EMEA', setNumber: 16 },
  { page: 'Space_Gods/TFT_Pro_Circuit/EMEA/Crystal_Cup', tier: 'A', region: 'EMEA', setNumber: 16 },
  // Set 15 + 14 reference events (so the patch-diff backfill has data)
  { page: 'K.O._Coliseum/AMER/Regional_Finals', tier: 'A', region: 'AMER', setNumber: 15 },
  { page: 'K.O._Coliseum/EMEA/Regional_Finals', tier: 'A', region: 'EMEA', setNumber: 15 },
];

// Set names — mirror of scripts/detect-tft-set.mjs SET_NAMES. Keep in sync.
// Used to resolve the Liquipedia `{{SetName/N}}` template, which on the wiki
// renders to the marketing-facing set name (e.g. {{SetName/17}} → "Space Gods").
export const TFT_SET_NAMES = {
  1: 'Beta',
  2: 'Rise of the Elements',
  3: 'Galaxies',
  4: 'Fates',
  5: 'Reckoning',
  6: 'Gizmos & Gadgets',
  7: 'Dragonlands',
  8: 'Monsters Attack',
  9: 'Runeterra Reforged',
  10: 'Remix Rumble',
  11: 'Inkborn Fables',
  12: "Magic n' Mayhem",
  13: 'Into the Arcane',
  14: 'Cyber City',
  15: 'K.O. Coliseum',
  16: 'Lore & Legends',
  17: 'Space Gods',
  18: 'Enchanted Wilds',
};
const SET_OPTS = { setNames: TFT_SET_NAMES };

// ─────────────────────────────────────────────────────────────────────────────
// Reine Helfer (getestet in scripts/crawl-tft-tournaments.test.mjs)

/**
 * Teilnehmer aus den Ergebniszeilen (Rueckfall, wenn die Infobox keine Zahl hat):
 * Solo = verschiedene Spieler, Team = verschiedene Teams (D3), Duo = Spieler / 2.
 */
export function entrantsFromRows(rows) {
  const solo = new Set(), teams = new Set(), duo = new Set();
  for (const r of rows || []) {
    const name = String(r?.proName || '').trim().toLowerCase();
    if (r?.kind === 'team') teams.add(r.team ? `t:${String(r.team).toLowerCase()}` : `p:${r.placement}`);
    else if (r?.kind === 'duo') { if (name) duo.add(name); }
    else if (name) solo.add(name);
  }
  const n = solo.size + teams.size + Math.ceil(duo.size / 2);
  return n > 0 ? n : null;
}

/** Seite → Konten der Pros. Nur Pros mit Konto; Schluessel wie normalizePage. */
export function buildPageIndex(pros) {
  const idx = new Map();
  for (const p of pros || []) {
    if (!p?.puuid) continue;
    const k = normalizePage(p.source_page);
    if (!k) continue;
    if (!idx.has(k)) idx.set(k, new Set());
    idx.get(k).add(p.puuid);
  }
  return idx;
}

/**
 * Konto einer Ergebniszeile ueber den Liquipedia-Link. Ohne link= verlinkt
 * Liquipedia auf die Seite mit dem Spielernamen — das ist die Seite, nicht ein
 * Namensvergleich mit unseren Pros. Nur bei genau einem Konto je Seite.
 */
export function linkPuuid(row, idx) {
  const k = normalizePage(row?.link || row?.proName);
  if (!k || !idx) return null;
  const set = idx.get(k);
  return set && set.size === 1 ? [...set][0] : null;
}

/**
 * Was nach dem Schreiben geloescht werden darf.
 * @param stored   gespeicherte Zeilen [{ placement, pro_name }]
 * @param newRows  geschriebene Zeilen [{ placement, pro_name }]
 * @param intact   Prize Pool heil (extractPrizePoolPlacements.intact)
 * @param infobox  Infobox gefunden
 * @param keyOf    Schluessel einer Zeile (Boni: award|pro_name)
 * @returns {{ remove: Array, review: Array, reason: string|null }}
 */
export function planDeletes(stored, newRows, { intact, infobox, keyOf = r => `${r.placement}|${r.pro_name}` } = {}) {
  const fresh = new Set((newRows || []).map(keyOf));
  const old = stored || [];
  const vanished = old.filter(s => !fresh.has(keyOf(s)));
  if (vanished.length === 0) return { remove: [], review: [], reason: null };
  if (!infobox) return { remove: [], review: vanished, reason: 'keine Infobox' };
  if (intact !== true) return { remove: [], review: vanished, reason: 'Prize Pool nicht heil' };
  // Einbruch: mehr als die Haelfte von mindestens 10 Zeilen waere weg.
  if (old.length >= 10 && vanished.length > old.length * 0.5) {
    return { remove: [], review: vanished, reason: `Einbruch ${old.length} → ${old.length - vanished.length}` };
  }
  return { remove: vanished, review: [], reason: null };
}

/** D13: vergangene Turniere mit Seite, aber ohne eine einzige Ergebniszeile. */
export function repairTargets(tours, withResults, today) {
  return (tours || []).filter(t => t && t.id && !withResults.has(t.id) && t.liquipedia_page
    && (t.status === 'past' || (t.end_date && t.end_date < today)));
}

/** Zeilen ohne Dubletten auf dem exakten Schluessel (placement, pro_name). */
export function dedupeResults(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = `${r.placement}|${r.pro_name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aufrufzeile

function parseCli(argv) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const has = (k) => argv.includes(k);
  const deadlineMin = parseFloat(arg('--deadline-min', '0'));
  return {
    limit: parseInt(arg('--limit', '0'), 10) || 0,
    dry: has('--no-supabase'),
    pages: arg('--pages', ''),
    verbose: has('--verbose'),
    // --full: jede Seite laden wie bis 2026-09-13 (Notfall-Rueckweg).
    full: has('--full'),
    // Nur die Nachlaeufe (Neu-Umrechnung + Name→Konto), ohne Liquipedia-Abruf.
    postOnly: has('--post-only'),
    noDiscover: has('--no-discover'),
    includeB: has('--include-b-tier'),
    repair: has('--repair'),
    deadlineMin: Number.isFinite(deadlineMin) && deadlineMin > 0 ? deadlineMin : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase

function makeDb({ url, key, dry }) {
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const signal = () => AbortSignal.timeout(DB_TIMEOUT_MS);

  // PostgREST liefert hoechstens 1000 Zeilen je Abfrage.
  async function getAll(path) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const r = await fetch(`${url}/rest/v1/${path}`, { headers: { ...h, Range: `${from}-${from + 999}` }, signal: signal() });
      if (!r.ok) throw new Error(`Supabase read ${path.split('?')[0]} failed: HTTP ${r.status}`);
      const rows = await r.json();
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }

  async function upsert(table, rows, onConflict) {
    if (rows.length === 0) return;
    if (dry) { console.log(`  [supabase] dry-run, would write ${rows.length} to ${table}`); return; }
    const res = await fetch(`${url}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { ...h, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
      signal: signal(),
    });
    if (!res.ok) throw new Error(`Supabase upsert ${table} failed: HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);
  }

  async function remove(table, filter) {
    if (dry) return;
    const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
      method: 'DELETE', headers: { ...h, Prefer: 'return=minimal' }, signal: signal(),
    });
    if (!res.ok) throw new Error(`Supabase delete ${table} failed: HTTP ${res.status}`);
  }

  async function patch(table, filter, row) {
    if (dry) { console.log(`  [supabase] dry-run, would patch ${table}?${filter} ${JSON.stringify(row)}`); return; }
    const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
      signal: signal(),
    });
    if (!res.ok) throw new Error(`Supabase patch ${table} failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  return { getAll, upsert, remove, patch };
}

// Gespeicherter Stand: welche Turniere fertig sind (ueberspringen), wann sie
// zuletzt geprueft wurden (Rotation), welche Ergebnisse haben. Kein stiller
// Rueckfall: ist die Datenbank nicht lesbar, bricht der Lauf ab — "alles laden"
// lief nachweislich in das 180-min-Limit.
async function loadStoredState(db) {
  const withResults = new Set();
  for (const r of await db.getAll('tft_tournament_results?select=tournament_id&order=tournament_id')) withResults.add(r.tournament_id);
  // tier/region/set_number: Rueckfall fuer --pages, deren Liste sie nicht kennt.
  const tours = await db.getAll('tft_tournaments?select=id,liquipedia_page,status,start_date,end_date,last_validated_at,tier,region,set_number&order=id');
  const cutoff = Date.now() - SKIP_GRACE_DAYS * DAY_MS;
  const done = new Map();   // id -> last_validated_at (ms)
  for (const t of tours) {
    if (!withResults.has(t.id)) continue;
    // Ohne Datum macht deriveStatus "upcoming" — mit Ergebnissen ist so ein
    // Turnier aber laengst vorbei (29 von 38 am 2026-09-13).
    const finished = (t.status === 'past' && t.end_date && Date.parse(t.end_date) < cutoff)
      || (!t.start_date && !t.end_date);
    if (finished) done.set(t.id, t.last_validated_at ? Date.parse(t.last_validated_at) : 0);
  }
  return { done, withResults, tours };
}

async function loadPageIndex(db) {
  const pros = await db.getAll('tft_pro_players?select=pro_name,source_page,puuid&puuid=not.is.null&order=id');
  return buildPageIndex(pros);
}

// ─────────────────────────────────────────────────────────────────────────────
// Liquipedia

/** Wikitext einer Seite, frisch. null = Seite fehlt (404 oder missingtitle). */
async function fetchTournamentPage(page) {
  const j = await withTimeout(
    liquipediaJson({ action: 'parse', page, prop: 'wikitext|displaytitle|externallinks', redirects: '1' }, { noCache: true }),
    STEP_TIMEOUT_MS, `Seite ${page}`,
  );
  if (!j) return null;
  if (j.error) {
    if (j.error.code === 'missingtitle') return null;
    throw new LiquipediaApiError(j.error.code, j.error.info);
  }
  return {
    wikitext: j.parse?.wikitext?.['*'] || '',
    displayTitle: j.parse?.displaytitle || page.replace(/_/g, ' '),
    externalLinks: Array.isArray(j.parse?.externallinks) ? j.parse.externallinks : [],
    title: j.parse?.title || page.replace(/_/g, ' '),
    redirects: Array.isArray(j.parse?.redirects) ? j.parse.redirects : [],
  };
}

// Vorlagen im Namen, die wir nicht selbst aufloesen, laesst Liquipedia
// aufloesen (eigene Anfrage durch dieselbe Wartesperre). Fehler → Rohtext.
async function expandTemplatesViaLiquipedia(text, verbose) {
  if (!text) return text;
  try {
    return await withTimeout(sharedExpandTemplates(text), STEP_TIMEOUT_MS, 'expandtemplates');
  } catch (e) {
    if (e instanceof StepTimeoutError || e instanceof LiquipediaCooldownError) throw e;
    if (verbose) console.warn(`  [expand-fail] ${e.message}`);
    return text;
  }
}

// Auto-discover tournament pages from Liquipedia's tier categories so new
// events are picked up without editing SEED_TOURNAMENTS. The curated seed still
// wins (it carries region/set_number/tier overrides the categories don't have).
// S + A tiers by default (premier + regional majors); B-tier behind a flag
// because it's large and mostly minor weeklies.
async function discoverSeedFromCategories(includeB) {
  const cats = [
    { cat: 'S-Tier_Tournaments', tier: 'S' },
    { cat: 'A-Tier_Tournaments', tier: 'A' },
  ];
  if (includeB) cats.push({ cat: 'B-Tier_Tournaments', tier: 'B' });
  const discovered = [];
  for (let i = 0; i < cats.length; i++) {
    try {
      const titles = await withTimeout(liquipediaCategoryMembers(cats[i].cat), STEP_TIMEOUT_MS, `Kategorie ${cats[i].cat}`);
      for (const title of titles) {
        discovered.push({ page: title.replace(/ /g, '_'), tier: cats[i].tier, region: null });
      }
      console.log(`  [discover] ${cats[i].cat}: ${titles.length} pages`);
    } catch (e) {
      // Sperre und Zeitlimit beenden den Lauf, alles andere nur diese Kategorie.
      if (e instanceof LiquipediaCooldownError || e instanceof StepTimeoutError) throw e;
      console.warn(`  [discover] ${cats[i].cat} failed: ${e.message}`);
    }
  }
  return discovered;
}

/**
 * Plaetze einer Seite. Team-Pools ohne eingetragene Teams brauchen die
 * gerenderte Tabelle (eine weitere Parse-Anfrage). Scheitert sie, bleibt das
 * erste Ergebnis — es ist dann nicht heil, also wird nichts geloescht.
 */
async function extractWithFallback(title, wikitext) {
  const opts = { teamPrizeMode: TEAM_PRIZE_MODE, ...SET_OPTS };
  let res = extractPrizePoolPlacements(wikitext, opts);
  if (res.needsHtml) {
    try {
      const page = await withTimeout(fetchHtmlFresh(title), STEP_TIMEOUT_MS, `HTML ${title}`);
      const teamPlaces = page ? parsePlacementTableHtml(page.html) : [];
      if (teamPlaces.length) res = extractPrizePoolPlacements(wikitext, { ...opts, teamPlaces });
      else console.warn(`  [html] ${title}: keine Platzierungstabelle`);
    } catch (e) {
      if (e instanceof LiquipediaCooldownError || e instanceof StepTimeoutError) throw e;
      console.warn(`  [html-fail] ${title}: ${e.message}`);
    }
  }
  if (res.unresolved.length) console.warn(`  [unresolved] ${title}: ${res.unresolved.join(', ')}`);
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// Preisgeld (W1, 2026-07-04)

// Seitenwaehrung + EIN Kurs zum Turnierdatum (Cache data/fx-rates.json).
// Regeln (feedback_no_fake_values — nie einen Kurs raten):
//   usdprize=            → echte USD, keine Umrechnung
//   localprize + bekannte Waehrung + Kurs + Datum → umgerechnet
//   localprize + (MIXED | keine localcurrency | kein Kurs | kein Datum) →
//   prize_usd NULL, Betrag + Waehrung bleiben, [fx-skip] im Log
async function priceContext(page, wikitext, fields, startDate, endDate) {
  const pageCurrency = detectPageCurrency(wikitext, fields);
  const fxEventDate = endDate || startDate || null;
  let fx = null;
  const needsFx = pageCurrency && pageCurrency !== 'MIXED' && pageCurrency !== 'USD';
  if (needsFx && fxEventDate) fx = await getUsdRate(pageCurrency, fxEventDate);
  const fxSkipReason = !pageCurrency ? null
    : pageCurrency === 'MIXED' ? 'mixed localcurrency codes on page'
    : pageCurrency === 'USD' ? null
    : !fxEventDate ? 'no start/end date for event-dated rate'
    : !fx ? `no rate for ${pageCurrency}`
    : null;
  if (fxSkipReason) console.warn(`  [fx-skip] ${page}: ${fxSkipReason} — native amounts kept, prize_usd NULL`);

  const convertLocal = (localRaw) => {
    if (localRaw == null) return null;
    if (!pageCurrency || pageCurrency === 'MIXED') return { usd: null, native: localRaw, currency: pageCurrency === 'MIXED' ? 'MIXED' : null, rate: null, date: null, source: null };
    if (pageCurrency === 'USD') return { usd: localRaw, native: null, currency: 'USD', rate: null, date: null, source: 'usd' };
    if (!fx) return { usd: null, native: localRaw, currency: pageCurrency, rate: null, date: null, source: null };
    return { usd: Math.round(localRaw * fx.rate), native: localRaw, currency: pageCurrency, rate: fx.rate, date: fx.effectiveDate, source: fx.source };
  };

  // Infobox: prizepoolusd= ist USD; ein nacktes prizepool= ist USD, ausser die
  // Seite setzt eine localcurrency.
  const poolUsdExplicit = parsePrize(fields.prizepoolusd);
  const poolRaw = parsePrize(fields.prizepool);
  let pool = { usd: poolUsdExplicit ?? null, native: null, currency: poolUsdExplicit != null ? 'USD' : null, rate: null, date: null, source: poolUsdExplicit != null ? 'usd' : null };
  if (poolUsdExplicit == null && poolRaw != null) {
    pool = needsFx || pageCurrency === 'MIXED' ? convertLocal(poolRaw)
      : { usd: poolRaw, native: null, currency: 'USD', rate: null, date: null, source: 'usd' };
  }
  return { convertLocal, pool, fxSkipped: !!fxSkipReason };
}

function toResultRows(id, rows, convertLocal, pageIdx) {
  const none = { usd: null, native: null, currency: null, rate: null, date: null, source: null };
  return dedupeResults(rows.map(p => {
    const conv = p.prizeUsdRaw != null
      ? { usd: p.prizeUsdRaw, native: null, currency: 'USD', rate: null, date: null, source: 'usd' }
      : (convertLocal(p.prizeLocalRaw) ?? none);
    return {
      tournament_id: id,
      placement: p.placement,
      placement_max: p.placementMax ?? null,
      pro_name: p.proName,
      pro_puuid: linkPuuid(p, pageIdx),
      team: p.team ?? null,
      country: p.country ?? null,
      prize_usd: conv.usd,
      prize_native: conv.native,
      prize_currency: conv.currency,
      fx_rate: conv.rate,
      fx_date: conv.date,
      fx_source: conv.source,
    };
  }));
}

const resultFilter = (id, r) =>
  `tournament_id=eq.${encodeURIComponent(id)}&placement=eq.${r.placement}&pro_name=eq.${encodeURIComponent(r.pro_name)}`;

async function writeResults(db, results) {
  for (const part of chunk(results, 500)) await db.upsert('tft_tournament_results', part, 'tournament_id,placement,pro_name');
}

// Liquipedia schreibt den Sonderpreis-Gewinner hier anders als die Platz-Zeile
// (Tippfehler in der Quelle, von Hand gegen die DB geprueft 06.10.2026).
// Schluessel = Turnier-ID|Sonderpreis|Name im Sonderpreis → Name der Platz-Zeile.
// Greift nur, wenn der exakte Abgleich nichts findet und der Ziel-Name genau
// einmal unter den Platz-Zeilen steht.
export const AWARD_PLACE_OVERRIDES = new Map([
  ['ko-coliseum-tft-pro-circuit-cn-soul-fighter-cup|1 Win Bounty|Ibtz', 'lbtz'],
  ['ko-coliseum-tft-pro-circuit-amer-battle-academia-cup|1st-place bounty|arkjow', 'TT arkjow'],
]);

/**
 * Sonderpreise (0087) -> Zeilen fuer tft_tournament_awards. place_name ist der
 * Name derselben Person in den Platz-Zeilen der Seite: zuerst ueber die
 * Liquipedia-Seite, sonst ueber den Namen ohne Gross-/Kleinschreibung und
 * Leerzeichen — nur bei genau einem Treffer, nie unscharf. Danach die feste
 * Korrekturliste.
 */
export function toAwardRows(id, awards, convertLocal, pageIdx, placeRows, overrides = AWARD_PLACE_OVERRIDES) {
  const none = { usd: null, native: null, currency: null, rate: null, date: null, source: null };
  const byPage = new Map(), byName = new Map(), exact = new Map();
  const add = (m, k, v) => { if (!k) return; if (!m.has(k)) m.set(k, new Set()); m.get(k).add(v); };
  for (const p of placeRows || []) {
    add(byPage, normalizePage(p.link || p.proName), p.proName);
    add(byName, normName(p.proName), p.proName);
    exact.set(p.proName, (exact.get(p.proName) || 0) + 1);
  }
  const one = (set) => (set && set.size === 1 ? [...set][0] : null);
  const used = new Set();
  const fixed = (k) => {
    const target = overrides.get(`${id}|${k}`);
    if (target == null || exact.get(target) !== 1) return null;
    used.add(`${id}|${k}`);
    return target;
  };
  const now = new Date().toISOString();
  const seen = new Set();
  const out = [];
  for (const a of awards || []) {
    const k = `${a.award}|${a.proName}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const conv = a.prizeUsdRaw != null
      ? { usd: a.prizeUsdRaw, native: null, currency: 'USD', rate: null, date: null, source: 'usd' }
      : (convertLocal(a.prizeLocalRaw) ?? none);
    out.push({
      tournament_id: id,
      award: a.award,
      pro_name: a.proName,
      link: a.link ?? null,
      team: a.team ?? null,
      country: a.country ?? null,
      pro_puuid: linkPuuid(a, pageIdx),
      place_name: one(byPage.get(normalizePage(a.link || a.proName))) ?? one(byName.get(normName(a.proName))) ?? fixed(k),
      prize_usd: conv.usd,
      prize_native: conv.native,
      prize_currency: conv.currency,
      fx_rate: conv.rate,
      fx_date: conv.date,
      fx_source: conv.source,
      updated_at: now,
    });
  }
  // Eintrag greift nicht mehr (Quelle korrigiert oder Platz-Name geaendert) →
  // melden, damit die Liste nicht unbemerkt veraltet.
  for (const key of overrides.keys()) {
    if (key.startsWith(`${id}|`) && !used.has(key)) console.warn(`  [bonus-korrektur] greift nicht mehr: ${key}`);
  }
  return out;
}

/**
 * Zweiter Abgleich fuer Sonderpreise ohne place_name: Platz-Zeilen tragen oft
 * einen Weiterleitungsnamen ("Dankmemes" → Seite "Dankmemes01"), der Bonus den
 * echten Seitennamen — oder umgekehrt. Fragt Liquipedia nur fuer die offenen
 * Boni: echter Seitenname, dann dessen Weiterleitungen. Zuordnung weiter nur
 * bei genau einer Platz-Zeile. Aendert die Zeilen in place.
 */
export async function placeAwardsByRedirect(rows, placeRows, { resolve = resolveTitles, aliases = fetchRedirectAliases } = {}) {
  const open = (rows || []).filter(r => r.place_name == null);
  if (!open.length || !placeRows?.length) return rows;
  const byPage = new Map();
  for (const p of placeRows) {
    const k = normalizePage(p.link || p.proName);
    if (!k) continue;
    if (!byPage.has(k)) byPage.set(k, new Set());
    byPage.get(k).add(p.proName);
  }
  const titleOf = (r) => String(r.link || r.pro_name || '').trim();
  const titles = [...new Set(open.map(titleOf).filter(Boolean))];
  if (!titles.length) return rows;
  const canon = await resolve(titles);
  const pages = [...new Set([...canon.values()].filter(Boolean))];
  const alias = pages.length ? await aliases(pages) : new Map();
  for (const r of open) {
    const c = canon.get(titleOf(r));
    if (!c) continue;
    const hit = new Set();
    for (const n of [titleOf(r), c, ...(alias.get(c) || [])]) {
      for (const name of byPage.get(normalizePage(n)) || []) hit.add(name);
    }
    if (hit.size === 1) r.place_name = [...hit][0];
  }
  return rows;
}

// Weiterleitungs-Abgleich darf den Turnier-Lauf nicht kippen: bei Fehlern
// bleibt place_name leer (Bonus erscheint dann als eigene Zeile), Sperre und
// Zeitlimit brechen wie ueberall ab.
async function placeAwardsSafe(rows, placeRows) {
  try {
    return await placeAwardsByRedirect(rows, placeRows);
  } catch (e) {
    if (stopReason(e)) throw e;
    console.warn(`  [bonus-zuordnung] ${e.message}`);
    return rows;
  }
}

const awardKey = (r) => `${r.award}|${r.pro_name}`;
const awardFilter = (id, r) =>
  `tournament_id=eq.${encodeURIComponent(id)}&award=eq.${encodeURIComponent(r.award)}&pro_name=eq.${encodeURIComponent(r.pro_name)}`;

async function writeAwards(db, awards) {
  for (const part of chunk(awards, 500)) await db.upsert('tft_tournament_awards', part, 'tournament_id,award,pro_name');
}

const awardsOf = (wikitext) => extractAwards(wikitext, { teamPrizeMode: TEAM_PRIZE_MODE, ...SET_OPTS });

// ─────────────────────────────────────────────────────────────────────────────
// Nachlaeufe

async function postPasses(ctx) {
  if (!ctx.key) { console.log('  [post] no Supabase key — skipped'); return; }
  setDryRun(ctx.dry);
  console.log('\n[3/3] Post passes …');
  await withTimeout(reconvertStored({ url: ctx.url, key: ctx.key }), STEP_TIMEOUT_MS, 'Neu-Umrechnung');
  await withTimeout(rebuildPlayerLinks({ url: ctx.url, key: ctx.key, upsert: ctx.db.upsert }), STEP_TIMEOUT_MS, 'Spieler-Verknuepfung');
}

// Haelt den Lauf bei Sperre/Zeitlimit an; andere Fehler zaehlen als Fehlschlag.
function stopReason(e) {
  if (e instanceof LiquipediaCooldownError) return 'Sperre';
  if (e instanceof StepTimeoutError) return 'Zeitlimit';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wochenlauf

async function runCrawl(o, ctx) {
  const { db, canRead } = ctx;
  const deadline = o.deadlineMin ? ctx.t0 + o.deadlineMin * 60_000 : Infinity;

  let seed = SEED_TOURNAMENTS;
  if (o.pages) {
    seed = o.pages.split(',').map(p => p.trim()).filter(Boolean).map(p => ({ page: p, tier: null, region: null }));
  } else if (!o.noDiscover) {
    console.log('[0/3] Auto-discovering tournament pages from tier categories …');
    const discovered = await discoverSeedFromCategories(o.includeB);
    const seen = new Set(SEED_TOURNAMENTS.map(s => s.page.toLowerCase()));
    const merged = [...SEED_TOURNAMENTS];   // curated first — keeps their region/set/tier overrides
    for (const d of discovered) {
      const key = d.page.toLowerCase();
      if (!seen.has(key)) { merged.push(d); seen.add(key); }
    }
    console.log(`  [discover] ${SEED_TOURNAMENTS.length} curated + ${merged.length - SEED_TOURNAMENTS.length} new = ${merged.length} pages\n`);
    seed = merged;
  }

  // Bekannte Turnier-IDs: Weiterleitungen auf eine davon sind Dubletten.
  const knownIds = new Set(seed.map(s => pageToSlug(s.page)));
  let stored = null;
  if (canRead) {
    stored = await loadStoredState(db);
    for (const t of stored.tours) knownIds.add(t.id);
  }
  // Nur Neues laden. Eine ausdrueckliche --pages-Liste und --full laden immer;
  // --no-supabase gleicht nicht ab.
  if (!o.pages && !o.full && !o.dry) {
    const { done } = stored;
    const fresh = [], stale = [];
    for (const s of seed) (done.has(pageToSlug(s.page)) ? stale : fresh).push(s);
    stale.sort((a, b) => done.get(pageToSlug(a.page)) - done.get(pageToSlug(b.page)));
    const rotation = stale.slice(0, ROTATION);
    console.log(`  [skip-done] ${stale.length - rotation.length} finished tournaments skipped, ${fresh.length} new/open + ${rotation.length} re-checked\n`);
    seed = [...fresh, ...rotation];
  }
  if (o.limit > 0) seed = seed.slice(0, o.limit);
  console.log(`[1/3] ${seed.length} tournament pages to crawl (~${Math.ceil(seed.length * 30 / 60)} min @ 30 s rate-limit)\n`);

  const pageIdx = canRead ? await loadPageIndex(db) : new Map();
  console.log(`  [pro-join] ${pageIdx.size} Liquipedia-Seiten mit Konto\n`);
  // --pages kennt tier/region/set nicht: gespeicherte Werte statt null.
  const prevById = o.pages && stored ? new Map(stored.tours.map(t => [t.id, t])) : null;

  console.log('[2/3] Fetching + parsing + writing each page …');
  const st = { attempted: 0, failed: 0, missing: 0, noInfobox: 0, redirectSkipped: 0, fxSkipped: 0, written: 0, results: 0, awards: 0, deleted: 0, review: 0, writeErrors: 0, stopped: null };
  let n = 0;
  for (const s of seed) {
    if (Date.now() >= deadline) { st.stopped = 'Frist'; console.log(`  [frist] --deadline-min ${o.deadlineMin} erreicht, ${seed.length - n} Seiten offen`); break; }
    n++;
    st.attempted++;
    const id = pageToSlug(s.page);

    let page;
    try { page = await fetchTournamentPage(s.page); }
    catch (e) {
      const why = stopReason(e);
      if (why) { st.stopped = why; console.error(`  [abbruch] ${s.page}: ${e.message}`); break; }
      console.warn(`  [skip] ${s.page}: ${e.message}`); st.failed++; continue;
    }
    if (!page) { st.missing++; console.warn(`  [fehlt] ${s.page}: Seite existiert nicht`); continue; }

    const finalTitle = page.title.replace(/ /g, '_');
    const finalSlug = pageToSlug(finalTitle);
    if (finalSlug !== id && knownIds.has(finalSlug)) {
      st.redirectSkipped++;
      console.log(`  [weiterleitung] ${s.page} → ${finalTitle}: Ziel ist schon ein eigenes Turnier, uebersprungen`);
      continue;
    }

    let tour, results, ex, aw, awards;
    try {
      const fields = parseInfobox(page.wikitext);
      if (!fields) {
        if (o.verbose) console.warn(`  [skip] ${s.page}: no Infobox league`);
        st.noInfobox++; continue;
      }
      // Vorlagen im Namen, die wir nicht kennen: eine weitere Anfrage.
      let rawName = fields.name || '';
      if (/\{\{[^{}]+\}\}/.test(rawName) && /\{\{[^{}]+\}\}/.test(unwikiTemplateOnly(rawName, SET_OPTS))) {
        rawName = await expandTemplatesViaLiquipedia(rawName, o.verbose);
      }
      const name = unwiki(rawName, SET_OPTS) || page.displayTitle;
      const startDate = parseDate(fields.sdate || fields.startdate || fields.date);
      const endDate = parseDate(fields.edate || fields.enddate || fields.date);
      const status = deriveStatus(startDate, endDate);

      ex = await extractWithFallback(page.title, page.wikitext);
      aw = awardsOf(page.wikitext);
      const numParticipants = participantsFromInfobox(fields) || entrantsFromRows(ex.rows) || countParticipants(page.wikitext);
      const price = await priceContext(s.page, page.wikitext, fields, startDate, endDate);
      if (price.fxSkipped) st.fxSkipped++;
      const prev = prevById?.get(id);

      tour = {
        id,
        liquipedia_page: finalTitle,
        name,
        // Seed-tier wins over wiki-tier (wiki stores numeric 1/2/3; our schema uses S/A/B/C).
        tier: s.tier || prev?.tier || numericTierToLetter(fields.liquipediatier),
        region: s.region || prev?.region || null,
        // Set number from the page itself; seed value only as a fallback.
        set_number: deriveSetNumber(page.wikitext) || s.setNumber || prev?.set_number || null,
        start_date: startDate,
        end_date: endDate,
        status,
        prize_pool_usd: price.pool.usd,
        prize_pool_native: price.pool.native,
        prize_pool_currency: price.pool.currency,
        fx_rate: price.pool.rate,
        fx_date: price.pool.date,
        fx_source: price.pool.source,
        twitch_channel: fields.twitch || null,
        format: unwiki(fields.format, SET_OPTS) || null,
        num_participants: numParticipants,
        logo_url: null,                   // logos need image-API resolution; later
        source: 'liquipedia',
        last_validated_at: new Date().toISOString(),
      };
      // Nur mitsenden, wenn gefunden — sonst wuerde ein Abruf ohne Links
      // gespeicherte Quellen ueberschreiben.
      const sources = standingsSources(page.externalLinks);
      if (sources) tour.standings_sources = sources;
      results = toResultRows(id, ex.rows, price.convertLocal, pageIdx);
      awards = await placeAwardsSafe(toAwardRows(id, aw.rows, price.convertLocal, pageIdx, ex.rows), ex.rows);
    } catch (e) {
      const why = stopReason(e);
      if (why) { st.stopped = why; console.error(`  [abbruch] ${s.page}: ${e.message}`); break; }
      console.warn(`  [skip] ${s.page}: ${e.message}`); st.failed++; continue;
    }

    // Erst schreiben, dann nur Verschwundenes loeschen. Boni vor den
    // Ergebniszeilen: die alten Bonus-Plaetze (vor 0a781f4) verschwinden erst,
    // wenn ihr Ersatz steht.
    try {
      const before = canRead
        ? await db.getAll(`tft_tournament_results?select=placement,pro_name&tournament_id=eq.${encodeURIComponent(id)}&order=placement,pro_name`)
        : [];
      const awardsBefore = canRead
        ? await db.getAll(`tft_tournament_awards?select=award,pro_name&tournament_id=eq.${encodeURIComponent(id)}&order=award,pro_name`)
        : [];
      await db.upsert('tft_tournaments', [tour], 'id');
      await writeResults(db, results);
      await writeAwards(db, awards);
      const awardPlan = planDeletes(awardsBefore, awards, { intact: ex.intact && aw.intact, infobox: true, keyOf: awardKey });
      for (const r of awardPlan.remove) {
        await db.remove('tft_tournament_awards', awardFilter(id, r));
        console.log(`  [bonus geloescht]${o.dry ? ' (Trockenlauf)' : ''} ${id} | ${r.award} | ${r.pro_name}`);
        st.deleted++;
      }
      for (const r of awardPlan.review) console.log(`  [pruefen] Bonus nicht geloescht (${awardPlan.reason}): ${id} | ${r.award} | ${r.pro_name}`);
      st.review += awardPlan.review.length;
      const plan = planDeletes(before, results, { intact: ex.intact, infobox: true });
      for (const r of plan.remove) {
        await db.remove('tft_tournament_results', resultFilter(id, r));
        console.log(`  [geloescht]${o.dry ? ' (Trockenlauf)' : ''} ${id} | ${r.placement} | ${r.pro_name}`);
        st.deleted++;
      }
      for (const r of plan.review) console.log(`  [pruefen] nicht geloescht (${plan.reason}): ${id} | ${r.placement} | ${r.pro_name}`);
      st.review += plan.review.length;
      st.written++;
      st.results += results.length;
      st.awards += awards.length;
    } catch (e) {
      st.failed++; st.writeErrors++;
      console.warn(`  [write-fail] ${s.page}: ${e.message}`);
      if (st.writeErrors > MAX_WRITE_ERRORS) { st.stopped = 'Schreibfehler'; console.error(`  [abbruch] mehr als ${MAX_WRITE_ERRORS} Schreibfehler`); break; }
      continue;
    }
    console.log(`  ${n}/${seed.length}  ${s.page}  set=${tour.set_number ?? '—'}  placements=${results.length}${awards.length ? `  boni=${awards.length}` : ''}  participants=${tour.num_participants ?? '—'}${ex.intact && aw.intact ? '' : '  (nicht heil)'}`);
  }
  console.log(`\n  ${st.written} tournaments, ${st.results} placements, ${st.awards} Boni, ${st.deleted} geloescht, ${st.review} zu pruefen | fehlt: ${st.missing}, ohne Infobox: ${st.noInfobox}, Weiterleitung: ${st.redirectSkipped}, fx-skip: ${st.fxSkipped}, Fehler: ${st.failed}/${st.attempted}`);
  return st;
}

// ─────────────────────────────────────────────────────────────────────────────
// --repair (D13)

async function runRepair(o, ctx) {
  const { db, canRead } = ctx;
  const today = new Date().toISOString().slice(0, 10);
  const st = { attempted: 0, failed: 0, missing: 0, noInfobox: 0, redirectSkipped: 0, fxSkipped: 0, written: 0, results: 0, awards: 0, deleted: 0, review: 0, writeErrors: 0, stopped: null };

  let tours = [], withResults = new Set();
  if (canRead) ({ tours, withResults } = await loadStoredState(db));
  let targets;
  if (o.pages) {
    const want = new Set(o.pages.split(',').map(p => normalizePage(p.trim())).filter(Boolean));
    targets = canRead
      ? tours.filter(t => want.has(normalizePage(t.liquipedia_page)))
      : [...want].map(p => ({ id: pageToSlug(p), liquipedia_page: p, start_date: null, end_date: null }));
    if (targets.length < want.size) console.warn(`  [repair] ${want.size - targets.length} der --pages nicht in der Datenbank — Reparatur legt keine Turniere an`);
  } else {
    targets = repairTargets(tours, withResults, today);
  }
  console.log(`[repair] ${targets.length} vergangene Turniere ohne Ergebniszeilen${o.limit > 0 && targets.length > o.limit ? ` (davon ${o.limit} in diesem Lauf)` : ''}`);
  if (o.limit > 0) targets = targets.slice(0, o.limit);
  if (!targets.length) return st;

  const pageIdx = canRead ? await loadPageIndex(db) : new Map();
  const knownIds = new Set(tours.map(t => t.id));
  const titles = targets.map(t => t.liquipedia_page);
  const groups = Math.ceil(new Set(titles).size / 50);
  let batch;
  try {
    batch = await withTimeout(fetchWikitextBatch(titles), STEP_TIMEOUT_MS * groups, `Stapel ${titles.length} Seiten`);
  } catch (e) {
    const why = stopReason(e);
    if (why) { st.stopped = why; console.error(`  [abbruch] Stapelabruf: ${e.message}`); return st; }
    throw e;
  }
  for (const m of batch.missing) console.warn(`  [fehlt] ${m}`);

  let n = 0;
  for (const t of targets) {
    n++;
    st.attempted++;
    const got = batch.byRequested.get(t.liquipedia_page);
    if (!got) { st.missing++; continue; }
    const finalTitle = got.title.replace(/ /g, '_');
    const finalSlug = pageToSlug(finalTitle);
    if (finalSlug !== t.id && knownIds.has(finalSlug)) {
      st.redirectSkipped++;
      console.log(`  [weiterleitung] ${t.liquipedia_page} → ${finalTitle}: Ziel ist schon ein eigenes Turnier, uebersprungen`);
      continue;
    }

    let results, awards, numParticipants, ex;
    try {
      const wikitext = got.content || '';
      const fields = parseInfobox(wikitext);
      if (!fields) st.noInfobox++;
      const f = fields || {};
      const startDate = parseDate(f.sdate || f.startdate || f.date) || t.start_date || null;
      const endDate = parseDate(f.edate || f.enddate || f.date) || t.end_date || null;
      ex = await extractWithFallback(got.title, wikitext);
      numParticipants = participantsFromInfobox(f) || entrantsFromRows(ex.rows) || countParticipants(wikitext);
      const price = await priceContext(t.liquipedia_page, wikitext, f, startDate, endDate);
      if (price.fxSkipped) st.fxSkipped++;
      results = toResultRows(t.id, ex.rows, price.convertLocal, pageIdx);
      awards = await placeAwardsSafe(toAwardRows(t.id, awardsOf(wikitext).rows, price.convertLocal, pageIdx, ex.rows), ex.rows);
    } catch (e) {
      const why = stopReason(e);
      if (why) { st.stopped = why; console.error(`  [abbruch] ${t.liquipedia_page}: ${e.message}`); break; }
      console.warn(`  [skip] ${t.liquipedia_page}: ${e.message}`); st.failed++; continue;
    }

    try {
      // Nur Ergebniszeilen, Boni + Teilnehmerzahl; Kopfdaten und standings_sources
      // bleiben, geloescht wird nichts.
      await writeResults(db, results);
      await writeAwards(db, awards);
      if (numParticipants != null) await db.patch('tft_tournaments', `id=eq.${encodeURIComponent(t.id)}`, { num_participants: numParticipants });
      st.written++;
      st.results += results.length;
      st.awards += awards.length;
    } catch (e) {
      st.failed++; st.writeErrors++;
      console.warn(`  [write-fail] ${t.liquipedia_page}: ${e.message}`);
      if (st.writeErrors > MAX_WRITE_ERRORS) { st.stopped = 'Schreibfehler'; console.error(`  [abbruch] mehr als ${MAX_WRITE_ERRORS} Schreibfehler`); break; }
      continue;
    }
    console.log(`  ${n}/${targets.length}  ${t.id}  placements=${results.length}${awards.length ? `  boni=${awards.length}` : ''}  participants=${numParticipants ?? '—'}${ex.intact ? '' : '  (nicht heil)'}`);
  }
  console.log(`\n  [repair] ${st.written} Turniere, ${st.results} Zeilen, ${st.awards} Boni | fehlt: ${st.missing}, ohne Infobox: ${st.noInfobox}, Weiterleitung: ${st.redirectSkipped}, fx-skip: ${st.fxSkipped}, Fehler: ${st.failed}/${st.attempted}`);
  return st;
}

// ─────────────────────────────────────────────────────────────────────────────
// main

async function main(argv = process.argv.slice(2)) {
  const t0 = Date.now();
  const o = parseCli(argv);
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bwawxwgxxfafbruebixa.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!o.dry && !key) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); return 1; }
  if (o.repair && !key && !o.pages) { console.error('--repair liest seine Ziele aus der Datenbank: SUPABASE_SERVICE_ROLE_KEY noetig'); return 1; }
  const db = makeDb({ url, key, dry: o.dry });
  // Lesen geht auch im Trockenlauf, sobald ein Schluessel da ist.
  const ctx = { t0, url, key, dry: o.dry, db, canRead: !!key };

  console.log(`=== TFT Tournament Crawler${o.repair ? ' (repair)' : ''}${o.dry ? ' — Trockenlauf' : ''} ===\n`);
  if (o.postOnly) { await postPasses(ctx); return 0; }

  const cd = cooldownStatus();
  if (cd.active) {
    console.error(`Liquipedia-Sperre aktiv bis ${new Date(cd.until).toISOString()} (noch ${cd.minutesRemaining} min) — Abbruch`);
    return 1;
  }

  let st;
  try {
    st = o.repair ? await runRepair(o, ctx) : await runCrawl(o, ctx);
  } catch (e) {
    const why = stopReason(e);
    if (!why) throw e;
    console.error(`  [abbruch] ${e.message}`);
    st = { attempted: 0, failed: 0, stopped: why };
  }

  let postFailed = false;
  if (st.stopped === 'Schreibfehler' || st.stopped === 'Zeitlimit') {
    console.log('  [post] uebersprungen nach Abbruch');
  } else {
    try { await postPasses(ctx); }
    catch (e) { postFailed = true; console.error(`  [post-fail] ${e.message}`); }
  }

  const failRate = st.attempted > 0 ? st.failed / st.attempted : 0;
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  let code = 0;
  const why = [];
  if (st.stopped === 'Sperre' || st.stopped === 'Zeitlimit' || st.stopped === 'Schreibfehler') { code = 1; why.push(`Abbruch: ${st.stopped}`); }
  if (failRate > MAX_FAIL_RATE) { code = 1; why.push(`${st.failed}/${st.attempted} Seiten fehlgeschlagen (> ${MAX_FAIL_RATE * 100} %)`); }
  if (postFailed) { code = 1; why.push('Nachlauf fehlgeschlagen'); }
  if (st.stopped === 'Frist') why.push('Frist erreicht (kein Fehler)');
  console.log(`\nDone in ${secs}s — Exit ${code}${why.length ? ` (${why.join('; ')})` : ''}`);
  return code;
}

// Import-Schutz: Tests importieren die reinen Helfer, ohne den Lauf zu starten.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(code => process.exit(code ?? 0)).catch(err => {
    if (err instanceof LiquipediaCooldownError) console.error(`Liquipedia-Sperre: ${err.message}`);
    console.error('FAIL:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}
