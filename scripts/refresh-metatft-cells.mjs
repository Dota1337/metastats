#!/usr/bin/env node
/**
 * Holt MetaTFTs Feld-Zahlen je Unit und schreibt public/tft-metatft-cells-{set}.json.
 *
 * Gebraucht vom Comp-Builder: beim Ziehen einer Unit stehen auf jedem leeren Feld
 * Haeufigkeit und Top-4-Quote dieser Unit auf diesem Feld (User 2026-10-26, Vorbild
 * MetaTFT-Team-Builder). Riot liefert keine Positionen, eigene Companion-Daten sind
 * zu duenn — deshalb MetaTFT.
 *
 * Endpunkt (aus MetaTFTs Frontend-Bundle, MyTeams-Chunk, kein offizieller Vertrag):
 *   https://api-hc.metatft.com/tft-stat-api/positions   ohne Parameter
 * Gatter und Bedeutung der Felder: scripts/lib/metatft-cells.mjs. Bei jedem Abbruch
 * bleibt die alte Datei liegen; der Vertrag metatft-cells/datei-frische meldet es.
 *
 * Usage:
 *   node scripts/refresh-metatft-cells.mjs
 *   node scripts/refresh-metatft-cells.mjs --dry-run
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCurrentSet } from './lib/current-set.mjs';
import { buildCells } from './lib/metatft-cells.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY_RUN = process.argv.includes('--dry-run');

const URL_POSITIONS = 'https://api-hc.metatft.com/tft-stat-api/positions';
// Gleicher identifizierbarer User-Agent wie der Comps-Import.
const UA = 'metastats.gg comp-importer (+https://metastats.gg)';
const CALL_TIMEOUT_MS = 15_000;

async function main() {
  const set = loadCurrentSet(ROOT);
  if (!Number.isFinite(Number(set))) throw new Error('Set aus public/tft-set.json nicht lesbar');
  console.log(`=== MetaTFT-Feld-Zahlen für Set ${set} ===`);

  const assetsPath = resolve(ROOT, 'public', `tft-assets-${set}.json`);
  const champions = JSON.parse(readFileSync(assetsPath, 'utf8')).champions;
  if (!champions || typeof champions !== 'object') throw new Error(`${assetsPath} ohne champions`);

  const res = await fetch(URL_POSITIONS, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`positions: HTTP ${res.status}`);
  const raw = await res.json();
  // Wie bei tft-comps-api: Fehler kommen mit HTTP 200 und einem error-Feld.
  if (raw && typeof raw === 'object' && typeof raw.error === 'string') {
    throw new Error(`positions: API meldet "${raw.error}"`);
  }

  const outPath = resolve(ROOT, 'public', `tft-metatft-cells-${set}.json`);
  let previousTotal = 0;
  if (existsSync(outPath)) {
    try { previousTotal = Number(JSON.parse(readFileSync(outPath, 'utf8')).total) || 0; } catch { /* Vorlauf unlesbar */ }
  }

  const { units, total, sourceUpdated, stats } = buildCells(raw, { champions, previousTotal });
  console.log(`  ${stats.rows} Zeilen, ${stats.invalid} ungültig, ${(stats.setSharePermille / 10).toFixed(1)} % auf Set-${set}-Units`);
  console.log(`  ${units.length} Units, ${total} Beobachtungen (zuvor ${previousTotal || '–'}), Quelle ${sourceUpdated}`);

  const payload = {
    set,
    source: 'metatft.com (tft-stat-api/positions)',
    fetchedAt: new Date().toISOString(),
    sourceUpdated,
    total,
    units,
  };
  const body = JSON.stringify(payload) + '\n';

  if (DRY_RUN) {
    console.log(`  [dry-run] nichts geschrieben, ${(body.length / 1024).toFixed(0)} KB roh`);
    return;
  }
  // Atomar: erst daneben schreiben, dann umbenennen.
  const tmpPath = `${outPath}.tmp`;
  writeFileSync(tmpPath, body);
  renameSync(tmpPath, outPath);
  console.log(`  -> public/tft-metatft-cells-${set}.json (${(body.length / 1024).toFixed(0)} KB)`);
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
