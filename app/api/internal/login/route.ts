import { NextRequest, NextResponse } from 'next/server';
import {
  INTERNAL_COOKIE,
  INTERNAL_COOKIE_MAX_AGE,
  cookieValueForSecret,
  verifySecret,
  internalDashboardEnabled,
} from '../../../lib/internal-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!internalDashboardEnabled()) {
    return new NextResponse('Not Found', { status: 404 });
  }
  let body: { secret?: string; next?: string } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  if (!verifySecret(body.secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const secret = body.secret as string;
  const response = NextResponse.json({ ok: true, next: body.next || '/internal/3d-ops' });
  response.cookies.set(INTERNAL_COOKIE, cookieValueForSecret(secret), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: INTERNAL_COOKIE_MAX_AGE,
  });
  return response;
}
