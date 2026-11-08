// Set-Kopfdaten fuer die TFT-Spielerseite (TftPlayerClient), einmal je Seite
// geladen. Die frueheren Data-Dragon-Lader (Champions, Traits, Items, Augments,
// TFT_IMG_BASE) hatten keinen Aufrufer mehr und sind am 08.11.2026 entfallen —
// Spieldaten kommen aus dem CDragon-Bundle (tft-cdragon.ts).

interface TftSetMeta {
  setNumber: number;
  setName: string;
  mutator: string;
  latestPatch: string;
}

let setMetaPromise: Promise<TftSetMeta | null> | null = null;

export function loadTftSetMeta(): Promise<TftSetMeta | null> {
  if (!setMetaPromise) {
    setMetaPromise = fetch('/tft-set.json')
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => d ? {
        setNumber: d.setNumber,
        setName: d.setName,
        mutator: d.mutator,
        latestPatch: d.latestPatch,
      } : null)
      .catch(() => null);
  }
  return setMetaPromise;
}
