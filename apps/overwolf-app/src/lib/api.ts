// Abruf von /api/companion/v1/* mit Zwischenspeicher in localStorage.
// Fenster lesen zuerst den gespeicherten Stand und laden nur nach, wenn er
// aelter als die Frist ist — im Spiel wird so nie auf das Netz gewartet.
import type {
  CompanionCompsResponse, CompanionLookups, CompanionPlayerResponse,
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

export function loadPlayer(name: string): Promise<CompanionPlayerResponse> {
  return getJson<CompanionPlayerResponse>(`/api/companion/v1/player?name=${encodeURIComponent(name)}`, 30000);
}

export function siteUrl(path: string): string {
  return API_BASE + path;
}
