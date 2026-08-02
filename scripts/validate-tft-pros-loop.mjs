#!/usr/bin/env node
/**
 * Watchdog: prüft die TFT-Pro-Daten kontinuierlich auf Anomalien.
 *
 * Modes:
 *   --mode=daily-sample [--size=30]
 *     Random sample N pros, re-validate against all sources, log discrepancies.
 *
 *   --mode=weekly-full
 *     Re-run TPC roster crawler + enrich-history + esportsearnings + classifier
 *     as a single chained pipeline. Designed to be invoked from systemd timer.
 *
 *   --mode=anomalies-only
 *     Just scan the current DB state for known anomaly patterns without
 *     hitting any external source. Cheap (~1s), runs after every other step.
 *
 *   --mode=auto-heal
 *     Process recent validation_log entries with status='warning' and severity≤2;
 *     re-fetch from the offending source to see if the issue resolves itself,
 *     mark as resolved when it does.
 *
 * Anomaly patterns detected:
 *   • total_earnings_usd > 0 but tournament_results is empty
 *     → Likely: Liquipedia infobox earnings without backing achievements.
 *       Severity 2 (warning). Auto-heal: re-crawl Liquipedia /Results subpage.
 *
 *   • tpc_verified=true but no tournament_results
 *     → TPC-listed pro hasn't been enriched yet. Severity 2. Auto-heal: queue
 *       for enrich-tft-pro-history next run.
 *
 *   • earnings_sources has 2+ values that diverge >25% (excluding zeros)
 *     → Cross-source data inconsistency. Severity 2. Manual review.
 *
 *   • classification='inactive' but tpc_verified=true (impossible state)
 *     → Classifier ran before TPC crawler. Severity 3. Auto-heal: re-classify.
 *
 *   • last_validated_at older than 30 days
 *     → Stale data. Severity 1 (info). Auto-heal: include in next daily sample.
 *
 *   • PUUID resolution failure (riot_id present but no PUUID)
 *     → Riot-API was down or rate-limited during crawl. Severity 3. Auto-heal:
 *       retry account-v1 lookup at next run.
 *
 * Each run is identified by a UUID; events written to tft_pro_validation_log.
 * Critical issues (severity ≥ 4) optionally open a GitHub Issue via `gh`.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
// support --mode=foo as well as --mode foo
function modeArg() {
  for (const a of args) {
    if (a.startsWith('--mode=')) return a.slice(7);
  }
  return arg('mode', 'anomalies-only');
}
const MODE = modeArg();
const SAMPLE_SIZE = Math.max(1, parseInt(arg('size', '30'), 10));
const VERBOSE = args.includes('--verbose');
const OPEN_GH_ISSUES = args.includes('--open-issues');
// --steps=all | liquipedia | local   (siehe PIPELINE_STEPS)
const STEPS_FILTER = (args.find((a) => a.startsWith('--steps='))?.slice(8)) || 'all';
// Woechentlicher Actions-Lauf + Puffer fuer einen verzoegerten GitHub-Cron.
const LIQUIPEDIA_FRESHNESS_MAX_DAYS = 10;

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

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) { console.error('Supabase env required'); process.exit(1); }

const RUN_ID = randomUUID();

async function sb(path, init = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: init.method === 'POST' ? 'return=minimal' : init.method === 'PATCH' ? 'return=minimal' : '',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${path} HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

async function logEvent({ puuid, proName, source, status, field, severity, detail, expected, actual }) {
  await sb('tft_pro_validation_log', {
    method: 'POST',
    body: JSON.stringify({
      validation_run_id: RUN_ID, puuid, pro_name: proName, source, status,
      field, severity, detail, expected, actual,
    }),
  });
}

// ─── Anomaly detectors ───────────────────────────────────────────────────
async function detectAnomalies() {
  const pros = await sb('tft_pro_players?select=puuid,pro_name,riot_id,tpc_verified,classification,total_earnings_usd,earnings_sources,tournament_results,last_validated_at,last_full_validation_at');
  const anomalies = [];

  for (const p of pros) {
    const earnings = Number(p.total_earnings_usd) || 0;
    const trs = Array.isArray(p.tournament_results) ? p.tournament_results : [];
    const sources = p.earnings_sources || {};

    // Earnings without backing tournaments
    if (earnings > 0 && trs.length === 0) {
      anomalies.push({
        puuid: p.puuid, proName: p.pro_name, source: 'liquipedia', status: 'warning',
        field: 'tournament', severity: 2,
        detail: `total_earnings_usd=${earnings} but tournament_results is empty — Liquipedia /Results subpage may be missing or unparsable`,
      });
    }

    // TPC-verified but no tournaments yet
    if (p.tpc_verified && trs.length === 0) {
      anomalies.push({
        puuid: p.puuid, proName: p.pro_name, source: 'liquipedia', status: 'warning',
        field: 'tournament', severity: 2,
        detail: 'TPC-verified pro has no tournament_results — needs enrich-tft-pro-history run',
      });
    }

    // Earnings cross-source divergence
    const sourceVals = Object.entries(sources).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]);
    if (sourceVals.length >= 2) {
      const max = Math.max(...sourceVals.map(([, v]) => v));
      const min = Math.min(...sourceVals.map(([, v]) => v));
      if ((max - min) / max > 0.25) {
        anomalies.push({
          puuid: p.puuid, proName: p.pro_name, source: 'cross', status: 'warning',
          field: 'earnings', severity: 2,
          expected: Object.fromEntries(sourceVals),
          detail: `Earnings divergence ${Math.round((max - min) / max * 100)}% across sources`,
        });
      }
    }

    // Impossible state: inactive but TPC-verified
    if (p.tpc_verified && p.classification === 'inactive') {
      anomalies.push({
        puuid: p.puuid, proName: p.pro_name, source: 'classifier', status: 'error',
        field: 'classification', severity: 3,
        detail: 'classification=inactive but tpc_verified=true — re-run classify-tft-pros.mjs',
      });
    }

    // Stale validation
    if (p.last_full_validation_at) {
      const age = (Date.now() - new Date(p.last_full_validation_at).getTime()) / 86_400_000;
      if (age > 30) {
        anomalies.push({
          puuid: p.puuid, proName: p.pro_name, source: 'meta', status: 'warning',
          field: 'identity', severity: 1,
          detail: `last_full_validation_at is ${Math.round(age)} days old`,
        });
      }
    } else if (p.riot_id) {
      anomalies.push({
        puuid: p.puuid, proName: p.pro_name, source: 'meta', status: 'warning',
        field: 'identity', severity: 1,
        detail: 'Never fully validated',
      });
    }
  }
  return anomalies;
}

// ─── Sub-pipeline runners ────────────────────────────────────────────────
// Forward only the parent's existing NODE_OPTIONS — don't blindly inject
// `--use-system-ca`, that flag is a Windows-only workaround and Node on
// Linux rejects it from NODE_OPTIONS.
function runSubScript(scriptName, extraArgs = []) {
  const node = process.execPath;
  const r = spawnSync(node, ['scripts/' + scriptName, ...extraArgs], {
    stdio: 'inherit',
    env: process.env,
  });
  return r.status === 0;
}

/**
 * Die kanonische Pro-Pipeline. EINZIGE Quelle der Schrittliste — der
 * GitHub-Workflow ruft diesen Loop auf und wiederholt die Schritte nicht als
 * eigene `run:`-Zeilen, sonst driften zwei Listen auseinander.
 *
 * `group` sagt, wo ein Schritt laufen KANN:
 *   liquipedia — braucht liquipedia.net. Laeuft nur noch auf GitHub Actions,
 *                weil die Hetzner-Box dort per IP gesperrt ist (429 auf alles).
 *   local      — braucht Liquipedia nicht (fremde API / Riot / nur DB) und
 *                laeuft weiter auf der Box.
 *   both       — muss in BEIDEN Laeufen ans Ende. Betrifft nur die
 *                Klassifikation: sie liest alles Vorherige, und ohne sie
 *                tragen frisch angelegte Rows tagelang classification=NULL,
 *                was die API als "inactive" bucketet.
 */
