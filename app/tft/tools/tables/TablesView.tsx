'use client';
import { useMemo, useState } from 'react';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import { useI18n } from '../../../lib/i18n';
import { withAlpha } from '../../../lib/color';
import { tftGameAssetUrl } from '../../../lib/tft-cdragon';
import type {
  LootTablesFile, LootTable, CovenTable, LootSub, LootRow, LootReward, LootCond, WispsFile, WispEntry, WispRound, Wisp,
} from '../../../lib/tft-loot-tables';

// Loot-Tabellen, Coven-Auszahlung und Wisps. Daten und Herkunft:
// app/lib/tft-loot-tables.ts und scripts/import-tft-tables.mjs.

const COST_COLORS: Record<number, string> = {
  1: 'var(--fg-secondary)', 2: '#3ecf8e', 3: '#3a8ddc', 4: '#c39bff', 5: '#e0c75a',
};
const GOLD = '#e0c75a';
const ROUNDS: WispRound[] = ['Early', 'EarlyMid', 'Mid', 'MidLate', 'Late', 'VeryLate'];

type View = 'loot' | 'coven' | 'wisps';
type Mode = 'all' | 'doubles' | 'tockers';
type T = ReturnType<typeof useI18n>['t'];

const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

export default function TablesView({ loot, wisps }: { loot: LootTablesFile | null; wisps: WispsFile | null }) {
  const { t } = useI18n();
  const [view, setView] = useState<View>('loot');
  const source = view === 'wisps' ? wisps?.source : loot?.source;

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="tools" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="bg-surface-base border border-border-subtle rounded-lg p-5 mb-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <h1 className="text-white text-xl font-medium">{t('tft.tables.title')}</h1>
          <Toggle
            value={view}
            onChange={setView}
            options={[['loot', t('tft.tables.loot')], ['coven', 'Coven'], ['wisps', t('tft.tables.wisps')]]}
          />
        </div>

        {view === 'loot' && loot && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            {loot.tables.map(tb => <LootCard key={tb.key} table={tb} t={t} />)}
          </div>
        )}
        {view === 'coven' && loot && <CovenCard coven={loot.coven} t={t} />}
        {view === 'wisps' && wisps && <WispList entries={wisps.wisps} t={t} />}

        {source && (
          <div className="mt-5 text-fg-faint text-[11px]">
            {t('tft.tables.source')}{' '}
            <a href={source.url} target="_blank" rel="noopener noreferrer" className="hover:text-fg-secondary underline-offset-2 hover:underline">
              {source.name}
            </a>
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function Toggle<V extends string>({ value, onChange, options }: { value: V; onChange: (v: V) => void; options: [V, string][] }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 text-sm rounded border transition-colors ${
            value === v ? 'border-accent text-white bg-accent-a10' : 'border-border-subtle bg-surface-raised text-fg-secondary hover:text-white'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Icon({ path, size = 20, className = '' }: { path?: string | null; size?: number; className?: string }) {
  if (!path) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={tftGameAssetUrl(path)} alt="" width={size} height={size} loading="lazy" className={`shrink-0 rounded-sm ${className}`} style={{ width: size, height: size }} />
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] px-1.5 py-0.5 rounded border border-border-subtle text-fg-muted tabular-nums whitespace-nowrap">{children}</span>;
}

function CardHead({ name, icon, patch, stage, t }: { name: string; icon?: string | null; patch: string; stage?: string; t: T }) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <Icon path={icon} size={32} />
      <h2 className="text-white text-base font-medium flex-1 min-w-0">{name}</h2>
      {stage && <Badge>{t('tft.tables.stage')} {stage}</Badge>}
      <Badge>{t('tft.tables.patch')} {patch}</Badge>
    </div>
  );
}

function LootCard({ table, t }: { table: LootTable; t: T }) {
  return (
    <section className="bg-surface-base border border-border-subtle rounded-lg p-4">
      <CardHead name={table.name} icon={table.icon} patch={table.patch} stage={table.stage} t={t} />
      <div className="space-y-4">
        {table.subs.map((s, i) => <SubTable key={i} sub={s} t={t} />)}
      </div>
    </section>
  );
}

function subLabel(sub: LootSub, t: T): string | null {
  const l = sub.label;
  if (!l) return null;
  if (l.t === 'booster') return `${l.name} · ${t('tft.tables.stage')} ${l.stage}`;
  if (l.t === 'stage') return `${t('tft.tables.stage')} ${l.n}`;
  return `${l.essence} ${t('tft.tables.essence')}`;
}

function SubTable({ sub, t, extra }: { sub: LootSub; t: T; extra?: React.ReactNode }) {
  const label = subLabel(sub, t);
  const hasLeft = sub.rows.some(r => r.chance != null || r.cond);
  return (
    <div>
      {label && (
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-fg-muted text-[11px] uppercase tracking-widest">{label}</span>
          {extra}
        </div>
      )}
      <div className="divide-y divide-border-subtle/50 border border-border-subtle rounded">
        {sub.rows.map((r, i) => <Row key={i} row={r} hasLeft={hasLeft} t={t} />)}
      </div>
    </div>
  );
}

function condText(c: LootCond, t: T): string {
  if (c.t === 'traits') return fill(t('tft.tables.traits'), { n: c.n });
  if (c.t === 'face') return fill(t('tft.tables.face'), { n: c.n });
  if (c.t === 'sum') return fill(t('tft.tables.sum'), { v: c.v });
  return c.v;
}

function Row({ row, hasLeft, t }: { row: LootRow; hasLeft: boolean; t: T }) {
  return (
    <div className="flex items-start gap-3 px-2.5 py-2">
      {hasLeft && (
        <div className="w-24 shrink-0 text-[11px] leading-5 tabular-nums">
          {row.cond && <div className="text-fg-secondary">{condText(row.cond, t)}</div>}
          {row.chance != null && <div className="text-white font-medium">{row.chance}%</div>}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
        {row.rewards.map((r, i) => <Reward key={i} r={r} t={t} />)}
      </div>
    </div>
  );
}

function Stars({ n }: { n?: number }) {
  if (!n || n < 2) return null;
  return <span className="text-[10px] leading-none" style={{ color: GOLD }}>{'★'.repeat(n)}</span>;
}

function Chip({ children, color, title }: { children: React.ReactNode; color?: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 text-[12px] leading-5 px-1.5 py-0.5 rounded bg-surface-raised border border-border-subtle text-fg-secondary"
      style={color ? { borderColor: withAlpha(color, 0x66), color } : undefined}
    >
      {children}
    </span>
  );
}

const times = (n?: number) => (n && n > 1 ? <span className="text-white tabular-nums">{n}×</span> : null);

function Reward({ r, t }: { r: LootReward; t: T }) {
  switch (r.k) {
    case 'gold':
      return <Chip color={GOLD}><span className="tabular-nums">{r.n ?? 1}</span> {t('tft.tables.gold')}</Chip>;
    case 'goldRange':
      return <Chip color={GOLD}><span className="tabular-nums">{r.v}</span> {t('tft.tables.gold')}</Chip>;
    case 'xp':
      return <Chip><span className="text-white tabular-nums">{r.n}</span> XP</Chip>;
    case 'reroll':
      return <Chip><span className="text-white tabular-nums">{r.n}</span> {t('tft.tables.rerolls')}</Chip>;
    case 'hp':
      return <Chip>{fill(t('tft.tables.hp'), { v: r.v ?? '' })}</Chip>;
    case 'randomUnit': {
      const c = r.cost ?? 1;
      return (
        <Chip color={COST_COLORS[c]}>
          {times(r.n)}<Stars n={r.stars} />{fill(t('tft.tables.randomUnit'), { c })}
        </Chip>
      );
    }
    case 'champion': {
      const c = r.cost ?? 1;
      return (
        <Chip color={COST_COLORS[c]} title={r.name}>
          {times(r.n)}
          <Icon path={r.icon} size={20} className="border" />
          <Stars n={r.stars} />
          <span className="text-white">{r.name}</span>
        </Chip>
      );
    }
    case 'item':
      return <Chip title={r.name}>{times(r.n)}<Icon path={r.icon} size={20} /><span className="text-white">{r.name}</span></Chip>;
    case 'specialEgg':
      return (
        <Chip color={GOLD}>
          {fill(t('tft.tables.specialEgg'), { n: r.turns ?? 0 })}:
          <span className="inline-flex flex-wrap gap-1">{(r.contents ?? []).map((x, i) => <Reward key={i} r={x} t={t} />)}</span>
        </Chip>
      );
    case 'unknown':
      return <Chip>{times(r.n)}?</Chip>;
    default:
      return <Chip>{times(r.n)}{t(`tft.tables.r.${r.k}` as Parameters<T>[0])}</Chip>;
  }
}

function CovenCard({ coven, t }: { coven: CovenTable; t: T }) {
  return (
    <section className="bg-surface-base border border-border-subtle rounded-lg p-4">
      <CardHead name={coven.name} icon={coven.icon} patch={coven.patch} t={t} />
      <div className="overflow-x-auto mb-5">
        <table className="w-full max-w-md text-[12px] tabular-nums">
          <thead>
            <tr className="text-fg-muted border-b border-border-subtle">
              <th className="text-left px-2 py-1.5 font-normal">{t('tft.tables.units')}</th>
              <th className="text-right px-2 py-1.5 font-normal">{t('tft.tables.perKill')}</th>
              <th className="text-right px-2 py-1.5 font-normal">{t('tft.tables.perLoss')}</th>
            </tr>
          </thead>
          <tbody>
            {coven.essence.map(e => (
              <tr key={e.units} className="border-b border-border-subtle/50 last:border-0">
                <td className="px-2 py-1.5 text-white">{e.units}</td>
                <td className="px-2 py-1.5 text-right text-fg-secondary">{e.kill}</td>
                <td className="px-2 py-1.5 text-right text-fg-secondary">{e.loss}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {coven.subs.map((s, i) => (
          <SubTable
            key={i}
            sub={s}
            t={t}
            extra={s.label?.t === 'essence' ? <Badge>{coven.augmentName}: +{s.label.ap} {t('tft.tables.ap')}</Badge> : null}
          />
        ))}
      </div>
    </section>
  );
}

function WispList({ entries, t }: { entries: WispEntry[]; t: T }) {
  const [tier, setTier] = useState<'all' | '1' | '2' | '3'>('all');
  const [mode, setMode] = useState<Mode>('all');
  const inMode = (w: Wisp) => mode === 'all' || (mode === 'doubles' ? w.doubles : w.tockers);
  const shown = useMemo(
    () => entries.filter(w => (tier === 'all' || String(w.tier) === tier) && inMode(w)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, tier, mode],
  );
  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div>
          <div className="text-fg-muted text-[11px] uppercase tracking-widest mb-1.5">{t('tft.tables.tier')}</div>
          <Toggle value={tier} onChange={setTier} options={[['all', t('tft.tables.all')], ['1', '1'], ['2', '2'], ['3', '3']]} />
        </div>
        <div>
          <div className="text-fg-muted text-[11px] uppercase tracking-widest mb-1.5">{t('tft.tables.mode')}</div>
          <Toggle value={mode} onChange={setMode} options={[['all', t('tft.tables.all')], ['doubles', 'Double Up'], ['tockers', "Tocker's Trials"]]} />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        {shown.map(w => (
          <section key={w.api} className="bg-surface-base border border-border-subtle rounded-lg p-3.5">
            <WispBody w={w} t={t} />
            {w.variants.filter(inMode).map(v => (
              <div key={v.api} className="mt-3 pt-3 border-t border-border-subtle/60 pl-3 border-l-2 border-l-accent/40">
                <div className="text-accent text-[10px] uppercase tracking-widest mb-1">{t(v.kind === 'prismatic' ? 'tft.tables.prismatic' : 'tft.tables.upgrade')}</div>
                <WispBody w={v} t={t} />
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function WispBody({ w, t }: { w: Wisp; t: T }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-white text-sm font-medium flex-1 min-w-0">{w.name}</h3>
        <Badge>{t('tft.tables.tier')} {w.tier}</Badge>
        <span className="text-[11px] tabular-nums" style={{ color: GOLD }}>{w.cost} {t('tft.tables.gold')}</span>
      </div>
      <p className="text-fg-secondary text-[12px] leading-relaxed">{w.desc}</p>
      {w.req && <p className="text-fg-muted text-[11px] mt-1.5"><span className="text-fg-secondary">{t('tft.tables.requires')}</span> {w.req}</p>}
      {w.excl && w.excl.length > 0 && (
        <p className="text-fg-muted text-[11px] mt-1"><span className="text-fg-secondary">{t('tft.tables.excludes')}</span> {w.excl.join(', ')}</p>
      )}
      <div className="flex flex-wrap gap-1 mt-2">
        {ROUNDS.map(r => (
          <span
            key={r}
            className={`text-[10px] px-1.5 py-0.5 rounded border ${w.rounds.includes(r) ? 'border-accent/50 text-white bg-accent-a10' : 'border-border-subtle text-fg-faint'}`}
          >
            {t(`tft.tables.round.${r}` as Parameters<T>[0])}
          </span>
        ))}
      </div>
    </div>
  );
}
