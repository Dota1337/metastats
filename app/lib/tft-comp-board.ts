// Aufstellungsbrett einer Comp: ein Feld je Unit, Endbretter je Spielerstufe,
// Stufen-Zeitpunkte und fruehe Boards aus MetaTFT. Gemeinsam fuer die
// Overwolf-App (/api/companion/v1/comp) und die Comp-Liste
// (/api/tft/comps/board) — beide zeigen damit dieselbe Aufstellung.
//
// Reine Funktionen ohne Netz und ohne next/server: die Routen reichen den
// Abruf der Feld-Anteile als Funktion herein (tft-comp-board.test.mjs). Darf
// deshalb auch im Browser landen.
import { parseLevelling, resolveGuideId, significantLevelSteps, type CompGuidesBundle, type GuideStyle } from './tft-comp-guides';
import type {
  CompanionBoardCell, CompanionCompDetail, CompanionEarlyBoard, CompanionPositioning,
} from './companion-types';

export type CellShares = Record<string, Array<{ cell: number; share: number }>>;
export type BoardSource = CompanionCompDetail['boardSource'];

export const BOARD_UNIT_RE = /^[A-Za-z0-9_]{2,60}$/;
export const BOARD_FAMILY_RE = /^[\w@]+_[A-Za-z0-9_]+$/;
// MetaTFT-Comp-ID (wie by-units ?guide=).
export const GUIDE_ID_RE = /^\d{1,12}$/;

// Positioning wie auf der Homepage (Comp-Liste, App): Reiter Stufe 7-9, je
// mindestens 50 Spiele der Comp auf der Stufe. Fruehe Boards ab 50 Spielen.
export const POSITIONING_LEVELS: [number, number] = [7, 9];
export const POSITIONING_MIN_GAMES = 50;
export const EARLY_MIN_GAMES = 50;

/**
 * `?guide=` der Aufrufer: die MetaTFT-Comp, die ihre Comp-Zeile zeigt.
 * 'none' = die Zeile hat keine (null), eine ID = diese, sonst undefined
 * (die Route ordnet selbst zu).
 */
export function parseGuideParam(raw: string | null | undefined): string | null | undefined {
  if (raw === 'none') return null;
  return raw && GUIDE_ID_RE.test(raw) ? raw : undefined;
}

type GuideDetail = CompGuidesBundle['details'][string];

/** Fruehe Boards je Spielerstufe ab `min` Spielen — Liste (hasEarly) und Detail. */
export function earlyBoards(detail: GuideDetail | null | undefined, min = EARLY_MIN_GAMES): Record<string, CompanionEarlyBoard[]> {
  const early: Record<string, CompanionEarlyBoard[]> = {};
  for (const [lvl, list] of Object.entries(detail?.earlyByLevel || {})) {
    const boards = (list || [])
      .filter(o => Array.isArray(o.units) && o.units.length > 0 && (o.count ?? 0) >= min)
      .map(o => ({ units: o.units, games: o.count ?? 0, avg: o.avg == null ? null : Number(o.avg.toFixed(2)) }));
    if (boards.length > 0) early[lvl] = boards;
  }
  return early;
}
// by-units nimmt hoechstens 12 Units je Anfrage.
const SHARES_CHUNK = 12;

/**
 * Ein Feld je Unit aus den Feld-Anteilen (beste zuerst). Wer den hoechsten
 * Anteil hat, waehlt zuerst; ist sein Feld belegt, nimmt er sein naechstes
 * Feld aus der Liste, sonst das naechste freie Feld derselben Reihe. Gleiche
 * Daten ergeben immer dasselbe Board.
 */
export function resolveBoard(
  units: string[],
  shares: Record<string, Array<{ cell: number; share: number }>>,
): CompanionBoardCell[] {
  const order = units
    .filter(u => shares[u]?.length)
    .sort((a, b) => shares[b][0].share - shares[a][0].share || a.localeCompare(b));
  const taken = new Set<number>();
  const out: CompanionBoardCell[] = [];
  for (const unit of order) {
    let cell = shares[unit].map(c => c.cell).find(c => c >= 0 && c < 28 && !taken.has(c));
    if (cell == null) {
      const first = shares[unit][0].cell;
      const row = Math.floor(first / 7);
      const col = first % 7;
      for (let d = 1; d < 7 && cell == null; d++) {
        for (const c of [col - d, col + d]) {
          if (c >= 0 && c < 7 && !taken.has(row * 7 + c)) { cell = row * 7 + c; break; }
        }
      }
    }
    if (cell == null) continue;
    taken.add(cell);
    out.push({ unit, cell });
  }
  return out;
}

