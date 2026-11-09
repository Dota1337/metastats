import type { PlayerHit } from './tft-player-search';
import { isValidRegion } from './regions';

// Riot-Probe der Spielersuche: Name#<Standard-Tag> je Region direkt bei Riot,
// fuer jeden Treffer dazu der Server des Spiels. Ersatz, wenn die
// Namensverzeichnisse nichts kennen — Enter ohne Tag (/tft/search, /search)
// und das LoL-Dropdown der Kopfleiste.
//
// Beide Spiele fragen mit dem TFT-Schluessel (User-Entscheid 09.11.2026):
// Riot-IDs und Server sind spieluebergreifend, nur die puuid haengt am
// Schluessel. Deshalb gibt die LoL-Probe keine puuid heraus, und ihre Treffer
// werden nirgends gespeichert. Gerufen werden nur /riot/account/v1/-Adressen
// (Test riot-name-probe.test.mjs).
//
// Eigene Datei ohne Datenbank und ohne 'server-only', damit sie testbar ist.
// Der Schluessel ist keine NEXT_PUBLIC-Variable, im Browser also leer.
//
// Konten mit eigenem Tag findet das nicht — in Suedostasien und Nahost ist das
// die Mehrheit, dort bleibt es Ergaenzung.

export type ProbeGame = 'tft' | 'lol';
/** enter = Enter ohne Tag (/search, /tft/search), suggest = Dropdown beim Tippen. */
export type ProbeSource = 'enter' | 'suggest';
/** complete=false: Probe durfte nicht laufen oder Riot hat nicht ueberall
 *  geantwortet — „keine Treffer" ist dann nicht belegt. */
export type ProbeResult = { hits: PlayerHit[]; complete: boolean };

// Riots Standard-Tag je Region, gemessen am 27.09.2026 an echten Konten aus
// tft_player_names. OCE kommt als "OC" vor; ME1/PH2/TH2 sind ungeprueft und
// kosten je nur eine Abfrage. Doppelte Konten fallen ueber die puuid heraus.
export const DEFAULT_TAGS = [
  'EUW', 'EUNE', 'NA1', 'KR1', 'BR1', 'LAN', 'LAS', 'TR1', 'RU1', 'JP1',
  'TW2', 'VN2', 'SG2', 'OC', 'OCE', 'ME1', 'PH2', 'TH2',
];

// account-v1 ist global; americas antwortet fuer alle Konten.
export const ACCOUNT_BASE = 'https://americas.api.riotgames.com/riot/account/v1';
const TIMEOUT_MS = 1500;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 500;
// Bremse je Server-Instanz. Eine Probe sind bis zu 18 Abfragen plus eine je
// Treffer. Riot zaehlt auch in 10-s-Fenstern: dort hoechstens 5 Proben
// (~100 Abfragen), davon 2 aus dem Dropdown, damit Tippen der Enter-Suche
// nicht den Platz nimmt (perf-critic 09.11.2026). Gleitend gezaehlt, also auch
// hoechstens 30 je Minute wie die fruehere Minuten-Bremse — nur ohne deren
// Spitze von 30 Proben auf einmal.
const PROBES_PER_10S = 5;
const SUGGEST_PER_10S = 2;
// Ab diesem Anteil am Riot-Limit der Methode pausiert die Probe.
const RIOT_BUDGET_SHARE = 0.5;

