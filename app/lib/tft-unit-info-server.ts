import 'server-only';
// Faehigkeit + Grundwerte fuer die Unit-Detailseite (liest
// public/tft-unit-info-{set}.json von der Platte). Der Browser laedt dieselbe
// Datei ueber loadUnitInfo in tft-unit-info.ts.
//
// Die Seite bekommt nur ihre Unit samt Formen (alle 6 Sprachen), damit die
// Karte im ersten HTML steht und der Sprachwechsel ohne Neuladen geht. Die
// Datei muss per outputFileTracingIncludes in die Funktion (next.config.ts).
import { readFileSync } from 'fs';
import path from 'path';
import { CURRENT_SET } from './current-set';
import type { UnitInfoFile } from './tft-unit-info';

let infoCache: { set: number; file: UnitInfoFile | null } | null = null;

function loadUnitInfoFromDisk(): UnitInfoFile | null {
  if (infoCache?.set === CURRENT_SET) return infoCache.file;
  let file: UnitInfoFile | null = null;
  try {
    const p = path.join(process.cwd(), 'public', `tft-unit-info-${CURRENT_SET}.json`);
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as UnitInfoFile;
    // Texte eines anderen Sets waeren schlimmer als keine.
    if (Number(parsed.set) === CURRENT_SET && parsed.units) file = parsed;
  } catch {
    // Datei fehlt — der Browser holt sie nach.
  }
  infoCache = { set: CURRENT_SET, file };
  return file;
}

// Teil-Datei mit der Unit und ihren Formen (eine Form bringt Basis und
// Geschwister mit). Leer, wenn die Unit keinen Eintrag hat; null nur, wenn die
// Datei selbst fehlt.
export function unitInfoSubset(id: string): UnitInfoFile | null {
  const all = loadUnitInfoFromDisk();
  if (!all) return null;
  const entry = all.units[id];
  const baseId = entry?.formOf ?? id;
  const ids = [baseId, ...(all.units[baseId]?.forms ?? [])];
  const units: UnitInfoFile['units'] = {};
  for (const k of ids) if (all.units[k]) units[k] = all.units[k];
  return { set: all.set, source: all.source, fetchedAt: all.fetchedAt, units };
}
