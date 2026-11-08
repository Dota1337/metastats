// Wie oft ein Spieler in Ranked Solo auf seiner Primaer-, Sekundaerrolle oder per
// Autofill spielte. Grundlage ist roleAssignment aus match-processor.ts (Riots
// selectedRolePreferences, ab Patch 16.11). Nur Queue 420: in Flex fehlt das
// Feld oft, in ARAM/Arena gibt es keine Rollen.
import type { RoleAssignment } from './match-processor';

/** Darunter zeigt die Spielerseite keine Anteile: bei 5 Spielen waere ein Autofill schon 20 %. */
export const ROLE_SHARE_MIN_GAMES = 10;
const RANKED_SOLO = 420;

export interface RoleShares {
  /** Spiele mit Zuteilung (ohne selbst gewaehltes „Auffuellen") */
  n: number;
  primary: number;
  secondary: number;
  autofill: number;
}

/**
 * Ganze Prozente, Summe genau 100 (Verteilung des Rests nach groesstem
 * Nachkomma-Anteil). FILL zaehlt nicht mit: der Spieler hat dann selbst
 * „Auffuellen" gewaehlt, das ist weder Haupt- noch Nebenrolle noch Autofill.
 */
export function roleShares(
  matches: ReadonlyArray<{ queueId?: number; roleAssignment?: RoleAssignment | null }>,
): RoleShares | null {
  const counts = [0, 0, 0];
  for (const m of matches) {
    if (m.queueId !== RANKED_SOLO) continue;
    if (m.roleAssignment === 'PRIMARY') counts[0]++;
    else if (m.roleAssignment === 'SECONDARY') counts[1]++;
    else if (m.roleAssignment === 'AUTOFILL') counts[2]++;
  }
  const n = counts[0] + counts[1] + counts[2];
  if (n < ROLE_SHARE_MIN_GAMES) return null;
  // Ganzzahlig rechnen: mit Kommazahlen entschied Rundungsrauschen den Gleichstand
  // (12 Spiele 10/1/1 ergab 83/9/8 statt 84/8/8).
  const pct = counts.map(c => Math.floor((c * 100) / n));
  const rest = 100 - pct.reduce((a, b) => a + b, 0);
  const order = counts.map((c, i) => [(c * 100) % n, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; k < rest; k++) pct[order[k][1]]++;
  return { n, primary: pct[0], secondary: pct[1], autofill: pct[2] };
}
