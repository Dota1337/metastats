'use client';
import { useEffect, useState } from 'react';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, tftChampionTileUrl, tftIconUrl, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis,
  ReferenceLine, Tooltip as RechartsTooltip,
} from 'recharts';

type Entity = 'unit' | 'item' | 'trait' | 'comp';
const ENTITIES: Entity[] = ['unit', 'item', 'trait', 'comp'];

// Same region set as /tft/onetricks — the regions where the daily-crawl
// has enough Master+ volume to make patch-deltas meaningful.
const REGIONS = [
  { value: '', label: 'tft.filter.allRegions' },
  { value: 'euw1', label: 'EUW' },
  { value: 'kr', label: 'KR' },
  { value: 'na1', label: 'NA' },
  { value: 'eun1', label: 'EUNE' },
  { value: 'br1', label: 'BR' },
  { value: 'jp1', label: 'JP' },
] as const;

interface DiffEntry {
  key: string;
  currentGames: number;
  previousGames: number;
  currentAvgPlacement: number;
  previousAvgPlacement: number;
  deltaAvgPlacement: number;
  currentPickRate: number;
  previousPickRate: number;
  deltaPickRate: number;
  currentTop4Rate: number;
  previousTop4Rate: number;
  deltaTop4Rate: number;
}

export default function TftPatchWinnersPage() {
  const { t } = useI18n();
  const [entity, setEntity] = useState<Entity>('unit');
  const [region, setRegion] = useState<string>('');
  const [winners, setWinners] = useState<DiffEntry[]>([]);
  const [losers, setLosers] = useState<DiffEntry[]>([]);
  const [info, setInfo] = useState<{ currentPatch: string | null; previousPatch: string | null }>({ currentPatch: null, previousPatch: null });
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({ entity });
    if (region) qs.set('region', region);
    fetch(`/api/tft/patch-diff?${qs.toString()}`)
      .then(r => r.ok ? r.json() : { winners: [], losers: [] })
      .then(d => {
        if (cancelled) return;
        setWinners(d.winners || []);
        setLosers(d.losers || []);
        setInfo({ currentPatch: d.currentPatch || null, previousPatch: d.previousPatch || null });
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entity, region]);

  // Compute max-delta across both lists for proportional bar widths.
  const maxAbsDelta = Math.max(
    1,
    ...[...winners, ...losers].map(e => Math.abs(e.deltaAvgPlacement)),
  );

  const renderRow = (e: DiffEntry, idx: number, isWinner: boolean) => {
    const display = renderEntity(e.key, entity, assets);
    const sign = e.deltaAvgPlacement < 0 ? '−' : '+';
    const barColor = isWinner ? '#3ecf8e' : '#e44040';
    const barWidth = (Math.abs(e.deltaAvgPlacement) / maxAbsDelta) * 100;
    const pickRatePct = (e.currentPickRate * 100).toFixed(1);
    const Wrapper: any = display.href ? 'a' : 'div';
    return (
      <Wrapper
        key={e.key}
        {...(display.href ? { href: display.href } : {})}
        className={`block bg-[#141c2e] border border-[#1e2a3a] rounded p-2.5 ${display.href ? 'hover:border-[#7B61FF]/40 transition-colors' : ''}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-[#7a8aa0] text-[10px] w-4 tabular-nums">#{idx + 1}</span>
          {display.icon}
          <div className="flex-1 min-w-0">
            <div className="text-white text-[12px] truncate">{display.name}</div>
            <div className="text-[#7a8aa0] text-[10px] tabular-nums">
              Ø {e.previousAvgPlacement.toFixed(2)} → {e.currentAvgPlacement.toFixed(2)}
              <span className="text-[#5a6a80]"> · {pickRatePct}% pick</span>
            </div>
          </div>
          <div className="text-sm tabular-nums font-medium" style={{ color: barColor }}>
            {sign}{Math.abs(e.deltaAvgPlacement).toFixed(2)}
          </div>
        </div>
        {/* Delta-bar: visualizes magnitude of avg-place swing */}
        <div className="mt-1.5 h-1 bg-[#0d1526] rounded overflow-hidden">
          <div className="h-full transition-all" style={{ width: `${barWidth.toFixed(0)}%`, backgroundColor: barColor }} />
        </div>
      </Wrapper>
    );
  };

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="patch" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-white text-2xl font-medium mb-1">{t('tft.patchWinners.title')}</h1>
        <p className="text-[#a0b0c5] text-sm mb-4">
          {info.previousPatch && info.currentPatch
            ? `${info.previousPatch} → ${info.currentPatch}`
            : t('tft.patchWinners.subtitle')}
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="flex gap-1">
            {ENTITIES.map(e => (
              <button
                key={e}
                onClick={() => setEntity(e)}
                className={`px-3 py-1.5 text-xs uppercase tracking-widest rounded border ${
                  entity === e
                    ? 'bg-[#7B61FF] border-[#7B61FF] text-white'
                    : 'bg-[#141c2e] border-[#1e2a3a] text-[#a0b0c5] hover:border-[#7B61FF]/40'
                }`}
              >
                {t(`nav.${e === 'unit' ? 'units' : e === 'item' ? 'items' : e === 'comp' ? 'comps' : 'traits'}` as const)}
              </button>
            ))}
          </div>
          <select
            value={region}
            onChange={e => setRegion(e.target.value)}
            className="bg-[#141c2e] border border-[#1e2a3a] rounded text-white text-xs px-2 py-1.5 ml-auto"
            aria-label={t('tft.filter.region')}
          >
            {REGIONS.map(r => (
              <option key={r.value} value={r.value}>
                {r.value === '' ? t(r.label as any) : r.label}
              </option>
            ))}
          </select>
        </div>

        {loading && <div className="text-[#a0b0c5] text-center py-8">…</div>}

        {!loading && (winners.length > 0 || losers.length > 0) && (() => {
          // Diverging swing chart: top movers on a shared zero-axis. swing =
          // −Δavg-placement, so improvement (lower placement) points right/green
          // and regression points left/red — the at-a-glance "what shifted".
          const top = [...winners.slice(0, 8), ...losers.slice(0, 8)];
          const rows = top
            .map(e => ({ key: e.key, name: renderEntity(e.key, entity, assets).name, swing: Number((-e.deltaAvgPlacement).toFixed(3)) }))
            .sort((a, b) => b.swing - a.swing);
          if (rows.length === 0) return null;
          const max = Math.max(0.05, ...rows.map(r => Math.abs(r.swing)));
          return (
            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mb-4">
              <div className="text-[#a0b0c5] text-[10px] uppercase tracking-widest mb-2">{t('tft.patchWinners.swingChart')}</div>
              <div style={{ width: '100%', height: rows.length * 22 + 12 }}>
                <ResponsiveContainer>
                  <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 12 }}>
                    <XAxis type="number" domain={[-max, max]} hide />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10, fill: '#a0b0c5' }} axisLine={false} tickLine={false} />
                    <ReferenceLine x={0} stroke="#33445c" />
                    <RechartsTooltip
                      cursor={{ fill: 'rgba(123,97,255,0.08)' }}
                      contentStyle={{ backgroundColor: '#0d1526', border: '1px solid #1e2a3a', borderRadius: 6, fontSize: 12 }}
                      labelStyle={{ color: '#a0b0c5' }}
                      formatter={(v: any) => [`${Number(v) >= 0 ? '+' : '−'}${Math.abs(Number(v)).toFixed(2)} Ø`, t('tft.patchWinners.swing')]}
                    />
                    <Bar dataKey="swing" radius={[2, 2, 2, 2]} barSize={11}>
                      {rows.map(r => <Cell key={r.key} fill={r.swing >= 0 ? '#3ecf8e' : '#e44040'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="text-[#5a6a80] text-[9px] mt-1">{t('tft.patchWinners.swingHint')}</div>
            </div>
          );
        })()}

        {!loading && (winners.length > 0 || losers.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section>
              <h2 className="text-[#3ecf8e] text-xs uppercase tracking-widest mb-2">▲ {t('tft.patchWinners.winners')}</h2>
              <div className="space-y-1.5">
                {winners.slice(0, 12).map((e, i) => renderRow(e, i, true))}
              </div>
            </section>
            <section>
              <h2 className="text-[#e44040] text-xs uppercase tracking-widest mb-2">▼ {t('tft.patchWinners.losers')}</h2>
              <div className="space-y-1.5">
                {losers.slice(0, 12).map((e, i) => renderRow(e, i, false))}
              </div>
            </section>
          </div>
        )}

        {!loading && winners.length === 0 && losers.length === 0 && (
          <div className="text-[#a0b0c5] text-center py-8">{t('tft.patchWinners.empty')}</div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function renderEntity(key: string, entity: Entity, assets: TftAssetsBundle | null) {
  if (entity === 'unit') {
    const champ = assets?.champions[key];
    const url = tftChampionTileUrl(assets, champ);
    return {
      name: champ?.name || key.replace(/^TFT\d+_/, ''),
      icon: url ? <img src={url} alt="" className="w-8 h-8 rounded border border-[#c39bff]/60" /> : <div className="w-8 h-8 rounded bg-[#1e2a3a]" />,
      href: `/tft/units/${encodeURIComponent(key)}`,
    };
  }
  if (entity === 'item') {
    const item = assets?.items[key];
    const url = tftIconUrl(assets, item?.icon);
    return {
      name: item?.name || key.replace(/^TFT\d*_Item_/, ''),
      icon: url ? <img src={url} alt="" className="w-7 h-7 rounded" /> : <div className="w-7 h-7 rounded bg-[#1e2a3a]" />,
      href: `/tft/items/${encodeURIComponent(key)}`,
    };
  }
  if (entity === 'comp') {
    // cluster_key: <trait>@<level>_<carry> — show carry portrait + "Trait · Carry"
    const m = /^(.+)@(\d+)_(.+)$/.exec(key);
    if (!m) return { name: key, icon: <div className="w-7 h-7 rounded bg-[#1e2a3a]" />, href: null as string | null };
    const trait = assets?.traits[m[1]];
    const carry = assets?.champions[m[3]];
    const url = tftChampionTileUrl(assets, carry);
    return {
      name: `${trait?.name || m[1].replace(/^TFT\d+_/, '')} · ${carry?.name || m[3].replace(/^TFT\d+_/, '')}`,
      icon: url ? <img src={url} alt="" className="w-7 h-7 rounded border border-[#c39bff]/60 object-cover" /> : <div className="w-7 h-7 rounded bg-[#1e2a3a]" />,
      href: `/tft/comps/${encodeURIComponent(key)}`,
    };
  }
  // Trait entity: patch-diff collapses all activation tiers onto one row per
  // trait name (no `@activation` suffix), so we never split off an activation.
  // Earlier "(undefined)" came from .split('@') on a plain trait id.
  const trait = assets?.traits[key];
  const traitIcon = tftIconUrl(assets, trait?.icon);
  return {
    name: trait?.name || key.replace(/^TFT\d+_/, ''),
    icon: traitIcon
      ? <img src={traitIcon} alt="" className="w-7 h-7 rounded bg-[#1e2a3a]" />
      : <div className="w-7 h-7 rounded bg-[#1e2a3a]" />,
    href: `/tft/traits/${encodeURIComponent(key)}`,
  };
}
