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

// Core/Flex-Ring um eine Unit-Kachel (Comp-Liste + Comp-DNA, User 2026-10-10):
// innen bleibt die Kostenfarbe, aussen ein heller Ring — durchgezogen = Core,
// gestrichelt = Flex. outline verschiebt nichts; 1 px Abstand, damit der Ring
// nicht mit dem grauen 1-Kosten-Rahmen verschmilzt. Kein Ring ohne Einteilung.
export function coreFlexRing(kind: 'core' | 'flex' | null | undefined): { outline: string; outlineOffset: string } | undefined {
  if (!kind) return undefined;
  return { outline: `1.5px ${kind === 'core' ? 'solid' : 'dashed'} var(--fg-bright)`, outlineOffset: '1px' };
}

// Sechseck-Maske fuer Champion-Portraits (Builder-Brett, Comp-Uebersicht).
export const HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';
