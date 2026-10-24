import { NextRequest, NextResponse } from 'next/server';
import { DEGRADED_CACHE_CONTROL, cacheHeaders } from '../../../lib/api-cache';
import { checkRateLimit } from '../../../lib/rate-limit';
import { supabaseAdmin } from '../../../lib/supabase';
import { tftProfileHref } from '../../../lib/tft-player-search';
import {
  CARRIERS_TAB, carriersApiQs, carriersServiceBody, isExplorerId, parseExplorerParams, serializeExplorerQuery, toServiceBody,
  type ExplorerGame,
} from '../../../lib/tft-explorer-query';
import { boxFetch } from '../../../lib/box-tls.mjs';

// Data Explorer. Die Rechnung laeuft auf der Hetzner-Box im Abfrage-Dienst
// (scripts/explorer-duckdb-server.mjs), erreichbar nur ueber refresh-api
// (/explore, Token). Die Anfrage steht komplett in der URL, damit Vercel sie
// cachen kann; die Seite baut die URL mit serializeExplorerQuery, also in
// fester Reihenfolge.
//
// Cache: die Daten aendern sich nur einmal am Tag (Build 01:35 UTC; Teil-Aufbau
// gemessen 258 s, Vollaufbau 3953 s am 08.10.2026, die Teilsummen-Frist im Bau
// haelt den Tausch vor 03:30). Deshalb bis 03:30 UTC des naechsten Tages cachen,
// danach hoechstens eine Stunde alt ausliefern, waehrend neu gerechnet wird.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Fristen-Kette (Paket 6): Dienst bis 30 s („alle Patches + Filter"),
// refresh-api 35 s, hier 40 s — die Funktion selbst darf etwas laenger leben.
export const maxDuration = 60;

const HETZNER_URL = process.env.HETZNER_REFRESH_URL;
const TOKEN = process.env.REFRESH_API_TOKEN;

type ServiceGame = Omit<ExplorerGame, 'player'> & { puuid: string | null };

// Spiele-Reiter: Riot-ID aus dem Namensverzeichnis (liegt nur auf Supabase),
// Link auf unsere Spielerseite. Die puuid des Dienstes geht nicht weiter.
// ok = false: Verzeichnis nicht erreichbar → Zeilen ohne Namen, kurz cachen.
async function withPlayerNames(games: ServiceGame[]): Promise<{ games: ExplorerGame[]; ok: boolean }> {
  const ids = [...new Set(games.map(g => g.puuid).filter((p): p is string => !!p))];
  const names = new Map<string, { gameName: string; tagLine: string }>();
  let ok = true;
  if (ids.length) {
    try {
      const { data, error } = await supabaseAdmin.from('tft_player_names').select('puuid, game_name, tag_line').in('puuid', ids);
      if (error) ok = false;
      for (const r of data ?? []) if (r.game_name && r.tag_line) names.set(r.puuid, { gameName: r.game_name, tagLine: r.tag_line });
    } catch {
      ok = false;
    }
  }
  return {
    ok,
    games: games.map(({ puuid, ...g }) => {
      const n = puuid ? names.get(puuid) : undefined;
      return {
        ...g,
        player: n && puuid ? { name: n.gameName, tag: n.tagLine, href: tftProfileHref({ puuid, gameName: n.gameName, tagLine: n.tagLine, region: g.region || null }) } : null,
      };
    }),
  };
}

function secondsUntilNextBuild(now = new Date()): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 30));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return Math.max(300, Math.round((next.getTime() - now.getTime()) / 1000));
}

export async function GET(req: NextRequest) {
  if (!HETZNER_URL || !TOKEN) {
    return NextResponse.json({ error: 'explorer_unavailable' }, { status: 503, headers: cacheHeaders(DEGRADED_CACHE_CONTROL) });
  }

  // Beste Traeger eines Items: eigener Reiter nur der API, genau eine Form
  // (carriersApiQs); der Dienst kennt nur die Standardansicht.
  const search = req.nextUrl.search.replace(/^\?/, '');
  let body: object;
  if (req.nextUrl.searchParams.get('tab') === CARRIERS_TAB) {
    const item = req.nextUrl.searchParams.get('f') ?? '';
    if (!isExplorerId(item) || search !== carriersApiQs(item)) {
      return NextResponse.json({ error: 'carriers_scope' }, { status: 400, headers: cacheHeaders(DEGRADED_CACHE_CONTROL) });
    }
    body = carriersServiceBody(item);
  } else {
    const query = parseExplorerParams(req.nextUrl.searchParams);
    // Abweichende Schreibweise derselben Anfrage auf die feste Form umleiten,
    // damit sie denselben Cache-Eintrag trifft.
    const canonical = serializeExplorerQuery(query, { forApi: true });
    if (search !== canonical) {
      const url = req.nextUrl.clone();
      url.search = canonical;
      return NextResponse.redirect(url, 308);
    }
    body = toServiceBody(query);
  }

  // Ungecachte Anfragen rechnen auf einer Box mit 2 Kernen — pro IP deckeln.
  const limited = checkRateLimit(req, { key: 'explorer', max: 30, windowMs: 60_000 });
  if (limited) return limited;

  let upstream: Response;
  try {
    upstream = await boxFetch(`${HETZNER_URL}/explore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40_000),
    });
  } catch (err) {
    // Eigene Frist abgelaufen = Rechnung zu lang (504, die Seite zeigt
    // „Zeitueberschreitung"); alles andere = Box nicht erreichbar (503).
    const timeout = (err as { name?: string } | null)?.name === 'TimeoutError';
    return NextResponse.json(
      { error: timeout ? 'timeout' : 'explorer_unavailable' },
      { status: timeout ? 504 : 503, headers: cacheHeaders(DEGRADED_CACHE_CONTROL) },
    );
  }

  const data = await upstream.json().catch(() => null);
  if (!upstream.ok || !data) {
    const status = upstream.ok ? 502 : upstream.status;
    const headers: Record<string, string> = cacheHeaders(DEGRADED_CACHE_CONTROL);
    const retry = upstream.headers.get('retry-after');
    if (retry) headers['Retry-After'] = retry;
    return NextResponse.json(data ?? { error: 'explorer_unavailable' }, { status, headers });
  }

  let namesOk = true;
  if (Array.isArray(data.games)) {
    const r = await withPlayerNames(data.games as ServiceGame[]);
    data.games = r.games;
    namesOk = r.ok;
  }

  const cc = namesOk ? `public, s-maxage=${secondsUntilNextBuild()}, stale-while-revalidate=3600` : DEGRADED_CACHE_CONTROL;
  return NextResponse.json(data, { status: 200, headers: cacheHeaders(cc) });
}
