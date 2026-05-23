import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '../../lib/supabase-server';

// OAuth + email-confirmation landing endpoint. Supabase appends ?code= to
// the redirect URL after the provider hands the user back; we exchange it
// for a session cookie and forward to the original `next` destination.

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') || '/';

  if (code) {
    const supabase = await getSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/auth/login?error=${encodeURIComponent(error.message)}`);
    }
  }
  return NextResponse.redirect(`${origin}${next.startsWith('/') ? next : '/'}`);
}
