// Cookie-basierte Auth für /internal/* Routes (Ops-Dashboard).
//
// Edge-compatible: nutzt Web-Crypto API statt node:crypto, weil middleware.ts
// auf Vercel Edge-Runtime läuft und kein Node-Builtins importieren darf.

export const INTERNAL_COOKIE = '__metastats_internal';
export const INTERNAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 Tage

// Feature-Flag — bei `false` ist der ganze /internal/*-Pfad off, Middleware
// returnt 404 ohne Auth-Check. Schnellster Rollback wenn nötig.
export function internalDashboardEnabled(): boolean {
  return process.env.INTERNAL_DASHBOARD_ENABLED !== 'false';
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Constant-time string compare — schützt vor Timing-Attacks. Beide Strings
// müssen dieselbe Länge haben, sonst direkt false.
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function cookieValueForSecret(secret: string): Promise<string> {
  return sha256Hex(secret);
}

export async function verifyCookieValue(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  const secret = process.env.INTERNAL_DASHBOARD_SECRET;
  if (!secret) return false;
  const expected = await sha256Hex(secret);
  return timingSafeEqualStr(cookieValue, expected);
}

export function verifySecret(secret: string | undefined): boolean {
  if (!secret) return false;
  const expected = process.env.INTERNAL_DASHBOARD_SECRET;
  if (!expected) return false;
  return timingSafeEqualStr(secret, expected);
}
