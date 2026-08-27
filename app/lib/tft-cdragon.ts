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

import { renderTraitDesc } from './tft-trait-desc';
import { CDRAGON_GAME_BASE } from './cdragon-base';

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
  // Per-locale name + desc from CDragon's localised TFT bundles.
  // Built by scripts/fetch-tft-assets.mjs from {de,en,ko,zh,es,fr}_<region>.json.
  i18n?: Partial<Record<'de' | 'en' | 'ko' | 'zh' | 'es' | 'fr', { name: string; desc: string }>>;
}

/** Pick the augment's localised name+desc; falls back to en, then top-level fields. */
export function tftAugmentLocalised(
  a: TftAugment | null | undefined,
  lang: 'de' | 'en' | 'ko' | 'zh' | 'es' | 'fr',
): { name: string; desc: string } {
  if (!a) return { name: '', desc: '' };
  const loc = a.i18n?.[lang];
  if (loc && (loc.name || loc.desc)) return { name: loc.name || a.name, desc: loc.desc || a.desc || '' };
  const en = a.i18n?.en;
  if (en) return { name: en.name || a.name, desc: en.desc || a.desc || '' };
  return { name: a.name, desc: a.desc || '' };
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
    // /tft/augments wiki catalog. God-Augments waren eine Set-17-Mechanik und
    // sind dort bewusst ausgeschlossen; ab Set 18 laeuft der Filter ins Leere.
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

// Riots interne apiName-Suffixe weichen für manche Sets vom in-Game Display
// ab. Beispiel Stargazer-Constellations: TFT17_Stargazer_Wolf zeigt im Spiel
// als "The Boar", _Shield als "The Altar". Der ECHTE Variant-Name steht im
// trait.desc als "This game: The <Variant>." Patterne den raus statt blind
// den apiName-Suffix zu nehmen.
function variantFromDesc(desc: string | undefined | null): string | null {
  if (!desc) return null;
  // Riot schreibt "This game: The Mountain" (Punkt-frei, direkt anschließender
  // Effekt-Text) oder "This game: The Boar." (mit Punkt). Pattern matched 1-2
  // Title-Case-Wörter — egal ob mit/ohne Satzzeichen davor.
  const m = /This game:\s*The\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/.exec(desc);
  if (!m) return null;
  return m[1].trim();
}

// Set-Praefix vor dem eigentlichen Trait-Token. Riot hat die Konvention pro
// Set mehrfach gewechselt: TFT17_Stargazer_Wolf, Set17_CarouselMarket_...,
// und ab Set 18 DA_18_Blossom bzw. DA_Juggernaut18. Ohne den DA_-Zweig lief
// der Fallback unten in den eigenen Namen: DA_18_Blossom → "Blossom · 18 Blossom".
const TRAIT_API_PREFIX_RE = /^(?:TFT\d+|Set\d+|DA)_(?:\d+_)?/;

// Zieht den Varianten-Teil aus dem apiName — oder null, wenn es gar keine
// Variante ist. `null` heisst: nur den Basisnamen anzeigen.
function variantFromApiName(apiName: string, base: string): string | null {
  const stripped = apiName.replace(TRAIT_API_PREFIX_RE, '');
  if (!stripped.includes('_')) return null;
  // Nachgestellte Set-Nummer (DA_Juggernaut18) gehoert nicht in die Anzeige.
  const variant = stripped.split('_').slice(1).join(' ').replace(/\d+$/, '').trim();
  if (!variant) return null;
  if (variant.toLowerCase() === base.toLowerCase()) return null;
  // "UniqueTrait" ist ein Riot-Marker fuer Champion-eigene Traits, kein Name.
  if (/^UniqueTrait$/i.test(variant)) return null;
  return variant;
}

// Returnt den Display-Name eines Traits inkl. Variante. Beispiele:
//   TFT17_Stargazer_Wolf      →  "Stargazer · Boar"     (aus desc)
//   TFT17_Stargazer_Shield    →  "Stargazer · Altar"    (aus desc)
//   TFT17_Stargazer_Mountain  →  "Stargazer · Mountain" (auch aus desc)
//   TFT17_Stargazer           →  "Stargazer"            (Base, kein Variant)
// Riot modelliert Multi-Variant-Familien als separate Traits mit demselben
// `name`-Feld; die Variante steht im trait.desc ("This game: The X."). Fällt
// die desc-Erkennung aus (alte Set-Bundles ohne diese Konvention), greift der
// apiName-Suffix als Fallback.
export function tftTraitDisplayName(
  bundle: TftAssetsBundle | null,
  apiName: string | null | undefined,
): string {
  if (!apiName) return '';
  const trait = findTrait(bundle, apiName);
  const base = trait?.name || apiName.replace(TRAIT_API_PREFIX_RE, '');
  // 1) Variante aus desc (authoritativ — matched In-Game-Anzeige)
  const descVariant = variantFromDesc(trait?.desc);
  if (descVariant && descVariant.toLowerCase() !== base.toLowerCase()) {
    return `${base} · ${descVariant}`;
  }
  // 2) Fallback: apiName-Suffix
  const variant = variantFromApiName(apiName, base);
  return variant ? `${base} · ${variant}` : base;
}

// Returnt den Tooltip-Text für einen Trait — nimmt die variant-spezifische
// Beschreibung aus trait.desc, ohne den generischen "Stargazers chart a
// different constellation"-Boilerplate. Template-Variablen wie @MinUnits@,
// @VarName@, %i:icon%, @TFTUnitProperty.trait:X@ werden via renderTraitDesc()
// substituiert — sonst sieht der User Roh-Tokens im Tooltip statt sauberen
// Text (Bug-Report 2026-06-20).
export function tftTraitDescription(
  bundle: TftAssetsBundle | null,
  apiName: string | null | undefined,
): string {
  if (!apiName) return '';
  const trait = findTrait(bundle, apiName);
  if (!trait?.desc) return '';

  // Stargazer-Preamble + "This game: The X." raus, BEVOR HTML strippt — damit
  // die Regex auf dem Original-Format matcht. Setzt einen variant-spezifischen
  // Body, sonst den vollen desc.
  let raw = trait.desc;
  const m = /This game:\s*The\s+[A-Za-z][A-Za-z\s]*?[.!]\s*([\s\S]+)$/i.exec(raw);
  if (m) raw = m[1].trim();

  // HTML-Tags strippen, damit renderTraitDesc nicht durch <b>/<br>/etc. irritiert
  // wird (es operiert auf Klartext + Riot-Tokens).
  const stripped = raw.replace(/<[^>]+>/g, '');

  // renderTraitDesc nutzt das volle traitMeta um die Tier-Variablen zu binden.
  // Wir übergeben ein "synthetisches" desc-only-Meta mit gestrippter Variante,
  // aber den ORIGINAL-Tier-Variablen aus dem Bundle, damit @VarName@-Lookups
  // funktionieren.
  const rendered = renderTraitDesc({
    name: trait.name || '',
    apiName,
    desc: stripped,
    tiers: trait.tiers as any,
  });

  // Tooltip-Format: General-Desc + Tier-Breakpoints zeilenweise. Falls keine
  // Tier-Texte (rare, z.B. Innate-only Traits), fällt auf General zurück.
  const parts: string[] = [];
  if (rendered.generalDesc) parts.push(rendered.generalDesc);
  for (const tier of rendered.tiers) {
    parts.push(`(${tier.minUnits}) ${tier.text}`);
  }
  return parts.join('\n') || stripped;
}

// Set-aware Emblem-Detection. Set-17-Emblems folgen dem Pattern
// `^TFT<set>_Item_.+EmblemItem$` (verifiziert 2026-06-20: 19 Treffer in
// Set 17, kein False-Positive). Bei Set 18 zieht der Bundle-`set`-Field
// das Pattern transparent nach.
export function tftIsEmblem(
  bundle: TftAssetsBundle | null,
  apiName: string | null | undefined,
): boolean {
  if (!bundle || !apiName) return false;
  const set = bundle.set;
  return new RegExp(`^TFT${set}_Item_.+EmblemItem$`).test(apiName);
}

// Returnt einen Mouse-Over-Tooltip-Text für einen Champion. Format:
// "<Ability-Name> — <gestrippte Desc>". Strippt @VarName@ / %i:icon% /
// {{TFT_*_*}} / HTML-Tags analog zur Trait-Tooltip-Logik. Returnt leeren
// String wenn kein Champion / keine Ability.
export function tftChampionTooltip(
  bundle: TftAssetsBundle | null,
  characterId: string | null | undefined,
): string {
  if (!bundle || !characterId) return '';
  const ch = bundle.champions[characterId];
  const ability = (ch as any)?.ability;
  if (!ability) return '';
  const abilityName: string = ability.name || ch?.name || '';
  let body: string = ability.desc || '';
  if (!body) return abilityName;
  // HTML-Tags raus (Riot streut <br>, <b>, <font color="…"> ein).
  body = body.replace(/<[^>]+>/g, '');
  // Inline-Refs wie {{TFT17_SpaceGroove_TheGroove}} → "The Groove".
  body = body.replace(/\{\{[A-Z]+\d*_[\w]+(?:_([\w]+))?\}\}/g, (_full, lastSeg) => {
    const seg = lastSeg as string | undefined;
    if (!seg) return '';
    return seg.replace(/([a-z])([A-Z])/g, '$1 $2');
  });
  // @TFTUnitProperty.…@ raus (cross-unit/-item Stats die wir nicht resolven können).
  body = body.replace(/@TFTUnitProperty\.[^@]*@%?/g, '');
  // %i:scaleHealth% etc. — kurze Labels analog renderTraitDesc.
  const icons: Record<string, string> = {
    scaleHealth: 'Health', scaleAS: 'AS', scaleAD: 'AD', scaleAP: 'AP',
    scaleArmor: 'Armor', scaleMR: 'MR', scaleMana: 'Mana', scaleCrit: 'Crit',
    scaleDodge: 'Dodge', scaleHeal: 'Heal', scaleShield: 'Shield',
    scaleHPRegen: 'HP Regen',
  };
  body = body.replace(/%i:([\w]+)%/g, (_full, icon) => icons[icon] || '');
  // Restliche unresolvte @Var@-Tokens entfernen (Werte sind level-/star-
  // abhängig und ohne Variables nicht ableitbar).
  body = body.replace(/@[\w.:]+\*?\d*@/g, '');
  // Whitespace + verwaiste Punktuation
  body = body.replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
  return abilityName ? `${abilityName} — ${body}` : body;
}

// Resolve a CommunityDragon icon path to a full URL. The bundle stores
// paths like "assets/maps/tft/icons/items/hexcore/tft_item_bluebuff.tft_set13.png"
// which combine with the bundle's iconBase to a working raw.communitydragon.org URL.
// Full https URLs pass through verbatim (safety net in case any future override
// pipeline writes them directly).
export function tftIconUrl(bundle: TftAssetsBundle | null, iconPath: string | null | undefined): string | null {
  if (!bundle || !iconPath) return null;
  if (isNonPath(iconPath)) return null;
  if (iconPath.startsWith('http://') || iconPath.startsWith('https://')) return iconPath;
  return proxied(bundle.iconBase, iconPath);
}

// 10 Bundle-Eintraege tragen woertlich den String "none" statt eines Pfades
// (TFT_ArmoryKeyCompleted, TFT17_PVE_Krug, …). Bisher endete das in einem
// 404 bei CommunityDragon — harmlos. Ueber den Proxy waere `/api/img/none`
// dagegen ein Request auf den eigenen Origin, der nicht auf `.png` endet und
// damit durch den Middleware-Matcher laeuft: ein Supabase-Auth-Roundtrip pro
// kaputtem Icon. Hier abfangen, nicht dort.
function isNonPath(iconPath: string): boolean {
  return iconPath.toLowerCase() === 'none';
}

// Einzige Stelle, an der aus Base + Pfad eine Bild-URL wird — bewusst EIN
// Helper fuer beide oeffentlichen Funktionen, damit die Umschreibung nicht
// an zwei Orten driften kann.
//
// Die Umschreibung passiert hier zur Laufzeit und NICHT in `iconBase` selbst
// (scripts/fetch-tft-assets.mjs): dasselbe payload-Objekt landet auch im
// Set-Archiv `public/tft-assets-{set}.json`, das beim Set-Bump einfriert. Eine
// dort eingebackene `/api/img/`-Base waere origin-abhaengig und nicht mehr
// zurueckzunehmen; so bleibt das Bundle eine reine Datenquelle mit absoluten
// URLs, die auch ein Nicht-Browser-Leser aufloesen kann.
//
// Rollback: NEXT_PUBLIC_TFT_IMG_PROXY=off + Redeploy. Das Flag wird in die
// Client-Bundles eingebacken, ist also kein Laufzeit-Schalter — der Rollback
// kostet einen Deploy, keinen Daten-Rerun.
function proxied(base: string, path: string): string {
  if (process.env.NEXT_PUBLIC_TFT_IMG_PROXY === 'off') return base + path;
  if (base !== CDRAGON_GAME_BASE) return base + path;
  return '/api/img/' + path;
}

// Fuer handgebaute Game-Pfade, die nicht aus dem Bundle stammen. Es gibt genau
// einen Leser: den Fallback-Square auf /tft/compare, der greift solange das
// Bundle noch laedt. Ohne diesen Helper baut die Seite die absolute URL selbst
// und laeuft am Proxy vorbei -- und zwar ausgerechnet beim ersten Render, weil
// `assets` dort noch null ist. Wer einen Game-Pfad von Hand baut, nimmt das
// hier statt CDRAGON_GAME_BASE direkt.
export function tftGameAssetUrl(path: string): string {
  return proxied(CDRAGON_GAME_BASE, path);
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
  if (champion.tile && !isNonPath(champion.tile)) return proxied(bundle.iconBase, champion.tile);
  if (!champion.icon) return null;
  const m = /^assets\/characters\/([^/]+)\/skins\/base\/images\/[^/]+_splash_centered_\d+\.([^/.]+)\.png$/i.exec(champion.icon);
  if (!m) return tftIconUrl(bundle, champion.icon);
  return proxied(bundle.iconBase, `assets/characters/${m[1]}/hud/${m[1]}_square.${m[2]}.png`);
}

// Companion-Icons (Chibis + Tacticians) lagen in einem eigenen CD-Namespace.
// Der einzige Konsument war die alte TFT-Kopfzone; seit sie Set-Splashes zeigt,
// liest niemand mehr companionsIconBase. Die Felder chibis/tacticians bleiben im
// Bundle stehen (fetch-tft-assets.mjs liefert sie weiter aus) -- wer sie wieder
// braucht, baut die URL-Ableitung mit ihrem Konsumenten zusammen neu auf, statt
// eine Funktion ohne Leser zu pflegen.
