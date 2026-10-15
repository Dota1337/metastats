// Comp-Guide-Reader — Quelle ist seit 2026-08-04 MetaTFT statt tftacademy.
//
// Warum gewechselt: tftacademy pflegte redaktionell und deckte 38 Comps ab,
// 47 % unseres Volumens mit fallender Tendenz; 22 von 30 fehlenden Familien
// führte es überhaupt nicht. MetaTFT clustert automatisch aus Match-Daten und
// deckt gemessen 28 der Top-50-Familien und 70,0 % des Volumens ab. (Die
// früher hier genannten 33 / 72,9 % stammten aus einem Verifier, der Familien
// pro Trait-Level doppelt zählte — korrigiert am 2026-08-05, siehe Migration
// 0054. Der Vertrag metatft-comps/familien-abdeckung wacht seitdem darüber.)
//
// Der Import (`scripts/refresh-metatft-comps.mjs`) schreibt eine einzige Datei:
// Comps, Detail-Blöcke und die Familien-Map liegen zusammen, weil sie aus
// demselben Lauf stammen und nur gemeinsam konsistent sind — die Cluster-IDs
// tragen die MetaTFT-Generation im Präfix und wechseln geschlossen.

// Set-Nummer des Lesepfads. Kommt aus public/tft-set.json und zieht beim
// Set-Wechsel automatisch mit; der Guard in loadCompGuidesBundle meldet
// weiterhin einen Mismatch, statt still nichts anzuzeigen.
//
// Bewusst der JSON-Import und NICHT /api/tft/sets/current: diese Datei laeuft
// im Browser-Bundle, und die Route ist force-dynamic mit Supabase-RPC — ein
// 503 der Datenbank wuerde sonst den Guide-Lesepfad mitreissen.
import { CURRENT_SET } from './current-set';
import type { TftAssetsBundle } from './tft-cdragon';
import { jaccard, MERGE_MIN_JACCARD } from './tft-comp-roles';

const GUIDE_SET = CURRENT_SET;

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

/**
 * Buchstabe S-D aus MetaTFTs „Pro Augments" — die Einschaetzung EINER
 * Profi-Vorlage (team-builder-Eintraege eines Autors), die MetaTFT dem Cluster
 * per Aehnlichkeitsabstand zuordnet. KEINE Messung: Cluster mit derselben
 * Vorlage tragen Zeichen fuer Zeichen dieselbe Liste (gemessen 15.10.2026,
 * 38 Cluster, 18 Vorlagen). Deshalb seit 15.10.2026 nicht mehr angezeigt
 * (User F3) — er bestimmt nur noch die Reihenfolge hinter den Comp-eigenen
 * Augments (orderedCompAugments).
 *
 * Nicht zu verwechseln mit der Rarity (Silver/Gold/Prismatic, 1-3) aus dem
 * Asset-Bundle.
 */
export type AugmentGrade = 'S' | 'A' | 'B' | 'C' | 'D';

const GRADE_ORDER: AugmentGrade[] = ['S', 'A', 'B', 'C', 'D'];

/**
 * Wie viele Augments je Rarity-Reihe gerendert werden.
 *
 * MetaTFT liefert bis zu 97 pro Comp — das ist keine Empfehlung mehr, sondern
 * eine Liste. Ein Angebot im Spiel hat immer eine einzige Rarity, der Spieler
 * sucht also in genau einer Reihe. Früher wurde gesamt auf 12 gekappt, bevor
 * die Rarity bekannt war — das ergab fast nur Silber (385/27/3 über 38 Comps).
 */
export const AUGMENTS_PER_RARITY = 8;

export type AugmentRarity = 1 | 2 | 3;
const RARITY_ORDER: AugmentRarity[] = [3, 2, 1];

export interface CompBuild {
  unit: string;
  buildName: string[];
  count: number;
  avg: number;
}

export interface EarlyOption {
  units: string[];
  count: number | null;
  avg: number | null;
  /** Nur in alten Dateien; wird nicht gezeigt (passt nicht zu Top 4). */
  win?: number | null;
}

export interface CarouselPick {
  item: string;
  count: number | null;
  avg: number | null;
}

export interface LevelStep {
  level: number;
  stage: string;
  round: string;
  count: number | null;
}

