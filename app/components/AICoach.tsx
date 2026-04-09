'use client';
import { useState, useEffect } from 'react';
import { useI18n } from '../lib/i18n';

interface CoachingInsight {
  type: 'strength' | 'weakness' | 'tip';
  category: string;
  title: string;
  description: string;
  stat: string;
  playerValue: number;
  benchmarkValue: number;
  percentile: number;
  priority: number;
}

interface CoachingReport {
  overallGrade: string;
  overallScore: number;
  strengths: CoachingInsight[];
  weaknesses: CoachingInsight[];
  tips: CoachingInsight[];
  role: string;
  tier: string;
  gamesAnalyzed: number;
  comparedTo: string;
  improvementPotential: string;
}

interface AICoachProps {
  matches: any[];
  tier?: string;
  role?: string;
}

const GRADE_COLORS: Record<string, string> = {
  'S+': '#f0c040', 'S': '#f0c040', 'A': '#4ade80', 'B': '#60a5fa',
  'C': '#8a9bb0', 'D': '#f87171', 'D-': '#ef4444',
};

export default function AICoach({ matches, tier, role }: AICoachProps) {
  const { t } = useI18n();
  const [report, setReport] = useState<CoachingReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (matches.length === 0) return;
    analyzePerformance();
  }, [matches, tier]);

  const analyzePerformance = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai-coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matches, tier: tier || 'GOLD', role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setReport(data);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  if (!report && !loading) return null;

  return (
    <div className="bg-gradient-to-br from-[#0d1526] to-[#141c2e] border border-[#1e2a3a] rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#1e2a3a]/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#c89b3c] to-[#785a28] flex items-center justify-center text-white text-sm font-bold">
            AI
          </div>
          <div className="text-left">
            <div className="text-white text-sm font-medium">AI Coach</div>
            <div className="text-[#4a5a70] text-[10px]">
              {loading ? t('coach.analyzing') : report ? `${report.gamesAnalyzed} ${t('coach.gamesAnalyzed')}` : ''}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {report && !loading && (
            <>
              <div className="text-right">
                <div className={`text-lg font-bold`} style={{ color: GRADE_COLORS[report.overallGrade] || '#8a9bb0' }}>
                  {report.overallGrade}
                </div>
              </div>
              {/* Score bar */}
              <div className="w-16 h-1.5 bg-[#1e2a3a] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${report.overallScore}%`,
                    backgroundColor: GRADE_COLORS[report.overallGrade] || '#8a9bb0',
                  }}
                />
              </div>
            </>
          )}
          {loading && (
            <div className="w-4 h-4 border-2 border-[#c89b3c] border-t-transparent rounded-full animate-spin" />
          )}
          <svg className={`w-4 h-4 text-[#4a5a70] transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && report && (
        <div className="px-4 pb-4 space-y-4">
          {/* Improvement tip */}
          <div className="bg-[#c89b3c]/10 border border-[#c89b3c]/20 rounded-lg px-3 py-2">
            <div className="text-[#c89b3c] text-[10px] font-medium uppercase tracking-wider mb-1">{t('coach.improvement')}</div>
            <div className="text-[#e8d5a3] text-xs">{report.improvementPotential}</div>
          </div>

          {/* Compared to tier */}
          <div className="text-[#4a5a70] text-[10px] text-center">
            {t('coach.comparedWith')} {report.comparedTo}{t('coach.playersRole')} {report.role}
          </div>

          {/* Strengths */}
          {report.strengths.length > 0 && (
            <div>
              <div className="text-green-400 text-[10px] font-medium uppercase tracking-wider mb-2">{t('coach.strengths')}</div>
              <div className="space-y-1.5">
                {report.strengths.map((s, i) => (
                  <InsightCard key={i} insight={s} color="green" />
                ))}
              </div>
            </div>
          )}

          {/* Weaknesses */}
          {report.weaknesses.length > 0 && (
            <div>
              <div className="text-red-400 text-[10px] font-medium uppercase tracking-wider mb-2">{t('coach.weaknesses')}</div>
              <div className="space-y-1.5">
                {report.weaknesses.map((s, i) => (
                  <InsightCard key={i} insight={s} color="red" />
                ))}
              </div>
            </div>
          )}

          {/* Tips */}
          {report.tips.length > 0 && (
            <div>
              <div className="text-blue-400 text-[10px] font-medium uppercase tracking-wider mb-2">{t('coach.tips')}</div>
              <div className="space-y-1.5">
                {report.tips.map((s, i) => (
                  <InsightCard key={i} insight={s} color="blue" />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InsightCard({ insight, color }: { insight: CoachingInsight; color: 'green' | 'red' | 'blue' }) {
  const colors = {
    green: { bg: 'bg-green-500/5', border: 'border-green-500/20', text: 'text-green-400', bar: 'bg-green-500' },
    red: { bg: 'bg-red-500/5', border: 'border-red-500/20', text: 'text-red-400', bar: 'bg-red-500' },
    blue: { bg: 'bg-blue-500/5', border: 'border-blue-500/20', text: 'text-blue-400', bar: 'bg-blue-500' },
  };
  const c = colors[color];

  return (
    <div className={`${c.bg} border ${c.border} rounded-lg px-3 py-2`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-white text-xs font-medium">{insight.title}</span>
        <div className="flex items-center gap-2">
          <span className={`${c.text} text-xs font-bold`}>{insight.stat}</span>
          <span className="text-[#4a5a70] text-[10px]">/ {formatBenchmark(insight.category, insight.benchmarkValue)}</span>
        </div>
      </div>
      {/* Percentile bar */}
      <div className="w-full h-1 bg-[#1e2a3a] rounded-full mb-1.5">
        <div className={`h-full ${c.bar} rounded-full transition-all duration-500`} style={{ width: `${insight.percentile}%` }} />
      </div>
      {insight.description && (
        <div className="text-[#8a9bb0] text-[11px] leading-relaxed">{insight.description}</div>
      )}
    </div>
  );
}

function formatBenchmark(cat: string, val: number): string {
  if (cat === 'killParticipation' || cat === 'dmgShare') return `${val.toFixed(1)}%`;
  if (cat === 'kda') return val.toFixed(2);
  if (cat === 'deathsPerGame') return val.toFixed(1);
  return val.toFixed(1);
}