const PIPELINE_STEPS = [
  // Discovery — findet Liquipedia-Seiten, die wir noch nicht haben (v.a. CN/KR).
  { script: 'crawl-tft-pro-categories.mjs', args: [], group: 'liquipedia' },
  // Haupt-Ingest: parst Category:Players, loest Riot-IDs auf.
  { script: 'crawl-tft-pro-players.mjs', args: [], group: 'liquipedia' },
  // TPC-Roster-Overlay — stempelt tpc_verified. MUSS vor enrich-history
  // laufen, sonst haben frisch gestempelte TPC-Pros keine tournament_results
  // und loesen den Anomalie-Detektor aus.
  { script: 'crawl-tft-tpc-roster.mjs', args: [], group: 'liquipedia' },
  // Turnier-Historie + Preisgelder pro Spieler. Teuerster Schritt: Liquipedia
  // erlaubt fuer action=parse nur 1 Request / 30 Sekunden.
  //
  // Deshalb zweistufig. Der flache Durchgang holt nur die Hauptseite (Bild,
  // Team, Infobox-Gesamtpreisgeld) — 30s pro Spieler. Die volle Historie
  // liegt auf der /Results-Unterseite und kostet 30s extra; die bekommen pro
  // Lauf nur die 10 Spieler mit der aeltesten Historie, in Rotation.
  //
  // Budget: 80 × 30s + 10 × 30s ≈ 45 Minuten.
  { script: 'enrich-tft-pro-history.mjs', args: ['--max', '80', '--deep-max', '10'], group: 'liquipedia' },
  // Top-Earners-Gegenprobe von der Portal-Seite. Billig (1 Request).
  { script: 'crawl-tft-pro-portal-stats.mjs', args: [], group: 'liquipedia' },
  // Optionaler EsportsEarnings-Abgleich; skippt still ohne API-Key.
  { script: 'enrich-tft-esportsearnings.mjs', args: [], group: 'local' },
  // Live-Rang via Riot League-V1 — treibt die Streamer-Einstufung.
  { script: 'validate-tft-pro-rank.mjs', args: [], group: 'local' },
  // Endgueltige Einstufung — nutzt alles Vorherige.
  { script: 'classify-tft-pros.mjs', args: [], group: 'both' },
];

