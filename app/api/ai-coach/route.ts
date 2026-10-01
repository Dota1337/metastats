import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../lib/supabase';
import {
  ROLE_CATEGORIES, MID_CATEGORIES, getGrade, computePercentile, getImprovementTip,
} from '../../lib/ai-coach-categories';

/**
 * AI Coach — Role-specific performance analysis.
 * Kategorien, Vergleichswerte und Texte liegen in app/lib/ai-coach-categories.ts
 * (rein, ohne next/supabase, damit der Uebersetzungs-Waechter sie importieren kann).
 */

// ─── API Routes ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const puuid = request.nextUrl.searchParams.get('puuid');
  if (!puuid) return NextResponse.json({ error: 'puuid required' }, { status: 400 });

  try {
    const { data: player } = await supabase.from('players').select('*').eq('puuid', puuid).single();
    if (!player) return NextResponse.json({ error: 'Spieler nicht gefunden' }, { status: 404 });

    return NextResponse.json({ tier: player.tier || 'GOLD', playerName: player.summoner_name });
  } catch {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { matches, tier, role: playerRole } = await request.json();
    if (!matches || !Array.isArray(matches) || matches.length === 0) {
      return NextResponse.json({ error: 'Match-Daten erforderlich' }, { status: 400 });
    }

    const effectiveTier = tier || 'GOLD';
    const role = playerRole || detectRole(matches);
    const normalizedRole = normalizeRole(role);
    const categories = ROLE_CATEGORIES[normalizedRole] || MID_CATEGORIES;
    const gamesAnalyzed = matches.length;
    const avgDuration = matches.reduce((s: number, m: any) => s + (m.gameDuration || 1800), 0) / gamesAnalyzed / 60;

    // Evaluate each category
    const insights: any[] = [];

    for (const cat of categories) {
      const playerVal = cat.compute(matches, avgDuration);
      const benchmark = cat.benchmarks[effectiveTier] || cat.benchmarks.DEFAULT;
      const percentile = computePercentile(playerVal, benchmark, !!cat.inverse);
      const priority = Math.abs(percentile - 50) / 10;

      const isStrength = percentile >= 65;
      const isWeakness = percentile < 45;

      insights.push({
        type: isStrength ? 'strength' : isWeakness ? 'weakness' : 'tip',
        category: cat.key,
        title: cat.name,
        description: isStrength ? cat.advice.good : isWeakness ? cat.advice.bad : '',
        stat: formatStat(cat.key, playerVal),
        playerValue: +playerVal.toFixed(2),
        benchmarkValue: +benchmark.toFixed(2),
        percentile,
        priority: Math.round(priority),
      });
    }

    // Weighted overall score
    const totalWeight = categories.reduce((s, c) => s + c.weight, 0);
    const overallScore = Math.round(
      insights.reduce((s: number, insight: any, i: number) => s + insight.percentile * categories[i].weight, 0) / totalWeight
    );

    const strengths = insights.filter((i: any) => i.type === 'strength').sort((a: any, b: any) => b.priority - a.priority).slice(0, 5);
    const weaknesses = insights.filter((i: any) => i.type === 'weakness').sort((a: any, b: any) => b.priority - a.priority).slice(0, 5);
    const tips = insights.filter((i: any) => i.type === 'tip').sort((a: any, b: any) => b.priority - a.priority).slice(0, 3);

    const roleLabel = { TOP: 'Top', JUNGLE: 'Jungle', MID: 'Mid', BOTTOM: 'ADC', SUPPORT: 'Support' }[normalizedRole] || role;

    const improvement = getImprovementTip(normalizedRole, weaknesses);

    return NextResponse.json({
      overallGrade: getGrade(overallScore),
      overallScore,
      strengths,
      weaknesses,
      tips,
      role: roleLabel,
      tier: effectiveTier,
      gamesAnalyzed,
      comparedTo: effectiveTier,
      roleKey: normalizedRole,
      improvementPotential: improvement.text,
      improvementKey: improvement.key,
    });
  } catch {
    return NextResponse.json({ error: 'Analyse fehlgeschlagen' }, { status: 500 });
  }
}

function detectRole(matches: any[]): string {
  const counts: Record<string, number> = {};
  matches.forEach((m: any) => { counts[m.role || 'UNKNOWN'] = (counts[m.role || 'UNKNOWN'] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'MID';
}

function normalizeRole(role: string): string {
  const map: Record<string, string> = {
    TOP: 'TOP', JUNGLE: 'JUNGLE', MID: 'MID', MIDDLE: 'MID',
    BOTTOM: 'BOTTOM', ADC: 'BOTTOM', UTILITY: 'SUPPORT', SUPPORT: 'SUPPORT',
  };
  return map[role.toUpperCase()] || 'MID';
}

function formatStat(cat: string, val: number): string {
  if (cat === 'killParticipation' || cat === 'dmgShare') return `${val.toFixed(1)}%`;
  if (cat === 'kda') return val.toFixed(2);
  if (cat === 'deathsPerGame') return val.toFixed(1);
  if (cat === 'objectiveDmg' || cat === 'damagePerMin' || cat === 'goldPerMin' || cat === 'utility') return Math.round(val).toString();
  return val.toFixed(1);
}
