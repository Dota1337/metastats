// Team-Bewertung fuer /teams/[id] (Titelquote, Erfahrung, Form, Region).
// Rechnet rein aus den Teamdaten in public/pro-teams/*.json; Texte uebersetzt
// die Anzeige (TeamSynergy.tsx).
//
// Ehrlichkeitsregeln: ein Teil ohne Daten faellt raus und die Gewichte werden
// auf die vorhandenen Teile umgelegt — kein geschaetzter Ersatzwert. Ohne ein
// einziges gewertetes Ergebnis gibt es keine Bewertung.

export type RegionCode = 'KR' | 'CN' | 'EU' | 'NA' | 'APAC' | 'BR' | 'JP' | 'TR' | 'CIS' | 'OCE' | 'LATAM';

// Staerke nach internationalem Abschneiden (Werte unveraendert aus der alten
// /api/team-synergy-Route uebernommen).
export const REGION_STRENGTH: Record<RegionCode, number> = {
  KR: 95, CN: 92, EU: 78, NA: 70, APAC: 60, BR: 50, JP: 48, TR: 45, CIS: 42, OCE: 38, LATAM: 35,
};

// team.region in pro-teams.json (gemessen: Korea, China, Europe, North America).
const TEAM_REGION: Record<string, RegionCode> = {
  Korea: 'KR', China: 'CN', Europe: 'EU', 'North America': 'NA',
};

// Spielerland → Liga-Region. Laender ohne passende Region in REGION_STRENGTH
// (z. B. arabische Liga, Indien, Mongolei) fehlen bewusst.
const COUNTRY_REGION: Record<string, RegionCode> = {
  'South Korea': 'KR',
  China: 'CN',
  'United States': 'NA', Canada: 'NA',
  Brazil: 'BR',
  Turkey: 'TR',
  Japan: 'JP',
  Australia: 'OCE',
  Russia: 'CIS', Ukraine: 'CIS', Kazakhstan: 'CIS', Moldova: 'CIS',
  Taiwan: 'APAC', 'Hong Kong': 'APAC', Vietnam: 'APAC', Philippines: 'APAC', Thailand: 'APAC',
  Singapore: 'APAC', Malaysia: 'APAC', Indonesia: 'APAC', Cambodia: 'APAC',
  ...Object.fromEntries([
    'Argentina', 'Bolivia', 'Chile', 'Colombia', 'Costa Rica', 'Cuba', 'Dominican Republic', 'Ecuador',
    'El Salvador', 'Guatemala', 'Honduras', 'Mexico', 'Peru', 'Puerto Rico', 'Uruguay', 'Venezuela',
    'Trinidad and Tobago',
  ].map(c => [c, 'LATAM' as RegionCode])),
  ...Object.fromEntries([
    'Albania', 'Andorra', 'Austria', 'Belgium', 'Bosnia and Herzegovina', 'Bulgaria', 'Croatia',
    'Czech Republic', 'Denmark', 'Estonia', 'Faroe Islands', 'Finland', 'France', 'Germany', 'Greece',
    'Hungary', 'Iceland', 'Italy', 'Latvia', 'Lithuania', 'Malta', 'Montenegro', 'Netherlands',
    'North Macedonia', 'Norway', 'Poland', 'Portugal', 'Republic of Ireland', 'Romania', 'Serbia',
    'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'Switzerland', 'United Kingdom',
  ].map(c => [c, 'EU' as RegionCode])),
};

const WEIGHTS = { titleRate: 0.25, experience: 0.2, recentForm: 0.35, region: 0.2 } as const;

export type SynergyPart = keyof typeof WEIGHTS;

export type SynergyInsight =
  | { code: 'highTitleRate'; pct: number }
  | { code: 'noTitleYet' }
  | { code: 'strongRecent' }
  | { code: 'weakRecent' }
  | { code: 'experienced' }
  | { code: 'strongRegion'; region: RegionCode };

export interface TeamSynergyResult {
  overallScore: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  titleRate: { score: number; titles: number; events: number; pct: number };
  experience: { score: number; events: number; top4: number };
  recentForm: { score: number; avgPlace: number; count: number } | null;
  region: { score: number; code: RegionCode } | null;
  insights: SynergyInsight[];
}

interface RosterEntry { isPlayer?: boolean; status?: string; country?: string }
interface ResultEntry { place?: string | number; trophy?: string }

