import type { MetadataRoute } from 'next';
import { SITE_URL } from './lib/site';
import { CURRENT_SET } from './lib/current-set';
import { lookupSnapshot } from './lib/snapshot-lookup';
import { tftAssets } from './lib/og/data';
import { withTimeout } from './lib/og/frame';
import { listFamilyTargets, type CompApiRow } from './lib/tft-comp-families';
import { compCatalogReadEnabled, listPayloadWithCatalog } from './lib/tft-comp-catalog-resolver';
import { traitPath } from './lib/tft-trait-path';
import { itemCanonicalId } from './lib/tft-item-path';
import { compPath } from './lib/tft-comp-path';
import { resolveDefaultBucket } from './lib/tft-supabase-reader';
import { getLatestDdragonVersion } from './lib/ddragon-version-server';
import { LANGS, langAlternates, langPathsEnabled, withLangPrefix } from './lib/lang-path';
import { lolHome, TFT_HOME } from './lib/games';

// Die Route ist dynamisch (das Snapshot-Manifest wird mit cache: 'no-store'
// gelesen, snapshot-lookup.ts), ein `revalidate` griffe nicht. Deshalb merkt
// sich jede Server-Instanz die Eintraege je Quelle 6 Stunden — der Publisher
// laeuft mehrmals am Tag, die Detailseiten-Liste muss nicht minutengenau sein.
const SOURCE_TTL_MS = 6 * 60 * 60 * 1000;

// Kein Besucher wartet auf die Sitemap, deshalb grosszuegiger als die 1,5 s
// der Seitentitel. Faellt eine Quelle aus, fehlen nur ihre Eintraege — die
// statischen Seiten stehen immer drin.
const SOURCE_TIMEOUT_MS = 8000;
// Units mit weniger Spielen sind Randerscheinungen (Beschwoerungen, kaum
// gespielte Fuenfer) — deren Detailseiten haben zu wenig Inhalt.
const MIN_UNIT_GAMES = 100;

type Freq = NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;
interface Entry { path: string; priority: number; changeFrequency: Freq }

// Keine Weiterleitungen in die Sitemap: ist TFT die Hauptseite, leitet `/` um
// und die LoL-Startseite steht unter `/lol` (lolHome, app/lib/games.ts).
const STATIC_ROUTES: Entry[] = [
  { path: lolHome(), priority: 1.0, changeFrequency: 'daily' },
  // LoL
  { path: '/leaderboard', priority: 0.9, changeFrequency: 'hourly' },
  { path: '/champions', priority: 0.8, changeFrequency: 'daily' },
  { path: '/marktwert', priority: 0.8, changeFrequency: 'hourly' },
  { path: '/teams', priority: 0.7, changeFrequency: 'daily' },
  { path: '/ligen', priority: 0.7, changeFrequency: 'daily' },
  // /compare und /tft/compare fehlen bewusst: ohne gewaehlte Spieler sind sie
  // leer und stehen auf noindex (Soft-404-Plan 26.10.2026).
  // TFT hub. Die Uebersicht ist die TFT-Startseite; als erster /tft/comps/-
  // Eintrag ist sie zugleich eine 200er-Probe des Vertrags seo/detail-404.
  { path: TFT_HOME, priority: 0.9, changeFrequency: 'daily' },
  { path: '/tft/comps', priority: 0.9, changeFrequency: 'daily' },
  { path: '/tft/leaderboard', priority: 0.9, changeFrequency: 'hourly' },
  { path: '/tft/marktwert', priority: 0.8, changeFrequency: 'hourly' },
  { path: '/tft/units', priority: 0.8, changeFrequency: 'daily' },
  { path: '/tft/items', priority: 0.8, changeFrequency: 'daily' },
  { path: '/tft/traits', priority: 0.8, changeFrequency: 'daily' },
  { path: '/tft/augments', priority: 0.7, changeFrequency: 'daily' },
  { path: '/tft/tournaments', priority: 0.7, changeFrequency: 'daily' },
  { path: '/tft/rising', priority: 0.7, changeFrequency: 'daily' },
  { path: '/tft/patch', priority: 0.7, changeFrequency: 'daily' },
  { path: '/tft/patch/winners', priority: 0.8, changeFrequency: 'daily' },
  { path: '/tft/builder', priority: 0.6, changeFrequency: 'weekly' },
];

