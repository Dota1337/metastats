// Komponenten (Schwert, Bogen …) fliegen aus Item-Paaren und -Trios des
// Explorers. Welche das sind, steht im Bundle: alles, was in der Rezeptur
// eines aktiven Items vorkommt. Gemessen fuer Set 18: 10 Stueck
// (DA_Component_*).
//
// Abfragedienst UND Bau (Tages-Teilsummen) lesen die Liste ueber diese eine
// Funktion; der Bau legt den Hash in die Datei, der Dienst nimmt die
// Items-Teilsummen nur bei gleichem Hash.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Reine Funktion: Bundle-Objekt → sortierte Komponenten-Liste.
export function componentsFromBundle(bundle) {
  const active = new Set(bundle?.active?.items || []);
  const comp = new Set();
  for (const id of active) {
    const c = bundle?.items?.[id]?.composition;
    if (Array.isArray(c) && c.length === 2) c.forEach(x => comp.add(x));
  }
  return [...comp].sort();
}

export function readComponents(root, setNumber, log = () => {}) {
  try {
    const file = path.join(root, `public/tft-assets-${setNumber}.json`);
    const list = componentsFromBundle(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (list.length === 0) log(`WARNUNG: keine Komponenten im Bundle fuer Set ${setNumber}`);
    return list;
  } catch (err) {
    log(`WARNUNG: Bundle fuer Set ${setNumber} nicht lesbar (${err.message}) — Paare enthalten Komponenten`);
    return [];
  }
}

export function componentsHash(list) {
  return crypto.createHash('sha1').update([...list].sort().join('\n')).digest('hex').slice(0, 16);
}
