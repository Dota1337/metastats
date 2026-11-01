'use client';
// Filterzeile der Items-Seite (User 01.11.2026, Aufbau nach Vorlage): Suche,
// Item-Art, Rang, Tage, Region, Sortierung, rechts die Patch-Auswahl. Die Listen
// und die Patch-Regel kommen aus StatsFilterBar, damit sie nicht auseinanderlaufen.
// Patch bleibt eine volle Auswahl: die Filter gelten seitenuebergreifend, wer auf
// Units den Vorpatch waehlt, muss hier wieder herauskommen.
import type { ReactNode } from 'react';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { ITEM_BUCKETS, type ItemBucket } from '../../lib/tft-item-bucket';
import type { ItemSortBy } from '../../lib/tft-item-tier-rows';
import type { Filters, PatchInfo } from '../../lib/tft-filters';
import { tftPatchLabel } from '../../lib/tft-patch-label';
import { DayOptions, displayPatchOf, PatchOptions, patchHintOf, RankOptions, RegionOptions } from './StatsFilterBar';

const Chevron = () => (
  <svg aria-hidden="true" viewBox="0 0 12 12" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-fg-secondary">
    <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function Select({ label, value, onChange, children, className = '' }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative min-w-0 ${className}`}>
      <select
        aria-label={label}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full appearance-none bg-surface-raised border border-border-subtle rounded-md pl-3 pr-8 py-2 text-xs text-white focus:outline-none focus:border-accent-a60"
      >
        {children}
      </select>
      <Chevron />
    </div>
  );
}

export default function ItemsFilterBar({
  filters, patches, onChange, search, onSearch, type, onType, sort, onSort, trendingAvailable,
}: {
  filters: Filters;
  patches: PatchInfo[];
  onChange: (next: Filters) => void;
  search: string;
  onSearch: (v: string) => void;
  type: ItemBucket | null;
  onType: (v: ItemBucket | null) => void;
  sort: ItemSortBy;
  onSort: (v: ItemSortBy) => void;
  // Vorpatch-Vergleich vorhanden: dann gibt es auch die Sortierung danach.
  trendingAvailable: boolean;
}) {
  const { t } = useI18n();
  const shownPatch = displayPatchOf(filters, patches);
  return (
    <div className="grid grid-cols-2 gap-2 mb-4 lg:flex lg:flex-wrap lg:items-center">
      <div className="relative col-span-2 lg:flex-1 lg:min-w-[14rem]">
        <svg aria-hidden="true" viewBox="0 0 16 16" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-secondary">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="m10.5 10.5 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder={t('tft.search.items')}
          aria-label={t('tft.search.items')}
          className="w-full bg-surface-raised border border-border-subtle rounded-md pl-9 pr-3 py-2 text-xs text-white placeholder:text-fg-faint outline-none focus:border-accent-a60"
        />
      </div>
      <Select label={t('nav.items')} value={type ?? ''} onChange={v => onType((v || null) as ItemBucket | null)}>
        <option value="">{t('tft.item.allItems')}</option>
        {ITEM_BUCKETS.map(b => (
          <option key={b} value={b}>{t(`tft.item.bucket.${b}` as TranslationKey)}</option>
        ))}
      </Select>
      <Select label={t('tft.filter.bucket')} value={filters.bucket} onChange={v => onChange({ ...filters, bucket: v, bucketAuto: false })}>
        <RankOptions />
      </Select>
      <Select label={t('tft.filter.days')} value={String(filters.days)} onChange={v => onChange({ ...filters, days: Number(v) })}>
        <DayOptions />
      </Select>
      <Select label={t('tft.filter.region')} value={filters.region} onChange={v => onChange({ ...filters, region: v })}>
        <RegionOptions />
      </Select>
      <Select label={t('tft.sortBy')} value={sort} onChange={v => onSort(v as ItemSortBy)}>
        <option value="avg">{t('tft.avgPlacement')}</option>
        <option value="top4">{t('tft.top4')}</option>
        <option value="win">{t('tft.top1')}</option>
        <option value="pick">{t('tft.pickRate')}</option>
        <option value="games">{t('tft.gamesShort')}</option>
        {trendingAvailable && <option value="velocity">{t('tft.velocity.trending')}</option>}
      </Select>
      {/* Zu sehen ist nur die Patch-Nummer wie in der Vorlage, die Auswahl liegt
          unsichtbar darueber und zeigt beim Oeffnen die vollen Eintraege. */}
      <div
        className="relative flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-raised pl-3 pr-8 py-2 min-w-0 focus-within:border-accent-a60 lg:ml-auto"
        title={patchHintOf(filters, patches, t) ?? undefined}
      >
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-pos-win flex-shrink-0" />
        <span className="text-xs text-fg-secondary">{t('tft.filter.patch')}</span>
        {shownPatch && <span className="text-xs text-white whitespace-nowrap tabular-nums">{tftPatchLabel(shownPatch.patch)}</span>}
        <select
          aria-label={t('tft.filter.patch')}
          value={filters.patch}
          onChange={e => onChange({ ...filters, patch: e.target.value })}
          className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
        >
          <PatchOptions patches={patches} />
        </select>
        <Chevron />
      </div>
    </div>
  );
}
