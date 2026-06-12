'use client';
import { useState } from 'react';
import { useI18n, type TranslationKey } from '../../lib/i18n';

// W1-C: Multi-Criteria-Filter — Pro-Tool, um versteckte Power-Comps zu finden
// (z.B. „avgPlace<4.4 UND pickrate<5% UND games>500" = under-the-radar S-Tier).
// Reine Client-Filterung über die bereits geladene Comp-Liste; keine zusätzlichen
// API-Calls. Preset-Chips deck'n die häufigsten Pro-Fragen ab.

// Carry-Kosten-Gruppen — mappt 1-2-Cost auf "Reroll", 3-Cost auf "Mid",
// 4-5-Cost auf "Fast 8/9". Pro-Filter den metatft.com schon hat, bei uns
// fehlte er bisher. Der costLookup im applyAdvancedFilters resolved den
// Cluster-Key über das Asset-Bundle zum Carry-Cost.
export type CostGroup = 'all' | 'reroll' | 'mid' | 'fast8';

export interface AdvancedFilters {
  avgPlaceMax: number | null;     // Ø-Platzierung höchstens X (kleiner = besser)
  top4MinPct: number | null;      // Top-4-Rate mindestens X%
  top1MinPct: number | null;      // Top-1-Rate mindestens X%
  pickMaxPct: number | null;      // Pickrate höchstens X% (für versteckte Comps)
  gamesMin: number | null;        // Mindest-Samplegröße
  costGroup: CostGroup;           // Reroll / Mid / Fast8 / Alle
}

export const ADV_DEFAULT: AdvancedFilters = {
  avgPlaceMax: null,
  top4MinPct: null,
  top1MinPct: null,
  pickMaxPct: null,
  gamesMin: null,
  costGroup: 'all',
};

// Active when at least one constraint is set.
export function isAdvActive(f: AdvancedFilters): boolean {
  return f.avgPlaceMax != null || f.top4MinPct != null || f.top1MinPct != null
    || f.pickMaxPct != null || f.gamesMin != null || f.costGroup !== 'all';
}

// Carry-Cost-Bucket-Matcher. 1-2 = Reroll, 3 = Mid, 4-5 = Fast 8/9. Cost === 0
// (Set-Boss / NPC) wird wie 1 gewertet, > 5 (Set-Sondermechanik) wie 5.
function matchesCostGroup(group: CostGroup, cost: number | null): boolean {
  if (group === 'all') return true;
  if (cost == null) return false;
  const c = Math.max(1, Math.min(5, cost));
  if (group === 'reroll') return c <= 2;
  if (group === 'mid') return c === 3;
  if (group === 'fast8') return c >= 4;
  return true;
}

// Apply filters to a list of comps (client-side). Comps with missing metric
// values pass when no constraint references that metric, and fail any constraint
// that touches a missing value (so partial data doesn't masquerade as a fit).
export function applyAdvancedFilters<T extends {
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  pickRate?: number | null;
  games: number;
  clusterKey?: string;
}>(comps: T[], f: AdvancedFilters, opts?: {
  // Optional Asset-Bundle-getriebene Lookup-Funktion. Die Component selbst
  // sieht die Assets nicht — die liegen in der Page als State — also wird der
  // Lookup als Callback durchgereicht. null wenn der Carry nicht im Bundle
  // gefunden wird (Stale-Daten nach Set-Wechsel etc.).
  carryCostLookup?: (clusterKey: string) => number | null;
}): T[] {
  return comps.filter(c => {
    if (f.avgPlaceMax != null && (c.avgPlacement == null || c.avgPlacement > f.avgPlaceMax)) return false;
    if (f.top4MinPct != null && (c.top4Rate == null || c.top4Rate * 100 < f.top4MinPct)) return false;
    if (f.top1MinPct != null && (c.top1Rate == null || c.top1Rate * 100 < f.top1MinPct)) return false;
    if (f.pickMaxPct != null && c.pickRate != null && c.pickRate * 100 > f.pickMaxPct) return false;
    if (f.gamesMin != null && c.games < f.gamesMin) return false;
    if (f.costGroup !== 'all') {
      const cost = opts?.carryCostLookup && c.clusterKey ? opts.carryCostLookup(c.clusterKey) : null;
      if (!matchesCostGroup(f.costGroup, cost)) return false;
    }
    return true;
  });
}

