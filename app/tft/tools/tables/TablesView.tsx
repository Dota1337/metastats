'use client';
import { useMemo, useState } from 'react';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import { useI18n } from '../../../lib/i18n';
import { withAlpha } from '../../../lib/color';
import { tftGameAssetUrl } from '../../../lib/tft-cdragon';
import type {
  LootTablesFile, LootTable, CovenTable, LootSub, LootRow, LootReward, LootCond, WispsFile, WispEntry, WispRound, Wisp, WispCat,
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
        {/* Umschalter mittig in der Leiste: ab lg drei Spalten (Titel | Umschalter | leer), darunter mittig unter dem Titel. */}
        <div className="bg-surface-base border border-border-subtle rounded-lg p-5 mb-5 flex flex-col gap-3 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <h1 className="text-white text-xl font-medium">{t('tft.tables.title')}</h1>
          <ViewTabs
            value={view}
            onChange={setView}
            options={[['loot', t('tft.tables.loot')], ['coven', 'Coven'], ['wisps', t('tft.tables.wisps')]]}
          />
        </div>

        {view === 'loot' && loot && (
          <div className="space-y-2">
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

// Haupt-Umschalter der Seite, gleicher Stil wie Liste/Uebersicht bei den Comps
// (app/components/tft/CompsTabs.tsx). Die Wisp-Filter bleiben bewusst beim dezenten Toggle.
function ViewTabs<V extends string>({ value, onChange, options }: { value: V; onChange: (v: V) => void; options: [V, string][] }) {
  return (
    <div className="inline-flex self-center items-center gap-1 p-1 rounded-lg border border-accent-a40 bg-surface-raised">
      {options.map(([v, label]) => {
        const on = value === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={on}
            className={`px-4 sm:px-5 py-2 rounded-md text-sm font-semibold transition-colors ${
              on ? 'bg-accent text-white' : 'text-fg-secondary hover:text-white hover:bg-accent-a20'
            }`}
            style={on ? { boxShadow: '0 0 12px rgb(var(--accent-rgb) / 35%)' } : undefined}
          >
            {label}
          </button>
        );
      })}
    </div>
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

// Jede Loot-Tabelle klappt einzeln auf; anfangs sind alle zu.
function LootCard({ table, t }: { table: LootTable; t: T }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="bg-surface-base border border-border-subtle rounded-lg">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 p-4 text-left hover:bg-surface-raised/40 rounded-lg transition-colors"
      >
        {table.icon ? <Icon path={table.icon} size={32} /> : <span className="w-8 h-8 shrink-0" />}
        <h2 className="text-white text-base font-medium flex-1 min-w-0">{table.name}</h2>
        {table.stage && <Badge>{t('tft.tables.stage')} {table.stage}</Badge>}
        <Badge>{t('tft.tables.patch')} {table.patch}</Badge>
        <svg
          viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"
          className={`shrink-0 text-fg-muted transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <LootBody table={table} t={t} />}
    </section>
  );
}

// Ein einzelner Block mit mehr Zeilen als das wird ab lg in zwei Spalten geteilt
// (heute nur die Trait Ladder); mehrere Bloecke stehen ab lg nebeneinander. Nur bei drei
// Spalten ist es zu eng fuer die Beschriftung neben den Symbolen.
const SPLIT_AT = 10;
const COL_CLASS: Record<number, string> = { 1: '', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3' };

// Teilt nur zwischen zwei verschiedenen Bedingungen, nie mitten in einer Gruppe
// (z. B. „8 Traits" mit 57 % und 43 % bleibt zusammen).
function splitAtGroup(sub: LootSub): LootSub[] {
  const rows = sub.rows;
  const key = (r: LootRow) => JSON.stringify(r.cond ?? null);
  let cut = -1;
  for (let i = 1; i < rows.length; i++) {
    if (key(rows[i]) === key(rows[i - 1])) continue;
    if (cut < 0 || Math.abs(i - rows.length / 2) < Math.abs(cut - rows.length / 2)) cut = i;
  }
  if (cut < 0) return [sub];
  return [{ ...sub, rows: rows.slice(0, cut) }, { ...sub, label: undefined, rows: rows.slice(cut) }];
}

function leftWidth(rows: LootRow[]): string | null {
  return rows.some(r => r.cond) ? 'w-24' : rows.some(r => r.chance != null) ? 'w-11' : null;
}

function LootBody({ table, t }: { table: LootTable; t: T }) {
  const whole = table.subs.length === 1 ? table.subs[0] : null;
  const blocks = whole && whole.rows.length > SPLIT_AT ? splitAtGroup(whole) : table.subs;
  if (blocks.length === 1) {
    return <div className="px-4 pb-4"><SubTable sub={blocks[0]} t={t} /></div>;
  }
  const cols = blocks.length <= 3 ? blocks.length : 2;
  // Gleiche Zeilenzahl in allen Bloecken (Expected Unexpectedness: gleiche Chancen je Zeile)
  // → Zeilen ueber die Spalten auf gleicher Hoehe.
  const aligned = cols === blocks.length && blocks.every(b => b.rows.length === blocks[0].rows.length);
  const left = leftWidth(blocks.flatMap(b => b.rows));
  return (
    <div className={`grid grid-cols-1 ${COL_CLASS[cols]} gap-x-4 ${aligned ? 'gap-y-0' : 'gap-y-4 items-start'} px-4 pb-4`}>
      {blocks.map((s, i) => <SubTable key={i} sub={s} t={t} left={left} compact={cols === 3} aligned={aligned} />)}
    </div>
  );
}

function subLabel(sub: LootSub, t: T): string | null {
  const l = sub.label;
  if (!l) return null;
  if (l.t === 'booster') return `${l.name} · ${t('tft.tables.stage')} ${l.stage}`;
  if (l.t === 'stage') return `${t('tft.tables.stage')} ${l.n}`;
  return `${l.essence} ${t('tft.tables.essence')}`;
}

function SubTable({ sub, t, extra, labels = true, left: leftOverride, compact = false, aligned = false }: {
  sub: LootSub; t: T; extra?: React.ReactNode; labels?: boolean; left?: string | null; compact?: boolean; aligned?: boolean;
}) {
  const label = subLabel(sub, t);
  const left = leftOverride !== undefined ? leftOverride : leftWidth(sub.rows);
  const n = sub.rows.length;
  // aligned: Zeilen haengen per Subgrid am Raster der Karte, damit sie spaltenuebergreifend gleich hoch sind.
  return (
    <div
      className={aligned ? 'grid grid-rows-subgrid mb-4 last:mb-0 lg:mb-0' : ''}
      style={aligned ? { gridRow: `span ${n + (label ? 1 : 0)}` } : undefined}
    >
      {label && (
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-white text-sm font-semibold">{label}</span>
          {extra}
        </div>
      )}
      <div
        className={`divide-y divide-border-subtle/50 border border-border-subtle rounded ${aligned ? 'grid grid-rows-subgrid' : ''}`}
        style={aligned ? { gridRow: `span ${n}` } : undefined}
      >
        {sub.rows.map((r, i) => <Row key={i} row={r} left={left} labels={labels} compact={compact} t={t} />)}
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

// Wie bei Little Buddy Bot: links Bedingung/Chance, dann die Belohnungen als
// Symbole, bei Loot-Tabellen rechts daneben eine kurze Beschriftung.
// compact (drei schmale Spalten ab lg): Beschriftung klein unter den Symbolen statt daneben.
function Row({ row, left, labels, compact, t }: { row: LootRow; left: string | null; labels: boolean; compact: boolean; t: T }) {
  return (
    <div className="flex items-center gap-3 px-2.5 py-2">
      {left && (
        <div className={`${left} shrink-0 text-[11px] leading-5 tabular-nums`}>
          {row.cond && <div className="text-fg-secondary">{condText(row.cond, t)}</div>}
          {row.chance != null && <div className="text-white font-medium">{row.chance}%</div>}
        </div>
      )}
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 flex-1 min-w-0 ${compact ? 'lg:flex-col lg:flex-nowrap lg:items-start lg:gap-1' : ''}`}>
        {row.rewards.some(hasTile) && (
          <div className="flex flex-wrap items-center gap-1 pt-1.5">
            {row.rewards.map((r, i) => <RewardTile key={i} r={r} t={t} />)}
          </div>
        )}
        {labels && (
          <div className={`text-fg-secondary leading-snug min-w-0 text-[12px] ${compact ? 'lg:text-[11px]' : ''}`}>{rowLabel(row.rewards, t)}</div>
        )}
      </div>
    </div>
  );
}

// Leben und Taktiker-Item haben kein passendes Symbol; sie stehen nur in der Beschriftung.
const hasTile = (r: LootReward) => r.k === 'specialEgg' || r.k === 'unknown' || !!r.icon;

// Kurze Beschriftung wie bei LBB: gleiche Belohnungen zusammengezaehlt,
// zufaellige Einheiten nur mit Kosten („3× 1-Kosten").
function rowLabel(rewards: LootReward[], t: T): string {
  const groups = new Map<string, LootReward>();
  rewards.forEach((r, i) => {
    const key = r.k === 'specialEgg' ? `egg${i}` : [r.k, r.cost, r.stars, r.api, r.v].join('|');
    const g = groups.get(key);
    if (g) g.n = (g.n ?? 1) + (r.n ?? 1);
    else groups.set(key, { ...r });
  });
  return [...groups.values()].map(r => r.k === 'randomUnit'
    ? withN(r.n, (r.stars && r.stars > 1 ? '★'.repeat(r.stars) + ' ' : '') + fill(t('tft.tables.costShort'), { c: r.cost ?? 1 }))
    : r.k === 'specialEgg' ? `${rewardText(r, t)}: ${rowLabel(r.contents ?? [], t)}`
    : rewardText(r, t)).join(' + ');
}

const withN = (n: number | undefined, s: string) => (n && n > 1 ? `${n}× ${s}` : s);

// Volltext einer Belohnung: Beschriftung neben den Symbolen und Tooltip am Symbol.
function rewardText(r: LootReward, t: T): string {
  switch (r.k) {
    case 'gold': return `${r.n ?? 1} ${t('tft.tables.gold')}`;
    case 'goldRange': return `${r.v} ${t('tft.tables.gold')}`;
    case 'xp': return `${r.n ?? 1} XP`;
    case 'reroll': return `${r.n ?? 1} ${t('tft.tables.rerolls')}`;
    case 'hp': return fill(t('tft.tables.hp'), { v: r.v ?? '' });
    case 'randomUnit': return withN(r.n, fill(t('tft.tables.randomUnit'), { c: r.cost ?? 1 }));
    case 'champion':
    case 'item': return withN(r.n, r.name ?? '');
    case 'specialEgg': return fill(t('tft.tables.specialEgg'), { n: r.turns ?? 0 });
    case 'unknown': return withN(r.n, '?');
    default: return withN(r.n, t(`tft.tables.r.${r.k}` as Parameters<T>[0]));
  }
}

// Fertiges Item und Emblem haben auf CDragon kein eigenes „?"-Symbol; der blaue
// Komponenten-„?" wird wie bei LBB gruen bzw. grau eingefaerbt.
const TINT: Partial<Record<LootReward['k'], string>> = {
  fullItem: 'hue-rotate(-95deg) saturate(1.3)',
  emblem: 'grayscale(1) brightness(1.35)',
};
const OVERLAY_SHADOW = '0 0 3px rgb(0 0 0), 0 0 2px rgb(0 0 0)';

function RewardTile({ r, t }: { r: LootReward; t: T }) {
  if (r.k === 'specialEgg') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1 p-0.5 rounded border" style={{ borderColor: withAlpha(GOLD, 0x99) }} title={rewardText(r, t)}>
        {(r.contents ?? []).map((x, i) => <RewardTile key={i} r={x} t={t} />)}
      </span>
    );
  }
  const text = rewardText(r, t);
  if (!hasTile(r)) return null;
  const border = r.k === 'champion' ? COST_COLORS[r.cost ?? 1] : r.k === 'item' && /Radiant/.test(r.api ?? '') ? GOLD : null;
  const count = r.k === 'goldRange' ? '×?' : r.n && r.n > 1 ? `×${r.n}` : null;
  return (
    <span className="relative inline-block shrink-0" title={text}>
      {r.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tftGameAssetUrl(r.icon)}
          alt={text}
          width={36}
          height={36}
          loading="lazy"
          className="block rounded-sm"
          style={{ width: 36, height: 36, filter: TINT[r.k], border: border ? `2px solid ${border}` : undefined }}
        />
      ) : (
        <span role="img" aria-label={text} className="flex items-center justify-center w-9 h-9 rounded-sm bg-surface-raised border border-border-subtle text-fg-secondary text-base font-medium">?</span>
      )}
      {r.stars && r.stars > 1 && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[10px] leading-none whitespace-nowrap" style={{ color: GOLD, textShadow: OVERLAY_SHADOW }}>
          {'★'.repeat(r.stars)}
        </span>
      )}
      {count && (
        <span className="absolute bottom-0 right-0.5 text-[11px] font-bold leading-none text-white tabular-nums" style={{ textShadow: OVERLAY_SHADOW }}>
          {count}
        </span>
      )}
    </span>
  );
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
            labels={false}
            extra={s.label?.t === 'essence' ? <span className="text-[11px] font-medium px-1.5 py-0.5 rounded border border-accent/50 bg-accent/25 text-white tabular-nums whitespace-nowrap">{coven.augmentName}: +{s.label.ap} {t('tft.tables.ap')}</span> : null}
          />
        ))}
      </div>
    </section>
  );
}

