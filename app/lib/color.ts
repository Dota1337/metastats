// Ein einziger Engpass für „Farbe plus Deckkraft".
//
// Warum es diese Datei gibt: an 70 Stellen im Repo wurde ein Farbwert mit
// einem zweistelligen Alpha-Suffix verschweißt — `` `${tierColor}20` ``. Das
// funktioniert nur, solange der Wert ein 6-stelliger Hex ist. Sobald derselbe
// Wert einem Design-Token folgt (`var(--fg-muted)`), entsteht daraus
// `var(--fg-muted)20`: ungültiges CSS. Der Browser verwirft die Deklaration
// still, die Fläche verschwindet, und kein Build-Fehler weist darauf hin.
//
// Damit war die Token-Migration an genau dieser Stelle blockiert. Der Helfer
// entscheidet die Umrechnung zur Laufzeit statt zur Schreibzeit:
//
//   Hex-Eingabe  ->  Suffix anhängen, BITGLEICH zum alten Verhalten
//   alles andere ->  color-mix(in srgb, X N%, transparent)
//
// Deshalb ändert die Einführung heute keine einzige gerenderte Farbe. Erst
// wenn ein Aufrufer seinen Hex gegen ein Token tauscht, schaltet der Helfer
// den Pfad um.
//
// `alpha` ist bewusst 0..255 und nicht in Prozent: die 70 Fundstellen tragen
// Hex-Suffixe, und ein Umweg über Prozent rundet nicht verlustfrei zurück
// (0x55 = 85 -> 33,33 % -> 33 % -> 84, also ein Wert daneben). Mit 0..255
// ist der Hex-Pfad exakt.
//
// Warum `color-mix` und nicht `rgb(var(--token-rgb) / N%)`: das bräuchte zu
// jedem Token ein zusätzliches RGB-Tripel in `app/globals.css`, das beim
// Farbwechsel von Hand mitgeführt werden muss — genau die doppelte
// Source-of-Truth, die dort für `--accent-rgb` schon als Preis dokumentiert
// ist. `color-mix` kommt ohne aus (Chrome 111 / Safari 16.2 / Firefox 113).
//
// Die Lightning-CSS-Falle aus `reference_design_token_system.md` greift hier
// nicht: sie betrifft Regeln in `app/globals.css`, die durch den CSS-Prozessor
// laufen. Die Aufrufer hier schreiben in Inline-`style={{}}`-Objekte, die als
// DOM-Property direkt an den Browser gehen und keinen Prozessor sehen.

/** 6-stelliger Hex — nur dieser Fall darf das Suffix direkt anhängen. */
const HEX6 = /^#[0-9a-fA-F]{6}$/;

/**
 * Farbe mit Deckkraft.
 *
 * @param color Hex (`#7a8aa0`), Token (`var(--fg-muted)`) oder jede andere
 *              CSS-Farbe.
 * @param alpha Deckkraft als 0..255 — dieselbe Skala wie das alte Hex-Suffix.
 */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha)));
  if (HEX6.test(color)) return color + a.toString(16).padStart(2, '0');
  return `color-mix(in srgb, ${color} ${((a / 255) * 100).toFixed(2)}%, transparent)`;
}
