import 'server-only';
import { supabaseAdmin } from './supabase';
import type { TftAccountHit } from './tft-player-search';
import { isValidRegion } from './regions';

// Server-Teil der Spielersuche "Enter ohne Tag" (/tft/search).
//
// 1. searchExactNames: alle Konten mit genau diesem Namen aus dem
//    Namensverzeichnis (Migration 0073), ueber alle Server.
// 2. probeRiotDefaultTags: Ersatz, wenn das Verzeichnis nichts kennt. Fragt
//    Riot nach Name#<Standard-Tag> fuer jede Region und ermittelt fuer jeden
//    Treffer den TFT-Server. Konten mit eigenem Tag findet das nicht — in
//    Suedostasien und Nahost ist das die Mehrheit, dort bleibt es Ergaenzung.

type Row = {
  puuid: string; game_name: string; tag_line: string; region: string;
  tier: string | null; division: string | null; lp: number | null;
};

export async function searchExactNames(name: string): Promise<TftAccountHit[] | null> {
  const { data, error } = await supabaseAdmin.rpc('search_tft_player_names_exact', { p_name: name, p_limit: 50 });
  if (error) {
    console.error('[tft-search] exact rpc failed:', error.message);
    return null;
  }
  return ((data || []) as Row[]).map(r => ({
    puuid: r.puuid, gameName: r.game_name, tagLine: r.tag_line, region: r.region,
    tier: r.tier, division: r.division, lp: r.lp,
  }));
}

// Riots Standard-Tag je Region, gemessen am 27.09.2026 an echten Konten aus
// tft_player_names. OCE kommt als "OC" vor; ME1/PH2/TH2 sind ungeprueft und
// kosten je nur eine Abfrage. Doppelte Konten fallen ueber die puuid heraus.
const DEFAULT_TAGS = [
  'EUW', 'EUNE', 'NA1', 'KR1', 'BR1', 'LAN', 'LAS', 'TR1', 'RU1', 'JP1',
  'TW2', 'VN2', 'SG2', 'OC', 'OCE', 'ME1', 'PH2', 'TH2',
];

// account-v1 ist global; americas antwortet fuer alle Konten.
const ACCOUNT_BASE = 'https://americas.api.riotgames.com/riot/account/v1';
const TIMEOUT_MS = 1500;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 500;
// Globale Bremse pro Server-Instanz: Proben pro Minute. Eine Probe sind bis zu
// 18 Abfragen plus eine je Treffer.
const PROBES_PER_MIN = 30;
// Ab diesem Anteil am Riot-Limit der Methode pausiert die Probe.
const RIOT_BUDGET_SHARE = 0.5;

const cache = new Map<string, { expires: number; hits: TftAccountHit[] }>();
let windowStart = 0;
let windowCount = 0;
let pausedUntil = 0;

export function probeKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function riotProbeEnabled(): boolean {
  return process.env.TFT_SEARCH_RIOT_PROBE !== 'off' && !!process.env.RIOT_API_KEY_TFT;
}

// "1000:60,20000:600" + "3:60,40:600" -> hoechster Auslastungsanteil
export function rateLimitShare(limit: string | null, count: string | null): number {
  if (!limit || !count) return 0;
  const lim = new Map(limit.split(',').map(p => { const [n, w] = p.split(':'); return [w, Number(n)] as const; }));
  let share = 0;
  for (const p of count.split(',')) {
    const [n, w] = p.split(':');
    const max = lim.get(w);
    if (max && Number.isFinite(Number(n))) share = Math.max(share, Number(n) / max);
  }
  return share;
}

async function riotGet(url: string, apiKey: string): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(url, {
      headers: { 'X-Riot-Token': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (res.status === 429) {
      const ra = parseFloat(res.headers.get('retry-after') || '');
      pausedUntil = Date.now() + (Number.isFinite(ra) && ra > 0 ? ra * 1000 : 60_000);
    } else if (rateLimitShare(res.headers.get('x-method-rate-limit'), res.headers.get('x-method-rate-limit-count')) >= RIOT_BUDGET_SHARE) {
      pausedUntil = Date.now() + 60_000;
    }
    return { status: res.status, body: res.ok ? await res.json() : null };
  } catch {
    return { status: 0, body: null };
  }
}

/**
 * Liefert null, wenn die Probe nicht laufen darf (abgeschaltet, gebremst,
 * Riot pausiert) — der Aufrufer zeigt dann nur die Verzeichnis-Treffer.
 * Ein leeres Array heisst: gefragt, nichts gefunden.
 */
export async function probeRiotDefaultTags(name: string): Promise<TftAccountHit[] | null> {
  const apiKey = process.env.RIOT_API_KEY_TFT;
  if (!riotProbeEnabled() || !apiKey) return null;
  const gameName = name.trim();
  // Riot-Namen haben 3 bis 16 Zeichen; alles andere kann nicht existieren.
  if ([...gameName].length < 3 || [...gameName].length > 16) return [];

  const key = probeKey(gameName);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) return cached.hits;

  if (now < pausedUntil) return null;
  if (now - windowStart > 60_000) { windowStart = now; windowCount = 0; }
  if (windowCount >= PROBES_PER_MIN) return null;
  windowCount++;

  const enc = encodeURIComponent(gameName);
  const accounts = await Promise.all(DEFAULT_TAGS.map(tag =>
    riotGet(`${ACCOUNT_BASE}/accounts/by-riot-id/${enc}/${encodeURIComponent(tag)}`, apiKey)));

  // Nur echte Antworten zaehlen. Brach Riot bei einer Abfrage ab (Zeitlimit,
  // 429, 5xx), ist das Ergebnis unvollstaendig und wird nicht gespeichert.
  const complete = accounts.every(a => a.status === 200 || a.status === 404);
  const seen = new Map<string, { puuid: string; gameName: string; tagLine: string }>();
  for (const a of accounts) {
    const b = a.body as { puuid?: string; gameName?: string; tagLine?: string } | null;
    if (b?.puuid && b.gameName && b.tagLine && !seen.has(b.puuid)) {
      seen.set(b.puuid, { puuid: b.puuid, gameName: b.gameName, tagLine: b.tagLine });
    }
  }

  const hits = await Promise.all([...seen.values()].map(async acc => {
    const r = await riotGet(`${ACCOUNT_BASE}/region/by-game/tft/by-puuid/${encodeURIComponent(acc.puuid)}`, apiKey);
    const raw = (r.body as { region?: string } | null)?.region?.toLowerCase() || null;
    const region = raw && isValidRegion(raw) ? raw : null;
    return { ...acc, region, tier: null, division: null, lp: null } satisfies TftAccountHit;
  }));

  if (complete) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: now + CACHE_TTL_MS, hits });
  }
  return hits;
}
