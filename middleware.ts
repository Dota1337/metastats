// Middleware:
//   1. Early-Return-Branch für /internal/* + /api/internal/* — eigene Cookie-
//      Auth, KEIN Supabase-SSR-Call. Wenn Feature-Flag aus, 404. Wenn nicht
//      authentifiziert, 401 für /api/internal/*, 307→/internal/login für Pages.
//   2. Erfundene Detail-Adressen (Unit/Item/Trait/Comp/Team) → 404, siehe
//      app/lib/seo/not-found-gate.ts; LoL-Champions → 404 bzw. 308 bei
//      falscher Gross/Klein-Schreibung, siehe app/lib/seo/champion-gate.ts.
//      Davor: alte TFT-Spieler-Adressen `Name-Tag` → 308 auf `Name--Tag`,
//      Comp-Kennungen → lesbarer Name (app/lib/tft-comp-path.ts).
//   3. Default-Pfad: Supabase-Session refreshen, sonst läuft der End-User-
//      Cookie nach ~1h ab obwohl der User aktiv ist.
//   0. Davor: Sprach-Adressen `/en/…` (lang-path.ts). Der Vorsatz wird
//      abgetrennt, alle Pruefungen laufen auf dem Rest, die Antwort ist ein
//      Rewrite auf den Rest mit Anfrage-Header x-ms-lang. Vorsatz vor etwas,
//      das keine Seite ist (/en/api, /en/internal, Dateien) → 404, nie Rewrite.

import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { INTERNAL_COOKIE, verifyCookieValue, internalDashboardEnabled } from './app/lib/internal-auth';
import { securityHeaderRecord } from './app/lib/security-headers';
import { isUnknownDetailPath } from './app/lib/seo/not-found-gate';
import { championGate, championIdFromPath } from './app/lib/seo/champion-gate';
import { legacyTftPlayerSlug } from './app/lib/og/slugs';
import { LANG_HEADER, langPathsEnabled, langRoute, withLangPrefix, type PrefixLang } from './app/lib/lang-path';
import { compReadableEnabled, compRedirect } from './app/lib/tft-comp-path';
import {
  PUBLISHER_ACCEPTED_HEADER, PUBLISHER_HEADER, PUBLISHER_TOKEN_ENV, PUBLISHER_TOKEN_HEADER, publisherTokenValid,
} from './app/lib/snapshot-publisher.mjs';

// Die Security-Header aus next.config.ts setzt der Routing-Layer. Die beiden
// Antworten unten entstehen davor und wuerden sonst als einzige ohne sie
// rausgehen — ausgerechnet die, die eine Auth-Entscheidung transportieren.
const SEC = securityHeaderRecord();

// Jede Durchreiche geht hierueber: Header-Kopie INNERHALB, weil der Supabase-
// Teil per req.cookies.set in req.headers schreibt und die Antwort danach neu
// baut. Ein x-ms-lang von aussen wird immer entfernt — nur die Middleware setzt
// ihn, und nur unter einer Sprach-Adresse.
//
// Publisher-Koepfe (app/lib/snapshot-publisher.mjs): ohne gueltiges Geheimnis
// entfernt, mit gueltigem bekommt die Antwort die Annahme-Kopfzeile — an der
// prueft die Box vor jedem Lauf, dass sie nicht als Besucher gilt.
function forward(req: NextRequest, lang: PrefixLang | null, rewriteTo?: URL): NextResponse {
  const headers = new Headers(req.headers);
  headers.delete(LANG_HEADER);
  if (lang) headers.set(LANG_HEADER, lang);
  const publisher = publisherTokenValid((n: string) => req.headers.get(n), process.env[PUBLISHER_TOKEN_ENV]);
  if (!publisher) {
    headers.delete(PUBLISHER_HEADER);
    headers.delete(PUBLISHER_TOKEN_HEADER);
  }
  const init = { request: { headers } };
  const res = rewriteTo ? NextResponse.rewrite(rewriteTo, init) : NextResponse.next(init);
  if (publisher) res.headers.set(PUBLISHER_ACCEPTED_HEADER, '1');
  return res;
}

