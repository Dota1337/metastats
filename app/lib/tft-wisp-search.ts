// Wisp-Runden und Wisp-Suche fuer /tft/tools/tables. Laeuft im Browser und auf
// dem Server (kein node:fs) — deshalb nicht in tft-loot-tables.ts.
//
// Runden: Little Buddy Bot ordnet jedem Rundenband feste Runden zu (Konstante
// APPEARANCE_BANDS auf littlebuddybot.com/tft-wisps). scripts/import-tft-tables.mjs
// liest sie dort und schreibt sie als `bands` in public/tft-wisps-<set>.json; fehlt
// das Feld, zeigt die Seite nur das Band und sucht Runden als Text.
//
// Suche: Leerzeichen und AND verknuepfen mit UND, OR mit ODER (AND bindet staerker),
// Klammern gruppieren, "…" sucht eine Wortgruppe. Gross-/Kleinschreibung und Akzente
// zaehlen nicht, Teilwoerter treffen. Eine Runde wie „3-2" trifft Wisps, deren
// Bereich die Runde enthaelt. Fehler in der Eingabe werden geschluckt (offene
// Klammer/Anfuehrungszeichen gelten als geschlossen, Operatoren am Rand zaehlen nicht).

/** Reihenfolge der Baender — die einzige im App-Code. Der Import fuehrt dieselbe
 *  Liste als ROUND_ORDER; tft-wisp-search.test.mjs prueft die JSON dagegen. */
export const WISP_ROUNDS = ['Early', 'EarlyMid', 'Mid', 'MidLate', 'Late', 'VeryLate'] as const;
export type WispRound = (typeof WISP_ROUNDS)[number];

/** Runden eines Bandes, z. B. { from: '2-1', to: '2-7' }. */
export interface WispBand { from: string; to: string }
export type WispBands = Record<WispRound, WispBand>;

/** „3-2" → 302 zum Vergleichen; null, wenn es keine Runde ist. */
export function roundKey(s: string): number | null {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(s);
  return m ? Number(m[1]) * 100 + Number(m[2]) : null;
}

export interface RoundRange {
  from: string;
  to: string;
  /** Bereich reicht bis ins letzte Band („ab 6-1"). */
  open: boolean;
}

/** Zusammenhaengende Baender als Bereiche; Luecken ergeben einen weiteren Bereich. */
export function bandRuns(rounds: readonly WispRound[]): [number, number][] {
  const idx = [...new Set(rounds.map(r => WISP_ROUNDS.indexOf(r)).filter(i => i >= 0))].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const i of idx) {
    const last = runs[runs.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else runs.push([i, i]);
  }
  return runs;
}

/** Bereiche in Runden — dieselbe Grundlage fuer Anzeige und Suche. */
export function roundRanges(rounds: readonly WispRound[], bands: WispBands): RoundRange[] {
  return bandRuns(rounds).map(([a, b]) => ({
    from: bands[WISP_ROUNDS[a]].from,
    to: bands[WISP_ROUNDS[b]].to,
    open: b === WISP_ROUNDS.length - 1,
  }));
}

/** Liegt die Runde (aus roundKey) in einem der Baender? Runden, die es nicht gibt
 *  (x-0, x-8 …; jede Stage ab 2 hat 7 Runden, tft-stage.ts), treffen nie — sonst fiele
 *  „2-8" in einen zusammengefassten Bereich 2-1 – 3-4. */
export function roundInBands(key: number, rounds: readonly WispRound[], bands: WispBands): boolean {
  const pos = key % 100;
  if (pos < 1 || pos > 7) return false;
  return roundRanges(rounds, bands).some(r => key >= (roundKey(r.from) ?? Infinity) && key <= (roundKey(r.to) ?? -Infinity));
}

/** Fuer Suchtext und Eingabe gleich: klein, ohne Akzente, typografische Zeichen vereinheitlicht. */
export function normalizeSearch(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
    .toLowerCase()
    .replace(/[‘’´`]/g, "'")
    .replace(/[‐-―−]/g, '-')
    .replace(/[^\S\n]+/g, ' ');
}

export type WispQuery =
  | { k: 'term'; v: string; round: number | null }
  | { k: 'and' | 'or'; c: WispQuery[] };

type Token = { t: 'and' | 'or' | '(' | ')' } | { t: 'term'; v: string; phrase: boolean };

const QUOTES = '"“”„';

function tokenize(q: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < q.length) {
    const c = q[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') { out.push({ t: c }); i++; continue; }
    if (QUOTES.includes(c)) {
      let j = i + 1;
      while (j < q.length && !QUOTES.includes(q[j])) j++;
      const v = q.slice(i + 1, j).trim();
      if (v) out.push({ t: 'term', v, phrase: true });
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < q.length && !/\s/.test(q[j]) && !`()${QUOTES}`.includes(q[j])) j++;
    const w = q.slice(i, j);
    if (w === 'and') out.push({ t: 'and' });
    else if (w === 'or') out.push({ t: 'or' });
    else out.push({ t: 'term', v: w, phrase: false });
    i = j;
  }
  return out;
}

const combine = (k: 'and' | 'or', parts: WispQuery[]): WispQuery | null =>
  parts.length === 0 ? null : parts.length === 1 ? parts[0] : { k, c: parts };

/** Eingabe → Ausdruck; null bei leerer Eingabe (dann trifft alles). */
export function parseWispQuery(input: string): WispQuery | null {
  const tokens = tokenize(normalizeSearch(input));
  let i = 0;

  function orExpr(): WispQuery | null {
    const parts: WispQuery[] = [];
    for (;;) {
      const a = andExpr();
      if (a) parts.push(a);
      if (tokens[i]?.t === 'or') { i++; continue; }
      return combine('or', parts);
    }
  }

  // Liest bis zum naechsten OR oder „)"; ein einzelnes AND verbindet wie ein Leerzeichen.
  function andExpr(): WispQuery | null {
    const parts: WispQuery[] = [];
    while (i < tokens.length) {
      const tk = tokens[i];
      if (tk.t === 'or' || tk.t === ')') break;
      i++;
      if (tk.t === 'and') continue;
      if (tk.t === '(') {
        const inner = orExpr();
        if (tokens[i]?.t === ')') i++;
        if (inner) parts.push(inner);
        continue;
      }
      if (tk.t !== 'term') continue;
      parts.push({ k: 'term', v: tk.v, round: tk.phrase ? null : roundKey(tk.v) });
    }
    return combine('and', parts);
  }

  // Ueberzaehlige „)" auf oberster Ebene ueberspringen und weiterlesen.
  const parts: WispQuery[] = [];
  while (i < tokens.length) {
    const e = orExpr();
    if (e) parts.push(e);
    if (tokens[i]?.t === ')') i++;
  }
  return combine('and', parts);
}

/**
 * Trifft der Ausdruck? `text` ist mit normalizeSearch vorbereitet. `roundHit` prueft
 * eine Runde gegen die Baender; null, wenn keine Baender vorliegen — dann zaehlt die
 * Runde als gewoehnlicher Text.
 */
export function matchWispQuery(q: WispQuery, text: string, roundHit: ((key: number) => boolean) | null): boolean {
  switch (q.k) {
    case 'term':
      return q.round != null && roundHit ? roundHit(q.round) : text.includes(q.v);
    case 'and':
      return q.c.every(c => matchWispQuery(c, text, roundHit));
    case 'or':
      return q.c.some(c => matchWispQuery(c, text, roundHit));
  }
}
