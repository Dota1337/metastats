'use client';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { tftPatchLabel } from '../../lib/tft-patch-label';

// Region / bucket option lists kept in sync with tft-supabase-reader.ts.
// If you add a region or bucket group there, mirror it here.
interface Option { value: string; labelKey?: string; label?: string }

const REGION_OPTIONS: Option[] = [
  { value: 'all',   labelKey: 'tft.filter.allRegions' },
  { value: 'euw1',  label: 'EUW' },
  { value: 'eun1',  label: 'EUNE' },
  { value: 'kr',    label: 'KR' },
  { value: 'na1',   label: 'NA' },
  { value: 'br1',   label: 'BR' },
  { value: 'jp1',   label: 'JP' },
  { value: 'la1',   label: 'LAN' },
  { value: 'la2',   label: 'LAS' },
  { value: 'oc1',   label: 'OCE' },
  { value: 'tr1',   label: 'TR' },
  { value: 'ru',    label: 'RU' },
  { value: 'me1',   label: 'ME' },
  { value: 'ph2',   label: 'PH' },
  { value: 'sg2',   label: 'SG' },
  { value: 'th2',   label: 'TH' },
  { value: 'tw2',   label: 'TW' },
  { value: 'vn2',   label: 'VN' },
];

const BUCKET_OPTIONS: Option[] = [
  // 'pro_pool' ("nur Pro") entfernt 2026-09-01. Der Eimer wird zwar taeglich
  // neu berechnet (scripts/collect-tft-allranks.mjs:141/303), aber aus einer
  // Pro-Spielerliste, die seit demselben Tag nicht mehr gepflegt wird — die
  // Sammlung ist stillgelegt (app/lib/feature-flags.ts). Die Zahlen waeren
  // also frisch, der Kader dahinter aber eingefroren, und nichts in der
  // Oberflaeche haette das gezeigt. User-Entscheid: "der Filter kann auch raus."
  //
  // Serverseitig bleibt bucket=pro_pool gueltig (app/lib/tft-supabase-reader.ts:48/85)
  // und der i18n-Schluessel tft.filter.proOnly bleibt stehen — Zurueckholen ist
  // damit diese eine Zeile.
  { value: 'all',         labelKey: 'tft.filter.allRanks' },
  { value: 'master_plus', labelKey: 'tft.filter.masterPlus' },
  { value: 'diamond_plus', labelKey: 'tft.filter.diamondPlus' },
  { value: 'challenger',  labelKey: 'tft.bucket.challenger' },
  { value: 'grandmaster', labelKey: 'tft.bucket.grandmaster' },
  { value: 'master',      labelKey: 'tft.bucket.master' },
  // 'diamond' (single-tier) removed 2026-07-04 (C3): no snapshot coverage and the
  // highest-traffic 521-causer on the heavy detoast RPCs. diamond_plus (above) is
  // its strict superset and IS snapshot-covered. A direct ?bucket=diamond URL is
  // coerced to diamond_plus server-side in resolveFilters().
  { value: 'emerald',     labelKey: 'tft.bucket.emerald' },
  { value: 'platinum',    labelKey: 'tft.bucket.platinum' },
  { value: 'gold',        labelKey: 'tft.bucket.gold' },
  { value: 'silver',      labelKey: 'tft.bucket.silver' },
  { value: 'bronze',      labelKey: 'tft.bucket.bronze' },
];

const DAYS_OPTIONS = [1, 2, 3, 4, 5, 6, 7];

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

interface Props {
  filters: Filters;
  patches: PatchInfo[];          // from API response
  onChange: (next: Filters) => void;
}