/**
 * Units des Endbretts auf Spielerstufe `level`: die `level` Units, die auf
 * dieser Stufe am haeufigsten im Brett standen (Anteil an den Spielen der
 * Comp auf der Stufe). Gleiche Daten ergeben immer dieselbe Auswahl.
 */
export function unitsAtPlayerLevel(
  units: Array<{ characterId: string; levelGames?: Record<string, number> }>,
  level: number,
): string[] {
  const key = String(level);
  return units
    .map(u => ({ id: u.characterId, n: Number(u.levelGames?.[key]) || 0 }))
    .filter(u => u.n > 0)
    .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id))
    .slice(0, level)
    .map(u => u.id);
}

export interface BoardRow { row: number; shift: boolean; cells: number[] }

/**
 * Zeichen-Reihenfolge des 4×7-Bretts: vorderste Datenreihe (3) oben, hinterste
 * (0) unten. Gerade Datenreihen stehen ein halbes Feld weiter rechts — wie im
 * Spiel, bei MetaTFT und in der App (apps/overwolf-app/src/lib/board-view.ts).
 */
export function boardLayout(): BoardRow[] {
  const rows: BoardRow[] = [];
  for (let row = 3; row >= 0; row--) {
    rows.push({ row, shift: row % 2 === 0, cells: Array.from({ length: 7 }, (_, col) => row * 7 + col) });
  }
  return rows;
}

/**
 * Startreiter: die Stufe mit den meisten Top-4-Spielen (Spiele × Top-4-Rate).
 * Nicht die mit dem hoechsten Anteil — auf der haeufigsten Endstufe enden oft
 * die verlorenen Spiele. Gleichstand: mehr Spiele, dann die niedrigere Stufe.
 */
export function defaultLevel(
  levels: Array<{ level: number; games: number; top4Rate?: number | null }>,
): number | null {
  let best: { level: number; games: number; v: number } | null = null;
  for (const l of levels) {
    const games = Number(l.games) || 0;
    const v = games * (Number(l.top4Rate) || 0);
    if (!best || v > best.v || (v === best.v && (games > best.games || (games === best.games && l.level < best.level)))) {
      best = { level: l.level, games, v };
    }
  }
  return best?.level ?? null;
}

export interface CompBoardInput {
  typicalUnits?: Array<{ characterId: string }>;
  mergedFamilies?: string[];
  outcome?: {
    levels?: Array<{ level: number; games: number }>;
    units?: Array<{ characterId: string; levelGames?: Record<string, number> }>;
  } | null;
}

export interface CompBoardsOptions {
  comp: CompBoardInput;
  /**
   * Feld-Anteile fuer hoechstens 12 Units. `families` = <trait>__<carry>-Schluessel
   * der Comp, `guide` = zugeordnete MetaTFT-Comp (beides fuer by-units).
   */
  fetchShares: (
    ids: string[],
    ctx: { families: string[]; guide: string | null },
  ) => Promise<{ units: CellShares; source: BoardSource } | null>;
  guides: Pick<CompGuidesBundle, 'familyMap' | 'comps' | 'details'> | null;
  /** Stufen mit eigenem Endbrett, beide Grenzen eingeschlossen. */
  levelRange: [number, number];
  /** Mindest-Spiele der Comp auf einer Stufe fuer ein eigenes Endbrett. */
  minLevelGames: number;
  /** Mindest-Spiele fuer ein fruehes Board aus MetaTFT. */
  earlyMinGames: number;
  /** Units des Gesamtbretts; fehlt es, die typischen Units der Comp (max. 9). */
  boardUnits?: string[];
  /** Weitere Carries fuer die MetaTFT-Zuordnung (App: Carries + Item-Traeger). */
  extraCarries?: string[];
  /**
   * MetaTFT-Comp der Comp-Zeile (parseGuideParam). Liste und Detail ordnen
   * sonst mit verschiedenen Units zu (Zeile: ihr Brett, Detail: die ganze
   * Familie) und landen bei verschiedenen Anleitungen. null = keine
   * Anleitung; undefined oder eine ID, die es in der Datei nicht (mehr) gibt
   * = selbst zuordnen.
   */
  guideId?: string | null;
  /** Spielweise unserer Comp fuer die Zuordnung, wenn nicht festgenagelt (resolveGuideId). */
  guideStyle?: GuideStyle | null;
  /**
   * Auch die fruehen Boards als Brett mit Feldern (meistgespieltes je Stufe
   * 4-7). Nur die Detailseite fragt danach; Liste und App bleiben unveraendert.
   */
  withEarlyBoards?: boolean;
}

