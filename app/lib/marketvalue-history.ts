// Vergleiche im LoL-Marktwert-Verlauf (market_value_history) nur innerhalb
// eines Splits. Seit 0080 rechnet /api/summoner nur aus Partien des Splits;
// ein Wert aus Split 3 neben einem aus Split 2 waere ein Sprung durch den
// Split-Wechsel, keine Veraenderung des Spielers.
//
// Altzeilen (split_estimated) sind aus gemischten Splits gerechnet. Sie bilden
// eine eigene Gruppe, damit der erste echte Split-Wert nicht gegen eine
// Mischrechnung als "Explosion" oder "Einbruch" erscheint.

export interface MvHistoryRow {
  player_id: string;
  market_value: number;
  recorded_at: string;
  split_id: string | null;
  split_estimated: boolean | null;
}

export const MV_HISTORY_COLUMNS = 'player_id, market_value, recorded_at, split_id, split_estimated';

function groupKey(r: MvHistoryRow): string {
  return `${r.split_id ?? ''}|${r.split_estimated ? 'est' : ''}`;
}

/**
 * Je Spieler die Zeilen aus derselben Gruppe wie seine neueste Zeile,
 * neueste zuerst. Die Reihenfolge der Eingabe ist egal.
 */
export function latestSplitRowsByPlayer(rows: MvHistoryRow[]): Map<string, MvHistoryRow[]> {
  const sorted = [...rows].sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at));
  const out = new Map<string, MvHistoryRow[]>();
  const keyOf = new Map<string, string>();
  for (const r of sorted) {
    if (!r.player_id) continue;
    const k = groupKey(r);
    const first = keyOf.get(r.player_id);
    if (first === undefined) {
      keyOf.set(r.player_id, k);
      out.set(r.player_id, [r]);
    } else if (first === k) {
      out.get(r.player_id)!.push(r);
    }
  }
  return out;
}