// Platz als Zahl; Bereiche ("5-8") mit Mittelwert. Q/NQ/DQ/DNS sind keine
// Platzierung → null.
export function parsePlace(place: unknown): number | null {
  if (typeof place === 'number') return Number.isFinite(place) && place > 0 ? place : null;
  if (typeof place !== 'string') return null;
  const range = place.match(/^(\d+)\s*-\s*(\d+)/);
  if (range) return (Number(range[1]) + Number(range[2])) / 2;
  return /^\d+$/.test(place.trim()) ? Number(place) : null;
}

export function detectRegion(teamRegion: string | undefined, roster: RosterEntry[]): RegionCode | null {
  const set = TEAM_REGION[(teamRegion || '').trim()];
  if (set) return set;
  const counts = new Map<RegionCode, number>();
  for (const p of roster) {
    if (!p.isPlayer || p.status !== 'main' || !p.country) continue;
    const r = COUNTRY_REGION[p.country];
    if (r) counts.set(r, (counts.get(r) || 0) + 1);
  }
  let best: RegionCode | null = null;
  let bestN = 2; // mindestens 3 Stammspieler
  for (const [r, n] of counts) if (n > bestN) { best = r; bestN = n; }
  return best;
}

export function computeTeamSynergy(
  { roster, results, region }: { roster: RosterEntry[]; results: ResultEntry[]; region?: string },
): TeamSynergyResult | null {
  // results ist neueste zuerst (gemessen: 475 von 475 Teams mit >=2 Daten).
  const rated = (results || [])
    .map(r => ({ place: parsePlace(r.place), gold: r.trophy === 'gold' }))
    .filter(r => r.place !== null || r.gold);
  if (!rated.length) return null;

  const events = rated.length;
  const titles = rated.filter(r => r.gold || r.place === 1).length;
  const pct = (titles / events) * 100;
  const titleScore = pct >= 25 ? 95 : pct >= 15 ? 75 : pct >= 8 ? 55 : pct >= 3 ? 35 : titles > 0 ? 20 : 5;

  const top4 = rated.filter(r => r.place !== null ? r.place <= 4 : r.gold).length;
  const experienceScore = Math.min(100, Math.round((Math.min(events, 30) / 30) * 50 + (top4 / events) * 50));

  const recent = rated.filter(r => r.place !== null).slice(0, 10);
  const avgPlace = recent.length ? recent.reduce((s, r) => s + (r.place as number), 0) / recent.length : 0;
  const recentForm = recent.length
    ? { score: Math.round(Math.max(0, Math.min(100, (1 - (avgPlace - 1) / 16) * 100))), avgPlace, count: recent.length }
    : null;

  const code = detectRegion(region, roster || []);
  const regionPart = code ? { score: REGION_STRENGTH[code], code } : null;

  const parts: [number, number][] = [
    [titleScore, WEIGHTS.titleRate],
    [experienceScore, WEIGHTS.experience],
  ];
  if (recentForm) parts.push([recentForm.score, WEIGHTS.recentForm]);
  if (regionPart) parts.push([regionPart.score, WEIGHTS.region]);
  const weightSum = parts.reduce((s, [, w]) => s + w, 0);
  const overallScore = Math.round(parts.reduce((s, [v, w]) => s + v * w, 0) / weightSum);
  const grade = overallScore >= 85 ? 'S' : overallScore >= 70 ? 'A' : overallScore >= 55 ? 'B' : overallScore >= 40 ? 'C' : 'D';

  const insights: SynergyInsight[] = [];
  if (pct >= 15) insights.push({ code: 'highTitleRate', pct });
  if (titles === 0 && events > 5) insights.push({ code: 'noTitleYet' });
  if (recentForm && recentForm.score >= 70) insights.push({ code: 'strongRecent' });
  if (recentForm && recentForm.score < 40) insights.push({ code: 'weakRecent' });
  if (experienceScore >= 70) insights.push({ code: 'experienced' });
  if (regionPart && regionPart.score >= 85) insights.push({ code: 'strongRegion', region: regionPart.code });

  return {
    overallScore,
    grade,
    titleRate: { score: titleScore, titles, events, pct },
    experience: { score: experienceScore, events, top4 },
    recentForm,
    region: regionPart,
    insights,
  };
}
