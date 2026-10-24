// Wer teilt oder bewertet eine Community-Comp? (Sicherheitsdurchsicht 24.10.2026)
//
// Bis zum 24.10. galt jedes Cookie `tft_author_token` mit 16–80 Zeichen als
// Person, und ohne Cookie wurde fuer jeden Aufruf eine neue erfunden. Damit
// griffen weder „5 geteilte Comps pro Tag“ (share/route.ts) noch „eine Stimme
// pro Person“ (upvote/route.ts): jeder Aufruf ohne oder mit ausgedachtem Cookie
// war ein neuer Autor.
//
// Jetzt:
// - Das Cookie ist unterschrieben (`<id>_<sig>`). Ausgedachte Werte zaehlen nicht.
// - Ohne gueltiges Cookie ist die Kennung aus der IP abgeleitet (HMAC mit
//   Server-Schluessel, nicht umkehrbar). Wer das Cookie wegwirft, bekommt von
//   derselben IP dieselbe Kennung zurueck — die Grenzen gelten also je IP.
//   Mit Cookie bleibt die Kennung auch bei IP-Wechsel dieselbe.
// - Alte Cookies (32 Hex-Zeichen, unsigniert) gelten weiter, wenn die Kennung
//   schon eine Comp oder Stimme in der Datenbank hat — so verliert niemand die
//   Zuordnung seiner bisherigen Comps.
//
// Die Kennung in der Datenbank behaelt die bisherige Form (32 Hex-Zeichen).

import type { NextRequest, NextResponse } from 'next/server';
import { clientIpFromRequest } from './rate-limit';
import { supabaseAdmin } from './supabase';
import { authorKey, ID_RE, idFromIp, idFromSignedCookie, signedCookieValue } from './community-author-token';

export const AUTHOR_COOKIE = 'tft_author_token';

async function legacyIdKnown(id: string): Promise<boolean> {
  const [comps, votes] = await Promise.all([
    supabaseAdmin.from('tft_public_comps').select('id', { count: 'exact', head: true }).eq('author_token', id),
    supabaseAdmin.from('tft_public_comp_upvotes').select('comp_id', { count: 'exact', head: true }).eq('author_token', id),
  ]);
  return (comps.count ?? 0) > 0 || (votes.count ?? 0) > 0;
}

export interface CommunityAuthor {
  /** Kennung fuer author_token in der Datenbank. */
  id: string;
  /** Wert fuer das Cookie (unterschrieben). */
  cookie: string;
}

/** Null nur, wenn das Server-Geheimnis fehlt — dann lehnt die Route ab. */
export async function resolveCommunityAuthor(req: NextRequest): Promise<CommunityAuthor | null> {
  const key = authorKey();
  if (!key) return null;
  const raw = req.cookies.get(AUTHOR_COOKIE)?.value || '';
  let id = raw ? idFromSignedCookie(key, raw) : null;
  if (!id && ID_RE.test(raw) && await legacyIdKnown(raw)) id = raw;
  if (!id) id = idFromIp(key, clientIpFromRequest(req));
  return { id, cookie: signedCookieValue(key, id) };
}

export function setAuthorCookie(res: NextResponse, author: CommunityAuthor): void {
  res.cookies.set(AUTHOR_COOKIE, author.cookie, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 365 * 86_400,
    path: '/',
  });
}
