#!/usr/bin/env node
/**
 * Stoesst faellige GitHub-Workflows puenktlich an (workflow_dispatch).
 *
 * Warum: GitHub startet die Zeitplaene seit 02.11.2026 Stunden zu spaet oder gar
 * nicht (gemessen 08.11.: tft-data-refresh am 07.11. 4 statt 8 Laeufe,
 * tft-icon-mirror 5 statt 24, metatft-comps-daily 12:07 statt 05:30 UTC). Die
 * Box laeuft puenktlich. Dieses Skript laeuft dort alle 5 Minuten (cron), liest
 * die `cron:`-Zeilen direkt aus den Workflow-Dateien des Box-Checkouts (keine
 * zweite Zeitplan-Liste) und startet jeden Workflow, dessen Termin in den
 * letzten LOOKBACK_MIN Minuten lag und fuer den seit dem Termin noch kein Lauf
 * existiert. Kommt GitHubs eigener Zeitplan spaeter hinterher, ueberspringt ihn
 * der gate-Job im Workflow.
 *
 *   node scripts/gh-dispatch-due.mjs              # echt (GH_DISPATCH_TOKEN oder GH_TOKEN mit Actions: write)
 *   node scripts/gh-dispatch-due.mjs --dry-run [--at 2026-11-08T02:17:30Z]
 *   node scripts/gh-dispatch-due.mjs --probe     # prueft nur, ob der Schluessel anstossen darf
 *
 * Notaus: Datei /var/lib/metastats/gh-dispatch.off anlegen.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'Dota1337/metastats';
const STATE_DIR = process.env.GH_DISPATCH_STATE_DIR || '/var/lib/metastats';
const STATE_FILE = join(STATE_DIR, 'gh-dispatch.json');
const LOOKBACK_MIN = 6;

// Workflows, deren Uhrzeit zaehlt. inputs je cron-Zeile, wo der Zeitplan einen
// eigenen Modus hat (Donnerstags-Refresh der Bilder-Kopie).
export const DISPATCH = {
  'tft-data-refresh.yml': {},
  'tft-bpatch-detect.yml': {},
  'metatft-comps-daily.yml': {},
  'tft-icon-mirror.yml': { '40 3 * * 4': { refresh: true } },
  'tft-player-cache-prewarm.yml': {},
  'tft-stats-cache-warm.yml': {},
};

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const atArg = args.includes('--at') ? args[args.indexOf('--at') + 1] : null;
const NOW = atArg ? new Date(atArg) : new Date();

/** cron-Zeilen aus der Workflow-Datei (nur aktive, keine Kommentare). */
export function cronsOf(yml) {
  const out = [];
  for (const line of yml.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*cron:\s*['"]([^'"]+)['"]/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

function fieldMatches(field, value, min) {
  if (field === '*') return true;
  for (const part of field.split(',')) {
    const step = part.match(/^\*\/(\d+)$/);
    if (step) { if ((value - min) % Number(step[1]) === 0) return true; continue; }
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) { if (value >= Number(range[1]) && value <= Number(range[2])) return true; continue; }
    if (/^\d+$/.test(part)) { if (Number(part) === value) return true; continue; }
    throw new Error(`cron-Feld nicht unterstuetzt: ${field}`);
  }
  return false;
}

/** Trifft der cron-Ausdruck (UTC, 5 Felder) diese Minute? */
export function cronMatches(expr, d) {
  const f = expr.split(/\s+/);
  if (f.length !== 5) throw new Error(`cron nicht 5-teilig: ${expr}`);
  const [mi, h, dom, mon, dow] = f;
  if (!fieldMatches(mi, d.getUTCMinutes(), 0) || !fieldMatches(h, d.getUTCHours(), 0)) return false;
  if (!fieldMatches(mon, d.getUTCMonth() + 1, 1)) return false;
  // Wie cron: sind Tag UND Wochentag eingeschraenkt, reicht einer.
  const domOk = fieldMatches(dom, d.getUTCDate(), 1);
  const dowOk = fieldMatches(dow, d.getUTCDay(), 0);
  return dom !== '*' && dow !== '*' ? domOk || dowOk : domOk && dowOk;
}

/** Juengster Termin im Fenster (now - lookback, now], sonst null. */
export function dueSlot(expr, now, lookbackMin = LOOKBACK_MIN) {
  const t = new Date(now);
  t.setUTCSeconds(0, 0);
  for (let i = 0; i < lookbackMin; i++) {
    const d = new Date(t.getTime() - i * 60_000);
    if (cronMatches(expr, d)) return d;
  }
  return null;
}

// Schluessel: GH_DISPATCH_TOKEN (eigener, Actions: write) vor GH_TOKEN; ohne
// Umgebung aus der Env-Datei der Box gelesen, damit die cron-Zeile nichts
// sourcen muss. Der Wert wird nie ausgegeben.
export function loadToken() {
  const fromEnv = process.env.GH_DISPATCH_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;
  const f = process.env.GH_DISPATCH_ENV_FILE || '/etc/metastats-crawler/env';
  if (!existsSync(f)) return null;
  const env = {};
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env.GH_DISPATCH_TOKEN || env.GH_TOKEN || null;
}
let TOKEN = null;

async function gh(path, { method = 'GET', body } = {}) {
  const token = TOKEN;
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  return res;
}

async function main() {
  if (existsSync(join(STATE_DIR, 'gh-dispatch.off'))) { console.log('Notaus gesetzt, Ende'); return; }
  if (!DRY) {
    TOKEN = loadToken();
    if (!TOKEN) throw new Error('weder GH_DISPATCH_TOKEN noch GH_TOKEN gefunden');
  }
  if (args.includes('--probe')) {
    // Darf der Schluessel anstossen? Anstoss auf einen Zweig, den es nicht gibt:
    // 422 = Recht vorhanden (Zweig fehlt), 403/404 = kein Recht. Startet nichts.
    const res = await gh(`/repos/${REPO}/actions/workflows/tft-icon-mirror.yml/dispatches`, {
      method: 'POST', body: { ref: `probe-gibt-es-nicht-${Date.now()}` },
    });
    if (res.status === 422) console.log('Schluessel darf anstossen (HTTP 422: Zweig fehlt, Recht vorhanden)');
    else if (res.status === 403 || res.status === 404) { console.log(`Schluessel darf NICHT anstossen (HTTP ${res.status})`); process.exitCode = 1; }
    else { console.log(`unklar: HTTP ${res.status}`); process.exitCode = 1; }
    return;
  }
  const state =existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
  let changed = false;
  let failures = 0;

  for (const [file, inputsByCron] of Object.entries(DISPATCH)) {
    const yml = readFileSync(join(ROOT, '.github', 'workflows', file), 'utf8');
    for (const expr of cronsOf(yml)) {
      const slot = dueSlot(expr, NOW);
      if (!slot) continue;
      const key = `${file}|${expr}`;
      if (state[key] && Date.parse(state[key]) >= slot.getTime()) continue;   // schon angestossen
      const inputs = inputsByCron[expr];
      if (DRY) { console.log(`[trocken] ${file} (${expr}) faellig ${slot.toISOString()}${inputs ? ' mit ' + JSON.stringify(inputs) : ''}`); continue; }

      // Lief seit dem Termin schon etwas (GitHub puenktlich, Handstart)? Dann nicht doppelt.
      const since = new Date(slot.getTime() - 2 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const list = await gh(`/repos/${REPO}/actions/workflows/${file}/runs?created=%3E%3D${since}&per_page=5`);
      if (!list.ok) { console.error(`${file}: Laufliste HTTP ${list.status}`); failures++; continue; }
      const runs = (await list.json()).workflow_runs || [];
      const exp = list.headers.get('github-authentication-token-expiration');
      if (exp && Date.parse(exp) - Date.now() < 14 * 86_400_000) console.warn(`! GH_TOKEN laeuft ab: ${exp}`);
      if (runs.length > 0) {
        console.log(`${file}: seit ${since} schon ${runs.length} Lauf/Laeufe (${runs[0].event}), kein Anstoss`);
      } else {
        const res = await gh(`/repos/${REPO}/actions/workflows/${file}/dispatches`, {
          method: 'POST',
          body: { ref: 'main', ...(inputs ? { inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, String(v)])) } : {}) },
        });
        if (res.status !== 204) { console.error(`${file}: Anstoss HTTP ${res.status}`); failures++; continue; }
        console.log(`${file}: angestossen fuer ${slot.toISOString()}${inputs ? ' mit ' + JSON.stringify(inputs) : ''}`);
      }
      state[key] = slot.toISOString();
      changed = true;
    }
  }
  if (changed && !DRY) {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('Fehler:', String(e?.message || e).split(TOKEN || '\u0000').join('***')); process.exit(1); });
}
