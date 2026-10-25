// Knopf in den Einstellfenstern der Filterleiste (Level/Platz/Brett, Bausteine):
// an = Akzent. Patch/Region/Rang nutzen seit 25.10.2026 Menuezeilen (ExplorerScope).
// Schrift seit 25.10.2026 heller: aus fg-bright, an weiss (gewaehlt bleibt heller).
export const seg = (on: boolean) =>
  `px-2 py-0.5 rounded text-xs border ${on ? 'bg-accent-a20 border-accent-a50 text-fg-primary' : 'border-border-subtle text-fg-bright hover:text-fg-primary'}`;