// URL helpers: pack into a single "adv" param so URLs stay compact and
// shareable. Format: avgMax=4.4_top4Min=50_gamesMin=500_pickMax=8.
export function advToUrlParam(f: AdvancedFilters): string | null {
  const parts: string[] = [];
  if (f.avgPlaceMax != null) parts.push(`avgMax=${f.avgPlaceMax}`);
  if (f.top4MinPct != null) parts.push(`top4Min=${f.top4MinPct}`);
  if (f.top1MinPct != null) parts.push(`top1Min=${f.top1MinPct}`);
  if (f.pickMaxPct != null) parts.push(`pickMax=${f.pickMaxPct}`);
  if (f.gamesMin != null) parts.push(`gamesMin=${f.gamesMin}`);
  if (f.costGroup !== 'all') parts.push(`cost=${f.costGroup}`);
  return parts.length > 0 ? parts.join('_') : null;
}

export function advFromUrlParam(raw: string | null): AdvancedFilters {
  if (!raw) return ADV_DEFAULT;
  const out: AdvancedFilters = { ...ADV_DEFAULT };
  for (const p of raw.split('_')) {
    const [k, v] = p.split('=');
    if (k === 'cost') {
      if (v === 'reroll' || v === 'mid' || v === 'fast8') out.costGroup = v;
      continue;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (k === 'avgMax') out.avgPlaceMax = n;
    else if (k === 'top4Min') out.top4MinPct = n;
    else if (k === 'top1Min') out.top1MinPct = n;
    else if (k === 'pickMax') out.pickMaxPct = n;
    else if (k === 'gamesMin') out.gamesMin = n;
  }
  return out;
}

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
  resultCount: number;
  totalCount: number;
}

export default function AdvancedCompFilters({ filters, onChange, resultCount, totalCount }: Props) {
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
    <div className="mb-3 space-y-2">
      {/* Cost-Bucket-Filter eigene Pill-Reihe — direkt sichtbar, kein
          expansion nötig. Reroll/Mid/Fast 8 sind die Standard-Pro-Buckets
          die jeden Tag genutzt werden. */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-[#7a8aa0] text-[10px] uppercase tracking-widest mr-1">{t('tft.cost.label')}:</span>
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
                  : 'bg-[#141c2e] border-[#1e2a3a] text-[#a0b0c5] hover:border-[#c39bff]/40'
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
              ? 'bg-[#7B61FF]/15 border-[#7B61FF]/60 text-[#a892ff]'
              : 'bg-[#141c2e] border-[#1e2a3a] text-[#a0b0c5] hover:border-[#7B61FF]/40'
          }`}
        >
          {expanded ? '−' : '+'} {t('tft.adv.title')}
          {active && <span className="ml-1.5 text-[10px] tabular-nums">({resultCount}/{totalCount})</span>}
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
                  : 'bg-[#141c2e] border-[#1e2a3a] text-[#a0b0c5] hover:border-[#3ecf8e]/40'
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
            className="px-2 py-1 rounded text-[#7a8aa0] hover:text-white text-[11px]"
          >
            × {t('tft.adv.reset')}
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-2 bg-[#0d1526] border border-[#1e2a3a] rounded p-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
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
      <span className="text-[#7a8aa0] text-[10px] uppercase tracking-widest">{label}</span>
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
          className="w-full bg-[#141c2e] border border-[#1e2a3a] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#7B61FF]/60"
        />
        {suffix && <span className="text-[#7a8aa0] text-[10px] ml-1">{suffix}</span>}
      </div>
    </label>
  );
}
