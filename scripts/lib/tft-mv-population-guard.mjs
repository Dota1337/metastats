// Entscheidet, ob ein Marktwert-Lauf die Vergleichsgruppe einer Region neu
// speichern darf (tft_mv_population_stats) oder die gespeicherte behalten muss.
//
// Warum es das braucht: die Vergleichsgruppe ist die Kohorte, die ein Lauf
// gerade frisch berechnet hat. Ein Nachlauf rechnet aber nur die Spieler, die
// seit dem Hauptlauf faellig geworden sind — 2026-10-07 waren das je Region
// zwischen 12 (ru) und 2603 (sg2) Spieler. Hat er bisher trotzdem gespeichert,
// wurde die Gruppe des Hauptlaufs von einer Handvoll Spielern ueberschrieben,
// und die naechste Bewertung mass jeden Spieler an diesem Rest.
//
// Die Regel, in dieser Reihenfolge:
//   1. keine gespeicherte Gruppe                      → speichern
//   2. Kohorte >= gespeicherte Gruppengroesse          → speichern
//   3. Kohorte >= Haelfte der bewerteten Spieler ab D2 → speichern
//   4. gespeicherte Gruppe aelter als 36 h UND Kohorte >= max(500, 1/4 der
//      bewerteten Spieler ab D2)                       → speichern (Notausgang,
//      sonst bliebe eine Gruppe nach einem verpassten Hauptlauf ewig stehen)
//   5. sonst behalten; ab 72 h Alter mit Warnung im Log
//
// Reine Funktion ohne DB, damit sie sich ohne Box testen laesst.

export const KEEP_ESCAPE_HOURS = 36;
export const KEEP_WARN_HOURS = 72;
export const ESCAPE_MIN_COHORT = 500;

/**
 * @param {{
 *   cohort: number,
 *   stored: { playerCount: number|null, computedAt: Date|string|null } | null,
 *   ratedD2Plus: number|null,
 *   nowMs?: number,
 * }} input
 * @returns {{ persist: boolean, reason: string, ageHours: number|null, warn: boolean }}
 */
export function shouldPersistPopulation({ cohort, stored, ratedD2Plus, nowMs = Date.now() }) {
  if (!Number.isFinite(cohort) || cohort < 0) throw new Error(`[pop-guard] ungueltige Kohorte: ${cohort}`);
  if (!stored) return { persist: true, reason: 'keine gespeicherte Gruppe', ageHours: null, warn: false };

  const computedMs = stored.computedAt == null ? NaN : new Date(stored.computedAt).getTime();
  const ageHours = Number.isFinite(computedMs) ? (nowMs - computedMs) / 3_600_000 : null;
  const storedCount = Number(stored.playerCount);
  const d2 = Number.isFinite(ratedD2Plus) && ratedD2Plus > 0 ? ratedD2Plus : 0;

  if (!Number.isFinite(storedCount) || storedCount <= 0 || cohort >= storedCount) {
    return { persist: true, reason: `Kohorte ${cohort} >= gespeichert ${Number.isFinite(storedCount) ? storedCount : '—'}`, ageHours, warn: false };
  }
  if (d2 > 0 && cohort >= 0.5 * d2) {
    return { persist: true, reason: `Kohorte ${cohort} >= Haelfte von ${d2} bewerteten`, ageHours, warn: false };
  }
  // Unbekanntes Alter zaehlt als alt: eine Gruppe ohne Zeitstempel darf nicht
  // fuer immer gewinnen.
  const old = ageHours == null || ageHours > KEEP_ESCAPE_HOURS;
  if (old && cohort >= Math.max(ESCAPE_MIN_COHORT, 0.25 * d2)) {
    return { persist: true, reason: `gespeicherte Gruppe ${ageHours == null ? 'ohne Zeit' : `${ageHours.toFixed(1)} h alt`}, Kohorte ${cohort} reicht`, ageHours, warn: false };
  }
  return {
    persist: false,
    reason: `Kohorte ${cohort} < gespeichert ${storedCount}${d2 > 0 ? ` und < Haelfte von ${d2}` : ''}`,
    ageHours,
    warn: ageHours == null || ageHours > KEEP_WARN_HOURS,
  };
}
