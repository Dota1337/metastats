#!/usr/bin/env node
/**
 * Enriches Liquipedia-sourced TFT pros with:
 *   Phase 1 — tournament history + total earnings (from Liquipedia rendered HTML)
 *   Phase 2 — profile image URL (from Liquipedia infobox)
 *
 * Why HTML instead of Cargo:
 *   Liquipedia's TFT wiki has `action=cargoquery` and `Special:CargoExport`
 *   disabled (returns 404/badvalue). The rendered HTML, however, contains
 *   the same data that Cargo would produce — it's generated server-side from
 *   the `{{Achievements/...}}` templates which read Cargo internally.
 *
 *   Trade-off: HTML is more brittle than Cargo. We tolerate minor format
 *   drift by parsing best-effort and leaving the player's data empty (rather
 *   than crashing) when the page deviates from the expected structure.
 *
 * Usage:
 *   node scripts/enrich-tft-pro-history.mjs                # stale pros only
 *   node scripts/enrich-tft-pro-history.mjs --force        # ignore staleness
 *   node scripts/enrich-tft-pro-history.mjs --max 100      # cap this run
 *   node scripts/enrich-tft-pro-history.mjs --limit 10     # smoke test
 *   node scripts/enrich-tft-pro-history.mjs --no-supabase  # dry-run, prints results
 *   node scripts/enrich-tft-pro-history.mjs --player Setsuko  # single player
 *
 * Liquipedia ToU: 2s minimum between requests; we honor strictly.
 *
 * Warum es eine Staleness-Auswahl gibt: der Lauf holte frueher IMMER alle
 * Rows. Bei inzwischen ~627 Liquipedia-Pros à 2 Seiten sind das 45-90 Minuten
 * — zu lang fuer das 60-Minuten-Limit eines GitHub-Actions-Jobs, und der
 * Grossteil davon holt Historien, die sich seit Monaten nicht bewegt haben.
 * selectProsToEnrich() zieht deshalb nur, was wirklich veraltet ist, immer
 * aelteste zuerst. Der --max-Deckel macht die Laufzeit planbar, ohne dass
 * jemand verhungert: wer diesmal nicht drankommt, rutscht naechste Woche
 * automatisch nach vorn.
 *
 * Prerequisite: supabase/migrations/0015_tft_pro_player_history.sql applied.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const hasFlag = (k) => args.includes(k);

const LIMIT = parseInt(arg('--limit', '0'), 10);
const SINGLE_PLAYER = arg('--player', null);
const SKIP_SUPABASE = hasFlag('--no-supabase');
const VERBOSE = hasFlag('--verbose');
const FORCE = hasFlag('--force');
const MAX_PER_RUN = Math.max(1, parseInt(arg('--max', '250'), 10));
// Wie viele davon zusaetzlich die /Results-Unterseite bekommen. Jeder kostet
// 30 Sekunden extra (action=parse-Limit), deshalb bewusst klein.
const DEEP_MAX_PER_RUN = Math.max(0, parseInt(arg('--deep-max', '10'), 10));

// Staleness-Fenster. Wer aktiv Wettkaempfe spielt, aendert seine Historie
// woechentlich; wer seit ueber einem Jahr kein Turnier hatte, praktisch nie.
const FRESH_WINDOW_ACTIVE_MS = 7 * 24 * 60 * 60 * 1000;
const FRESH_WINDOW_DORMANT_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIVE_TOURNAMENT_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

const LIQUIPEDIA_API = 'https://liquipedia.net/teamfighttactics/api.php';
const LIQUIPEDIA_BASE = 'https://liquipedia.net';
const LIQUIPEDIA_DELAY_MS = 2100;
const USER_AGENT = 'metastats-bot/1.0 (https://metastats.gg; info@metastats.gg)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── env ─────────────────────────────────────────────────────────────────
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
loadEnv();

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bwawxwgxxfafbruebixa.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SKIP_SUPABASE && !SUPA_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

// ─── Liquipedia ──────────────────────────────────────────────────────────
// Shared helper: cross-process rate-limit lock + ETag cache (see
// scripts/lib/liquipedia-tft.mjs).
import { liquipediaHtml } from './lib/liquipedia-tft.mjs';
import { proRowFilter } from './lib/pro-row-filter.mjs';

async function fetchRenderedHtml(title) {
  return liquipediaHtml(title);
}

// Liquipedia stores per-player tournament tables on a dedicated `/Results`
// subpage (e.g. `Setsuko/Results`). The main page only carries an empty
// `Achievements` heading with a link to the subpage. Returns '' on 404 (the
// shared helper resolves 404s to null which we coerce to '').
async function fetchResultsSubpage(title) {
  try {
    return (await liquipediaHtml(`${title}/Results`)) || '';
  } catch {
    return '';
  }
}

// ─── HTML parsing ────────────────────────────────────────────────────────

const stripTags = (s) =>
  String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8211;/g, '–')
    .replace(/&#039;/g, "'")
    .trim();

function absoluteUrl(href) {
  if (!href) return null;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('/')) return LIQUIPEDIA_BASE + href;
  if (/^https?:\/\//.test(href)) return href;
  return null;
}

// Pulls the player image from the infobox header at the top of the page.
function extractImageUrl(html) {
  const m = html.match(/<div[^>]*class="[^"]*infobox-image[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i);
  if (m) return absoluteUrl(m[1]);
  const m2 = html.match(/<table[^>]*class="[^"]*infobox[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i);
  if (m2) return absoluteUrl(m2[1]);
  return null;
}

// Current team from the rendered infobox "Team:" row. Team membership is NOT in
// the wikitext (pages carry `|history={{THA}}` which expands server-side from
// LPDB), so the rendered HTML — already fetched for the image — is the only
// reliable source (W3, 2026-07-04). An absent row means teamless, which is the
// norm for TFT pros → null is the authoritative answer, not a parse failure.
function extractTeam(html) {
  const m = html.match(/infobox-description">\s*Team:\s*<\/div>\s*<div[^>]*>([\s\S]{0,300}?)<\/div>/i);
  if (!m) return null;
  const name = stripTags(m[1]).trim();
  return name || null;
}

// Gesamtpreisgeld aus der Infobox-Zeile "Approx. Total Winnings:".
//
// Warum das jetzt gebraucht wird: die Summe kam frueher aus den Eintraegen der
// /Results-Unterseite. Die holen wir nur noch in langsamer Rotation (Liquipedia
// erlaubt 1 parse-Request / 30 s), und die Hauptseite listet nur die besten
// Platzierungen — bei Setsuko 11 statt 55. Wuerden wir weiter summieren, faellt
// das Preisgeld beim flachen Lauf auf einen Bruchteil.
//
// Liquipedias eigener Aggregatwert ist ohnehin die bessere Quelle: er ist
// vollstaendig und genau der Wert, gegen den crawl-tft-pro-portal-stats
// gegenprueft.
//
// Rueckgabe null heisst "nicht gefunden" und darf NICHT als 0 geschrieben
// werden — sonst loeschen wir bei einer Markup-Aenderung stillschweigend alle
// Preisgelder.
export function extractTotalWinnings(html) {
  const m = html.match(/infobox-description">\s*Approx\.?\s*Total\s+Winnings:\s*<\/div>\s*<div[^>]*>([\s\S]{0,200}?)<\/div>/i);
  if (!m) return null;
  const txt = stripTags(m[1]).trim();
  // Format ist "$102,158" — Tausendertrenner raus, alles andere verwerfen.
  const digits = txt.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

// Splits the rendered HTML at heading anchors and returns the segment
// belonging to one heading (until the next <h1..h6>). Liquipedia uses
// `<h2 id="Achievements">` directly (no `mw-headline` span like Leaguepedia).
function sliceSection(html, headlineIds) {
  const startRe = new RegExp(
    `<h[1-6][^>]*id="(${headlineIds.join('|')})"`,
    'i'
  );
  const start = html.match(startRe);
  if (!start) return null;
  const from = start.index + start[0].length;
  const after = html.slice(from);
  const endMatch = after.match(/<h[1-6][^>]*>/);
  return endMatch ? after.slice(0, endMatch.index) : after;
}

// Parses a Liquipedia achievements table. Liquipedia's CSS class is
// `table2__table` (with an internal style sheet); older mirror pages use
// `wikitable`. Column layout varies across eras, so we detect each cell's
// role by content (date regex, currency, placement).
function parseAchievementsTable(sectionHtml) {
  if (!sectionHtml) return [];
  const tableMatch =
    sectionHtml.match(/<table[^>]*class="[^"]*table2[_a-z]*[^"]*"[\s\S]*?<\/table>/i) ||
    sectionHtml.match(/<table[^>]*class="[^"]*wikitable[^"]*"[\s\S]*?<\/table>/i) ||
    sectionHtml.match(/<table[^>]*class="[^"]*sortable[^"]*"[\s\S]*?<\/table>/i);
  if (!tableMatch) return [];
  const tableHtml = tableMatch[0];
  const rows = [];
  const rowRe = /<tr[\s\S]*?<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
    const rowHtml = rowMatch[0];
    if (/<th[^>]*>/i.test(rowHtml) && !/<td[^>]*>/i.test(rowHtml)) continue;
    const cells = [];
    const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1]);
    }
    if (cells.length < 3) continue;

    let date = null, place = null, tournament = null, prize = 0, tier = null, tournamentPage = null;
    for (const cellHtml of cells) {
      const text = stripTags(cellHtml);
      if (!text) continue;
      if (!date) {
        const d = text.match(/(\d{4}-\d{2}-\d{2}|\d{4}-\d{2})/);
        if (d) { date = d[1]; continue; }
      }
      if (!prize) {
        const p = text.match(/\$\s?([0-9.,]+)\s?([KkMm])?/);
        if (p) {
          let n = parseFloat(p[1].replace(/,/g, ''));
          if (!isNaN(n)) {
            if (/[Kk]/.test(p[2] || '')) n *= 1000;
            if (/[Mm]/.test(p[2] || '')) n *= 1_000_000;
            prize = Math.round(n);
            continue;
          }
        }
      }
      if (!place) {
        const pm = text.match(/^(1st|2nd|3rd|\d+(?:th|nd|rd|st)?(?:[\s\-–]+\d+(?:th|nd|rd|st)?)?|Top\s+\d+|DQ|—|-)$/i);
        if (pm) { place = pm[1]; continue; }
      }
      if (!tier) {
        const tm = text.match(/^(S-Tier|A-Tier|B-Tier|C-Tier|Premier|Major|Minor|Qualifier|Monthly|Weekly|Showmatch)$/i);
        if (tm) { tier = tm[1]; continue; }
      }
      if (!tournament) {
        const aMatch = cellHtml.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (aMatch) {
          tournament = stripTags(aMatch[2]);
          tournamentPage = absoluteUrl(aMatch[1]);
          continue;
        }
      }
    }
    if (!tournament) {
      const candidates = cells
        .map(stripTags)
        .filter((t) => t && !/^\d{4}/.test(t) && !t.includes('$'));
      candidates.sort((a, b) => b.length - a.length);
      tournament = candidates[0] || null;
    }
    if (!tournament || !date) continue;
    rows.push({ tournament, date, place: place || null, prize_usd: prize, tier, page: tournamentPage });
  }
  return rows;
}

function extractResults(html) {
  // On the /Results subpage, the table lives directly under the page body
  // and may not be inside a named section. Try sectioned extraction first,
  // then fall back to parsing the first table on the whole page.
  const section = sliceSection(html, [
    'Results',
    'Achievements',
    'Achievements_.26_Results', // & gets encoded in heading IDs
    'Tournament_Results',
  ]);
  const sectioned = parseAchievementsTable(section);
  if (sectioned.length > 0) return sectioned;
  return parseAchievementsTable(html);
}

// ─── Supabase ────────────────────────────────────────────────────────────

/**
 * Waehlt aus, welche Pros dieser Lauf anfasst.
 *
 * Reine Funktion (keine Zeit-, Netz- oder DB-Zugriffe ausser den Parametern),
 * damit sie testbar bleibt — siehe scripts/test-enrich-selection.mjs.
 *
 * Regeln, absteigend nach Prioritaet:
 *   1. Noch nie angereichert (last_enriched_at IS NULL) → immer. Das sind neue
 *      Rows aus dem Crawler, die ohne Historie sonst als "inactive" gelten.
 *   2. Aktiv (tpc_verified ODER Turnier innerhalb 365 Tagen) → nach 7 Tagen.
 *   3. Ruhend → nach 30 Tagen.
 *
 * Sortierung ist immer "aelteste zuerst" (NULL ganz vorn). Zusammen mit dem
 * Deckel ergibt das ein Round-Robin: niemand verhungert dauerhaft, weil jeder
 * uebersprungene Pro mit jeder Woche weiter nach vorn rutscht.
 *
 * Bewusst NICHT server-seitig gefiltert: die OR-Verschachtelung waere in
 * PostgREST schwer lesbar, und 627 Zeilen mit vier Feldern sind ein einziger
 * billiger Request. Die Regel gehoert dorthin, wo man sie testen kann.
 */
