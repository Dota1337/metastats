// Region-Meta-Pattern Klassifikator. Wandelt die rohen Δ-Zahlen aus
// /api/tft/regions/divergence in eine narrative Klassifikation:
//
//   kr-secret  — KR spielt sie deutlich häufiger als der Westen
//   west-trend — Der Westen entdeckt sie früher / mehr
//   mastery    — Gleiche Pickrate aber KR-Avg-Place signifikant besser
//   niche      — Geringe Pickrate überall (Long-Tail)
//   etabliert  — Default-Fallback (Pickrate + Avg vergleichbar)
//
// Schwellwerte sind data-skeptic-kalibriert (2026-06-18) gegen die echten
// Set-17/master+/7d-Daten. Bei Set 18 erneut prüfen — Comp-Pool wechselt
// komplett, die Ratios bleiben aber strukturell ähnlich.
//
// Single-Source-of-Truth Client-side — kein API-Touch, kein RPC-Drift-Risiko.
// Konstanten sind exportiert für Memory-Doc + spätere Threshold-Justage.

export type RegionPattern = 'kr-secret' | 'west-trend' | 'mastery' | 'niche' | 'etabliert';

export const REGION_PATTERN_THRESHOLDS = {
  // Sample-Size-Sanity: unter dieser Game-Zahl pro Region kippt die Pickrate
  // bei jedem zusätzlichen Spiel zu stark — Klassifikation wird Noise.
  minGamesPerRegion: 30,
  // Stärkere Schwelle für Geheimtipp/West-Trend (Kr-spezifische Comps brauchen
  // mehr Sample-Backing, sonst klassifiziert man Long-Tail-Noise).
  minGamesKrForSecret: 100,

  // KR-Geheimtipp + West-Trend: Pickrate-Quotient ≥ 1.3× UND absolutes Floor
  // (sonst rendert 0.21% vs 0.1% als „Geheimtipp" — beides Noise).
  pickrateRatio: 1.3,
  pickrateAbsoluteFloor: 0.008,  // 0.8 %

  // Mastery: ähnliche Pickrate, aber KR spielt's klar besser. Avg-Δ 0.25 ist
  // TFT-Standard für „signifikant" (0.4 wäre zu streng, 0.15 zu lasch).
  masteryPickrateRelDiff: 0.4,
  masteryAvgPlaceDelta: 0.25,

  // Niche: alle Regionen-Pickrates unter dieser Schwelle = Long-Tail.
  nichePickrateMax: 0.003,  // 0.3 %
} as const;

export interface RegionRowMin {
  games_kr: number;
  games_eu: number;
  games_na: number;
  avg_place_kr: number | null;
  avg_place_eu: number | null;
  avg_place_na: number | null;
  pickrate_kr: number | null;
  pickrate_eu: number | null;
  pickrate_na: number | null;
}

// Westen-Aggregat = ungewichteter Mittelwert von EU + NA (gleiche Behandlung).
// Wenn eine Region 0 Games hat, fällt sie aus dem Mittel — verhindert Bias bei
// Patches wo NA noch nicht eingelaufen ist.
function westStats(row: RegionRowMin): { pickrate: number | null; avgPlace: number | null; games: number } {
  const pickrates: number[] = [];
  const avgs: number[] = [];
  let games = 0;
  if (row.games_eu >= REGION_PATTERN_THRESHOLDS.minGamesPerRegion && row.pickrate_eu != null) {
    pickrates.push(row.pickrate_eu);
    if (row.avg_place_eu != null) avgs.push(row.avg_place_eu);
    games += row.games_eu;
  }
  if (row.games_na >= REGION_PATTERN_THRESHOLDS.minGamesPerRegion && row.pickrate_na != null) {
    pickrates.push(row.pickrate_na);
    if (row.avg_place_na != null) avgs.push(row.avg_place_na);
    games += row.games_na;
  }
  if (pickrates.length === 0) return { pickrate: null, avgPlace: null, games };
  return {
    pickrate: pickrates.reduce((a, b) => a + b, 0) / pickrates.length,
    avgPlace: avgs.length > 0 ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null,
    games,
  };
}

