// Riot-Anmeldung (Riot Sign-On, RSO) — die Logik ohne Next und ohne Datenbank.
// Plan: .claude/plan-archive (14.11.2026, „Riot-Anmeldung“), Reviews von
// architect, logic-flow-critic und data-skeptic.
//
// Ablauf:
//   /auth/riot/start    → Cookie mit state + PKCE-Schluessel, weiter zu Riot
//   Riot                → Spieler meldet sich bei Riot an, Riot schickt ?code
//   /auth/riot/callback → Code gegen Token tauschen, Riot-ID lesen, Token
//                         verwerfen, Konto finden/anlegen/verknuepfen, Sitzung
//
// Zuordnung ueber die puuid, die Riot bei accounts/me liefert (rso_puuid).
// Sie wird NIE direkt mit Spieldaten verbunden: die puuid haengt am Riot-
// Schluessel. Fuer TFT-Daten zaehlt tft_puuid (mit dem TFT-Schluessel
// aufgeloest), fuer LoL der Name (data-skeptic 14.11.2026).
//
// Konten aus der Riot-Anmeldung bekommen eine feste Kennung und eine
// Platzhalter-Adresse, beide aus HMAC(puuid). Faellt nach dem Anlegen etwas
// aus, findet der naechste Versuch dasselbe Konto wieder (getUser(id)) — ohne
// das waere die Riot-ID dauerhaft gesperrt, weil Supabase keine Suche nach
// E-Mail kennt (architect + logic-flow-critic 14.11.2026). Nur Konten mit
// app_metadata.rso_created gelten als unsere; das Feld kann nur der Server setzen.
//
// Fehler gehen nur als feste Codes nach aussen, nie mit Riot- oder Supabase-Text.

import { isValidRegion } from './regions';
import { safeNext } from './safe-next';
import { RSO_EMAIL_DOMAIN } from './riot-rso-email';

export type RsoMode = 'login' | 'link';
export type RsoErrorCode =
  | 'riot_off' | 'riot_denied' | 'state' | 'exchange' | 'account' | 'conflict' | 'has_other' | 'already_signed_in';

export const RSO_AUTHORIZE_URL = 'https://auth.riotgames.com/authorize';
export const RSO_TOKEN_URL = 'https://auth.riotgames.com/token';
// account-v1 ist spieluebergreifend; europe liegt am naechsten an Vercel fra1.
export const RIOT_ACCOUNT_V1 = 'https://europe.api.riotgames.com/riot/account/v1';
export const RSO_CALLBACK_PATH = '/auth/riot/callback';
export const RSO_COOKIE_PATH = '/auth/riot';
export const RSO_COOKIE_MAX_AGE_S = 600;
const COOKIE_VERSION = 'v1';
const TOKEN_TIMEOUT_MS = 5000;
const ENRICH_TIMEOUT_MS = 2000;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function hmac(secret: string, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
}

// ------------------------------------------------------------------ Cookie

export type RsoCookie = {
  s: string;          // state
  v: string;          // PKCE-Schluessel
  m: RsoMode;
  n: string;          // Ziel danach (bereits geprueft)
  u: string | null;   // angemeldeter Nutzer beim Start (nur „link“)
  e: number;          // Ablauf, ms
};

/** Ein Cookie je Anmeldung: zwei Tabs ueberschreiben sich sonst gegenseitig. */
export function rsoCookieName(state: string): string {
  return `rso_${state.slice(0, 16)}`;
}

export async function sealRsoCookie(p: RsoCookie, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(p)));
  const sig = b64url(await hmac(secret, `cookie:${COOKIE_VERSION}.${body}`));
  return `${COOKIE_VERSION}.${body}.${sig}`;
}

export async function openRsoCookie(raw: string | undefined, secret: string, now: number): Promise<RsoCookie | null> {
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== COOKIE_VERSION) return null;
  const want = b64url(await hmac(secret, `cookie:${parts[0]}.${parts[1]}`));
  if (!sameString(want, parts[2])) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Partial<RsoCookie>;
    if (typeof p.s !== 'string' || typeof p.v !== 'string' || typeof p.n !== 'string' || typeof p.e !== 'number') return null;
    if (p.m !== 'login' && p.m !== 'link') return null;
    if (p.u !== null && typeof p.u !== 'string') return null;
    if (p.e < now) return null;
    return p as RsoCookie;
  } catch {
    return null;
  }
}

// ------------------------------------------------- Kennung + Platzhalter

