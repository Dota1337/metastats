import { NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import path from 'path';
import { supabaseAdmin } from '../../../../lib/supabase';
import { cachedJson } from '../../../../lib/api-cache';
import { isKnownUnitId } from '../../../../lib/tft-classify-comp';
import { CURRENT_SET } from '../../../../lib/current-set';

// Returns position shares per (unit, cell) for a comma-separated set of
// units. The comp-detail page hits this with its typicalUnits list to render
// a per-unit mini board-heatmap. Cells are 0-based (row*7+col, row 0 = back).
//
// Source per unit, first one that has data wins — sources are never added
// together, only their shares are shown:
//   1. companion  tft_position_comp_cell for ?cluster=<trait>__<carry>[,...], once
//                 the unit stood in >= MIN_UNIT_MATCHES own games of this comp.
//   2. metatft    public/tft-metatft-boards-{set}.json (daily import): first
//                 the board of ?guide=<id> (resolveGuideId, the same MetaTFT
//                 comp the levelling plan comes from), then the file's
//                 familyMap. Both can name different boards for one family
//                 (11 of 79 families on 2026-10-08), the guide is the better fit.
//   3. global     tft_position_unit_cell view (all comps).
// `source` reports the one used, or 'mixed' if units came from different ones.

const MIN_UNIT_MATCHES = 30;
const KEEP_CELLS = 6;

type Source = 'companion' | 'metatft' | 'global';
interface CellShare { cell: number; observations: number; share: number }

interface BoardsFile {
  familyMap: Record<string, string>;
  boards: Record<string, Record<string, { cell: number; share: number }[]>>;
}

let boardsCache: { set: number; file: BoardsFile | null } | null = null;
function loadBoards(): BoardsFile | null {
  if (boardsCache?.set === CURRENT_SET) return boardsCache.file;
  let file: BoardsFile | null = null;
  try {
    const p = path.join(process.cwd(), 'public', `tft-metatft-boards-${CURRENT_SET}.json`);
    file = JSON.parse(readFileSync(p, 'utf8')) as BoardsFile;
  } catch {
    // Datei fehlt (neues Set, Import noch nicht gelaufen) — dann global.
  }
  boardsCache = { set: CURRENT_SET, file };
  return file;
}

/** Zaehlungen → Anteile je Unit, beste Zellen zuerst. */
function toShares(rows: { unit: string; cell: number; observations: number }[]): Record<string, CellShare[]> {
  const grouped: Record<string, CellShare[]> = {};
  for (const r of rows) {
    (grouped[r.unit] ||= []).push({ cell: Number(r.cell), observations: Number(r.observations), share: 0 });
  }
  for (const unit of Object.keys(grouped)) {
    const cells = grouped[unit];
    const total = cells.reduce((s, c) => s + c.observations, 0);
    if (total <= 0) { delete grouped[unit]; continue; }
    for (const c of cells) c.share = c.observations / total;
    cells.sort((a, b) => b.observations - a.observations);
    grouped[unit] = cells.slice(0, KEEP_CELLS);
  }
  return grouped;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const unitsParam = searchParams.get('units') || '';
  const clusterParam = searchParams.get('cluster') || '';
  const units = unitsParam
    .split(',')
    .map(u => u.trim())
    .filter(u => isKnownUnitId(u))
    .slice(0, 12);

  if (units.length === 0) {
    return cachedJson({ hasData: false, units: {} });
  }

  const result: Record<string, CellShare[]> = {};
  const used = new Set<Source>();
  // Mehrere Familien-Schluessel moeglich (Comp mit zwei Carries): je Unit
  // gewinnt der erste mit Daten, Quellen werden nie zusammengezaehlt.
  const clusters = clusterParam
    .split(',')
    .map(c => c.trim())
    .filter(c => /^[\w@]+_[A-Za-z0-9_]+$/.test(c))
    .slice(0, 4);

  // 1) Eigene Companion-Daten, je Unit sobald genug Partien da sind.
  if (clusters.length > 0) {
    const r = await supabaseAdmin
      .from('tft_position_comp_cell')
      .select('cluster_key, unit, cell, observations, unit_matches')
      .in('cluster_key', clusters)
      .in('unit', units);
    if (!r.error && r.data) {
      const enough = r.data.filter(d => Number(d.unit_matches) >= MIN_UNIT_MATCHES);
      for (const cluster of clusters) {
        const rows = enough.filter(d => d.cluster_key === cluster && !result[d.unit]);
        for (const [unit, cells] of Object.entries(toShares(rows))) {
          result[unit] = cells;
          used.add('companion');
        }
      }
    }
  }

  // 2) MetaTFT-Aufstellung: zuerst die zugeordnete MetaTFT-Comp, dann die
  //    Familien-Eintraege der Datei.
  const guideParam = searchParams.get('guide') || '';
  const guide = /^\d{1,12}$/.test(guideParam) ? guideParam : null;
  const boards = clusters.length > 0 || guide ? loadBoards() : null;
  const boardIds = [...new Set([guide, ...clusters.map(c => boards?.familyMap[c])])]
    .filter((id): id is string => !!id);
  for (const id of boardIds) {
    const board = boards?.boards[id];
    if (board) {
      for (const unit of units) {
        if (result[unit] || !board[unit]?.length) continue;
        result[unit] = board[unit].map(c => ({ cell: c.cell, observations: 0, share: c.share }));
        used.add('metatft');
      }
    }
  }

  // 3) Globale Sicht ueber alle Comps fuer den Rest.
  const missing = units.filter(u => !result[u]);
  if (missing.length > 0) {
    const r = await supabaseAdmin
      .from('tft_position_unit_cell')
      .select('unit, cell, observations')
      .in('unit', missing);
    if (r.error && used.size === 0) {
      return cachedJson({ hasData: false, units: {}, error: r.error.message });
    }
    for (const [unit, cells] of Object.entries(toShares(r.data || []))) {
      result[unit] = cells;
      used.add('global');
    }
  }

  const source = used.size === 1 ? [...used][0] : used.size > 1 ? 'mixed' : 'global';
  return cachedJson({
    hasData: Object.keys(result).length > 0,
    source,
    units: result,
  });
}
