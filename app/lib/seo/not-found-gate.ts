// Erkennt erfundene Detail-Adressen, bevor die Seite rendert. Die Seiten sind
// Client-Komponenten unter einem loading.tsx — ein notFound() dort kommt erst
// nach dem Antwortbeginn und endet als 200 + noindex. Die Middleware leitet
// deshalb vorher auf einen Pfad ohne Route um; Next antwortet dann mit einer
// echten 404, auch fuer RSC- und HEAD-Anfragen (SEO-Plan Schritt 2).
//
// Zweistufig: was in der Liste steht, geht durch. Was fehlt, aber zum
// laufenden Set passen koennte (Praefix aus plausiblePrefixes, saubere
// Schreibweise), geht ebenfalls durch — ein neues Item steht nach einem Patch
// tagelang nicht im Bundle, die Seite zeigt es aber aus den Spieldaten. Hart
// abgelehnt wird nur kaputte Schreibweise, ein altes Set oder Unbekanntes
// ohne Praefix.
//
// Die Liste erzeugt scripts/build-known-ids.mjs bei Install, Build, Dev und
// Test (nicht eingecheckt). Kein node:-Import: laeuft in der Edge-Middleware.
import known from './known-ids.generated.json';
import { compSlugIds } from '../tft-cluster';
import { isKnownReadable } from '../tft-comp-path';

export interface KnownIds {
  currentSet?: number | null;
  plausiblePrefixes: string[];
  units: string[];
  items: string[];
  traits: string[];
  teams: string[];
  /** Feste Ordner neben dem dynamischen Segment, je Route ('tft/comps' → ['atlas', …]). */
  staticSegments: Record<string, string[]>;
}

type Lookup = {
  prefixes: string[];
  /** Kennungen mit der Set-Nummer im Namen (DA_18_…, XY_19_…), auch bei neuem Praefix. */
  setTag: RegExp | null;
  units: Set<string>;
  items: Set<string>;
  traits: Set<string>;
  teams: Set<string>;
  statics: Map<string, Set<string>>;
};

export function buildLookup(ids: KnownIds): Lookup {
  return {
    prefixes: ids.plausiblePrefixes,
    setTag: Number.isInteger(ids.currentSet) ? new RegExp(`^[A-Za-z]+_${ids.currentSet}_`) : null,
    units: new Set(ids.units),
    items: new Set(ids.items),
    traits: new Set(ids.traits),
    teams: new Set(ids.teams),
    statics: new Map(Object.entries(ids.staticSegments || {}).map(([k, v]) => [k, new Set(v)])),
  };
}

let lookup: Lookup | null = null;
function defaultLookup(): Lookup {
  return (lookup ??= buildLookup(known as KnownIds));
}

const ID_SHAPE = /^[A-Za-z0-9_]+$/;

function plausible(id: string, l: Lookup): boolean {
  return ID_SHAPE.test(id) && (l.prefixes.some(p => id.startsWith(p)) || !!l.setTag?.test(id));
}

// Leere Liste = Liste fehlt oder ist kaputt: dann alles durchlassen.
function check(set: Set<string>, id: string, l: Lookup, allowPlausible = true): boolean {
  return set.size === 0 || set.has(id) || (allowPlausible && plausible(id, l));
}

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** true = die Adresse gibt es sicher nicht. Nur Detail-Routen, sonst false. */
export function isUnknownDetailPath(
  pathname: string,
  l: Lookup = defaultLookup(),
  readable: (segment: string) => boolean = isKnownReadable,
): boolean {
  const parts = pathname.split('/');
  // ['', 'tft', 'units', '<id>'] bzw. ['', 'teams', '<id>']; tiefere Pfade
  // (z. B. .../opengraph-image) und Listen-Seiten bleiben unberuehrt.
  let route: string;
  let segment: string;
  if (parts.length === 3 && parts[1] === 'teams') {
    route = 'teams';
    segment = parts[2];
  } else if (parts.length === 4 && parts[1] === 'tft') {
    route = `tft/${parts[2]}`;
    segment = parts[3];
  } else {
    return false;
  }
  if (!segment) return false;
  if (route !== 'teams' && route !== 'tft/units' && route !== 'tft/items' && route !== 'tft/traits' && route !== 'tft/comps') {
    return false;
  }
  if (l.statics.get(route)?.has(segment)) return false;
  // Einzige feste Ausnahme: die Uebersicht ist die TFT-Startseite (TFT_HOME,
  // app/lib/games.ts, `/` leitet dorthin). Fehlt sie in der erzeugten Liste,
  // waere sonst die Startseite in allen Sprachen eine 404.
  if (route === 'tft/comps' && segment === 'atlas') return false;

  const id = decode(segment);
  if (id == null) return true;
  if (route === 'teams') return !check(l.teams, id, l, false);
  if (route === 'tft/units') return !check(l.units, id, l);
  if (route === 'tft/items') return !check(l.items, id, l);
  if (route === 'tft/traits') return !check(l.traits, id, l);

  const comp = compSlugIds(id);
  // Lesbare Adresse (/tft/comps/lunar-aphelios, tft-comp-path.ts): nur, wenn
  // die Namenstabelle sie kennt; leere Tabelle = durchlassen.
  if (!comp) return !readable(id);
  return !check(l.traits, comp.trait, l) || comp.units.some(u => !check(l.units, u, l));
}