/** Feste Konto-Kennung aus der puuid (UUID-Form, Version 4 gesetzt). */
export async function rsoUserId(puuid: string, secret: string): Promise<string> {
  const h = (await hmac(secret, `uid:${puuid}`)).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = Buffer.from(h).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export async function rsoPlaceholderEmail(puuid: string, secret: string): Promise<string> {
  const h = Buffer.from(await hmac(secret, `mail:${puuid}`)).toString('hex').slice(0, 32);
  return `riot-${h}@${RSO_EMAIL_DOMAIN}`;
}

// ------------------------------------------------------------------ Start

export type StartInput = {
  mode: RsoMode;
  next: string;
  currentUserId: string | null;
  origin: string;
  clientId: string;
  linkSecret: string;
  now: number;
};

export type StartResult = { location: string; cookie?: { name: string; value: string } };

export async function rsoStart(i: StartInput): Promise<StartResult> {
  // Angemeldet + „mit Riot anmelden“: nicht still ein zweites Konto anlegen,
  // sondern zur Kontoseite (dort: verknuepfen).
  if (i.mode === 'login' && i.currentUserId) return { location: '/auth/account' };
  if (i.mode === 'link' && !i.currentUserId) return { location: `/auth/login?next=${encodeURIComponent('/auth/account')}` };

  const state = randomToken(24);
  const verifier = randomToken(48);
  const value = await sealRsoCookie({
    s: state, v: verifier, m: i.mode, n: safeNext(i.next), u: i.mode === 'link' ? i.currentUserId : null,
    e: i.now + RSO_COOKIE_MAX_AGE_S * 1000,
  }, i.linkSecret);

  const url = new URL(RSO_AUTHORIZE_URL);
  url.searchParams.set('client_id', i.clientId);
  url.searchParams.set('redirect_uri', `${i.origin}${RSO_CALLBACK_PATH}`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', await pkceChallenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return { location: url.toString(), cookie: { name: rsoCookieName(state), value } };
}

// --------------------------------------------------------------- Callback

export type LinkRow = {
  user_id: string;
  rso_puuid: string;
  tft_puuid: string | null;
  game_name: string;
  tag_line: string;
  has_tft: boolean | null;
  lol_region: string | null;
};

export type Enrichment = { tft_puuid?: string; has_tft?: boolean; lol_region?: string | null };

export type RsoDeps = {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  clientId: string;
  clientSecret: string;
  linkSecret: string;
  /** RIOT_API_KEY_TFT — nur fuer die Anreicherung (User-Entscheid 14.11.2026). */
  tftKey: string | null;
  currentUserId: () => Promise<string | null>;
  findLinkByPuuid: (rsoPuuid: string) => Promise<LinkRow | null>;
  findLinkByUser: (userId: string) => Promise<LinkRow | null>;
  /** Nur INSERT, nie upsert: ein upsert wuerde Verknuepfungen still umhaengen. */
  insertLink: (row: { user_id: string; rso_puuid: string; game_name: string; tag_line: string }) => Promise<'ok' | 'dup_puuid' | 'dup_user' | 'error'>;
  updateLinkNames: (userId: string, rsoPuuid: string, gameName: string, tagLine: string) => Promise<void>;
  updateLinkEnrichment: (userId: string, rsoPuuid: string, e: Enrichment) => Promise<void>;
  createUser: (a: { id: string; email: string; name: string }) => Promise<'ok' | 'error'>;
  getUser: (id: string) => Promise<{ id: string; email: string | null; rsoCreated: boolean } | null>;
  deleteUser: (id: string) => Promise<void>;
  setUserName: (id: string, name: string) => Promise<void>;
  /** Sitzung fuer diese Adresse setzen (Cookies in die Antwort). */
  createSession: (email: string) => Promise<boolean>;
  log: (event: string, data?: Record<string, string | number | boolean | null>) => void;
};

export type CallbackInput = { query: URLSearchParams; cookies: Record<string, string>; origin: string };
export type CallbackResult = { location: string; clearCookies: string[] };

type RiotAccount = { puuid: string; gameName: string; tagLine: string };

async function exchangeCode(code: string, verifier: string, origin: string, d: RsoDeps):
  Promise<{ kind: 'ok'; accessToken: string } | { kind: 'invalid_grant' } | { kind: 'error' }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${origin}${RSO_CALLBACK_PATH}`,
    code_verifier: verifier,
  });
  const basic = Buffer.from(`${d.clientId}:${d.clientSecret}`).toString('base64');
  try {
    const res = await d.fetch(RSO_TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (res.ok) {
      const j = await res.json().catch(() => null) as { access_token?: unknown } | null;
      if (typeof j?.access_token === 'string' && j.access_token) return { kind: 'ok', accessToken: j.access_token };
      d.log('rso_token_bad_body');
      return { kind: 'error' };
    }
    const j = await res.json().catch(() => null) as { error?: unknown } | null;
    if (res.status === 400 && j?.error === 'invalid_grant') return { kind: 'invalid_grant' };
    d.log('rso_token_failed', { status: res.status });
    return { kind: 'error' };
  } catch {
    d.log('rso_token_failed', { status: 0 });
    return { kind: 'error' };
  }
}

async function accountMe(accessToken: string, d: RsoDeps): Promise<RiotAccount | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await d.fetch(`${RIOT_ACCOUNT_V1}/accounts/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
        cache: 'no-store',
      });
      if (res.ok) {
        const j = await res.json().catch(() => null) as Partial<RiotAccount> | null;
        if (j && typeof j.puuid === 'string' && j.puuid && typeof j.gameName === 'string' && j.gameName
          && typeof j.tagLine === 'string' && j.tagLine) {
          return { puuid: j.puuid, gameName: j.gameName, tagLine: j.tagLine };
        }
        d.log('rso_account_bad_body');
        return null;
      }
      if (res.status !== 429 && res.status < 500) {
        d.log('rso_account_failed', { status: res.status });
        return null;
      }
      // Der Code ist schon verbraucht — einmal kurz warten und nochmal.
      const ra = parseFloat(res.headers.get('retry-after') || '');
      if (attempt === 0) await d.sleep(Math.min(2000, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 500));
    } catch {
      if (attempt === 0) await d.sleep(500);
    }
  }
  d.log('rso_account_failed', { status: -1 });
  return null;
}

