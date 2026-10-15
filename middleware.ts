// Middleware:
//   1. Early-Return-Branch für /internal/* + /api/internal/* — eigene Cookie-
//      Auth, KEIN Supabase-SSR-Call. Wenn Feature-Flag aus, 404. Wenn nicht
//      authentifiziert, 401 für /api/internal/*, 307→/internal/login für Pages.
//   2. Erfundene Detail-Adressen (Unit/Item/Trait/Comp/Team) → 404, siehe
//      app/lib/seo/not-found-gate.ts; LoL-Champions → 404 bzw. 308 bei
//      falscher Gross/Klein-Schreibung, siehe app/lib/seo/champion-gate.ts.
//      Davor: alte TFT-Spieler-Adressen `Name-Tag` → 308 auf `Name--Tag`.
//   3. Default-Pfad: Supabase-Session refreshen, sonst läuft der End-User-
//      Cookie nach ~1h ab obwohl der User aktiv ist.

import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { INTERNAL_COOKIE, verifyCookieValue, internalDashboardEnabled } from './app/lib/internal-auth';
import { securityHeaderRecord } from './app/lib/security-headers';
import { isUnknownDetailPath } from './app/lib/seo/not-found-gate';
import { championGate, championIdFromPath } from './app/lib/seo/champion-gate';
import { legacyTftPlayerSlug } from './app/lib/og/slugs';

// Die Security-Header aus next.config.ts setzt der Routing-Layer. Die beiden
// Antworten unten entstehen davor und wuerden sonst als einzige ohne sie
// rausgehen — ausgerechnet die, die eine Auth-Entscheidung transportieren.
const SEC = securityHeaderRecord();

export async function middleware(req: NextRequest, event: NextFetchEvent) {
  const path = req.nextUrl.pathname;

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
    if (isSelfAuthedPath) return NextResponse.next();

    const cookie = req.cookies.get(INTERNAL_COOKIE)?.value;
    if (await verifyCookieValue(cookie)) return NextResponse.next();

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
      url.pathname = `/tft/player/${canonical}`;
      return NextResponse.redirect(url, { status: 308, headers: SEC });
    }
  }

  // --- Erfundene Detail-Adressen → echte 404 ----------------------------
  // Vor dem Supabase-Teil: kein getUser-Roundtrip fuer Muell-Adressen. Der
  // Rewrite auf einen Pfad ohne Route laesst Next die not-found-Seite mit
  // Status 404 rendern, auch fuer RSC und HEAD. Notschalter SEO_404_GATE=0.
  if (process.env.SEO_404_GATE !== '0') {
    if (isUnknownDetailPath(path)) {
      return NextResponse.rewrite(new URL('/__not-found', req.url));
    }
    const championId = championIdFromPath(path);
    if (championId !== undefined) {
      const d = championId === null ? { kind: 'missing' as const } : await championGate(championId, p => event.waitUntil(p));
      if (d.kind === 'missing') return NextResponse.rewrite(new URL('/__not-found', req.url));
      if (d.kind === 'redirect') {
        // clone() behaelt die Abfrage (auch ?_rsc); das Ziel ist exakt bekannt, also keine Schleife.
        const url = req.nextUrl.clone();
        url.pathname = `/champions/${d.id}`;
        return NextResponse.redirect(url, { status: d.permanent ? 308 : 307, headers: SEC });
      }
    }
  }

  // --- Default Supabase-SSR-Pfad ---------------------------------------
  let response = NextResponse.next({ request: req });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll(items) {
          for (const { name, value } of items) req.cookies.set(name, value);
          response = NextResponse.next({ request: req });
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
