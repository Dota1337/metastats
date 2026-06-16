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
  // Pro-only filter at the very top — unique selling point and most
  // attention-grabbing slice. Comes from the aggregator's pro_pool bucket
  // tagged on matches with at least one TFT pro participant.
  { value: 'pro_pool',    labelKey: 'tft.filter.proOnly' },
  { value: 'all',         labelKey: 'tft.filter.allRanks' },
  { value: 'master_plus', labelKey: 'tft.filter.masterPlus' },
  { value: 'challenger',  labelKey: 'tft.bucket.challenger' },
  { value: 'grandmaster', labelKey: 'tft.bucket.grandmaster' },
  { value: 'master',      labelKey: 'tft.bucket.master' },
  { value: 'diamond',     labelKey: 'tft.bucket.diamond' },
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
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-3 mb-4">
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
          onChange={v => onChange({ ...filters, bucket: v })}
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
      <div className={`text-[10px] uppercase tracking-widest mb-1 ${highlight ? 'text-[#c39bff]' : 'text-[#7a8aa0]'}`}>{label}</div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`w-full bg-[#141c2e] rounded px-3 py-1.5 text-xs text-white focus:outline-none border ${
          highlight
            ? 'border-[#7B61FF]/70 ring-1 ring-[#7B61FF]/30'
            : 'border-[#1e2a3a] focus:border-[#7B61FF]/60'
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
    bucket: searchParams.get('bucket') || 'diamond',
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
