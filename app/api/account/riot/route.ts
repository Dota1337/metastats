import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '../../../lib/supabase-server';
import { riotRsoEnabled } from '../../../lib/riot-rso-config';
import { deleteLinkForUser, findLinkByUser, isRiotOnlyUser, profilePaths } from '../../../lib/riot-rso-server';
import { sameOriginRequest } from '../../../lib/same-origin-request';

// Riot-Verknuepfung des angemeldeten Nutzers: GET = Stand (fuer Konto-Menue
// und Kontoseite), DELETE = Verknuepfung trennen. Trennen geht auch bei
// abgeschalteter Riot-Anmeldung — Daten loeschen darf nie an einem Schalter haengen.

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  try {
    const link = await findLinkByUser(data.user.id);
    const paths = profilePaths(link);
    return NextResponse.json({
      enabled: riotRsoEnabled(),
      riotOnly: isRiotOnlyUser(data.user),
      link: link ? { gameName: link.game_name, tagLine: link.tag_line, tftPath: paths.tft, lolPath: paths.lol } : null,
    }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });
  }
}

export async function DELETE(req: NextRequest) {
  if (!sameOriginRequest(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
  const supabase = await getSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  // Ein reines Riot-Konto ohne Riot waere nicht mehr erreichbar → dort heisst
  // Trennen Konto loeschen (eigener Weg mit Rueckfrage).
  if (isRiotOnlyUser(data.user)) return NextResponse.json({ error: 'riot_only' }, { status: 409, headers: NO_STORE });
  try {
    await deleteLinkForUser(data.user.id);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: NO_STORE });
  }
}
