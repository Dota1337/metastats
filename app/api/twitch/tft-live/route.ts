import { NextRequest, NextResponse } from 'next/server';

// /api/twitch/tft-live?lang=en&first=20
// Live TFT streams from Twitch Helix (game_id=513143). Auth via
// client-credentials grant; missing creds → empty list (graceful degrade).

const TFT_GAME_ID = '513143';
let _token: { value: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string | null> {
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (_token && Date.now() < _token.expiresAt - 60_000) return _token.value;
  const body = new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' });
  const r = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body });
  if (!r.ok) return null;
  const j = await r.json();
  _token = { value: j.access_token, expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return _token.value;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lang = searchParams.get('lang');
  const first = Math.max(1, Math.min(100, parseInt(searchParams.get('first') || '20', 10)));

  const token = await getAppToken();
  if (!token) return NextResponse.json({ streams: [], note: 'twitch_creds_missing' });
  const id = process.env.TWITCH_CLIENT_ID!;
  const params = new URLSearchParams({ game_id: TFT_GAME_ID, first: String(first) });
  if (lang) params.append('language', lang);
  const r = await fetch(`https://api.twitch.tv/helix/streams?${params}`, {
    headers: { 'Client-Id': id, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return NextResponse.json({ streams: [], note: `twitch_${r.status}` });
  const j = await r.json();
  const streams = (j.data || []).map((s: any) => ({
    id: s.id,
    userLogin: s.user_login,
    userName: s.user_name,
    title: s.title,
    viewerCount: s.viewer_count,
    startedAt: s.started_at,
    language: s.language,
    thumbnailUrl: (s.thumbnail_url || '').replace('{width}', '320').replace('{height}', '180'),
  }));
  return NextResponse.json({ streams });
}
