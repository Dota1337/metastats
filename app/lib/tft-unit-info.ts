// Faehigkeit und Grundwerte einer Unit, aus public/tft-unit-info-{set}.json
// (scripts/refresh-unit-info.mjs: Text von tactics.tools, Werte von
// CommunityDragon). Die Unit-Detailseite bekommt ihren Teil mit dem ersten
// HTML (tft-unit-info-server.ts); fehlt er, laedt der Browser die Datei.
// Erfundene Werte gibt es nie — fehlt etwas, zeigt die Karte es nicht.

import { CURRENT_SET } from './current-set';
import type { Lang } from './lang-path';

export interface UnitBaseStats {
  hp: number | null; mana: number | null; initialMana: number | null;
  armor: number | null; magicResist: number | null; attackSpeed: number | null;
  damage: number | null; critChance: number | null; critMultiplier: number | null;
  range: number | null;
}

export interface UnitInfoEntry {
  stats: UnitBaseStats | null;
  ability: { name: Partial<Record<Lang, string>>; desc: Partial<Record<Lang, string>> };
  /** Basis-Unit: IDs ihrer Formen (Lux). */
  forms?: string[];
  /** Form: ID der Basis und Name der Form je Sprache. */
  formOf?: string;
  form?: Partial<Record<Lang, string>>;
}

export interface UnitInfoFile {
  set: number;
  source: string;
  fetchedAt: string;
  units: Record<string, UnitInfoEntry>;
}

let cached: Promise<UnitInfoFile | null> | null = null;

export function loadUnitInfo(): Promise<UnitInfoFile | null> {
  if (!cached) {
    cached = fetch(`/tft-unit-info-${CURRENT_SET}.json`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => (j && typeof j === 'object' && j.units && Number(j.set) === CURRENT_SET ? (j as UnitInfoFile) : null))
      .catch(() => null);
  }
  return cached;
}

/** Text in der gewaehlten Sprache, sonst Englisch. */
export function pickLang<T>(m: Partial<Record<Lang, T>> | undefined, lang: Lang): T | undefined {
  return m?.[lang] ?? m?.en;
}

// ─── Werte je Stern ─────────────────────────────────────────────────────────
// Leben x1,8 und Angriffsschaden x1,5 je Stern (Spielregel; gegen MetaTFT
// geprueft: Lux 900/1620/2916 und 40/60/90). Alle anderen Werte bleiben.
export const STAR_HP = 1.8;
export const STAR_AD = 1.5;
export const statByStar = (base: number | null, factor: number, stars = 3): number[] | null =>
  base == null ? null : Array.from({ length: stars }, (_, i) => Math.round(base * factor ** i));

// ─── Faehigkeits-Text ───────────────────────────────────────────────────────
// Markup von tactics.tools: <bright>, <colormagic>/<colormagical>,
// <colorphysical>, <colorhealth>, <colorstat>, <keyword>, <dim>, <rules>,
// <row>, <br>, Symbole %i:scaleAP%. Unbekannte Tags fallen weg, ihr Text bleibt.

export type AbilityStyle = 'bright' | 'magic' | 'physical' | 'health' | 'stat' | 'keyword' | 'dim' | 'rules';

export type AbilitySeg =
  | { k: 'text'; text: string; style: AbilityStyle | null }
  // "375/565/6500": Werte je Stern, damit die Karte den gewaehlten hervorhebt.
  | { k: 'stars'; values: string[]; suffix: string; style: AbilityStyle | null }
  | { k: 'icon'; icon: string; style: AbilityStyle | null };

const TAG_STYLE: Record<string, AbilityStyle> = {
  bright: 'bright', colormagic: 'magic', colormagical: 'magic', colorphysical: 'physical',
  colorhealth: 'health', colorstat: 'stat', keyword: 'keyword', dim: 'dim', rules: 'rules',
};
// Die Regel-Erklaerung ("Burn: …") beginnt eine eigene Zeile. <row> steht
// bei tactics.tools mitten im Satz ("<row>Gain </row><row>2</row>") — inline.
const BLOCK_TAGS = new Set(['rules']);

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const STARS_RE = new RegExp(String.raw`(${NUM}%?)((?:\s*\/\s*${NUM}%?){1,3})(%?)`, 'g');

function pushText(line: AbilitySeg[], text: string, style: AbilityStyle | null) {
  if (!text) return;
  let last = 0;
  for (const m of text.matchAll(STARS_RE)) {
    const values = [m[1], ...m[2].split('/').slice(1)].map(v => v.trim());
    if (m.index! > last) line.push({ k: 'text', text: text.slice(last, m.index), style });
    line.push({ k: 'stars', values, suffix: m[3] || '', style });
    last = m.index! + m[0].length;
  }
  if (last < text.length) line.push({ k: 'text', text: text.slice(last), style });
}

/** Zeilen aus Segmenten; leere Zeilen trennen Absaetze. */
export function parseAbilityDesc(raw: string | null | undefined): AbilitySeg[][] {
  const lines: AbilitySeg[][] = [[]];
  if (!raw) return [];
  const stack: AbilityStyle[] = [];
  const cur = () => lines[lines.length - 1];
  const newLine = () => { if (cur().length) lines.push([]); };
  const style = () => (stack.length ? stack[stack.length - 1] : null);
  const re = /<(\/?)([a-zA-Z]+)[^>]*>|%i:(\w+)%/g;
  const src = String(raw).replace(/\r/g, '').replace(/\\n/g, '\n');
  // Nach einem Block geht es in der naechsten Zeile weiter; ein <br> direkt
  // danach ist dieser Umbruch und keine Leerzeile.
  let breakNext = false;
  const text = (part: string) => {
    if (!part) return;
    if (breakNext && part.trim()) { newLine(); breakNext = false; }
    pushText(cur(), part, style());
  };
  let last = 0;
  for (const m of src.matchAll(re)) {
    src.slice(last, m.index).split('\n').forEach((part, i) => { if (i > 0) lines.push([]); text(part); });
    last = m.index! + m[0].length;
    if (m[3]) {
      if (breakNext) { newLine(); breakNext = false; }
      cur().push({ k: 'icon', icon: m[3], style: style() });
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'br') {
      if (breakNext) { newLine(); breakNext = false; } else lines.push([]);
      continue;
    }
    if (BLOCK_TAGS.has(tag)) { if (closing) breakNext = true; else newLine(); }
    const st = TAG_STYLE[tag];
    if (st) {
      if (closing) { const at = stack.lastIndexOf(st); if (at >= 0) stack.splice(at, 1); }
      else stack.push(st);
    }
  }
  text(src.slice(last));
  // Leerraum an Zeilenraendern weg, mehrere Leerzeilen zu einer.
  const out: AbilitySeg[][] = [];
  for (const l of lines) {
    const segs = l.filter(s => s.k !== 'text' || s.text.length);
    if (segs[0]?.k === 'text') segs[0] = { ...segs[0], text: segs[0].text.replace(/^\s+/, '') };
    const end = segs[segs.length - 1];
    if (end?.k === 'text') segs[segs.length - 1] = { ...end, text: end.text.replace(/\s+$/, '') };
    const clean = segs.filter(s => s.k !== 'text' || s.text.length);
    if (!clean.length && (!out.length || !out[out.length - 1].length)) continue;
    out.push(clean);
  }
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
}
