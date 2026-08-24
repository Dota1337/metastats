// Die CommunityDragon-Base, gegen die der Bild-Proxy (`app/api/img/[...p]`)
// seine Allowlist prueft.
//
// Warum eine eigene Datei und nicht `bundle.iconBase`: die Route laeuft
// serverseitig und haette sonst `public/tft-assets.json` (1,8 MB) laden und
// parsen muessen, nur um ein einziges Feld zu lesen — bei jedem Cold-Start.
//
// Damit gibt es das Literal zweimal: hier und in `scripts/fetch-tft-assets.mjs`
// (dort geschrieben, hier geprueft). Genau die Mirror-Pair-Falle aus
// `reference_dual_module_patterns.md`. Deshalb vergleicht `check-drift.mjs`
// diese Konstante mechanisch gegen `public/tft-assets.json`.iconBase — wer den
// Wert an einer Stelle dreht, wird beim pre-push gestoppt.
export const CDRAGON_GAME_BASE = 'https://raw.communitydragon.org/latest/game/';

// Pfad-Praefixe, die im Bundle tatsaechlich vorkommen. Gemessen ueber alle
// icon/tile-Felder von items/champions/traits/augments: 4.107x assets/maps,
// 481x assets/ux, 323x assets/characters (2.650 distinkte Pfade). Ohne diese
// Schranke reicht die Route CommunityDragons kompletten Baum durch.
export const CDRAGON_PATH_PREFIXES = ['assets/maps/', 'assets/characters/', 'assets/ux/'] as const;

// Nur echte Bild-Endungen. Im Bundle: 4.911x .png, sonst nichts (die 10
// restlichen Eintraege sind woertlich der String "none" — kein Pfad, siehe
// tftIconUrl). jpg/jpeg/webp sind Vorrat fuer kuenftige CDragon-Formate.
const IMG_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

// Der Content-Type wird aus der Endung bestimmt, NICHT von upstream
// uebernommen: sonst entscheidet CommunityDragon, als was unser Origin den
// Body ausliefert.
export function imageContentType(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return IMG_EXT[ext] ?? null;
}

// Ein CDragon-Pfad ist genau dann proxybar, wenn er unter einem bekannten
// Praefix liegt, eine Bild-Endung hat und kein Segment enthaelt, das aus der
// Base herausfuehren koennte. Die Rueckgabe ist die gepruefte absolute URL —
// der Aufrufer baut sie nicht selbst noch einmal zusammen.
export function safeCdragonUrl(segments: string[]): string | null {
  if (segments.length === 0) return null;
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') return null;
    if (seg.includes('\\') || seg.includes('\0') || seg.includes('/')) return null;
  }
  const path = segments.join('/');
  if (!CDRAGON_PATH_PREFIXES.some((p) => path.startsWith(p))) return null;
  if (!imageContentType(path)) return null;

  // Zweite Schranke nach dem URL-Bau. Die Segment-Pruefung oben deckt den
  // dekodierten Normalfall ab; diese hier faengt alles, was `new URL()` noch
  // umschreibt, bevor daraus ein Fetch wird.
  const url = new URL(path, CDRAGON_GAME_BASE);
  if (!url.href.startsWith(CDRAGON_GAME_BASE)) return null;
  if (url.search || url.hash) return null;
  return url.href;
}

// Zweite CDragon-Base: die LoL-Rank-Embleme liegen unter `latest/plugins/`,
// nicht unter `latest/game/`. Sie sind damit bewusst NICHT proxybar — die
// Allowlist oben deckt nur den Game-Baum ab — und laufen weiter direkt zum
// Browser. Der Wert steht hier statt in den Seiten, weil `rankEmblemUrl()
// bis 2026-08-24 wortgleich in `app/compare/page.tsx` und
// `app/tft/compare/page.tsx` stand: ein Duplikat ohne Waechter, genau die
// Bauform aus `reference_dual_module_patterns.md`.
export const CDRAGON_PLUGINS_BASE = 'https://raw.communitydragon.org/latest/plugins/';

// Tier-Strings kommen aus der Ranked-API in Grossschreibung; die Dateinamen
// sind klein.
export function rankEmblemUrl(tier: string | null | undefined): string | null {
  if (!tier) return null;
  return `${CDRAGON_PLUGINS_BASE}rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${tier.toLowerCase()}.png`;
}
