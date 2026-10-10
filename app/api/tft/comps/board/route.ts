// Aufstellungsbrett einer Comp fuer die Comp-Liste: Endbrett je Spielerstufe
// 7-9 (Units und Felder der Stufe), Anteil der Spiele, die auf der Stufe enden,
// und der MetaTFT-Levelplan. Gleiche Rechnung wie die Overwolf-App
// (buildCompBoards in app/lib/tft-comp-board.ts), aber mit den Filtern der
// Seite (Patch, Rang, Tage, Region) statt fest master_plus.
//
// Zahlen kommen aus /api/tft/comps?slug= (minGames=30, variant=family — fuer
// genau diese Anfrage gibt es den vorberechneten Detail-Stand) und
// /api/tft/positions/by-units, beide im selben Prozess.
import { NextRequest, NextResponse } from 'next/server';
import { GET as compsGET } from '../route';
import { GET as byUnitsGET } from '../../positions/by-units/route';
import { getAvailablePatches } from '../../../../lib/tft-supabase-reader';
import {
  cachedJson, cacheControlForPatches, maybeRedirectByPatchAlias, DEGRADED_CACHE_CONTROL,
} from '../../../../lib/api-cache';
import { loadGuidesFromDisk } from '../../../../lib/tft-comp-guides-server';
import type { LevelRow } from '../../../../lib/tft-comp-outcome';
import {
  BOARD_UNIT_RE, EARLY_MIN_GAMES, POSITIONING_LEVELS, POSITIONING_MIN_GAMES,
  buildCompBoards, compPositioning, parseGuideParam, type BoardSource, type CellShares,
} from '../../../../lib/tft-comp-board';
import type { CompanionBoardCell, CompanionPositioning } from '../../../../lib/companion-types';

export const maxDuration = 60;

// Reiter, Startreiter, Levelplan und Levelschritte: compPositioning (dieselbe
// Regel wie in der App, Stufe 7-9 ab 50 Spielen).
export interface CompBoardResponse extends CompanionPositioning {
  slug: string;
  boardSource: BoardSource;
  /** Gesamtbrett aus den typischen Units — nur genutzt, wenn keine Stufe ein eigenes Brett hat. */
  board: CompanionBoardCell[];
}

// Fehlerantwort: die Edge haelt sie 10 s (schuetzt vor Wiederholungs-Stuermen),
// der Browser gar nicht — sonst liefert "Erneut versuchen" den alten Fehler.
function degraded(error: string, status: number) {
  return NextResponse.json({ error }, {
    status,
    headers: { 'Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': DEGRADED_CACHE_CONTROL },
  });
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const slug = sp.get('slug') || '';
  if (!/^[\w@~*.-]{3,160}$/.test(slug)) return degraded('bad_slug', 400);
  const patch = /^[\w.]{1,16}$/.test(sp.get('patch') || '') ? sp.get('patch')! : 'current';
  const bucket = /^[a-z_+]{2,24}$/.test(sp.get('bucket') || '') ? sp.get('bucket')! : 'master_plus';
  const days = String(Math.max(1, Math.min(7, parseInt(sp.get('days') || '3', 10) || 3)));
  const region = /^[a-z0-9_]{2,20}$/.test(sp.get('region') || '') ? sp.get('region')! : 'all';
  // Carries + Item-Traeger der Familie fuer die MetaTFT-Zuordnung (wie die App).
  const carries = (sp.get('carries') || '').split(',').map(u => u.trim()).filter(u => BOARD_UNIT_RE.test(u)).slice(0, 6);

  try {
    // ?patch=previous auf den konkreten Patch umleiten (wie jede Stats-Route),
    // nie als Fehler beantworten.
    const patches = await getAvailablePatches();
    const redirect = maybeRedirectByPatchAlias(request, patches);
    if (redirect) return redirect;

    const origin = request.nextUrl.origin;
    const inner = new URL('/api/tft/comps', origin);
    inner.search = new URLSearchParams({ slug, patch, bucket, days, region, minGames: '30', variant: 'family' }).toString();
    const res = await compsGET(new NextRequest(inner));
    if (!res.ok) return degraded('comp_unavailable', 503);
    const body = await res.json().catch(() => null) as {
      comp?: {
        typicalUnits?: Array<{ characterId: string }>;
        mergedFamilies?: string[];
        outcome?: {
          levels?: LevelRow[];
          units?: Array<{ characterId: string; levelGames?: Record<string, number> }>;
        } | null;
      } | null;
    } | null;
    const comp = body?.comp;
    if (!comp) return degraded('not_found', 404);

    // Feld-Anteile je Unit (by-units nimmt hoechstens 12 Units je Anfrage).
    const fetchShares = async (ids: string[], { families, guide }: { families: string[]; guide: string | null }) => {
      const pos = new URL('/api/tft/positions/by-units', origin);
      pos.search = new URLSearchParams({
        units: ids.join(','),
        ...(families.length ? { cluster: families.join(',') } : {}),
        ...(guide ? { guide } : {}),
      }).toString();
      const pr = await byUnitsGET(new NextRequest(pos)).catch(() => null);
      const pj = pr && pr.ok ? await pr.json().catch(() => null) as {
        hasData?: boolean; source?: BoardSource; units?: CellShares;
      } | null : null;
      return pj?.hasData && pj.units ? { units: pj.units, source: pj.source ?? null } : null;
    };

    const guides = loadGuidesFromDisk();
    const boards = await buildCompBoards({
      comp,
      fetchShares,
      guides,
      levelRange: POSITIONING_LEVELS,
      minLevelGames: POSITIONING_MIN_GAMES,
      earlyMinGames: EARLY_MIN_GAMES,
      extraCarries: carries,
      // Anleitung der Comp-Zeile (CompRow), damit Brett und Levelplan zur
      // Zeile passen.
      guideId: parseGuideParam(sp.get('guide')),
    });

    const out: CompBoardResponse = {
      slug,
      boardSource: boards.boardSource,
      board: boards.board,
      ...compPositioning(boards, comp.outcome?.levels, guides),
    };
    // Ohne Ergebnis-Block (Zeitlimit der Abfrage) fehlen die Stufen-Reiter —
    // dann nicht stundenlang zwischenspeichern.
    return comp.outcome
      ? cachedJson(out, { cache: cacheControlForPatches(patches) })
      : cachedJson(out, { degraded: true });
  } catch (e) {
    return degraded(e instanceof Error ? e.message : 'board_failed', 503);
  }
}