export interface CompDetails {
  /** Early-Boards je Spielerstufe "4".."7", je Stufe Top 3. */
  earlyByLevel?: Record<string, EarlyOption[]>;
  /** Vorgaenger-Feld (nur Stufe 4), aeltere Dateien. */
  early?: EarlyOption[];
  carousel: CarouselPick[];
  levels: LevelStep[];
  // Import-only: meistgespielte Zelle je Unit (0-basiert). Nicht gerendert und
  // nicht ohne Weiteres renderbar — gemessen stehen hier 22 bis 72 Units auf
  // einem 28-Zellen-Board, also die Häufigkeitswolke aller je gespielten Units
  // und keine Aufstellung. Ein Board bräuchte eine eigene Auswahl-Logik (welche
  // ~9 Units sind final) plus Kollisionsauflösung, wenn zwei Units dieselbe
  // Zelle als Modus haben. Eigenes Feature, bewusst offen.
  positions: Record<string, { cell: number; count: number | null }>;
  rerolls: Record<string, unknown> | null;
  // `carryStars` steht weiter im Bundle, wird hier aber bewusst nicht getippt:
  // die Comp-Detail-Seite rendert dieselbe Aussage bereits als
  // `carryStarOutcome` aus unseren eigenen Match-Daten, und zwar reicher
  // (games, avgPlacement, top4Rate, top1Rate statt nur pcnt/avg) und für alle
  // Comps statt nur 59 von 69. Zwei Quellen für eine Zahl auf einer Seite wäre
  // genau der Widerspruch, den ein Nutzer als Fehler liest. Gelesen wird es
  // seit 2026-10-10 nur für die Zuordnung (guideStar3Share), nie angezeigt.
}

export interface MetaTftComp {
  id: string;
  name: string | null;
  units: string[];
  traits: string[];
  games: number;
  avgPlacement: number | null;
  /** Zentrierter Zahlenwert (beobachtet -0,21 … +0,12), KEINE Stufe. */
  difficulty: number | null;
  /** "lvl 5".."lvl 7", "Fast 8", "Fast 9", "Standard". */
  levelling: string | null;
  itemNames: string[];
  builds: CompBuild[];
  /** `tier` ist die Profi-Einschaetzung der Vorlage (siehe AugmentGrade), nicht die Rarity. */
  augments: Array<{ id: string; tier: AugmentGrade }>;
}

export interface CompGuidesBundle {
  set: number;
  source: string;
  clusterId: number;
  fetchedAt: string;
  detailsCarriedForward?: boolean;
  /** `<trait>__<carry>` -> Cluster-ID. */
  familyMap: Record<string, string>;
  comps: MetaTftComp[];
  details: Record<string, CompDetails>;
}

/** Was die UI je Comp zu sehen bekommt. */
export interface CompGuide {
  id: string;
  title: string;
  difficulty: Difficulty | null;
  levelling: string | null;
  games: number;
  /** Augment-apiNames in der Reihenfolge der Profi-Vorlage, ungekappt (Anzeige: compAugmentSections). */
  augments: string[];
  /** Aktive Traits der MetaTFT-Comp ohne Stufe (`DA_Primal18_1` -> `DA_Primal18`). */
  traits: string[];
  /** Units der MetaTFT-Comp. */
  units: string[];
  /** Spielerstufe ("4".."7") -> meistgespielte Early-Boards. */
  earlyByLevel: Record<string, EarlyOption[]>;
  carousel: CarouselPick[];
  levels: LevelStep[];
  details: CompDetails | null;
}

export interface LoadedGuides {
  bundle: CompGuidesBundle | null;
  /** Terzil-Grenzen der difficulty über alle Comps. */
  cuts: { low: number; high: number } | null;
}

let cached: Promise<LoadedGuides> | null = null;

/**
 * Lädt das Comp-Bundle. Modul-globaler Promise-Cache: die Datei wird pro
 * Seitenaufruf genau einmal geholt, auch wenn mehrere Komponenten sie
 * gleichzeitig anfragen (Comps-Liste rendert eine Zeile je Comp).
 */
