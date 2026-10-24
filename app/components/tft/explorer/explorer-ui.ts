// Knopf in den Einstellfenstern der Filterleiste (Level/Platz/Brett und
// Patch/Region/Rang): an = Akzent. Eigene Datei, damit ExplorerScope und
// ExplorerFilters denselben Stil nutzen, ohne sich gegenseitig zu importieren.
export const seg = (on: boolean) =>
  `px-2 py-0.5 rounded text-xs border ${on ? 'bg-accent-a20 border-accent-a50 text-fg-bright' : 'border-border-subtle text-fg-secondary hover:text-fg-primary'}`;
