#!/usr/bin/env node
/**
 * Daily Marktwert-Snapshot-Lauf — Lib-basierter Daily-Driver für Phase A4.
 *
 * Ersetzt langfristig den alten Cold-Sweep-Crawler (`collect-tft-marketvalues
 * .mjs` via `crawl-all-regions.mjs`) für den TÄGLICHEN Refresh-Pfad. Der alte
 * Crawler bleibt als wöchentlicher Discovery-Lauf (Aufsteiger-Erkennung,
 * Sonntags).
 *
 * Iterations-Quelle (Option Z aus Multi-Review-Verdict 2026-06-19):
 *   • tft_player_marketvalue_snapshots WHERE tier IN (D2+)
 *                                        AND created_at älter als MIN_REFRESH_HOURS
 *                                        AND region = X
 * Das ist die D2+-Kohorte deren Marktwert überfällig ist. Aufsteiger werden vom
 * wöchentlichen Discovery-Lauf abgefangen.
 *
 * RUNDLAUF STATT TAGESRASTER (2026-08-04)
 * ---------------------------------------
 * Bis dahin war der Lauf an den UTC-Kalendertag gebunden: Iterations-Kriterium
 * `snapshot_date < current_date`, Cursor mit Tagesstempel, Inflight-Cleanup
 * `day < today`. Das hatte drei Folgen, die sich gegenseitig verstärkten:
 *
 *   1. Der nächtliche SIGTERM (Conflicts=metastats-daily-crawl) brach Pass 1 ab.
 *      Der nächste Lauf löschte die Gather-Arbeit als "von gestern" — die Region
 *      begann wieder bei Spieler 1 und kam nie durch. Die Log-Zeile "nächster
 *      Lauf setzt fort" war schlicht unwahr.
 *   2. Je länger eine Region zurücklag, desto teurer wurde jeder ihrer Spieler
 *      (maxIdsForPlayer skaliert mit dem Rückstand, 25 IDs/Tag bis 200). Rückstand
 *      war damit selbstverstärkend: 0,2 s/Spieler frisch gegen 4,2 s/Spieler kalt.
 *   3. Ein zweiter Durchlauf am selben Tag fand grundsätzlich nichts zu tun.
 *
 * Jetzt: kein Kalendertag mehr im Steuerpfad. Fällig ist, wer länger als
 * MIN_REFRESH_HOURS keinen Schreibvorgang gesehen hat; Regionen laufen nach
 * Rückstand sortiert im Rundlauf, bis nichts mehr fällig ist. Die Gather-Arbeit
 * überlebt die Nacht (Inflight verfällt nach Alter, nicht nach Datum), also ist
 * der zweite Anlauf einer großen Region fast gratis.
 *
 * Der Prozess läuft dabei NICHT rund um die Uhr: er endet, wenn nichts fällig
 * ist. Das ist Absicht — remote-deploy.sh fällt bei laufendem Service auf
 * Code-only-Sync zurück (kein npm ci, kein Timer-Re-Arm), und assertContracts
 * läuft erst am Ende von main(). Ein Dauerprozess würde beides aushebeln.
 *
 * Pro Spieler:
 *   1. refreshPlayerMatchCache mit startTime = last_snapshot_date - 1h
 *      → fetcht nur NEUE Matches statt voller 200-id-Diff. Memory:
 *        reference_riot_production_key + Multi-Review-Verdict.
 *   2. gatherPlayer (Lib) extrahiert Raw-Metriken.
 *   3. Pop-Recompute aus aktiven Spielern der Region.
 *   4. snapshotPlayer (Lib) schreibt Snapshot mit aktualisiertem Multiplier.
 *
 * me1-Sonderfall: Population n=68 ist statistisch nicht valide für z-Scores.
 * Bypass: synthetic-null-pop → multiplier=1.0 (pure Base-Value). Memory:
 * Multi-Review-Verdict Data-Skeptic 2026-06-19.
 *
 * Backup-Pattern für Rollback: vor jedem scharfen Lauf wird die heutige
 * Region-Slice als `tft_pmvs_backup_YYYYMMDD_<region>` archiviert. Bei
 * Fehler: TRUNCATE heutige Region-Rows + Restore aus Backup. Tabelle wird
 * nach 7 Tagen automatisch durch pg_prune-Cron entfernt.
 *
 * Usage:
 *   node scripts/daily-marketvalue-snapshot.mjs --region euw1
 *   node scripts/daily-marketvalue-snapshot.mjs --region euw1 --dry-run
 *   node scripts/daily-marketvalue-snapshot.mjs --region all
 *   node scripts/daily-marketvalue-snapshot.mjs --region euw1 --max-ids 100  # Patch-Day-Override
 *
 * Flags:
 *   --region <name|all>       Region (oder 'all' für alle 15 aktiven)
 *   --dry-run                 Keine Riot-Calls, kein Schreiben. Estimate aus DB-Reads.
 *   --max-ids <N>             Cap für startTime-bounded Match-ID-Pull (Default 30, Patch-Day 100)
 *   --match-concurrency <N>   Match-Detail-Concurrency (Default 8, Env: MV_MATCH_CONCURRENCY)
 *   --limit <N>               Nur N Spieler pro Region (Smoke-Mode)
 *   --skip-backup             Backup-Table-Step skippen (für Tests)
 *   --min-refresh-hours <N>   Ab wann ein Spieler fällig ist (Default 20, Env: MV_REFRESH_MIN_HOURS)
 *   --max-cycles <N>          Sicherheitsdeckel für den Rundlauf (Default 20)
 *   --verbose
 */

import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { createRiotClient } from './lib/riot-client.mjs';
import { batchBudget, riotWindowFor } from './lib/riot-limits.mjs';
import { buildCompMeta, applyMeta, buildPopulation } from './lib/tft-skill-score.mjs';
import {
  buildHotCompKeys,
  buildRecommendedItems,
} from './lib/tft-season-aggregator.mjs';
import {
  getRegionalCluster,
  loadCurrentSet,
  loadGraph,
  gatherPlayer,
  persistPopulation,
  snapshotPlayer,
} from './lib/tft-marketvalue-pipeline.mjs';
import { ACTIVE_REGIONS } from './lib/active-regions.mjs';
import { fetchD2PlusEntries, splitByActivity } from './lib/tft-league-entries.mjs';
import { assertContracts } from './lib/contracts.mjs';

// Env MUSS vor den Konstanten geladen sein. Bis 2026-08-04 stand der Aufruf
// erst hinter dem Args-Block — Konstanten wie MV_MATCH_CONCURRENCY oder
// MV_SNAPSHOT_CURSOR lasen also ein noch leeres process.env und funktionierten
// nur über systemd `Environment=`, nie über `.env.local`. Lokal getestete
// Overrides waren damit wirkungslos, ohne dass es auffiel.
// (loadEnv ist eine Function-Declaration weiter unten und daher gehoisted.)
loadEnv();

// ─────────────────────────────────────────────────────────────────────────────
// Konstanten
// ─────────────────────────────────────────────────────────────────────────────

// ACTIVE_REGIONS = 15 Regionen (ph2/th2 raus seit 2026-06-19). me1 ist drin
// trotz n=68 Pop — kriegt synthetic-null-pop unten. Single-Source-of-Truth
// in scripts/lib/active-regions.mjs (synchron mit app/lib/active-regions.ts).

// Regions mit zu kleiner Pop für valide z-Score-Verteilung. Synthetic-null-pop
// → multiplier=1.0 (Base-Value only, signals=null).
const POP_BYPASS_REGIONS = new Set(['me1']);

