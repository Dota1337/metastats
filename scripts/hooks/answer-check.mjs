#!/usr/bin/env node
// Stop-Hook: zwei Notbremsen fuer Ergebnis-Antworten.
//
// Bremse A — Laenge. Bewusst NICHT global: gemessen ueber 6 Sessions (176
// Antworten) liegt der Median bei 1 Zeile, p90 bei 17, p99 bei 33. Ein
// globaler Zeilenzaehler wuerde ueberwiegend falsch ausloesen und waere binnen
// einer Woche abgeschaltet (siehe feedback_disable_gateguard.md). Er greift
// deshalb nur, wo das Problem tatsaechlich sitzt: in der Antwort NACH getaner
// Arbeit, ohne Tabelle und ohne Code — also im Fliesstext-Bericht.
//
// Bremse B — Beleg. Zahlen ohne Messung im selben Turn. Das ist die Ursache
// der Korrektur-Schleifen: eine behauptete Zahl, die der User spaeter
// widerlegt.
//
// Beide feuern selten und begruenden sich selbst. Ein Hook, der nervt, wird
// deaktiviert; ein Hook, der zweimal im Monat trifft, bleibt stehen.
//
// Runde 2 (2026-08-15), nach zwei Review-Verdicts an der ersten Fassung:
//   • Die Tabellen-Ausnahme war ein Freibrief — Verbositaet wandert einfach in
//     Tabellenzeilen. Sie gilt jetzt nur noch fuer GENAU EINE Tabelle mit
//     hoechstens TABLE_ROW_BUDGET Datenzeilen (der vorgeschriebene
//     Alternativen-Vergleich). Alles darueber zaehlt als Fliesstext.
//   • `lastHadTools` liess jede Antwort durch, die im selben Block mit einem
//     Tool-Call endet. Als Zwischenmeldung gilt jetzt nur noch kurzer Text.
//   • Der Schleifenschutz haengt nicht mehr am Text (eine neu geschriebene,
//     erneut zu lange Antwort hatte eine neue Signatur und kam durch), sondern
//     am Turn: pro User-Nachricht wird hoechstens EINMAL gebremst.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readInput, readState, writeState } from './lib/state.mjs';

const MAX_LINES = 20;
/** Datenzeilen, die eine einzelne Tabelle "gratis" haben darf. */
const TABLE_ROW_BUDGET = 8;
/** Zeilen Vortext, bis zu denen eine Antwort mit Tool-Call eine Zwischenmeldung ist. */
const INTERIM_MAX_LINES = 4;

const input = readInput();
if (input.stop_hook_active) process.exit(0); // Schleifenschutz

const path = input.transcript_path;
if (!path) process.exit(0);

let lines;
try {
  lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
} catch {
  process.exit(0);
}

// Rueckwaerts bis zur letzten ECHTEN User-Nachricht. Tool-Results kommen
// ebenfalls als type:'user' an, zaehlen hier aber nicht als Turn-Grenze.
let toolCalls = 0;
let lastText = null;
let lastHadTools = false;
let userText = '';

for (let i = lines.length - 1; i >= 0; i--) {
  let o;
  try { o = JSON.parse(lines[i]); } catch { continue; }
  const c = o?.message?.content;

  if (o.type === 'user') {
    const isReal = typeof c === 'string' || (Array.isArray(c) && c.some(b => b.type === 'text'));
    if (isReal) {
      userText = typeof c === 'string'
        ? c
        : c.filter(b => b.type === 'text').map(b => b.text || '').join('\n');
      break;
    }
    continue;
  }
  if (o.type !== 'assistant' || !Array.isArray(c)) continue;

  const texts = c.filter(b => b.type === 'text' && b.text?.trim());
  const tools = c.filter(b => b.type === 'tool_use');
  toolCalls += tools.length;

  if (lastText === null && texts.length) {
    lastText = texts.at(-1).text.trim();
    lastHadTools = tools.length > 0;
  }
}

if (!lastText) process.exit(0);

const body = lastText.split('\n');

// Ein Tool-Call im selben Block macht eine Antwort nur dann zur
// Zwischenmeldung, wenn sie auch wie eine aussieht. Ein 30-Zeilen-Bericht mit
// angehaengtem Tool-Call ist ein Bericht.
if (lastHadTools && body.length <= INTERIM_MAX_LINES) process.exit(0);