function stepsFor(filter) {
  if (filter === 'all') return PIPELINE_STEPS;
  if (filter !== 'liquipedia' && filter !== 'local') {
    console.error(`Unknown --steps=${filter} (erwartet: all | liquipedia | local)`);
    process.exit(1);
  }
  return PIPELINE_STEPS.filter((s) => s.group === filter || s.group === 'both');
}

async function modeWeeklyFull() {
  console.log(`[weekly-full] Pipeline start — run ${RUN_ID}  (steps=${STEPS_FILTER})`);
  const steps = stepsFor(STEPS_FILTER);
  const touchesLiquipedia = steps.some((s) => s.group === 'liquipedia');
  // Sammelt Step-Fehler, damit sie denselben GH-Issue-Pfad nehmen wie die
  // Anomalien. Vorher landeten sie nur per logEvent() in der DB und wurden
  // vom severity>=4-Filter nie gesehen — es gab noch nie ein Issue.
  const criticalEvents = [];

  // Der Cooldown-Guard gilt NUR fuer den Liquipedia-Lauf. Auf der Box (steps=
  // local) faesst kein Schritt mehr Liquipedia an; ein dort herumliegender
  // Cooldown wuerde sonst Rang-Check und Klassifikation mit abwuergen. Die
  // Cooldown-Datei liegt in tmpdir() und ueberlebt keinen Reboot — dieses
  // Verhalten waere also noch dazu nicht-deterministisch.
  if (touchesLiquipedia) {
    try {
      const { cooldownStatus } = await import('./lib/liquipedia-tft.mjs');
      const c = cooldownStatus();
      if (c.active) {
        // Frueher ein stilles `return` mit Exit 0 — der Lauf sah gruen aus,
        // obwohl er nichts getan hat. Jetzt laut.
        const detail = `weekly-full abgebrochen: Liquipedia-Cooldown noch ${c.minutesRemaining}min aktiv (bis ${new Date(c.until).toISOString()})`;
        console.error(`[weekly-full] ABORTED — ${detail}`);
        const ev = { source: 'pipeline', status: 'error', field: 'identity', severity: 4, detail };
        await logEvent(ev);
        criticalEvents.push({ ...ev, proName: 'pipeline' });
        process.exitCode = 1;
        await modeAnomaliesOnly(criticalEvents);
        return;
      }
    } catch {}
  }
  console.log(`[weekly-full] ${steps.length} Schritt(e): ${steps.map((s) => s.script).join(', ')}`);

  let failed = 0;
  for (const { script, args: stepArgs } of steps) {
    console.log(`\n[weekly-full] running ${script}…`);
    const ok = runSubScript(script, stepArgs);
    if (!ok) {
      failed++;
      const ev = {
        source: 'pipeline', status: 'error', field: 'identity', severity: 4,
        detail: `Step ${script} failed`,
      };
      await logEvent(ev);
      criticalEvents.push({ ...ev, proName: 'pipeline' });
      console.error(`Step ${script} failed — continuing with next`);
    }
  }

  // Der wichtigste Check: hat ein Liquipedia-Schritt WAEHREND des Laufs einen
  // Cooldown bewaffnet? Genau das passierte am 31.07. — der Start-Guard liess
  // durch, Schritt 1 lief in 429, und alle folgenden Schritte servierten
  // stillschweigend Cache. Sub-Scripts terminieren dabei mit 0, Exit-Codes
  // allein wuerden das also nie aufdecken.
  if (touchesLiquipedia) {
    try {
      const { cooldownStatus } = await import('./lib/liquipedia-tft.mjs');
      const c = cooldownStatus();
      if (c.active) {
        const detail = `Liquipedia-Cooldown wurde WAEHREND des Laufs bewaffnet (noch ${c.minutesRemaining}min) — die folgenden Schritte haben nur Cache serviert, die Daten sind unvollstaendig`;
        console.error(`[weekly-full] ${detail}`);
        const ev = { source: 'pipeline', status: 'error', field: 'identity', severity: 5, detail };
        await logEvent(ev);
        criticalEvents.push({ ...ev, proName: 'pipeline' });
        failed++;
      }
    } catch {}
  }

  // Freshness-Gate: der Box-Lauf ist der einzige Watchdog fuer die
  // Actions-Seite. GitHub-`schedule`-Crons werden unter Last verzoegert oder
  // ganz ausgelassen, und Actions kennt kein Persistent=true — ein verpasster
  // Sonntag hiesse sonst eine Woche keine Liquipedia-Daten ohne jedes Signal.
  // last_enriched_at ist dafuer das praeziseste Feld: nur der Liquipedia-Lauf
  // schreibt es.
  if (!touchesLiquipedia) {
    try {
      const [newest] = await sb('tft_pro_players?select=last_enriched_at&last_enriched_at=not.is.null&order=last_enriched_at.desc&limit=1');
      const ts = newest?.last_enriched_at ? Date.parse(newest.last_enriched_at) : NaN;
      const ageDays = Number.isNaN(ts) ? Infinity : (Date.now() - ts) / 86_400_000;
      if (ageDays > LIQUIPEDIA_FRESHNESS_MAX_DAYS) {
        const detail = Number.isNaN(ts)
          ? 'Kein einziger Pro traegt last_enriched_at — der Liquipedia-Lauf (GitHub Actions) hat noch nie geschrieben'
          : `Juengster Liquipedia-Lauf ist ${ageDays.toFixed(1)} Tage alt (Grenze ${LIQUIPEDIA_FRESHNESS_MAX_DAYS}) — der woechentliche GitHub-Actions-Job faellt vermutlich aus`;
        console.error(`[weekly-full] ${detail}`);
        const ev = { source: 'pipeline', status: 'error', field: 'identity', severity: 4, detail };
        await logEvent(ev);
        criticalEvents.push({ ...ev, proName: 'pipeline' });
        failed++;
      } else {
        console.log(`[weekly-full] Liquipedia-Frische ok: juengster Lauf vor ${ageDays.toFixed(1)} Tagen`);
      }
    } catch (e) {
      console.error(`[weekly-full] Freshness-Gate konnte nicht pruefen: ${e.message}`);
    }
  }

  // Final anomaly scan after enrichment
  await modeAnomaliesOnly(criticalEvents);

  if (failed > 0) {
    console.error(`[weekly-full] ${failed} Schritt(e) fehlgeschlagen — Exit 1`);
    // Type=oneshot respektiert das: der systemd-Service geht auf failed, und
    // erst dadurch greift ueberhaupt ein OnFailure=. Vorher endete auch ein
    // komplett leergelaufener Lauf mit Result=success.
    process.exitCode = 1;
  }
}

