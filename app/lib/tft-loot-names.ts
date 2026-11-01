import { LANGS } from './lang-path';
import { findChampion, findItem, type LocalizedNames, type TftAssetsBundle } from './tft-cdragon';

export interface LootTableNames {
  byApi: Record<string, LocalizedNames>;
  coven?: LocalizedNames;
}

// Die Tabellen-Ueberschriften sind Augments: deren Uebersetzung liegt in i18n, nicht in names.
function augmentNames(bundle: TftAssetsBundle, api: string): LocalizedNames | undefined {
  const augment = bundle.augments?.[api];
  if (!augment?.i18n) return undefined;
  const names: LocalizedNames = {};
  for (const lang of LANGS) {
    const name = augment.i18n[lang]?.name;
    if (lang !== 'en' && name && name !== augment.name) names[lang] = name;
  }
  return Object.keys(names).length ? names : undefined;
}

/**
 * Uebersetzungen nur fuer die Kennungen, die in den Tabellen wirklich vorkommen.
 * Die Seite bekommt damit die Namen im ersten HTML und laedt kein ganzes Bundle.
 * Alle Sprachen, weil der Sprachwechsel im Browser ohne neue Serverantwort geht.
 */
export function lootTableNames(loot: unknown, bundle: TftAssetsBundle | null, covenName?: string): LootTableNames {
  const byApi: Record<string, LocalizedNames> = {};
  if (!bundle) return { byApi };
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== 'object') return;
    const api = (value as { api?: unknown }).api;
    if (typeof api === 'string' && !byApi[api]) {
      const names = (findItem(bundle, api) ?? findChampion(bundle, api))?.names ?? augmentNames(bundle, api);
      if (names) byApi[api] = names;
    }
    Object.values(value).forEach(walk);
  };
  walk(loot);
  const coven = covenName ? Object.values(bundle.traits).find(t => t?.name === covenName)?.names : undefined;
  return coven ? { byApi, coven } : { byApi };
}
