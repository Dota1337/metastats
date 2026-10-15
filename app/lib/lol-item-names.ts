// Englische Item-Namen aus Data Dragon fuer die Builds-Route
// (app/api/champions/[id]/builds). Ein Zusatz, nie Pflicht: jeder Fehler
// ergibt null, die Antwort geht dann ohne `itemNames` raus und der Block zeigt
// „Item N“. Warum die Namen in der Antwort reisen: lol-builds-view.ts.
//
// Ohne 'server-only', damit der Test den Abruf ersetzen kann — hier liegt
// nichts Geheimes. Speicher je Prozess: das Versprechen je Version, damit
// gleichzeitige Kaltstarts item.json (688 KB) nur einmal laden; uebrig bleibt
// die fertige Tabelle (~23 KB). Ein Fehlschlag gilt 60 s — sonst wartete bei
// einem Data-Dragon-Ausfall jede Antwort das volle Zeitlimit ab.
import { itemNamesFrom, usedItemIds, type ItemLists } from './lol-builds-view';

const VERSION = /^\d+\.\d+\.\d+$/;
const TIMEOUT_MS = 2000;
const FAIL_MS = 60_000;
// Datei bis 6 h alt + Datenbank auf der neuesten Version: zwei reichen beim Patchwechsel.
const KEEP_VERSIONS = 2;

type Names = Record<string, string>;
interface Entry { table: Promise<Names | null>; failedAt?: number }
const memo = new Map<string, Entry>();

async function load(version: string): Promise<Names | null> {
  try {
    const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Data Cache: die Adresse traegt die Version, der Inhalt aendert sich nie.
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const data = ((await res.json()) as { data?: Record<string, unknown> } | null)?.data;
    const table = itemNamesFrom(data, Object.keys(data || {}).map(Number));
    return Object.keys(table).length ? table : null;
  } catch {
    return null;
  }
}

/** Alle Namen einer Data-Dragon-Version. Wirft nie. `now` nur fuer Tests. */
export function lolItemNameTable(version: string, now = Date.now()): Promise<Names | null> {
  if (!VERSION.test(version)) return Promise.resolve(null);
  const hit = memo.get(version);
  if (hit && !(hit.failedAt !== undefined && now - hit.failedAt > FAIL_MS)) return hit.table;
  const entry: Entry = { table: load(version) };
  void entry.table.then((t) => { if (!t) entry.failedAt = Date.now(); });
  memo.set(version, entry);
  while (memo.size > KEEP_VERSIONS) memo.delete(memo.keys().next().value as string);
  return entry.table;
}

/** Die Antwort mit `itemNames` fuer ihre Items — unveraendert, wenn keine Namen da sind. */
export async function withItemNames<T extends { roles?: Record<string, ItemLists | undefined>; ddragonVersion?: string }>(
  body: T,
): Promise<T & { itemNames?: Names }> {
  const table = body.ddragonVersion ? await lolItemNameTable(body.ddragonVersion) : null;
  if (!table) return body;
  const itemNames: Names = {};
  for (const id of usedItemIds(body)) {
    const name = table[String(id)];
    if (name) itemNames[String(id)] = name;
  }
  return Object.keys(itemNames).length ? { ...body, itemNames } : body;
}
