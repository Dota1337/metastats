'use client';
import { useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import { useI18n, LOCALE_MAP } from '../../../lib/i18n';
import { formatTier } from '../../../lib/rank-format';
import {
  PLAYER_COLORS, MASTER_BASE, rankScore, shortName,
  type ComparePlayer, type HistoryPoint,
} from './model';
import { Section } from './CompareBlocks';

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 12,
};
const AXIS = { stroke: 'var(--fg-muted)', fontSize: 10, tick: { fill: 'var(--fg-secondary)' } };

type Loaded = { p: ComparePlayer; i: number };

// ── Platzierungen 1-8 in Prozent ─────────────────────────────────────────────
export function PlacementChart({ players }: { players: Loaded[] }) {
  const { t } = useI18n();
  const withData = players.filter(({ p }) => (p.stats?.placementDistribution || []).some(c => c > 0));
  if (withData.length === 0) return null;
  const data = Array.from({ length: 8 }, (_, k) => {
    const row: Record<string, number> = { place: k + 1 };
    for (const { p, i } of withData) {
      const d = p.stats!.placementDistribution;
      const total = d.reduce((s, c) => s + c, 0) || 1;
      row[`p${i}`] = Math.round((d[k] / total) * 1000) / 10;
    }
    return row;
  });
  return (
    <Section title={t('tft.compare.placements')}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barGap={1} barCategoryGap="18%">
            <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="place" {...AXIS} />
            <YAxis {...AXIS} tickFormatter={v => `${v}%`} />
            <ReferenceLine x={4.5} stroke="var(--fg-muted)" />
            <Tooltip
              cursor={{ fill: 'var(--surface-raised)' }}
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={l => `${t('tft.compare.place')} ${l}`}
              formatter={(v, name) => [`${v}%`, name]}
            />
            {withData.map(({ p, i }) => (
              <Bar key={i} dataKey={`p${i}`} name={shortName(p.name)} fill={PLAYER_COLORS[i]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

// ── Form: letzte 20 Spiele, Platz 1 oben ─────────────────────────────────────
const FORM_GAMES = 20;
export function FormChart({ players }: { players: Loaded[] }) {
  const { t } = useI18n();
  const withData = players.filter(({ p }) => (p.stats?.extras?.recent.length || 0) > 0);
  if (withData.length === 0) return null;
  const data = Array.from({ length: FORM_GAMES }, (_, k) => {
    const row: Record<string, number | undefined> = { game: k + 1 };
    for (const { p, i } of withData) {
      // recent ist neueste zuerst; im Diagramm steht das neueste Spiel rechts.
      const last = p.stats!.extras!.recent.slice(0, FORM_GAMES).reverse();
      const offset = FORM_GAMES - last.length;
      row[`p${i}`] = k >= offset ? last[k - offset].p : undefined;
    }
    return row;
  });
  return (
    <Section title={t('tft.compare.form')}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
            <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="game" {...AXIS} tick={false} />
            <YAxis {...AXIS} reversed domain={[1, 8]} ticks={[1, 2, 3, 4, 5, 6, 7, 8]} interval={0} />
            <ReferenceLine y={4.5} stroke="var(--fg-muted)" strokeDasharray="4 4" />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={() => ''}
              formatter={(v, name) => [`${t('tft.compare.place')} ${v}`, name]}
            />
            {withData.map(({ p, i }) => (
              <Line
                key={i} type="monotone" dataKey={`p${i}`} name={shortName(p.name)}
                stroke={PLAYER_COLORS[i]} strokeWidth={2} dot={{ r: 2.5, fill: PLAYER_COLORS[i], strokeWidth: 0 }}
                connectNulls={false} isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

// ── Verlauf: LP oder Marktwert, 30 Tage ──────────────────────────────────────
export function HistoryChart({ players, histories }: { players: Loaded[]; histories: HistoryPoint[][] }) {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<'lp' | 'value'>('lp');
  const locale = LOCALE_MAP[lang];
  const withData = players.filter(({ i }) => (histories[i] || []).length >= 2);
  if (withData.length === 0) return null;

  const dates = [...new Set(withData.flatMap(({ i }) => histories[i].map(h => h.date)))].sort();
  const lookup = withData.map(({ i }) => new Map(histories[i].map(h => [h.date, h])));
  const data = dates.map(date => {
    const row: Record<string, string | number | undefined> = { date };
    withData.forEach(({ i }, k) => {
      const h = lookup[k].get(date);
      if (!h) return;
      row[`p${i}`] = mode === 'lp' ? (rankScore(h.tier, h.rank, h.lp) ?? undefined) : (h.finalValue ?? undefined);
    });
    return row;
  });

  const eur = (v: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
  const fmtDate = (d: string) => new Date(d).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  // Tooltip zeigt den echten Rang des Tages statt der Rechenzahl.
  const lpLabel = (i: number, date: string) => {
    const h = lookup[withData.findIndex(w => w.i === i)]?.get(date);
    if (!h?.tier) return '—';
    return `${formatTier(h.tier, h.rank)} · ${h.lp ?? 0} LP`;
  };
  const lpTick = (v: number) => {
    if (v >= MASTER_BASE) return `${v - MASTER_BASE}`;
    const tiers = ['I', 'B', 'S', 'G', 'P', 'E', 'D'];
    return `${tiers[Math.floor(v / 400)] ?? ''}${4 - Math.floor((v % 400) / 100)}`;
  };

  const tab = (active: boolean) => `px-2.5 py-1 rounded text-[11px] font-medium ${
    active ? 'bg-accent text-white' : 'bg-surface-raised text-fg-secondary hover:text-white'}`;

  return (
    <Section
      title={t('tft.compare.history')}
      right={(
        <div className="flex gap-1">
          <button onClick={() => setMode('lp')} className={tab(mode === 'lp')}>LP</button>
          <button onClick={() => setMode('value')} className={tab(mode === 'value')}>{t('tft.marketValue')}</button>
        </div>
      )}
    >
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="date" {...AXIS} tickFormatter={fmtDate} minTickGap={24} />
            <YAxis
              {...AXIS} width={48} domain={['auto', 'auto']}
              tickFormatter={v => mode === 'lp' ? lpTick(Number(v)) : `${Math.round(Number(v) / 1000)}k`}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: 'var(--fg-secondary)' }}
              labelFormatter={d => typeof d === 'string' ? new Date(d).toLocaleDateString(locale) : ''}
              formatter={(v, name, item) => {
                const i = Number(String(item?.dataKey || '').slice(1));
                const date = String((item?.payload as { date?: string })?.date || '');
                return [mode === 'lp' ? lpLabel(i, date) : eur(Number(v)), name];
              }}
            />
            {withData.map(({ p, i }) => (
              <Line
                key={i} type="monotone" dataKey={`p${i}`} name={shortName(p.name)}
                stroke={PLAYER_COLORS[i]} strokeWidth={2} dot={false} connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Section>
  );
}

// ── Marktwert-Faktoren ───────────────────────────────────────────────────────
const SIGNALS = ['performance', 'metaRelative', 'consistency', 'flexMastery', 'gameSense', 'boardStrength'] as const;

// z-Wert (Bevoelkerung, etwa -3..+3) auf 0..100, 50 = Durchschnitt.
function zScore(z: number | null | undefined): number | null {
  if (z == null || !Number.isFinite(z)) return null;
  return Math.round(Math.max(0, Math.min(100, ((z + 3) / 6) * 100)));
}

export function FactorBlock({ players }: { players: Loaded[] }) {
  const { t } = useI18n();
  const rated = players.filter(({ p }) => p.rated && p.agents.length > 0);
  if (rated.length === 0) return null;

  const value = (p: ComparePlayer, sig: string) => {
    const a = p.agents.find(x => x.signal === sig);
    return a?.available ? zScore(a.z) : null;
  };
  const label = (sig: string) => t(`tft.marketValue.agent.${sig}` as Parameters<typeof t>[0]);
  // Radar nur ueber Faktoren, die alle Spieler haben — sonst wirkt eine fehlende
  // Achse wie ein schwacher Wert.
  const common = SIGNALS.filter(sig => rated.every(({ p }) => value(p, sig) != null));
  const radarData = common.map(sig => {
    const row: Record<string, string | number | null> = { stat: label(sig) };
    for (const { p, i } of rated) row[`p${i}`] = value(p, sig);
    return row;
  });

  return (
    <Section title={t('tft.compare.factors')}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
        {common.length >= 3 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="70%" margin={{ top: 8, right: 32, bottom: 8, left: 32 }}>
                <PolarGrid stroke="var(--border-subtle)" />
                <PolarAngleAxis dataKey="stat" tick={{ fill: 'var(--fg-secondary)', fontSize: 10 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                {rated.map(({ p, i }) => (
                  <Radar
                    key={i} dataKey={`p${i}`} name={shortName(p.name)}
                    stroke={PLAYER_COLORS[i]} fill={PLAYER_COLORS[i]} fillOpacity={0.15} strokeWidth={2}
                  />
                ))}
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        ) : <div className="hidden md:block" />}
        <div className="space-y-2.5">
          {SIGNALS.map(sig => (
            <div key={sig}>
              <div className="text-fg-secondary text-[10px] uppercase tracking-widest mb-1">{label(sig)}</div>
              <div className="space-y-1">
                {rated.map(({ p, i }) => {
                  const v = value(p, sig);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-surface-overlay overflow-hidden">
                        {v != null && <div className="h-full rounded-full" style={{ width: `${v}%`, backgroundColor: PLAYER_COLORS[i] }} />}
                      </div>
                      <span className="w-7 text-right text-[11px] tabular-nums text-white">{v ?? '—'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
