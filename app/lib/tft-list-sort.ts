// Reihenfolge der Units-Liste. Eigene Datei, weil zwei Stellen dieselbe
// Reihenfolge brauchen: die API (/api/tft/units) und die Startdaten der
// Server-Seite (app/lib/seo/initial-data.ts) — eine Route darf ausser den
// HTTP-Methoden nichts exportieren.

// Seltene Einheiten (in weniger als 0,5 % der Spielerpartien) ans Ende: ihr
// Schnitt beruht auf wenigen Spielen und sagt wenig — sonst stehen Exoten
// mit einer Handvoll Siegen ganz oben. Innerhalb beider Gruppen: Schnitt.
const RARE_PICK_RATE = 0.005;

export function sortUnitsRareLast<T extends { avgPlacement?: number | null; pickRate?: number | null }>(units: T[]): void {
  const rare = (u: T) => (u.pickRate != null && u.pickRate < RARE_PICK_RATE ? 1 : 0);
  units.sort((a, b) => rare(a) - rare(b) || (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));
}
