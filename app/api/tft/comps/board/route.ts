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
import { significantLevelSteps } from '../../../../lib/tft-comp-guides';
import type { LevelRow } from '../../../../lib/tft-comp-outcome';
import {
  BOARD_UNIT_RE, buildCompBoards, defaultLevel, type BoardSource, type CellShares,
} from '../../../../lib/tft-comp-board';
import type { CompanionBoardCell } from '../../../../lib/companion-types';

export const maxDuration = 60;

// Reiter der Seite: Stufe 7, 8, 9, je mindestens 50 Spiele der Comp auf der
// Stufe (darunter faellt der Reiter weg).
const LEVEL_RANGE: [number, number] = [7, 9];
const MIN_LEVEL_GAMES = 50;
const EARLY_MIN_GAMES = 50;

export interface CompBoardResponse {
  slug: string;
  boardSource: BoardSource;
  /** Gesamtbrett aus den typischen Units — nur genutzt, wenn keine Stufe ein eigenes Brett hat. */
  board: CompanionBoardCell[];
  /** Stufen mit eigenem Brett, aufsteigend; share = Anteil der Spiele, die auf der Stufe enden. */
  levels: Array<{ level: number; share: number; games: number; top4Rate: number }>;
  boardsByPlayerLevel: Record<string, CompanionBoardCell[]>;
  defaultLevel: number | null;
  /** MetaTFT-Kuerzel der Strategie ("lvl 7", "Fast 8", "Standard"); Anzeige ueber parseLevelling. */
  levelling: string | null;
  /** Levelschritte wie auf der Detailseite (significantLevelSteps), nicht alle wie in der App. */
  levelTiming: Array<{ level: number; stage: string }>;
}

function degraded(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': DEGRADED_CACHE_CONTROL } });
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
      levelRange: LEVEL_RANGE,
      minLevelGames: MIN_LEVEL_GAMES,
      earlyMinGames: EARLY_MIN_GAMES,
      extraCarries: carries,
    });

    const byLevel = boards.boardsByPlayerLevel || {};
    const levels = (comp.outcome?.levels || [])
      .filter(l => byLevel[String(l.level)])
      .sort((a, b) => a.level - b.level)
      .map(l => ({
        level: l.level,
        share: Number(l.share.toFixed(3)),
        games: l.games,
        top4Rate: Number(l.top4Rate.toFixed(3)),
      }));

    // Levelplan derselben MetaTFT-Comp, die auch die Positionen liefert. Die
    // Schritte gefiltert wie auf der Detailseite (CompGuide): Stufen, die kaum
    // ein Spieler erreicht, waeren eine erfundene Genauigkeit.
    const guideComp = boards.guideId ? guides?.comps.find(c => c.id === boards.guideId) : undefined;
    const steps = boards.guideId ? significantLevelSteps(guides?.details[boards.guideId]?.levels || []) : [];
    const levelTiming = steps.length >= 2
      ? steps.filter(s => Number.isFinite(s.level) && s.stage && s.round).map(s => ({ level: s.level, stage: `${s.stage}-${s.round}` }))
      : [];

    const out: CompBoardResponse = {
      slug,
      boardSource: boards.boardSource,
      board: boards.board,
      levels,
      boardsByPlayerLevel: byLevel,
      defaultLevel: defaultLevel(levels),
      levelling: guideComp?.levelling ?? null,
      levelTiming,
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
