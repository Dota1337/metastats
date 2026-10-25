'use client';
import type { ReactNode } from 'react';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { tftPatchLabel } from '../../lib/tft-patch-label';
import { patchFamily, previousPatchOf } from '../../lib/snapshot-matrix';
import { patchDeltaOptions } from '../../lib/tft-patch-delta';
import type { Filters, PatchInfo } from '../../lib/tft-filters';

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
  { value: 'sg2',   label: 'SG' },
  { value: 'tw2',   label: 'TW' },
  { value: 'vn2',   label: 'VN' },
];

// Kurzname einer Region (euw1 → EUW), gleiche Quelle wie das Filter-Menue.
export function regionShortLabel(region: string): string {
  return REGION_OPTIONS.find(o => o.value === region)?.label || region.toUpperCase();
}

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
  // Rangfolge von oben; X+ = Rang X bis Challenger. Einzel-Master/-GM/-Diamond/
  // -Emerald/-Platinum gibt es nicht mehr, alte Links landen per
  // tftStatsBucket auf der Gruppe (app/lib/rank-groups.ts, 2026-09-13).
  { value: 'challenger',  labelKey: 'tft.bucket.challenger' },
  { value: 'grandmaster_plus', labelKey: 'tft.filter.grandmasterPlus' },
  { value: 'master_plus', labelKey: 'tft.filter.masterPlus' },
  { value: 'diamond_plus', labelKey: 'tft.filter.diamondPlus' },
  { value: 'emerald_plus', labelKey: 'tft.filter.emeraldPlus' },
  { value: 'platinum_plus', labelKey: 'tft.filter.platinumPlus' },
  { value: 'gold',        labelKey: 'tft.bucket.gold' },
  { value: 'silver',      labelKey: 'tft.bucket.silver' },
  { value: 'bronze',      labelKey: 'tft.bucket.bronze' },
];

const DAYS_OPTIONS = [1, 2, 3, 4, 5, 6, 7];

interface Props {
  filters: Filters;
  patches: PatchInfo[];          // from API response
  // Letzter voller Tag der Listen-Antwort (filters.dataEnd): ab wann es den
  // Δ-Vergleich gibt (tft-patch-delta.ts, patchDeltaReady).
  dataEnd?: string | null;
  onChange: (next: Filters) => void;
  // Optionaler Platz links neben den Auswahlfeldern (Comps: Umschalter
  // Liste/Uebersicht). Ab xl eine Zeile, darunter steht er ueber den Feldern.
  lead?: ReactNode;
  // false: kein Δ-Feld (Meta Pulse — die Seite IST der Vergleich, und die
  // Uebersicht der Comps zeigt ihn immer).
  showDelta?: boolean;
}

