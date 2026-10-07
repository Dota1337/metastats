// MetaTFT-Comp-Datei des laufenden Sets fuer Server-Routen (liest von der
// Platte). Der Browser laedt dieselbe Datei ueber loadCompGuidesBundle in
// tft-comp-guides.ts; die Zuordnung (resolveGuideId) ist fuer beide dieselbe.
import { readFileSync } from 'fs';
import path from 'path';
import { CURRENT_SET } from './current-set';
import type { CompGuidesBundle } from './tft-comp-guides';

let guidesCache: { set: number; file: CompGuidesBundle | null } | null = null;

export function loadGuidesFromDisk(): CompGuidesBundle | null {
  if (guidesCache?.set === CURRENT_SET) return guidesCache.file;
  let file: CompGuidesBundle | null = null;
  try {
    const p = path.join(process.cwd(), 'public', `tft-metatft-comps-${CURRENT_SET}.json`);
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as CompGuidesBundle;
    // Datei eines anderen Sets waere schlimmer als keine (wie loadCompGuidesBundle).
    if (Number(parsed.set) === CURRENT_SET) file = parsed;
  } catch {
    // Datei fehlt — dann ohne Stufen-Zeitpunkte und Early-Boards.
  }
  guidesCache = { set: CURRENT_SET, file };
  return file;
}
