// Comp-Detail fuer die Overwolf-App: Aufstellung (ein Feld je Unit), Endstufe
// der Spieler mit Ergebnis, wann die Stufen erreicht werden und die
// meistgespielten fruehen Boards je Spielerstufe 4-7.
//
// Zahlen kommen aus denselben Routen wie die Detailseite (/api/tft/comps mit
// slug, /api/tft/positions/by-units) im selben Prozess; Stufen-Zeitpunkte und
// Early-Boards aus der MetaTFT-Datei des laufenden Sets.
import { NextRequest } from 'next/server';
import { GET as compsGET } from '../../../tft/comps/route';
import { GET as byUnitsGET } from '../../../tft/positions/by-units/route';
import { resolveGuideId } from '../../../../lib/tft-comp-guides';
import { loadGuidesFromDisk } from '../../../../lib/tft-comp-guides-server';
import { LOW_DATA_GAMES } from '../../../../lib/tft-comp-outcome';
import {
  COMPANION_API_VERSION, companionJson, companionPreflight, companionStats, resolveBoard, unitsAtPlayerLevel,
  type CompanionCompDetail, type CompanionEarlyBoard,
} from '../../../../lib/companion-api';

export const maxDuration = 60;

const NO_STORE = { cdn: 'no-store', browser: 'no-store' };
const CACHE = { cdn: 'public, s-maxage=1800, stale-while-revalidate=21600' };
const EARLY_MIN_GAMES = 50;

export function OPTIONS() {
  return companionPreflight();
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
  // Ab App 0.6: Carries + Item-Traeger fuer die Early-Game-Zuordnung.
  const askedCarries = (sp.get('carries') || '').split(',').map(u => u.trim()).filter(u => UNIT_RE.test(u)).slice(0, 6);

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
  const families = (comp.mergedFamilies || []).filter(f => /^[\w@]+_[A-Za-z0-9_]+$/.test(f)).slice(0, 4);
  const units = askedUnits.length > 0
    ? askedUnits
    : (comp.typicalUnits || []).map(u => u.characterId).filter(u => UNIT_RE.test(u)).slice(0, 9);

  // Feld-Anteile je Unit; die Route nimmt hoechstens 12 Units je Anfrage, die
  // Anteile einer Unit haengen nicht von den anderen ab.
  type Shares = Record<string, Array<{ cell: number; share: number }>>;
  const fetchShares = async (ids: string[]): Promise<{ units: Shares; source: CompanionCompDetail['boardSource'] } | null> => {
    const pos = new URL('/api/tft/positions/by-units', origin);
    pos.search = new URLSearchParams({ units: ids.join(','), ...(families.length ? { cluster: families.join(',') } : {}) }).toString();
    const pr = await byUnitsGET(new NextRequest(pos)).catch(() => null);
    const pj = pr && pr.ok ? await pr.json().catch(() => null) as {
      hasData?: boolean; source?: CompanionCompDetail['boardSource']; units?: Shares;
    } | null : null;
    return pj?.hasData && pj.units ? { units: pj.units, source: pj.source ?? null } : null;
  };

  // Aufstellung: je Unit die Feld-Anteile, Konflikte loest resolveBoard.
  let board: CompanionCompDetail['board'] = [];
  let boardSource: CompanionCompDetail['boardSource'] = null;
  if (units.length > 0) {
    const pj = await fetchShares(units);
    if (pj) {
      board = resolveBoard(units, pj.units);
      boardSource = board.length > 0 ? pj.source : null;
    }
  }

  // Endbrett je Spielerstufe (Umschalter in der App): Stufen 5-9 mit
  // mindestens LOW_DATA_GAMES Spielen der Comp auf der Stufe. Units = die
  // haeufigsten auf der Stufe, Feld-Anteile dieselben wie fuer `board`.
  const outcome = comp.outcome;
  const levelUnits = new Map<number, string[]>();
  for (const l of outcome?.levels || []) {
    if (l.level < 5 || l.level > 9 || l.games < LOW_DATA_GAMES) continue;
    const ids = unitsAtPlayerLevel(outcome?.units || [], l.level).filter(u => UNIT_RE.test(u));
    if (ids.length > 0) levelUnits.set(l.level, ids);
  }
  let boardsByPlayerLevel: CompanionCompDetail['boardsByPlayerLevel'];
  if (levelUnits.size > 0) {
    const all = [...new Set([...levelUnits.values()].flat())];
    const chunks: string[][] = [];
    for (let i = 0; i < all.length; i += 12) chunks.push(all.slice(i, i + 12));
    const parts = await Promise.all(chunks.map(fetchShares));
    const shares: Shares = Object.assign({}, ...parts.map(p => p?.units ?? {}));
    for (const [lvl, ids] of levelUnits) {
      const b = resolveBoard(ids, shares);
      if (b.length > 0) (boardsByPlayerLevel ??= {})[String(lvl)] = b;
    }
  }

  // Stufen-Zeitpunkte + Early-Boards aus MetaTFT. Zuordnung wie auf der Seite
  // (resolveGuideId): Familien-Eintrag oder bestes Brett ab Jaccard 0,7 mit
  // einem unserer Carries darin.
  const guides = loadGuidesFromDisk();
  const familyCarries = families.map(f => f.split('__')[1]).filter((c): c is string => !!c);
  const guideUnits = (comp.typicalUnits || []).map(u => u.characterId).filter(u => UNIT_RE.test(u)).slice(0, 9);
  const metaId = guides
    ? resolveGuideId(guides, families, guideUnits, [...new Set([...askedCarries, ...familyCarries])])
    : null;
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
    ...(boardsByPlayerLevel ? { boardsByPlayerLevel } : {}),
  };
  // Ohne Ergebnis-Bloecke (Zeitlimit der Abfrage) nicht zwischenspeichern,
  // sonst fehlt der Umschalter eine halbe Stunde lang.
  return companionJson(out, outcome ? CACHE : NO_STORE);
}
