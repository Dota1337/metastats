#!/usr/bin/env node
/**
 * Misst, welcher Anteil der gespielten Comps auf der Comp-Liste eine
 * MetaTFT-Anleitung bekommt — an der ausgelieferten Companion-Route, mit
 * derselben Bewertung wie der Laufzeit-Vertrag `metatft-comps/familien-abdeckung`
 * (scripts/lib/guide-coverage.mjs).
 *
 * Bis 08.10.2026 mass das Skript nur exakte familyMap-Treffer gegen die DB
 * (RPC get_metatft_family_coverage) und lag damit ~20 Punkte unter der Seite.
 *
 * Usage:
 *   node scripts/verify-metatft-family-coverage.mjs [--region all] [--days 3] [--base https://www.metastats.gg]
 *
 * Exit 1 nur bei Bruch (unter minRatio des Vertrags), Warnung bleibt Exit 0.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateGuideCoverage } from './lib/guide-coverage.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

async function main() {
  const contract = JSON.parse(readFileSync(resolve(ROOT, 'infra', 'contracts.json'), 'utf8'))
    .contracts.find((c) => c.id === 'metatft-comps/familien-abdeckung');
  if (!contract) throw new Error('Vertrag metatft-comps/familien-abdeckung fehlt in infra/contracts.json');

  const url = new URL(contract.url);
  const base = argVal('--base', null);
  if (base) {
    const b = new URL(base);
    url.protocol = b.protocol;
    url.host = b.host;
  }
  url.searchParams.set('region', argVal('--region', url.searchParams.get('region')));
  url.searchParams.set('days', argVal('--days', url.searchParams.get('days')));

  const setJson = JSON.parse(readFileSync(resolve(ROOT, 'public', 'tft-set.json'), 'utf8'));
  const set = Number(setJson.set ?? setJson.setNumber ?? setJson.current);

  console.log(`MetaTFT-Anleitungs-Abdeckung (Set ${set}): ${url}\n`);
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();

  const out = evaluateGuideCoverage(body, {
    set,
    minRatio: contract.minRatio,
    warnRatio: contract.warnRatio,
    minFamilies: contract.minFamilies,
    maxAgeHours: contract.maxAgeHours,
  });
  console.log(`  Ergebnis           : ${out.status} — ${out.detail}`);
  const cov = out.coverage;
  if (cov) {
    console.log(`  Comps mit Anleitung: ${cov.coveredFamilies}/${cov.families}`);
    console.log(`  Spiele abgedeckt   : ${cov.coveredGames}/${cov.totalGames}`);
    console.log(`  Rang / Fenster     : ${body.filters?.bucket} / ${body.filters?.days} Tage, Region ${body.filters?.region}`);
    if (cov.gaps.length) {
      console.log('\n  ohne Anleitung:');
      for (const g of cov.gaps.slice(0, 15)) console.log(`    ${String(g.games).padStart(7)}  ${g.name}`);
    }
  }
  if (out.status === 'broken') process.exit(1);
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