export function loadCompGuidesBundle(): Promise<LoadedGuides> {
  if (!cached) {
    cached = fetch(`/tft-metatft-comps-${GUIDE_SET}.json`)
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((bundle: CompGuidesBundle | null) => {
        if (!bundle) return { bundle: null, cuts: null };
        // Set-Guard: eine Datei des falschen Sets wäre schlimmer als keine —
        // sie zeigte plausible, aber veraltete Comps.
        if (Number(bundle.set) !== GUIDE_SET) {
          console.warn(`[comp-guides] Set-Mismatch: Datei ist Set ${bundle.set}, erwartet ${GUIDE_SET}`);
          return { bundle: null, cuts: null };
        }
        return { bundle, cuts: difficultyCuts(bundle.comps) };
      });
  }
  return cached;
}

/**
 * Terzil-Grenzen der difficulty-Verteilung.
 *
 * MetaTFT liefert difficulty als zentrierten Zahlenwert, nicht als Stufe. Feste
 * Schwellen wären geraten; die Terzile teilen das Feld in drei etwa gleich
 * große Gruppen und bleiben gültig, wenn sich die Verteilung mit dem Patch
 * verschiebt.
 */
function difficultyCuts(comps: MetaTftComp[]): { low: number; high: number } | null {
  const vals = comps.map(c => c.difficulty).filter((d): d is number => typeof d === 'number').sort((a, b) => a - b);
  if (vals.length < 3) return null;
  return {
    low: vals[Math.floor(vals.length / 3)],
    high: vals[Math.floor((vals.length * 2) / 3)],
  };
}

function bucketOf(difficulty: number | null, cuts: { low: number; high: number } | null): Difficulty | null {
  if (typeof difficulty !== 'number' || !cuts) return null;
  if (difficulty <= cuts.low) return 'EASY';
  if (difficulty >= cuts.high) return 'HARD';
  return 'MEDIUM';
}

function toGuide(comp: MetaTftComp, details: CompDetails | null, cuts: LoadedGuides['cuts']): CompGuide {
  const rank = (g: AugmentGrade) => {
    const i = GRADE_ORDER.indexOf(g);
    return i < 0 ? GRADE_ORDER.length : i;
  };
  // Volle Liste, stabil nach Vorlagen-Buchstabe — gekappt wird erst je Rarity-Reihe.
  const augs = [...(comp.augments || [])]
    .sort((a, b) => rank(a.tier) - rank(b.tier));
  return {
    id: comp.id,
    title: comp.name || comp.id,
    difficulty: bucketOf(comp.difficulty, cuts),
    levelling: comp.levelling,
    games: comp.games,
    augments: augs.map(a => a.id),
    // MetaTFT fuehrt nur aktive Traits, mit Stufe als Endung (gemessen
    // 15.10.2026: alle 397 Eintraege nach dem Abschneiden in assets.traits).
    traits: (comp.traits || []).map(t => t.replace(/_\d+$/, '')),
    units: comp.units || [],
    earlyByLevel: details?.earlyByLevel
      || (details?.early?.length ? { 4: details.early } : {}),
    carousel: details?.carousel || [],
    levels: details?.levels || [],
    details,
  };
}

/** Spielweise unserer Comp fuer die Zuordnung: Anteil der Spiele mit dem Key-Carry auf 3★. */
export interface GuideStyle { carry: string; star3Share: number }

// Ab 40 % 3★ ist eine Comp Reroll (dieselbe Grenze wie tempoMeta in
// api/tft/comps/route.ts), bis 15 % klar nicht. Bewusst unter
// STAR3_SHARE_THRESHOLD (0,55, ab dem das Brett ein 3★-Abzeichen zeigt): unter
// „alle Regionen" mischen sich Spielweisen (Azir gemessen 0,51, weil VN eine
// andere Variante spielt). Fuer die Wahl der Anleitung reicht, dass die Comp
// ueberwiegend rerollt; fuer ein Abzeichen auf einer Unit nicht.
export const STYLE_REROLL_MIN = 0.4;
export const STYLE_PUSH_MAX = 0.15;
// Ueberlappung, die reicht, wenn beide Seiten denselben Carry rerollen.
export const STYLE_MATCH_MIN_JACCARD = 0.5;
// Darunter ist unser 3★-Anteil zu unsicher fuer eine Entscheidung.
export const STYLE_MIN_GAMES = 30;

