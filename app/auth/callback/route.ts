import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '../../lib/supabase-server';
import { safeNext } from '../../lib/safe-next';

// OAuth + email-confirmation landing endpoint. Supabase appends ?code= to
// the redirect URL after the provider hands the user back; we exchange it
// for a session cookie and forward to the original `next` destination.
// Fehler nur als fester Code, nie mit Supabase-Text in der Adresse.

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));

  if (code) {
    const supabase = await getSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/auth/login?error=oauth`);
    }
  }
  return NextResponse.redirect(`${origin}${next}`);
}
