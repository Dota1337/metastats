import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '../../../lib/supabase-server';
import { supabaseAdmin } from '../../../lib/supabase';
import { sameOriginRequest } from '../../../lib/same-origin-request';

// Konto loeschen (Kontoseite, nach Rueckfrage). Die Riot-Verknuepfung faellt
// per Fremdschluessel mit weg (0123: on delete cascade). Unabhaengig vom
// Riot-Schalter: Loeschen muss immer gehen.

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function POST(req: NextRequest) {
  if (!sameOriginRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
  const body = await req.json().catch(() => null) as { confirm?: unknown } | null;
  if (body?.confirm !== true) return NextResponse.json({ error: 'confirm_required' }, { status: 400, headers: NO_STORE });

  const supabase = await getSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user.id);
  if (error) return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });

  // Sitzungs-Cookies des geloeschten Kontos entfernen.
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  for (const c of req.cookies.getAll()) {
    if (c.name.startsWith('sb-')) res.cookies.set(c.name, '', { path: '/', maxAge: 0 });
  }
  return res;
}