/**
 * GuideStyle aus den typischen Units (star3Games / gamesWithUnit des
 * Key-Carrys). Dieselben Felder liefern Liste, Detail und App, deshalb
 * ordnen alle drei gleich zu; gemessen deckungsgleich mit carryStarOutcome
 * (Azir 2862/5628 bzw. 262/425). null ohne Felder oder unter STYLE_MIN_GAMES.
 * Der Key-Carry kommt an allen Stellen aus dem cluster_key der gezeigten Comp
 * (parseClusterKey), nicht aus dem Familien-Schluessel.
 */
export function guideStyleFromUnits(
  carry: string | null | undefined,
  units: ReadonlyArray<{ characterId: string; gamesWithUnit?: unknown; star3Games?: unknown }> | null | undefined,
): GuideStyle | null {
  if (!carry || !units) return null;
  const u = units.find(x => x.characterId === carry);
  const games = Number(u?.gamesWithUnit);
  const three = Number(u?.star3Games);
  if (!Number.isFinite(games) || !Number.isFinite(three) || games < STYLE_MIN_GAMES) return null;
  return { carry, star3Share: Math.min(1, Math.max(0, three / games)) };
}

// MetaTFTs 3★-Anteil eines Carrys in einer ihrer Comps (details.carryStars,
// bewusst nicht in CompDetails getippt, s. dort). null = keine Angabe.
function guideStar3Share(details: CompGuidesBundle['details'] | undefined, id: string, carry: string): number | null {
  const rows = (details?.[id] as { carryStars?: Record<string, Array<{ star: number; pcnt: number }>> } | undefined)
    ?.carryStars?.[carry];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.filter(r => Number(r.star) >= 3).reduce((s, r) => s + (Number(r.pcnt) || 0), 0);
}

/**
 * Unsere Comp → MetaTFT-Comp (Guide, Early Game, Stufen-Zeitpunkte).
 *
 * Die Familien-Map allein reicht nicht: gemessen 2026-10-07 zeigten 14 von 25
 * Eintraegen auf eine MetaTFT-Comp mit weniger als 70 % gemeinsamen Units, und
 * 14 von 40 Comps hatten gar keinen Eintrag (Early Game blieb leer). Deshalb
 * gilt dieselbe Schwelle wie beim Zusammenlegen zweier Familien
 * (MERGE_MIN_JACCARD): ein Treffer zaehlt nur, wenn die Units zu mindestens
 * 0,7 uebereinstimmen und ein Carry unserer Comp in der MetaTFT-Comp steht.
 * Zuerst die Familien-Map, sonst der beste Treffer ueber alle MetaTFT-Comps.
 *
 * Mehrere unserer Comps duerfen auf dieselbe MetaTFT-Comp zeigen: gemessen
 * sind das Varianten mit (fast) gleichem Brett, z. B. vier Aphelios-Comps mit
 * 0,70-0,89 Ueberlappung — fuer alle gilt dasselbe Early Game.
 *
 * Ohne Units (alte Aufrufer) bleibt es beim exakten Familien-Treffer.
 *
 * Mit `style` (wie oft unser Key-Carry 3★ ist) zaehlt zusaetzlich die
 * Spielweise: gemessen 2026-10-10 landete die Azir-Reroll-Comp unter „alle
 * Regionen" bei einer Fast-8-Comp (Jaccard 0,70 gegen 0,60), weil VN mit 32 %
 * der Spiele eine andere Tank-Variante spielt. Widersprechen sich unser und
 * MetaTFTs 3★-Anteil desselben Carrys (Reroll gegen Push), faellt der
 * Kandidat raus; sind beide Reroll, reicht eine Ueberlappung ab
 * STYLE_MATCH_MIN_JACCARD. Ohne Sterndaten bleibt es bei der alten Regel.
 * Die Familien-Map wird weiter zuerst geprueft und gilt dann ebenfalls schon
 * ab 0,5 — sie schlaegt so einen anderen Treffer mit hoeherer Ueberlappung.
 */
