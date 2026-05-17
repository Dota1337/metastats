import { NextRequest } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { cachedJson } from '../../../../lib/api-cache';

// Returns position frequency per (unit, cell) for a comma-separated set of
// units. The comp-detail page hits this with its typicalUnits list to render
// a per-unit mini board-heatmap. Reads from the tft_position_unit_cell view
// which aggregates raw observations submitted by the Overwolf companion app.
//
// We don't filter by comp — for the first MVP, "Lulu's preferred cell" is a
// global signal and doesn't differ wildly between Stargazer-Mountain Lulu vs
// Stargazer-Fountain Lulu. Once observation volume grows we'll add
// comp-cluster aggregation as a follow-up table.

interface PositionRow {
  unit: string;
  cell: number;
  observations: number;
  distinct_observers: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const unitsParam = searchParams.get('units') || '';
  const units = unitsParam
    .split(',')
    .map(u => u.trim())
    .filter(u => /^TFT\d+_[A-Za-z0-9]+$/.test(u))
    .slice(0, 12);

  if (units.length === 0) {
    return cachedJson({ hasData: false, units: {} });
  }

  const { data, error } = await supabase
    .from('tft_position_unit_cell')
    .select('unit, cell, observations, distinct_observers')
    .in('unit', units);

  if (error) {
    return cachedJson({ hasData: false, units: {}, error: error.message });
  }

  // Group by unit, keep top-N cells per unit.
  const grouped: Record<string, { cell: number; observations: number; share: number }[]> = {};
  for (const row of (data || []) as PositionRow[]) {
    if (!grouped[row.unit]) grouped[row.unit] = [];
    grouped[row.unit].push({ cell: row.cell, observations: Number(row.observations), share: 0 });
  }

  // Sort by observations desc + compute share-of-total per unit.
  for (const unit of Object.keys(grouped)) {
    const cells = grouped[unit];
    const total = cells.reduce((s, c) => s + c.observations, 0);
    if (total > 0) {
      for (const c of cells) c.share = c.observations / total;
    }
    cells.sort((a, b) => b.observations - a.observations);
    grouped[unit] = cells.slice(0, 6);
  }

  return cachedJson({
    hasData: Object.keys(grouped).length > 0,
    units: grouped,
  });
}
