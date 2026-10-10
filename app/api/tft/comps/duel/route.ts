import { NextRequest, NextResponse } from 'next/server';
import { getAvailablePatches, resolveFilters } from '../../../../lib/tft-supabase-reader';
import { cachedJson, cacheControlForPatches, maybeRedirectByPatchAlias } from '../../../../lib/api-cache';
import { FAMILY_KEY_RE, duelOf, opponentsOf, splitOpponents, type MatchupEdge } from '../../../../lib/tft-comp-matchups';
import { compRepresentatives, fetchCompMatchups } from '../../../../lib/tft-comp-matchups-server';

// /api/tft/comps/duel?a=<fam>[,<fam>]&b=<fam>[,<fam>]&region=&bucket=&days=
//
// Duell zweier Comps fuer die Vergleichsseite: wie oft landet A vor B, wenn
// beide in derselben Lobby sind, plus die klarsten Gegner jeder Seite.
// Familien = comp.mergedFamilies der Detail-Antwort (<trait>__<carry>, Zwei-
// Carry-Familien zusammen). Quelle: Familien-Duelle je Rang (Migration 0092),
// Schwellen aus tft-comp-matchups.ts. days = 0: das Fenster hat noch keine
// neuen Tage, die Seite blendet Duell und Gegner aus.

const MAX_FAMS = 4;
const OPPONENTS = 3;

function famList(v: string | null): string[] | null {
  if (!v) return null;
  const list = [...new Set(v.split(',').map(s => s.trim()).filter(Boolean))];
  if (list.length === 0 || list.length > MAX_FAMS || !list.every(f => FAMILY_KEY_RE.test(f))) return null;
  return list;
}

const round = (v: number, digits: number) => Number(v.toFixed(digits));

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const famsA = famList(sp.get('a'));
  const famsB = famList(sp.get('b'));
  if (!famsA || !famsB) return NextResponse.json({ error: 'a and b required' }, { status: 400 });
  try {
    const patches = await getAvailablePatches();
    const redirect = maybeRedirectByPatchAlias(request, patches);
    if (redirect) return redirect;
    const cacheControl = cacheControlForPatches(patches);
    const filters = await resolveFilters(sp);
    const [m, reps] = await Promise.all([
      fetchCompMatchups(filters, [...new Set([...famsA, ...famsB])]),
      compRepresentatives(filters).catch(() => new Map<string, { key: string; games: number }>()),
    ]);
    const edge = (e: MatchupEdge) => ({ fam: e.fam, slug: reps.get(e.fam)?.key ?? null, games: e.games, rate: round(e.rate, 4) });
    // Gegnerlisten ohne die jeweils andere Seite — die steht im Duell.
    const side = (own: string[], other: string[]) => {
      const s = splitOpponents(opponentsOf(m.rows, own, other), OPPONENTS);
      return { strong: s.strong.map(edge), weak: s.weak.map(edge) };
    };
    const has = m.days > 0;
    const duel = has ? duelOf(m.rows, famsA, famsB) : null;
    return cachedJson({
      filters: { region: filters.regionLabel, bucket: filters.bucketLabel, days: filters.days, patch: filters.patch },
      days: m.days,
      duel: duel ? { ...duel, rate: round(duel.rate, 4) } : null,
      a: has ? side(famsA, famsB) : null,
      b: has ? side(famsB, famsA) : null,
    }, { cache: cacheControl });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
