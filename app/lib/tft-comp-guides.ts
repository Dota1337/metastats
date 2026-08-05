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

const GUIDE_SET = CURRENT_SET;

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

/**
 * MetaTFTs Augment-Grade — wie gut das Augment IN DIESER COMP abschneidet.
 *
 * Nicht zu verwechseln mit der Rarity (Silver/Gold/Prismatic, 1-3), die im
 * Asset-Bundle steht. Der Grade ist die für den Pick nützlichere Größe: die
 * Rarity sieht der Spieler im Angebot ohnehin, die comp-spezifische Stärke
 * nicht. Beides wird gerendert — Grade als Gruppe, Rarity als Tile-Rand.
 */
export type AugmentGrade = 'S' | 'A' | 'B' | 'C' | 'D';

const GRADE_ORDER: AugmentGrade[] = ['S', 'A', 'B', 'C', 'D'];

/**
 * Wie viele Augments je Comp gerendert werden.
 *
 * MetaTFT liefert bis zu 41 pro Comp — das ist keine Empfehlung mehr, sondern
 * eine Liste. 12 deckt die Stage-2-1/3-2/4-2-Picks ab, ohne dass der Spieler
 * scrollen muss.
 */
const MAX_AUGMENTS = 12;

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
  win: number | null;
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
  early: EarlyOption[];
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
  // genau der Widerspruch, den ein Nutzer als Fehler liest.
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
  /** `tier` ist MetaTFTs Performance-Grade IN DIESER COMP, nicht die Rarity. */
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
  /** Augment-apiNames, nach Grade absteigend, auf MAX_AUGMENTS gekappt. */
  augments: string[];
  augmentGrades: Record<string, AugmentGrade>;
  early: EarlyOption[];
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
  const augs = [...(comp.augments || [])]
    .sort((a, b) => rank(a.tier) - rank(b.tier))
    .slice(0, MAX_AUGMENTS);
  return {
    id: comp.id,
    title: comp.name || comp.id,
    difficulty: bucketOf(comp.difficulty, cuts),
    levelling: comp.levelling,
    games: comp.games,
    augments: augs.map(a => a.id),
    augmentGrades: Object.fromEntries(augs.map(a => [a.id, a.tier])),
    early: details?.early || [],
    carousel: details?.carousel || [],
    levels: details?.levels || [],
    details,
  };
}

/**
 * Familie → Guide. `parts` kommt aus dem cluster_key der Comp-Seite.
 *
 * Kein Fuzzy-Matching auf den Trait-Namen: die Familien-Map wird mit derselben
 * classifyComp-Lib gebildet, aus der auch die cluster_keys stammen, also ist
 * der Schlüssel exakt. Ein Prefix-Match wie in der tftacademy-Fassung würde
 * hier nur falsche Treffer erzeugen.
 */
export function findCompGuide(
  loaded: LoadedGuides | null,
  parts: { trait: string; carry: string } | null,
): { slug: string; guide: CompGuide } | null {
  if (!loaded?.bundle || !parts) return null;
  const clusterId = loaded.bundle.familyMap[`${parts.trait}__${parts.carry}`];
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
export function augmentTierBorderColor(tier: number | null | undefined): string {
  switch (tier) {
    case 1: return '#9aa5b4';   // Silver
    case 2: return '#e0c75a';   // Gold
    case 3: return '#c39bff';   // Prismatic
    default: return '#1e2a3a';
  }
}

// Farbe eines Performance-Grades.
export function augmentGradeColor(grade: AugmentGrade | null | undefined): string {
  switch (grade) {
    case 'S': return '#e0c75a';
    case 'A': return '#3ecf8e';
    case 'B': return '#5aa7e0';
    case 'C': return '#7a8aa0';
    case 'D': return '#5a6a80';
    default: return '#5a6a80';
  }
}

/**
 * Augments nach Performance-Grade gruppieren (S zuerst).
 *
 * Vorher war das eine Gruppierung nach Rarity, die die Rarity aus
 * `assets.items[...]` las — dort stand sie nie (fetch-tft-assets schreibt sie
 * nach `assets.augments`), also war jede Gruppe leer und der leere Fall durch
 * einen Guard maskiert. Mit MetaTFT als Quelle gruppieren wir stattdessen nach
 * dem comp-spezifischen Grade, der ohne Asset-Bundle auskommt.
 */
export function groupAugmentsByGrade(
  guide: CompGuide,
): Array<{ grade: AugmentGrade; augments: string[] }> {
  if (guide.augments.length === 0) return [];
  const byGrade = new Map<AugmentGrade, string[]>();
  for (const apiName of guide.augments) {
    const grade = guide.augmentGrades[apiName];
    if (!grade) continue;
    if (!byGrade.has(grade)) byGrade.set(grade, []);
    byGrade.get(grade)!.push(apiName);
  }
  const out: Array<{ grade: AugmentGrade; augments: string[] }> = [];
  for (const g of GRADE_ORDER) {
    const list = byGrade.get(g);
    if (list?.length) out.push({ grade: g, augments: list });
  }
  return out;
}

// Difficulty-Farbe für das Badge.
export function difficultyColor(d: Difficulty | null): string {
  switch (d) {
    case 'EASY': return '#3ecf8e';
    case 'MEDIUM': return '#e0c75a';
    case 'HARD': return '#e44040';
    default: return '#5a6a80';
  }
}
