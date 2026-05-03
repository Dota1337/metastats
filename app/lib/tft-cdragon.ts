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
export interface TftTrait {
  name: string;
  icon: string | null;
  desc?: string;
  innate?: string;
}
export interface TftAugment {
  name: string;
  icon: string | null;
  desc?: string;
  tier: number;
}

export interface TftAssetsBundle {
  set: number;
  setName: string;
  mutator: string;
  fetchedAt: string;
  iconBase: string;
  items: Record<string, TftItem>;
  champions: Record<string, TftChampion>;
  traits: Record<string, TftTrait>;
  augments: Record<string, TftAugment>;
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