export default function StatsFilterBar({ filters, patches, onChange }: Props) {
  const { t } = useI18n();

  const dayLabel = (n: number) =>
    n === 1
      ? t('tft.filter.dayOne')
      : t('tft.filter.dayN').replace('{n}', String(n));

  // Show only the two newest patches as semantic options; older patches can
  // still be reached via the explicit literal value if a deep link needs it.
  const newest = patches[0];
  const previous = patches[1];

  // Patch-Hint: zeigt welcher Patch gerade aktiv ist + sein first_day. Bei
  // Default-Filter (current = patchübergreifende Aggregation) wird zusätzlich
  // "patchübergreifend aggregiert" angehängt, damit der User versteht warum
  // 1d/7d-Switches in den ersten Patch-Tagen kaum unterschiedliche Daten zeigen.
  const displayPatch = filters.patch === 'current'
    ? newest
    : filters.patch === 'previous'
      ? previous
      : patches.find(p => p.patch === filters.patch);
  const isAggregated = filters.patch === 'current';
  const patchHint = displayPatch ? (() => {
    const base = t('tft.filter.patchSince')
      .replace('{patch}', tftPatchLabel(displayPatch.patch))
      .replace('{date}', formatPatchDate(displayPatch.first_day));
    return isAggregated ? `${base} · ${t('tft.filter.patchAggregated')}` : base;
  })() : null;

  return (
    <div className="bg-surface-base border border-border-subtle rounded-lg p-3 mb-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <FilterSelect
          label={t('tft.filter.patch')}
          value={filters.patch}
          onChange={v => onChange({ ...filters, patch: v })}
        >
          <option value="current">
            {t('tft.filter.current')}{newest ? ` · ${tftPatchLabel(newest.patch)}` : ''}
          </option>
          {previous && (
            <option value="previous">
              {t('tft.filter.previous')} · {tftPatchLabel(previous.patch)}
            </option>
          )}
        </FilterSelect>

        <FilterSelect
          label={t('tft.filter.bucket')}
          value={filters.bucket}
          onChange={v => onChange({ ...filters, bucket: v, bucketAuto: false })}
        >
          {BUCKET_OPTIONS.map(b => (
            <option key={b.value} value={b.value}>
              {b.labelKey ? t(b.labelKey as TranslationKey) : b.label}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          label={t('tft.filter.days')}
          value={String(filters.days)}
          onChange={v => onChange({ ...filters, days: Number(v) })}
        >
          {DAYS_OPTIONS.map(n => (
            <option key={n} value={String(n)}>{dayLabel(n)}</option>
          ))}
        </FilterSelect>

        <FilterSelect
          label={t('tft.filter.region')}
          value={filters.region}
          onChange={v => onChange({ ...filters, region: v })}
        >
          {REGION_OPTIONS.map(r => (
            <option key={r.value} value={r.value}>
              {r.labelKey ? t(r.labelKey as TranslationKey) : r.label}
            </option>
          ))}
        </FilterSelect>

        <FilterSelect
          label={t('tft.filter.velocity')}
          value={String(filters.velocity)}
          onChange={v => onChange({ ...filters, velocity: Number(v) })}
          highlight={filters.velocity > 0}
        >
          <option value="0">{t('tft.filter.velocityOff')}</option>
          <option value="1">{t('tft.filter.velocity1d')}</option>
          <option value="2">{t('tft.filter.velocity2d')}</option>
          <option value="3">{t('tft.filter.velocity3d')}</option>
          <option value="7">{t('tft.filter.velocity7d')}</option>
          <option value="14">{t('tft.filter.velocity14d')}</option>
        </FilterSelect>
      </div>
      {patchHint && (
        <div className="mt-2 text-xs text-[#6b7a8f]">{patchHint}</div>
      )}
    </div>
  );
}

// ISO-Date (YYYY-MM-DD) → kompaktes DD.MM.YYYY. Locale-spezifische Variants
// kommen später, wenn klar ist ob das wirklich gebraucht wird; DD.MM.YYYY ist
// in DE/EN/ES/FR lesbar genug.
function formatPatchDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function FilterSelect({
  label, value, onChange, children, highlight = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  // Highlights the select with a purple accent when the filter is non-default,
  // so an active Δ-comparison or other opt-in filter is visually scannable in
  // a 5-up filter bar instead of disappearing into the chrome.
  highlight?: boolean;
}) {
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-widest mb-1 ${highlight ? 'text-[#c39bff]' : 'text-fg-muted'}`}>{label}</div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`w-full bg-surface-raised rounded px-3 py-1.5 text-xs text-white focus:outline-none border ${
          highlight
            ? 'border-accent-a70 ring-1 ring-accent-a30'
            : 'border-border-subtle focus:border-accent-a60'
        }`}
      >
        {children}
      </select>
    </div>
  );
}

// URL-state helpers — share filters via shareable URLs.

// Allowed velocity shifts (days). 0 = off; otherwise prev-window starts N days
// before the now-window. Anything else collapses to 0 so a stale URL can't
// surface a shape the UI doesn't render.
const VELOCITY_SHIFTS = new Set([0, 1, 2, 3, 7, 14]);

export function filtersFromSearchParams(searchParams: URLSearchParams): Filters {
  const velocityRaw = parseInt(searchParams.get('velocity') || '0', 10);
  const velocity = VELOCITY_SHIFTS.has(velocityRaw) ? velocityRaw : 0;
  return {
    patch: searchParams.get('patch') || 'current',
    bucket: searchParams.get('bucket') || autoBucketDefault(),
    bucketAuto: !searchParams.has('bucket'),
    days: Math.max(1, Math.min(7, parseInt(searchParams.get('days') || '3', 10))),
    region: searchParams.get('region') || 'all',
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

// localStorage-Schicht für Cross-Session-Persistenz. URL ist Single-Source-
// of-Truth pro Tab (Sharing, Browser-History). localStorage liefert nur
// den Default-Wert, wenn der User die Page OHNE Filter-Params besucht
// (neuer Tab, Bookmark ohne Params). Filter werden global geteilt zwischen
// allen Stats-Pages (Comps/Units/Items/Traits/Marktwert/Meta-Pulse) — die
// Persona "Diamond+EUW+7d" gilt überall einheitlich.
const STORAGE_KEY = 'metastats:tft-filters';

// Der Server loest den Default-Bucket aus der Datenlage des laufenden Sets auf
// (`bucketAuto=1` in der Query). Wir merken uns sein Ergebnis, damit der
// naechste Seitenaufruf direkt mit dem richtigen Wert startet statt einmal auf
// dem leeren Diamond+ zu landen und dann nachzuladen.
const AUTO_BUCKET_KEY = 'metastats:tft-auto-bucket';

export function autoBucketDefault(): string {
  if (typeof window === 'undefined') return 'diamond_plus';
  try {
    return window.localStorage.getItem(AUTO_BUCKET_KEY) || 'diamond_plus';
  } catch {
    return 'diamond_plus';
  }
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
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(AUTO_BUCKET_KEY, served); } catch { /* Privacy-Mode */ }
  }
  apply({ ...current, bucket: served });
  return true;
}

export function loadInitialFilters(searchParams: URLSearchParams): Filters {
  const fromUrl = filtersFromSearchParams(searchParams);
  // Wenn KEINER der 5 Filter-Werte in URL gesetzt ist, versuche localStorage.
  const hasUrlValues = ['patch', 'bucket', 'days', 'region', 'velocity']
    .some(k => searchParams.has(k));
  if (hasUrlValues) return fromUrl;
  if (typeof window === 'undefined') return fromUrl;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fromUrl;
    const stored = JSON.parse(raw) as Partial<Filters>;
    const velocityRaw = Number(stored.velocity);
    return {
      patch: typeof stored.patch === 'string' ? stored.patch : fromUrl.patch,
      bucket: typeof stored.bucket === 'string' ? stored.bucket : fromUrl.bucket,
      // Nur ein ausdrueckliches false zaehlt als bewusste Wahl. Aeltere
      // Storage-Eintraege kennen das Feld nicht — die duerfen nicht als
      // "User hat Diamond+ gewaehlt" gelesen werden, sonst sieht ein
      // wiederkehrender Besucher zum Set-Start eine leere Seite.
      bucketAuto: stored.bucketAuto !== false,
      days: Number.isFinite(Number(stored.days))
        ? Math.max(1, Math.min(7, Number(stored.days))) : fromUrl.days,
      region: typeof stored.region === 'string' ? stored.region : fromUrl.region,
      velocity: VELOCITY_SHIFTS.has(velocityRaw) ? velocityRaw : fromUrl.velocity,
    };
  } catch {
    return fromUrl;
  }
}

export function persistFilters(f: Filters): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
  } catch {
    // Storage voll oder Privacy-Mode — Filter bleiben URL-only.
  }
}
