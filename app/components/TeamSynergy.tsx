'use client';
import { useState } from 'react';
import { useI18n } from '../lib/i18n';

interface SynergyBreakdown {
  score: number;
  detail: string;
}

interface SynergyResult {
  teamName: string;
  overallScore: number;
  grade: string;
  breakdown: {
    roleCoverage: SynergyBreakdown;
    rosterStability: SynergyBreakdown;
    experienceScore: SynergyBreakdown;
    competitiveRecord: SynergyBreakdown;
    regionalStrength: SynergyBreakdown;
  };
  insights: string[];
}

interface TeamSynergyProps {
  roster: any[];
  teamName: string;
  results: any[];
  region?: string;
}

const GRADE_COLORS: Record<string, string> = {
  S: '#f0c040', A: '#4ade80', B: '#60a5fa', C: '#a0b0c5', D: '#f87171',
};

const CATEGORY_KEYS: Record<string, { key: string; icon: string }> = {
  titleRate: { key: 'synergy.titleRate', icon: '🏆' },
  experienceScore: { key: 'synergy.experience', icon: '📊' },
  competitiveRecord: { key: 'synergy.competition', icon: '⚔️' },
  regionalStrength: { key: 'synergy.region', icon: '🌍' },
};

export default function TeamSynergy({ roster, teamName, results, region }: TeamSynergyProps) {
  const { t } = useI18n();
  const [synergy, setSynergy] = useState<SynergyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const analyze = async () => {
    if (synergy) { setExpanded(!expanded); return; }
    setLoading(true);
    setExpanded(true);
    try {
      const res = await fetch('/api/team-synergy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roster, teamName, results, region }),
      });
      const data = await res.json();
      if (res.ok) setSynergy(data);
    } catch {} finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={analyze}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#c89b3c]/10 border border-[#c89b3c]/20 text-[#c89b3c] text-[10px] font-medium hover:bg-[#c89b3c]/20 transition-colors"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        {t('synergy.analyze')}
        {loading && <div className="w-3 h-3 border border-[#c89b3c] border-t-transparent rounded-full animate-spin" />}
      </button>

      {expanded && synergy && (
        <div className="mt-3 bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-3 space-y-3">
          {/* Grade header */}
          <div className="flex items-center justify-between">
            <div className="text-white text-sm font-medium">{t('synergy.title')}</div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold" style={{ color: GRADE_COLORS[synergy.grade] || '#a0b0c5' }}>
                {synergy.grade}
              </span>
              <span className="text-[#7a8aa0] text-xs">{synergy.overallScore}/100</span>
            </div>
          </div>

          {/* Breakdown bars */}
          <div className="space-y-2">
            {Object.entries(synergy.breakdown).map(([key, val]) => {
              const cat = CATEGORY_KEYS[key];
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[#a0b0c5] text-[10px]">{cat?.icon} {cat ? t(cat.key as any) : key}</span>
                    <span className="text-white text-[10px] font-medium">{val.score}</span>
                  </div>
                  <div className="w-full h-1 bg-[#1e2a3a] rounded-full">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${val.score}%`,
                        backgroundColor: val.score >= 70 ? '#4ade80' : val.score >= 50 ? '#f0c040' : '#f87171',
                      }}
                    />
                  </div>
                  <div className="text-[#7a8aa0] text-[9px] mt-0.5">{val.detail}</div>
                </div>
              );
            })}
          </div>

          {/* Insights */}
          {synergy.insights.length > 0 && (
            <div className="border-t border-[#1e2a3a] pt-2 space-y-1">
              {synergy.insights.map((insight, i) => (
                <div key={i} className="text-[#a0b0c5] text-[11px] flex items-start gap-1.5">
                  <span className="text-[#c89b3c] mt-0.5">·</span>
                  {insight}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
