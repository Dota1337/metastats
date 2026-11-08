// Champion-Zahlen aus den Sammel-Dateien (public/champion-stats-*.json) fuer
// einen Rang oder eine Rang-Gruppe auswaehlen.
//
// Die Tabelle champion_stats gibt es in der Datenbank nicht, deshalb liest
// /api/champions immer aus diesen Dateien. `stats` darin ist die Summe ueber
// alle gesammelten Raenge (Challenger, Grandmaster, Master) — fuer einen
// Rang-Filter taugt sie nur, wenn der Filter genau diese Raenge meint.
// Einzelraenge stehen in `statsByTier` (seit 2026-09-13). Fehlen sie, gibt es
// keine Zahlen statt der falschen.
//
// Fuer EUW kommen die Zahlen seit 08.11.2026 zuerst aus der Box-Datei
// (lol-champion-stats-blob.mjs, boxStatsForTiers) — gleiche Rueckgabe-Form,
// damit die Liste eine Formel behaelt.
//
// Keine Importe: der Test laedt die Datei direkt mit node.

export type ChampStat = { wins: number; games: number; kills: number; deaths: number; assists: number; bans: number };

/**
 * totalGames = Teilnehmer-Plaetze (Pickrate = Spiele * 10 / totalGames),
 * banMatches = Matches mit Ban-Daten (Bannrate = Bans / banMatches, null = zu wenig),
 * kdaOk = K/D/A-Summen sind belastbar.
 */
export interface TierStatsPick {
  stats: Record<string, ChampStat>;
  totalGames: number;
  banMatches: number | null;
  kdaOk: boolean;
}

export interface ChampionStatsFile {
  stats?: Record<string, ChampStat>;
  statsByTier?: Record<string, Record<string, ChampStat>>;
  perTier?: Record<string, { matches?: number }>;
  totalParticipantGames?: number;
}

const COLLECTED_TIERS = ['CHALLENGER', 'GRANDMASTER', 'MASTER'];

/**
 * tiers = null heisst „alle Raenge". Rueckgabe null = fuer diese Auswahl gibt
 * die Datei keine ehrlichen Zahlen her.
 */
export function statsForTiers(
  file: ChampionStatsFile | null | undefined,
  tiers: string[] | null,
): TierStatsPick | null {
  // Die Wochendatei zaehlt alle zehn Teilnehmer je Spiel: Ban-Nenner = Spiele.
  const pick = (stats: Record<string, ChampStat>, totalGames: number): TierStatsPick | null =>
    totalGames > 0 ? { stats, totalGames, banMatches: totalGames / 10, kdaOk: true } : null;
  if (!file?.stats) return null;
  if (tiers === null) return pick(file.stats, file.totalParticipantGames || 0);
  const wanted = [...new Set(tiers.map(t => t.toUpperCase()))];
  if (file.statsByTier && wanted.every(t => file.statsByTier![t])) {
    const stats: Record<string, ChampStat> = {};
    let totalGames = 0;
    for (const t of wanted) {
      totalGames += (file.perTier?.[t]?.matches || 0) * 10;
      for (const [key, s] of Object.entries(file.statsByTier[t])) {
        const acc = stats[key] ||= { wins: 0, games: 0, kills: 0, deaths: 0, assists: 0, bans: 0 };
        acc.wins += s.wins; acc.games += s.games; acc.kills += s.kills;
        acc.deaths += s.deaths; acc.assists += s.assists; acc.bans += s.bans;
      }
    }
    return pick(stats, totalGames);
  }
  // Ohne Einzelraenge: die Summe passt nur, wenn genau die gesammelten Raenge gemeint sind (Master+).
  const same = wanted.length === COLLECTED_TIERS.length && COLLECTED_TIERS.every(t => wanted.includes(t));
  return same ? statsForTiers(file, null) : null;
}