// Standardansicht der Listen (alle Regionen, 3 Tage, Diamond+, aktueller
// Patch) — dieselben Snapshot-Schluessel, die ein Besucher ohne Filter trifft.
function listSnapshot(endpoint: 'comps' | 'units' | 'items' | 'traits', bucket = 'diamond_plus') {
  return withTimeout(lookupSnapshot(endpoint, {
    patch: null, region: 'all', days: 3, bucket, minGames: 0, setNumber: CURRENT_SET,
  }), SOURCE_TIMEOUT_MS);
}

// Die 40 Comp-Familien der Liste, verlinkt wie dort (familyLinkKey = die
// Adresse, die die Comp-Seite als canonical nennt) — dieselbe Auswahl und
// derselbe Rang (resolveDefaultBucket), nach denen der Publisher den
// Detail-Vorrat anlegt (/api/tft/comps/families). Bis 09.11.2026 stand hier
// familyLinkSlug: 4 von 40 Eintraegen nannten als canonical eine andere Comp.
async function compEntries(): Promise<Loaded> {
  const bucket = (await withTimeout(resolveDefaultBucket(), SOURCE_TIMEOUT_MS)) ?? 'diamond_plus';
  const hit = await listSnapshot('comps', bucket);
  // Comp-Katalog wie die Route, sonst verlinkte die Sitemap klassische Familien.
  const payload = hit?.payload
    ? await withTimeout(listPayloadWithCatalog(hit.payload as { comps?: unknown; filters?: unknown }), SOURCE_TIMEOUT_MS)
    : null;
  const rows = (payload as { comps?: CompApiRow[] } | null)?.comps;
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const entries = listFamilyTargets(rows, tftAssets()).map(t => ({
    path: compPath(t.linkKey),
    priority: 0.7,
    changeFrequency: 'daily' as const,
  }));
  // Katalog an, aber keine Zeile mit Comp: der Katalog fehlte gerade, das sind
  // klassische Familien, deren Seiten auf eine andere Comp zeigen koennen. Nur
  // fuer diesen Abruf nutzen, nicht 6 h merken.
  const fallback = compCatalogReadEnabled() && !rows.some(r => typeof r.compKey === 'string');
  return { entries, keep: !fallback };
}

async function unitEntries(): Promise<Entry[]> {
  const hit = await listSnapshot('units');
  const units = (hit?.payload as { units?: Array<{ characterId?: string; games?: number }> } | undefined)?.units;
  const champions = tftAssets()?.champions;
  if (!Array.isArray(units) || !champions) return [];
  return units
    .filter(u => typeof u.characterId === 'string' && champions[u.characterId] && (u.games ?? 0) >= MIN_UNIT_GAMES)
    .map(u => ({ path: `/tft/units/${encodeURIComponent(u.characterId!)}`, priority: 0.6, changeFrequency: 'daily' as const }));
}

// Gespielte Items, die Riot im laufenden Set auch anbietet (active.items),
// unter ihrer eigentlichen Adresse (gleichnamige Augment-Variante → Grund-Item,
// tft-item-path.ts), jede nur einmal.
async function itemEntries(): Promise<Entry[]> {
  const hit = await listSnapshot('items');
  const items = (hit?.payload as { items?: Array<{ apiName?: string; games?: number }> } | undefined)?.items;
  const bundle = tftAssets();
  const active = bundle?.active?.items;
  if (!Array.isArray(items) || !Array.isArray(active)) return [];
  const activeSet = new Set(active);
  const ids = new Set(items
    .filter(it => typeof it.apiName === 'string' && activeSet.has(it.apiName) && (it.games ?? 0) > 0)
    .map(it => itemCanonicalId(bundle?.items, it.apiName!)));
  return [...ids].map(id => ({ path: `/tft/items/${encodeURIComponent(id)}`, priority: 0.6, changeFrequency: 'daily' as const }));
}