function notFound(req: NextRequest, lang: PrefixLang | null): NextResponse {
  return forward(req, lang, new URL('/__not-found', req.url));
}

export async function middleware(req: NextRequest, event: NextFetchEvent) {
  // --- Publisher-Kopf ohne gueltiges Geheimnis → 403 ---------------------
  // Nicht still als Besucher weiterreichen: ein Publisher, der so behandelt
  // wird, bekaeme seinen eigenen Vorrat zurueck und schriebe ihn eingefroren
  // neu (app/lib/snapshot-publisher.mjs). Besucher schicken den Kopf nie.
  if (req.headers.has(PUBLISHER_HEADER) && !publisherTokenValid((n: string) => req.headers.get(n), process.env[PUBLISHER_TOKEN_ENV])) {
    return NextResponse.json({ error: 'publisher_rejected' }, { status: 403, headers: { ...SEC, 'Cache-Control': 'no-store' } });
  }

  // --- Sprach-Adressen ---------------------------------------------------
  const route = langRoute(req.nextUrl.pathname);
  // Gesperrt: zuerst, vor allem anderen — ein Vorsatz darf nie am Login-Zweig
  // von /internal vorbei oder eine API erreichen.
  if (route.kind === 'blocked') return notFound(req, route.lang);
  const lang = route.kind === 'rewrite' ? route.lang : null;
  const path = route.kind === 'rewrite' ? route.rest : req.nextUrl.pathname;
  if (lang && !langPathsEnabled()) {
    // Notschalter: Sprach-Adressen aus, voruebergehend auf die deutsche Adresse.
    const url = req.nextUrl.clone();
    url.pathname = path;
    return NextResponse.redirect(url, { status: 307, headers: SEC });
  }
  // Ziel der Weiterleitung: Rest-Pfad bei Sprach-Adressen, sonst wie bisher.
  const target = lang ? (() => { const u = req.nextUrl.clone(); u.pathname = path; return u; })() : undefined;

  // --- Internal-Dashboard Branch (no Supabase-SSR) -----------------------
  if (path.startsWith('/internal') || path.startsWith('/api/internal')) {
    if (!internalDashboardEnabled()) {
      return new NextResponse('Not Found', { status: 404, headers: SEC });
    }
    // Nicht gaten: Login (sonst Endlos-Redirect) und Routen mit eigener,
    // maschinentauglicher Auth. /api/internal/revalidate authentifiziert per
    // HMAC-Signatur + ±5min-Timestamp-Window und hard-failt ohne Secret — der
    // Crawler auf der Hetzner-Box hat keine Browser-Session und lief hier von
    // 2026-06-16 bis 2026-08-03 in einen 401, wodurch nach jedem Crawl die
    // Edge-Caches stehen blieben. ops-snapshot und riot-status haben KEINE
    // eigene Auth und müssen hinter der Cookie-Gate bleiben.
    const isSelfAuthedPath = path === '/internal/login'
      || path === '/api/internal/login'
      || path === '/api/internal/revalidate';
    if (isSelfAuthedPath) return forward(req, null);

    const cookie = req.cookies.get(INTERNAL_COOKIE)?.value;
    if (await verifyCookieValue(cookie)) return forward(req, null);

    if (path.startsWith('/api/internal')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: SEC });
    }
    const loginUrl = new URL('/internal/login', req.url);
    loginUrl.searchParams.set('next', path);
    return NextResponse.redirect(loginUrl);
  }

  // --- Alte TFT-Spieler-Adressen `Name-Tag` → 308 auf `Name--Tag` --------
  // Rising und die Lesezeichen bauten sie mit einem Strich; die Seite las dann
  // alles als Namen und fand den Spieler nicht. Ausserhalb von SEO_404_GATE:
  // das Ziel ist immer gueltig, ein Notschalter wuerde nur Links brechen.
  // Das Ziel enthaelt `--` und wird deshalb nie erneut umgeleitet.
  const legacyPlayer = /^\/tft\/player\/([^/]+)$/.exec(path);
  if (legacyPlayer) {
    const canonical = legacyTftPlayerSlug(legacyPlayer[1]);
    if (canonical) {
      // clone() behaelt die Abfrage (region, puuid, ?_rsc).
      const url = req.nextUrl.clone();
      url.pathname = withLangPrefix(lang, `/tft/player/${canonical}`);
      return NextResponse.redirect(url, { status: 308, headers: SEC });
    }
  }

  // --- Comp-Kennungen → lesbarer Name (SEO Weg C, L2) --------------------
  // `/tft/comps/DA_18_Lunar%404_DA_18_Aphelios` → `/tft/comps/lunar-aphelios`,
  // Grossschreibung → Kleinschreibung. Vor der 404-Pruefung, ausserhalb von
  // SEO_404_GATE (eigener Schalter NEXT_PUBLIC_COMP_READABLE=0, der auch die
  // Links zuruecknimmt). 307 bis 28.10.2026, danach 308 mit einem Tag
  // Browser-Cache: ein Rueckbau bleibt moeglich (COMP_REDIRECT_STATUS=307).
  const comp = compRedirect(path, req.nextUrl.searchParams, {
    now: Date.now(), status: process.env.COMP_REDIRECT_STATUS, enabled: compReadableEnabled(),
  });
  if (comp) {
    const url = req.nextUrl.clone();
    url.pathname = withLangPrefix(lang, comp.pathname);
    url.search = comp.search;
    const headers: Record<string, string> = { ...SEC };
    if (comp.status === 308) headers['Cache-Control'] = 'public, max-age=86400';
    return NextResponse.redirect(url, { status: comp.status, headers });
  }

  // --- Erfundene Detail-Adressen → echte 404 ----------------------------
  // Vor dem Supabase-Teil: kein getUser-Roundtrip fuer Muell-Adressen. Der
  // Rewrite auf einen Pfad ohne Route laesst Next die not-found-Seite mit
  // Status 404 rendern, auch fuer RSC und HEAD. Notschalter SEO_404_GATE=0.
  if (process.env.SEO_404_GATE !== '0') {
    if (isUnknownDetailPath(path)) return notFound(req, lang);
    const championId = championIdFromPath(path);
    if (championId !== undefined) {
      const d = championId === null ? { kind: 'missing' as const } : await championGate(championId, p => event.waitUntil(p));
      if (d.kind === 'missing') return notFound(req, lang);
      if (d.kind === 'redirect') {
        // clone() behaelt die Abfrage (auch ?_rsc); das Ziel ist exakt bekannt, also keine Schleife.
        const url = req.nextUrl.clone();
        url.pathname = withLangPrefix(lang, `/champions/${d.id}`);
        return NextResponse.redirect(url, { status: d.permanent ? 308 : 307, headers: SEC });
      }
    }
  }

  // --- Default Supabase-SSR-Pfad ---------------------------------------
  let response = forward(req, lang, target);
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll(items) {
          for (const { name, value } of items) req.cookies.set(name, value);
          response = forward(req, lang, target);
          for (const { name, value, options } of items) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );
  // Just touching getUser refreshes the token if the cookie is stale.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    // Skip static assets + API images. Everything else flows through.
    //
    // `api/img` steht explizit hier, obwohl seine Pfade auf `.png` enden und
    // damit ohnehin von der Endungs-Regel erfasst waeren: das waere Zufall,
    // nicht Absicht. Ein Bild-Request, der durch diese Middleware laeuft,
    // zahlt einen Supabase-getUser()-Roundtrip und bekommt ein Set-Cookie —
    // und eine Antwort mit Set-Cookie ist bei Vercel dauerhaft uncachebar.
    // Der Proxy waere damit genau um das kaputt, wofuer es ihn gibt.
    // `api/companion` aus demselben Grund: die Overwolf-App hat keine
    // Seiten-Sitzung, ihre Antworten sollen aus der Edge-Kopie kommen.
    // `opengraph-image` (Vorschaubilder, auch unter /tft/comps/<slug>/...)
    // ebenso: sie tragen einen CDN-Cache-Header, den ein Set-Cookie aushebeln wuerde.
    '/((?!_next/static|_next/image|api/img|api/companion|favicon.ico|.*opengraph-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
