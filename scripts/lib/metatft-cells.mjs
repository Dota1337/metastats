// Feld-Zahlen je Unit fuer den Comp-Builder (Haeufigkeit + Top 4 je Brettfeld),
// aus MetaTFTs `tft-stat-api/positions`. Reine Funktion, damit die Gatter ohne
// Netz testbar sind; den Abruf macht scripts/refresh-metatft-cells.mjs.
//
// Was die Quelle ist (gemessen 2026-10-26):
//   - Zeilen `{unit, position: "cell_1".."cell_28", win_rate, count}`, `updated` in ms.
//   - `win_rate` ist eine Quote: bei 322/322 Zeilen mit 2-40 Beobachtungen ist
//     `win_rate × count` ganzzahlig, der gewichtete Schnitt liegt bei 0,52 →
//     Top-4-Quote (eine Siegquote laege bei ~0,12). MetaTFT beschriftet sie "Win".
//   - Mitlaufendes Zeitfenster ueber alle Runden und Modi, nicht nur Endbretter;
//     billige Units zeigen deshalb vor allem die fruehe Aufstellung.
//   - Enthaelt Units anderer Sets (66 × TFT17_*, 0,1 % der Beobachtungen) und
//     Formvarianten, die nicht im Bundle stehen (DA_18_Akali_AP, ≤0,1 % der Unit).
//     Uebernommen wird nur, was exakt in tft-assets-{set}.json#champions steht.
//   - Feldnummer: cell_N → Index N-1 = row*7+col, Reihe 0 hinten, wie
//     comp_details (refresh-metatft-comps.mjs) und BuilderClient.

export const BOARD_CELLS = 28;
// Top 4 erst ab so vielen Beobachtungen auf dem Feld, darunter "–" (User-Entscheid
// 2026-10-26). Beobachtungen sind keine Spiele: ein Spiel kann ein Feld ueber
// mehrere Runden fuellen.
export const TOP4_MIN_OBS = 500;
// Gatter: bei Verstoss bleibt die alte Datei liegen.
export const MAX_INVALID_SHARE = 0.05;
export const MIN_SET_SHARE = 0.95;
export const MIN_UNITS = 60;
export const MAX_DROP = 0.3;
export const MAX_SOURCE_AGE_DAYS = 3;

const CELL_RE = /^cell_(\d+)$/;

/**
 * @param {unknown} raw  Antwort von tft-stat-api/positions
 * @param {{ champions: Record<string, unknown>, previousTotal?: number, now?: number }} opts
 * @returns {{ units: Array<{ id: string, n: number, cells: Array<[number, number, number | null]> }>,
 *             total: number, sourceUpdated: string, stats: Record<string, number> }}
 *   `cells`: [Feld 0-basiert, Haeufigkeit in Promille, Top 4 in Promille oder null]
 */
export function buildCells(raw, { champions, previousTotal = 0, now = Date.now() }) {
  const rows = raw && typeof raw === 'object' ? raw.positions : null;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Antwort ohne positions-Liste');

  const updated = Number(raw.updated);
  if (!Number.isFinite(updated) || updated <= 0) throw new Error('Antwort ohne updated-Stempel');
  const ageDays = (now - updated) / 86_400_000;
  if (ageDays > MAX_SOURCE_AGE_DAYS) {
    throw new Error(`Quelle ${ageDays.toFixed(1)} Tage alt (max ${MAX_SOURCE_AGE_DAYS})`);
  }

  // unit → Feld → { count, wins } (wins = Top-4-Beobachtungen, damit doppelte
  // Zeilen gewichtet zusammenlaufen statt sich zu ueberschreiben)
  const byUnit = new Map();
  let invalid = 0;
  let validObs = 0;
  let setObs = 0;
  for (const r of rows) {
    const m = CELL_RE.exec(String(r?.position ?? ''));
    const cell = m ? Number(m[1]) - 1 : -1;
    const count = Number(r?.count);
    const rate = Number(r?.win_rate);
    if (typeof r?.unit !== 'string' || !r.unit || cell < 0 || cell >= BOARD_CELLS
      || !Number.isInteger(count) || count <= 0 || !Number.isFinite(rate) || rate < 0 || rate > 1) {
      invalid++;
      continue;
    }
    validObs += count;
    if (!Object.hasOwn(champions, r.unit)) continue;
    setObs += count;
    let cells = byUnit.get(r.unit);
    if (!cells) byUnit.set(r.unit, (cells = new Map()));
    const c = cells.get(cell) || { count: 0, wins: 0 };
    c.count += count;
    c.wins += rate * count;
    cells.set(cell, c);
  }

  if (invalid / rows.length > MAX_INVALID_SHARE) {
    throw new Error(`${invalid} von ${rows.length} Zeilen ungueltig (max ${MAX_INVALID_SHARE * 100} %)`);
  }
  const setShare = validObs ? setObs / validObs : 0;
  if (setShare < MIN_SET_SHARE) {
    throw new Error(`nur ${(setShare * 100).toFixed(1)} % der Beobachtungen auf Units des Sets (min ${MIN_SET_SHARE * 100} %)`);
  }
  if (byUnit.size < MIN_UNITS) throw new Error(`nur ${byUnit.size} Units mit Daten (min ${MIN_UNITS})`);
  if (previousTotal > 0 && setObs < previousTotal * (1 - MAX_DROP)) {
    throw new Error(`${setObs} Beobachtungen gegenueber ${previousTotal} zuvor (Rueckgang > ${MAX_DROP * 100} %)`);
  }

  const units = [...byUnit.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, cells]) => {
      const n = [...cells.values()].reduce((s, c) => s + c.count, 0);
      return {
        id,
        n,
        cells: [...cells.entries()]
          .sort(([a], [b]) => a - b)
          .map(([cell, c]) => [
            cell,
            Math.round((c.count / n) * 1000),
            c.count >= TOP4_MIN_OBS ? Math.round((c.wins / c.count) * 1000) : null,
          ]),
      };
    });

  return {
    units,
    total: setObs,
    sourceUpdated: new Date(updated).toISOString(),
    stats: { rows: rows.length, invalid, units: units.length, setSharePermille: Math.round(setShare * 1000) },
  };
}
