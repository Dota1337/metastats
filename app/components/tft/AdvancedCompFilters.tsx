'use client';
import { useState, type ReactNode } from 'react';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { ADV_DEFAULT, isAdvActive, type AdvancedFilters, type CostGroup } from '../../lib/tft-comp-adv-filters';

// W1-C: Multi-Criteria-Filter — Pro-Tool, um versteckte Power-Comps zu finden
// (z.B. „avgPlace<4.4 UND pickrate<5% UND games>500" = under-the-radar S-Tier).
// Reine Client-Filterung über die bereits geladene Comp-Liste; keine zusätzlichen
// API-Calls. Preset-Chips deck'n die häufigsten Pro-Fragen ab.

// Kriterien, Adress-Format und Filterung liegen in lib/tft-comp-adv-filters.ts
// (ohne JSX, testbar). Gefiltert werden fertige Comps an ihren Familienwerten.

// Pro-Presets — die häufigsten Such-Patterns. Werte konservativ gewählt:
// "Hidden Gems" trifft S-Tier-Comps unter 5% Pickrate (= das, was die meisten
// Leute übersehen). "Safe Picks" priorisiert Konsistenz. "Tournament-strong"
// belohnt high-roll-potential (Top1) bei akzeptablem Floor.
const PRESETS: { key: string; labelKey: string; filters: AdvancedFilters }[] = [
  { key: 'gems',       labelKey: 'tft.adv.preset.gems',       filters: { ...ADV_DEFAULT, avgPlaceMax: 4.4, pickMaxPct: 5, gamesMin: 200 } },
  { key: 'safe',       labelKey: 'tft.adv.preset.safe',       filters: { ...ADV_DEFAULT, top4MinPct: 55, gamesMin: 300 } },
  { key: 'tournament', labelKey: 'tft.adv.preset.tournament', filters: { ...ADV_DEFAULT, top1MinPct: 18, gamesMin: 200 } },
];

interface Props {
  filters: AdvancedFilters;
  onChange: (next: AdvancedFilters) => void;
  // Fehlen sie, zeigt der Knopf keine Zaehler (/tft/comps auf Teildaten:
  // Zaehler ueber 111 statt aller Comps waeren falsch).
  resultCount?: number;
  totalCount?: number;
  // Rechts in der Zeile der Advanced-Knoepfe (auf /tft/comps: Sortierung).
  trailing?: ReactNode;
}

export default function AdvancedCompFilters({ filters, onChange, resultCount, totalCount, trailing }: Props) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(isAdvActive(filters));
  const active = isAdvActive(filters);

  const COST_GROUPS: { value: CostGroup; labelKey: string }[] = [
    { value: 'all',    labelKey: 'tft.cost.all' },
    { value: 'reroll', labelKey: 'tft.cost.reroll' },
    { value: 'mid',    labelKey: 'tft.cost.mid' },
    { value: 'fast8',  labelKey: 'tft.cost.fast8' },
  ];

  return (
    <div className="mb-2 space-y-2">
      {/* Cost-Bucket-Filter eigene Pill-Reihe — direkt sichtbar, kein
          expansion nötig. Reroll/Mid/Fast 8 sind die Standard-Pro-Buckets
          die jeden Tag genutzt werden. */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-fg-muted text-[10px] uppercase tracking-widest mr-1">{t('tft.cost.label')}:</span>
        {COST_GROUPS.map(g => {
          const isOn = filters.costGroup === g.value;
          return (
            <button
              key={g.value}
              type="button"
              onClick={() => onChange({ ...filters, costGroup: g.value })}
              className={`px-2.5 py-1 rounded border transition-colors ${
                isOn
                  ? 'bg-[#c39bff]/20 border-[#c39bff]/60 text-[#c39bff]'
                  : 'bg-surface-raised border-border-subtle text-fg-secondary hover:border-[#c39bff]/40'
              }`}
            >
              {t(g.labelKey as TranslationKey)}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className={`px-3 py-1 rounded border transition-colors ${
            active
              ? 'bg-accent-a15 border-accent-a60 text-[#a892ff]'
              : 'bg-surface-raised border-border-subtle text-fg-secondary hover:border-accent-a40'
          }`}
        >
          {expanded ? '−' : '+'} {t('tft.adv.title')}
          {active && resultCount != null && totalCount != null && <span className="ml-1.5 text-[10px] tabular-nums">({resultCount}/{totalCount})</span>}
        </button>
        {PRESETS.map(p => {
          const isOn = JSON.stringify(filters) === JSON.stringify(p.filters);
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(isOn ? ADV_DEFAULT : p.filters)}
              className={`px-2.5 py-1 rounded border transition-colors ${
                isOn
                  ? 'bg-[#3ecf8e]/15 border-[#3ecf8e]/60 text-[#3ecf8e]'
                  : 'bg-surface-raised border-border-subtle text-fg-secondary hover:border-[#3ecf8e]/40'
              }`}
            >
              {t(p.labelKey as TranslationKey)}
            </button>
          );
        })}
        {active && (
          <button
            type="button"
            onClick={() => onChange(ADV_DEFAULT)}
            className="px-2 py-1 rounded text-fg-muted hover:text-white text-[11px]"
          >
            × {t('tft.adv.reset')}
          </button>
        )}
        {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
      </div>

      {expanded && (
        <div className="mt-2 bg-surface-base border border-border-subtle rounded p-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
          <NumField label={t('tft.adv.avgMax')} value={filters.avgPlaceMax} step={0.1}
            onChange={v => onChange({ ...filters, avgPlaceMax: v })} placeholder="4.4" />
          <NumField label={t('tft.adv.top4Min')} value={filters.top4MinPct} step={1} suffix="%"
            onChange={v => onChange({ ...filters, top4MinPct: v })} placeholder="55" />
          <NumField label={t('tft.adv.top1Min')} value={filters.top1MinPct} step={1} suffix="%"
            onChange={v => onChange({ ...filters, top1MinPct: v })} placeholder="18" />
          <NumField label={t('tft.adv.pickMax')} value={filters.pickMaxPct} step={0.5} suffix="%"
            onChange={v => onChange({ ...filters, pickMaxPct: v })} placeholder="5" />
          <NumField label={t('tft.adv.gamesMin')} value={filters.gamesMin} step={50}
            onChange={v => onChange({ ...filters, gamesMin: v })} placeholder="200" />
        </div>
      )}
    </div>
  );
}

function NumField({
  label, value, onChange, placeholder, step = 1, suffix,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-fg-muted text-[10px] uppercase tracking-widest">{label}</span>
      <div className="flex items-center mt-0.5">
        <input
          type="number"
          step={step}
          value={value ?? ''}
          placeholder={placeholder}
          onChange={e => {
            const raw = e.target.value;
            if (raw === '') return onChange(null);
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : null);
          }}
          className="w-full bg-surface-raised border border-border-subtle rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accent-a60"
        />
        {suffix && <span className="text-fg-muted text-[10px] ml-1">{suffix}</span>}
      </div>
    </label>
  );
}
