// Sperre fuer die LoL-Champion-Sammlung (collect-highelo.mjs, collect-kr-cn.mjs).
//
// Warum: am 13.09.2026 lief der 24-h-Dev-Key mitten im Lauf ab. Alle 70
// Detail-Abrufe scheiterten, das Skript schrieb trotzdem — und ersetzte die
// Vorwoche (EUW 5190 Spiele, KR 4962) durch leere Dateien. Die Live-Seite
// zeigte danach gar keine Zahlen mehr.
//
// Regel: lieber die alte Datei stehen lassen als eine leere oder duenne
// schreiben. Abbruch mit Exit 1, BEVOR Datei oder Supabase angefasst werden.

import fs from 'node:fs';

const MAX_ERROR_SHARE = 0.5;
// Unter 30 % der Vorwoche ist keine Wochen-Stichprobe mehr, sondern ein
// Teilausfall (z.B. Key stirbt in der Match-ID-Phase, die restlichen Details
// laden sauber).
const MIN_SHARE_OF_PREVIOUS = 0.3;

function abort(label, reason) {
  console.error(`\n[sperre] ${label}: ${reason} — nichts geschrieben, alte Dateien bleiben.`);
  process.exit(1);
}

/** Nach der Match-ID-Phase: frueh abbrechen statt 25 min mit totem Key weiterzulaufen. */
export function checkIdPhase(label, attempts, failures) {
  if (attempts > 0 && failures / attempts > MAX_ERROR_SHARE) {
    abort(label, `${failures} von ${attempts} Match-ID-Abrufen fehlgeschlagen`);
  }
}

/** Vor dem ersten Schreiben: 0 Spiele, zu viele Fehler oder Einbruch gegen die Vorwoche. */
export function checkSample(label, { prevFile, totalGames, matchAttempts, matchErrors }) {
  if (totalGames === 0) abort(label, '0 Spiele ausgewertet');
  if (matchAttempts > 0 && matchErrors / matchAttempts > MAX_ERROR_SHARE) {
    abort(label, `${matchErrors} von ${matchAttempts} Match-Abrufen fehlgeschlagen`);
  }
  let prev = 0;
  try {
    prev = JSON.parse(fs.readFileSync(prevFile, 'utf8')).matchesAnalyzed || 0;
  } catch {
    // Keine oder kaputte Vorgaenger-Datei: nur die Regeln oben gelten.
  }
  if (prev > 0 && totalGames < prev * MIN_SHARE_OF_PREVIOUS) {
    abort(label, `nur ${totalGames} Spiele, Vorwoche ${prev} (Untergrenze ${Math.round(MIN_SHARE_OF_PREVIOUS * 100)} %)`);
  }
}
