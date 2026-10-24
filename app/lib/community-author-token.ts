// Reine Rechenteile von community-author.ts (Kennung aus IP, Cookie-Unterschrift).
// Eigene Datei ohne Datenbank-Import, damit der Test sie laden kann.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const ID_RE = /^[a-f0-9]{32}$/;
const SIG_LENGTH = 22;

/** Schluessel aus dem Server-Geheimnis, mit eigener Kennzeichnung abgeleitet. */
export function authorKey(): string | null {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || base.length < 32) return null;
  return createHmac('sha256', base).update('tft-author-token:v1').digest('hex');
}

function sign(key: string, id: string): string {
  return createHmac('sha256', key).update(`sig:${id}`).digest('base64url').slice(0, SIG_LENGTH);
}

/** Kennung aus der IP — dieselbe IP ergibt immer dieselbe Kennung. */
export function idFromIp(key: string, ip: string): string {
  return createHmac('sha256', key).update(`ip:${ip}`).digest('hex').slice(0, 32);
}

export function signedCookieValue(key: string, id: string): string {
  return `${id}_${sign(key, id)}`;
}

/** Kennung aus einem unterschriebenen Cookie, sonst null. */
export function idFromSignedCookie(key: string, value: string): string | null {
  const parts = value.split('_');
  if (parts.length !== 2) return null;
  const [id, sig] = parts;
  if (!ID_RE.test(id) || sig.length !== SIG_LENGTH) return null;
  const want = Buffer.from(sign(key, id));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}
