// Cookie-basierte Auth für /internal/* Routes (Ops-Dashboard).
//
// Pattern bewusst getrennt von der Supabase-Auth-Pipeline für End-User: ein
// dedizierter HTTP-only Cookie + ein einziger env-Secret, kein User-Konzept.
// Internal heißt: nur ich, kein OAuth, kein User-Profil.

import { createHash, timingSafeEqual } from 'node:crypto';

export const INTERNAL_COOKIE = '__metastats_internal';
export const INTERNAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 Tage

// Feature-Flag — bei `false` ist der ganze /internal/*-Pfad off, Middleware
// returnt 404 ohne Auth-Check. Schnellster Rollback wenn nötig.
export function internalDashboardEnabled(): boolean {
  return process.env.INTERNAL_DASHBOARD_ENABLED !== 'false';
}

// Wir hashen den Secret bevor wir ihn als Cookie speichern — dann ist auch
// bei Cookie-Leak nicht das Raw-Secret kompromittiert. Plus timing-safe-
// Compare gegen einfache Replay-Attacks.
function hash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function cookieValueForSecret(secret: string): string {
  return hash(secret);
}

export function verifyCookieValue(cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;
  const secret = process.env.INTERNAL_DASHBOARD_SECRET;
  if (!secret) return false;
  const expected = hash(secret);
  if (cookieValue.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(cookieValue), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function verifySecret(secret: string | undefined): boolean {
  if (!secret) return false;
  const expected = process.env.INTERNAL_DASHBOARD_SECRET;
  if (!expected) return false;
  if (secret.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(secret), Buffer.from(expected));
  } catch {
    return false;
  }
}
