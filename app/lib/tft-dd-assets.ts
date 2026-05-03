// Cached client-side loaders for TFT static data. Each fetch returns the same
// Promise across components for a given Data Dragon version, so a page that
// renders dozens of unit/item/augment cards triggers each network call once.
//
// Source: Riot Data Dragon (`/cdn/{version}/data/{lang}/tft-*.json`).

export interface TftChampion {
  id: string;        // e.g. "TFT17_Vex"
  name: string;
  cost: number;
  traits: string[];
  image: { full: string };
}

export interface TftTrait {
  id: string;
  key: string;
  name: string;
  description?: string;
  innate?: string;
  image: { full: string };
}

export interface TftItem {
  id: number;        // e.g. 3031
  name: string;
  description?: string;
  image: { full: string };
  composition?: number[];
  tags?: string[];
}

export interface TftAugment {
  apiName: string;   // e.g. "TFT17_Augment_Stuff"
  name: string;
  desc?: string;
  tier: number;      // 1 = silver, 2 = gold, 3 = prismatic
  image?: { full: string };
}

interface TftSetMeta {
  setNumber: number;
  setName: string;
  mutator: string;
  latestPatch: string;
}

const championCache: Record<string, Promise<Record<string, TftChampion>>> = {};
const traitCache:    Record<string, Promise<Record<string, TftTrait>>>     = {};
const itemCache:     Record<string, Promise<Record<number, TftItem>>>      = {};
const augmentCache:  Record<string, Promise<Record<string, TftAugment>>>   = {};
let setMetaPromise: Promise<TftSetMeta | null> | null = null;

const DD_BASE = 'https://ddragon.leagueoflegends.com';

function cacheKey(version: string, lang: string) { return `${version}|${lang}`; }

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

export function loadTftChampions(version: string, lang = 'en_US'): Promise<Record<string, TftChampion>> {
  const k = cacheKey(version, lang);
  if (!championCache[k]) {
    championCache[k] = fetch(`${DD_BASE}/cdn/${version}/data/${lang}/tft-champion.json`)
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => {
        const out: Record<string, TftChampion> = {};
        for (const c of Object.values(d?.data || {}) as any[]) {
          out[c.id] = {
            id: c.id, name: c.name, cost: c.tier ?? c.cost ?? 0,
            traits: c.traits || [], image: c.image,
          };
        }
        return out;
      })
      .catch(() => ({}));
  }
  return championCache[k];
}

export function loadTftTraits(version: string, lang = 'en_US'): Promise<Record<string, TftTrait>> {
  const k = cacheKey(version, lang);
  if (!traitCache[k]) {
    traitCache[k] = fetch(`${DD_BASE}/cdn/${version}/data/${lang}/tft-trait.json`)
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => {
        const out: Record<string, TftTrait> = {};
        for (const t of Object.values(d?.data || {}) as any[]) {
          out[t.id] = {
            id: t.id, key: t.key || t.id, name: t.name,
            description: t.description, innate: t.innate, image: t.image,
          };
        }
        return out;
      })
      .catch(() => ({}));
  }
  return traitCache[k];
}

export function loadTftItems(version: string, lang = 'en_US'): Promise<Record<number, TftItem>> {
  const k = cacheKey(version, lang);
  if (!itemCache[k]) {
    itemCache[k] = fetch(`${DD_BASE}/cdn/${version}/data/${lang}/tft-item.json`)
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => {
        const out: Record<number, TftItem> = {};
        for (const i of Object.values(d?.data || {}) as any[]) {
          out[Number(i.id)] = {
            id: Number(i.id), name: i.name, description: i.description,
            image: i.image, composition: i.from || i.composition, tags: i.tags,
          };
        }
        return out;
      })
      .catch(() => ({}));
  }
  return itemCache[k];
}

export function loadTftAugments(version: string, lang = 'en_US'): Promise<Record<string, TftAugment>> {
  const k = cacheKey(version, lang);
  if (!augmentCache[k]) {
    augmentCache[k] = fetch(`${DD_BASE}/cdn/${version}/data/${lang}/tft-augments.json`)
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => {
        const out: Record<string, TftAugment> = {};
        for (const a of Object.values(d?.data || {}) as any[]) {
          out[a.apiName || a.id] = {
            apiName: a.apiName || a.id, name: a.name, desc: a.desc,
            tier: a.tier ?? a.augmentTier ?? 0, image: a.image,
          };
        }
        return out;
      })
      .catch(() => ({}));
  }
  return augmentCache[k];
}

export const TFT_IMG_BASE = `${DD_BASE}/cdn`;