const D2_TIERS = ['DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];

// Default-Caps für Daily-Lauf — bewusst klein, weil startTime den
// Match-ID-Range schon stark einschränkt. Patch-Day-Override via --max-ids 100.
const DEFAULT_MAX_IDS = 30;

// Match-Detail-Concurrency. Bis 2026-08-04: 4 — gemessen 9,4 s/Spieler und
// damit 8 Regionen mit 35-54 Tagen Rueckstand. Der Engpass war nie das
// Rate-Limit (0 abgefangene 429er im Lauf), sondern Concurrency x Latenz:
// 4 / 0,55 s = 7,3 req/s bei einem Budget von 14,3 req/s pro Route.
//
// 8 saettigt den Limiter (8 / 0,55 s = 14,5 req/s), mehr vergroessert nur den
// Radius eines 429-Sturms, ohne Durchsatz zu bringen. Override per Env fuer
// Notfall-Drosselung ohne Deploy (systemd Environment= ODER .env.local).
const DEFAULT_CONCURRENCY = parseInt(process.env.MV_MATCH_CONCURRENCY || '8', 10);

// Sicherheits-Overlap beim startTime-Filter — Match-V1 schneidet manchmal
// um Tagesgrenzen, 1h Puffer gegen Off-by-one-Verluste.
const START_TIME_OVERLAP_SEC = 60 * 60;

// Sub-Region-Resume Inflight-Tabelle (Migration 0046, 2026-06-25).
// Schwelle: nur Regionen mit >= 500 Spielern aktivieren Inflight (Region-
// Laufzeit ~10min als Mindest-ROI). Skip-Liste: me1 (n~90), br1/la1/la2
// (~1200 alle), oc1 (~900) — kleine Regionen sind atomar genug.
// (Multi-Review perf-critic F8: Schwelle player-count-basiert, nicht magic 100)
const INFLIGHT_MIN_PLAYERS = 500;

// Feature-Flag für Inflight-Resume. Default OFF für erste 2-3 Wochen Production
// (architect F5: Rollback in 60s ohne Code-Deploy via systemd Environment=).
// Driver schreibt Inflight wenn Flag=true, sonst Bypass komplett.
const USE_INFLIGHT_RESUME = (process.env.MV_USE_INFLIGHT_RESUME || 'false').toLowerCase() === 'true';

// Verfallszeit für Inflight-Rows. Ersetzt den früheren Tagesstempel-Cleanup:
// eine Region, die um 23:50 abbricht, muss ihre Gather-Arbeit am nächsten
// Nachmittag noch vorfinden. 48h deckt den ungünstigsten Fall (Abbruch kurz vor
// Mitternacht, nächster Start erst nach dem ~14h-Daily-Crawl) mit Reserve ab.
//
// Obergrenze ist keine Willkür: die Roh-Metriken sind ein Zeitpunkt-Freeze. Je
// älter sie beim Verrechnen sind, desto weiter driftet die Population von der
// Realität weg. Länger als der angestrebte Refresh-Rhythmus darf sie nicht sein.
const INFLIGHT_TTL_HOURS = 48;

// Ab wann ein Spieler wieder fällig ist. 20h statt 24h, damit ein Lauf, der
// gestern um 20:00 fertig wurde, heute um 16:00 wieder drankommt und nicht erst
// morgen — sonst würde sich der Rhythmus mit jedem Tag nach hinten schieben,
// bis er das 36h-Ziel reißt.
//
// Der Wert deckt zusätzlich die Tages-Granularität der Snapshot-Tabelle ab:
// der Primärschlüssel enthält snapshot_date (DATE), zwei Läufe am selben
// UTC-Tag würden dieselbe Zeile überschreiben statt Historie zu schreiben.
// Solange die Schwelle nahe 24h liegt, kann das nicht passieren. Wer sie
// deutlich senkt, braucht vorher einen Zeitstempel im Primärschlüssel.
const MIN_REFRESH_HOURS = parseFloat(process.env.MV_REFRESH_MIN_HOURS || '20');

// Legacy-Cursor. Der Tagesstempel-Cursor ist mit dem Rundlauf entfallen: er war
// die zweite, mit der DB konkurrierende Wahrheit darüber, was heute schon fertig
// ist — Watchdog (urteilt nach DB-Abdeckung) und Driver (urteilte nach File)
// liefen dadurch auseinander. Fälligkeit steht jetzt ausschließlich in der DB.
// Der Pfad bleibt nur, um ein zurückgelassenes File einmalig aufzuräumen.
const LEGACY_CURSOR_PATH = process.env.MV_SNAPSHOT_CURSOR
  || (existsSync('/etc/metastats-crawler')
      ? '/etc/metastats-crawler/marketvalue-snapshot-cursor.json'
      : resolve(process.cwd(), '.mv-snapshot-cursor.json'));

// ─────────────────────────────────────────────────────────────────────────────
// Args
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const arg = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
const hasFlag = (k) => args.includes(k);

const REGION_ARG = (arg('--region', 'all') || 'all').toLowerCase();
const DRY_RUN = hasFlag('--dry-run');
const MAX_IDS_EXPLICIT = process.argv.includes('--max-ids');
const MAX_IDS = parseInt(arg('--max-ids', String(DEFAULT_MAX_IDS)), 10);
const MATCH_CONCURRENCY = parseInt(arg('--match-concurrency', String(DEFAULT_CONCURRENCY)), 10);
const LIMIT = parseInt(arg('--limit', '0'), 10);
const SKIP_BACKUP = hasFlag('--skip-backup');
const RESET_CURSOR = hasFlag('--reset-cursor');
const VERBOSE = hasFlag('--verbose');
const REFRESH_HOURS = parseFloat(arg('--min-refresh-hours', String(MIN_REFRESH_HOURS)));
// Deckel gegen eine Endlosschleife, falls eine Region dauerhaft fällig bleibt
// (z.B. weil ihre Spieler reihenweise unter der 5-Match-Schwelle liegen und nie
// einen Snapshot bekommen). Ohne Deckel liefe der Rundlauf gegen dieselbe Region
// bis zum SIGTERM.
const MAX_CYCLES = parseInt(arg('--max-cycles', '20'), 10);

if (!Number.isFinite(MAX_IDS) || MAX_IDS < 1 || MAX_IDS > 1000) {
  console.error(`Invalid --max-ids ${MAX_IDS}, expected 1..1000`);
  process.exit(1);
}
if (!Number.isFinite(MATCH_CONCURRENCY) || MATCH_CONCURRENCY < 1 || MATCH_CONCURRENCY > 20) {
  console.error(`Invalid --match-concurrency ${MATCH_CONCURRENCY}, expected 1..20`);
  process.exit(1);
}
if (!Number.isFinite(REFRESH_HOURS) || REFRESH_HOURS < 1 || REFRESH_HOURS > 240) {
  console.error(`Invalid --min-refresh-hours ${REFRESH_HOURS}, expected 1..240`);
  process.exit(1);
}
if (!Number.isFinite(MAX_CYCLES) || MAX_CYCLES < 1 || MAX_CYCLES > 100) {
  console.error(`Invalid --max-cycles ${MAX_CYCLES}, expected 1..100`);
  process.exit(1);
}

// Rollback-Schalter: stellt die alte, statische ACTIVE_REGIONS-Reihenfolge her.
const STATIC_REGION_ORDER = args.includes('--static-region-order');

const REGIONS = REGION_ARG === 'all'
  ? [...ACTIVE_REGIONS]
  : [REGION_ARG];

for (const r of REGIONS) {
  if (!ACTIVE_REGIONS.includes(r)) {
    console.error(`Unknown or inactive region: ${r}`);
    console.error(`Active: ${ACTIVE_REGIONS.join(', ')}`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Region-Reihenfolge: am längsten nicht bearbeitet zuerst
//
// Bis 2026-08-03 lief der Driver stur die ACTIVE_REGIONS-Reihenfolge ab —
// euw1 (10.878 Spieler, der größte Brocken) also immer zuerst. Da ein
// Vollzyklus über alle 15 Regionen deutlich länger als einen Tag braucht und
// der Cursor jede Nacht zurückgesetzt wurde, kamen die hinteren Regionen nie
// an die Reihe: jp1, oc1, sg2, tw2 und vn2 standen am 03.08. auf Marktwerten
// vom 12.06. — 52 Tage alt, bei 20.399 betroffenen Spielern.
//
// Sortiert wird nach max(created_at), NICHT nach max(snapshot_date). Letzteres
// ist eine DATE-Spalte und kann 25h nicht von 47h unterscheiden — bei einem Ziel
// von "spätestens alle 36h" ist das zu grob, und bei Gleichstand entschied die
// Array-Reihenfolge, also wieder die feste Liste. created_at trägt seit
// 2026-08-04 den Zeitpunkt des letzten Schreibvorgangs (siehe snapshotPlayer).
//
// Das frühere Kriterium "heute schon angefangen zuerst" ist entfallen: es war
// über den Refresh-Button der API hijackbar (ein einzelner User-Klick schreibt
// eine Zeile mit heutigem Datum in eine beliebige Region) und wird nicht mehr
// gebraucht, seit angefangene Arbeit im Inflight-Puffer die Nacht überlebt.
//
// Das Fenster grenzt die Abfrage auf den Index ein; Regionen ohne Zeile darin
// gelten als maximal überfällig und kommen zuerst.
//
// Fällt die Abfrage aus, bleibt es bei der statischen Reihenfolge — eine
// kaputte Sortierung darf den Lauf nicht verhindern.
// ─────────────────────────────────────────────────────────────────────────────
const STALENESS_WINDOW_DAYS = 90;

async function orderByStaleness(regions) {
  if (regions.length <= 1 || STATIC_REGION_ORDER) return regions;
  try {
    const { rows } = await pool.query(`
      select region, max(created_at) as newest
        from tft_player_marketvalue_snapshots
       where region = any($1::text[])
         and snapshot_date >= current_date - $2::int
       group by region
    `, [regions, STALENESS_WINDOW_DAYS]);

    const newestOf = new Map(rows.map(r => [r.region, r.newest ? Date.parse(r.newest) : 0]));
    // 0 = nie bearbeitet (oder länger als das Fenster her) → ganz nach vorn.
    const ordered = [...regions].sort((a, b) => (newestOf.get(a) ?? 0) - (newestOf.get(b) ?? 0));

    const age = (r) => {
      const t = newestOf.get(r);
      if (!t) return '>90d';
      return `${((Date.now() - t) / 3_600_000).toFixed(0)}h`;
    };
    console.log(`    Reihenfolge nach Rückstand: ${ordered.map(r => `${r}(${age(r)})`).join(' ')}`);
    return ordered;
  } catch (err) {
    console.error(`    [warn] Staleness-Sortierung fehlgeschlagen (${err.message}) — statische Reihenfolge`);
    return regions;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Env-Loader (identisch zu collect-tft-marketvalues.mjs)
// ─────────────────────────────────────────────────────────────────────────────

function loadEnv() {
  const candidates = ['/etc/metastats-crawler/env', resolve(process.cwd(), '.env.local')];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.includes('=') || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
    break;
  }
}
// Aufruf steht bewusst ganz oben (siehe Kommentar dort), nicht hier.

const API_KEY = process.env.RIOT_API_KEY_TFT;
if (!API_KEY) { console.error('RIOT_API_KEY_TFT env var required'); process.exit(1); }

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL env var required'); process.exit(1); }

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || null;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || null;

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

// RIOT-BUDGET PRO REGIONAL-ROUTE (gemessen 2026-08-04, Header-Probe auf allen
// vier Routes mit demselben Key: asia stand bei 3096/600s, americas gleichzeitig
// bei 1/600s). Jede Route hat einen eigenen, unabhaengigen Bucket — das bis
// dahin angenommene globale Budget existiert nicht.
//
// Die Zahlen und ihre Herleitung stehen in scripts/lib/riot-limits.mjs — dort
// UND NUR DORT werden sie gepflegt. europe/americas liegen mit 103 unter dem
// frueheren globalen 130: dort war die Konfiguration uebersubskribiert, was die
// 39 abgefangenen 429er des Marktwert-Laufs erklaert. Der Durchsatzgewinn kommt
// aus asia/sea (148), wo 5 der 8 Rueckstandsregionen liegen.
//
// EIN Client PRO CLUSTER, nicht pro Region und nicht global.
//
// Global war falsch, weil ein gemeinsames Fenster drei Viertel des Budgets
// verschenkt. Pro Region waere ebenfalls falsch: fuenf Regionen teilen sich
// europe, vier sea. Ein Neubau an jeder Regionsgrenze wirft das gefuellte
// Fenster weg und feuert mit vollem Kontingent gegen einen Host, der eine
// Sekunde vorher saturiert war — deterministisch, nicht nur unwahrscheinlich.
const riotClients = new Map();
function riotForCluster(cluster) {
  let client = riotClients.get(cluster);
  if (!client) {
    // Long-Window ist ebenfalls per Route, vier unabhaengige Fenster sind also
    // korrekt und nicht additiv gegen 30000.
    client = createRiotClient(riotWindowFor('batch', cluster));
    riotClients.set(cluster, client);
  }
  return client;
}

// pg.Pool max=6 (Perf-Critic-Verdict: schont Refresh-API-Headroom während des
// langen Laufs). Der Pool ist NICHT im Concurrency-Pfad: der Worker-Pool in
// tft-match-cache-pg.mjs macht ausschliesslich riot.fetchJson und keine
// db.query, die DB-Arbeit laeuft davor und danach seriell. Ein hoeherer Wert
// bringt hier also nichts — die frueher hier notierte Begruendung
// ("Default 10 wuerde Companion-Backfill killen") war sachlich falsch.
//
// DATABASE_URL kann Hetzner-local (kein Encoding, kein SSL) oder Supabase-
// Pooler (URL-encoded Password + SSL) sein. Auto-detect per Hostname.
function encodePasswordInPgUrl(url) {
  // Special-Chars wie '#' in Supabase-Passwörtern brechen pg's URL-Parser.
  const schemeEnd = url.indexOf('://');
  if (schemeEnd < 0) return url;
  const after = url.slice(schemeEnd + 3);
  const atIdx = after.lastIndexOf('@');
  if (atIdx < 0) return url;
  const userinfo = after.slice(0, atIdx);
  const rest = after.slice(atIdx);
  const colonIdx = userinfo.indexOf(':');
  if (colonIdx < 0) return url;
  const user = userinfo.slice(0, colonIdx);
  const pass = userinfo.slice(colonIdx + 1);
  return `${url.slice(0, schemeEnd + 3)}${user}:${encodeURIComponent(pass)}${rest}`;
}
const isRemote = /supabase\.com|pooler\.|aws-/i.test(DATABASE_URL);
const pool = new pg.Pool({
  connectionString: isRemote ? encodePasswordInPgUrl(DATABASE_URL) : DATABASE_URL,
  ssl: isRemote ? { rejectUnauthorized: false } : undefined,
  max: 6,
  statement_timeout: 60_000, // bound query hangs (Audit H2, 2026-06-28)
});

// Set-Nummer, für die zuletzt aufgeräumt wurde (siehe processRegion).
let lastCleanupSet = null;

let aborting = false;
process.on('SIGTERM', () => {
  if (aborting) return;
  aborting = true;
  console.log('\n  [signal] SIGTERM — finishing current region, then exiting (cursor preserved)');
});

// ─────────────────────────────────────────────────────────────────────────────
// Lauf-Tag: EINMAL beim Prozessstart eingefroren
//
// todayUtcIso() wurde vorher an jeder Verwendungsstelle neu ausgewertet. In
// einem Lauf über Mitternacht schrieb insertInflight die erste Hälfte einer
// Region mit day=D und die zweite mit day=D+1, während loadInflightForRegion nur
// eine der beiden fand — die halbe Gather-Arbeit verschwand lautlos.
// ─────────────────────────────────────────────────────────────────────────────

const RUN_DAY = new Date().toISOString().slice(0, 10);

// Aufräumen eines zurückgelassenen Tages-Cursors aus der Zeit vor dem Rundlauf.
// Einmalig; ein vorhandenes File hat keine Wirkung mehr, würde bei einer
// Fehlersuche aber falsche Fährten legen.
function removeLegacyCursor() {
  try {
    if (!existsSync(LEGACY_CURSOR_PATH)) return;
    unlinkSync(LEGACY_CURSOR_PATH);
    console.log(`    [cursor] Alt-Cursor entfernt (${LEGACY_CURSOR_PATH}) — Fälligkeit kommt jetzt aus der DB`);
  } catch { /* nicht kritisch */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Inflight-Tabelle Helper (Sub-Region-Resume, Migration 0046)
// ─────────────────────────────────────────────────────────────────────────────

// Cleanup stale Inflight. Zwei Gründe, eine Abfrage:
//
//   • ALTER statt Datum. Der frühere Cleanup `day < today` lief bei JEDEM
//     Driver-Start und löschte damit exakt das, was der nächtliche SIGTERM
//     hinterlassen hatte: eine Region, die um 23:50 abbrach, verlor am nächsten
//     Nachmittag ihre komplette Gather-Arbeit und begann wieder bei Spieler 1.
//     Genau daran sind euw1 und eun1 wochenlang gescheitert, ohne dass es im Log
//     als Fehler auftauchte — dort stand "nächster Lauf setzt fort".
//   • Set-Bump. Ein Wechsel zwischen 23:55 (Set 17) und 00:05 (Set 18) würde
//     Set-17-Rohdaten als Set-18-Daten weiterlaufen lassen (Architect F3).
//     Deshalb wird das zusätzlich beim Betreten jeder Region geprüft, nicht nur
//     einmal beim Start — ein Lauf kann inzwischen über den Wechsel hinweggehen.
async function cleanupStaleInflight(currentSetNumber) {
  if (!USE_INFLIGHT_RESUME) return;
  try {
    const r = await pool.query(
      `delete from tft_mv_inflight_raw
       where persisted_at < now() - ($1::text || ' hours')::interval
          or set_number != $2`,
      [INFLIGHT_TTL_HOURS, currentSetNumber],
    );
    if (r.rowCount > 0) {
      console.log(`  [inflight] cleaned ${r.rowCount} stale rows (älter als ${INFLIGHT_TTL_HOURS}h ODER set != ${currentSetNumber})`);
    }
  } catch (err) {
    console.error(`  [inflight] cleanupStale failed: ${err.message}`);
  }
}

// `--reset-cursor` Cascade: verwirft den Resume-Puffer der Regionen im Scope.
async function clearScopedInflight(regions) {
  if (!USE_INFLIGHT_RESUME) return;
  try {
    const r = await pool.query(
      `delete from tft_mv_inflight_raw where region = any($1::text[])`,
      [regions],
    );
    if (r.rowCount > 0) {
      console.log(`  [inflight] reset: ${r.rowCount} Rows gelöscht (${regions.length} Regionen)`);
    }
  } catch (err) {
    console.error(`  [inflight] reset failed: ${err.message}`);
  }
}

// Pass-1-Eintritt: lese alle bereits gather-ten Spieler für diese Region.
// Truth-Source für Skip-Set (logic-flow F2: Zähler aus einem Cursor-File waren
// NUR Anzeige-Telemetrie, NIE Skip-Threshold).
//
// Bewusst OHNE Datumsfilter: der Puffer darf über die Tagesgrenze getragen
// werden, sonst gäbe es kein Fortsetzen (siehe cleanupStaleInflight). Grenze ist
// allein das Alter. Bricht eine Region über zwei Nächte ab, können für denselben
// Spieler Zeilen aus zwei Tagen liegen — nach persisted_at aufsteigend gelesen
// gewinnt die jüngste.
async function loadInflightForRegion(region, setNumber) {
  if (!USE_INFLIGHT_RESUME) return new Map();
  try {
    const r = await pool.query(
      `select puuid, raw_metrics
       from tft_mv_inflight_raw
       where region = $1
         and set_number = $2
         and persisted_at > now() - ($3::text || ' hours')::interval
       order by persisted_at asc`,
      [region, setNumber, INFLIGHT_TTL_HOURS],
    );
    return new Map(r.rows.map(row => [row.puuid, row.raw_metrics]));
  } catch (err) {
    console.error(`  [inflight] load failed (${region}): ${err.message}`);
    return new Map();
  }
}

// Pro Spieler nach erfolgreichem gatherPlayer: persistiere Raw-Metriken.
// PK (puuid, region, day) — UPSERT idempotent bei Re-Run.
async function insertInflight(region, setNumber, puuid, rawMetrics) {
  if (!USE_INFLIGHT_RESUME) return;
  try {
    await pool.query(
      `insert into tft_mv_inflight_raw (puuid, region, day, set_number, raw_metrics)
       values ($1, $2, $3, $4, $5)
       on conflict (puuid, region, day) do update set raw_metrics = excluded.raw_metrics, persisted_at = now()`,
      [puuid, region, RUN_DAY, setNumber, rawMetrics],
    );
  } catch (err) {
    // Inflight-Write-Failure ist nicht fatal — Driver läuft ohne Resume
    // weiter, nur Crash-Recovery für diesen Spieler ist weg.
    if (VERBOSE) console.error(`  [inflight] insert failed ${puuid.slice(0, 8)}…: ${err.message}`);
  }
}

// Region-Done-Cleanup. Läuft NACH dem erfolgreichen Pass 2. Schlägt das DELETE
// fehl, bleiben Rows liegen — die fängt der Alters-Cleanup beim nächsten Start.
// Ohne Datumsfilter, sonst blieben Zeilen einer über Mitternacht gelaufenen
// Region als Leichen zurück und würden beim nächsten Durchlauf als gültiger
// Resume-Stand gelesen.
async function cleanupRegionInflight(region) {
  if (!USE_INFLIGHT_RESUME) return;
  try {
    const r = await pool.query(
      `delete from tft_mv_inflight_raw where region = $1`,
      [region],
    );
    if (VERBOSE && r.rowCount > 0) {
      console.log(`  [inflight] region-done cleanup ${region}: ${r.rowCount} rows`);
    }
  } catch (err) {
    console.error(`  [inflight] region-done cleanup ${region}: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic-null-pop für me1-Bypass
// ─────────────────────────────────────────────────────────────────────────────

function makeNullPop() {
  // Alle MADs = 0 → zOf() returns null für jedes Signal → wSum = 0 →
  // skillScoreRaw = 0 → multiplier = 1 + 0.65·tanh(0) = 1.0. Saubere
  // "kein Skill-Score" Aussage statt erfundener Werte.
  const nullStat = { median: 0, mad: 0, n: 0 };
  return {
    medians: {
      performance: nullStat,
      metaRelative: nullStat,
      consistency: nullStat,
      flexMastery: nullStat,
      survival: nullStat,
      eco: nullStat,
      boardStrength: nullStat,
    },
    expectedDmg: {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Iteration: alle D2+ Spieler einer Region deren letzter Snapshot < today
// ─────────────────────────────────────────────────────────────────────────────

async function loadIterationTargets(region) {
  // Pro Spieler: das ZULETZT bekannte Snapshot-Tier + LP + last_snapshot_date.
  // Wir gehen davon aus, dass das Tier nicht im letzten Tag um mehr als 1
  // Division gerutscht ist — wenn doch, korrigiert sich das im nächsten
  // wöchentlichen Discovery-Lauf (= alter Crawler mit --include-diamond).
  //
  // Fälligkeit hängt an created_at (Zeitpunkt des letzten Schreibvorgangs),
  // nicht mehr an `snapshot_date < current_date`. Der Tagesvergleich hatte zwei
  // Defekte: ein zweiter Durchlauf am selben UTC-Tag fand grundsätzlich nichts
  // zu tun (der Rundlauf wäre damit nach einem Durchgang tot gewesen), und eine
  // Region, die kurz nach Mitternacht fertig wurde, galt sofort wieder als
  // komplett überfällig.
  //
  // `order by ... created_at desc` als zweites Kriterium: bei mehreren Zeilen
  // desselben Tages — möglich, seit der Refresh-Button der API in dieselbe Zeile
  // schreibt — soll die zuletzt geschriebene gewinnen.
  const r = await pool.query(
    `with latest as (
       select distinct on (puuid)
         puuid, region, tier, rank, lp, ladder_rank, snapshot_date, games_played, created_at
       from tft_player_marketvalue_snapshots
       where region = $1
       order by puuid, snapshot_date desc, created_at desc
     )
     select * from latest
     where tier = any($2::text[])
       and created_at < now() - ($3::text || ' hours')::interval`,
    [region, D2_TIERS, REFRESH_HOURS],
  );
  return r.rows.map(row => ({
    puuid: row.puuid,
    tier: row.tier,
    rank: row.rank,
    lp: row.lp,
    ladderRank: row.ladder_rank ?? undefined,
    lastSnapshotDate: row.snapshot_date,
    // Spielzaehler des letzten Snapshots. NULL heisst "unbekannt" und fuehrt in
    // splitByActivity bewusst zu AKTIV — beim ersten Lauf nach Migration 0051
    // rechnet also alles einmal durch, danach greift die Inkrementalitaet.
    gamesPlayed: row.games_played ?? null,
    // wins/losses fehlen — der Daily-Refresh fragt sie nicht frisch ab
    // (würde extra by-puuid-Call kosten). Skill-Score nutzt sie nur als
    // Bayesian-Prior für top4Blend; bei wins=losses=0 fällt der Score auf
    // den beobachteten top4-Rate zurück, was OK ist.
    wins: 0,
    losses: 0,
  }));
}

function startTimeForPlayer(player) {
  // last_snapshot_date kommt als Date-Object aus pg → epoch sec
  const t = player.lastSnapshotDate.getTime() / 1000;
  return Math.floor(t) - START_TIME_OVERLAP_SEC;
}

// Wieviele Match-IDs braucht DIESER Spieler? Der fixe Wert war doppelt falsch:
// er wurde bis 2026-08-01 gar nicht durchgereicht (der Cache holte immer 200),
// und selbst korrekt durchgereicht ist eine feste 30 im Nachhol-Fall zu klein —
// bei einer Woche Rueckstand hat ein aktiver Spieler weit mehr Matches, und die
// nicht geholten fehlen DAUERHAFT, weil startTime danach weiterwandert.
// Deshalb: aus dem Rueckstand ableiten. ~25 Ranked-Spiele/Tag ist die Obergrenze
// eines sehr aktiven Spielers; gedeckelt auf 200 (Riots Seitengroesse).
const GAMES_PER_DAY_CEILING = 25;
function maxIdsForPlayer(player) {
  if (MAX_IDS_EXPLICIT) return MAX_IDS;   // CLI-Override gewinnt immer
  const gapMs = Date.now() - player.lastSnapshotDate.getTime();
  const gapDays = Math.max(1, Math.ceil(gapMs / 86_400_000));
  return Math.min(200, Math.max(DEFAULT_MAX_IDS, gapDays * GAMES_PER_DAY_CEILING));
}

// ─────────────────────────────────────────────────────────────────────────────
// Backup-Pattern für Rollback
// ─────────────────────────────────────────────────────────────────────────────

// Backup und Snapshot MÜSSEN denselben Tag benutzen. Bis 2026-08-04 zog jede
// Stelle ihr Datum selbst: das Backup aus new Date(), der Insert aus dem
// SQL-seitigen current_date, ausgewertet PRO ZEILE. Ein Pass 2 über Mitternacht
// (bei euw1 rund 10.900 serielle Account-Abrufe, gut eine Viertelstunde) zerriss
// die Region damit in zwei Kohorten mit zwei Snapshot-Tagen — und die Hälfte von
// gestern galt sofort wieder als fällig, baute eine Population aus dem Rest und
// überschrieb die der ersten Hälfte. Ergebnis wären zwei Multiplier-Sätze
// derselben Region gegen zwei verschiedene Bezugsgrößen: genau der stille
// Datenfehler, gegen den weiter unten der Abbruch-Riegel steht.
function backupTableName(region, day) {
  return `tft_pmvs_backup_${day.replace(/-/g, '')}_${region}`;
}

async function createBackup(region, day) {
  const tbl = backupTableName(region, day);
  // CREATE IF NOT EXISTS-Pattern: bei Re-Run am gleichen Tag bleibt das
  // ursprüngliche Backup erhalten (= state VOR allen heutigen Schreibwegen).
  const exists = await pool.query(
    `select 1 from pg_tables where schemaname = 'public' and tablename = $1`,
    [tbl],
  );
  if (exists.rows.length > 0) {
    console.log(`  [backup] ${tbl} existiert bereits — skip (wahrscheinlich Re-Run)`);
    return tbl;
  }
  await pool.query(
    `create table ${tbl} as
     select * from tft_player_marketvalue_snapshots
     where region = $1 and snapshot_date = $2::date`,
    [region, day],
  );
  const cnt = await pool.query(`select count(*)::int as n from ${tbl}`);
  console.log(`  [backup] ${tbl} — ${cnt.rows[0].n} Rows gesichert`);
  return tbl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Region-Lauf
// ─────────────────────────────────────────────────────────────────────────────

async function processRegion(region) {
  const regional = getRegionalCluster(region);
  // Client kommt aus der Cluster-Map — bei aufeinanderfolgenden Regionen
  // desselben Clusters ist es exakt dasselbe Objekt inkl. Fenster-Historie.
  const riot = riotForCluster(regional);
  console.log(`\n=== ${region} (cluster=${regional}, limiter=${batchBudget(regional)}/10,5s, concurrency=${MATCH_CONCURRENCY}) ===`);
  const t0 = Date.now();

  // Der Tag dieser Region — EINMAL hier festgelegt, siehe backupTableName().
  const regionDay = new Date().toISOString().slice(0, 10);

  // 0. Player-Liste aus Snapshot-Tabelle (Option Z, vereinfacht)
  let players = await loadIterationTargets(region);
  console.log(`  [iter] ${players.length} D2+ Spieler mit fälligem Marktwert (>${REFRESH_HOURS}h)`);
  if (LIMIT > 0) players = players.slice(0, LIMIT);

  // Leerlauf-Kurzschluss VOR dem Liga-Abruf.
  //
  // Der Check stand bis 2026-08-04 hinter fetchD2PlusEntries — eine Region ohne
  // Arbeit kostete trotzdem 30-60 Riot-Calls (bei euw1/kr je 10.000 Apex-
  // Einträge plus Diamond-Paginierung). Im Tagesraster fiel das nicht auf, weil
  // es höchstens einmal pro Region und Tag passierte. Im Rundlauf ist "nichts zu
  // tun" der häufigste Fall: der abschließende Durchgang prüft alle 15 Regionen
  // und darf dafür nicht das Riot-Kontingent verbrennen, das nachts dem
  // Daily-Crawl gehört.
  if (players.length === 0) {
    console.log(`  [done] nichts fällig — übersprungen`);
    return { region, players: 0, snapshots: 0, noop: true };
  }

  // --- Aktivitaetserkennung -------------------------------------------------
  // Bis 2026-08-02 bekam JEDER dieser Spieler eine eigene Riot-Call-Kette, auch
  // die grosse Mehrheit ohne ein einziges neues Spiel. Die Liga-Eintraege
  // liefern gebuendelt (~30-60 Calls statt ~10.876) pro Spieler wins+losses;
  // bewegt sich die Summe nicht, hat er nicht gespielt.
  //
  // WICHTIG — "nicht gespielt" heisst NICHT "Wert unveraendert": der Multiplier
  // ist populations-relativ, verschiebt sich also mit den anderen. Inaktive
  // ueberspringen waere fachlich falsch. Gespart werden nur die RIOT-Calls;
  // gerechnet wird weiterhin fuer alle (gemessen: 36 ms/Spieler, ~31 min fuer
  // die gesamte Grundgesamtheit — siehe infra/specs/2026-08-02-*.md).
  let entries = new Map();
  {
    // Bewusst AUCH im Dry-Run: der Abruf ist rein lesend (~30-60 Calls) und ist
    // die einzige Moeglichkeit, die Aktivitaets-Aufteilung zu pruefen, ohne
    // einen Snapshot zu schreiben. Ein Dry-Run, der den neuen Pfad ueberspringt,
    // testet nichts.
    try {
      entries = await fetchD2PlusEntries(region, url => riot.fetchJson(url), API_KEY, { log: m => console.log(m) });
    } catch (err) {
      // Kein Abbruch: ohne Eintraege gelten alle als aktiv, der Lauf verhaelt
      // sich exakt wie vor dem Umbau. Teurer, aber korrekt.
      console.error(`  [entries] FEHLER (${err.message}) → alle Spieler gelten als aktiv`);
      entries = new Map();
    }
  }
  const { active, inactive } = splitByActivity(players, entries);
  const inactiveSet = new Set(inactive.map(p => p.puuid));
  // Frische Rang-Daten aus den Liga-Eintraegen uebernehmen. Bisher kamen tier/
  // rank/lp aus dem Snapshot des VORTAGS — der Code nahm bewusst in Kauf, dass
  // sie einen Tag alt sind. Das erklaert vermutlich beobachtete Basiswert-
  // Spruenge. ladder_rank bleibt aus dem Snapshot: den liefern die Eintraege
  // nicht, und er stammt aus dem Daily-Crawler.
  let refreshedRank = 0;
  for (const p of players) {
    const e = entries.get(p.puuid);
    if (!e) continue;
    if (p.tier !== e.tier || p.rank !== e.rank || p.lp !== e.lp) refreshedRank++;
    p.tier = e.tier;
    p.rank = e.rank;
    p.lp = e.lp;
    p.wins = e.wins;
    p.losses = e.losses;
    // Ab hier traegt gamesPlayed den AKTUELLEN Stand — die Aufteilung oben hat
    // den Vortageswert bereits verbraucht. Dieser Wert wird in den Snapshot
    // geschrieben und ist morgen die Vergleichsbasis.
    p.gamesPlayed = e.games;
  }
  console.log(`  [aktiv] ${active.length} gespielt / ${inactive.length} inaktiv`
    + ` | ${refreshedRank} mit frischem Rang`
    + (entries.size === 0 ? ' | KEINE Liga-Eintraege → alle aktiv' : ''));

  // Dry-Run: nur Estimate ausgeben, keine Riot-Calls, kein Schreib
  if (DRY_RUN) {
    const fs = await pool.query(
      `select count(*)::int as n,
              count(*) filter (where last_fetched_at > now() - interval '7 days')::int as fresh_7d,
              count(*) filter (where last_fetched_at > now() - interval '1 day')::int as fresh_1d
       from tft_player_fetch_state where region = $1`,
      [region],
    );
    const f = fs.rows[0];
    // Quota-Estimate: pro Spieler ~1 by-puuid + 0-5 Match-Details + 1 Account
    const estCalls = players.length * (1 + 2 + 1); // optimistisch 2 Match-Details avg
    console.log(`  [dry-run] fetch_state: ${f.n} cache rows, ${f.fresh_7d} fresh<7d, ${f.fresh_1d} fresh<1d`);
    console.log(`  [dry-run] estimated Riot-Calls: ${estCalls} (~${(estCalls / 17 / 60).toFixed(1)} min @ 17 req/s)`);
    return { region, players: players.length, snapshots: 0, dryRun: true };
  }

  // 1. Backup vor scharfem Lauf
  let backupTbl = null;
  if (!SKIP_BACKUP) {
    backupTbl = await createBackup(region, regionDay);
  }

  // 2. Pass 1: gatherPlayer pro Spieler
  const setNumber = loadCurrentSet();
  if (setNumber == null) {
    console.error('  [error] No current set, aborting');
    return { region, players: players.length, snapshots: 0, failed: 1 };
  }
  // Set-Prüfung bei JEDEM Region-Eintritt, nicht nur beim Prozessstart: der Set
  // wird pro Region frisch von Platte gelesen, und ein Lauf kann inzwischen über
  // einen Set-Bump hinweggehen. Ohne das würden Rohdaten des alten Sets als neue
  // weiterverrechnet.
  if (USE_INFLIGHT_RESUME && setNumber !== lastCleanupSet) {
    await cleanupStaleInflight(setNumber);
    lastCleanupSet = setNumber;
  }
  const graph = loadGraph(region);
  const hotCompKeys = buildHotCompKeys(graph);
  const recommendedItems = buildRecommendedItems(graph);

  // Inflight-Aktivierungs-Check: nur ab >=500 Spielern lohnt sich Resume-
  // Granularität (perf-critic F8: kleine Regionen sind in 2-5min durch,
  // Resume-Wert null). me1/br1/la1/la2/oc1 skippen automatisch.
  const inflightActive = USE_INFLIGHT_RESUME && players.length >= INFLIGHT_MIN_PLAYERS;
  const inflightMap = inflightActive ? await loadInflightForRegion(region, setNumber) : new Map();
  if (inflightActive) {
    console.log(`  [inflight] active — ${inflightMap.size} puuids im Skip-Set (resume mode)`);
  } else if (USE_INFLIGHT_RESUME) {
    console.log(`  [inflight] skipped — region <${INFLIGHT_MIN_PLAYERS} players`);
  }

  const gathered = [];
  let p1 = 0, tooFew = 0, failed = 0, fromInflight = 0;
  let pass1Aborted = false;
  for (const p of players) {
    if (aborting) {
      console.log(`  [signal] Pass 1 stopped at ${p1}/${players.length} (region NOT marked completed, ${gathered.length} usable so far)`);
      pass1Aborted = true;
      break;
    }
    // Inflight-Skip: wenn Spieler im Resume-Set, raw_metrics direkt nutzen
    // (data-skeptic F1: Time-Skew-Bias <0.5% bei 2h-Gap akzeptiert — Inflight
    // ist Zeitpunkt-Freeze, nicht reproduzierbar mit Frisch-Stand. Akzeptable
    // Granularität bei Daily-Snapshots).
    if (inflightMap.has(p.puuid)) {
      gathered.push({ p, raw: inflightMap.get(p.puuid) });
      fromInflight++;
      p1++;
      continue;
    }
    try {
      const startTimeSec = startTimeForPlayer(p);
      const ctx = {
        region, regional,
        setNumber, hotCompKeys, recommendedItems,
        startTimeSec,
        maxIds: maxIdsForPlayer(p),
        concurrency: MATCH_CONCURRENCY,
        force: false,
        // DER Kern des inkrementellen Umbaus: wer laut Liga-Eintrag nicht
        // gespielt hat, braucht keinen Riot-Abruf. gatherPlayer liest dann nur
        // den Cache und extrahiert die Roh-Metriken — dieselbe Rechnung, ohne
        // die teure Beschaffung.
        skipCacheRefresh: inactiveSet.has(p.puuid),
        verbose: VERBOSE,
      };
      const g = await gatherPlayer(pool, riot, p, ctx);
      p1++;
      if (g.skip) {
        tooFew++;
      } else {
        gathered.push({ p, raw: g.raw });
        // Inflight-Persist nach erfolgreichem Gather. Best-effort — Failure
        // ist non-fatal (Driver läuft ohne Resume für diesen Player weiter).
        await insertInflight(region, setNumber, p.puuid, g.raw);
      }
      if (VERBOSE || p1 % 50 === 0 || p1 === players.length) {
        const dt = ((Date.now() - t0) / 1000).toFixed(0);
        const inflightSuffix = inflightActive ? `, ${fromInflight} resumed` : '';
        console.log(`  [pass1] ${p1}/${players.length} | ${gathered.length} usable, ${tooFew} too-few${inflightSuffix} | ${dt}s`);
      }
    } catch (err) {
      failed++;
      if (VERBOSE) console.error(`  [error] puuid=${p.puuid.slice(0, 8)}…: ${err.message}`);
    }
  }

  if (gathered.length === 0) {
    // Dieser Return trug bis 2026-08-04 weder `aborted` noch `degraded`. Folge:
    // die Region wanderte in cursor.completed UND ihre Inflight-Rows wurden
    // geloescht, obwohl null Snapshots geschrieben wurden — sie war fuer den
    // Rest des Tages gesperrt, und der Watchdog konnte sie nicht nachholen,
    // weil er zwar die fehlende DB-Abdeckung sieht, der Driver aber den Cursor
    // liest und die Region ueberspringt.
    //
    // Unterschieden wird nach Ursache: sind alle Spieler sauber als too-few
    // ausgesortiert worden, ist das ein legitimer No-Op und die Region gilt als
    // fertig. Gab es Fehler oder ein SIGTERM, ist sie es nicht.
    console.log(`  [done] keine usable Spieler (${tooFew} too-few, ${failed} failed) → keine Snapshots geschrieben`);
    return {
      region, players: players.length, snapshots: 0, failed, backup: backupTbl,
      aborted: pass1Aborted, degraded: failed > 0,
    };
  }

  // Abbruch-Riegel: nach einem SIGTERM mitten in Pass 1 haben wir nur einen
  // WILLKUERLICHEN Ausschnitt der Region — die Spieler, die zufaellig vor dem
  // Signal dran waren. Frueher lief Pass 2 damit trotzdem durch. Die Folge war
  // ein stiller Datenfehler, kein Absturz:
  //
  //   Lauf 1 bricht ab, schreibt Snapshots fuer Teil-Kohorte A und persistiert
  //   eine Population, die NUR aus A gebaut ist. Lauf 2 schliesst genau diese
  //   Spieler aus (snapshot_date < current_date), baut die Population aus dem
  //   Rest B und ueberschreibt sie. Ergebnis: die Multiplier derselben Region
  //   sind gegen zwei verschiedene Bezugsgroessen gerechnet und untereinander
  //   nicht vergleichbar.
  //
  // Der 30%-Floor unten faengt das NICHT: er prueft die Groesse des Samples,
  // nicht ob es vollstaendig ist. Ein Abbruch bei 60% besteht ihn anstandslos.
  //
  // Deshalb: bei Abbruch gar nichts schreiben. Die Gather-Arbeit ist nicht
  // verloren — sie liegt in tft_mv_inflight_raw und der naechste Lauf rechnet
  // ueber die vollstaendige Kohorte. Die Region bleibt unvollstaendig (Cursor
  // nicht auf completed), der Watchdog holt sie nach.
  if (pass1Aborted) {
    const inflightNote = inflightActive
      ? 'Gather-Arbeit liegt in tft_mv_inflight_raw, naechster Lauf setzt fort'
      : 'ACHTUNG: Inflight-Resume ist AUS, die Gather-Arbeit dieser Region ist verloren';
    console.warn(`  [abort] Pass 2 uebersprungen — Teil-Kohorte ${gathered.length}/${players.length}`);
    console.warn(`  [abort] Keine Snapshots, keine Population geschrieben. ${inflightNote}.`);
    return {
      region, players: players.length, gathered: gathered.length,
      snapshots: 0, unrated: 0, failed, backup: backupTbl,
      fromInflight, aborted: true,
    };
  }

  // Sanity-Floor (Audit H3): ein degradiertes Sample (z.B. Riot-429-Storm hat
  // 90% der gathers verworfen) darf die gute Population NICHT via on-conflict-
  // Upsert überschreiben → sonst sind die Marktwerte der ganzen Region für den
  // Tag falsch. Unter 30% der iterierten Spieler: Region überspringen, die
  // bestehende Population/Snapshots (≤1 Tag alt) bleiben erhalten.
  //
  // Der Kommentar behauptete hier bis 2026-08-04, der mv-watchdog re-triggere
  // die Region. Das konnte er nicht: der Return setzte kein Flag, das den
  // Cursor-Write unten verhindert, also galt die Region als heute fertig.
  // Watchdog (urteilt nach DB-Abdeckung) und Driver (urteilt nach Cursor-File)
  // liefen still auseinander. `degraded` wird jetzt unten mit ausgewertet.
  if (!POP_BYPASS_REGIONS.has(region) && gathered.length < players.length * 0.3) {
    console.error(`  [pop] DEGRADED: nur ${gathered.length}/${players.length} usable (<30%) — Region übersprungen, bestehende Population erhalten`);
    return {
      region, players: players.length, snapshots: 0, failed,
      degraded: true, aborted: pass1Aborted, backup: backupTbl,
    };
  }

  // 3. Population-Recompute aus aktiver Sub-Kohorte
  //
  // Pop-Determinismus-Pflicht (architect F9): gathered nach puuid sortieren
  // VOR buildCompMeta/buildPopulation. Bei Resume-Mix (Inflight+Frisch) kommt
  // gathered in der Reihenfolge "alle Frisch nach DB-Order, dann übersprungene
  // Inflight in DB-Order" — nicht puuid-sortiert. Single-Run wäre direkt
  // puuid-sortiert (loadIterationTargets ORDER BY puuid). Sort macht Pop
  // bitwise reproduzierbar zwischen den Pfaden.
  gathered.sort((a, b) => a.p.puuid.localeCompare(b.p.puuid));

  let pop;
  let compMetaSize = 0;
  if (POP_BYPASS_REGIONS.has(region)) {
    pop = makeNullPop();
    console.log(`  [pop] ${region} bypassed (n=${gathered.length} zu klein für valide z-Verteilung) — multiplier=1.0`);
  } else {
    const compMeta = buildCompMeta(gathered.map(g => g.raw));
    // applyMeta über GESAMTE gathered-Liste (Inflight + Frisch) — data-skeptic
    // F2: metaRelM wird in-place in raw_metrics geschrieben. Wenn applyMeta
    // nur über Frisch läuft, fehlt metaRelative-z für Inflight-Spieler →
    // unrated-Cascade in Pass 2.
    for (const g of gathered) applyMeta(g.raw, compMeta);
    pop = buildPopulation(gathered.map(g => g.raw));
    compMetaSize = compMeta.size;
    await persistPopulation(pool, region, setNumber, pop, compMeta, gathered.length, {
      supaUrl: SUPA_URL, supaKey: SUPA_KEY,
    });
    console.log(`  [pop] persisted — ${gathered.length} players, ${compMetaSize} comps`);
  }

  // 4. Pass 2: snapshotPlayer pro Spieler
  //
  // Iteriert über die kombinierte gathered-Liste (Inflight + Frisch nach
  // puuid-Sort). Bei Crash zwischen Pass 1 und Pass 2 ist die Liste nicht
  // mehr in-Memory (logic-flow F4) — DAFÜR sorgt aber der Inflight-Resume
  // beim Re-Start: cleanupStaleInflight läuft NICHT auf heutige Rows, der
  // nächste Pass-1-Lauf für die Region findet Inflight-Map = volle Liste,
  // alle Spieler gehen direkt nach gathered (kein Gather nötig), Pop wird
  // neu gebaut, Pass 2 läuft über die volle Liste. Idempotent via
  // UPSERT in tft_player_marketvalue_snapshots.
  let snapshotted = 0, unrated = 0;
  const snapshotCtx = {
    region, regional,
    apiKey: API_KEY,
    // Fest, NICHT current_date pro Zeile — siehe backupTableName().
    snapshotDate: regionDay,
  };
  for (const g of gathered) {
    try {
      const r = await snapshotPlayer(pool, riot, g.p, g.raw, pop, snapshotCtx);
      if (r.snapshotted) snapshotted++; else unrated++;
    } catch (err) {
      failed++;
      if (VERBOSE) console.error(`  [error] snapshot ${g.p.puuid.slice(0, 8)}…: ${err.message}`);
    }
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(0);
  const inflightSuffix = inflightActive ? `, ${fromInflight} from-inflight` : '';
  const abortedSuffix = pass1Aborted ? ' [ABORTED — region not completed]' : '';
  console.log(`  [done] ${snapshotted} snapshots | ${gathered.length} usable / ${players.length} total | ${tooFew} too-few, ${unrated} unrated, ${failed} failed${inflightSuffix} | ${dt}s${abortedSuffix}`);
  return { region, players: players.length, gathered: gathered.length, snapshots: snapshotted, unrated, failed, backup: backupTbl, fromInflight, aborted: pass1Aborted };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== Daily Marktwert-Snapshot ===`);
  console.log(`    regions: ${REGIONS.join(', ')}`);
  const maxIdsLabel = MAX_IDS_EXPLICIT
    ? `${MAX_IDS} (CLI-Override)`
    : `adaptiv ${DEFAULT_MAX_IDS}-200 (aus Rueckstand)`;
  console.log(`    max-ids: ${maxIdsLabel} | concurrency: ${MATCH_CONCURRENCY} | limit: ${LIMIT || 'unlimited'}`);
  console.log(`    dry-run: ${DRY_RUN} | skip-backup: ${SKIP_BACKUP} | reset: ${RESET_CURSOR}`);
  console.log(`    fällig ab: ${REFRESH_HOURS}h ohne Aktualisierung | max-cycles: ${MAX_CYCLES}`);
  console.log(`    inflight-resume: ${USE_INFLIGHT_RESUME ? `ON (Verfall ${INFLIGHT_TTL_HOURS}h)` : 'OFF (default — set MV_USE_INFLIGHT_RESUME=true to enable)'}`);

  removeLegacyCursor();

  // Inflight-Stale-Cleanup beim Start. Pflicht VOR jeglichen Region-Reads.
  if (USE_INFLIGHT_RESUME && !DRY_RUN) {
    const currentSet = loadCurrentSet();
    if (currentSet != null) {
      if (RESET_CURSOR) await clearScopedInflight(REGIONS);
      await cleanupStaleInflight(currentSet);
      lastCleanupSet = currentSet;
    }
  }

  const t0 = Date.now();
  const results = [];
  try {
    // Rundlauf: pro Durchgang die fälligen Regionen nach Rückstand abarbeiten,
    // danach neu bewerten. Ein zweiter Durchgang lohnt sich, weil ein Durchlauf
    // Stunden dauert — Regionen, die beim Start noch frisch waren, können
    // inzwischen fällig geworden sein.
    //
    // Beendet wird, wenn ein Durchgang keine Arbeit mehr gefunden hat. Der
    // Prozess läuft bewusst NICHT endlos weiter (siehe Datei-Kopf): erst sein
    // Ende gibt Deploy und Vertragsprüfung frei. Den nächsten Start übernehmen
    // die bestehenden Wege — OnSuccess des Daily-Crawls und der Watchdog.
    // Regionen, die in diesem Prozess einen Anlauf hatten und dabei keinen
    // einzigen Snapshot geschrieben haben (Degradation, Fatal-Error, oder alle
    // Spieler unter der 5-Match-Schwelle). Sie bleiben fällig, weil nichts
    // geschrieben wurde — ohne diese Sperre würde der Rundlauf sie sofort wieder
    // aufgreifen und pro Anlauf erneut den Liga-Abruf bezahlen, bis der
    // Sicherheitsdeckel greift. Der nächste Prozessstart versucht es neu.
    const noProgress = new Set();

    for (let cycle = 1; cycle <= MAX_CYCLES && !aborting; cycle++) {
      const todoRegions = (await orderByStaleness([...REGIONS]))
        .filter(r => !noProgress.has(r));
      let worked = 0;

      for (const region of todoRegions) {
        if (aborting) {
          console.log(`[${region}] übersprungen — SIGTERM`);
          break;
        }
        try {
          const r = await processRegion(region);
          if (r.noop) continue;             // nichts fällig, zählt nicht als Arbeit
          results.push(r);
          worked++;
          if (!(r.snapshots > 0)) noProgress.add(region);

          // Inflight-Cleanup NUR nach einem sauber durchgelaufenen Region-Pass.
          //
          // Abbruch (SIGTERM mitten in Pass 1) und Degradation (<30% verwertbar)
          // müssen den Resume-Puffer behalten — er ist die einzige Stelle, an
          // der die Gather-Arbeit liegt, und genau sein früheres Löschen hat
          // dafür gesorgt, dass große Regionen nie fertig wurden.
          if (!DRY_RUN && !r.aborted && !r.degraded) {
            await cleanupRegionInflight(region);
          } else if (r.aborted || r.degraded) {
            const why = r.aborted ? 'abgebrochen' : 'degradiert';
            console.log(`[${region}] ${why} — Resume-Puffer bleibt für den nächsten Anlauf erhalten`);
          }
        } catch (err) {
          console.error(`[${region}] FATAL: ${err.message}`);
          if (VERBOSE) console.error(err.stack);
          results.push({ region, error: err.message });
          worked++;
          noProgress.add(region);
        }
      }

      if (worked === 0) {
        console.log(`\n=== Durchgang ${cycle}: nichts mehr fällig — Lauf beendet ===`);
        break;
      }
      // Ein Probelauf schreibt nichts, also wäre jede Region im nächsten
      // Durchgang wieder fällig — genau einer reicht.
      if (DRY_RUN) break;
      console.log(`\n=== Durchgang ${cycle} fertig: ${worked} Region(en) bearbeitet ===`);
      if (cycle === MAX_CYCLES) {
        console.warn(`[warn] max-cycles (${MAX_CYCLES}) erreicht — Lauf beendet, obwohl noch Regionen fällig sind.`);
      }
    }
  } finally {
    await pool.end().catch(() => {});
  }

  const totalMin = ((Date.now() - t0) / 60_000).toFixed(1);
  console.log(`\n=== Done in ${totalMin} min ===`);
  const tot = results.reduce((s, r) => s + (r.snapshots || 0), 0);
  console.log(`Total snapshots: ${tot} over ${results.length} regions`);
  for (const r of results) {
    if (r.error) console.log(`  ${r.region}: ERROR ${r.error}`);
    else if (r.dryRun) console.log(`  ${r.region}: ${r.players} would-iterate`);
    else console.log(`  ${r.region}: ${r.snapshots || 0} snapshots / ${r.players} players / ${r.failed || 0} failed${r.backup ? ` | backup=${r.backup}` : ''}`);
  }

  // Exit non-zero on SUBSTANTIAL region failure (>=50%) so systemd does NOT fire
  // the OnSuccess chain (snapshot-publisher would publish stale/empty marketvalue
  // data). Per-region errors are otherwise swallowed into results → exit 0.
  // Audit M5, 2026-06-28.
  // Laufzeit-Vertrag: hat der Lauf Snapshots ins lokale PG geschrieben?
  // Nicht-fatal — der Exit-Code steuert unten bewusst die OnSuccess-Kette.
  if (!DRY_RUN) {
    await assertContracts(['marketvalue/hetzner-snapshots'])
      .catch(err => console.error('[contract] Prüfung fehlgeschlagen:', err.message));
  }

  if (!DRY_RUN) {
    const errored = results.filter(r => r.error).length;
    if (errored > 0 && errored >= Math.ceil(results.length / 2)) {
      console.error(`[exit 1] ${errored}/${results.length} Regionen mit Fatal-Error — OnSuccess-Kette unterdrückt`);
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error('FAIL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
