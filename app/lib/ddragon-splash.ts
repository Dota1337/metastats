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
//   - `TFT17_IvernMinion` (Meepsie) sieht aufloesbar aus, ist es aber nicht:
//     die Ableitung liefert `IvernMinion_27.jpg`, und die URL antwortet mit
//     403. Sie steht deshalb in `KNOWN_MISSING`. (Ein frueherer Kommentar hier
//     behauptete, Meepsie falle „ueber null aus dem Pool" — das stimmte nur so
//     lange, wie der Pool auf 5 Kosten beschraenkt war und Meepsie mit seinen
//     2 Kosten gar nicht erst betrachtet wurde.) Jeder Aufrufer muss `null`
//     und `onError` trotzdem verkraften, statt ein Loch zu lassen.
//
// Set-18-Schutz: der Pool kommt zur Laufzeit aus dem Asset-Bundle, nicht aus
// einer Liste hier. Bricht die Ableitung fuer eine neue Einheit, faellt sie
// still aus dem Pool statt die Kopfzone zu leeren.

import type { TftAssetsBundle, TftChampion } from './tft-cdragon';

// Die ddragon-ID kommt aus dem **apiName**, nicht aus dem Icon-Pfad. Der
// apiName traegt die Original-Schreibweise (`TFT17_MissFortune`), die exakt der
// ddragon-ID entspricht; der Icon-Dateiname ist kleingeschrieben und braeuchte
// eine handgepflegte Ausnahmeliste, die beim naechsten Set still bricht.
// Gegen ddragon 16.15.1 ueber alle 63 spielbaren Set-17-Einheiten geprueft:
// aufloesbar sind alle ausser `TFT17_IvernMinion` und `TFT17_Rhaast` — beide
// haben gar keinen ddragon-Champion und fallen ueber `null` aus dem Pool.
//
// Set-Praefix bewusst als \d+ statt hart 17 — sonst ist der naechste
// Set-Bump ein stiller Totalausfall (vgl. Gate 6 gegen `|| 17`-Literale).
// Set 18 bricht die Namenskonvention: die apiNames heissen `DA_18_LeBlanc`,
// `DA_Amumu18` oder `DA_KogMaw18_AD` statt `TFT17_Kaisa`. Das alte Muster
// traf davon keinen einzigen — gemessen am 2026-08-26 gegen ddragon: 0 von
// 91 Set-18-Einheiten aufloesbar, die Kopfzone waere leer geblieben.
//
// Drei Regeln, alle gegen Set 17 UND Set 18 nachgemessen:
//   1. Praefix `TFT<n>[b]_` ODER `DA_`, jeweils optional gefolgt von `<n>_`.
//   2. Nur das erste Segment zaehlt — ddragon-IDs enthalten nie einen
//      Unterstrich, `_AD`/`_AP`/`_Base`/`_Fae` sind Set-Varianten derselben
//      Einheit (`DA_18_MasterYi_AD` -> MasterYi).
//   3. Angehaengte Set-Nummer abschneiden (`Amumu18` -> Amumu); kein
//      ddragon-Champion endet auf einer Ziffer.
// Ergebnis: Set 17 unveraendert 56 Set-Skins, Set 18 41 statt 0.
const API_PREFIX_RE = /^(?:tft\d+b?|da)_(?:\d+_)?/i;

// ddragon schreibt ein paar IDs anders als das TFT-Bundle. Nur gemessene
// Faelle stehen hier: `DA_18_LeBlanc` -> Leblanc_5 loest auf, LeBlanc_5 nicht.
const DDRAGON_ID_ALIAS: Record<string, string> = { LeBlanc: 'Leblanc', KhaZix: 'Khazix', KaiSa: 'Kaisa', VelKoz: 'Velkoz', ChoGath: 'Chogath', BelVeth: 'Belveth' };

// Aus dem apiName die ddragon-Champion-ID ableiten. Leerstring, wenn nichts
// uebrig bleibt — der Aufrufer macht daraus `null`.
function ddragonChampionId(apiName: string): string {
  const base = apiName.replace(API_PREFIX_RE, '').split('_')[0].replace(/\d+$/, '');
  return DDRAGON_ID_ALIAS[base] || base;
}

// Aus dem Icon-Pfad wird nur noch **eins** gelesen: die Skin-Nummer.
const SKIN_NUM_RE = /_(\d+)\.png$/;

