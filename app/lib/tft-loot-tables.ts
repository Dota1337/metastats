// Loot-Tabellen, Coven-Auszahlung und Wisps fuer /tft/tools/tables.
//
// Die Daten stehen als statische Dateien in public/ (erzeugt von
// scripts/import-tft-tables.mjs, Quelle Little Buddy Bot) und aendern sich
// hoechstens einmal pro Patch — deshalb keine Datenbank.
//
// Diese Datei liest mit `fs` und gehoert ausschliesslich in Server-Components.
// Fehlt die Datei fuer das aktuelle Set (etwa direkt nach einem Set-Wechsel,
// bevor das Skript neu gelaufen ist), kommt null zurueck und die Seite zeigt
// den Bereich leer, statt den Build abzubrechen.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CURRENT_SET } from './current-set';

export type LootRewardKind =
  | 'gold' | 'xp' | 'reroll' | 'randomUnit' | 'champion' | 'item'
  | 'component' | 'fullItem' | 'radiant' | 'emblem' | 'artifact' | 'tacticianItem'
  | 'sameComponent' | 'uniqueComponents' | 'hp' | 'goldRange' | 'specialEgg' | 'unknown';

export interface LootReward {
  k: LootRewardKind;
  n?: number;
  api?: string;
  name?: string;
  icon?: string;          // CDragon-Spielpfad, Aufloesung ueber tftGameAssetUrl
  cost?: number | null;
  stars?: number;
  v?: number | string;
  turns?: number;
  contents?: LootReward[];
}

export type LootCond =
  | { t: 'traits'; n: number }
  | { t: 'face'; n: number }
  | { t: 'sum'; v: string }
  | { t: 'combo'; v: string };

export interface LootRow {
  chance: number | null;
  cond?: LootCond;
  rewards: LootReward[];
}

export type LootSubLabel =
  | { t: 'booster'; api: string; name: string; stage: number }
  | { t: 'stage'; n: number }
  | { t: 'essence'; essence: number; ap: number };

export interface LootSub {
  label?: LootSubLabel;
  rows: LootRow[];
}

export interface LootTable {
  key: string;
  api: string;
  name: string;
  icon?: string;
  patch: string;
  stage: string;
  subs: LootSub[];
}

export interface CovenTable {
  key: 'coven';
  api: string;
  augmentName: string;
  name: string;
  icon: string | null;
  patch: string;
  essence: { units: string; kill: number; loss: number }[];
  subs: LootSub[];
}

export interface LootTablesFile {
  set: number;
  source: { name: string; url: string };
  fetchedAt: string;
  tables: LootTable[];
  coven: CovenTable;
}

export type WispRound = 'Early' | 'EarlyMid' | 'Mid' | 'MidLate' | 'Late' | 'VeryLate';

export type WispCat = 'Champion' | 'Combat' | 'GoldXP' | 'Item' | 'Misc' | 'Risky' | 'Shop';

export interface Wisp {
  api: string;
  name: string;
  desc: string;
  tier: 1 | 2 | 3;
  // Art und selbst ausgeliefertes Bild (public/tft-extra/wisps/<set>/). Optional,
  // damit eine aeltere JSON ohne die Felder ohne Bild rendert statt zu brechen.
  cat?: WispCat;
  icon?: string;
  cost: number;
  rounds: WispRound[];
  doubles: boolean;
  tockers: boolean;
  req?: string;
  cooldown?: number;
  excl?: string[];
}

export interface WispEntry extends Wisp {
  variants: (Wisp & { kind: 'upgrade' | 'prismatic' })[];
}

export interface WispsFile {
  set: number;
  source: { name: string; url: string };
  fetchedAt: string;
  wisps: WispEntry[];
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(resolve(process.cwd(), 'public', file), 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw e; // kaputte Datei soll laut scheitern, nicht still leer bleiben
  }
}

export function readLootTables(): LootTablesFile | null {
  return readJson<LootTablesFile>(`tft-loot-tables-${CURRENT_SET}.json`);
}

export function readWisps(): WispsFile | null {
  return readJson<WispsFile>(`tft-wisps-${CURRENT_SET}.json`);
}