/** Legt ein reines Riot-Konto an oder findet ein halb angelegtes wieder.
 *  Rueckgabe: Kennung des Kontos, dem die puuid jetzt gehoert, sonst null. */
async function createRiotOnlyUser(acc: RiotAccount, d: RsoDeps): Promise<string | null> {
  const id = await rsoUserId(acc.puuid, d.linkSecret);
  const email = await rsoPlaceholderEmail(acc.puuid, d.linkSecret);
  const created = await d.createUser({ id, email, name: `${acc.gameName}#${acc.tagLine}` });
  const createdNow = created === 'ok';
  if (!createdNow) {
    // Gibt es das Konto schon (frueherer Teilfehler, gleichzeitiger Erst-Login)?
    const u = await d.getUser(id);
    if (!u || !u.rsoCreated) {
      d.log('rso_create_failed', { foreign: !!u });
      return null;
    }
  }
  const r = await d.insertLink({ user_id: id, rso_puuid: acc.puuid, game_name: acc.gameName, tag_line: acc.tagLine });
  if (r === 'ok') return id;
  if (r === 'dup_puuid') {
    const winner = await d.findLinkByPuuid(acc.puuid);
    if (winner && winner.user_id !== id && createdNow) await d.deleteUser(id).catch(() => {});
    return winner?.user_id ?? null;
  }
  if (r === 'dup_user') {
    const mine = await d.findLinkByUser(id);
    return mine?.rso_puuid === acc.puuid ? id : null;
  }
  if (createdNow) await d.deleteUser(id).catch(() => {});
  d.log('rso_link_insert_failed');
  return null;
}

/** TFT-Kennung und Server mit dem TFT-Schluessel. Nur Zusatz: scheitert es,
 *  bleibt die Anmeldung gueltig und die Felder bleiben, wie sie waren. */
export async function enrichRiotLink(acc: RiotAccount, d: RsoDeps): Promise<Enrichment | null> {
  const key = d.tftKey;
  if (!key) return null;
  const get = async (path: string): Promise<{ status: number; body: Record<string, unknown> | null }> => {
    try {
      const r = await d.fetch(`${RIOT_ACCOUNT_V1}${path}`, {
        headers: { 'X-Riot-Token': key },
        signal: AbortSignal.timeout(ENRICH_TIMEOUT_MS),
        cache: 'no-store',
      });
      return { status: r.status, body: r.ok ? await r.json().catch(() => null) : null };
    } catch {
      return { status: 0, body: null };
    }
  };
  const sameName = (b: Record<string, unknown> | null) => !!b
    && String(b.gameName ?? '').toLowerCase() === acc.gameName.toLowerCase()
    && String(b.tagLine ?? '').toLowerCase() === acc.tagLine.toLowerCase();

  // Erst ueber die puuid: 200 mit gleichem Namen = Riot gibt beiden Schluesseln
  // dieselbe Kennung. 400 = Kennung einer anderen App → ueber den Namen, mit
  // Abgleich (ein Name kann seit dem Login den Besitzer gewechselt haben).
  let tftPuuid: string | null = null;
  const byPuuid = await get(`/accounts/by-puuid/${encodeURIComponent(acc.puuid)}`);
  if (byPuuid.status === 200 && sameName(byPuuid.body)) {
    tftPuuid = acc.puuid;
    d.log('rso_puuid_vs_tft', { same: true });
  } else if (byPuuid.status === 400 || byPuuid.status === 404 || byPuuid.status === 200) {
    d.log('rso_puuid_vs_tft', { same: false, status: byPuuid.status });
    const byId = await get(`/accounts/by-riot-id/${encodeURIComponent(acc.gameName)}/${encodeURIComponent(acc.tagLine)}`);
    if (byId.status === 200 && sameName(byId.body) && typeof byId.body?.puuid === 'string') tftPuuid = byId.body.puuid;
  }
  if (!tftPuuid) return null;

  const enc2 = encodeURIComponent(tftPuuid);
  const [tft, lol] = await Promise.all([
    get(`/region/by-game/tft/by-puuid/${enc2}`),
    get(`/region/by-game/lol/by-puuid/${enc2}`),
  ]);
  const out: Enrichment = { tft_puuid: tftPuuid };
  if (tft.status === 200) out.has_tft = true;
  else if (tft.status === 404) out.has_tft = false;
  if (lol.status === 200) {
    const raw = String(lol.body?.region ?? '').toLowerCase();
    out.lol_region = raw && isValidRegion(raw) ? raw : null;
  } else if (lol.status === 404) {
    out.lol_region = null;  // kein LoL-Konto
  }
  return out;
}

