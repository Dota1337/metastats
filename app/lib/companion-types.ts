// Antwort-Formen von /api/companion/v1/*, ohne Abhaengigkeiten.
//
// Eigene Datei, weil die Overwolf-App (apps/overwolf-app) sie direkt
// einbindet: companion-api.ts zieht next/server nach, das es in der App nicht
// gibt. Beide Seiten lesen so dieselbe Definition.

export const COMPANION_API_VERSION = 1;

export interface CompanionCompUnit {
  id: string;
  items?: string[];    // nur an Item-Traegern, wie auf /tft/comps; fehlt = keine
  star3?: true;
}

export interface CompanionComp {
  key: string;         // Familien-Schluessel <trait>__<carry>
  slug: string;        // Detailseite auf metastats.gg
  name: string;        // „Trait · Carry & Carry"
  trait: string;
  carries: string[];
  itemCarriers: string[];
  tier: string | null; // S/A/B/C/D, null unter der Mindest-Spielzahl
  avg: number | null;
  top4: number | null;
  win: number | null;
  pick: number | null;
  games: number;
  traitLevel: number;  // Trait-Stufe der gezeigten Variante (Zahl im Key, nicht Spieler-Stufe)
  avgLevel: number | null; // Spieler-Stufe am Spielende im Schnitt
  units: CompanionCompUnit[];
  /** Alle <trait>__<carry>, die in dieser Comp zusammengelegt sind (Anker zuerst). */
  members?: string[];
  /** Matchups gegen andere Comps der Liste (Schluessel = deren key), ab 30 Spielen. */
  vs?: Record<string, CompanionVs>;
  /** Reroll-Comp: auf `level` bleiben, bis `targets` 3 Sterne haben (ab 0.6). */
  reroll?: { level: number; targets: string[] };
  /** Early-Game-Boards vorhanden (MetaTFT-Comp mit passendem Brett, ab 0.6). */
  hasEarly?: true;
}

export interface CompanionCompsResponse {
  v: number;
  set: number | null;
  patch: string | null;
  filters: { region: string; bucket: string; days: number };
  generatedAt: string;
  comps: CompanionComp[];
}

export interface CompanionLookups {
  v: number;
  set: number;
  champions: Record<string, { name: string; cost: number; icon: string | null; traits: string[] }>;
  items: Record<string, { name: string; icon: string | null; recipe?: [string, string]; component?: true }>;
  traits: Record<string, { name: string; icon: string | null }>;
  shopOdds: Record<number, [number, number, number, number, number]>;
  bagSize: Record<number, number>;
}

export interface CompanionMatch {
  id: string;
  at: number;          // Spielende, ms
  queue: number | null;
  placement: number;
  level: number | null;
  traits: Array<{ id: string; units: number; style: number }>;
  units: Array<{ id: string; star: number; items: string[] }>;
  /** Alle 8 Spieler der Lobby, nach Platz (ab 0.5). */
  lobby?: CompanionLobbyPlayer[];
}

export interface CompanionPlayerResponse {
  v: number;
  region: string;
  player: { name: string; puuid: string; icon: number | null; level: number | null }; // icon = Riot-Profilbild-Nummer
  ranked: { tier: string | null; rank: string | null; lp: number | null; wins: number; losses: number } | null;
  matches: CompanionMatch[];
  /** Startwert fuer die naechste Seite, null = keine weiteren Spiele (ab 0.5). */
  nextStart?: number | null;
}

// ---------------------------------------------------------------------------
// Ab Companion 0.5: Units, Items, Comp-Detail, Lobby im Spielverlauf.

/** Matchup gegen eine andere Comp: [Spiele, Anteil „landet vor ihr"]. */
export type CompanionVs = [number, number];

export interface CompanionStats {
  games: number;
  avg: number | null;
  top4: number | null;
  win: number | null;
}

export interface CompanionUnitRow extends CompanionStats {
  id: string;
  pick: number | null;
  items: string[];     // meistgebaute Items, bis 6
}

export interface CompanionUnitsResponse {
  v: number;
  set: number | null;
  patch: string | null;
  units: CompanionUnitRow[];
}

export interface CompanionUnitDetail extends CompanionStats {
  v: number;
  id: string;
  items: Array<CompanionStats & { id: string }>;
  itemSets: Array<CompanionStats & { items: string[] }>;
}

export interface CompanionItemRow extends CompanionStats {
  id: string;
  pick: number | null;
  users: string[];     // haeufigste Traeger, bis 8
}

export interface CompanionItemsResponse {
  v: number;
  set: number | null;
  patch: string | null;
  items: CompanionItemRow[];
}

export interface CompanionItemDetail extends CompanionStats {
  v: number;
  id: string;
  users: Array<CompanionStats & { id: string }>;
}

/** Feld = Reihe * 7 + Spalte, Reihe 0 = hinterste Reihe. */
export interface CompanionBoardCell {
  unit: string;
  cell: number;
}

export interface CompanionEarlyBoard {
  units: string[];
  games: number;
  avg: number | null;
}

export interface CompanionCompDetail {
  v: number;
  slug: string;
  board: CompanionBoardCell[];
  boardSource: 'companion' | 'metatft' | 'global' | 'mixed' | null;
  /** Endstufe der Spieler: Anteil und Ergebnis je Stufe. */
  levels: Array<CompanionStats & { level: number; share: number }>;
  /** Wann die Stufe typischerweise erreicht wird (Stage-Runde). */
  levelTiming: Array<{ level: number; stage: string }>;
  /** Spielerstufe 4..7 -> meistgespielte fruehe Boards (ab 50 Spielen). */
  early: Record<string, CompanionEarlyBoard[]>;
  /**
   * Spielerstufe -> Aufstellung des Endbretts auf dieser Stufe (Reroll-Stufe
   * und 7/8/9, je ab 200 Spielen; ab 0.6). Fehlt = nur `board`.
   */
  boardsByPlayerLevel?: Record<string, CompanionBoardCell[]>;
}

export interface CompanionLobbyPlayer {
  name: string | null; // Riot-ID, null wenn nicht aufloesbar
  puuid: string;
  placement: number;
  level: number | null;
  traits: Array<{ id: string; units: number; style: number }>;
  units: Array<{ id: string; star: number; items: string[] }>;
}