export interface CompBoards {
  families: string[];
  guideId: string | null;
  board: CompanionBoardCell[];
  boardSource: BoardSource;
  boardsByPlayerLevel?: Record<string, CompanionBoardCell[]>;
  levelTiming: Array<{ level: number; stage: string }>;
  early: Record<string, CompanionEarlyBoard[]>;
  /** Stufe "4".."7" -> Brett des meistgespielten fruehen Boards (nur mit withEarlyBoards). */
  earlyBoardsByLevel?: Record<string, CompanionBoardCell[]>;
}

/**
 * Alles, was ein Aufstellungsbrett braucht, aus der Detail-Antwort einer Comp.
 * Die MetaTFT-Zuordnung (resolveGuideId: Familien-Eintrag oder bestes Brett ab
 * Jaccard 0,7 mit einem unserer Carries darin) kommt zuerst, weil sie sowohl
 * den Levelplan als auch die Positionen liefert — so stammen beide aus
 * derselben MetaTFT-Comp.
 */
export async function buildCompBoards(opts: CompBoardsOptions): Promise<CompBoards> {
  const { comp, fetchShares, guides } = opts;
  const families = (comp.mergedFamilies || []).filter(f => BOARD_FAMILY_RE.test(f)).slice(0, 4);
  const typical = (comp.typicalUnits || []).map(u => u.characterId).filter(u => BOARD_UNIT_RE.test(u)).slice(0, 9);
  const boardUnits = opts.boardUnits && opts.boardUnits.length > 0 ? opts.boardUnits : typical;

  const familyCarries = families.map(f => f.split('__')[1]).filter((c): c is string => !!c);
  // Nur IDs aus guides.comps zaehlen: details ist ein Objekt aus JSON,
  // details['constructor'] waere sonst auch „vorhanden“.
  const pinned = opts.guideId === null ? null
    : opts.guideId && guides?.comps.some(c => c.id === opts.guideId) ? opts.guideId : undefined;
  const guideId = pinned !== undefined ? pinned : guides
    ? resolveGuideId(guides, families, typical, [...new Set([...(opts.extraCarries || []), ...familyCarries])], opts.guideStyle)
    : null;
  const details = guideId ? guides?.details[guideId] : undefined;
  const early = earlyBoards(details, opts.earlyMinGames);

  // Endbrett je Spielerstufe: Stufen im Bereich mit genug Spielen, Units = die
  // haeufigsten auf der Stufe.
  const outcome = comp.outcome;
  const [lo, hi] = opts.levelRange;
  const levelUnits = new Map<number, string[]>();
  for (const l of outcome?.levels || []) {
    if (l.level < lo || l.level > hi || l.games < opts.minLevelGames) continue;
    const ids = unitsAtPlayerLevel(outcome?.units || [], l.level).filter(u => BOARD_UNIT_RE.test(u));
    if (ids.length > 0) levelUnits.set(l.level, ids);
  }
  // Fruehe Boards: das meistgespielte je Stufe, Felder aus derselben Abfrage.
  const earlyUnits = new Map<string, string[]>();
  if (opts.withEarlyBoards) {
    for (const [lvl, list] of Object.entries(early)) {
      const top = list.reduce((a, b) => (b.games > a.games ? b : a));
      const ids = top.units.filter(u => BOARD_UNIT_RE.test(u));
      if (ids.length > 0) earlyUnits.set(lvl, ids);
    }
  }
  const levelIds = [...new Set([...levelUnits.values(), ...earlyUnits.values()].flat())];
  const chunks: string[][] = [];
  for (let i = 0; i < levelIds.length; i += SHARES_CHUNK) chunks.push(levelIds.slice(i, i + SHARES_CHUNK));

  // Gesamtbrett und Stufenbretter gleichzeitig; die Anteile einer Unit haengen
  // nicht von den anderen Units der Anfrage ab.
  const ctx = { families, guide: guideId };
  const [overall, ...parts] = await Promise.all([
    boardUnits.length > 0 ? fetchShares(boardUnits, ctx) : Promise.resolve(null),
    ...chunks.map(ids => fetchShares(ids, ctx)),
  ]);

  let board: CompanionBoardCell[] = [];
  let boardSource: BoardSource = null;
  if (overall) {
    board = resolveBoard(boardUnits, overall.units);
    boardSource = board.length > 0 ? overall.source : null;
  }

  let boardsByPlayerLevel: Record<string, CompanionBoardCell[]> | undefined;
  let earlyBoardsByLevel: Record<string, CompanionBoardCell[]> | undefined;
  const shares: CellShares = Object.assign({}, ...parts.map(p => p?.units ?? {}));
  for (const [lvl, ids] of levelUnits) {
    const b = resolveBoard(ids, shares);
    if (b.length > 0) (boardsByPlayerLevel ??= {})[String(lvl)] = b;
  }
  if (opts.withEarlyBoards) {
    earlyBoardsByLevel = {};
    for (const [lvl, ids] of earlyUnits) {
      const b = resolveBoard(ids, shares);
      if (b.length > 0) earlyBoardsByLevel[lvl] = b;
    }
  }

  const levelTiming = (details?.levels || [])
    .filter(l => Number.isFinite(l.level) && l.stage && l.round)
    .map(l => ({ level: l.level, stage: `${l.stage}-${l.round}` }));

  return {
    families, guideId, board, boardSource,
    ...(boardsByPlayerLevel ? { boardsByPlayerLevel } : {}),
    levelTiming, early,
    ...(earlyBoardsByLevel ? { earlyBoardsByLevel } : {}),
  };
}

