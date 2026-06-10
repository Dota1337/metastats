// Frontend loader for the CommunityDragon-sourced TFT asset bundle.
// Replaces the old loaders that pulled tft-champion.json / tft-item.json
// from Data Dragon — DD's TFT data is set-13-era and uses internal item
// IDs that don't match Match-V1's apiName scheme. The bundle is built
// by scripts/fetch-tft-assets.mjs and lives at public/tft-assets.json.
//
// Lookup keys come straight from Match-V1:
//   item apiName  e.g. "TFT_Item_BlueBuff", "TFT17_Item_StargazerEmblem"
//   champion id   e.g. "TFT17_Aatrox", "TFT17_Vex"
//   trait apiName e.g. "TFT17_APTrait"
//   augment apiName e.g. "TFT17_Augment_Stuff"

export interface TftItem {
  name: string;
  icon: string | null;
  desc?: string;
  composition?: string[];
  tags?: string[];
}
export interface TftChampion {
  name: string;
  icon: string | null;
  tile?: string | null;   // Riot's square HUD tile (CD `tileIcon`); icon is the wide splash
  cost: number;
  traits: string[];
  ability?: { name: string; desc: string };
}
export interface TftTraitTier {
  minUnits: number;
  maxUnits: number | null;
  style: number;                              // 1=bronze 3=silver 4=gold 5=prismatic
  variables: Record<string, number>;
}
export interface TftTrait {
  name: string;
  icon: string | null;
  desc?: string;
  innate?: string;
  tiers?: TftTraitTier[];
}
export interface TftAugment {
  name: string;
  icon: string | null;
  desc?: string;
  tier: number;
}

// Chibi-Champions (TFT-only premium companions) and Tacticians (Little Legends).
// Built from CommunityDragon's companions.json — see scripts/fetch-tft-assets.mjs.
// Icons resolve via companionsIconBase (different namespace than item/champ icons).
export type TftRarity = 'kMythic' | 'kLegendary' | 'kPrestige' | 'kStandard';
export interface TftCompanion {
  name: string;
  icon: string | null;
  species: string;
  rarity: TftRarity;
  itemId: number;
}

export interface TftAssetsBundle {
  set: number;
  setName: string;
  mutator: string;
  fetchedAt: string;
  iconBase: string;
  companionsIconBase?: string;
  items: Record<string, TftItem>;
  champions: Record<string, TftChampion>;
  traits: Record<string, TftTrait>;
  augments: Record<string, TftAugment>;
  chibis?: Record<string, TftCompanion>;
  tacticians?: Record<string, TftCompanion>;
  active?: {
    items?: string[];
    // setData[N].augments minus God-Augments — the source of truth for the
    // /tft/augments wiki catalog. God-Augments live on /tft/gods.
    augments?: string[];
  };
}

let cached: Promise<TftAssetsBundle | null> | null = null;

export function loadTftAssets(): Promise<TftAssetsBundle | null> {
  if (!cached) {
    cached = fetch('/tft-assets.json')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
  }
  return cached;
}

// Case-insensitive Asset-Lookups. Die Match-Cache + DB-Tabellen tragen
// teils Lowercase-Varianten von IDs (z.B. `tft17_bardfollower`, von Riot
// gemixt in tiefer api), während das Asset-Bundle alle Keys in der
// kanonischen CamelCase-Form (`TFT17_BardFollower`) hat. Wer raw `assets.
// champions[id]` aufruft, kriegt undefined → leere Icons + leere Namen.
//
// Diese Helper memoize'n eine Lowercase→Original Map pro Bundle (eine
// einmalige WeakMap-Allocation), damit der Lookup O(1) bleibt.

const champByLowerCache = new WeakMap<TftAssetsBundle, Map<string, TftChampion>>();
const itemByLowerCache  = new WeakMap<TftAssetsBundle, Map<string, TftItem>>();
const traitByLowerCache = new WeakMap<TftAssetsBundle, Map<string, TftTrait>>();