export function selectProsToEnrich(rows, { now = Date.now(), maxCount = Infinity, force = false } = {}) {
  const withPage = rows.filter((p) => p.source_page);

  const isStale = (p) => {
    if (force) return true;
    if (!p.last_enriched_at) return true;
    const enrichedAt = Date.parse(p.last_enriched_at);
    // Unparsebarer Zeitstempel: lieber neu holen als still ueberspringen.
    if (Number.isNaN(enrichedAt)) return true;
    const age = now - enrichedAt;
    const lastTournament = p.last_tournament_at ? Date.parse(p.last_tournament_at) : NaN;
    const competesRecently = !Number.isNaN(lastTournament)
      && (now - lastTournament) <= ACTIVE_TOURNAMENT_WINDOW_MS;
    const active = p.tpc_verified === true || competesRecently;
    return age >= (active ? FRESH_WINDOW_ACTIVE_MS : FRESH_WINDOW_DORMANT_MS);
  };

  const stale = withPage.filter(isStale);

  stale.sort((a, b) => {
    const ta = a.last_enriched_at ? Date.parse(a.last_enriched_at) : -Infinity;
    const tb = b.last_enriched_at ? Date.parse(b.last_enriched_at) : -Infinity;
    if (ta !== tb) return ta - tb;
    // Stabiler Tie-Break, damit zwei Laeufe mit identischen Zeitstempeln nicht
    // in zufaellig unterschiedlicher Reihenfolge kappen.
    return String(a.pro_name || '').localeCompare(String(b.pro_name || ''));
  });

  return {
    selected: stale.slice(0, maxCount),
    totalWithPage: withPage.length,
    staleCount: stale.length,
    deferred: Math.max(0, stale.length - maxCount),
  };
}

