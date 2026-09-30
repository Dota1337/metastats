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

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// So weit reicht der Blick zurueck, um einen Vergleichswert vor der Woche zu
// finden. Die Bewertungslaeufe kommen nicht taeglich (z. B. 19.09. -> 30.09.).
export const WEEKLY_LOOKBACK_MS = 21 * 24 * 60 * 60 * 1000;

/**
 * Wochenveraenderung je Spieler: neuester Wert gegen den neuesten Wert
 * derselben Split-Gruppe am oder vor Wochenbeginn, ersatzweise gegen den
 * aeltesten Wert innerhalb der Woche.
 *
 * Ohne Vergleichswert fehlt der Spieler in der Map (nicht 0): ein einzelner
 * Bewertungslauf in der Woche ist keine Veraenderung. Spieler, deren neueste
 * Zeile nicht in der Woche liegt oder aus einer geschaetzten Gruppe stammt
 * (Mischrechnung ueber Splits), zaehlen ebenfalls nicht.
 */
export function weeklyReferenceByPlayer(rows: MvHistoryRow[], now: number): Map<string, number> {
  const weekStart = now - WEEK_MS;
  const out = new Map<string, number>();
  for (const [pid, group] of latestSplitRowsByPlayer(rows)) {
    const latest = group[0];
    if (latest.split_estimated || Date.parse(latest.recorded_at) < weekStart) continue;
    const before = group.find(r => Date.parse(r.recorded_at) <= weekStart);
    const ref = before ?? (group.length > 1 ? group[group.length - 1] : undefined);
    if (ref) out.set(pid, ref.market_value);
  }
  return out;
}