function getOrBuildLowerMap<V>(
  bundle: TftAssetsBundle,
  cache: WeakMap<TftAssetsBundle, Map<string, V>>,
  source: Record<string, V>,
): Map<string, V> {
  let m = cache.get(bundle);
  if (!m) {
    m = new Map();
    for (const [key, val] of Object.entries(source)) m.set(key.toLowerCase(), val);
    cache.set(bundle, m);
  }
  return m;
}

/** Case-insensitive Champion-Lookup. Returnt null wenn nicht vorhanden. */
export function findChampion(bundle: TftAssetsBundle | null, id: string | null | undefined): TftChampion | null {
  if (!bundle || !id) return null;
  const direct = bundle.champions[id];
  if (direct) return direct;
  return getOrBuildLowerMap(bundle, champByLowerCache, bundle.champions).get(id.toLowerCase()) ?? null;
}

/** Case-insensitive Item-Lookup. */
export function findItem(bundle: TftAssetsBundle | null, id: string | null | undefined): TftItem | null {
  if (!bundle || !id) return null;
  const direct = bundle.items[id];
  if (direct) return direct;
  return getOrBuildLowerMap(bundle, itemByLowerCache, bundle.items).get(id.toLowerCase()) ?? null;
}

/** Case-insensitive Trait-Lookup. */
export function findTrait(bundle: TftAssetsBundle | null, id: string | null | undefined): TftTrait | null {
  if (!bundle || !id) return null;
  const direct = bundle.traits[id];
  if (direct) return direct;
  return getOrBuildLowerMap(bundle, traitByLowerCache, bundle.traits).get(id.toLowerCase()) ?? null;
}

// Resolve a CommunityDragon icon path to a full URL. The bundle stores
// paths like "assets/maps/tft/icons/items/hexcore/tft_item_bluebuff.tft_set13.png"
// which combine with the bundle's iconBase to a working raw.communitydragon.org URL.
// Some augment icons are stored as full https URLs (tactics.tools CDN — tier-
// correct artwork for cases where CDragon would ship the recycled wrong-tier
// icon, see scripts/refresh-augment-icons.mjs). Those pass through verbatim.
export function tftIconUrl(bundle: TftAssetsBundle | null, iconPath: string | null | undefined): string | null {
  if (!bundle || !iconPath) return null;
  if (iconPath.startsWith('http://') || iconPath.startsWith('https://')) return iconPath;
  return bundle.iconBase + iconPath;
}

// The bundle's `champion.icon` is the wide splash-centered art used on
// big surfaces (match-card units, player profile). For tight UI like the
// items-page carrier strip we want the square hud tile that metatft and
// the in-game client show.
//
// Prefer the bundle's `tile` field — Riot's authoritative `tileIcon`, correct
// even for units whose splash path breaks the `_splash_centered_N` convention
// (Jax, Diana, Galio, Blitzcrank, Summon) or whose tile lives under a different
// name entirely (Rhaast → tft17_kayn_slay_square). The old regex derivation
// could only guess the first family and silently fell back to a stretched
// splash for the rest. The regex is kept as a fallback for per-set archives
// built before `tile` was captured; `tftIconUrl(icon)` is the last resort so
// special units (TFT_BlueGolem, PVE minions) still render the wide art.
export function tftChampionTileUrl(
  bundle: TftAssetsBundle | null,
  champion: TftChampion | null | undefined,
): string | null {
  if (!bundle || !champion) return null;
  if (champion.tile) return bundle.iconBase + champion.tile;
  if (!champion.icon) return null;
  const m = /^assets\/characters\/([^/]+)\/skins\/base\/images\/[^/]+_splash_centered_\d+\.([^/.]+)\.png$/i.exec(champion.icon);
  if (!m) return tftIconUrl(bundle, champion.icon);
  return `${bundle.iconBase}assets/characters/${m[1]}/hud/${m[1]}_square.${m[2]}.png`;
}

// Companion icons (Chibis + Tacticians) live under a different CD namespace.
// Bundle stores normalized paths like "assets/loadouts/companions/tooltip_x.png".
export function tftCompanionIconUrl(bundle: TftAssetsBundle | null, iconPath: string | null | undefined): string | null {
  if (!bundle || !iconPath) return null;
  const base = bundle.companionsIconBase || 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/';
  return base + iconPath;
}
