import { NextRequest } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { cachedJson } from '../../../../lib/api-cache';

// Returns position frequency per (unit, cell) for a comma-separated set of
// units. The comp-detail page hits this with its typicalUnits list to render
// a per-unit mini board-heatmap.
//
// Tier of source:
//   ?cluster=…  → reads tft_position_comp_cell (comp-specific positions,
//                 produced by the aggregator script that joins observations
//                 against tft_player_match_cache.comp_cluster_key).
//   no cluster  → reads the tft_position_unit_cell view (global positions
//                 across all comps). Useful as a fallback when the comp
//                 doesn't have enough comp-specific observations yet.

interface PositionRow {
  unit: string;
  cell: number;
  observations: number;
  distinct_observers: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const unitsParam = searchParams.get('units') || '';
  const cluster = searchParams.get('cluster') || '';
  const units = unitsParam
    .split(',')
    .map(u => u.trim())
    .filter(u => /^TFT\d+_[A-Za-z0-9]+$/.test(u))
    .slice(0, 12);

  if (units.length === 0) {
    return cachedJson({ hasData: false, units: {} });
  }

  // Cluster-specific path: comp-bound positions from the aggregator table.
  // Falls through to the global view if the cluster row count is too thin.
  let data: any[] | null = null;
  let error: any = null;
  let source: 'comp' | 'global' = 'global';

  if (cluster && /^[\w@]+_[A-Za-z0-9_]+$/.test(cluster)) {
    const r = await supabase
      .from('tft_position_comp_cell')
      .select('unit, cell, observations')
      .eq('cluster_key', cluster)
      .in('unit', units);
    if (!r.error && r.data && r.data.length >= units.length * 2) {
      data = r.data.map(d => ({ ...d, distinct_observers: 0 }));
      source = 'comp';
    }
  }

  if (!data) {
    const r = await supabase
      .from('tft_position_unit_cell')
      .select('unit, cell, observations, distinct_observers')
      .in('unit', units);
    data = r.data;
    error = r.error;
  }

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
    source,
    units: grouped,
  });
}