export function resolveGuideId(
  bundle: Pick<CompGuidesBundle, 'familyMap' | 'comps'> & { details?: CompGuidesBundle['details'] },
  familyKeys: string[],
  units: string[],
  carries: string[],
  style?: GuideStyle | null,
): string | null {
  if (units.length === 0) {
    for (const k of familyKeys) if (bundle.familyMap[k]) return bundle.familyMap[k];
    return null;
  }
  const own = new Set(units);
  const fits = (c: MetaTftComp | undefined): number => {
    if (!c || !carries.some(x => c.units.includes(x))) return -1;
    let min = MERGE_MIN_JACCARD;
    const theirs = style ? guideStar3Share(bundle.details, c.id, style.carry) : null;
    if (style && theirs != null) {
      const oursReroll = style.star3Share >= STYLE_REROLL_MIN;
      const oursPush = style.star3Share <= STYLE_PUSH_MAX;
      if ((oursReroll && theirs <= STYLE_PUSH_MAX) || (oursPush && theirs >= STYLE_REROLL_MIN)) return -1;
      if (oursReroll && theirs >= STYLE_REROLL_MIN) min = STYLE_MATCH_MIN_JACCARD;
    }
    const j = jaccard(own, new Set(c.units));
    return j >= min ? j : -1;
  };
  for (const k of familyKeys) {
    const id = bundle.familyMap[k];
    if (id && fits(bundle.comps.find(c => c.id === id)) >= 0) return id;
  }
  let best: { id: string; j: number; games: number } | null = null;
  for (const c of bundle.comps) {
    const j = fits(c);
    if (j < 0) continue;
    if (!best || j > best.j || (j === best.j && c.games > best.games)) best = { id: c.id, j, games: c.games };
  }
  return best?.id ?? null;
}

/**
 * Familie → Guide. `parts` kommt aus dem cluster_key der Comp-Seite, `units`
 * sind die typischen Units der Comp, `carries` die erkannten Carries
 * (Abgleich siehe resolveGuideId).
 */
export function findCompGuide(
  loaded: LoadedGuides | null,
  parts: { trait: string; carry: string } | null,
  units: string[] = [],
  carries: string[] = [],
  style: GuideStyle | null = null,
): { slug: string; guide: CompGuide } | null {
  if (!loaded?.bundle || !parts) return null;
  // Erkannte Carries zuerst, dann der Key-Carry (wie die Seite sie benennt).
  const all = [...new Set([...carries, parts.carry])];
  const clusterId = resolveGuideId(loaded.bundle, all.map(c => `${parts.trait}__${c}`), units, all, style);
  if (!clusterId) return null;
  const comp = loaded.bundle.comps.find(c => c.id === clusterId);
  if (!comp) return null;
  return { slug: clusterId, guide: toGuide(comp, loaded.bundle.details[clusterId] || null, loaded.cuts) };
}

/**
 * Alle Guides mit ihrer Familie — für die Augment-Seiten, die von einem
 * Augment aus rückwärts nach Comps suchen.
 */
export function allGuides(loaded: LoadedGuides | null): Array<{
  slug: string; guide: CompGuide; trait: string; carry: string;
}> {
  if (!loaded?.bundle) return [];
  const out: Array<{ slug: string; guide: CompGuide; trait: string; carry: string }> = [];
  for (const [familyKey, clusterId] of Object.entries(loaded.bundle.familyMap)) {
    const comp = loaded.bundle.comps.find(c => c.id === clusterId);
    if (!comp) continue;
    const [trait, carry] = familyKey.split('__');
    out.push({
      slug: clusterId,
      guide: toGuide(comp, loaded.bundle.details[clusterId] || null, loaded.cuts),
      trait: trait || '',
      carry: carry || '',
    });
  }
  return out;
}

/**
 * Die Levelling-Strategie einer Comp, aufgelöst statt roh.
 *
 * MetaTFT liefert Kürzel: "lvl 5".."lvl 7", "Fast 8", "Fast 9", "Standard".
 * Roh ausgeliefert läse sich "lvl 6" mechanisch falsch herum — es heisst nicht
 * "auf 6 leveln", sondern "auf 6 bleiben und rerollen", also das Gegenteil von
 * "Fast 8". Deshalb wird hier in Absicht + Level zerlegt und in der UI
 * ausgeschrieben.
 *
 * Unbekannte Werte geben null: MetaTFT kann jederzeit ein neues Kürzel
 * einführen, und eine falsch geratene Strategie ist schlechter als keine.
 */
export type LevellingPlan =
  | { kind: 'reroll'; level: number }
  | { kind: 'fast'; level: number }
  | { kind: 'standard' };

