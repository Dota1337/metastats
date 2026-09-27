'use client';
import Link from 'next/link';
import { useI18n } from '../../lib/i18n';
import { filtersToQueryString, type Filters } from './StatsFilterBar';

// Unterreiter der Comp-Seiten: Liste (/tft/comps) und Uebersicht nach
// Unit-Kosten (/tft/comps/atlas). Die Filter wandern im Link mit, damit beim
// Wechsel dieselben Comps stehen.
export default function CompsTabs({ active, filters }: { active: 'list' | 'overview'; filters: Filters }) {
  const { t } = useI18n();
  const qs = filtersToQueryString(filters);
  const tabs = [
    { key: 'list' as const, href: `/tft/comps?${qs}`, label: t('tft.comps.tab.list') },
    { key: 'overview' as const, href: `/tft/comps/atlas?${qs}`, label: t('tft.comps.tab.overview') },
  ];
  return (
    <div className="flex items-center gap-1 mb-3">
      {tabs.map(tab => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? 'page' : undefined}
          className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
            active === tab.key
              ? 'bg-accent-a20 border-accent-a60 text-white'
              : 'bg-surface-raised border-border-subtle text-fg-secondary hover:text-white hover:border-accent-a40'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
