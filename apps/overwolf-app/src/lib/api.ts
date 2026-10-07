// Abruf von /api/companion/v1/* mit Zwischenspeicher in localStorage.
// Fenster lesen zuerst den gespeicherten Stand und laden nur nach, wenn er
// aelter als die Frist ist — im Spiel wird so nie auf das Netz gewartet.
import type {
  CompanionCompDetail, CompanionCompsResponse, CompanionItemDetail, CompanionItemsResponse,
  CompanionLookups, CompanionPlayerResponse, CompanionUnitDetail, CompanionUnitsResponse,
} from '../../../../app/lib/companion-types.ts';
import { API_BASE } from './config.ts';
import { read, write } from './store.ts';

const COMPS_TTL = 30 * 60 * 1000;
const LOOKUPS_TTL = 6 * 60 * 60 * 1000;

async function getJson<T>(path: string, timeoutMs = 20000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API_BASE + path, { signal: ctrl.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status, code: body?.error });
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadComps(force = false): Promise<CompanionCompsResponse | null> {
  const region = read('ms.settings').region;
  const cached = read('ms.comps');
  const fresh = cached && cached.data.filters.region === region && Date.now() - cached.fetchedAt < COMPS_TTL;
  if (fresh && !force) return cached.data;
  try {
    const data = await getJson<CompanionCompsResponse>(`/api/companion/v1/comps?region=${encodeURIComponent(region)}`, 60000);
    write('ms.comps', { fetchedAt: Date.now(), data });
    return data;
  } catch {
    // Ohne Netz bleibt der alte Stand stehen, falls er zur Region passt.
    return cached && cached.data.filters.region === region ? cached.data : null;
  }
}

export async function loadLookups(force = false): Promise<CompanionLookups | null> {
  const cached = read('ms.lookups');
  if (cached && !force && Date.now() - cached.fetchedAt < LOOKUPS_TTL) return cached.data;
  try {
    const data = await getJson<CompanionLookups>('/api/companion/v1/lookups');
    write('ms.lookups', { fetchedAt: Date.now(), data });
    return data;
  } catch {
    return cached?.data ?? null;
  }
}

export function loadPlayer(name: string, start = 0): Promise<CompanionPlayerResponse> {
  const q = `name=${encodeURIComponent(name)}${start > 0 ? `&start=${start}` : ''}`;
  return getJson<CompanionPlayerResponse>(`/api/companion/v1/player?${q}`, 30000);
}

// Units, Items und Comp-Details: nur im Speicher des Fensters, 30 Minuten.
// Laufende Abrufe werden geteilt, damit schnelles Klicken nicht doppelt laedt.
// Ein Fehler wird nicht gemerkt — der naechste Versuch fragt neu.
const memo = new Map<string, { at: number; p: Promise<unknown> }>();

function cached<T>(path: string, timeoutMs = 30000): Promise<T> {
  const hit = memo.get(path);
  if (hit && Date.now() - hit.at < COMPS_TTL) return hit.p as Promise<T>;
  const p = getJson<T>(path, timeoutMs);
  memo.set(path, { at: Date.now(), p });
  p.catch(() => { if (memo.get(path)?.p === p) memo.delete(path); });
  return p;
}

export function loadUnits(): Promise<CompanionUnitsResponse> {
  return cached('/api/companion/v1/units');
}

export function loadUnit(id: string): Promise<CompanionUnitDetail> {
  return cached(`/api/companion/v1/units?id=${encodeURIComponent(id)}`);
}

export function loadItems(): Promise<CompanionItemsResponse> {
  return cached('/api/companion/v1/items');
}

export function loadItem(id: string): Promise<CompanionItemDetail> {
  return cached(`/api/companion/v1/items?id=${encodeURIComponent(id)}`);
}

// Der Server rechnet ein Comp-Detail beim ersten Abruf manchmal laenger als
// sein Zeitlimit (Antwort 503) — dann einmal nach kurzer Pause neu fragen.
// carries (Carries + Item-Traeger) braucht der Server fuer die Early-Game-Zuordnung.
export async function loadCompDetail(slug: string, units: string[], carries: string[] = []): Promise<CompanionCompDetail> {
  const region = read('ms.settings').region;
  const path = `/api/companion/v1/comp?slug=${encodeURIComponent(slug)}&units=${encodeURIComponent(units.join(','))}&region=${encodeURIComponent(region)}`
    + (carries.length ? `&carries=${encodeURIComponent(carries.join(','))}` : '');
  try {
    return await cached<CompanionCompDetail>(path, 60000);
  } catch (e) {
    if ((e as { status?: number }).status !== 503) throw e;
    await new Promise(r => setTimeout(r, 3000));
    return cached<CompanionCompDetail>(path, 60000);
  }
}

export function siteUrl(path: string): string {
  return API_BASE + path;
}
