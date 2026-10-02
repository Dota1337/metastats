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
}

export interface CompanionPlayerResponse {
  v: number;
  region: string;
  player: { name: string; puuid: string; icon: number | null; level: number | null }; // icon = Riot-Profilbild-Nummer
  ranked: { tier: string | null; rank: string | null; lp: number | null; wins: number; losses: number } | null;
  matches: CompanionMatch[];
}
