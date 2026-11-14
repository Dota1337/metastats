import { NextRequest, NextResponse } from 'next/server';
import { rsoConfig, rsoOrigin } from '../../../lib/riot-rso-config';
import { rsoCallback, rsoCookieName, RSO_COOKIE_PATH } from '../../../lib/riot-rso';
import { buildRsoDeps, routeSupabase, type PendingCookie } from '../../../lib/riot-rso-server';

// Rueckkehr von Riot. Reihenfolge und Faelle stehen in app/lib/riot-rso.ts.
// Die Middleware laesst /auth/riot/ ohne eigenen Supabase-Abgleich durch —
// sonst stuenden beim Kontowechsel zwei Set-Cookie fuer dasselbe Cookie in
// einer Antwort (logic-flow-critic 14.11.2026).

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function clearCookie(res: NextResponse, name: string) {
  // Mit Pfad loeschen: cookies.delete(name) nimmt '/' und traefe es nicht.
  res.cookies.set(name, '', { httpOnly: true, secure: true, sameSite: 'lax', path: RSO_COOKIE_PATH, maxAge: 0 });
}

export async function GET(req: NextRequest) {
  const origin = rsoOrigin(req.headers.get('host'));
  if (!origin) return new NextResponse('Not Found', { status: 404, headers: NO_STORE });

  const cfg = rsoConfig();
  const state = req.nextUrl.searchParams.get('state') || '';
  if (!cfg.enabled) {
    // Schalter mitten im Ablauf umgelegt: kein 404, sondern sauber zurueck.
    const res = NextResponse.redirect(new URL('/auth/login?error=riot_off', origin), { status: 302, headers: NO_STORE });
    if (state) clearCookie(res, rsoCookieName(state));
    return res;
  }

  const pending: PendingCookie[] = [];
  const server = routeSupabase(req, pending);
  let location = '/auth/login?error=account';
  let clear: string[] = state ? [rsoCookieName(state)] : [];
  try {
    const result = await rsoCallback({
      query: req.nextUrl.searchParams,
      cookies: Object.fromEntries(req.cookies.getAll().map(c => [c.name, c.value])),
      origin,
    }, buildRsoDeps(cfg, server));
    location = result.location;
    clear = result.clearCookies;
  } catch {
    console.log('[riot-rso] callback_failed');
  }

  const res = NextResponse.redirect(new URL(location, origin), { status: 302, headers: NO_STORE });
  for (const c of pending) res.cookies.set(c.name, c.value, c.options);
  for (const name of clear) clearCookie(res, name);
  return res;
}