// Gespielte Traits unter ihrem Anzeigenamen — so verlinken Trait-Liste und
// Unit-Seiten, und so steht das canonical der Seite (traits/[name]/layout.tsx).
async function traitEntries(): Promise<Entry[]> {
  const hit = await listSnapshot('traits');
  const rows = (hit?.payload as { traits?: Array<{ name?: string; games?: number }> } | undefined)?.traits;
  const traits = tftAssets()?.traits;
  if (!Array.isArray(rows) || !traits) return [];
  const paths = new Set<string>();
  for (const r of rows) {
    if (typeof r.name === 'string' && traits[r.name] && (r.games ?? 0) > 0) paths.add(traitPath(traits, r.name));
  }
  return [...paths].map(path => ({ path, priority: 0.5, changeFrequency: 'daily' as const }));
}

async function lolChampionEntries(): Promise<Entry[]> {
  const version = await withTimeout(getLatestDdragonVersion(), SOURCE_TIMEOUT_MS);
  if (!version) return [];
  const data = await withTimeout(
    fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`)
      .then(r => (r.ok ? r.json() : null)) as Promise<{ data?: Record<string, { id?: string }> } | null>,
    SOURCE_TIMEOUT_MS,
  );
  const ids = Object.values(data?.data ?? {}).map(c => c.id).filter((id): id is string => typeof id === 'string');
  return ids.map(id => ({ path: `/champions/${encodeURIComponent(id)}`, priority: 0.6, changeFrequency: 'daily' as const }));
}

// Nur volle Ergebnisse merken: eine ausgefallene Quelle wird beim naechsten
// Abruf neu versucht statt 6 Stunden leer zu bleiben. `keep: false` = Ersatz-
// Ergebnis (Comps ohne Katalog), gilt nur fuer diesen Abruf.
type Loaded = Entry[] | { entries: Entry[]; keep: boolean };
const memo = new Map<string, { at: number; entries: Entry[] }>();

async function remembered(name: string, load: () => Promise<Loaded>): Promise<Entry[]> {
  const hit = memo.get(name);
  if (hit && Date.now() - hit.at < SOURCE_TTL_MS) return hit.entries;
  const loaded = await load().catch((e: Error) => {
    console.error(`[sitemap] ${name} failed:`, e?.message);
    return [] as Entry[];
  });
  const { entries, keep } = Array.isArray(loaded) ? { entries: loaded, keep: true } : loaded;
  if (entries.length > 0 && keep) memo.set(name, { at: Date.now(), entries });
  return entries.length > 0 ? entries : hit?.entries ?? [];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const sources = { comps: compEntries, units: unitEntries, items: itemEntries, traits: traitEntries, champions: lolChampionEntries };
  const dynamic = await Promise.all(Object.entries(sources).map(([name, load]) => remembered(name, load)));
  const seen = new Set<string>();
  const entries = [...STATIC_ROUTES, ...dynamic.flat()]
    .filter(r => (seen.has(r.path) ? false : (seen.add(r.path), true)));
  // Jede Seite in allen sechs Sprach-Adressen, jede mit allen Alternativen
  // (hreflang, x-default = Englisch). Notschalter LANG_PATHS=0: nur Deutsch.
  if (!langPathsEnabled()) {
    return entries.map(r => ({ url: `${SITE_URL}${r.path}`, lastModified: now, changeFrequency: r.changeFrequency, priority: r.priority }));
  }
  return entries.flatMap(r => {
    const languages = langAlternates(SITE_URL, r.path);
    return LANGS.map(l => ({
      url: `${SITE_URL}${withLangPrefix(l, r.path)}`,
      lastModified: now,
      changeFrequency: r.changeFrequency,
      priority: r.priority,
      alternates: { languages },
    }));
  });
}
