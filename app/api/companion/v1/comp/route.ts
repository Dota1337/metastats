// Comp-Detail fuer die Overwolf-App: Aufstellung (ein Feld je Unit), Endstufe
// der Spieler mit Ergebnis, wann die Stufen erreicht werden und die
// meistgespielten fruehen Boards je Spielerstufe 4-7.
//
// Zahlen kommen aus denselben Routen wie die Detailseite (/api/tft/comps mit
// slug, /api/tft/positions/by-units) im selben Prozess; Stufen-Zeitpunkte und
// Early-Boards aus der MetaTFT-Datei des laufenden Sets. Das Brett rechnet
// buildCompBoards — dieselbe Funktion wie das Brett der Comp-Liste
// (/api/tft/comps/board).
import { NextRequest } from 'next/server';
import { GET as compsGET } from '../../../tft/comps/route';
import { GET as byUnitsGET } from '../../../tft/positions/by-units/route';
import { loadGuidesFromDisk } from '../../../../lib/tft-comp-guides-server';
import { guideStyleFromUnits } from '../../../../lib/tft-comp-guides';
import { parseClusterKey } from '../../../../lib/tft-cluster';
import { LOW_DATA_GAMES } from '../../../../lib/tft-comp-outcome';
import {
  BOARD_UNIT_RE, COMPANION_API_VERSION, EARLY_MIN_GAMES, POSITIONING_MIN_GAMES,
  buildCompBoards, companionJson, companionPreflight, companionStats, compPositioning, parseGuideParam, pickLevelBoards,
  type CellShares, type CompanionCompDetail,
} from '../../../../lib/companion-api';

export const maxDuration = 60;

const NO_STORE = { cdn: 'no-store', browser: 'no-store' };
const CACHE = { cdn: 'public, s-maxage=1800, stale-while-revalidate=21600' };

export function OPTIONS() {
  return companionPreflight();
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const slug = sp.get('slug') || '';
  if (!/^[\w@~*.-]{3,160}$/.test(slug)) {
    return companionJson({ v: COMPANION_API_VERSION, error: 'bad_slug' }, { status: 400, ...NO_STORE });
  }
  const region = /^[a-z0-9_]{2,20}$/.test(sp.get('region') || '') ? sp.get('region')! : 'all';
  const askedUnits = (sp.get('units') || '').split(',').map(u => u.trim()).filter(u => BOARD_UNIT_RE.test(u)).slice(0, 12);
  // Ab App 0.6: Carries + Item-Traeger fuer die Early-Game-Zuordnung.
  const askedCarries = (sp.get('carries') || '').split(',').map(u => u.trim()).filter(u => BOARD_UNIT_RE.test(u)).slice(0, 6);

  const origin = request.nextUrl.origin;
  const inner = new URL('/api/tft/comps', origin);
  inner.search = new URLSearchParams({
    slug, patch: 'current', bucket: 'master_plus', days: '3', region, bucketAuto: '1',
    // Wie die Detailseite — nur fuer diese Anfrage gibt es den vorberechneten
    // Stand (snapshot-matrix DETAIL_MIN_GAMES), sonst rechnet die DB live.
    minGames: '30', variant: 'family',
  }).toString();
  const res = await compsGET(new NextRequest(inner));
  if (!res.ok) {
    return companionJson({ v: COMPANION_API_VERSION, error: 'comp_unavailable' }, { status: 503, ...NO_STORE });
  }
  const body = await res.json().catch(() => null) as {
    comp?: {
      clusterKey?: string;
      typicalUnits?: Array<{ characterId: string; gamesWithUnit?: unknown; star3Games?: unknown }>;
      mergedFamilies?: string[];
      outcome?: {
        levels?: Array<{ level: number; games: number; share: number; avgPlacement: number; top4Rate: number; top1Rate: number }>;
        units?: Array<{ characterId: string; levelGames?: Record<string, number> }>;
      } | null;
    } | null;
  } | null;
  const comp = body?.comp;
  if (!comp) {
    return companionJson({ v: COMPANION_API_VERSION, error: 'not_found' }, { status: 404, ...NO_STORE });
  }

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
      hasData?: boolean; source?: CompanionCompDetail['boardSource']; units?: CellShares;
    } | null : null;
    return pj?.hasData && pj.units ? { units: pj.units, source: pj.source ?? null } : null;
  };

  // Endbretter je Spielerstufe 5-9 ab 50 Spielen in EINEM Durchgang: daraus
  // das Positioning wie auf der Homepage (7-9 ab 50) und fuer Apps bis 0.8.0
  // das alte Feld (5-9 ab LOW_DATA_GAMES). Das Brett einer Stufe haengt nicht
  // von den anderen Stufen ab (tft-comp-board.test.mjs).
  // Ab 0.8.1 schickt die App die MetaTFT-Comp ihrer Comp-Zeile mit (?guide=).
  const guides = loadGuidesFromDisk();
  const boards = await buildCompBoards({
    comp,
    fetchShares,
    guides,
    levelRange: [5, 9],
    minLevelGames: POSITIONING_MIN_GAMES,
    earlyMinGames: EARLY_MIN_GAMES,
    boardUnits: askedUnits,
    extraCarries: askedCarries,
    guideId: parseGuideParam(sp.get('guide')),
    guideStyle: guideStyleFromUnits(parseClusterKey(comp.clusterKey || slug)?.carry, comp.typicalUnits),
  });
  const legacyBoards = pickLevelBoards(boards.boardsByPlayerLevel, comp.outcome?.levels, [5, 9], LOW_DATA_GAMES);

  const out: CompanionCompDetail = {
    v: COMPANION_API_VERSION,
    slug,
    board: boards.board,
    boardSource: boards.boardSource,
    levels: (comp.outcome?.levels || []).map(l => ({
      level: l.level,
      share: Number(l.share.toFixed(3)),
      ...companionStats(l),
    })),
    levelTiming: boards.levelTiming,
    early: boards.early,
    ...(legacyBoards ? { boardsByPlayerLevel: legacyBoards } : {}),
    positioning: compPositioning(boards, comp.outcome?.levels, guides),
    guideId: boards.guideId,
  };
  // Ohne Ergebnis-Bloecke (Zeitlimit der Abfrage) nicht zwischenspeichern,
  // sonst fehlt der Umschalter eine halbe Stunde lang.
  return companionJson(out, comp.outcome ? CACHE : NO_STORE);
}
