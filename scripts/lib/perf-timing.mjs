// Segment-Stoppuhr für die Marktwert-Pipeline.
//
// Warum es das gibt: der Snapshot-Lauf schafft ~11 Spieler/Minute, also grob
// 4,6s pro Spieler — und am 05.08. hat sich gezeigt, dass die naheliegende
// Erklärung (Riot-Limiter am Anschlag) falsch war: nur ~16 % der Spieler
// fetchen überhaupt, der Rest läuft über `skipCacheRefresh` rein aus dem
// Cache. Die Zeit geht also woanders hin. Statt weiter zu raten wird hier
// gemessen, bevor irgendetwas optimiert wird.
//
// Grundsatz: standardmäßig AUS. Ohne `MV_TIMING=1` ist `timed()` ein direkter
// Durchreicher ohne Zeitmessung und ohne Allokation, damit die geteilten
// Pfade (player-stats, refresh-api) nichts davon merken.

const ENABLED = process.env.MV_TIMING === '1' || process.env.MV_TIMING === 'true';

/** @type {Map<string, number[]>} Segment-Name → alle gemessenen Dauern in ms */
const samples = new Map();
/** @type {Map<string, number>} freie Zähler (z.B. wieviele Spieler gefetcht haben) */
const counters = new Map();

export const timingEnabled = ENABLED;

/**
 * Miss die Dauer von `fn` unter `name`. Reicht Rückgabewert und Fehler
 * unverändert durch — die Messung darf das Verhalten nicht verändern, auch
 * nicht im Fehlerfall (deshalb `finally`, nicht nach dem await).
 *
 * @template T
 * @param {string} name
 * @param {() => Promise<T> | T} fn
 * @returns {Promise<T> | T}
 */
export function timed(name, fn) {
  if (!ENABLED) return fn();
  const t0 = performance.now();
  let arr = samples.get(name);
  if (!arr) { arr = []; samples.set(name, arr); }
  let settled = false;
  const stop = () => { if (!settled) { settled = true; arr.push(performance.now() - t0); } };
  try {
    const out = fn();
    // Sync-Funktionen (extractRawMetrics) dürfen genauso rein wie async.
    if (out && typeof out.then === 'function') {
      return out.then(
        (v) => { stop(); return v; },
        (e) => { stop(); throw e; },
      );
    }
    stop();
    return out;
  } catch (e) {
    stop();
    throw e;
  }
}

/** Freier Zähler, z.B. `bump('players.fetched')`. */
export function bump(name, by = 1) {
  if (!ENABLED) return;
  counters.set(name, (counters.get(name) ?? 0) + by);
}

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[i];
}

/**
 * Eine kompakte Zeile pro Segment, absteigend nach Gesamtanteil — die
 * interessante Frage ist „wo geht die Zeit hin", nicht „was ist einzeln
 * langsam". Ein Segment mit p50 2ms, das 200x pro Spieler läuft, muss oben
 * stehen; deshalb sortiert die Summe, nicht der Median.
 *
 * @returns {string} mehrzeilig, leer wenn nichts gemessen wurde
 */
export function formatTimings() {
  if (!ENABLED || samples.size === 0) return '';
  const rows = [...samples.entries()].map(([name, arr]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    return { name, n: sorted.length, sum, p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9) };
  }).sort((a, b) => b.sum - a.sum);

  const total = rows.reduce((a, r) => a + r.sum, 0) || 1;
  const w = Math.max(...rows.map(r => r.name.length));
  const lines = rows.map(r =>
    `    ${r.name.padEnd(w)}  ${(r.sum / total * 100).toFixed(0).padStart(3)}%`
    + `  n=${String(r.n).padStart(6)}`
    + `  p50=${r.p50.toFixed(0).padStart(5)}ms`
    + `  p90=${r.p90.toFixed(0).padStart(6)}ms`
    + `  Σ=${(r.sum / 1000).toFixed(0).padStart(5)}s`,
  );
  if (counters.size > 0) {
    lines.push('    ' + [...counters.entries()].map(([k, v]) => `${k}=${v}`).join('  '));
  }
  return lines.join('\n');
}

/** Zähler und Messwerte leeren — pro Region ein sauberer Schnitt. */
export function resetTimings() {
  samples.clear();
  counters.clear();
}
