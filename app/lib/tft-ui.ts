// Shared TFT UI helpers. Centralizes small values that were copy-pasted across
// the TFT pages/components. Adopt incrementally: `costColor` is byte-identical
// to the local costColor / costColorOf / costToColor copies it replaces, so
// migrating a file is a pure no-visual-change swap.

// Champion cost → border/accent colour (1-cost grey … 5-cost gold).
// Kosten 0 = keine Shop-Einheit (Elderwood-Pflanzen): neutraler Rand statt des
// Golds der 5-Kosten-Units (User 18.10.2026). Als CSS-Variable — nicht in
// withAlpha() geben.
export function costColor(cost: number): string {
  return cost === 0 ? 'var(--border-default)'
    : cost === 1 ? '#9aa6b2'
    : cost === 2 ? '#3a8'
    : cost === 3 ? '#3a8ddc'
    : cost === 4 ? '#c39bff'
    : '#e0c75a';
}

// Stern-Level → Farbe wie im Spiel: 1 grau, 2 silber, 3 gold, 4 prismatisch.
// Comp-Builder-Brett und Galerie der veroeffentlichten Comps.
export function starColor(star: number): string {
  return star === 1 ? '#9aa6b2' : star === 2 ? '#cfd6dc' : star === 3 ? '#e0c75a' : '#c39bff';
}

// Core/Flex-Rahmen um eine Gruppe von Unit-Kacheln (Comp-Liste + Comp-DNA,
// User 2026-10-10: „eine Umrandung für Core und eine für Flex"): durchgezogen =
// Core, gestrichelt = Flex. Kein Rahmen ohne Einteilung. Die Boxen nutzen nur
// die Linie oben (CoreFlexGroups).
// Farbe: Core = goldene Linie + leichte Lila-Flaeche, Flex = grau gestrichelt
// ohne Flaeche. Das Lila steckt nur in der Flaeche (Variante 5, User
// 2026-10-10), damit der lila Carry-/4-Kosten-Rand der Kacheln sichtbar bleibt.
// Linie seit 19.10.2026 Gold #e0c75a, die Gold-Farbe der 5-Kosten-Raender
// (User: „ändere jetzt nur die Core Linie in Gold"). Goldene Flaechen waren
// verworfen: durchsichtig grau, fest gefaerbt „sieht nicht gut aus".
export function coreFlexFrame(kind: 'core' | 'flex' | null | undefined): { border: string; background: string } | undefined {
  if (!kind) return undefined;
  return kind === 'core'
    ? { border: '2px solid #e0c75a', background: 'rgb(var(--accent-tft-rgb) / 12%)' }
    : { border: '1.5px dashed var(--fg-faint)', background: 'transparent' };
}

// Sechseck-Maske fuer Champion-Portraits (Builder-Brett, Comp-Uebersicht).
export const HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';
