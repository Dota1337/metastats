import { NextRequest, NextResponse } from 'next/server';
import {
  INTERNAL_COOKIE,
  INTERNAL_COOKIE_MAX_AGE,
  cookieValueForSecret,
  verifySecret,
  internalDashboardEnabled,
} from '../../../lib/internal-auth';

export const dynamic = 'force-dynamic';

const DEFAULT_NEXT = '/internal/3d-ops';

// Das Ziel kommt aus der Query der Login-Seite und wandert nach dem Login in
// ein router.push(). Ungeprueft ist das ein offener Redirect: ein Link auf
// /internal/login?next=https://boese.example schickt den frisch
// eingeloggten Nutzer auf eine fremde Seite. Erlaubt sind ausschliesslich
// eigene /internal-Pfade.
function safeNext(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_NEXT;
  if (!raw.startsWith('/internal/')) return DEFAULT_NEXT;
  // `//host` und `/\host` werden von Browsern als protokollrelative URL
  // gelesen, `\` ebenso — beides faellt hier durch.
  if (raw.startsWith('//') || raw.includes('\\') || raw.includes('://')) return DEFAULT_NEXT;
  // `/internal/../foo` zeigt nach der Normalisierung des Browsers auf /foo.
  if (raw.includes('..')) return DEFAULT_NEXT;
  return raw;
}

// Fehlversuchs-Bremse. Bewusst im Prozessspeicher: eine Serverless-Instanz
// lebt nur kurz, das ist also keine harte Sperre, sondern eine Bremse gegen
// den billigen Fall — ein Skript, das aus einer Verbindung heraus Secrets
// durchprobiert. Eine belastbare Sperre braeuchte einen gemeinsamen Speicher;
// dafuer ist der Angriffspfad hier zu schmal (ein einziges Secret, kein
// Nutzerkonto, das sich aussperren liesse).
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; first: number }>();

function clientKey(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
}

function isLockedOut(key: string): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

function noteFailure(key: string): void {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) {
    failures.set(key, { count: 1, first: Date.now() });
    return;
  }
  entry.count += 1;
  // Ohne Deckel waechst die Map mit jeder neuen Quell-IP unbegrenzt.
  if (failures.size > 5000) failures.clear();
}

export async function POST(req: NextRequest) {
  if (!internalDashboardEnabled()) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const key = clientKey(req);
  if (isLockedOut(key)) {
    return NextResponse.json(
      { ok: false, error: 'too many attempts' },
      { status: 429, headers: { 'Retry-After': String(WINDOW_MS / 1000) } },
    );
  }

  let body: { secret?: string; next?: string } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  if (!verifySecret(body.secret)) {
    noteFailure(key);
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  failures.delete(key);

  const secret = body.secret as string;
  const cookieValue = await cookieValueForSecret(secret);
  const response = NextResponse.json({ ok: true, next: safeNext(body.next) });
  response.cookies.set(INTERNAL_COOKIE, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: INTERNAL_COOKIE_MAX_AGE,
  });
  return response;
}
