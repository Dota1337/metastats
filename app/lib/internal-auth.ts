// Cookie-basierte Auth für /internal/* Routes (Ops-Dashboard).
//
// Edge-compatible: nutzt Web-Crypto API statt node:crypto, weil middleware.ts
// auf Vercel Edge-Runtime läuft und kein Node-Builtins importieren darf.

export const INTERNAL_COOKIE = '__metastats_internal';
export const INTERNAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 Tage

// Feature-Flag — bei `false` ist der ganze /internal/*-Pfad off, Middleware
// returnt 404 ohne Auth-Check. Schnellster Rollback wenn nötig.
export function internalDashboardEnabled(): boolean {
  return process.env.INTERNAL_DASHBOARD_ENABLED !== 'false';
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

// Cookie-Format: `v1.<exp>.<nonce>.<signatur>`
//
// Frueher stand im Cookie schlicht sha256(secret). Das war ein zweiter,
// dauerhaft gueltiger Schluessel: aus dem Secret ableitbar, ohne Ablauf im
// Wert selbst (nur die Browser-seitige maxAge), und fuer jede Sitzung
// identisch. Ein einmal abgegriffener Wert galt bis zur Secret-Rotation.
//
// Jetzt traegt der Wert seinen eigenen Ablauf und ist per HMAC an das Secret
// gebunden. Der Nonce macht jede Sitzung unterscheidbar, damit ein Cookie
// nicht als globaler Wiedererkennungswert taugt.
const COOKIE_VERSION = 'v1';

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function cookieValueForSecret(secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + INTERNAL_COOKIE_MAX_AGE;
  const payload = `${COOKIE_VERSION}.${exp}.${randomHex(16)}`;
  return `${payload}.${await hmacHex(secret, payload)}`;
}

export async function verifyCookieValue(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  const secret = process.env.INTERNAL_DASHBOARD_SECRET;
  if (!secret) return false;

  const parts = cookieValue.split('.');
  if (parts.length !== 4) return false;
  const [version, expRaw, nonce, signature] = parts;
  if (version !== COOKIE_VERSION) return false;
  if (!/^\d+$/.test(expRaw) || !/^[0-9a-f]{32}$/.test(nonce)) return false;

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return false;
  // Ein Cookie mit absurd fernem Ablauf ist zwar nur mit gueltiger Signatur
  // herstellbar, aber ein solcher Wert kann nur aus einem Fehler stammen.
  if (exp > Math.floor(Date.now() / 1000) + INTERNAL_COOKIE_MAX_AGE + 60) return false;

  const expected = await hmacHex(secret, `${version}.${expRaw}.${nonce}`);
  return timingSafeEqualStr(signature, expected);
}

export function verifySecret(secret: string | undefined): boolean {
  if (!secret) return false;
  const expected = process.env.INTERNAL_DASHBOARD_SECRET;
  if (!expected) return false;
  return timingSafeEqualStr(secret, expected);
}
