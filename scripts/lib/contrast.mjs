// WCAG-Kontrast und ein kleiner Leser fuer die Farb-Tokens aus app/globals.css.
// Rein, ohne Dateizugriff: scripts/check-contrast.mjs liest die Dateien und
// gibt den Text hier hinein; contrast.test.mjs prueft die Rechnung.

/** '#rgb' / '#rrggbb' → [r, g, b] (0–255). Wirft bei allem anderen. */
export function hexToRgb(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`kein Hex-Farbwert: ${hex}`);
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export function rgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Relative Helligkeit nach WCAG 2.x. */
export function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => lin(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrastverhaeltnis 1–21, ungerundet. */
export function contrastRatio(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Farbe mit Deckkraft `alpha` (0–1) ueber einer deckenden Flaeche. */
export function blend(fg, bg, alpha) {
  return fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));
}

/**
 * Liest `--name: wert;` aus dem :root-Block und dem [data-game="tft"]-Block.
 * Kommentare werden vorher entfernt. Die Bloecke werden ueber ihren Selektor
 * gefunden, nicht ueber die Position — ein neuer Block davor stoert nicht.
 */
export function parseTokens(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const block = (selectorRe) => {
    const m = selectorRe.exec(clean);
    if (!m) return null;
    const start = clean.indexOf('{', m.index) + 1;
    let depth = 1;
    let i = start;
    for (; i < clean.length && depth > 0; i++) {
      if (clean[i] === '{') depth++;
      else if (clean[i] === '}') depth--;
    }
    const body = clean.slice(start, i - 1);
    const out = new Map();
    for (const d of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(d[1], d[2].trim());
    return out;
  };
  const root = block(/(?:^|[;}\s]):root\s*\{/m);
  if (!root) throw new Error(':root-Block nicht gefunden');
  const tft = block(/\[data-game="tft"\]\s*\{/);
  if (!tft) throw new Error('[data-game="tft"]-Block nicht gefunden');
  // Tailwind-Aliase (`--color-x: var(--x)`): daraus werden die Utilities.
  const theme = block(/@theme inline\s*\{/) ?? new Map();
  return { root, tft, theme };
}

/**
 * Loest einen Farbwert zu [r, g, b] auf. Versteht Hex, `var(--x)`,
 * `var(--x, fallback)`, `rgb(r g b)` und `rgb(var(--x-rgb))` (auch mit
 * `/ NN%` — die Deckkraft wird dann ignoriert, Tripel-Tokens tragen keine).
 * `scope` 'tft' sieht zuerst die Ueberschreibungen im tft-Block, sonst :root.
 * Wirft, wenn ein Token fehlt — eine stille Luecke waere ein gruener Check
 * ueber einer Farbe, die niemand geprueft hat.
 */
export function resolveColor(value, tokens, scope = 'root', seen = new Set()) {
  const v = String(value).trim();
  if (v.startsWith('#')) return hexToRgb(v);
  const varM = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(v);
  if (varM) {
    const name = varM[1];
    if (seen.has(name)) throw new Error(`Zirkel bei ${name}`);
    const raw = (scope === 'tft' ? tokens.tft.get(name) : undefined) ?? tokens.root.get(name);
    if (raw == null) {
      if (varM[2]) return resolveColor(varM[2], tokens, scope, seen);
      throw new Error(`Token nicht gefunden: ${name}`);
    }
    return resolveColor(raw, tokens, scope, new Set([...seen, name]));
  }
  const rgbM = /^rgb\(\s*(.+?)\s*(?:\/\s*[\d.]+%?\s*)?\)$/.exec(v);
  if (rgbM) {
    const inner = rgbM[1].trim();
    if (inner.startsWith('var(')) return resolveTriplet(inner, tokens, scope, seen);
    return parseTriplet(inner, v);
  }
  throw new Error(`Farbwert nicht lesbar: ${v}`);
}

function parseTriplet(s, ctx) {
  const parts = s.split(/[\s,]+/).filter(Boolean).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) throw new Error(`kein RGB-Tripel: ${ctx}`);
  return parts;
}

function resolveTriplet(v, tokens, scope, seen) {
  const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v);
  if (!m) throw new Error(`Tripel nicht lesbar: ${v}`);
  const name = m[1];
  if (seen.has(name)) throw new Error(`Zirkel bei ${name}`);
  const raw = (scope === 'tft' ? tokens.tft.get(name) : undefined) ?? tokens.root.get(name);
  if (raw == null) throw new Error(`Token nicht gefunden: ${name}`);
  if (raw.startsWith('var(')) return resolveTriplet(raw, tokens, scope, new Set([...seen, name]));
  return parseTriplet(raw, `${name}: ${raw}`);
}
