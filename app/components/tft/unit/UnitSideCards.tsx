'use client';
// Seitenleiste der Unit-Detailseite neben der Faehigkeits-Karte: Sterne
// (Explorer, gleiche Filter wie die Tabellen), Item-Plaetze (Tages-Statistik)
// und Patch-Verlauf.
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip as RechartsTooltip, ReferenceLine,
} from 'recharts';
import { useI18n } from '../../../lib/i18n';
import TftItemIcon from '../TftItemIcon';
import type { TftAssetsBundle } from '../../../lib/tft-cdragon';
import type { ExplorerResponse } from '../../../lib/tft-explorer-query';
import { tftPatchLabel } from '../../../lib/tft-patch-label';
import { starColor } from '../../../lib/tft-ui';

export function SideCard({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="bg-surface-base border border-border-subtle rounded-lg p-3.5">
      <div className="flex items-baseline gap-2 mb-2.5">
        <h2 className="text-white text-[14px] font-semibold flex-1">{title}</h2>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** Verteilung der Sterne mit Ø Platz je Stufe (Explorer, Units-Reiter nach Sternen). */
export function StarDistCard({ unitId, stars, onPick, active }: {
  unitId: string;
  stars: ExplorerResponse | null;
  onPick: (s: number | null) => void;
  active: number | null;
}) {
  const { t } = useI18n();
  const rows = (stars?.rows ?? []).filter(r => r.key === unitId && r.sub != null).sort((a, b) => (a.sub ?? 0) - (b.sub ?? 0));
  const total = rows.reduce((a, r) => a + r.games, 0);
  if (!stars) {
    return (
      <SideCard title={t('tft.unit.starDist')}>
        <div className="space-y-2" aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="h-7 rounded bg-surface-raised animate-pulse" />)}</div>
      </SideCard>
    );
  }
  if (!rows.length || total <= 0) return null;
  return (
    <SideCard title={t('tft.unit.starDist')}>
      <div className="space-y-1.5">
        {rows.map(r => {
          const s = r.sub!;
          const share = r.games / total;
          const on = active === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(on ? null : s)}
              className={`w-full grid grid-cols-[3.25rem_1fr_3.25rem] items-center gap-2 px-1.5 py-1 rounded text-[12px] transition-colors ${
                on ? 'bg-accent-a10 ring-1 ring-accent-a60' : 'hover:bg-surface-raised'
              }`}
              title={`${r.games.toLocaleString('de-DE')} ${t('tft.gamesShort')}`}
            >
              <span className="text-left" style={{ color: starColor(s) }}>{'★'.repeat(s)}</span>
              <span className="h-2 rounded bg-surface-overlay overflow-hidden">
                <span className="block h-full rounded" style={{ width: `${Math.max(2, share * 100)}%`, background: starColor(s) }} />
              </span>
              <span className="text-right tabular-nums text-white">{share < 0.001 ? '<0,1%' : `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`}</span>
              <span />
              <span className="text-left text-[11px] text-fg-muted tabular-nums col-span-2">
                Ø {r.avg.toFixed(2)} · {(r.top4 * 100).toFixed(0)}% {t('tft.top4')}
              </span>
            </button>
          );
        })}
      </div>
    </SideCard>
  );
}

type SlotEntry = { item: string; count: number };
type SlotData = { total: number; entries: SlotEntry[] };

/** Welche Items zuerst gebaut werden (Tages-Statistik, Stern mit den meisten Spielen). */
export function ItemSlotsCard({ slotsByTier, starGames, star, assets }: {
  slotsByTier: Record<string, Record<string, SlotData>> | null | undefined;
  starGames: Record<string, number> | null | undefined;
  star: number | null;
  assets: TftAssetsBundle | null;
}) {
  const { t } = useI18n();
  if (!slotsByTier) return null;
  const games = (k: string) => starGames?.[k] ?? 0;
  const tier = star && slotsByTier[String(star)]
    ? String(star)
    : (Object.keys(slotsByTier).sort((a, b) => games(b) - games(a) || a.localeCompare(b))[0] || null);
  const slots = tier ? slotsByTier[tier] : null;
  const idx = slots ? Object.keys(slots).sort() : [];
  if (!tier || !idx.length) return null;
  const label = (si: string) => (si === '0' ? t('tft.slotFirst') : si === '1' ? t('tft.slotSecond') : t('tft.slotThird'));
  return (
    <SideCard title={t('tft.itemSlotOrder')} aside={<span className="text-[11px]" style={{ color: starColor(Number(tier)) }}>{'★'.repeat(Number(tier))}</span>}>
      <div className="space-y-2.5">
        {idx.map(si => {
          const total = slots![si]?.total || 1;
          return (
            <div key={si}>
              <div className="text-fg-muted text-[11px] mb-1">{label(si)}</div>
              <div className="space-y-1">
                {(slots![si]?.entries || []).slice(0, 3).map(e => (
                  <div key={e.item} className="flex items-center gap-2">
                    <TftItemIcon apiName={e.item} assets={assets} className="w-6 h-6" />
                    <div className="flex-1 h-1.5 bg-surface-overlay rounded overflow-hidden">
                      <div className="h-full bg-accent" style={{ width: `${(e.count / total) * 100}%` }} />
                    </div>
                    <span className="text-[11px] text-fg-secondary tabular-nums w-9 text-right">{((e.count / total) * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </SideCard>
  );
}

export type TimelinePoint = { patch: string; avgPlacement: number; top4Rate: number; pickRate: number | null; games: number };

export function TimelineCard({ timeline }: { timeline: TimelinePoint[] }) {
  const { t } = useI18n();
  if (timeline.length < 2) return null;
  return (
    <SideCard title={t('tft.unitTimeline')}>
      <div style={{ height: 160 }}>
        <ResponsiveContainer>
          <LineChart data={timeline} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <XAxis
              dataKey="patch"
              tickFormatter={(v: string) => tftPatchLabel(v)}
              tick={{ fill: 'var(--fg-faint)', fontSize: 10 }}
              axisLine={{ stroke: 'var(--border-subtle)' }}
              tickLine={false}
            />
            <YAxis
              domain={['dataMin - 0.2', 'dataMax + 0.2']}
              reversed
              tick={{ fill: 'var(--fg-faint)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={28}
              tickFormatter={(v: number) => v.toFixed(2)}
            />
            <RechartsTooltip
              contentStyle={{ backgroundColor: 'var(--surface-base)', border: '1px solid var(--border-subtle)', borderRadius: 4, fontSize: 11 }}
              labelStyle={{ color: 'var(--fg-secondary)' }}
              labelFormatter={(label: any) => tftPatchLabel(String(label))}
              formatter={(v: any): any => [Number(v).toFixed(2), t('tft.avgPlacement')]}
            />
            <ReferenceLine y={4.5} stroke="var(--fg-faint)" strokeDasharray="3 3" strokeOpacity={0.4} />
            <Line
              type="monotone"
              dataKey="avgPlacement"
              stroke="var(--accent-tft)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--accent-tft)' }}
              activeDot={{ r: 5, fill: 'var(--series-purple-soft)' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </SideCard>
  );
}
