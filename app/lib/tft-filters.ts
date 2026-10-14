// Filter-Zustand der TFT-Statistik-Seiten (Comps/Units/Items/Traits/Meta-Pulse):
// Typen, Lesen/Schreiben der Adresse, localStorage-Schicht.
//
// Bewusst ohne 'use client': die Server-Seiten (app/tft/units/page.tsx …)
// rechnen den Start-Filter mit denselben Funktionen wie der Browser, sonst
// passt das Server-HTML nicht zum ersten Client-Rendern. Alle window-Zugriffe
// sind abgesichert. StatsFilterBar.tsx reicht alles weiter, die alten Importe
// bleiben gueltig.
import { tftStatsBucket } from './rank-groups';

export interface Filters {
  patch: string;   // 'current' | 'previous' | exact patch (e.g. '17.2b')
  bucket: string;
  // true = der Rang wurde NICHT vom User gewaehlt. Dann entscheidet der Server
  // anhand der Datenlage des laufenden Sets (siehe resolveDefaultBucket in
  // tft-supabase-reader.ts) und die UI spiegelt den gelieferten Wert zurueck.
  // Hintergrund: zum Set-Start ist die Ladder zurueckgesetzt — Diamond+ hat
  // dann tagelang keine Daten, und ein fest verdrahteter Diamond+-Default
  // wuerde leere Seiten zeigen.
  bucketAuto: boolean;
  days: number;
  region: string;
  // W1-A: velocity comparison shift in days. 0 = disabled (no Δ column shown).
  // 3 = compare current 3-day window vs the 3 days before that (48h-Verschiebung).
  // 7 = compare current 3-day window vs the 3 days a week ago.
  velocity: number;
}

export interface PatchInfo {
  patch: string;
  set_number: number;
  first_day: string;
  last_day: string;
  total_matches: number;
}

// URL-state helpers — share filters via shareable URLs.

// Allowed velocity shifts (days). 0 = off; otherwise prev-window starts N days
// before the now-window. Anything else collapses to 0 so a stale URL can't
// surface a shape the UI doesn't render.
export const VELOCITY_SHIFTS: readonly number[] = [0, 1, 2, 3, 7, 14];
const VELOCITY_SET = new Set(VELOCITY_SHIFTS);

// Standardwerte, wenn die Adresse nichts sagt. Exportiert fuer das Vorab-Skript
// (app/lib/seo/stats-pending.ts), das ohne Import im Browser laeuft.
export const FILTER_DEFAULTS = { patch: 'current', days: 3, region: 'all' } as const;
export const DAYS_MIN = 1;
export const DAYS_MAX = 7;

// Die fuenf Filter-Werte in der Adresse. Steht keiner davon drin, gelten die
// gespeicherten Filter (loadInitialFilters).
export const URL_FILTER_KEYS = ['patch', 'bucket', 'days', 'region', 'velocity'] as const;

export function hasUrlFilters(searchParams: URLSearchParams): boolean {
  return URL_FILTER_KEYS.some(k => searchParams.has(k));
}

/** `defaultBucket`: Rang, wenn die Adresse keinen nennt. Ohne Angabe der
 *  zuletzt vom Server gemeldete (localStorage) bzw. diamond_plus — die
 *  Server-Seiten geben ihn ausdruecklich mit, damit Server und Browser
 *  dasselbe rechnen. */
export function filtersFromSearchParams(searchParams: URLSearchParams, defaultBucket?: string): Filters {
  const velocityRaw = parseInt(searchParams.get('velocity') || '0', 10);
  const velocity = VELOCITY_SET.has(velocityRaw) ? velocityRaw : 0;
  // Gleiche Regel wie resolveFilters (tft-supabase-reader.ts): ohne Rang ODER
  // mit bucketAuto=1 ist der Rang nicht gewaehlt. Die Adresse traegt dann nur
  // den zuletzt automatisch bestimmten, ein frisch bestimmter defaultBucket
  // geht vor. Sonst wuerde ein Auto-Rang nach Neuladen oder Zurueck-Knopf zum
  // festen Rang — und so gespeichert.
  const urlBucket = searchParams.get('bucket');
  const bucketAuto = !searchParams.has('bucket') || searchParams.get('bucketAuto') === '1';
  return {
    patch: searchParams.get('patch') || FILTER_DEFAULTS.patch,
    bucket: tftStatsBucket((bucketAuto ? defaultBucket || urlBucket : urlBucket || defaultBucket) || autoBucketDefault()),
    bucketAuto,
    days: Math.max(DAYS_MIN, Math.min(DAYS_MAX, parseInt(searchParams.get('days') || String(FILTER_DEFAULTS.days), 10))),
    region: searchParams.get('region') || FILTER_DEFAULTS.region,
    velocity,
  };
}

export function filtersToQueryString(f: Filters): string {
  const sp = new URLSearchParams({
    patch: f.patch,
    bucket: f.bucket,
    days: String(f.days),
    region: f.region,
  });
  // Signalisiert dem Server: der Rang ist ein Default, kein User-Wunsch —
  // er darf ihn anhand der Datenlage des laufenden Sets ersetzen.
  if (f.bucketAuto) sp.set('bucketAuto', '1');
  // Only emit velocity when non-zero to keep URLs clean for the default case.
  if (f.velocity > 0) sp.set('velocity', String(f.velocity));
  return sp.toString();
}

