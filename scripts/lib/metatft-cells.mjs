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
//   - Vor einem Set-Start auch das naechste Set (24.11.2026: 15,3 % auf
//     DA_Ahri19, DA_19_Ahri, DA_OceanSong19_Bongos …). Diese Units zaehlen im
//     Set-Gatter nicht mit (siehe idSetNumber), in die Ausgabe kamen sie nie.
//   - Feldnummer: cell_N → Index N-1 = row*7+col, Reihe 0 hinten, wie
//     comp_details (refresh-metatft-comps.mjs) und BuilderClient.

export const BOARD_CELLS = 28;
// Top 4 erst ab so vielen Beobachtungen auf dem Feld, darunter "–" (User-Entscheid
// 2026-10-26: erst 500, dann 2.000). Beobachtungen sind keine Spiele: ein Spiel
// kann ein Feld ueber mehrere Runden fuellen, 500 waeren oft nur ein paar
// Dutzend Spiele.
export const TOP4_MIN_OBS = 2000;
// Gatter: bei Verstoss bleibt die alte Datei liegen.
export const MAX_INVALID_SHARE = 0.05;
export const MIN_SET_SHARE = 0.95;
export const MIN_UNITS = 60;
export const MAX_DROP = 0.3;
export const MAX_SOURCE_AGE_DAYS = 3;

const CELL_RE = /^cell_(\d+)$/;

// Set-Nummer aus der Unit-Id (Riots Schreibweisen, gemessen an allen 292 Ids
// der Quelle und des Bundles am 24.11.2026). Die „3" in DA_3StarPyke_* ist
// eine Sternzahl und trifft keins der Muster.
const SET_NUMBER_RES = [
  /^TFT(\d+)_/, // TFT17_Aatrox, TFT18_MasterYi
  /^DA_(\d+)_/, // DA_18_Akali_AD, DA_19_Ahri
  /^DA_(?:[A-Za-z]+_)*[A-Za-z]+(\d+)(?:_|$)/, // DA_Ahri19, DA_OceanSong19_Bongos, DA_Akali_TrueDamage19
];

/** Set-Nummer der Unit-Id oder null (TFT_TrainingDummy, DA_3StarPyke_InfernalIdol). */
export function idSetNumber(id) {
  for (const re of SET_NUMBER_RES) {
    const m = re.exec(String(id));
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Units des NAECHSTEN Sets (Nummer = set + 1, ausserhalb des Bundles) zaehlen im
 * Set-Gatter nicht mit — Daten eines anderen Sets gehoeren nicht in dieses, und
 * sie liessen das Gatter vor jedem Set-Start scheitern (22.–24.11.2026).
 * Aeltere Sets und Ids ohne Nummer bleiben im Nenner, das Gatter wird damit eher
 * strenger. Was im Bundle steht, zaehlt immer zum eigenen Set.
 *
 * @param {unknown} raw  Antwort von tft-stat-api/positions
 * @param {{ champions: Record<string, unknown>, set: number, previousTotal?: number, now?: number }} opts
 * @returns {{ units: Array<{ id: string, n: number, cells: Array<[number, number, number | null]> }>,
 *             total: number, sourceUpdated: string, stats: Record<string, number> }}
 *   `cells`: [Feld 0-basiert, Haeufigkeit in Promille, Top 4 in Promille oder null]
 */
export function buildCells(raw, { champions, set, previousTotal = 0, now = Date.now() }) {
  if (!Number.isInteger(set) || set <= 0) throw new Error(`Set-Nummer fehlt oder ungueltig: ${set}`);
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
  let nextSetObs = 0;
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
    if (!Object.hasOwn(champions, r.unit)) {
      if (idSetNumber(r.unit) === set + 1) nextSetObs += count;
      continue;
    }
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
  const counted = validObs - nextSetObs;
  const setShare = counted > 0 ? setObs / counted : 0;
  const nextShare = validObs ? nextSetObs / validObs : 0;
  if (setShare < MIN_SET_SHARE) {
    throw new Error(`nur ${(setShare * 100).toFixed(1)} % der Beobachtungen auf Units des Sets (min ${MIN_SET_SHARE * 100} %, `
      + `ohne ${(nextShare * 100).toFixed(1)} % aus Set ${set + 1})`);
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
    stats: {
      rows: rows.length, invalid, units: units.length,
      setSharePermille: Math.round(setShare * 1000),
      nextSetPermille: Math.round(nextShare * 1000),
    },
  };
}
