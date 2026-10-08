// Waechter fuer die "nicht bewertet"-Zeilen (Migration 0088): jede Stelle, die
// tft_player_marketvalue_snapshots liest, muss sie ausschliessen — sonst steht
// ein abgestiegener Spieler mit Marktwert 0 in Listen, Verlaeufen und Zaehlungen.
//
// Pruefung je Fundstelle: im Umfeld (12 Zeilen davor, 25 danach) steht das Wort
// rated. Stellen, die die Tabelle nicht fuer Werte lesen, stehen unten mit Grund.
// Dazu: die jeweils juengste Definition jeder Lesefunktion in den Migrationen
// filtert ebenfalls auf rated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = 'tft_player_marketvalue_snapshots';
const BEFORE = 12;
const AFTER = 25;

// Datei (Pfad mit /) + Text, der im Umfeld der Fundstelle stehen muss.
const EXEMPT = [
  { file: 'scripts/build-explorer-store.mjs', near: 'snapSql',
    reason: 'liest nur den Rang je Tag; eine Markierung traegt den echten, frischen Rang' },
  { file: 'scripts/daily-marketvalue-snapshot.mjs', near: 'max(created_at) as newest',
    reason: 'Reihenfolge der Regionen nach Frische; auch eine Markierung ist Arbeit des Laufs' },
  { file: 'scripts/daily-marketvalue-snapshot.mjs', near: 'create table ${tbl} as',
    reason: 'Sicherungskopie vor dem Lauf, muss jede Zeile enthalten' },
  { file: 'scripts/lib/daily-crawl-post.mjs', near: 'maintenanceTables',
    reason: 'nur Name in der VACUUM-Liste' },
  { file: 'scripts/lib/daily-crawl-post.test.mjs', near: 'langsamste Tabelle zuletzt',
    reason: 'Test der VACUUM-Liste' },
  { file: 'app/components/internal/OpsGraph.tsx', near: TABLE,
    reason: 'nur Beschriftung und Kanten im Betriebsgraphen' },
  { file: 'app/api/internal/ops-snapshot/route.ts', near: 'async function fetchDbCounts',
    reason: 'Tabellenliste; die Gesamtgroesse zaehlt jede Zeile, die Tageszaehlung filtert weiter unten' },
  { file: 'scripts/refresh-api-server.mjs', near: 'async function pushToSupabase',
    reason: 'schreibt eine Zeile nach Supabase, liest nicht' },
  { file: 'scripts/sync-marketvalue-to-supabase.mjs', near: "supaUpsert('tft_player_marketvalue_snapshots'",
    reason: 'Abgleich schreibt jede Zeile samt rated nach Supabase' },
];

// Einmalskripte sind gelaufen und werden nicht wieder gestartet.
const SKIP_DIRS = new Set(['node_modules', '.next', 'oneoff']);
const SCAN = ['app', 'scripts', 'infra/hetzner'];
const EXT = /\.(ts|tsx|mjs|js|sh|sql)$/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), out);
    } else if (EXT.test(e.name)) out.push(join(dir, e.name));
  }
  return out;
}

const isComment = (line) => /^\s*(\/\/|\*|\/\*|--|#)/.test(line);

function findings() {
  const hits = [];
  for (const base of SCAN) {
    for (const abs of walk(resolve(ROOT, base))) {
      const file = relative(ROOT, abs).split('\\').join('/');
      if (file === 'scripts/check-mv-readers.test.mjs') continue;
      const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!line.includes(TABLE) || isComment(line)) return;
        const around = lines.slice(Math.max(0, i - BEFORE), i + AFTER + 1).join('\n');
        hits.push({ file, line: i + 1, around });
      });
    }
  }
  return hits;
}

test('jede Lesestelle der Marktwert-Tabelle beachtet rated (oder steht mit Grund in EXEMPT)', () => {
  const hits = findings();
  assert.ok(hits.length >= 15, `zu wenige Fundstellen (${hits.length}) — Suche kaputt?`);
  const missing = hits.filter(h =>
    !/\brated\b/.test(h.around)
    && !EXEMPT.some(x => x.file === h.file && h.around.includes(x.near)));
  assert.deepEqual(
    missing.map(h => `${h.file}:${h.line}`), [],
    'Diese Stellen lesen die Marktwert-Tabelle ohne rated-Filter. Filter ergaenzen '
    + '(erst neueste Zeile je Spieler, dann rated) oder mit Grund in EXEMPT eintragen.',
  );
});

test('EXEMPT enthaelt keine veralteten Eintraege', () => {
  const hits = findings();
  const stale = EXEMPT.filter(x => !hits.some(h => h.file === x.file && h.around.includes(x.near)));
  assert.deepEqual(stale.map(x => `${x.file} (${x.near})`), []);
});

// Lesefunktionen in Supabase: massgeblich ist die Migration mit der hoechsten
// Nummer, die die Funktion (neu) anlegt.
const RPCS = [
  'get_tft_latest_marketvalues',
  'get_tft_marketvalue_movers',
  'get_tft_marketvalue_sparklines',
  'get_tft_marketvalue_history',
  'get_tft_team_marketvalues',
];

test('juengste Definition jeder Marktwert-Lesefunktion filtert auf rated', () => {
  const dir = resolve(ROOT, 'supabase/migrations');
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const name of RPCS) {
    const head = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?${name}\\s*\\(`, 'i');
    let body = null;
    let where = null;
    for (const f of files) {
      const sql = readFileSync(join(dir, f), 'utf8');
      const m = head.exec(sql);
      if (!m) continue;
      const rest = sql.slice(m.index + m[0].length);
      const next = rest.search(/create\s+(or\s+replace\s+)?function\s/i);
      body = next < 0 ? rest : rest.slice(0, next);
      where = f;
    }
    assert.ok(body, `${name}: keine Definition gefunden`);
    assert.match(body, /\brated\b/, `${name} (zuletzt in ${where}) filtert nicht auf rated`);
  }
});
