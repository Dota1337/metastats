import 'server-only';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Lang } from '../i18n';
import { tftAssets, DATA_TIMEOUT_MS } from '../og/data';
import { withTimeout } from '../og/frame';
import { getLatestDdragonVersion } from '../ddragon-version-server';
import { tftTraitDisplayName } from '../tft-cdragon';
import { compSlugIds } from '../tft-cluster';

// Anzeigenamen fuer Seitentitel der Detailseiten. Nur lokale Daten (Asset-
// Bundle, Team-Liste) oder ein zwischengespeicherter Data-Dragon-Abruf mit
// Zeitlimit — ein Titel darf den Seitenaufruf nicht aufhalten. Fehlt ein Name,
// steht die lesbar gemachte Kennung im Titel statt eines erfundenen Namens.

/** `DA_18_Elderwood` / `TFT18_Ahri` → `Elderwood` / `Ahri` (wie og/data.ts). */
export function prettyId(id: string): string {
  return id.replace(/^(?:DA_)?(?:TFT\d*_|\d+_)?/i, '').replace(/^DA_?\d*_?/i, '').replace(/_/g, ' ') || id;
}

export function tftUnitName(id: string): string {
  return tftAssets()?.champions?.[id]?.name || prettyId(id);
}

export function tftItemName(id: string): string {
  return tftAssets()?.items?.[id]?.name || prettyId(id);
}

/** Trait-Liste und Unit-Seiten verlinken den Anzeigenamen, Comp-Seiten die Kennung. */
export function tftTraitName(param: string): string {
  const bundle = tftAssets();
  if (bundle?.traits?.[param]) return tftTraitDisplayName(bundle, param);
  return param;
}

/**
 * Kennt das Bundle des laufenden Sets diese Kennung? null = Bundle nicht
 * lesbar (dann keine Aussage, kein noindex). Comps: Trait, Carry und ggf.
 * zweiter Carry muessen bekannt sein.
 *
 * Bewusst nur das laufende Set, waehrend die Middleware alle Bundles kennt:
 * Detailseiten alter Sets (TFT17_…) antworten 200, zeigen aber keine Daten
 * mehr (die Seiten fragen das laufende Set ab) — sie gehoeren nicht in den
 * Index. Trait-Anzeigenamen werden wie in build-known-ids.mjs ueber das
 * name-Feld erkannt (Pfad = Kennung oder Anzeigename, E4).
 */
export function tftKnownInBundle(kind: 'unit' | 'item' | 'trait' | 'comp', id: string): boolean | null {
  const bundle = tftAssets();
  if (!bundle) return null;
  const champions = bundle.champions || {};
  const traits = bundle.traits || {};
  const traitKnown = (t: string) => !!traits[t] || Object.values(traits).some(v => v?.name === t);
  if (kind === 'unit') return !!champions[id];
  if (kind === 'item') return !!bundle.items?.[id];
  if (kind === 'trait') return traitKnown(id);
  const comp = compSlugIds(id);
  return !!comp && !!traits[comp.trait] && comp.units.every(u => !!champions[u]);
}

export function tftAugmentName(id: string, lang: Lang): string {
  const aug = tftAssets()?.augments?.[id];
  return aug?.i18n?.[lang]?.name || aug?.name || prettyId(id);
}

/** `esports-world-cup-2026` → `Esports World Cup 2026`. */
export function tournamentName(slug: string): string {
  return slug.split('-').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') || slug;
}

// ---------- LoL-Champions (Data Dragon, je Sprache) ----------

const DDRAGON_LOCALE: Record<Lang, string> = {
  de: 'de_DE', en: 'en_US', ko: 'ko_KR', zh: 'zh_CN', es: 'es_ES', fr: 'fr_FR',
};

export async function lolChampionName(id: string, lang: Lang): Promise<string> {
  const load = async () => {
    const version = await getLatestDdragonVersion();
    if (!version) return null;
    // Data Cache: ein Abruf je Sprache und Tag, nicht je Seitenaufruf.
    const res = await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${version}/data/${DDRAGON_LOCALE[lang]}/champion.json`,
      { next: { revalidate: 86400 } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Record<string, { name?: string }> };
    return data.data?.[id]?.name ?? null;
  };
  return (await withTimeout(load(), DATA_TIMEOUT_MS)) || id;
}

// ---------- LoL-Teams (public/pro-teams/index.json, wie app/teams/[id]/layout.tsx) ----------

let teamNames: Map<string, string> | null | undefined;

/** id → Name aller Teams; null, wenn die Datei fehlt (sie entsteht erst im Build). */
export function loadTeamNames(): Map<string, string> | null {
  if (teamNames !== undefined) return teamNames;
  try {
    const raw = readFileSync(path.join(process.cwd(), 'public', 'pro-teams', 'index.json'), 'utf8');
    const data = JSON.parse(raw) as { teams?: { id?: unknown; name?: unknown }[] };
    const entries = (data.teams || [])
      .filter((t): t is { id: string; name?: unknown } => typeof t.id === 'string')
      .map(t => [t.id, typeof t.name === 'string' && t.name ? t.name : t.id] as [string, string]);
    teamNames = entries.length > 0 ? new Map(entries) : null;
  } catch {
    teamNames = null;
  }
  return teamNames;
}
