// Champion-Detail aus Data Dragon (champion/<id>.json je Sprache). Ohne
// Server-Importe: der Browser (ChampionDetailClient.tsx) und die Server-Huelle
// (app/lib/seo/lol-data.ts) formen die Antwort mit derselben Funktion, damit
// Startdaten und Abruf im Browser genau dasselbe zeigen.
import type { Lang } from './i18n';

// Data Dragon erwartet `xx_YY` (de_DE, en_US, …), die Seite speichert
// Sprachen als Kurzform (de, en, …).
export const DDRAGON_LOCALE: Record<Lang, string> = {
  de: 'de_DE', en: 'en_US', ko: 'ko_KR', zh: 'zh_CN', es: 'es_ES', fr: 'fr_FR',
};

export interface ChampionSpell {
  id: string;
  name: string;
  description: string;
  image: { full: string };
}

export interface ChampionPassive {
  name: string;
  description: string;
  image: { full: string };
}

export interface ChampionStats {
  hp: number;
  hpperlevel: number;
  mp: number;
  mpperlevel: number;
  armor: number;
  armorperlevel: number;
  spellblock: number;
  spellblockperlevel: number;
  attackdamage: number;
  attackdamageperlevel: number;
  attackspeed: number;
  attackspeedperlevel: number;
  movespeed: number;
  attackrange: number;
}

export interface ChampionSkin {
  id: string;
  num: number;
  name: string;
  chromas: boolean;
}

export interface ChampionData {
  id: string;
  key: string;
  name: string;
  title: string;
  tags: string[];
  lore: string;
  allytips: string[];
  enemytips: string[];
  stats: ChampionStats;
  spells: ChampionSpell[];
  passive: ChampionPassive;
  skins: ChampionSkin[];
}

/** Startdaten der Detailseite: gelten nur fuer genau diese Kennung und Sprache. */
export interface ChampionDetailStart {
  id: string;
  lang: Lang;
  version: string;
  champion: ChampionData;
}

export function championDetailUrl(version: string, lang: Lang, id: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/data/${DDRAGON_LOCALE[lang] || 'en_US'}/champion/${id}.json`;
}

// Rohform aus Data Dragon, nur die gelesenen Felder.
interface RawImage { full?: unknown }
interface RawSpell { id: string; name: string; description: string; image?: RawImage }
interface RawSkin { id: string; num: number; name?: string; chromas?: boolean }
interface RawChampion {
  id: string; key: string; name: string; title: string; tags?: string[]; lore?: string;
  allytips?: string[]; enemytips?: string[]; stats: ChampionStats; spells?: RawSpell[];
  passive?: { name?: string; description?: string; image?: RawImage }; skins?: RawSkin[];
}

const image = (img: RawImage | undefined) => ({ full: String(img?.full ?? '') });

/** Nur die Felder, die die Seite zeigt; null, wenn die Antwort den Champion nicht enthaelt. */
export function pickChampionDetail(data: unknown, id: string): ChampionData | null {
  const c = (data as { data?: Record<string, RawChampion> } | null)?.data?.[id];
  if (!c) return null;
  return {
    id: c.id,
    key: c.key,
    name: c.name,
    title: c.title,
    tags: Array.isArray(c.tags) ? c.tags : [],
    lore: c.lore ?? '',
    allytips: Array.isArray(c.allytips) ? c.allytips : [],
    enemytips: Array.isArray(c.enemytips) ? c.enemytips : [],
    stats: c.stats,
    spells: (Array.isArray(c.spells) ? c.spells : []).map(s => ({
      id: s.id, name: s.name, description: s.description, image: image(s.image),
    })),
    passive: { name: c.passive?.name ?? '', description: c.passive?.description ?? '', image: image(c.passive?.image) },
    // Chroma-Varianten fuehrt Riot als eigene Skins mit `<Original> (Farbe)` im
    // Namen; der Merker `chromas` am Original sagt das schon — in der Galerie
    // waeren sie nur Rauschen.
    skins: (Array.isArray(c.skins) ? c.skins : [])
      .filter(s => !/\s+\([^)]+\)\s*$/.test(s.name || ''))
      .map(s => ({ id: s.id, num: s.num, name: s.name ?? '', chromas: !!s.chromas })),
  };
}
