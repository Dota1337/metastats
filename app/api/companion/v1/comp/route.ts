// Comp-Detail fuer die Overwolf-App: Aufstellung (ein Feld je Unit), Endstufe
// der Spieler mit Ergebnis, wann die Stufen erreicht werden und die
// meistgespielten fruehen Boards je Spielerstufe 4-7.
//
// Zahlen kommen aus denselben Routen wie die Detailseite (/api/tft/comps mit
// slug, /api/tft/positions/by-units) im selben Prozess; Stufen-Zeitpunkte und
// Early-Boards aus der MetaTFT-Datei des laufenden Sets.
import { NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import path from 'path';
import { GET as compsGET } from '../../../tft/comps/route';
import { GET as byUnitsGET } from '../../../tft/positions/by-units/route';
import { CURRENT_SET } from '../../../../lib/current-set';
import type { CompGuidesBundle } from '../../../../lib/tft-comp-guides';
import {
  COMPANION_API_VERSION, companionJson, companionPreflight, companionStats, resolveBoard,
  type CompanionCompDetail, type CompanionEarlyBoard,
} from '../../../../lib/companion-api';

export const maxDuration = 60;

const NO_STORE = { cdn: 'no-store', browser: 'no-store' };
const CACHE = { cdn: 'public, s-maxage=1800, stale-while-revalidate=21600' };
const EARLY_MIN_GAMES = 50;

export function OPTIONS() {
  return companionPreflight();
}

let guidesCache: { set: number; file: CompGuidesBundle | null } | null = null;
function loadGuides(): CompGuidesBundle | null {
  if (guidesCache?.set === CURRENT_SET) return guidesCache.file;
  let file: CompGuidesBundle | null = null;
  try {
    const p = path.join(process.cwd(), 'public', `tft-metatft-comps-${CURRENT_SET}.json`);
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as CompGuidesBundle;
    // Datei eines anderen Sets waere schlimmer als keine (wie loadCompGuidesBundle).
    if (Number(parsed.set) === CURRENT_SET) file = parsed;
  } catch {
    // Datei fehlt — dann ohne Stufen-Zeitpunkte und Early-Boards.
  }
  guidesCache = { set: CURRENT_SET, file };
  return file;
}

const UNIT_RE = /^[A-Za-z0-9_]{2,60}$/;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const slug = sp.get('slug') || '';
  if (!/^[\w@~*.-]{3,160}$/.test(slug)) {
    return companionJson({ v: COMPANION_API_VERSION, error: 'bad_slug' }, { status: 400, ...NO_STORE });
  }
  const region = /^[a-z0-9_]{2,20}$/.test(sp.get('region') || '') ? sp.get('region')! : 'all';
  const askedUnits = (sp.get('units') || '').split(',').map(u => u.trim()).filter(u => UNIT_RE.test(u)).slice(0, 12);

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
      typicalUnits?: Array<{ characterId: string }>;
      mergedFamilies?: string[];
      outcome?: { levels?: Array<{ level: number; games: number; share: number; avgPlacement: number; top4Rate: number; top1Rate: number }> } | null;
    } | null;
  } | null;
  const comp = body?.comp;
  if (!comp) {
    return companionJson({ v: COMPANION_API_VERSION, error: 'not_found' }, { status: 404, ...NO_STORE });
  }
  const families = (comp.mergedFamilies || []).filter(f => /^[\w@]+_[A-Za-z0-9_]+$/.test(f)).slice(0, 4);
  const units = askedUnits.length > 0
    ? askedUnits
    : (comp.typicalUnits || []).map(u => u.characterId).filter(u => UNIT_RE.test(u)).slice(0, 9);

  // Aufstellung: je Unit die Feld-Anteile, Konflikte loest resolveBoard.
  let board: CompanionCompDetail['board'] = [];
  let boardSource: CompanionCompDetail['boardSource'] = null;
  if (units.length > 0) {
    const pos = new URL('/api/tft/positions/by-units', origin);
    pos.search = new URLSearchParams({ units: units.join(','), ...(families.length ? { cluster: families.join(',') } : {}) }).toString();
    const pr = await byUnitsGET(new NextRequest(pos)).catch(() => null);
    const pj = pr && pr.ok ? await pr.json().catch(() => null) as {
      hasData?: boolean; source?: CompanionCompDetail['boardSource'];
      units?: Record<string, Array<{ cell: number; share: number }>>;
    } | null : null;
    if (pj?.hasData && pj.units) {
      board = resolveBoard(units, pj.units);
      boardSource = board.length > 0 ? (pj.source ?? null) : null;
    }
  }

  // Stufen-Zeitpunkte + Early-Boards aus MetaTFT, erste Familie mit Eintrag.
  const guides = loadGuides();
  const metaId = families.map(f => guides?.familyMap[f]).find(Boolean);
  const details = metaId ? guides?.details[metaId] : undefined;
  const levelTiming = (details?.levels || [])
    .filter(l => Number.isFinite(l.level) && l.stage && l.round)
    .map(l => ({ level: l.level, stage: `${l.stage}-${l.round}` }));
  const early: Record<string, CompanionEarlyBoard[]> = {};
  for (const [lvl, opts] of Object.entries(details?.earlyByLevel || {})) {
    const boards = (opts || [])
      .filter(o => Array.isArray(o.units) && o.units.length > 0 && (o.count ?? 0) >= EARLY_MIN_GAMES)
      .map(o => ({ units: o.units, games: o.count ?? 0, avg: o.avg == null ? null : Number(o.avg.toFixed(2)) }));
    if (boards.length > 0) early[lvl] = boards;
  }

  const out: CompanionCompDetail = {
    v: COMPANION_API_VERSION,
    slug,
    board,
    boardSource,
    levels: (comp.outcome?.levels || []).map(l => ({
      level: l.level,
      share: Number(l.share.toFixed(3)),
      ...companionStats(l),
    })),
    levelTiming,
    early,
  };
  return companionJson(out, CACHE);
}
