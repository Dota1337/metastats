// Knopf in den Einstellfenstern der Filterleiste (Level/Platz/Brett, Bausteine):
// an = Akzent. Patch/Region/Rang nutzen seit 25.10.2026 Menuezeilen (ExplorerScope).
export const seg = (on: boolean) =>
  `px-2 py-0.5 rounded text-xs border ${on ? 'bg-accent-a20 border-accent-a50 text-fg-bright' : 'border-border-subtle text-fg-secondary hover:text-fg-primary'}`;
