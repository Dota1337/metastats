import 'server-only';
// Item-Texte fuer Server-Seiten (liest public/tft-item-texts-{set}.json von der
// Platte). Der Browser laedt dieselbe Datei ueber loadItemTexts in
// tft-item-texts.ts; angezeigt wird beides ueber itemTextFor.
//
// Die Item-Detailseite bekommt nur den Eintrag ihres Items (alle 6 Sprachen,
// ~1-3 KB), damit der Text im ersten HTML steht und der Sprachwechsel ohne
// Neuladen trotzdem die richtige Sprache hat. Die Datei muss per
// outputFileTracingIncludes in die Funktion (next.config.ts).
import { readFileSync } from 'fs';
import path from 'path';
import { CURRENT_SET } from './current-set';
import type { ItemTexts } from './tft-item-texts';

let textsCache: { set: number; file: ItemTexts | null } | null = null;

function loadItemTextsFromDisk(): ItemTexts | null {
  if (textsCache?.set === CURRENT_SET) return textsCache.file;
  let file: ItemTexts | null = null;
  try {
    const p = path.join(process.cwd(), 'public', `tft-item-texts-${CURRENT_SET}.json`);
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as ItemTexts;
    // Texte eines anderen Sets waeren schlimmer als keine.
    if (Number(parsed.set) === CURRENT_SET && parsed.items) file = parsed;
  } catch {
    // Datei fehlt — die Seite zeigt dann den Bundle-Text wie vorher.
  }
  textsCache = { set: CURRENT_SET, file };
  return file;
}

// Teil-Datei mit genau diesem Item (leer, wenn es keinen Text hat). null nur,
// wenn die Datei selbst fehlt — dann holt der Browser sie nach. Ohne diese
// Unterscheidung luede jede Seite eines Items ohne Text (387 von 543 aktiven)
// die ganze Datei umsonst.
export function itemTextsSubset(id: string): ItemTexts | null {
  const all = loadItemTextsFromDisk();
  if (!all) return null;
  const entry = all.items[id];
  return { set: all.set, source: all.source, fetchedAt: all.fetchedAt, items: entry ? { [id]: entry } : {} };
}