/** Endbretter der Stufen in [lo, hi] mit mindestens `minGames` Spielen der Comp. */
export function pickLevelBoards(
  byLevel: Record<string, CompanionBoardCell[]> | undefined,
  levels: Array<{ level: number; games: number }> | undefined,
  [lo, hi]: [number, number],
  minGames: number,
): Record<string, CompanionBoardCell[]> | undefined {
  let out: Record<string, CompanionBoardCell[]> | undefined;
  for (const l of levels || []) {
    const b = byLevel?.[String(l.level)];
    if (b && l.level >= lo && l.level <= hi && l.games >= minGames) (out ??= {})[String(l.level)] = b;
  }
  return out;
}

/**
 * Positioning wie auf der Homepage, fuer Comp-Liste (/api/tft/comps/board) und
 * App (/api/companion/v1/comp): Reiter 7-9 ab 50 Spielen, Startreiter mit den
 * meisten Top-4-Spielen, Levelplan und Levelschritte der MetaTFT-Comp, die
 * auch die Positionen liefert. Die Schritte gefiltert wie auf der Detailseite
 * (significantLevelSteps, erst ab zwei Schritten): Stufen, die kaum ein
 * Spieler erreicht, waeren eine erfundene Genauigkeit.
 */
export function compPositioning(
  boards: Pick<CompBoards, 'guideId' | 'boardsByPlayerLevel'>,
  outcomeLevels: Array<{ level: number; games: number; share: number; top4Rate: number }> | undefined,
  guides: Pick<CompGuidesBundle, 'comps' | 'details'> | null,
): CompanionPositioning {
  const byLevel = pickLevelBoards(boards.boardsByPlayerLevel, outcomeLevels, POSITIONING_LEVELS, POSITIONING_MIN_GAMES) || {};
  const levels = (outcomeLevels || [])
    .filter(l => byLevel[String(l.level)])
    .sort((a, b) => a.level - b.level)
    .map(l => ({
      level: l.level,
      share: Number(l.share.toFixed(3)),
      games: l.games,
      top4Rate: Number(l.top4Rate.toFixed(3)),
    }));
  const guideComp = boards.guideId ? guides?.comps.find(c => c.id === boards.guideId) : undefined;
  const steps = guideComp ? significantLevelSteps(guides?.details[guideComp.id]?.levels || []) : [];
  const levelTiming = steps.length >= 2
    ? steps.filter(s => Number.isFinite(s.level) && s.stage && s.round).map(s => ({ level: s.level, stage: `${s.stage}-${s.round}` }))
    : [];
  const levelling = guideComp?.levelling ?? null;
  return {
    levels,
    boardsByPlayerLevel: byLevel,
    defaultLevel: defaultLevel(levels),
    levelling,
    plan: parseLevelling(levelling),
    levelTiming,
  };
}
