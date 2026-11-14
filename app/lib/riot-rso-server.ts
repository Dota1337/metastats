// Datenbank- und Supabase-Anbindung der Riot-Anmeldung. Die Logik selbst steht
// in riot-rso.ts (ohne Netz getestet); hier nur, wie sie an Supabase haengt.
//
// Tabelle user_riot_links (Migration 0123): Zugriff nur ueber den Service-
// Schluessel, anon/authenticated haben keine Rechte.
import 'server-only';
import type { NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { supabaseAdmin } from './supabase';
import type { Enrichment, LinkRow, RsoDeps } from './riot-rso';
import type { RsoConfig } from './riot-rso-config';
import { lolPlayerPath, tftPlayerPath } from './og/slugs';

const TABLE = 'user_riot_links';
const COLS = 'user_id, rso_puuid, tft_puuid, game_name, tag_line, has_tft, lol_region';

export type PendingCookie = { name: string; value: string; options: CookieOptions };

/** Supabase-Client fuer Route-Handler, der Sitzungs-Cookies sammelt statt sie
 *  still zu verlieren (supabase-server.ts verschluckt Fehler beim Setzen). */
export function routeSupabase(req: NextRequest, pending: PendingCookie[]) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return req.cookies.getAll(); },
        setAll(items) { for (const it of items) pending.push(it as PendingCookie); },
      },
    },
  );
}

export async function findLinkByUser(userId: string): Promise<LinkRow | null> {
  const { data, error } = await supabaseAdmin.from(TABLE).select(COLS).eq('user_id', userId).maybeSingle();
  if (error) throw new Error('user_riot_links lesen fehlgeschlagen');
  return (data as LinkRow | null) ?? null;
}

export async function deleteLinkForUser(userId: string): Promise<void> {
  const { error } = await supabaseAdmin.from(TABLE).delete().eq('user_id', userId);
  if (error) throw new Error('user_riot_links loeschen fehlgeschlagen');
}

/** Konto aus der Riot-Anmeldung (keine andere Anmeldeart)? */
export function isRiotOnlyUser(user: { app_metadata?: Record<string, unknown> } | null | undefined): boolean {
  return user?.app_metadata?.rso_created === true;
}

/** Links zu den eigenen Spielerseiten. TFT mit ?puuid, damit ein alter Name
 *  die Seite nicht ins Leere schickt (api/tft/summoner route.ts:68-79). */
export function profilePaths(link: LinkRow | null): { tft: string | null; lol: string | null } {
  if (!link) return { tft: null, lol: null };
  const tft = link.has_tft === false ? null
    : `${tftPlayerPath(link.game_name, link.tag_line)}${link.tft_puuid ? `?puuid=${encodeURIComponent(link.tft_puuid)}` : ''}`;
  const lol = link.lol_region ? `${lolPlayerPath(link.game_name, link.tag_line)}?region=${encodeURIComponent(link.lol_region)}` : null;
  return { tft, lol };
}

function dupKind(err: { code?: string; message?: string } | null): 'dup_puuid' | 'dup_user' | null {
  if (err?.code !== '23505') return null;
  return /rso_puuid/.test(err.message || '') ? 'dup_puuid' : 'dup_user';
}

export function buildRsoDeps(cfg: RsoConfig, server: ReturnType<typeof routeSupabase>): RsoDeps {
  const admin = supabaseAdmin.auth.admin;
  return {
    fetch: (...a) => fetch(...a),
    now: () => Date.now(),
    sleep: (ms) => new Promise(r => setTimeout(r, ms)),
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    linkSecret: cfg.linkSecret,
    tftKey: process.env.RIOT_API_KEY_TFT || null,
    currentUserId: async () => {
      const { data } = await server.auth.getUser();
      return data.user?.id ?? null;
    },
    findLinkByPuuid: async (p) => {
      const { data, error } = await supabaseAdmin.from(TABLE).select(COLS).eq('rso_puuid', p).maybeSingle();
      if (error) throw new Error('user_riot_links lesen fehlgeschlagen');
      return (data as LinkRow | null) ?? null;
    },
    findLinkByUser,
    insertLink: async (row) => {
      const { error } = await supabaseAdmin.from(TABLE).insert(row);
      if (!error) return 'ok';
      return dupKind(error) ?? 'error';
    },
    updateLinkNames: async (userId, p, gameName, tagLine) => {
      await supabaseAdmin.from(TABLE)
        .update({ game_name: gameName, tag_line: tagLine, updated_at: new Date().toISOString() })
        .eq('user_id', userId).eq('rso_puuid', p);
    },
    updateLinkEnrichment: async (userId, p, e: Enrichment) => {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (e.tft_puuid !== undefined) patch.tft_puuid = e.tft_puuid;
      if (e.has_tft !== undefined) patch.has_tft = e.has_tft;
      if (e.lol_region !== undefined) patch.lol_region = e.lol_region;
      const { error } = await supabaseAdmin.from(TABLE).update(patch).eq('user_id', userId).eq('rso_puuid', p);
      // tft_puuid ist eindeutig; haengt sie schon an einem anderen Konto, ohne sie.
      if (error && patch.tft_puuid !== undefined) {
        delete patch.tft_puuid;
        await supabaseAdmin.from(TABLE).update(patch).eq('user_id', userId).eq('rso_puuid', p);
      }
    },
    createUser: async ({ id, email, name }) => {
      const { error } = await admin.createUser({
        id, email, email_confirm: true,
        app_metadata: { rso_created: true },
        user_metadata: { name, full_name: name },
      });
      return error ? 'error' : 'ok';
    },
    getUser: async (id) => {
      const { data, error } = await admin.getUserById(id);
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email ?? null, rsoCreated: isRiotOnlyUser(data.user) };
    },
    deleteUser: async (id) => { await admin.deleteUser(id); },
    setUserName: async (id, name) => {
      await admin.updateUserById(id, { user_metadata: { name, full_name: name } });
    },
    createSession: async (email) => {
      const { data, error } = await admin.generateLink({ type: 'magiclink', email });
      const tokenHash = data?.properties?.hashed_token;
      if (error || !tokenHash) return false;
      const v = await server.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
      return !v.error && !!v.data.session;
    },
    log: (event, data) => {
      // Nur Ereignis + Zahlen/Wahrheitswerte — nie Token, Geheimnis oder Riot-ID.
      console.log(`[riot-rso] ${event}${data ? ` ${JSON.stringify(data)}` : ''}`);
    },
  };
}
