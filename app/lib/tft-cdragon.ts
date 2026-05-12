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

// Resolve a CommunityDragon icon path to a full URL. The bundle stores
// paths like "assets/maps/tft/icons/items/hexcore/tft_item_bluebuff.tft_set13.png"
// which combine with the bundle's iconBase to a working raw.communitydragon.org URL.
export function tftIconUrl(bundle: TftAssetsBundle | null, iconPath: string | null | undefined): string | null {
  if (!bundle || !iconPath) return null;
  return bundle.iconBase + iconPath;
}

// The bundle's `champion.icon` is the wide splash-centered art used on
// big surfaces (match-card units, player profile). For tight UI like the
// items-page carrier strip we want the square hud tile that metatft and
// the in-game client show. CommunityDragon stores it next to the splash:
//   skins/base/images/<id>_splash_centered_<n>.<mutator>.png
//        →                hud/<id>_square.<mutator>.png
// Returns the square URL if the path follows the modern Set-17-style
// layout, otherwise falls back to the regular icon URL so older sets
// and special units (TFT_BlueGolem etc.) still render something.
export function tftChampionTileUrl(
  bundle: TftAssetsBundle | null,
  champion: TftChampion | null | undefined,
): string | null {
  if (!bundle || !champion?.icon) return null;
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
