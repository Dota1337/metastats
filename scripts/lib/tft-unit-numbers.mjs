// Zahlen der Unit-Faehigkeiten aus MetaTFTs Nachschlagedatei.
//
// Die Texte kommen von tactics.tools und tragen die Patch-Stand-Zahlen oft nicht
// (gemessen 01.11.2026: Caitlyn 190/285/470, Riot 200/300/490). Riots eigene Datei
// hat keine Werte (`ability.variables` leer). MetaTFT hat sie, aber im Text fehlen
// dort Werte (refresh-unit-info.mjs), deshalb: Text von tactics.tools, Zahlen von
// MetaTFT, nur wo sie sich sicher zuordnen lassen.
//
// Die Datei ist undokumentiert und laeuft nicht im Gleichschritt mit dem Spiel:
// `pbe` ist dem Spiel voraus, `latest` hing am 01.11. seit 06.10. auf 18.4. Deshalb
// zaehlt nur eine Datei, deren `_metadata.release` dem laufenden Patch entspricht.

const SERIES_RE = /(?<![\d./])\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+%?/g;

/** rls-18.6.0.5794736… → 18.6 */
export function releasePatch(meta) {
  return /^rls-(\d+\.\d+)\./.exec(String(meta?.release ?? ''))?.[1] ?? null;
}

/** Zahlenreihen einer MetaTFT-Unit in der Reihenfolge ihres Textes. */
export function unitSeries(unit) {
  const calcs = unit?.attributeCalcs ?? {};
  const out = [];
  const push = values => {
    if (!Array.isArray(values) || values.length < 2) return;
    if (!values.every(v => typeof v === 'number' && Number.isFinite(v))) return;
    if (new Set(values.slice(0, 3)).size < 2) return;
    out.push(values.map(v => Math.round(v * 1000) / 1000));
  };
  for (const m of String(unit?.ability?.desc ?? '').matchAll(/attributeID="([^"]+)"/gi)) {
    const calc = calcs[m[1]];
    if (!calc) continue;
    const terms = (calc.terms ?? []).filter(t => Array.isArray(t.coefficient) && !/Calc/.test(String(t.scaling ?? '')));
    if (terms.length) terms.forEach(t => push(t.coefficient));
    else push(calc.values);
  }
  return out;
}

const parseGroup = g => ({ pct: g.endsWith('%'), values: g.replace('%', '').split('/').map(Number) });
const scaled = (series, n, pct) => series.slice(0, n).map(v => (pct && Math.abs(v) <= 5 ? Math.round(v * 10000) / 100 : v));
const same = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.005);

// Abstand als groesste relative Abweichung. Gemessen am Testserver-Stand 18.6: echte
// Patch-Aenderungen lagen bei hoechstens 16 %, der einzige Treffer darueber (Alistar
// 76/137/246 → 100/150/225, 32 %) war eine andere Zahl.
const MAX_GAP = 0.25;
const CLEAR_MARGIN = 0.1;
function gap(a, b) {
  if (a.length !== b.length) return Infinity;
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    const base = Math.max(Math.abs(a[i]), 1);
    worst = Math.max(worst, Math.abs(a[i] - b[i]) / base);
  }
  return worst;
}

/**
 * Ersetzt Reihen im Text je Sprache. Erst belegen exakte Treffer ihre Reihe, dann
 * bekommt jede uebrige Textreihe die naechstgelegene freie — nur wenn sie nah genug
 * und deutlich naeher als die zweitbeste ist. Sonst bleibt der Text, wie er ist.
 */
export function overlayNumbers(desc, series) {
  const en = String(desc?.en ?? '');
  const groups = en.match(SERIES_RE) ?? [];
  const used = new Set();
  const open = [];
  for (const g of groups) {
    const { pct, values } = parseGroup(g);
    const hit = series.findIndex((s, i) => !used.has(i) && same(values, scaled(s, values.length, pct)));
    if (hit >= 0) used.add(hit);
    else open.push({ g, pct, values });
  }
  const replaced = [];
  const left = [];
  let text = desc;
  for (const { g, pct, values } of open) {
    const ranked = series
      .map((s, i) => ({ i, d: used.has(i) ? Infinity : gap(values, scaled(s, values.length, pct)) }))
      .filter(x => x.d <= MAX_GAP)
      .sort((a, b) => a.d - b.d);
    if (!ranked.length || (ranked[1] && ranked[1].d - ranked[0].d < CLEAR_MARGIN)) { left.push(g); continue; }
    used.add(ranked[0].i);
    const to = scaled(series[ranked[0].i], values.length, pct).join('/') + (pct ? '%' : '');
    const re = new RegExp(`(?<![\\d./])${g.replace(/[.%]/g, '\\$&')}(?![\\d./])`, 'g');
    const next = {};
    for (const [lang, t] of Object.entries(text)) next[lang] = String(t).replace(re, to);
    text = next;
    replaced.push({ from: g, to });
  }
  return { text, replaced, left };
}