// Pro Turn hoechstens einmal bremsen. Turn-Key ist die letzte echte
// User-Nachricht — eine neu geschriebene Antwort hat einen anderen Text, aber
// denselben Turn, und kommt damit garantiert durch.
const turnKey = createHash('sha1').update(userText || String(input.session_id || '')).digest('hex').slice(0, 12);
const state = readState(input.session_id);
const brakeCount = state.brakeTurnKey === turnKey ? (state.brakeCount || 0) : 0;
if (brakeCount >= 1) process.exit(0);

// Zeilen, die nicht als Fliesstext zaehlen: Code-Bloecke immer, Tabellenzeilen
// nur solange sich die Antwort auf EINE Tabelle im Budget beschraenkt.
const isTableLine = l => (l.match(/\|/g) || []).length >= 2;
let inCode = false;
const codeLines = new Set();
body.forEach((l, i) => {
  if (l.trim().startsWith('```')) { codeLines.add(i); inCode = !inCode; return; }
  if (inCode) codeLines.add(i);
});

// Zusammenhaengende Tabellenbloecke zaehlen (ohne Kopf- und Trennzeile).
const tables = [];
let run = 0;
body.forEach((l, i) => {
  if (!codeLines.has(i) && isTableLine(l)) { run++; return; }
  if (run) { tables.push(Math.max(0, run - 2)); run = 0; }
});
if (run) tables.push(Math.max(0, run - 2));

const tableBudgetOk = tables.length <= 1 && (tables[0] || 0) <= TABLE_ROW_BUDGET;
const countable = body.filter((l, i) => {
  if (codeLines.has(i)) return false;
  if (tableBudgetOk && isTableLine(l)) return false;
  return true;
}).length;

function block(reason) {
  writeState(input.session_id, { brakeTurnKey: turnKey, brakeCount: brakeCount + 1 });
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

// --- Bremse A: langer Ergebnis-Bericht nach echter Arbeit -----------------
if (countable > MAX_LINES && toolCalls >= 3) {
  const warum = tableBudgetOk
    ? `${countable} Zeilen ausserhalb von Tabelle und Code (Grenze ${MAX_LINES})`
    : `${countable} Zeilen — die Tabellen-Ausnahme greift nicht (${tables.length} Tabellen, groesste ${Math.max(0, ...tables)} Datenzeilen, erlaubt ist EINE mit hoechstens ${TABLE_ROW_BUDGET})`;
  block(
`Diese Ergebnis-Antwort hat ${warum}. Schreib sie neu:

- Zeile 1-3: der Befund. Was ist das Ergebnis, was heisst das fuer den User.
- Danach nur, was er zum Weiterentscheiden braucht.
- Raus: Rekapitulation der eigenen Schritte, Status-Inventare, Praeambeln,
  Abschluss-Zusammenfassung, ungefragte Naechste-Schritte-Menues.

Eine Tabelle mit bis zu ${TABLE_ROW_BUDGET} Datenzeilen (z.B. der Alternativen-
Vergleich) und Code-Bloecke zaehlen nicht mit. Zwei Tabellen oder eine laengere
zaehlen komplett als Fliesstext — Verbositaet in Tabellenform bleibt Verbositaet.`);
}

// --- Bremse B: Zahlen ohne Messung im selben Turn -------------------------
if (toolCalls === 0) {
  // Abschluss mit (?!\w) statt \b: nach einem '%' gibt es keine Wortgrenze,
  // mit \b waere ausgerechnet die haeufigste Behauptung ("40 %") nie erkannt
  // worden.
  const claims = lastText.match(/\b\d[\d.,]*\s*(%|Prozent|Zeilen|Dateien|Eintraege|Treffer|Sekunden|Minuten|Stunden|ms|MB|KB|GB|Turns?|Calls?|Sessions?|Writes?)(?!\w)/gi) || [];
  if (claims.length >= 2) {
    block(
`Diese Antwort behauptet Zahlen (${claims.slice(0, 3).join(', ')}), aber in diesem Turn wurde nichts gemessen.

Entweder messen (Read/Grep/Bash im selben Turn) und die echten Werte nennen,
oder die Zahlen als ungeprueft kennzeichnen bzw. streichen. Genau diese
unbelegten Zahlen sind der Grund fuer die Korrektur-Schleifen.`);
  }
}

process.exit(0);