/**
 * Bestimmt, wer in diesem Lauf zusaetzlich die /Results-Unterseite bekommt.
 *
 * Reine Funktion, testbar. Auswahl unter den ohnehin schon selektierten
 * Spielern, aelteste Historie zuerst (NULL = nie geholt ganz vorn). Der eigene
 * Deckel ist noetig, weil jeder tiefe Spieler den Lauf um 30 Sekunden
 * verlaengert — Liquipedia erlaubt nur 1 parse-Request alle 30 s.
 *
 * Gibt ein Set von source_page zurueck.
 */
export function markDeepTargets(pros, { maxDeep = 10, force = false, now = Date.now() } = {}) {
  if (force) return new Set(pros.map((p) => p.source_page).filter(Boolean));

  const sorted = pros
    .filter((p) => p.source_page)
    .slice()
    .sort((a, b) => {
      const ta = a.last_history_enriched_at ? Date.parse(a.last_history_enriched_at) : -Infinity;
      const tb = b.last_history_enriched_at ? Date.parse(b.last_history_enriched_at) : -Infinity;
      if (ta !== tb) return ta - tb;
      return String(a.pro_name || '').localeCompare(String(b.pro_name || ''));
    });

  return new Set(sorted.slice(0, maxDeep).map((p) => p.source_page));
}

