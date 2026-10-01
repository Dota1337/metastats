'use client';
import { useState, useEffect } from 'react';
import { useI18n, type TranslationKey } from '../lib/i18n';

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
  // seit der Uebersetzung (2026-10-01); fehlen sie, bleibt der deutsche Servertext
  roleKey?: string;
  improvementKey?: string;
}

type Tr = (key: string, fallback: string) => string;

const ROLE_I18N: Record<string, string> = {
  TOP: 'role.top', JUNGLE: 'role.jungle', MID: 'role.mid', BOTTOM: 'role.adc', SUPPORT: 'role.support',
};

interface AICoachProps {
  matches: any[];
  tier?: string;
  role?: string;
}

const GRADE_COLORS: Record<string, string> = {
  'S+': '#f0c040', 'S': '#f0c040', 'A': '#4ade80', 'B': '#60a5fa',
  'C': 'var(--fg-secondary)', 'D': '#f87171', 'D-': '#ef4444',
};

export default function AICoach({ matches, tier, role }: AICoachProps) {
  const { t } = useI18n();
  // t() liefert den Schluessel selbst, wenn er fehlt — dann den Servertext zeigen.
  const tr: Tr = (key, fallback) => { const v = t(key as TranslationKey); return v && v !== key ? v : fallback; };
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
    <div className="bg-gradient-to-br from-surface-base to-surface-raised border border-border-subtle rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-overlay/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-[#785a28] flex items-center justify-center text-white text-sm font-bold">
            AI
          </div>
          <div className="text-left">
            <div className="text-white text-sm font-medium">AI Coach</div>
            <div className="text-fg-muted text-[10px]">
              {loading ? t('coach.analyzing') : report ? `${report.gamesAnalyzed} ${t('coach.gamesAnalyzed')}` : ''}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {report && !loading && (
            <>
              <div className="text-right">
                <div className={`text-lg font-bold`} style={{ color: GRADE_COLORS[report.overallGrade] || 'var(--fg-secondary)' }}>
                  {report.overallGrade}
                </div>
              </div>
              {/* Score bar */}
              <div className="w-16 h-1.5 bg-surface-overlay rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${report.overallScore}%`,
                    backgroundColor: GRADE_COLORS[report.overallGrade] || 'var(--fg-secondary)',
                  }}
                />
              </div>
            </>
          )}
          {loading && (
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          )}
          <svg className={`w-4 h-4 text-fg-muted transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && report && (
        <div className="px-4 pb-4 space-y-4">
          {/* Improvement tip */}
          <div className="bg-accent-a10 border border-accent-a20 rounded-lg px-3 py-2">
            <div className="text-accent text-[10px] font-medium uppercase tracking-wider mb-1">{t('coach.improvement')}</div>
            <div className="text-[#e8d5a3] text-xs">{improvementText(report, tr)}</div>
          </div>

          {/* Compared to tier */}
          <div className="text-fg-muted text-[10px] text-center">
            {t('coach.comparedWith')} {tr(`tier.${report.comparedTo.toLowerCase()}`, report.comparedTo)}{t('coach.playersRole')} {report.roleKey && ROLE_I18N[report.roleKey] ? tr(ROLE_I18N[report.roleKey], report.role) : report.role}
          </div>

          {/* Strengths */}
          {report.strengths.length > 0 && (
            <div>
              <div className="text-green-400 text-[10px] font-medium uppercase tracking-wider mb-2">{t('coach.strengths')}</div>
              <div className="space-y-1.5">
                {report.strengths.map((s, i) => (
                  <InsightCard key={i} insight={s} color="green" roleKey={report.roleKey} tr={tr} />
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
                  <InsightCard key={i} insight={s} color="red" roleKey={report.roleKey} tr={tr} />
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
                  <InsightCard key={i} insight={s} color="blue" roleKey={report.roleKey} tr={tr} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function improvementText(report: CoachingReport, tr: Tr): string {
  const key = report.improvementKey;
  if (!key) return report.improvementPotential;
  if (key === 'none') return tr('coach.tip.none', report.improvementPotential);
  if (key.startsWith('focus:')) {
    const cat = key.slice(6);
    const weakest = report.weaknesses[0];
    const name = tr(`coach.${report.roleKey}.${cat}.title`, weakest?.title || cat);
    const tpl = tr('coach.tip.focus', '');
    return tpl ? tpl.replace('{name}', name) : report.improvementPotential;
  }
  return tr(`coach.tip.${key}`, report.improvementPotential);
}

function InsightCard({ insight, color, roleKey, tr }: { insight: CoachingInsight; color: 'green' | 'red' | 'blue'; roleKey?: string; tr: Tr }) {
  const base = roleKey ? `coach.${roleKey}.${insight.category}` : '';
  const title = base ? tr(`${base}.title`, insight.title) : insight.title;
  const adviceKind = insight.type === 'strength' ? 'good' : insight.type === 'weakness' ? 'bad' : '';
  const description = insight.description && base && adviceKind ? tr(`${base}.${adviceKind}`, insight.description) : insight.description;
  const colors = {
    green: { bg: 'bg-green-500/5', border: 'border-green-500/20', text: 'text-green-400', bar: 'bg-green-500' },
    red: { bg: 'bg-red-500/5', border: 'border-red-500/20', text: 'text-red-400', bar: 'bg-red-500' },
    blue: { bg: 'bg-blue-500/5', border: 'border-blue-500/20', text: 'text-blue-400', bar: 'bg-blue-500' },
  };
  const c = colors[color];

  return (
    <div className={`${c.bg} border ${c.border} rounded-lg px-3 py-2`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-white text-xs font-medium">{title}</span>
        <div className="flex items-center gap-2">
          <span className={`${c.text} text-xs font-bold`}>{insight.stat}</span>
          <span className="text-fg-muted text-[10px]">/ {formatBenchmark(insight.category, insight.benchmarkValue)}</span>
        </div>
      </div>
      {/* Percentile bar */}
      <div className="w-full h-1 bg-surface-overlay rounded-full mb-1.5">
        <div className={`h-full ${c.bar} rounded-full transition-all duration-500`} style={{ width: `${insight.percentile}%` }} />
      </div>
      {description && (
        <div className="text-fg-secondary text-[11px] leading-relaxed">{description}</div>
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
