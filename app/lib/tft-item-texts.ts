// Item-Texte (Beschreibung + Werte) je Sprache, aus public/tft-item-texts-{set}.json.
//
// Die Datei baut scripts/refresh-item-texts.mjs aus den Sprachdateien von
// tactics.tools, weil CommunityDragon fuer Set-18-Items keine Beschreibung
// liefert (siehe Kopf des Skripts). Muster wie tft-augment-stages.ts: eigener
// Abruf, Ergebnis gecacht, bei jedem Fehler null — dann zeigt die Seite nur
// den Namen wie vorher, nie einen erfundenen Text.

import { CURRENT_SET } from './current-set';
import { formatTftDesc } from './tft-desc-format';
import type { Lang } from './lang-path';

export interface ItemTextLocale {
  name?: string;
  desc?: string;
  stats?: string;
}

export interface ItemTextEntry {
  // "Unique - only 1 per champion" im englischen Text
  unique?: boolean;
  // Thief's Gloves: belegt alle drei Plaetze
  slots?: number;
  // Tactician's Crown/Cape/Shield: "+1 maximum team size"
  teamSize?: number;
  i18n: Partial<Record<Lang, ItemTextLocale>>;
}

export interface ItemTexts {
  set: number;
  source: string;
  fetchedAt: string;
  items: Record<string, ItemTextEntry>;
}

let cached: Promise<ItemTexts | null> | null = null;

export function loadItemTexts(): Promise<ItemTexts | null> {
  if (!cached) {
    cached = fetch(`/tft-item-texts-${CURRENT_SET}.json`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => (j && typeof j === 'object' && j.items ? (j as ItemTexts) : null))
      .catch(() => null);
  }
  return cached;
}

export interface ItemStat {
  // Wert wie im Spiel, z. B. "55%" oder "150"
  value: string;
  // Symbol-Schluessel aus %i:<key>%, z. B. "scaleAD"
  key: string;
}

// Werte-Zeile in Paare zerlegen: "55% %i:scaleAD% 10% %i:scaleDA%",
// Radiant "40 %i:scaleAD%%", Deutsch "40 %i:scaleAD% %". Ein % hinter dem
// Symbol gehoert zum Wert, aber nicht das % eines folgenden %i:-Symbols.
export function parseStatLine(raw: string | null | undefined): ItemStat[] {
  if (!raw) return [];
  const out: ItemStat[] = [];
  const re = /([+-]?\d+(?:[.,]\d+)?)\s*(%?)\s*%i:(\w+)%(?:\s*(%)(?!i:))?/g;
  for (const m of String(raw).matchAll(re)) {
    out.push({ value: m[1] + (m[2] || m[4] ? '%' : ''), key: m[3] });
  }
  return out;
}

export interface ItemTextView {
  name: string | null;
  desc: string;
  stats: ItemStat[];
}

// Text in der gewaehlten Sprache, sonst Englisch. null, wenn es fuer das Item
// keinen Text gibt.
export function itemTextFor(texts: ItemTexts | null, id: string, lang: Lang): ItemTextView | null {
  const e = texts?.items?.[id];
  if (!e) return null;
  const loc = e.i18n[lang]?.desc ? e.i18n[lang]! : e.i18n.en;
  if (!loc?.desc) return null;
  return {
    name: loc.name || null,
    desc: formatTftDesc(loc.desc),
    stats: parseStatLine(loc.stats),
  };
}
