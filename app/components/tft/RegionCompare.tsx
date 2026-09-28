'use client';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { ACTIVE_REGIONS } from '../../lib/active-regions';
import { costColor } from '../../lib/tft-ui';
import { findChampion, tftChampionTileUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';
import { regionShortLabel } from './StatsFilterBar';

// Regionsvergleich auf /tft/meta-pulse: dieselben Units in 2-3 Regionen
// nebeneinander. Je Region ein Abruf von /api/tft/units mit festem Patch und
// festem Rang, damit alle Spalten dieselbe Zaehlmenge haben.

export const REGION_COMPARE_DEFAULT = ['euw1', 'kr', 'na1'];
const MIN_REGIONS = 2;
const MAX_REGIONS = 3;
// Unter dieser Spielzahl zeigt die Zelle „—".
const MIN_GAMES = 100;
// Streuung einer Einzelplatzierung (1-8 gleichverteilt ≈ 2,29).
const PLACE_SD = 2.29;
// Farbe nur bei spuerbarem UND gesichertem Abstand.
const MIN_DELTA = 0.15;

interface UnitRow {
  characterId: string;
  games: number;
  avgPlacement: number | null;
  pickRate: number | null;
}

interface Cell { games: number; avg: number; pick: number | null }

export function parseCompareRegions(raw: string | null): string[] {
  if (!raw) return REGION_COMPARE_DEFAULT;
  const out: string[] = [];
  for (const r of raw.toLowerCase().split(',')) {
    if (ACTIVE_REGIONS.includes(r) && !out.includes(r)) out.push(r);
  }
  return out.length >= MIN_REGIONS ? out.slice(0, MAX_REGIONS) : REGION_COMPARE_DEFAULT;
}

function noise(n1: number, n2: number) {
  return 3 * PLACE_SD * Math.sqrt(1 / n1 + 1 / n2);
}

function prettyCharId(id: string) {
  return id.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
}

export default function RegionCompare({
  regions, onRegionsChange, bucket, days, patch, assets,
}: {
  regions: string[];
  onRegionsChange: (r: string[]) => void;
  bucket: string;
  days: number;
  patch: string | null;
  assets: TftAssetsBundle | null;
}) {
  const { t } = useI18n();
  const [byRegion, setByRegion] = useState<Record<string, UnitRow[] | null>>({});
  const [query, setQuery] = useState('');
  const [sortRegion, setSortRegion] = useState<string | null>(null);

  const regionsKey = regions.join(',');
  useEffect(() => {
    const ctrl = new AbortController();
    setByRegion({});
    const base = `bucket=${encodeURIComponent(bucket)}&days=${days}${patch ? `&patch=${encodeURIComponent(patch)}` : ''}`;
    for (const r of regionsKey.split(',')) {
      fetch(`/api/tft/units?${base}&region=${r}`, { signal: ctrl.signal })
        .then(res => res.ok ? res.json() : { units: [] })
        .then(d => setByRegion(prev => ({ ...prev, [r]: Array.isArray(d.units) ? d.units : [] })))
        .catch(err => { if (err?.name !== 'AbortError') setByRegion(prev => ({ ...prev, [r]: [] })); });
    }
    return () => ctrl.abort();
  }, [regionsKey, bucket, days, patch]);

  useEffect(() => {
    if (sortRegion && !regions.includes(sortRegion)) setSortRegion(null);
  }, [regions, sortRegion]);

  const loading = regions.some(r => byRegion[r] == null);

  const rows = useMemo(() => {
    if (loading) return [];
    const ids = new Set<string>();
    const cells: Record<string, Map<string, Cell>> = {};
    for (const r of regions) {
      const m = new Map<string, Cell>();
      for (const u of byRegion[r] || []) {
        if (u.games >= MIN_GAMES && u.avgPlacement != null) {
          m.set(u.characterId, { games: u.games, avg: u.avgPlacement, pick: u.pickRate });
          ids.add(u.characterId);
        }
      }
      cells[r] = m;
    }
    const q = query.trim().toLowerCase();
    const out = [];
    for (const id of ids) {
      const champ = findChampion(assets, id);
      const name = champ?.name || prettyCharId(id);
      if (q && !name.toLowerCase().includes(q)) continue;
      const perRegion = regions.map(r => cells[r].get(id) || null);
      const present = regions
        .map((r, i) => ({ r, c: perRegion[i] }))
        .filter((x): x is { r: string; c: Cell } => x.c != null);
      let best: string | null = null;
      let worst: string | null = null;
      let secured = -Infinity;
      if (present.length >= 2) {
        const lo = present.reduce((a, b) => (b.c.avg < a.c.avg ? b : a));
        const hi = present.reduce((a, b) => (b.c.avg > a.c.avg ? b : a));
        const delta = hi.c.avg - lo.c.avg;
        const nz = noise(lo.c.games, hi.c.games);
        secured = delta - nz;
        if (delta >= MIN_DELTA && delta > nz) { best = lo.r; worst = hi.r; }
      }
      out.push({ id, champ, name, perRegion, best, worst, secured, bestAny: present.length
        ? present.reduce((a, b) => (b.c.avg < a.c.avg ? b : a)).r : regions[0] });
    }
    if (sortRegion) {
      const i = regions.indexOf(sortRegion);
      out.sort((a, b) => (a.perRegion[i]?.avg ?? 9) - (b.perRegion[i]?.avg ?? 9));
    } else {
      out.sort((a, b) => b.secured - a.secured);
    }
    return out;
  }, [loading, regions, byRegion, query, assets, sortRegion]);

  const chip = (active: boolean) => `px-2.5 py-1 text-[11px] uppercase tracking-widest rounded border transition-colors ${
    active
      ? 'bg-accent border-accent text-white'
      : 'bg-surface-raised border-border-subtle text-fg-secondary hover:border-accent-a40'
  }`;

  const toggle = (r: string) => {
    if (regions.includes(r)) {
      if (regions.length > MIN_REGIONS) onRegionsChange(regions.filter(x => x !== r));
    } else if (regions.length < MAX_REGIONS) {
      onRegionsChange([...regions, r]);
    }
  };

  // Handy: Name als eigene Zeile, darunter die Regionen gleich breit.
  // Ab sm: Name links, Regionen rechts in einer Zeile.
  const gridCls = 'grid grid-cols-[repeat(var(--n),minmax(0,1fr))] sm:grid-cols-[minmax(0,1fr)_repeat(var(--n),minmax(4.25rem,7rem))]';
  const nStyle = { '--n': regions.length } as React.CSSProperties;

  return (
    <section className="bg-surface-base border border-border-subtle rounded p-4 mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-xs uppercase tracking-widest" style={{ color: '#c39bff' }}>{t('tft.metaPulse.regionCompare')}</h2>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('tft.search.units')}
          aria-label={t('tft.search.units')}
          className="w-full sm:w-56 bg-surface-raised border border-border-subtle rounded px-2.5 py-1.5 text-sm text-white placeholder:text-fg-muted focus:outline-none focus:border-accent-a40"
        />
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {ACTIVE_REGIONS.map(r => {
          const active = regions.includes(r);
          const disabled = active ? regions.length <= MIN_REGIONS : regions.length >= MAX_REGIONS;
          return (
            <button
              key={r}
              type="button"
              onClick={() => toggle(r)}
              aria-pressed={active}
              aria-label={(active ? t('tft.metaPulse.regionRemove') : t('tft.metaPulse.regionAdd')).replace('{r}', regionShortLabel(r))}
              className={`${chip(active)} ${disabled && !active ? 'opacity-40 cursor-not-allowed' : ''}`}
              disabled={disabled && !active}
            >
              {regionShortLabel(r)}
            </button>
          );
        })}
      </div>

      <div className={`${gridCls} gap-x-2 gap-y-1 px-2 pb-1.5 text-[10px] uppercase tracking-widest text-fg-muted`} style={nStyle}>
        <button
          type="button"
          onClick={() => setSortRegion(null)}
          className={`col-span-full sm:col-span-1 text-left uppercase tracking-widest truncate min-w-0 ${sortRegion == null ? 'text-white' : 'hover:text-white'}`}
          title={t('tft.metaPulse.sortGap')}
        >
          {t('tft.metaPulse.sortGap')}{sortRegion == null ? ' ▾' : ''}
        </button>
        {regions.map(r => (
          <button
            key={r}
            type="button"
            onClick={() => setSortRegion(r)}
            className={`text-right uppercase tracking-widest ${sortRegion === r ? 'text-white' : 'hover:text-white'}`}
          >
            {regionShortLabel(r)}{sortRegion === r ? ' ▾' : ''}
          </button>
        ))}
      </div>

      {loading && <div className="text-fg-muted text-center py-8">…</div>}
      {!loading && rows.length === 0 && <div className="text-fg-faint text-xs text-center py-6">—</div>}

      {!loading && rows.length > 0 && (
        <div className="space-y-1">
          {rows.map(row => {
            const tile = tftChampionTileUrl(assets, row.champ);
            const linkRegion = sortRegion || row.best || row.bestAny;
            return (
              <a
                key={row.id}
                title={row.name}
                href={`/tft/units/${encodeURIComponent(row.id)}?bucket=${encodeURIComponent(bucket)}&region=${linkRegion}&days=${days}`}
                className={`${gridCls} gap-x-2 gap-y-1 items-center bg-surface-raised border border-border-subtle rounded px-2 py-1.5 hover:border-accent-a40 transition-colors`}
                style={nStyle}
              >
                <div className="col-span-full sm:col-span-1 flex items-center gap-2 min-w-0">
                  <div
                    className="w-8 h-8 rounded-md border-2 overflow-hidden flex-shrink-0"
                    style={{ borderColor: costColor(row.champ?.cost ?? 1) }}
                  >
                    {tile && <img src={tile} alt={row.name} className="w-full h-full object-cover" />}
                  </div>
                  <span className="text-white text-sm truncate">{row.name}</span>
                </div>
                {row.perRegion.map((c, i) => {
                  const r = regions[i];
                  const color = r === row.best ? '#3ecf8e' : r === row.worst ? '#e44040' : undefined;
                  return (
                    <div
                      key={r}
                      className="text-right tabular-nums"
                      title={c ? `${regionShortLabel(r)} · ${c.games} ${t('tft.gamesShort')}` : undefined}
                    >
                      {c ? (
                        <>
                          <div className="text-sm font-medium" style={{ color: color || 'white' }}>{c.avg.toFixed(2)}</div>
                          <div className="text-[10px] text-fg-muted">{c.pick != null ? `${(c.pick * 100).toFixed(1)}%` : '—'}</div>
                        </>
                      ) : (
                        <div className="text-sm text-fg-faint">—</div>
                      )}
                    </div>
                  );
                })}
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
