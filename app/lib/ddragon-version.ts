'use client';

import { useEffect, useState } from 'react';

// Aktuelle DataDragon-Version fuer Bild-Adressen im Browser. Ein Abruf je Tab,
// alle Komponenten teilen dasselbe Promise (Muster wie dd-assets.ts).
// Fest eingetragene Versionen veralten: neue Champions und Profilbilder
// fehlen dort (ddragon antwortet 403).

let pending: Promise<string | null> | null = null;

async function fetchVersion(url: string, pick: (d: unknown) => unknown): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const v = pick(await res.json());
  return typeof v === 'string' && v ? v : null;
}

export function getDdragonVersion(): Promise<string | null> {
  if (!pending) {
    pending = fetchVersion('/api/version', (d) => (d as { version?: unknown })?.version)
      .catch(() => null)
      // Rueckfall: direkt bei ddragon, falls die eigene Route ausfaellt.
      .then((v) => v ?? fetchVersion('https://ddragon.leagueoflegends.com/api/versions.json', (d) => (Array.isArray(d) ? d[0] : null)).catch(() => null))
      .then((v) => {
        if (!v) pending = null; // naechster Aufruf versucht es neu
        return v;
      });
  }
  return pending;
}

export function useDdragonVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getDdragonVersion().then((v) => { if (alive) setVersion(v); });
    return () => { alive = false; };
  }, []);
  return version;
}