// Set-Skins, die ddragon nicht ausliefert (403, nicht 404 — wer auf 404 prueft,
// haelt die URL fuer gueltig). Gemessen gegen ddragon 16.15.1.
// Diese Liste ist ein Zwischenstand: sobald der Pool zur Buildzeit erzeugt und
// per HEAD validiert wird, faellt sie ersatzlos weg.
const KNOWN_MISSING = new Set([
  'Blitzcrank_65', 'IvernMinion_27',
  // Set 18, am 2026-08-26 per HEAD gemessen: die Ableitung liefert eine
  // plausible URL, ddragon antwortet 403. Kobuko und Alune haben gar keinen
  // LoL-Champion, Fiddlesticks hat keinen Skin 46.
  'Fiddlesticks_46', 'Kobuko_2', 'Alune_15',
]);

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
  const championId = ddragonChampionId(apiName);
  if (!championId) return null;

  const file = String(champ.icon || '').split('/').pop() ?? '';
  const skinNum = file.match(SKIN_NUM_RE)?.[1] ?? '0';
  if (KNOWN_MISSING.has(`${championId}_${skinNum}`)) return null;

  return {
    url: `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championId}_${skinNum}.jpg`,
    championId,
    skinNum,
    isBaseSkin: skinNum === '0',
  };
}

export interface TftHeroUnit {
  apiName: string;
  name: string;
  cost: number;
  splash: TftSplash;
}

/**
 * Bildpool fuer die Kopfzone: alle spielbaren Einheiten des laufenden Sets.
 *
 * Die Auswahl ist bewusst **rein sachlich** — Spielbarkeit und ein
 * aufloesbares Set-Bild, nie Win- oder Pick-Rate. Ein nach Leistung sortierter
 * Bildpool waere eine implizite Tier-Aussage ohne Datengrundlage.
 *
 * **Warum kein Kostenfilter mehr:** bis 2026-08-22 stand hier `cost = 5`. Das
 * ergab einen Pool von 8 Einheiten fuer 18 Routen — Fiora und Graves landeten
 * auf je 6 von 18 Reitern, der Wiedererkennungswert kippte in „immer dasselbe
 * Bild". Ohne den Filter sind es 56, und kein Champion steht mehr als zweimal
 * auf den 36 Bildplaetzen. Kosten ist in TFT eine Shop-Odds-Mechanik und keine
 * Guete-Aussage; ein Pool aus nur 4/5-Kosten waere die staerkere implizite
 * Tier-Aussage gewesen, weil Reroll-Comps auf 1- und 2-Kosten genauso
 * set-tragend sind.
 *
 * Bewusst KEINE Kuratierung nach Bild-Thema: Set 17 vergibt gar keine eigene
 * Bemalung, sondern recycelt bestehende LoL-Skins — auch der alte 5-Kosten-Pool
 * enthielt mit `Fiora_51` (Prestige Lunar Beast) und `Graves_18` (Praetorian)
 * schon Off-Theme-Bilder. Eine Themenliste waere eine neue, subjektive Achse,
 * die bei jedem Set von Hand nachgezogen werden muesste.
 *
 * Grundskins fliegen raus: ein Bild ohne Set-Bemalung ist je nach Champion
 * Artwork aus den 2010ern und faellt zwischen aktuellen Set-Bildern sofort auf.
 * Lieber ein Bild weniger im Pool als ein sichtbar fremdes.
 */
export function tftHeroUnitPool(bundle: TftAssetsBundle | null): TftHeroUnit[] {
  if (!bundle?.champions) return [];
  const out: TftHeroUnit[] = [];
  for (const [apiName, champ] of Object.entries(bundle.champions)) {
    if (!Array.isArray(champ.traits) || champ.traits.length === 0) continue;
    if (NON_PLAYABLE_RE.test(apiName)) continue;
    const splash = tftSplashUrl(apiName, champ);
    if (!splash || splash.isBaseSkin) continue;
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
  return pool[hashSeed(seed) % pool.length];
}

/**
 * Zwei **verschiedene** Einheiten fuer eine zweiseitige Kopfzone.
 *
 * Bewusst nicht zweimal `pickForSeed` mit unterschiedlichem Seed: das trifft
 * bei acht Bildern in rund jedem achten Fall zweimal denselben Champion, und
 * genau der Fall faellt auf. Gezogen wird stattdessen aus der Menge der
 * geordneten Paare (n*(n-1) Stueck), in der Dopplungen gar nicht vorkommen.
 */
export function pickPairForSeed<T>(pool: T[], seed: string): [T, T] | null {
  if (pool.length < 2) return null;
  const n = pool.length;
  const idx = hashSeed(seed) % (n * (n - 1));
  const left = Math.floor(idx / (n - 1));
  const off = idx % (n - 1);
  // `off` ueberspringt `left`, damit rechts nie dasselbe Bild steht.
  const right = off >= left ? off + 1 : off;
  return [pool[left], pool[right]];
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
