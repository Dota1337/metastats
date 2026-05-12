'use client';
import { useI18n } from '../../lib/i18n';

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

  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-3 mb-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <FilterSelect
          label={t('tft.filter.patch')}
          value={filters.patch}
          onChange={v => onChange({ ...filters, patch: v })}
        >
          <option value="current">
            {t('tft.filter.current')}{newest ? ` · ${newest.patch}` : ''}
          </option>
          {previous && (
            <option value="previous">
              {t('tft.filter.previous')} · {previous.patch}
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
              {b.labelKey ? t(b.labelKey as any) : b.label}
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
              {r.labelKey ? t(r.labelKey as any) : r.label}
            </option>
          ))}
        </FilterSelect>
      </div>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[#4a5a70] text-[10px] uppercase tracking-widest mb-1">{label}</div>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-[#141c2e] border border-[#1e2a3a] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#7B61FF]/60"
      >
        {children}
      </select>
    </div>
  );
}

// URL-state helpers — share filters via shareable URLs.

export function filtersFromSearchParams(searchParams: URLSearchParams): Filters {
  return {
    patch: searchParams.get('patch') || 'current',
    bucket: searchParams.get('bucket') || 'diamond',
    days: Math.max(1, Math.min(7, parseInt(searchParams.get('days') || '3', 10))),
    region: searchParams.get('region') || 'all',
  };
}

export function filtersToQueryString(f: Filters): string {
  const sp = new URLSearchParams({
    patch: f.patch,
    bucket: f.bucket,
    days: String(f.days),
    region: f.region,
  });
  return sp.toString();
}
