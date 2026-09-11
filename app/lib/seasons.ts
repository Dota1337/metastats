// Saison- und Split-Zuordnung aus public/seasons.json.
//
// Die Saison kommt aus dem Patch des Spiels, nicht aus einem Datum: major 16 =
// s2026 (siehe supabase/migrations/0067_lol_player_match_cache.sql, PATCH STATT
// DATUM). Splits grenzen sich ueber den Minor ihres startPatch ab — Split 2 der
// Saison 2026 beginnt mit 16.9.1 und laeuft bis vor 16.15.1.
//
// public/seasons.json wird woechentlich automatisch gepflegt
// (reference_season_detection). Diese Datei rechnet nur daraus, sie haelt keine
// eigene Liste.
import seasonsData from '../../public/seasons.json';

interface SplitEntry { id: string; label: string; startPatch: string }
interface SeasonEntry { id: string; label: string; major: number; startPatch: string; splits?: SplitEntry[] }
interface SeasonsFile { currentSeason: SeasonEntry; history: SeasonEntry[] }

const data = seasonsData as unknown as SeasonsFile;

export interface SeasonPeriod {
  id: string;
  label: string;
  kind: 'season' | 'split';
  major: number;
  /** Erster Minor, der dazugehoert; null = ganze Saison. */
  minMinor: number | null;
  /** Erster Minor, der NICHT mehr dazugehoert; null = bis Saisonende. */
  endMinor: number | null;
}

function minorOf(patch: string): number {
  return Number(patch.split('.')[1]);
}

/** Alle Saisons, neueste zuerst. */
function seasons(): SeasonEntry[] {
  return [data.currentSeason, ...data.history];
}

/** Saison und ihre Splits als Zeitraeume, neueste Saison zuerst, je Saison erst das Ganze, dann die Splits. */
export function allPeriods(): SeasonPeriod[] {
  const out: SeasonPeriod[] = [];
  for (const s of seasons()) {
    out.push({ id: s.id, label: s.label, kind: 'season', major: s.major, minMinor: null, endMinor: null });
    const splits = s.splits || [];
    splits.forEach((sp, i) => {
      const next = splits[i + 1];
      out.push({
        id: sp.id,
        label: sp.label,
        kind: 'split',
        major: s.major,
        minMinor: minorOf(sp.startPatch),
        endMinor: next ? minorOf(next.startPatch) : null,
      });
    });
  }
  return out;
}

export function findPeriod(id: string): SeasonPeriod | null {
  return allPeriods().find(p => p.id === id) || null;
}

/** Gehoert ein Spiel mit diesem Patch in den Zeitraum? */
export function inPeriod(p: SeasonPeriod, major: number, minor: number): boolean {
  if (major !== p.major) return false;
  if (p.minMinor !== null && minor < p.minMinor) return false;
  if (p.endMinor !== null && minor >= p.endMinor) return false;
  return true;
}

export const CURRENT_SEASON_ID = data.currentSeason.id;