export async function rsoCallback(input: CallbackInput, d: RsoDeps): Promise<CallbackResult> {
  const state = input.query.get('state') || '';
  const cookieName = state ? rsoCookieName(state) : '';
  const clearCookies = cookieName ? [cookieName] : [];
  const ck = cookieName ? await openRsoCookie(input.cookies[cookieName], d.linkSecret, d.now()) : null;
  if (!ck || !sameString(ck.s, state)) {
    return { location: '/auth/login?error=state', clearCookies };
  }
  const errBase = ck.m === 'link' ? '/auth/account' : '/auth/login';
  const fail = (code: RsoErrorCode): CallbackResult => ({ location: `${errBase}?error=${code}`, clearCookies });
  const done = (): CallbackResult => ({ location: safeNext(ck.n), clearCookies });

  if (input.query.get('error')) return fail('riot_denied');
  const code = input.query.get('code');
  if (!code) return fail('riot_denied');

  const current = await d.currentUserId();
  // Verknuepfen: es muss noch derselbe Nutzer angemeldet sein wie beim Start
  // (sonst landet die Riot-ID nach Tab-Wechsel beim falschen Konto).
  if (ck.m === 'link' && (!current || current !== ck.u)) return fail('state');

  const tok = await exchangeCode(code, ck.v, input.origin, d);
  if (tok.kind === 'invalid_grant') {
    // Doppelter Aufruf (Neuladen, Doppelklick): der erste hat schon angemeldet.
    if (current && (ck.m === 'login' || current === ck.u)) return done();
    return fail('exchange');
  }
  if (tok.kind !== 'ok') return fail('exchange');

  const acc = await accountMe(tok.accessToken, d);
  if (!acc) return fail('account');

  const owner = await d.findLinkByPuuid(acc.puuid);
  let userId: string;
  let needSession = false;

  if (ck.m === 'link') {
    const me = current as string;
    if (owner && owner.user_id !== me) return fail('conflict');
    if (!owner) {
      const mine = await d.findLinkByUser(me);
      if (mine) return fail('has_other');
      const r = await d.insertLink({ user_id: me, rso_puuid: acc.puuid, game_name: acc.gameName, tag_line: acc.tagLine });
      if (r === 'dup_puuid') {
        const again = await d.findLinkByPuuid(acc.puuid);
        if (again?.user_id !== me) return fail('conflict');
      } else if (r === 'dup_user') {
        return fail('has_other');
      } else if (r !== 'ok') {
        return fail('account');
      }
    }
    userId = me;
  } else if (owner) {
    userId = owner.user_id;
    needSession = current !== owner.user_id;  // anderer Nutzer angemeldet → Sitzung wechseln
  } else {
    // Unbekannte Riot-ID, aber schon angemeldet: kein zweites Konto daneben.
    if (current) return fail('already_signed_in');
    const id = await createRiotOnlyUser(acc, d);
    if (!id) return fail('account');
    userId = id;
    needSession = true;
  }

  const user = await d.getUser(userId);
  if (needSession) {
    if (!user?.email) return fail('account');
    let ok = await d.createSession(user.email);
    if (!ok) ok = await d.createSession(user.email);
    if (!ok) return fail('account');
  }

  // Ab hier ist die Anmeldung gueltig; alles Weitere ist Zusatz.
  try {
    await d.updateLinkNames(userId, acc.puuid, acc.gameName, acc.tagLine);
    if (user?.rsoCreated) await d.setUserName(userId, `${acc.gameName}#${acc.tagLine}`);
    const e = await enrichRiotLink(acc, d);
    if (e) await d.updateLinkEnrichment(userId, acc.puuid, e);
  } catch {
    d.log('rso_refresh_failed');
  }
  return done();
}