/** Welche Daten ein Filter zeigt — ohne bucketAuto: der automatisch gewaehlte
 *  Rang X liefert dieselben Zahlen wie ein ausdruecklich gewaehltes X. Gleicher
 *  Schluessel = die gezeigten Daten passen, kein neuer Abruf. */
export function filtersDataKey(f: Filters): string {
  return [f.patch, f.bucket, f.days, f.region, f.velocity].join('|');
}

// localStorage-Schicht für Cross-Session-Persistenz. URL ist Single-Source-
// of-Truth pro Tab (Sharing, Browser-History). localStorage liefert nur
// den Default-Wert, wenn der User die Page OHNE Filter-Params besucht
// (neuer Tab, Bookmark ohne Params). Filter werden global geteilt zwischen
// allen Stats-Pages (Comps/Units/Items/Traits/Marktwert/Meta-Pulse) — die
// Persona "Diamond+EUW+7d" gilt überall einheitlich.
// Gleicher Schluessel im Vorab-Skript app/lib/seo/stats-pending.ts.
export const FILTERS_STORAGE_KEY = 'metastats:tft-filters';

// Der Server loest den Default-Bucket aus der Datenlage des laufenden Sets auf
// (`bucketAuto=1` in der Query). Wir merken uns sein Ergebnis, damit der
// naechste Seitenaufruf direkt mit dem richtigen Wert startet statt einmal auf
// dem leeren Diamond+ zu landen und dann nachzuladen.
const AUTO_BUCKET_KEY = 'metastats:tft-auto-bucket';

export function autoBucketDefault(): string {
  if (typeof window === 'undefined') return 'diamond_plus';
  try {
    return tftStatsBucket(window.localStorage.getItem(AUTO_BUCKET_KEY) || 'diamond_plus');
  } catch {
    return 'diamond_plus';
  }
}

/** Merkt sich den vom Server automatisch gewaehlten Rang (siehe AUTO_BUCKET_KEY). */
export function rememberAutoBucket(served: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(AUTO_BUCKET_KEY, served); } catch { /* Privacy-Mode */ }
}

/** Uebernimmt den vom Server tatsaechlich benutzten Rang in den Filter-State,
 *  solange der User selbst keinen gewaehlt hat. Damit stimmt der angezeigte
 *  Rang immer mit den gezeigten Daten ueberein. Gibt true zurueck, wenn sich
 *  etwas geaendert hat. */
export function adoptServerBucket(
  served: string | undefined,
  current: Filters,
  apply: (next: Filters) => void,
): boolean {
  if (!current.bucketAuto || !served || served === current.bucket) return false;
  rememberAutoBucket(served);
  apply({ ...current, bucket: served });
  return true;
}

/** `defaultBucket` wie bei filtersFromSearchParams. Ist er angegeben, gilt er
 *  auch fuer gespeicherte Filter mit automatischem Rang — der Server hat ihn
 *  gerade frisch bestimmt, der gespeicherte Wert kann von gestern sein. */
export function loadInitialFilters(searchParams: URLSearchParams, defaultBucket?: string): Filters {
  const fromUrl = filtersFromSearchParams(searchParams, defaultBucket);
  // Wenn KEINER der 5 Filter-Werte in URL gesetzt ist, versuche localStorage.
  if (hasUrlFilters(searchParams)) return fromUrl;
  if (typeof window === 'undefined') return fromUrl;
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return fromUrl;
    const stored = JSON.parse(raw) as Partial<Filters>;
    const velocityRaw = Number(stored.velocity);
    // Nur ein ausdrueckliches false zaehlt als bewusste Wahl. Aeltere
    // Storage-Eintraege kennen das Feld nicht — die duerfen nicht als
    // "User hat Diamond+ gewaehlt" gelesen werden, sonst sieht ein
    // wiederkehrender Besucher zum Set-Start eine leere Seite.
    const bucketAuto = stored.bucketAuto !== false;
    return {
      patch: typeof stored.patch === 'string' ? stored.patch : fromUrl.patch,
      // Gespeichertes master/grandmaster aus der Zeit vor 2026-09-13 → Gruppe.
      bucket: bucketAuto && defaultBucket
        ? fromUrl.bucket
        : typeof stored.bucket === 'string' ? tftStatsBucket(stored.bucket) : fromUrl.bucket,
      bucketAuto,
      days: Number.isFinite(Number(stored.days))
        ? Math.max(DAYS_MIN, Math.min(DAYS_MAX, Number(stored.days))) : fromUrl.days,
      region: typeof stored.region === 'string' ? stored.region : fromUrl.region,
      velocity: VELOCITY_SET.has(velocityRaw) ? velocityRaw : fromUrl.velocity,
    };
  } catch {
    return fromUrl;
  }
}

export function persistFilters(f: Filters): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(f));
  } catch {
    // Storage voll oder Privacy-Mode — Filter bleiben URL-only.
  }
}
