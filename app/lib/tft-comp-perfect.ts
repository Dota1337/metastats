// „Perfekt getroffen“ (Comp-Katalog Phase 3): Spiele, deren Brett die Comp
// genau trifft (isPerfect im Sammler, tft-comp-catalog.mjs). Die Zaehler
// kommen nur an Katalog-Tagen (Migration 0102, get_tft_comp_stats); an
// klassischen Tagen und fuer nicht bewertbare Comps sind sie null. Die
// Detail-API summiert sie je Comp und je Varianten-Knopf (sumPerfect), die
// Seite schaltet Kopfzahlen und Knoepfe um.

/** Zaehler einer Zeile; null = an keinem Tag bewertet, fehlt = alte DB-Fassung. */
export interface CompPerfectSums {
  perfect_games?: number | string | null;
  perfect_sum_placement?: number | string | null;
  perfect_top4?: number | string | null;
  perfect_top1?: number | string | null;
  perfect_base_games?: number | string | null;
}

/** base = Spiele der bewerteten Tage (Nenner des Anteils), games = davon perfekt. */
export interface CompPerfect {
  games: number;
  base: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
}

// Ab so vielen bewerteten Spielen zeigt die Seite den Anteil, ab so vielen
// perfekten Spielen Ø / Top 4 / Sieg (darunter „—“, auch je Knopf).
export const PERFECT_MIN_BASE = 100;
export const PERFECT_MIN_GAMES = 100;

/** Summe ueber Zeilen; null, wenn keine Zeile bewertete Spiele hat. */
export function sumPerfect(rows: readonly CompPerfectSums[]): CompPerfect | null {
  let games = 0, base = 0, sumPlacement = 0, top4 = 0, top1 = 0;
  for (const r of rows) {
    if (r.perfect_games == null) continue;
    games += Number(r.perfect_games) || 0;
    sumPlacement += Number(r.perfect_sum_placement) || 0;
    top4 += Number(r.perfect_top4) || 0;
    top1 += Number(r.perfect_top1) || 0;
    base += Number(r.perfect_base_games) || 0;
  }
  if (!(base > 0)) return null;
  return {
    games,
    base,
    avgPlacement: games > 0 ? sumPlacement / games : null,
    top4Rate: games > 0 ? top4 / games : null,
    top1Rate: games > 0 ? top1 / games : null,
  };
}

/** Anteil perfekter Spiele (0–1), null unter PERFECT_MIN_BASE. */
export function perfectShare(p: CompPerfect | null | undefined): number | null {
  return p && p.base >= PERFECT_MIN_BASE ? p.games / p.base : null;
}

/** Zahlen fuer Kopf und Knoepfe: Spiele immer, Werte erst ab PERFECT_MIN_GAMES. */
export function perfectStats(p: CompPerfect | null | undefined): {
  games: number; avgPlacement: number | null; top4Rate: number | null; top1Rate: number | null;
} {
  const enough = !!p && p.games >= PERFECT_MIN_GAMES;
  return {
    games: p?.games ?? 0,
    avgPlacement: enough ? p!.avgPlacement : null,
    top4Rate: enough ? p!.top4Rate : null,
    top1Rate: enough ? p!.top1Rate : null,
  };
}

// Schalter-Stand je Browser-Tab: der Varianten-Wechsel per router.push baut
// die Seite neu auf (page.tsx key=routeKey), der Stand soll bleiben.
const MODE_KEY = 'ms.tft.comp.perfect';

export function readPerfectMode(): boolean {
  try {
    return window.sessionStorage.getItem(MODE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writePerfectMode(on: boolean): void {
  try {
    if (on) window.sessionStorage.setItem(MODE_KEY, '1');
    else window.sessionStorage.removeItem(MODE_KEY);
  } catch {
    // Speicher gesperrt (privates Fenster): Schalter wirkt nur bis zum Neuaufbau.
  }
}
