'use client';
import Link from 'next/link';
import { useI18n } from '../../lib/i18n';
import { filtersToQueryString, type Filters } from './StatsFilterBar';

// Umschalter der Comp-Seiten: Liste (/tft/comps) und Uebersicht nach
// Unit-Kosten (/tft/comps/atlas). Sitzt links in der Filterleiste
// (StatsFilterBar `lead`), damit der Ansichtswechsel sofort auffaellt. Die Filter wandern
// im Link mit, damit beim Wechsel dieselben Comps stehen.
export default function CompsTabs({ active, filters }: { active: 'list' | 'overview'; filters: Filters }) {
  const { t } = useI18n();
  const qs = filtersToQueryString(filters);
  const tabs = [
    {
      key: 'list' as const, href: `/tft/comps?${qs}`, label: t('tft.comps.tab.list'),
      icon: <path d="M3 5h14M3 10h14M3 15h14" />,
    },
    {
      key: 'overview' as const, href: `/tft/comps/atlas?${qs}`, label: t('tft.comps.tab.overview'),
      icon: <path d="M3 3h5.5v5.5H3zM11.5 3H17v5.5h-5.5zM3 11.5h5.5V17H3zM11.5 11.5H17V17h-5.5z" />,
    },
  ];
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-lg border border-accent-a40 bg-surface-raised">
      {tabs.map(tab => {
        const on = active === tab.key;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={on ? 'page' : undefined}
            className={`inline-flex items-center gap-2 px-5 py-2 rounded-md text-sm font-semibold transition-colors ${
              on ? 'bg-accent text-white' : 'text-fg-secondary hover:text-white hover:bg-accent-a20'
            }`}
            style={on ? { boxShadow: '0 0 12px rgb(var(--accent-rgb) / 35%)' } : undefined}
          >
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {tab.icon}
            </svg>
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
