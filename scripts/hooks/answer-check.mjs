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
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readInput, readState, writeState } from './lib/state.mjs';

const MAX_LINES = 25;

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

for (let i = lines.length - 1; i >= 0; i--) {
  let o;
  try { o = JSON.parse(lines[i]); } catch { continue; }
  const c = o?.message?.content;

  if (o.type === 'user') {
    const isReal = typeof c === 'string' || (Array.isArray(c) && c.some(b => b.type === 'text'));
    if (isReal) break;
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
// Antwort mit Tool-Call im selben Block ist eine Zwischenmeldung, kein Ergebnis.
if (lastHadTools) process.exit(0);

// Schon einmal fuer genau diesen Text gebremst? Dann durchlassen — sonst
// haengt die Session in der Bremse fest.
const sig = createHash('sha1').update(lastText).digest('hex').slice(0, 12);
const state = readState(input.session_id);
if (state.lastBrakeSig === sig) process.exit(0);

const body = lastText.split('\n');
const hasTable = body.some(l => (l.match(/\|/g) || []).length >= 2);
const hasCode = lastText.includes('```');

function block(reason) {
  writeState(input.session_id, { lastBrakeSig: sig });
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

// --- Bremse A: langer Fliesstext-Bericht nach echter Arbeit ---------------
if (body.length > MAX_LINES && !hasTable && !hasCode && toolCalls >= 3) {
  block(
`Diese Ergebnis-Antwort hat ${body.length} Zeilen Fliesstext (Grenze ${MAX_LINES}). Schreib sie neu:

- Zeile 1-3: der Befund. Was ist das Ergebnis, was heisst das fuer den User.
- Danach nur, was er zum Weiterentscheiden braucht.
- Raus: Rekapitulation der eigenen Schritte, Status-Inventare, Praeambeln,
  Abschluss-Zusammenfassung, ungefragte Naechste-Schritte-Menues.

Tabellen und Code-Bloecke sind ausgenommen — wenn der Inhalt eine Tabelle
verlangt (z.B. der Alternativen-Vergleich), nimm eine.`);
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
