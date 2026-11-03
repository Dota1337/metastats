// Patch-Verlauf der Unit-Seite (/api/tft/unit-history): je Patch ein Punkt aus
// den Rohzeilen, die auch der Δ-Vergleich der Listen nutzt.
import { DETAIL_MIN_GAMES, type PatchDiffRow } from './snapshot-matrix';

export const UNIT_HISTORY_MAX_PATCHES = 5;

// Die Box rechnet nur Patches der 30-Tage-Liste nach, die Karte zeigt aber die
// letzten fuenf. Ein abgeschlossener Patch aendert sich nicht mehr, seine Datei
// darf deshalb laenger gelten, sonst fiele der aelteste Punkt nach 14 Tagen weg.
export const UNIT_HISTORY_CLOSED_MAX_AGE_MS = 120 * 24 * 60 * 60 * 1000;

export interface UnitHistoryPoint {
  patch: string;
  firstDay: string;
  lastDay: string;
  games: number;
  avgPlacement: number;
  top4Rate: number;
  pickRate: number | null;
}

/**
 * @param rowsByPatch gleiche Reihenfolge wie `patches`; null = dieser Patch war nicht lesbar.
 * @returns Punkte (aelteste links) und ob ein Patch fehlt: dann darf die Antwort
 * nicht lange im Cache bleiben. Zu wenige Spiele sind kein Fehlen, die Unit war
 * in dem Patch nur selten.
 */
export function buildUnitTimeline(
  characterId: string,
  patches: ReadonlyArray<{ patch: string; first_day: string; last_day: string }>,
  rowsByPatch: ReadonlyArray<ReadonlyArray<PatchDiffRow> | null>,
): { timeline: UnitHistoryPoint[]; missing: boolean } {
  const timeline: UnitHistoryPoint[] = [];
  let missing = false;
  patches.forEach((p, i) => {
    const rows = rowsByPatch[i];
    if (!rows) { missing = true; return; }
    const row = rows.find(r => r.key === characterId);
    if (!row || row.games < DETAIL_MIN_GAMES) return;
    timeline.push({
      patch: p.patch,
      firstDay: p.first_day,
      lastDay: p.last_day,
      games: row.games,
      avgPlacement: row.sum_placement / row.games,
      top4Rate: row.top4 / row.games,
      pickRate: row.participants > 0 ? row.games / row.participants : null,
    });
  });
  // Nach letztem Tag, nicht nach Patch-Name: Riots Kennungen sortieren nicht
  // zeitlich („17.2" liegt vor „16.10"), der erste Tag kann sich ueberschneiden.
  timeline.sort((a, b) => (a.lastDay < b.lastDay ? -1 : a.lastDay > b.lastDay ? 1 : 0));
  return { timeline, missing };
}