async function loadPros() {
  const url = `${SUPA_URL}/rest/v1/tft_pro_players?source=eq.liquipedia&select=id,puuid,pro_name,source_page,last_enriched_at,last_history_enriched_at,last_tournament_at,tpc_verified&order=pro_name.asc`;
  const res = await fetch(url, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase load failed: HTTP ${res.status}`);
  return res.json();
}

async function updatePro(pro, patch) {
  // id-keyed (CN wave): puuid=eq.null would be a silent 200/0-rows no-op for
  // puuid-less CN rows — see scripts/lib/pro-row-filter.mjs.
  const url = `${SUPA_URL}/rest/v1/tft_pro_players?${proRowFilter(pro)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase update failed for ${pro.pro_name}: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
}

// ─── main ────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now();
  console.log('=== TFT Pro Player History Enrichment ===\n');

  let pros;
  // source_page der Spieler, die in diesem Lauf die volle Historie bekommen.
  let deepPages = new Set();
  if (SINGLE_PLAYER) {
    pros = [{ puuid: 'DRY-RUN', pro_name: SINGLE_PLAYER, source_page: SINGLE_PLAYER }];
    // Beim Einzelabruf will man die vollen Daten sehen, nicht den flachen Lauf.
    deepPages = new Set([SINGLE_PLAYER]);
  } else if (SKIP_SUPABASE) {
    console.error('Either --player <Name> or Supabase access is required.');
    process.exit(1);
  } else {
    const all = await loadPros();
    const pick = selectProsToEnrich(all, { maxCount: MAX_PER_RUN, force: FORCE });
    pros = pick.selected;
    // Tiefe Rotation: die Ausgewaehlten mit der aeltesten Historie bekommen
    // zusaetzlich die /Results-Unterseite. Jeder tiefe Spieler kostet 30s
    // extra, deshalb ein eigener, kleiner Deckel.
    deepPages = markDeepTargets(pros, { maxDeep: DEEP_MAX_PER_RUN, force: FORCE });
    console.log(
      `${all.length} liquipedia rows, ${pick.totalWithPage} with source_page, `
      + `${pick.staleCount} stale${FORCE ? ' (--force: alle)' : ''} → ${pros.length} in diesem Lauf`
      + (pick.deferred > 0 ? `, ${pick.deferred} auf naechsten Lauf verschoben (--max ${MAX_PER_RUN})` : ''),
    );
    console.log(`   davon ${deepPages.size} mit voller Turnier-Historie (--deep-max ${DEEP_MAX_PER_RUN})`);
  }
  if (LIMIT > 0) pros = pros.slice(0, LIMIT);
  pros = pros.filter((p) => p.source_page);
  console.log(`${pros.length} pros with source_page to process\n`);

  let tournamentsTotal = 0;
  let imagesFilled = 0;
  let errors = 0;
  let deepDone = 0;
  let missingWinnings = 0;

  for (let i = 0; i < pros.length; i++) {
    const pro = pros[i];
    try {
      // The shared helper enforces the global rate-limit gate around each
      // call, so manual sleeps here would just compound the wait.
      const deep = deepPages.has(pro.source_page);
      const html = await fetchRenderedHtml(pro.source_page);
      const image_url = extractImageUrl(html);
      const team = extractTeam(html);
      // Liquipedias eigener Aggregatwert aus der Infobox. Beim flachen Lauf ist
      // er die EINZIGE korrekte Quelle: die Hauptseite listet nur die besten
      // Platzierungen, eine Summe daraus waere ein Bruchteil des echten Werts.
      const infoboxWinnings = extractTotalWinnings(html);

      let tournament_results = null;
      if (deep) {
        const resultsHtml = await fetchResultsSubpage(pro.source_page);
        tournament_results = extractResults(resultsHtml || html);
        deepDone++;
      }

      // Infobox gewinnt, weil vollstaendig. Nur wenn sie fehlt (Markup-Aenderung)
      // und wir gerade die volle Historie geholt haben, summieren wir ersatzweise.
      const summed = tournament_results
        ? tournament_results.reduce((s, r) => s + (r.prize_usd || 0), 0)
        : null;
      const total_earnings_usd = infoboxWinnings ?? summed;
      if (infoboxWinnings === null) missingWinnings++;

      if (VERBOSE || SKIP_SUPABASE) {
        console.log(`${pro.pro_name} (${pro.source_page})${deep ? ' [tief]' : ''}: ${tournament_results ? tournament_results.length + ' results' : 'Historie unveraendert'}, $${total_earnings_usd ?? '—'}, team=${team ?? '—'}, image=${image_url ? 'yes' : 'no'}`);
        if (tournament_results?.length > 0) {
          console.log('  sample:', tournament_results.slice(0, 3));
        }
      }

      if (!SKIP_SUPABASE) {
        const now = new Date().toISOString();
        const patch = {
          image_url,
          // Authoritative (see extractTeam): null = genuinely teamless, and it
          // heals stale rosters that a previous run wrote.
          team,
          // Nur im Erfolgsfall — ein fehlgeschlagener Pro muss beim naechsten
          // Lauf wieder vorne stehen, nicht 7 Tage als "frisch" gelten.
          last_enriched_at: now,
        };
        // WICHTIG: tournament_results nur schreiben, wenn wir die Unterseite
        // wirklich geholt haben. Sonst wuerde der flache Lauf die volle
        // Historie mit dem Teilstand der Hauptseite ueberschreiben — bei
        // Setsuko 11 statt 55 Eintraegen.
        if (tournament_results !== null) {
          patch.tournament_results = tournament_results;
          patch.last_history_enriched_at = now;
        }
        // null hiesse "nicht gefunden". Das darf die vorhandene Summe nicht
        // loeschen — siehe extractTotalWinnings.
        if (total_earnings_usd !== null && total_earnings_usd !== undefined) {
          patch.total_earnings_usd = total_earnings_usd;
        }
        await updatePro(pro, patch);
      }

      tournamentsTotal += tournament_results?.length ?? 0;
      if (image_url) imagesFilled++;
    } catch (e) {
      errors++;
      // Always loud: the silent variant hid whatever aborted the historical
      // full run after pro #7 — 0/259 enriched went unnoticed for weeks.
      console.warn(`  [skip] ${pro.pro_name}: ${e.message}`);
    }

    if ((i + 1) % 25 === 0 || i === pros.length - 1) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`  ${i + 1}/${pros.length}  tournaments=${tournamentsTotal} images=${imagesFilled} errors=${errors}  ${elapsed}s`);
    }
  }

  console.log(`\nDone. Processed ${pros.length} pros (${deepDone} mit voller Historie): ${tournamentsTotal} tournament rows, ${imagesFilled} images, ${errors} errors.`);
  if (missingWinnings > 0) {
    // Laut heisst hier: wenn Liquipedia die Infobox-Zeile umbenennt, faellt es
    // sofort auf, statt dass die Preisgelder stillschweigend einfrieren.
    console.warn(`WARNUNG: bei ${missingWinnings}/${pros.length} Spielern war keine "Approx. Total Winnings"-Zeile lesbar — Preisgeld unveraendert gelassen.`);
  }
}

// Nur ausfuehren, wenn direkt aufgerufen — sonst startet ein Import von
// selectProsToEnrich() (Test!) den kompletten Liquipedia-Lauf.
const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => { console.error('FAIL:', err.message); console.error(err.stack); process.exit(1); });
}