async function modeDailySample() {
  // Pick N pros prioritized by last_full_validation_at (oldest first) +
  // some randomness so freshly-validated rows don't dominate.
  const candidates = await sb(`tft_pro_players?select=puuid,pro_name,last_full_validation_at&order=last_full_validation_at.asc.nullsfirst&limit=${SAMPLE_SIZE * 3}`);
  // Shuffle then take SAMPLE_SIZE
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const sample = candidates.slice(0, SAMPLE_SIZE);
  console.log(`[daily-sample] selected ${sample.length} pros`);

  // For each, re-run the classifier so any classification drift is caught.
  // Heavy cross-source checks (Liquipedia HTML re-parse) only happen in
  // weekly-full to avoid pounding Liquipedia daily.
  for (const p of sample) {
    if (VERBOSE) console.log(`  ${p.pro_name}`);
  }
  console.log('[daily-sample] reclassifying sampled pros…');
  runSubScript('classify-tft-pros.mjs', []);
  await modeAnomaliesOnly();
}

/**
 * @param extraCritical Pipeline-Fehler aus modeWeeklyFull. Die wurden frueher
 *   nur per logEvent() in die DB geschrieben und landeten NICHT in diesem
 *   Array — der severity>=4-Filter unten hat sie also nie gesehen. Da kein
 *   einziger Anomalie-Detektor je ueber 3 hinausgeht (Maximum: die
 *   classification-Anomalie mit 3), hat --open-issues strukturell noch NIE
 *   ein Issue erzeugt. Verifiziert: `gh issue list --label pro-watchdog
 *   --state all` war leer.
 */
