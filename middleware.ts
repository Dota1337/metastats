// Middleware:
//   1. Early-Return-Branch für /internal/* + /api/internal/* — eigene Cookie-
//      Auth, KEIN Supabase-SSR-Call. Wenn Feature-Flag aus, 404. Wenn nicht
//      authentifiziert, 401 für /api/internal/*, 307→/internal/login für Pages.
//   2. Default-Pfad: Supabase-Session refreshen, sonst läuft der End-User-
//      Cookie nach ~1h ab obwohl der User aktiv ist.

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { INTERNAL_COOKIE, verifyCookieValue, internalDashboardEnabled } from './app/lib/internal-auth';
import { securityHeaderRecord } from './app/lib/security-headers';

// Die Security-Header aus next.config.ts setzt der Routing-Layer. Die beiden
// Antworten unten entstehen davor und wuerden sonst als einzige ohne sie
// rausgehen — ausgerechnet die, die eine Auth-Entscheidung transportieren.
const SEC = securityHeaderRecord();

export async function middleware(req: NextRequest) {
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
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
