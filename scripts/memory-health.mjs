#!/usr/bin/env node
/**
 * Memory-Health-Report — vier Verfallsfragen in einem Lauf.
 *
 * Ersetzt die im Plan (.claude/plan-current.md, B6) vorgesehenen
 * Dataview-Dashboards: auf dieser Maschine existiert weder ein Obsidian-Vault
 * noch das Dataview-Plugin (gemessen 2026-09-01: Suche nach `.obsidian` leer,
 * der Memory-Ordner ist ein Symlink nach Dropbox/Metastats/claude-memory).
 * Ein Dataview-Block waere toter Text — genau die Klasse Attrappe, die dieser
 * Plan abbaut. Derselbe Inhalt als Report, der auch ohne GUI laeuft.
 *
 * Exit-Code 0 = alles im Rahmen, 1 = mindestens ein Befund.
 * `--quiet` gibt nur Befunde aus, nichts sonst.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const MEM = join(HOME, '.claude', 'projects', 'C--Users-dtaub-metastats', 'memory');
const RULES = join(process.cwd(), '.claude', 'rules');
const MARKER = join(HOME, '.claude', 'agentdb', 'last-index.json');

// Schwellen. PART_LIMIT spiegelt _build-bundle.mjs:85 — dort bricht der Build
// hart ab; hier warnen wir vorher, damit es nicht erst beim Bundle-Bau auffaellt.
const PART_LIMIT = 40_000;
const PART_WARN = Math.round(PART_LIMIT * 0.8);
const OVERDUE_DAYS = 120;
const INDEX_STALE_DAYS = 3;

const quiet = process.argv.includes('--quiet');
const findings = [];
const lines = [];
const say = (s) => { if (!quiet) lines.push(s); };
const DAY = 86_400_000;
const ageDays = (t) => Math.floor((Date.now() - t) / DAY);

if (!existsSync(MEM)) {
  console.error(`[memory-health] Memory-Ordner fehlt: ${MEM}`);
  process.exit(1);
}

const files = readdirSync(MEM)
  .filter((f) => f.endsWith('.md') && f !== 'MEMORY.md' && !f.startsWith('_'));
const read = new Map(files.map((f) => [f, readFileSync(join(MEM, f), 'utf8')]));

// ---------------------------------------------------------------- 1. ueberfaellig
// `modified:` steht im Frontmatter, teils flach, teils unter `metadata:`.
// Fehlt es, faellt die Datei auf die mtime zurueck — B6 hat es in 48 Dateien
// ergaenzt, neue koennen es wieder verlieren.
const overdue = [];
let withoutModified = 0;
for (const [f, body] of read) {
  const m = body.match(/^\s*modified:\s*(\S+)/m);
  if (!m) withoutModified++;
  const stamp = m ? Date.parse(m[1]) : statSync(join(MEM, f)).mtimeMs;
  if (Number.isFinite(stamp) && ageDays(stamp) > OVERDUE_DAYS) {
    overdue.push({ f, days: ageDays(stamp) });
  }
}
overdue.sort((a, b) => b.days - a.days);
say(`ueberfaellig (>${OVERDUE_DAYS} Tage): ${overdue.length} von ${files.length}`);
for (const o of overdue.slice(0, 10)) say(`  ${o.days} Tage  ${o.f}`);
if (overdue.length > 10) say(`  ... und ${overdue.length - 10} weitere`);
if (withoutModified) findings.push(`${withoutModified} Datei(en) ohne modified: im Frontmatter`);

// -------------------------------------------------------------- 2. Bundle-Groesse
// Die ausgelieferten Regeln sind die tier1-*.md in .claude/rules — nicht mehr
// das Bundle selbst (B3). Gegen dieselbe Grenze pruefen wie der Build.
if (existsSync(RULES)) {
  const parts = readdirSync(RULES).filter((f) => f.endsWith('.md'));
  let total = 0;
  for (const p of parts) {
    const bytes = statSync(join(RULES, p)).size;
    total += bytes;
    if (bytes > PART_LIMIT) findings.push(`${p}: ${bytes} > Grenze ${PART_LIMIT} — _build-bundle.mjs bricht ab`);
    else if (bytes > PART_WARN) findings.push(`${p}: ${bytes} nahe der Grenze ${PART_LIMIT}`);
  }
  say(`Regeln im Prefix: ${parts.length} Teile, ${(total / 1024).toFixed(1)} KB, groesster Teil unter ${PART_LIMIT}`);
} else {
  findings.push(`.claude/rules fehlt — die Regeln kommen nicht im Prefix an`);
}

// -------------------------------------------------------------- 3. Index-Frische
if (existsSync(MARKER)) {
  const mk = JSON.parse(readFileSync(MARKER, 'utf8'));
  const days = ageDays(Date.parse(mk.at));
  say(`Vector-Index: ${days} Tage alt, ${mk.files} Dateien, ${mk.sections} Sektionen`);
  if (days > INDEX_STALE_DAYS) findings.push(`Vector-Index ${days} Tage alt (Schwelle ${INDEX_STALE_DAYS})`);
} else {
  findings.push(`Vector-Index nie gelaufen — kein Marker unter ${MARKER}`);
}

// ------------------------------------------------------------------ 4. Backlinks
// Zwei Richtungen: (a) Datei existiert, ist aber in MEMORY.md nicht verlinkt —
// sie wird nie geladen. (b) Wikilink zeigt auf eine Datei, die es nicht gibt.
const index = readFileSync(join(MEM, 'MEMORY.md'), 'utf8');
const linkedFromIndex = new Set(
  [...index.matchAll(/\]\(([^)]+\.md)\)/g)].map((m) => m[1].split('/').pop()),
);
const orphans = files.filter((f) => !linkedFromIndex.has(f));
say(`ohne Eintrag in MEMORY.md: ${orphans.length}`);
for (const o of orphans) say(`  ${o}`);
if (orphans.length) findings.push(`${orphans.length} Datei(en) ohne Eintrag in MEMORY.md`);

const known = new Set(files.map((f) => f.replace(/\.md$/, '')));
const broken = new Set();
for (const [f, body] of read) {
  for (const m of body.matchAll(/\[\[([^\]|#]+)/g)) {
    const t = m[1].trim().replace(/\.md$/, '');
    if (!known.has(t)) broken.add(`${t}  (in ${f})`);
  }
}
say(`kaputte Wikilinks: ${broken.size}`);
for (const b of broken) say(`  ${b}`);
if (broken.size) findings.push(`${broken.size} kaputte(r) Wikilink(s)`);

// ------------------------------------------------------- 5. Tier-1-Index-Drift
// Steht eine Regel in der Tier-1-Sektion von MEMORY.md, aber nicht in den
// ausgelieferten .claude/rules, dann glaubt der Index, sie sei aktiv — und sie
// kommt nie an. Genau diese Luecke war der Anlass fuer den ganzen Umbau.
const tier1Block = index.split(/^##\s+Tier 2/m)[0].split(/^##\s+Tier 1/m)[1] || '';
const tier1Files = [...tier1Block.matchAll(/\]\(([^)]+\.md)\)/g)].map((m) => m[1].split('/').pop());
if (existsSync(RULES)) {
  const delivered = readdirSync(RULES)
    .filter((f) => f.startsWith('tier1-'))
    .map((f) => readFileSync(join(RULES, f), 'utf8'))
    .join('\n');
  const missing = [];
  for (const f of tier1Files) {
    const body = read.get(f);
    if (!body) { missing.push(`${f} (Datei fehlt)`); continue; }
    const nm = body.match(/^\s*name:\s*(.+)$/m);
    const needle = (nm ? nm[1] : '').trim().replace(/^["']|["']$/g, '');
    if (!needle || !delivered.includes(needle)) missing.push(f);
  }
  say(`Tier-1-Regeln in MEMORY.md: ${tier1Files.length}, davon nicht ausgeliefert: ${missing.length}`);
  for (const m of missing) say(`  ${m}`);
  if (missing.length) findings.push(`${missing.length} Tier-1-Regel(n) nicht in .claude/rules — Run: node _build-bundle.mjs`);
}

// ---------------------------------------------------------------------- Ausgabe
if (lines.length) console.log(lines.join('\n'));
if (findings.length) {
  console.log(`\n[memory-health] ${findings.length} Befund(e):`);
  for (const f of findings) console.log(`  - ${f}`);
  process.exit(1);
}
if (!quiet) console.log('\n[memory-health] ohne Befund.');