const WISP_CATS: WispCat[] = ['Combat', 'GoldXP', 'Shop', 'Champion', 'Item', 'Misc', 'Risky'];
type WispVariant = WispEntry['variants'][number];

// Runden als Bereiche („Früh – Mitte"); die wenigen Luecken werden als zweiter Bereich gezeigt.
function roundText(rounds: WispRound[], t: T): string {
  const runs: [number, number][] = [];
  for (const i of rounds.map(r => ROUNDS.indexOf(r)).sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else runs.push([i, i]);
  }
  const name = (i: number) => t(`tft.tables.round.${ROUNDS[i]}` as Parameters<T>[0]);
  return runs.map(([a, b]) => (a === b ? name(a) : `${name(a)} – ${name(b)}`)).join(', ');
}

// Eine Zeile je Wisp mit ihren Bedingungen; Upgrade/Prismatisch klappen darunter auf.
// Stufen- und Art-Filter treffen auch ueber eine Variante (Prismatisch springt auf Stufe 3).
function WispList({ entries, t }: { entries: WispEntry[]; t: T }) {
  const [tier, setTier] = useState<'all' | '1' | '2' | '3'>('all');
  const [mode, setMode] = useState<Mode>('all');
  const [cat, setCat] = useState<'all' | WispCat>('all');
  const inMode = (w: Wisp) => mode === 'all' || (mode === 'doubles' ? w.doubles : w.tockers);
  const hit = (x: Wisp) => (tier === 'all' || String(x.tier) === tier) && (cat === 'all' || x.cat === cat);
  const shown = useMemo(
    () => entries.filter(w => inMode(w) && [w, ...w.variants.filter(inMode)].some(hit)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, tier, mode, cat],
  );
  return (
    <div>
      <div className="flex flex-wrap gap-x-5 gap-y-3 mb-4">
        <div>
          <div className="text-fg-muted text-[11px] uppercase tracking-widest mb-1.5">{t('tft.tables.tier')}</div>
          <Toggle value={tier} onChange={setTier} options={[['all', t('tft.tables.all')], ['1', '1'], ['2', '2'], ['3', '3']]} />
        </div>
        <div>
          <div className="text-fg-muted text-[11px] uppercase tracking-widest mb-1.5">{t('tft.tables.mode')}</div>
          <Toggle value={mode} onChange={setMode} options={[['all', t('tft.tables.all')], ['doubles', 'Double Up'], ['tockers', "Tocker's Trials"]]} />
        </div>
        <div>
          <div className="text-fg-muted text-[11px] uppercase tracking-widest mb-1.5">{t('tft.tables.cat')}</div>
          <Toggle
            value={cat}
            onChange={setCat}
            options={[['all', t('tft.tables.all')], ...WISP_CATS.map(c => [c, t(`tft.tables.cat.${c}` as Parameters<T>[0])] as [WispCat, string])]}
          />
        </div>
      </div>
      <div className="bg-surface-base border border-border-subtle rounded-lg divide-y divide-border-subtle/60">
        {shown.map(w => (
          <WispRow key={`${w.api}-${tier}-${cat}`} w={w} variants={w.variants.filter(inMode)} openInit={!hit(w)} t={t} />
        ))}
      </div>
    </div>
  );
}

