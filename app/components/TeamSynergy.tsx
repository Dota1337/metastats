'use client';
import { useMemo, useState } from 'react';
import { useI18n, LOCALE_MAP, type TranslationKey } from '../lib/i18n';
import { computeTeamSynergy, type SynergyInsight, type RegionCode } from '../lib/team-synergy';

interface TeamSynergyProps {
  roster: any[];
  teamName: string;
  results: any[];
  region?: string;
}

const GRADE_COLORS: Record<string, string> = {
  S: '#f0c040', A: '#4ade80', B: '#60a5fa', C: 'var(--fg-secondary)', D: '#f87171',
};

export default function TeamSynergy({ roster, results, region }: TeamSynergyProps) {
  const { t, lang } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const synergy = useMemo(() => computeTeamSynergy({ roster, results, region }), [roster, results, region]);

  // Ohne ein einziges gewertetes Turnierergebnis gibt es nichts zu bewerten.
  if (!synergy) return null;

  const num = (v: number) => v.toLocaleString(LOCALE_MAP[lang], { maximumFractionDigits: 1 });
  const regionName = (code: RegionCode) => t(`synergy.regionName.${code}` as TranslationKey);
  const fill = (key: TranslationKey, vals: Record<string, string | number>) =>
    Object.entries(vals).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), t(key));

  const rows: { key: string; icon: string; label: TranslationKey; score: number; detail: string }[] = [
    {
      key: 'titleRate', icon: '🏆', label: 'synergy.titleRate', score: synergy.titleRate.score,
      detail: fill('synergy.detail.titles', { titles: synergy.titleRate.titles, n: synergy.titleRate.events, pct: num(synergy.titleRate.pct) }),
    },
    {
      key: 'experience', icon: '📊', label: 'synergy.experience', score: synergy.experience.score,
      detail: fill('synergy.detail.experience', { n: synergy.experience.events, top4: synergy.experience.top4 }),
    },
  ];
  if (synergy.recentForm) rows.push({
    key: 'recentForm', icon: '⚔️', label: 'synergy.competition', score: synergy.recentForm.score,
    detail: fill('synergy.detail.recent', { avg: num(synergy.recentForm.avgPlace), n: synergy.recentForm.count }),
  });
  if (synergy.region) rows.push({
    key: 'region', icon: '🌍', label: 'synergy.region', score: synergy.region.score,
    detail: fill('synergy.detail.region', { region: regionName(synergy.region.code), score: synergy.region.score }),
  });

  const insightText = (i: SynergyInsight) => {
    switch (i.code) {
      case 'highTitleRate': return fill('synergy.insight.highTitleRate', { pct: num(Math.round(i.pct)) });
      case 'strongRegion': return fill('synergy.insight.strongRegion', { region: regionName(i.region) });
      default: return t(`synergy.insight.${i.code}` as TranslationKey);
    }
  };

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-accent-a10 border border-accent-a20 text-accent text-[10px] font-medium hover:bg-accent-a20 transition-colors"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        {t('synergy.analyze')}
      </button>

      {expanded && (
        <div className="mt-3 bg-surface-base border border-border-subtle rounded-lg p-3 space-y-3">
          {/* Grade header */}
          <div className="flex items-center justify-between">
            <div className="text-white text-sm font-medium">{t('synergy.title')}</div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold" style={{ color: GRADE_COLORS[synergy.grade] || 'var(--fg-secondary)' }}>
                {synergy.grade}
              </span>
              <span className="text-fg-muted text-xs">{synergy.overallScore}/100</span>
            </div>
          </div>

          {/* Breakdown bars */}
          <div className="space-y-2">
            {rows.map(row => (
              <div key={row.key}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-fg-secondary text-[10px]">{row.icon} {t(row.label)}</span>
                  <span className="text-white text-[10px] font-medium">{row.score}</span>
                </div>
                <div className="w-full h-1 bg-surface-overlay rounded-full">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${row.score}%`,
                      backgroundColor: row.score >= 70 ? '#4ade80' : row.score >= 50 ? '#f0c040' : '#f87171',
                    }}
                  />
                </div>
                <div className="text-fg-muted text-[9px] mt-0.5">{row.detail}</div>
              </div>
            ))}
          </div>

          {/* Insights */}
          {synergy.insights.length > 0 && (
            <div className="border-t border-border-subtle pt-2 space-y-1">
              {synergy.insights.map((insight, i) => (
                <div key={i} className="text-fg-secondary text-[11px] flex items-start gap-1.5">
                  <span className="text-accent mt-0.5">·</span>
                  {insightText(insight)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
