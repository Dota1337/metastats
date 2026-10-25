// Farben der Trait-Stufen nach Riots `style` (1 Bronze, 3 Silber, 4 Gold,
// 5 Prismatisch) — eine Quelle fuer Trait-Liste, Trait-Detail, Builder und
// Match-Ansichten. Ohne Importe, damit scripts/check-contrast.mjs die Werte
// direkt lesen kann.
//
// Bronze war #a07a4d: als Schrift auf eigener Toenung (0x25) ueber base nur
// 3,38:1. #c0956a hat dort 4,58:1, pur auf base 5,77:1.
// Rahmen und Flaechen der Comp-Ansichten laufen ueber activeTraitStyleColor
// (tft-active-traits.ts) und sind davon unberuehrt.
export const TRAIT_STYLE_COLOR: Readonly<Record<number, string>> = {
  1: '#c0956a', // Bronze
  3: '#cfd6dc', // Silber
  4: '#e0c75a', // Gold
  5: '#c39bff', // Prismatisch
};
