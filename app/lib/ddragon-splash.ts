// Set-Artwork fuer TFT-Einheiten aus dem CommunityDragon-Bundle ableiten.
//
// Hintergrund: das TFT-Bundle liefert zu jeder Einheit nur ein
// `splash_centered`-Bild in 256x128 — als Kopfzonen-Hintergrund unbrauchbar.
// Der Dateiname traegt aber die Riot-Skin-Nummer der Set-Variante:
//
//   assets/characters/tft17_kaisa/skins/base/images/tft17_kaisa_splash_centered_69.png
//                                                                              ^^ Skin 69
//
// Und genau diese Nummer adressiert bei ddragon das volle Splash in 1215x717:
//
//   https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Kaisa_69.jpg
//
// Damit bekommt die TFT-Seite dasselbe Bildmaterial wie `PageHero` auf der
// LoL-Seite, nur eben in der Set-Bemalung statt im Grundskin.
//
// Zwei Fallen, beide gemessen (Stand ddragon 16.15.1, Set 17):
//   - ddragon antwortet auf eine nicht existierende Skin-Nummer mit **403**,
//     nicht 404. Wer auf 404 prueft, haelt tote URLs fuer gueltig.
//   - `TFT17_IvernMinion` (Meepsie) hat gar keinen ddragon-Champion. Jeder
//     Aufrufer muss `null` und `onError` verkraften, statt ein Loch zu lassen.
//
// Set-18-Schutz: der Pool kommt zur Laufzeit aus dem Asset-Bundle, nicht aus
// einer Liste hier. Bricht die Ableitung fuer eine neue Einheit, faellt sie
// still aus dem Pool statt die Kopfzone zu leeren.

import type { TftAssetsBundle, TftChampion } from './tft-cdragon';

// Faelle, in denen `slug` != `kleinschreibung(ddragon-id)` ist. Alles andere
// loest ueber simple Grossschreibung des ersten Buchstabens auf.
// Ermittelt gegen ddragon 16.15.1 ueber alle 63 spielbaren Set-17-Einheiten.
const DDRAGON_ID_EXCEPTIONS: Record<string, string> = {
  missfortune: 'MissFortune',
  aurelionsol: 'AurelionSol',
  masteryi: 'MasterYi',
  twistedfate: 'TwistedFate',
  tahmkench: 'TahmKench',
  reksai: 'RekSai',
};

// Set-Praefix bewusst als \d+ statt hart 17 — sonst ist der naechste
// Set-Bump ein stiller Totalausfall (vgl. Gate 6 gegen `|| 17`-Literale).
const SLUG_RE =
  /^tft\d+b?_([a-z0-9]+?)(?:splash)?(?:_splash)?_?(?:centered|uncentered)?_?(\d+)?\.png$/;

// PvE-Gegner und Beschwoerungen tragen teils Kosten und sehen im Bundle aus
// wie regulaere Einheiten. `TFT17_Enemy_Aatrox` ("Apex Primordian") ist eine
// 5-Kosten-Einheit, die kein Spieler je aufstellt.
const NON_PLAYABLE_RE = /_(enemy|pve|minion|npc)_|^tft\d+b?_(enemy|pve)/i;

export interface TftSplash {
  url: string;
  championId: string;
  skinNum: string;
  /** true, wenn nur der Grundskin aufloest — das Bild zeigt dann nicht die Set-Bemalung. */
  isBaseSkin: boolean;
}

/**
 * Leitet die ddragon-Splash-URL fuer eine TFT-Einheit ab.
 * `null`, wenn kein ddragon-Champion dahintersteht (z.B. Meepsie).
 */
export function tftSplashUrl(apiName: string, champ: TftChampion): TftSplash | null {
  const file = String(champ.icon || '').split('/').pop()?.toLowerCase() ?? '';
  const m = file.match(SLUG_RE);
  const slug = m?.[1] ?? apiName.replace(/^TFT\d+b?_/i, '').toLowerCase();
  if (!slug) return null;

  const championId =
    DDRAGON_ID_EXCEPTIONS[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
  const skinNum = m?.[2] ?? '0';

  return {
    url: `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championId}_${skinNum}.jpg`,
    championId,
    skinNum,
    isBaseSkin: skinNum === '0',
  };
}

/** Grundbild-URL als Rueckfallebene, wenn die Set-Skin-Nummer 403 liefert. */
export function ddragonBaseSplashUrl(championId: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championId}_0.jpg`;
}

export interface TftHeroUnit {
  apiName: string;
  name: string;
  cost: number;
  splash: TftSplash;
}

/**
 * Bildpool fuer die Kopfzone: die 5-Kosten-Einheiten des laufenden Sets.
 *
 * Die Auswahl ist bewusst **rein sachlich** — Kosten und Spielbarkeit, nie
 * Win- oder Pick-Rate. Ein nach Leistung sortierter Bildpool waere eine
 * implizite Tier-Aussage ohne Datengrundlage.
 */
export function tftHeroUnitPool(bundle: TftAssetsBundle | null, cost = 5): TftHeroUnit[] {
  if (!bundle?.champions) return [];
  const out: TftHeroUnit[] = [];
  for (const [apiName, champ] of Object.entries(bundle.champions)) {
    if (champ.cost !== cost) continue;
    if (!Array.isArray(champ.traits) || champ.traits.length === 0) continue;
    if (NON_PLAYABLE_RE.test(apiName)) continue;
    const splash = tftSplashUrl(apiName, champ);
    if (!splash) continue;
    out.push({ apiName, name: champ.name, cost: champ.cost, splash });
  }
  return out.sort((a, b) => a.apiName.localeCompare(b.apiName));
}

/**
 * Deterministische Auswahl aus dem Pool ueber einen Seed (i.d.R. der Pfad).
 *
 * Bewusst nicht `Math.random()`: eine Seite soll bei jedem Besuch dasselbe
 * Bild tragen, sonst verliert sie ihren Wiedererkennungswert — und der
 * Server-Render wuerde vom Client-Render abweichen (Hydration-Mismatch).
 */
export function pickForSeed<T>(pool: T[], seed: string): T | null {
  if (pool.length === 0) return null;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return pool[Math.abs(h) % pool.length];
}
