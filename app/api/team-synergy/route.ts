import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../lib/supabase';

/**
 * Team Synergy Score — Analyzes how well a team roster fits together
 * Based on: role coverage, champion pool diversity, playstyle compatibility
 */

interface SynergyResult {
  teamName: string;
  overallScore: number; // 0-100
  grade: string;
  breakdown: {
    titleRate: { score: number; detail: string };
    experienceScore: { score: number; detail: string };
    competitiveRecord: { score: number; detail: string };
    regionalStrength: { score: number; detail: string };
  };
  insights: string[];
}

// Regional strength rankings (based on international performance)
const REGION_STRENGTH: Record<string, number> = {
  Korea: 95, China: 92, Europe: 78, 'North America': 70,
  'Southeast Asia': 60, Brazil: 50, Japan: 48, Turkey: 45,
  CIS: 42, Oceania: 38, 'Latin America': 35,
};

export async function POST(request: NextRequest) {
  try {
    const { roster, teamName, results } = await request.json();

    if (!roster || !Array.isArray(roster)) {
      return NextResponse.json({ error: 'Roster erforderlich' }, { status: 400 });
    }

    const players = roster.filter((p: any) => p.isPlayer && p.status === 'main');
    const roles = players.map((p: any) => p.role);

    // 1. Title Rate (tournament wins / total tournaments)
    const resultsList0 = results || [];
    const goldTrophies = resultsList0.filter((r: any) => r.trophy === 'gold' || (typeof r.place === 'number' ? r.place : parseInt(r.place)) === 1).length;
    const totalEvents0 = resultsList0.length;
    const titleRatePct = totalEvents0 > 0 ? (goldTrophies / totalEvents0) * 100 : 0;
    const titleRateScore = Math.min(100, Math.round(
      totalEvents0 === 0 ? 0 :
      titleRatePct >= 25 ? 95 :
      titleRatePct >= 15 ? 75 :
      titleRatePct >= 8 ? 55 :
      titleRatePct >= 3 ? 35 :
      goldTrophies > 0 ? 20 : 5
    ));
    const titleRateDetail = totalEvents0 > 0
      ? `${goldTrophies} Titel in ${totalEvents0} Turnieren (${titleRatePct.toFixed(1)}%)`
      : 'Keine Turnierdaten';

    // 2. Experience Score (based on competitive results)
    const resultsList = results || [];
    const totalEvents = resultsList.length;
    const topFinishes = resultsList.filter((r: any) => {
      const place = typeof r.place === 'string' ? parseInt(r.place) : r.place;
      return place && place <= 4;
    }).length;
    const experienceScore = Math.min(100, Math.round(
      (Math.min(totalEvents, 30) / 30) * 50 + (topFinishes / Math.max(totalEvents, 1)) * 50
    ));
    const experienceDetail = `${totalEvents} Turniere, ${topFinishes} Top-4 Platzierungen`;

    // 4. Competitive Record (recent performance)
    const recentResults = resultsList.slice(0, 10);
    const avgPlace = recentResults.length > 0
      ? recentResults.reduce((s: number, r: any) => {
          const place = typeof r.place === 'string' ? parseInt(r.place) || 8 : r.place || 8;
          return s + place;
        }, 0) / recentResults.length
      : 8;
    const competitiveScore = Math.round(Math.max(0, Math.min(100, (1 - (avgPlace - 1) / 16) * 100)));
    const competitiveDetail = recentResults.length > 0
      ? `Ø Platzierung: ${avgPlace.toFixed(1)} (letzte ${recentResults.length} Turniere)`
      : 'Keine Turnierdaten verfügbar';

    // 5. Regional Strength
    // Get region from team data or guess from player countries
    const region = detectRegion(roster, teamName);
    const regionalScore = REGION_STRENGTH[region] || 50;
    const regionalDetail = `Region: ${region} (Stärke: ${regionalScore}/100)`;

    // Overall Score (weighted)
    const overallScore = Math.round(
      titleRateScore * 0.25 +
      experienceScore * 0.2 +
      competitiveScore * 0.35 +
      regionalScore * 0.2
    );

    // Generate insights
    const insights: string[] = [];
    if (titleRatePct >= 15) insights.push(`Hohe Titelquote — gewinnt ${titleRatePct.toFixed(0)}% der Turniere.`);
    if (goldTrophies === 0 && totalEvents > 5) insights.push('Noch kein Turniersieg trotz vieler Teilnahmen.');
    if (competitiveScore >= 70) insights.push('Starke Performance in letzten Turnieren.');
    if (competitiveScore < 40) insights.push('Schwache Turnierergebnisse — Umstrukturierung könnte nötig sein.');
    if (experienceScore >= 70) insights.push('Erfahrenes Team mit vielen Turnierteilnahmen.');
    if (totalEvents === 0) insights.push('Keine Turnierdaten vorhanden — neues Team oder fehlende Daten.');
    if (regionalScore >= 85) insights.push(`Spielt in einer der stärksten Regionen (${region}).`);

    const grade = overallScore >= 85 ? 'S' : overallScore >= 70 ? 'A' : overallScore >= 55 ? 'B' : overallScore >= 40 ? 'C' : 'D';

    const result: SynergyResult = {
      teamName: teamName || 'Unknown',
      overallScore,
      grade,
      breakdown: {
        titleRate: { score: titleRateScore, detail: titleRateDetail },
        experienceScore: { score: experienceScore, detail: experienceDetail },
        competitiveRecord: { score: competitiveScore, detail: competitiveDetail },
        regionalStrength: { score: regionalScore, detail: regionalDetail },
      },
      insights,
    };

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Analyse fehlgeschlagen' }, { status: 500 });
  }
}

function detectRegion(roster: any[], teamName: string): string {
  // Try to detect region from player countries or team name patterns
  const countries = roster.map((p: any) => p.country).filter(Boolean);
  const koreanCount = countries.filter((c: string) => c.includes('Korea')).length;
  const chinaCount = countries.filter((c: string) => c.includes('China')).length;
  const euCount = countries.filter((c: string) =>
    ['Germany', 'France', 'Spain', 'Sweden', 'Denmark', 'Poland', 'Czech', 'Romania', 'United Kingdom'].some(e => c.includes(e))
  ).length;
  const naCount = countries.filter((c: string) =>
    c.includes('United States') || c.includes('Canada')
  ).length;

  if (koreanCount >= 3) return 'Korea';
  if (chinaCount >= 3) return 'China';
  if (euCount >= 3) return 'Europe';
  if (naCount >= 3) return 'North America';

  // Fallback: check team data for region field
  return 'Europe'; // Default
}