function WispRow({ w, variants, openInit, t }: { w: WispEntry; variants: WispVariant[]; openInit: boolean; t: T }) {
  const [open, setOpen] = useState(openInit);
  const more = variants.length > 0;
  const line = <WispLine w={w} t={t} />;
  return (
    <div>
      {more ? (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-label={`${w.name} · ${t('tft.tables.details')}`}
          className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-surface-raised/40 transition-colors"
        >
          {line}
          <span className="shrink-0 w-9 mt-1 flex items-center justify-end gap-0.5 text-fg-muted text-[11px] tabular-nums">
            {variants.length > 0 && `+${variants.length}`}
            <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
              <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
      ) : (
        <div className="flex items-start gap-3 px-3 py-2.5">
          {line}
          <span className="shrink-0 w-9" />
        </div>
      )}
      {open && (
        <div className="px-3 pb-3 pl-3 sm:pl-[60px] space-y-2.5">
          {variants.map(v => (
            <div key={v.api} className="border-l-2 border-l-accent/40 pl-3">
              <div className="text-accent text-[10px] uppercase tracking-widest mb-1">{t(v.kind === 'prismatic' ? 'tft.tables.prismatic' : 'tft.tables.upgrade')}</div>
              <div className="flex items-start gap-3"><WispLine w={v} t={t} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function hasExtra(w: Wisp): boolean {
  return !!w.req || !!w.excl?.length || (w.cooldown ?? 5) !== 5;
}

// Bild · Name mit Art · Kosten · Text · Runden; ab lg als eine Tabellenzeile, am Handy gestapelt.
function WispLine({ w, t }: { w: Wisp; t: T }) {
  const solo = !w.doubles && !w.tockers;
  return (
    <>
      {w.icon
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={w.icon} alt="" width={36} height={36} loading="lazy" className="shrink-0" style={{ width: 36, height: 36 }} />
        : <span className="w-9 h-9 shrink-0" />}
      <div className="flex-1 min-w-0 grid grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[11rem_3.5rem_minmax(0,1fr)_9.5rem] gap-x-4 gap-y-1 items-start">
        <div className="min-w-0">
          <div className="text-white text-[13px] font-medium leading-snug">{w.name}</div>
          <div className="text-fg-muted text-[11px]">
            {w.cat && `${t(`tft.tables.cat.${w.cat}` as Parameters<T>[0])} · `}{t('tft.tables.tier')} {w.tier}
            {solo && ` · ${t('tft.tables.soloOnly')}`}
          </div>
        </div>
        <span className="text-[12px] tabular-nums whitespace-nowrap text-right lg:text-left lg:pt-px" style={{ color: GOLD }}>{w.cost} {t('tft.tables.gold')}</span>
        <p className="col-span-2 lg:col-span-1 text-fg-secondary text-[12px] leading-relaxed">{w.desc}</p>
        <span className="col-span-2 lg:col-span-1 text-fg-muted text-[11px] lg:pt-px">{roundText(w.rounds, t)}</span>
        <WispExtra w={w} t={t} />
      </div>
    </>
  );
}

function WispExtra({ w, t }: { w: Wisp; t: T }) {
  if (!hasExtra(w)) return null;
  return (
    <div className="col-span-2 lg:col-span-1 lg:col-start-3 text-fg-muted text-[11px] space-y-0.5">
      {w.req && <p><span className="text-fg-secondary">{t('tft.tables.requires')}</span> {w.req}</p>}
      {w.excl && w.excl.length > 0 && <p><span className="text-fg-secondary">{t('tft.tables.excludes')}</span> {w.excl.join(', ')}</p>}
      {(w.cooldown ?? 5) !== 5 && <p><span className="text-fg-secondary">{t('tft.tables.cooldown')}</span> {w.cooldown}</p>}
    </div>
  );
}
