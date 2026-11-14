import { NextRequest, NextResponse } from 'next/server';
import { rsoConfig, rsoOrigin } from '../../../lib/riot-rso-config';
import { rsoStart, RSO_COOKIE_MAX_AGE_S, RSO_COOKIE_PATH } from '../../../lib/riot-rso';
import { safeNext } from '../../../lib/safe-next';
import { getSupabaseServer } from '../../../lib/supabase-server';
import { checkRateLimit } from '../../../lib/rate-limit';

// Beginn der Riot-Anmeldung: Cookie mit state + PKCE-Schluessel setzen und zu
// Riot weiterleiten. Ohne Zugangsdaten oder auf fremdem Host: 404.
// Logik in app/lib/riot-rso.ts (getestet), hier nur Next-Verdrahtung.

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest) {
  const cfg = rsoConfig();
  const origin = rsoOrigin(req.headers.get('host'));
  if (!cfg.enabled || !origin) return new NextResponse('Not Found', { status: 404, headers: NO_STORE });

  const limited = checkRateLimit(req, { key: 'riot-rso-start', max: 20, windowMs: 60_000 });
  if (limited) return limited;

  const sp = req.nextUrl.searchParams;
  const mode = sp.get('mode') === 'link' ? 'link' : 'login';
  const supabase = await getSupabaseServer();
  const { data } = await supabase.auth.getUser();

  const r = await rsoStart({
    mode,
    next: safeNext(sp.get('next')),
    currentUserId: data.user?.id ?? null,
    origin,
    clientId: cfg.clientId,
    linkSecret: cfg.linkSecret,
    now: Date.now(),
  });
  const res = NextResponse.redirect(new URL(r.location, origin), { status: 302, headers: NO_STORE });
  if (r.cookie) {
    res.cookies.set(r.cookie.name, r.cookie.value, {
      httpOnly: true, secure: true, sameSite: 'lax', path: RSO_COOKIE_PATH, maxAge: RSO_COOKIE_MAX_AGE_S,
    });
  }
  return res;
}