export function classifyRegionPattern(row: RegionRowMin): RegionPattern {
  const T = REGION_PATTERN_THRESHOLDS;
  const west = westStats(row);
  const pr_kr = row.pickrate_kr ?? 0;
  const pr_west = west.pickrate ?? 0;

  // 1) Niche — alle Regionen sehr selten gespielt.
  const maxPr = Math.max(pr_kr, row.pickrate_eu ?? 0, row.pickrate_na ?? 0);
  if (maxPr < T.nichePickrateMax) return 'niche';

  const krValid = row.games_kr >= T.minGamesPerRegion;
  const westValid = west.pickrate != null;

  // 2) KR-Geheimtipp
  if (
    krValid && westValid
    && row.games_kr >= T.minGamesKrForSecret
    && pr_kr >= T.pickrateAbsoluteFloor
    && pr_west > 0
    && pr_kr / pr_west >= T.pickrateRatio
  ) {
    return 'kr-secret';
  }

  // 3) West-Trend
  if (
    krValid && westValid
    && pr_west >= T.pickrateAbsoluteFloor
    && pr_kr > 0
    && pr_west / pr_kr >= T.pickrateRatio
  ) {
    return 'west-trend';
  }

  // 4) KR-Mastery — Pickrate ähnlich, aber KR Avg-Place klar besser.
  if (
    krValid && westValid
    && pr_west > 0
    && Math.abs(pr_kr - pr_west) / pr_west <= T.masteryPickrateRelDiff
    && row.avg_place_kr != null && west.avgPlace != null
    && (west.avgPlace - row.avg_place_kr) >= T.masteryAvgPlaceDelta
  ) {
    return 'mastery';
  }

  // 5) Etabliert — Default-Fallback (Pickrate + Avg vergleichbar).
  return 'etabliert';
}

// Sort-Score für die Default-Liste. Höhere Werte zuerst.
// Geheimtipps an die Spitze, dann West-Trends, dann Mastery, dann etablierte
// Comps nach KR-Volumen, Niche zum Schluss.
export function regionPatternSortScore(pattern: RegionPattern, row: RegionRowMin): number {
  const baseGames = row.games_kr + row.games_eu + row.games_na;
  switch (pattern) {
    case 'kr-secret':  return 4_000_000 + baseGames;
    case 'west-trend': return 3_000_000 + baseGames;
    case 'mastery':    return 2_000_000 + baseGames;
    case 'etabliert':  return 1_000_000 + baseGames;
    case 'niche':      return baseGames;
  }
}

// Narrative Δ-Zeile pro Row. i18n-Templates haben {factor}, {avgDiff},
// {prKr}, {prWest} Placeholder. Fallback wenn Daten fehlen: leerer String.
export function buildRegionNarrative(
  row: RegionRowMin,
  pattern: RegionPattern,
  t: (key: any) => string,
): string {
  const west = westStats(row);
  const pr_kr = row.pickrate_kr ?? 0;
  const pr_west = west.pickrate ?? 0;
  const avg_kr = row.avg_place_kr;
  const avg_west = west.avgPlace;

  const fmtFactor = (n: number) => n.toFixed(1) + '×';
  const fmtAvg = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2);

  if (pattern === 'kr-secret' && pr_west > 0) {
    return (t('tft.regions.narrative.krSecret') as string)
      .replace('{factor}', fmtFactor(pr_kr / pr_west))
      .replace('{avgDiff}',
        avg_kr != null && avg_west != null ? fmtAvg(avg_kr - avg_west) : '—');
  }
  if (pattern === 'west-trend' && pr_kr > 0) {
    return (t('tft.regions.narrative.westTrend') as string)
      .replace('{factor}', fmtFactor(pr_west / pr_kr))
      .replace('{avgDiff}',
        avg_kr != null && avg_west != null ? fmtAvg(avg_kr - avg_west) : '—');
  }
  if (pattern === 'mastery' && avg_kr != null && avg_west != null) {
    return (t('tft.regions.narrative.mastery') as string)
      .replace('{krAvg}', avg_kr.toFixed(2))
      .replace('{westAvg}', avg_west.toFixed(2));
  }
  if (pattern === 'niche') {
    return t('tft.regions.narrative.niche') as string;
  }
  return t('tft.regions.narrative.etabliert') as string;
}