export function probeKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function riotProbeEnabled(game: ProbeGame): boolean {
  if (!process.env.RIOT_API_KEY_TFT) return false;
  return game === 'lol'
    ? process.env.LOL_SEARCH_RIOT_PROBE !== 'off'
    : process.env.TFT_SEARCH_RIOT_PROBE !== 'off';
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

type Deps = { fetch: typeof fetch; now: () => number };

export function createRiotNameProbe(deps: Deps = { fetch: (...a) => fetch(...a), now: () => Date.now() }) {
  const cache = new Map<string, { expires: number; hits: PlayerHit[] }>();
  // Startzeiten der Proben der letzten 10 s.
  let recent: { t: number; src: ProbeSource }[] = [];
  let pausedUntil = 0;

  async function riotGet(url: string, apiKey: string): Promise<{ status: number; body: unknown }> {
    try {
      const res = await deps.fetch(url, {
        headers: { 'X-Riot-Token': apiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      });
      if (res.status === 429) {
        const ra = parseFloat(res.headers.get('retry-after') || '');
        pausedUntil = deps.now() + (Number.isFinite(ra) && ra > 0 ? ra * 1000 : 60_000);
      } else if (rateLimitShare(res.headers.get('x-method-rate-limit'), res.headers.get('x-method-rate-limit-count')) >= RIOT_BUDGET_SHARE) {
        pausedUntil = deps.now() + 60_000;
      }
      return { status: res.status, body: res.ok ? await res.json() : null };
    } catch {
      return { status: 0, body: null };
    }
  }

  const cacheKey = (name: string, game: ProbeGame) => `${game}:${probeKey(name)}`;

  /** Gespeicherte vollstaendige Antwort, ohne Riot und ohne Bremse. */
  function cached(name: string, game: ProbeGame): PlayerHit[] | null {
    const c = cache.get(cacheKey(name.trim(), game));
    return c && c.expires > deps.now() ? c.hits : null;
  }

  async function probe(name: string, game: ProbeGame, src: ProbeSource = 'enter'): Promise<ProbeResult> {
    const apiKey = process.env.RIOT_API_KEY_TFT;
    if (!riotProbeEnabled(game) || !apiKey) return { hits: [], complete: false };
    const gameName = name.trim();
    // Riot-Namen haben 3 bis 16 Zeichen; alles andere kann nicht existieren.
    if ([...gameName].length < 3 || [...gameName].length > 16) return { hits: [], complete: true };

    const key = cacheKey(gameName, game);
    const now = deps.now();
    const hit = cache.get(key);
    if (hit && hit.expires > now) return { hits: hit.hits, complete: true };

    if (now < pausedUntil) return { hits: [], complete: false };
    recent = recent.filter(r => now - r.t < 10_000);
    if (recent.length >= PROBES_PER_10S) return { hits: [], complete: false };
    if (src === 'suggest' && recent.filter(r => r.src === 'suggest').length >= SUGGEST_PER_10S) return { hits: [], complete: false };
    recent.push({ t: now, src });

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

    const found = await Promise.all([...seen.values()].map(async acc => {
      const r = await riotGet(`${ACCOUNT_BASE}/region/by-game/${game}/by-puuid/${encodeURIComponent(acc.puuid)}`, apiKey);
      // LoL: kein Server fuer dieses Spiel = Konto ohne LoL, nichts zu zeigen.
      if (game === 'lol' && r.status === 404) return null;
      const raw = (r.body as { region?: string } | null)?.region?.toLowerCase() || null;
      const region = raw && isValidRegion(raw) ? raw : null;
      const base = { gameName: acc.gameName, tagLine: acc.tagLine, region, tier: null, division: null, lp: null };
      // Die puuid stammt vom TFT-Schluessel und passt nur zu TFT.
      return game === 'tft' ? { ...base, puuid: acc.puuid } : base;
    }));
    const hits: PlayerHit[] = found.filter((h): h is NonNullable<typeof h> => h !== null);

    if (complete) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: now + CACHE_TTL_MS, hits });
    }
    return { hits, complete };
  }

  return { probe, cached };
}

const shared = createRiotNameProbe();

/** Riot-Probe (gemeinsamer Zwischenspeicher und gemeinsame Bremse fuer beide
 *  Spiele — derselbe Schluessel, dasselbe Riot-Kontingent). */
export const probeRiotNames = shared.probe;
export const cachedRiotNames = shared.cached;
