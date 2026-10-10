// Shared TFT UI helpers. Centralizes small values that were copy-pasted across
// the TFT pages/components. Adopt incrementally: `costColor` is byte-identical
// to the local costColor / costColorOf / costToColor copies it replaces, so
// migrating a file is a pure no-visual-change swap.

// Champion cost → border/accent colour (1-cost grey … 5-cost gold).
export function costColor(cost: number): string {
  return cost === 1 ? '#9aa6b2'
    : cost === 2 ? '#3a8'
    : cost === 3 ? '#3a8ddc'
    : cost === 4 ? '#c39bff'
    : '#e0c75a';
}

// Core/Flex-Rahmen um eine Gruppe von Unit-Kacheln (Comp-Liste + Comp-DNA,
// User 2026-10-10: „eine Umrandung für Core und eine für Flex"): durchgezogen =
// Core, gestrichelt = Flex. Auch fuer die Mini-Symbole in Legende und Zaehler,
// damit sie wie der Rahmen aussehen. Kein Rahmen ohne Einteilung.
// Farbe (User 2026-10-10, Variante 5): Core = helle Linie + Flaeche in TFT-Lila,
// Flex = grau gestrichelt ohne Flaeche. Das Lila steckt nur in der Flaeche, damit
// der lila Carry-/4-Kosten-Rand der Kacheln sichtbar bleibt.
export function coreFlexFrame(kind: 'core' | 'flex' | null | undefined): { border: string; background: string } | undefined {
  if (!kind) return undefined;
  return kind === 'core'
    ? { border: '2px solid var(--fg-bright)', background: 'rgb(var(--accent-tft-rgb) / 12%)' }
    : { border: '1.5px dashed var(--fg-faint)', background: 'transparent' };
}

// Sechseck-Maske fuer Champion-Portraits (Builder-Brett, Comp-Uebersicht).
export const HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';