export function parseLevelling(raw: string | null | undefined): LevellingPlan | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^standard$/i.test(s)) return { kind: 'standard' };
  const reroll = /^lvl\s*(\d+)$/i.exec(s);
  if (reroll) return { kind: 'reroll', level: Number(reroll[1]) };
  const fast = /^fast\s*(\d+)$/i.exec(s);
  if (fast) return { kind: 'fast', level: Number(fast[1]) };
  return null;
}

/**
 * Levelschritte ohne die statistisch bedeutungslosen.
 *
 * Der Fahrplan ist ein Durchschnitt über alle Spieler der Comp, und am oberen
 * Ende bricht die Grundlage weg: beobachtet 1.094 Spieler auf Level 4, aber 39
 * auf Level 9. Solche Schritte als Empfehlung zu zeigen wäre eine erfundene
 * Genauigkeit.
 *
 * Gefiltert wird relativ zum stärksten Schritt der Comp, nicht gegen eine feste
 * Zahl. Gemessen über alle 69 Comps machen die beiden Verfahren an 35 von 425
 * Schritten etwas Unterschiedliches, und zwar in beide Richtungen: eine feste
 * 100er-Grenze behält einen Level-10-Schritt mit 308 Beobachtungen bei einer
 * Comp, deren Peak bei 7.985 liegt (3,9 % — Rauschen), und wirft bei einer
 * kleinen Comp mit Peak 186 einen Schritt mit 46 weg (25 % — belastbar). Es
 * bleiben 4 bis 7 Schritte je Comp.
 */
export function significantLevelSteps(levels: LevelStep[], minShare = 0.1): LevelStep[] {
  if (!levels?.length) return [];
  const peak = Math.max(...levels.map(s => s.count ?? 0));
  if (peak <= 0) return [];
  return levels.filter(s => (s.count ?? 0) >= peak * minShare);
}

// Rand-Farbe eines Augment-Tiles nach Rarity (Silver/Gold/Prismatic). Die
// Rarity steht im Asset-Bundle unter assets.augments[apiName].tier.
// Roh-Hex, bewusst: die vier Rueckgaben sind eine Rang-Leiter. Der
// Standardfall traegt zwar denselben Wert wie --border-subtle, haengt aber
// an der Leiter und nicht an der Text-Hierarchie -- eine Lesbarkeits-Revision
// an den Text-Token wuerde ihn sonst mitziehen.
export function augmentTierBorderColor(tier: number | null | undefined): string {
  switch (tier) {
    case 1: return '#9aa5b4';   // Silver
    case 2: return '#e0c75a';   // Gold
    case 3: return '#c39bff';   // Prismatic
    default: return 'var(--border-subtle)';
  }
}

type AugmentAssets = Pick<TftAssetsBundle, 'augments'> & Partial<Pick<TftAssetsBundle, 'champions'>>;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reihenfolge vor der Kappung: Comp-eigene Augments zuerst, dann der Rest in
 * MetaTFTs Reihenfolge (User 2026-10-15, F3). Comp-eigen heisst: Riot bindet
 * das Augment an einen aktiven Trait der Comp (assets.augments[id].traits).
 * Bewusst KEINE Namens- oder Textsuche: gemessen ordnete die Textsuche „Sun
 * and Moon" Solar zu (dort nur Bedingung) und fand „Unrivaled" nicht
 * (classification-reviewer 15.10.2026). Fehlt das Feld (Bundle vor dem
 * 15.10.), bleibt die Reihenfolge wie vorher.
 *
 * Gleichnamige Varianten: „Beast Within" gibt es je Unit (Nidalee/Sivir),
 * beide Kacheln sehen gleich aus und tragen denselben Namen. Es bleibt die
 * Variante, deren Text die meisten Units der Comp nennt (bei Gleichstand alle
 * gleich guten; nennt keine eine Unit der Comp, die erste). Sie steht an der
 * Stelle der ersten Variante.
 */
function orderedCompAugments(guide: CompGuide, assets: AugmentAssets): string[] {
  const compTraits = new Set(guide.traits ?? []);
  const isOwn = (id: string) => (assets.augments[id]?.traits ?? []).some(t => compTraits.has(t));
  return dedupeVariants([...guide.augments.filter(isOwn), ...guide.augments.filter(id => !isOwn(id))], guide, assets);
}