export default function StatsFilterBar({ filters, patches, dataEnd = null, onChange, lead, showDelta = true }: Props) {
  const { t } = useI18n();

  const dayLabel = (n: number) =>
    n === 1
      ? t('tft.filter.dayOne')
      : t('tft.filter.dayN').replace('{n}', String(n));

  // Semantische Optionen: neuester Patch und Vorpatch nach previousPatchOf
  // (juengster frueherer Patch mit genug Datentagen — dieselbe Regel wie der
  // Server bei ?patch=previous). Ein dabei uebersprungener Kurz-Patch (18.3,
  // ein Datentag) bleibt als eigener Eintrag direkt waehlbar. Aeltere Patches
  // erreicht nur ein Deep-Link mit dem konkreten Wert.
  const newest = patches[0];
  const previous = previousPatchOf(patches, newest?.patch);
  const previousIdx = previous ? patches.indexOf(previous) : patches.length;
  const skippedPatches = patches.slice(1, previousIdx);

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

  // Δ-Vergleich „vs Vorpatch" (User 18.10.2026): direkt neben dem Patch-Feld,
  // ganzer gewaehlter Patch gegen den ganzen Vorpatch. Ohne Vorpatch im selben
  // Set oder bei einem zu jungen Patch gibt es nichts zu vergleichen — dann
  // kein Feld, und ein gespeichertes „an" wirkt wie „aus" (die Listen fragen
  // dasselbe Paar ab, tft-patch-delta.ts). Ein Zwischen-Patch hat zusaetzlich
  // „vs Haupt-Patch" (User 24.10.2026), am Set-Start nur diese Wahl.
  const deltaOptions = showDelta ? patchDeltaOptions(patches, filters.patch, dataEnd) : null;
  const deltaPair = deltaOptions ? deltaOptions.prev ?? deltaOptions.base : null;
  const deltaOn = filters.velocity > 0 && !!deltaPair;
  const deltaValue = !deltaOn ? '0'
    : (filters.deltaVs === 'base' && deltaOptions?.base) || !deltaOptions?.prev ? 'base' : '1';
  const basePair = deltaOptions?.base ?? null;

  const body = (
    <>
      <div className={`grid grid-cols-2 ${deltaPair ? 'sm:grid-cols-5' : 'sm:grid-cols-4'} gap-3`}>
        <FilterSelect
          label={t('tft.filter.patch')}
          value={filters.patch}
          onChange={v => onChange({ ...filters, patch: v })}
        >
          <option value="current">
            {t('tft.filter.current')}{newest ? ` · ${tftPatchLabel(newest.patch)}` : ''}
          </option>
          {skippedPatches.map(p => (
            <option key={p.patch} value={p.patch}>{tftPatchLabel(p.patch)}</option>
          ))}
          {previous && (
            <option value="previous">
              {t('tft.filter.previous')} · {tftPatchLabel(previous.patch)}
            </option>
          )}
        </FilterSelect>

        {deltaPair && (
          <FilterSelect
            label={t('tft.filter.velocity')}
            value={deltaValue}
            onChange={v => onChange({ ...filters, velocity: v === '0' ? 0 : 1, deltaVs: v === 'base' ? 'base' : undefined })}
            highlight={deltaOn}
          >
            <option value="0">{t('tft.filter.velocityOff')}</option>
            {deltaOptions?.prev && (
              <option value="1">{t('tft.filter.vsPrevPatch')} · {tftPatchLabel(deltaOptions.prev.prev)}</option>
            )}
            {basePair && (
              <option value="base">
                {t(basePair.prev === patchFamily(basePair.prev) ? 'tft.filter.vsMainPatch' : 'tft.filter.vsMidPatch')}
                {' · '}{tftPatchLabel(basePair.prev)}
              </option>
            )}
          </FilterSelect>
        )}

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
      </div>
      {patchHint && (
        <div className="mt-2 text-xs text-fg-faint">{patchHint}</div>
      )}
    </>
  );

  return (
    <div className="bg-surface-base border border-border-subtle rounded-lg p-3 mb-4">
      {lead ? (
        <div className="flex flex-col xl:flex-row xl:items-center gap-3 xl:gap-5">
          <div className="flex justify-center shrink-0">{lead}</div>
          <div className="flex-1 min-w-0">{body}</div>
        </div>
      ) : body}
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

// Filter-Typen und -Funktionen liegen in app/lib/tft-filters.ts (ohne
// 'use client', die Server-Seiten brauchen sie auch). Weitergereicht, damit
// die bestehenden Importe aus dieser Datei gueltig bleiben.
export {
  URL_FILTER_KEYS,
  hasUrlFilters,
  filtersFromSearchParams,
  filtersToQueryString,
  filtersToApiQueryString,
  filtersDataKey,
  FILTERS_STORAGE_KEY,
  autoBucketDefault,
  rememberAutoBucket,
  adoptServerBucket,
  loadInitialFilters,
  persistFilters,
} from '../../lib/tft-filters';
export type { Filters, PatchInfo } from '../../lib/tft-filters';
