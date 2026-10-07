// Gemeinsame Regeln fuer gespeicherte Set-Raenge (tft_player_rank_history),
// von Spielerseite und Vergleich genutzt. Bewusst ohne Server-Importe, damit
// Client-Komponenten sie ziehen koennen.

const TIER_ORDER = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIV_ORDER: Record<string, number> = { IV: 0, III: 1, II: 2, I: 3 };
const APEX = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

/** Vergleichswert eines Rangs; -1 fuer unbekannt/Unranked. */
export function rankKey(tier: string | null | undefined, div: string | null | undefined, lp: number | null | undefined): number {
  const i = TIER_ORDER.indexOf((tier || '').toUpperCase());
  if (i < 0) return -1;
  return i * 10000 + (DIV_ORDER[(div || '').toUpperCase()] ?? 0) * 1000 + (lp ?? 0);
}

export interface SetRankRowLike {
  set_number: number;
  set_label: string | null;
  peak_tier: string | null;
  peak_division?: string | null;
  peak_lp: number | null;
  end_tier?: string | null;
  end_division?: string | null;
  end_lp?: number | null;
}

export interface SetRankDisplay { tier: string; div: string | null; lp: number | null }

/**
 * Was pro Set angezeigt wird (User 2026-09-28): der Rang am Set-Ende plus die
 * hoechsten LP des Sets. LP nur, wenn der Endrang Master oder hoeher ist —
 * darunter zaehlen LP nur innerhalb einer Stufe, dort nur "Diamond II".
 * Hoechste LP = max(Hoechstrang-LP, End-LP), aber nur aus Master+-Werten.
 * Ohne Endrang: null (nie den Hoechstrang als Endrang ausgeben).
 */
export function setRankDisplay(row: SetRankRowLike): SetRankDisplay | null {
  const tier = (row.end_tier || '').toUpperCase();
  if (rankKey(tier, null, null) < 0) return null;
  if (!APEX.has(tier)) return { tier, div: row.end_division ?? null, lp: null };
  const peakApex = APEX.has((row.peak_tier || '').toUpperCase());
  const lps = [peakApex ? row.peak_lp : null, row.end_lp].filter((v): v is number => v != null);
  // Ohne Hoechstwert (dakgg, Set 8.5/9) ist End-LP nicht "die hoechste" — weglassen.
  return { tier, div: null, lp: peakApex && lps.length ? Math.max(...lps) : null };
}

/**
 * Laufendes Set: der Live-Rang ist der aktuelle "Endrang". Hoechste LP =
 * max(gespeicherter Hoechstwert, Live-LP), wenn der Live-Rang Master+ ist.
 */
export function withLiveRank<T extends SetRankRowLike>(
  row: T | undefined, setNumber: number, live: { tier: string | null; rank: string | null; lp: number | null },
): SetRankRowLike | T | undefined {
  if (!live.tier || rankKey(live.tier, null, null) < 0) return row;
  const tier = live.tier.toUpperCase();
  const apex = APEX.has(tier);
  const peakApex = APEX.has((row?.peak_tier || '').toUpperCase());
  const peakLp = apex ? Math.max(live.lp ?? 0, peakApex ? row?.peak_lp ?? 0 : 0) : null;
  return {
    ...(row ?? { set_number: setNumber, set_label: `TFTSet${setNumber}` }),
    peak_tier: apex ? tier : row?.peak_tier ?? null,
    peak_lp: peakLp,
    end_tier: tier,
    end_division: apex ? null : live.rank,
    end_lp: live.lp,
  };
}

/**
 * Spalte "Max LP pro Set" (User 2026-10-07): die hoechsten LP des Sets mit der
 * Stufe, in der sie erreicht wurden. Kandidaten sind Hoechststand, Ende und
 * beim laufenden Set der Live-Rang, jeweils nur Master+ mit LP. Die Stufe kommt
 * vom gewinnenden Wert — Set 14: Hoechststand Challenger 552, Ende GM 718 →
 * "GM 718", nie "Challenger 718". Ohne Master+-Hoechststand zaehlt das Ende
 * nicht (dakgg kennt keinen Hoechstwert, s. setRankDisplay); live schon.
 */
export function setMaxLp(
  row: SetRankRowLike, live?: { tier: string | null; lp: number | null },
): { tier: string; lp: number } | null {
  let best: { tier: string; lp: number } | null = null;
  const consider = (tier: string | null | undefined, lp: number | null | undefined) => {
    const t = (tier || '').toUpperCase();
    if (APEX.has(t) && lp != null && (!best || lp > best.lp)) best = { tier: t, lp };
  };
  consider(row.peak_tier, row.peak_lp);
  if (best) consider(row.end_tier, row.end_lp);
  if (live) consider(live.tier, live.lp);
  return best;
}

/** Spalte "Rang am Set-Ende": nur end_*, nie aus dem Hoechststand. */
export function setEndRank(row: SetRankRowLike): SetRankDisplay | null {
  const tier = (row.end_tier || '').toUpperCase();
  if (rankKey(tier, null, null) < 0) return null;
  if (!APEX.has(tier)) return { tier, div: row.end_division ?? null, lp: null };
  return { tier, div: null, lp: row.end_lp ?? null };
}

/**
 * Eine Zeile je Set-Nummer (Vergleichstabelle): das spaetere Halbset gewinnt
 * ("TFTSet9_2" vor "TFTSet9"), denn sein Ende ist das Ende des Sets.
 */
export function lastRowPerSet<T extends SetRankRowLike>(rows: T[]): Map<number, T> {
  const out = new Map<number, T>();
  for (const r of rows) {
    if (!setRankDisplay(r)) continue;
    const cur = out.get(r.set_number);
    if (!cur || (r.set_label || '').localeCompare(cur.set_label || '') > 0) out.set(r.set_number, r);
  }
  return out;
}