/** Gleichnamige Varianten auf die passende(n) reduzieren, Reihenfolge bleibt (siehe orderedCompAugments). */
function dedupeVariants(ordered: string[], guide: CompGuide, assets: AugmentAssets): string[] {
  const unitNames = (guide.units ?? [])
    .map(u => assets.champions?.[u]?.name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
  const unitHits = (id: string): number => {
    const desc = assets.augments[id]?.desc || '';
    return unitNames.filter(n => new RegExp(`(^|[^\\p{L}])${escapeRegExp(n)}($|[^\\p{L}])`, 'u').test(desc)).length;
  };
  const byName = new Map<string, string[]>();
  for (const id of ordered) {
    const name = assets.augments[id]?.name;
    if (name) byName.set(name, [...(byName.get(name) ?? []), id]);
  }
  // Nur bei echten Varianten den Text pruefen — die Augment-Seiten rufen das
  // fuer jede Comp auf. Passen mehrere Varianten gleich gut (die Comp hat
  // Nidalee UND Sivir), bleiben alle: beide werden im Spiel angeboten.
  const keep = new Map<string, string[]>();
  for (const [name, ids] of byName) {
    if (ids.length === 1) { keep.set(name, ids); continue; }
    const hits = ids.map(unitHits);
    const max = Math.max(...hits);
    keep.set(name, max > 0 ? ids.filter((_, i) => hits[i] === max) : [ids[0]]);
  }
  const out: string[] = [];
  const placed = new Set<string>();
  for (const id of ordered) {
    const name = assets.augments[id]?.name;
    if (!name) { out.push(id); continue; }
    if (placed.has(name)) continue;
    placed.add(name);
    out.push(...keep.get(name)!);
  }
  return out;
}

/**
 * Augments in Rarity-Reihen: Prismatic, Gold, Silver (User 2026-09-27).
 *
 * Die Rarity steht in `assets.augments[apiName].tier` (1-3). Nicht aufgelöste
 * IDs (Stand 15.10.2026: 4 IDs, 9 Verweise) und unbekannte Tiers fallen VOR
 * der Kappung heraus, sonst hätte eine Reihe Lücken. Innerhalb der Reihe
 * stehen die Comp-eigenen Augments vorne, danach MetaTFTs Reihenfolge
 * (orderedCompAugments). Ohne Bundle gibt es keine Reihen — die Rarity wird
 * nicht geraten.
 *
 * Direkt nur für Tests und compAugmentSections — Seiten lesen über
 * compAugmentSections, damit Comp- und Augment-Seiten dasselbe sagen.
 */
export function augmentRowsByRarity(
  guide: CompGuide,
  assets: AugmentAssets | null,
): Array<{ rarity: AugmentRarity; augments: string[] }> {
  if (!assets?.augments || guide.augments.length === 0) return [];
  const byRarity = new Map<AugmentRarity, string[]>();
  for (const apiName of orderedCompAugments(guide, assets)) {
    const tier = (assets.augments[apiName] as { tier?: unknown } | undefined)?.tier;
    if (tier !== 1 && tier !== 2 && tier !== 3) continue;
    const list = byRarity.get(tier) ?? [];
    if (list.length < AUGMENTS_PER_RARITY) list.push(apiName);
    byRarity.set(tier, list);
  }
  return RARITY_ORDER
    .filter(r => (byRarity.get(r)?.length ?? 0) > 0)
    .map(r => ({ rarity: r, augments: byRarity.get(r)! }));
}

/** Stages je Augment aus tft-augment-stages-<set>.json (`stages`-Feld). */
export type AugmentStageMap = Readonly<Record<string, readonly string[]>>;

const STAGE_SEQUENCE = ['2-1', '3-2', '4-2'];

/**
 * Trait-Augments der Comp — eigene Zeile über den Empfehlungen (User
 * 2026-10-15, F3b). Riot bindet 19 Augments fest an einen Trait
 * (assets.augments[id].traits); gezeigt werden die der aktiven Traits der
 * MetaTFT-Comp, auch wenn die Profi-Vorlage sie nicht nennt (sie nennt nur 6
 * von 19). Bewusst eine eigene Zeile statt vorne in den Reihen: dort hätten
 * sie 35 von 38 Comps umgeschrieben und Profi-Empfehlungen verdrängt
 * (classification-reviewer 15.10.2026). Keine Statistik, nur Spielmechanik.
 *
 * Nur Augments, die gerade angeboten werden (Stage-Eintrag nicht leer —
 * „Flame On" hat in 18.4 keinen). Ohne Stage-Daten (null) keine Zeile statt
 * einer geratenen. Reihenfolge: Haupt-Trait der Comp (erster Teil des
 * MetaTFT-Namens) zuerst, dann nach Trait, dann frühere Stage zuerst (Beast
 * Within vor Beast Within+). Gleichnamige Varianten wie in den Reihen.
 */
export function compTraitAugments(
  guide: CompGuide,
  assets: AugmentAssets | null,
  stages: AugmentStageMap | null,
): string[] {
  if (!assets?.augments || !stages) return [];
  const compTraits = guide.traits ?? [];
  if (compTraits.length === 0) return [];
  const mainTrait = (guide.title || '').split(',')[0].trim();
  const candidates = Object.keys(assets.augments).filter(id => {
    const a = assets.augments[id];
    if (!a || a.aliasOf || !(a.traits ?? []).some(t => compTraits.includes(t))) return false;
    if (a.tier !== 1 && a.tier !== 2 && a.tier !== 3) return false;
    const s = stages[id];
    return Array.isArray(s) && s.length > 0;
  });
  const traitRank = (id: string) => {
    const ts = assets.augments[id].traits ?? [];
    if (ts.includes(mainTrait)) return -1;
    return Math.min(...ts.map(t => compTraits.indexOf(t)).filter(i => i >= 0));
  };
  const stageRank = (id: string) => Math.min(...(stages[id] ?? []).map(s => {
    const i = STAGE_SEQUENCE.indexOf(s);
    return i < 0 ? STAGE_SEQUENCE.length : i;
  }));
  candidates.sort((a, b) => traitRank(a) - traitRank(b) || stageRank(a) - stageRank(b) || (a < b ? -1 : a > b ? 1 : 0));
  return dedupeVariants(candidates, guide, assets).slice(0, AUGMENTS_PER_RARITY);
}

/**
 * Was eine Comp an Augments zeigt: Trait-Zeile plus Rarity-Reihen. Sind die
 * Stage-Daten da, fehlen in den Reihen alle Augments aktiver Traits — sie
 * stehen in der Trait-Zeile oder werden gerade nicht angeboten; ohne
 * Stage-Daten bleiben die Reihen wie vorher.
 *
 * Einzige Quelle für „welche Augments zeigt eine Comp" (Comp-Seite und
 * Augment-Seiten, siehe compsShowingAugment).
 */
export function compAugmentSections(
  guide: CompGuide,
  assets: AugmentAssets | null,
  stages: AugmentStageMap | null,
): { traitAugments: string[]; rarityRows: Array<{ rarity: AugmentRarity; augments: string[] }> } {
  const traitAugments = compTraitAugments(guide, assets, stages);
  if (!stages || !assets?.augments) return { traitAugments, rarityRows: augmentRowsByRarity(guide, assets) };
  const compTraits = new Set(guide.traits ?? []);
  const activeTraitAug = (id: string) => (assets.augments[id]?.traits ?? []).some(t => compTraits.has(t));
  return {
    traitAugments,
    rarityRows: augmentRowsByRarity({ ...guide, augments: guide.augments.filter(id => !activeTraitAug(id)) }, assets),
  };
}

/** Alle Guides, deren Comp-Seite dieses Augment zeigt (Augment-Seiten). */
export function compsShowingAugment(
  loaded: LoadedGuides | null,
  assets: AugmentAssets | null,
  stages: AugmentStageMap | null,
  apiName: string,
): ReturnType<typeof allGuides> {
  return allGuides(loaded).filter(g => {
    const s = compAugmentSections(g.guide, assets, stages);
    return s.traitAugments.includes(apiName) || s.rarityRows.some(r => r.augments.includes(apiName));
  });
}

// Difficulty-Farbe für das Badge.
// Roh-Hex im Standardfall, bewusst: Rang-Leiter, nicht Text-Hierarchie.
export function difficultyColor(d: Difficulty | null): string {
  switch (d) {
    case 'EASY': return '#3ecf8e';
    case 'MEDIUM': return '#e0c75a';
    case 'HARD': return '#e44040';
    default: return '#5a6a80';
  }
}
