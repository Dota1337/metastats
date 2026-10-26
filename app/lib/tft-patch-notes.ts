// Patch-Notes-Override Reader. Quelle: tactics.tools/info/patch-notes,
// gescraped via scripts/refresh-patch-notes.mjs nach
// public/tft-patch-notes-{set}.json.
//
// Pattern analog zu tft-augment-stages.ts / tft-augment-tiers-Override —
// scraped third-party constants per Set + Patch, gerendert auf der
// /tft/patch/[version] Detail-Page als zusätzliche „Was hat sich
// geändert"-Sektion.
//
// Datenquellen-Doku: reference_tft_patch_notes_source.md

import { CURRENT_SET } from './current-set';

export interface PatchNoteEntry {
  apiName: string | null;   // null bei nicht-aufgelöstem Entity
  displayName: string;
  change: string;
}

export interface PatchNoteSection {
  category: string;          // h2-Title z.B. „LARGE CHANGES" / „BUG FIXES"
  entries: PatchNoteEntry[];
}

export interface PatchNoteOverride {
  set: number;
  source: string;
  fetchedAt: string;
  patches: Record<string, {
    scrapedAt: string;
    sections: PatchNoteSection[];
    counts: { totalEntries: number; withApiName: number };
  }>;
}

// Riot-Patch-Notes-URL je Locale. KORRIGIERT 2026-06-21 nach classification-
// reviewer Spot-Check: richtige Subdomain ist `teamfighttactics.leagueof
// legends.com` (NICHT www.leagueoflegends.com), und das `-notes`-Suffix
// gehört NICHT mehr in den URL-Pfad (Set 17 hat `patch-X-Y/`, nicht
// `patch-X-Y-notes/`). Konsistent mit dem existing tftPatchUrl()-Helper
// in app/api/tft/patch-notes/route.ts.
// B-Patches (18.5b) haben keine eigene Seite (Riot: 404 auf patch-18-5b,
// 200 auf patch-18-5, gemessen 26.10.2026) — sie stehen in den Notes des
// Hauptpatches, also ohne den Buchstaben verlinken.
export function riotPatchNotesUrl(patch: string, lang: string): string {
  const localeMap: Record<string, string> = {
    de: 'de-de', en: 'en-us', ko: 'ko-kr', zh: 'zh-cn', es: 'es-es', fr: 'fr-fr',
  };
  const locale = localeMap[lang] || 'en-us';
  const slug = patch.replace(/[a-z]+$/i, '').replace(/\./g, '-');
  return `https://teamfighttactics.leagueoflegends.com/${locale}/news/game-updates/teamfight-tactics-patch-${slug}/`;
}

let cached: Promise<PatchNoteOverride | null> | null = null;

export function loadPatchNotes(): Promise<PatchNoteOverride | null> {
  if (!cached) {
    cached = fetch(`/tft-patch-notes-${CURRENT_SET}.json`)
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
  }
  return cached;
}

// Returnt die Patch-Notes für eine spezifische Patch-Version, oder null
// wenn der Patch noch nicht gescraped wurde.
export function patchNotesFor(
  override: PatchNoteOverride | null,
  patch: string,
): { sections: PatchNoteSection[]; scrapedAt: string } | null {
  if (!override?.patches) return null;
  const entry = override.patches[patch];
  if (!entry) return null;
  return { sections: entry.sections, scrapedAt: entry.scrapedAt };
}

// Bestimme Entity-Detail-URL für apiName (Champion / Augment / Trait /
// Item). Wir nutzen Bundle-Tags (Prefix-Pattern) um die richtige Detail-
// Page zu wählen.
export function patchEntityHref(apiName: string | null): string | null {
  if (!apiName) return null;
  if (/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?Augment_/i.test(apiName)) return `/tft/augments/${encodeURIComponent(apiName)}`;
  if (/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?Item_/i.test(apiName)) return `/tft/items/${encodeURIComponent(apiName)}`;
  // Champion + Trait teilen sich das gleiche TFT<N>_<Name>-Pattern.
  // Pragmatic-Default: wir linken auf /tft/units — die Detail-Page wird ein
  // 404 zeigen wenn es ein Trait war. UI-Polish-Iteration: später disambi-
  // guieren via Bundle-Lookup.
  return `/tft/units/${encodeURIComponent(apiName)}`;
}