async function modeAnomaliesOnly(extraCritical = []) {
  console.log(`[anomalies-only] scanning…`);
  const anomalies = await detectAnomalies();
  console.log(`Found ${anomalies.length} anomaly events`);
  const bySev = {};
  for (const a of anomalies) {
    bySev[a.severity] = (bySev[a.severity] || 0) + 1;
    await logEvent(a);
  }
  for (const [sev, n] of Object.entries(bySev).sort()) console.log(`  severity ${sev}: ${n}`);

  // Open GH Issues for critical anomalies if requested.
  if (OPEN_GH_ISSUES) {
    const critical = [...anomalies, ...extraCritical].filter(a => a.severity >= 4);
    if (critical.length > 0 && !process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
      // Sonst verschwindet ein fehlendes Token lautlos und der einzige
      // Alarmkanal ist wieder tot, ohne dass es jemand merkt.
      console.error(`[anomalies-only] ${critical.length} kritische Events, aber weder GH_TOKEN noch GITHUB_TOKEN gesetzt — kein Issue moeglich`);
    }
    for (const c of critical) {
      const title = `[pro-watchdog] ${c.proName || c.puuid}: ${c.detail.slice(0, 60)}`;
      const body = `**Run ID:** ${RUN_ID}\n**Pro:** ${c.proName}\n**Source:** ${c.source}\n**Field:** ${c.field}\n**Detail:** ${c.detail}\n\nExpected: \`${JSON.stringify(c.expected)}\`\nActual: \`${JSON.stringify(c.actual)}\``;
      const r = spawnSync('gh', ['issue', 'create', '--title', title, '--body', body, '--label', 'pro-watchdog'], { stdio: 'inherit' });
      // Rueckgabestatus wurde frueher ignoriert: ein fehlendes `gh` (ENOENT)
      // auf der Box verschwand spurlos.
      if (r.error || r.status !== 0) {
        console.error(`  gh issue create fehlgeschlagen: ${r.error?.message || `exit ${r.status}`}`);
      }
    }
  }
}

async function modeAutoHeal() {
  // Find recent warnings that auto-heal-eligible scripts can address.
  const open = await sb('tft_pro_validation_log?select=id,puuid,source,field,severity,detail&resolved_at=is.null&severity=lte.2&order=detected_at.desc&limit=50');
  console.log(`[auto-heal] ${open.length} open warnings — re-running enrich-history for affected pros`);
  // Auto-heal: re-run enrich-tft-pro-history for affected pros. The script
  // itself is idempotent and respects the Liquipedia ToU delay.
  const affected = [...new Set(open.filter(e => e.field === 'tournament').map(e => e.puuid).filter(Boolean))];
  if (affected.length > 0) {
    console.log(`  re-enriching ${affected.length} pros…`);
    // Currently no per-pro mode in enrich script — runs all. Future improvement
    // would take --player arg. For now we just queue them for the next full run.
    for (const id of open) {
      await sb(`tft_pro_validation_log?id=eq.${id.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolution: 'queued_for_enrich' }),
      });
    }
  }
  await modeAnomaliesOnly();
}

// ─── main ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`=== TFT Pro Watchdog ===`);
  console.log(`Mode: ${MODE}  |  Run: ${RUN_ID}`);

  switch (MODE) {
    case 'daily-sample':   return modeDailySample();
    case 'weekly-full':    return modeWeeklyFull();
    case 'anomalies-only': return modeAnomaliesOnly();
    case 'auto-heal':      return modeAutoHeal();
    default:
      console.error(`Unknown mode: ${MODE}`);
      process.exit(1);
  }
}

main().catch(err => { console.error('FATAL:', err.message); console.error(err.stack); process.exit(1); });
