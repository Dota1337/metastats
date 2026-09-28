'use client';
import type { ReactNode } from 'react';
import { useI18n, LOCALE_MAP } from '../../../lib/i18n';
import { NO_DIVISION_TIERS, RANK_TIER_COLOR } from '../../../lib/rank-format';
import {
  findChampion, findTrait, tftChampionTileUrl, tftIconUrl, tftGameAssetUrl, type TftAssetsBundle,
} from '../../../lib/tft-cdragon';
import { formatStage } from '../../../lib/tft-stage';
import { withAlpha } from '../../../lib/color';
import RankEmblem from '../RankEmblem';
import { isEndRank, rankKey } from '../../../lib/tft-rank-kind';
import {
  PLAYER_COLORS, rankScore, shortName, currentRank,
  type ComparePlayer, type SeasonRankRow,
} from './model';

type Loaded = { p: ComparePlayer; i: number };
type T = ReturnType<typeof useI18n>['t'];

const LG_COLS: Record<number, string> = { 1: '', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' };
const COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' };

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-surface-base border border-border-subtle rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-fg-secondary text-xs uppercase tracking-widest">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function tierLabel(t: T, tier: string | null | undefined, div?: string | null): string {
  if (!tier || tier.toUpperCase() === 'UNRANKED') return t('tft.player.unranked');
  const up = tier.toUpperCase();
  const name = t(`tier.${up.toLowerCase()}` as Parameters<T>[0]);
  return div && !NO_DIVISION_TIERS.has(up) ? `${name} ${div}` : name;
}

function PlayerName({ p, i, region }: { p: ComparePlayer; i: number; region: string }) {
  const [gn, tl] = p.name.split('#');
  const slug = `${encodeURIComponent(gn)}--${encodeURIComponent(tl || region.replace(/\d+$/, '').toUpperCase())}`;
  return (
    <a href={`/tft/player/${slug}?region=${region}`} className="font-medium hover:underline truncate block" style={{ color: PLAYER_COLORS[i] }}>
      {gn}{tl ? <span className="text-fg-muted font-normal">#{tl}</span> : null}
    </a>
  );
}

// ── Kopfkarten ───────────────────────────────────────────────────────────────
export function PlayerCards({ players, region }: { players: Loaded[]; region: string }) {
  const { t, lang } = useI18n();
  const eur = (v: number) => new Intl.NumberFormat(LOCALE_MAP[lang], { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 ${LG_COLS[players.length]} gap-3 mb-4`}>
      {players.map(({ p, i }) => {
        const r = currentRank(p);
        return (
          <div key={i} className="relative bg-surface-base border border-border-subtle rounded-lg p-4 overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: PLAYER_COLORS[i] }} />
            <div className="flex items-center gap-3">
              <RankEmblem tier={r.tier} label={tierLabel(t, r.tier)} className="w-14 h-14 shrink-0" />
              <div className="min-w-0 flex-1">
                <PlayerName p={p} i={i} region={region} />
                <div className="text-xs mt-0.5" style={{ color: (r.tier && RANK_TIER_COLOR[r.tier.toUpperCase()]) || 'var(--fg-secondary)' }}>
                  {tierLabel(t, r.tier, r.rank)}
                  {r.tier && r.lp != null && <span className="text-fg-secondary"> · {r.lp} LP</span>}
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-end justify-between gap-2">
              <div>
                <div className="text-fg-muted text-[10px] uppercase tracking-widest">{t('tft.marketValue')}</div>
                <div className="text-white text-xl font-semibold tabular-nums">
                  {p.rated && p.marketValue != null ? eur(p.marketValue) : '—'}
                </div>
              </div>
              <div className="text-right text-[11px] text-fg-secondary tabular-nums">
                {p.multiplier != null && p.rated && <div>×{p.multiplier.toFixed(2)}</div>}
                {p.stats
                  ? <div>{p.stats.totalMatches} {t('tft.gamesShort')}</div>
                  : <div className="h-3 w-14 rounded bg-surface-overlay animate-pulse" />}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Kategorie-Siege ──────────────────────────────────────────────────────────
interface Metric { value: (p: ComparePlayer) => number | null; lowerIsBetter?: boolean }
const CATEGORY_METRICS: Metric[] = [
  { value: p => { const r = currentRank(p); return rankScore(r.tier, r.rank, r.lp); } },
  { value: p => (p.rated ? p.marketValue : null) },
  { value: p => (p.rated ? p.multiplier : null) },
  { value: p => (p.stats?.totalMatches ? p.stats.avgPlacement : null), lowerIsBetter: true },
  { value: p => (p.stats?.totalMatches ? p.stats.top4Rate : null) },
  { value: p => (p.stats?.totalMatches ? p.stats.top1Rate : null) },
  { value: p => p.stats?.extras?.stddev ?? null, lowerIsBetter: true },
  { value: p => p.stats?.extras?.bestTop4Streak ?? null },
];

export function CategoryWins({ players }: { players: Loaded[] }) {
  const { t } = useI18n();
  const wins = new Map<number, number>(players.map(({ i }) => [i, 0]));
  let counted = 0;
  for (const m of CATEGORY_METRICS) {
    const vals = players.map(({ p, i }) => ({ i, v: m.value(p) })).filter(x => x.v != null) as { i: number; v: number }[];
    if (vals.length < 2) continue;
    counted++;
    const best = m.lowerIsBetter ? Math.min(...vals.map(x => x.v)) : Math.max(...vals.map(x => x.v));
    const leaders = vals.filter(x => x.v === best);
    if (leaders.length === 1) wins.set(leaders[0].i, (wins.get(leaders[0].i) || 0) + 1);
  }
  if (counted === 0) return null;
  const total = [...wins.values()].reduce((s, v) => s + v, 0) || 1;
  const top = Math.max(...wins.values());
  return (
    <Section title={t('tft.compare.categoryWins')}>
      <div className={`grid ${COLS[players.length]} gap-2 mb-3`}>
        {players.map(({ p, i }) => (
          <div key={i} className="text-center min-w-0">
            <div className="text-2xl sm:text-3xl font-semibold tabular-nums" style={{ color: wins.get(i) === top && top > 0 ? PLAYER_COLORS[i] : 'var(--fg-secondary)' }}>
              {wins.get(i)}<span className="text-fg-muted text-sm font-normal">/{counted}</span>
            </div>
            <div className="text-[11px] text-fg-secondary truncate">{shortName(p.name)}</div>
          </div>
        ))}
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-overlay gap-0.5">
        {players.map(({ i }) => (wins.get(i) || 0) > 0 && (
          <div key={i} className="h-full transition-all duration-700" style={{ width: `${((wins.get(i) || 0) / total) * 100}%`, backgroundColor: PLAYER_COLORS[i] }} />
        ))}
      </div>
    </Section>
  );
}

// ── Kennzahlen ───────────────────────────────────────────────────────────────
interface Row {
  label: string;
  value: (p: ComparePlayer) => number | null;
  fmt: (v: number) => string;
  lowerIsBetter?: boolean;
  neutral?: boolean;
}

function StatRows({ players, rows }: { players: Loaded[]; rows: Row[] }) {
  return (
    <div className="space-y-3">
      {rows.map(row => {
        const vals = players.map(({ p }) => row.value(p));
        const present = vals.filter((v): v is number => v != null);
        if (present.length === 0) return null;
        const best = row.lowerIsBetter ? Math.min(...present) : Math.max(...present);
        const uniqueBest = present.filter(v => v === best).length === 1 && present.length > 1 && !row.neutral;
        // Balkenlaenge: der Beste fuellt die Zeile, die anderen im Verhaeltnis.
        const width = (v: number) => {
          if (row.lowerIsBetter) return v > 0 ? (Math.min(...present) / v) * 100 : 100;
          const max = Math.max(...present);
          return max > 0 ? (v / max) * 100 : 0;
        };
        return (
          <div key={row.label}>
            <div className="text-fg-secondary text-[10px] uppercase tracking-widest mb-1">{row.label}</div>
            <div className={`grid ${COLS[players.length]} gap-2`}>
              {players.map(({ i }, k) => {
                const v = vals[k];
                const lead = uniqueBest && v === best;
                return (
                  <div key={i} className="min-w-0">
                    <div className={`text-sm tabular-nums ${lead ? 'font-semibold' : ''}`} style={{ color: lead ? PLAYER_COLORS[i] : v == null ? 'var(--fg-muted)' : 'var(--fg-primary, #fff)' }}>
                      {v == null ? '—' : row.fmt(v)}
                    </div>
                    <div className="h-1.5 rounded-full bg-surface-overlay overflow-hidden mt-1">
                      {v != null && (
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${width(v)}%`, backgroundColor: lead || row.neutral ? PLAYER_COLORS[i] : withAlpha(PLAYER_COLORS[i], 110) }} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NameHeader({ players }: { players: Loaded[] }) {
  return (
    <div className={`grid ${COLS[players.length]} gap-2 mb-3 pb-2 border-b border-border-subtle`}>
      {players.map(({ p, i }) => (
        <div key={i} className="text-xs font-medium truncate" style={{ color: PLAYER_COLORS[i] }}>{shortName(p.name)}</div>
      ))}
    </div>
  );
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function KeyStats({ players }: { players: Loaded[] }) {
  const { t } = useI18n();
  const has = (p: ComparePlayer) => !!p.stats?.totalMatches;
  const rows: Row[] = [
    { label: t('tft.avgPlacement'), value: p => (has(p) ? p.stats!.avgPlacement : null), fmt: v => v.toFixed(2), lowerIsBetter: true },
    { label: t('tft.top4'), value: p => (has(p) ? p.stats!.top4Rate : null), fmt: pct },
    { label: t('tft.top1'), value: p => (has(p) ? p.stats!.top1Rate : null), fmt: pct },
    { label: t('tft.player.consistency'), value: p => p.stats?.extras?.stddev ?? null, fmt: v => `±${v.toFixed(2)}`, lowerIsBetter: true },
    { label: t('tft.player.bestStreak'), value: p => p.stats?.extras?.bestTop4Streak ?? null, fmt: v => String(v) },
    { label: t('tft.compare.avgLastRound'), value: p => p.stats?.extras?.avgLastRound || null, fmt: v => formatStage(v) },
    { label: t('tft.gamesShort'), value: p => p.stats?.totalMatches ?? null, fmt: v => String(v), neutral: true },
  ];
  if (!players.some(({ p }) => has(p))) return null;
  return (
    <Section title={t('tft.compare.keyStats')}>
      <NameHeader players={players} />
      <StatRows players={players} rows={rows} />
    </Section>
  );
}

// ── Spielstil (nur wenn alle Spieler Werte haben) ────────────────────────────
export function PlaystyleBlock({ players }: { players: Loaded[] }) {
  const { t } = useI18n();
  if (!players.every(({ p }) => p.stats?.seasonAggregate)) return null;
  const agg = (p: ComparePlayer) => p.stats!.seasonAggregate!;
  const whole = (v: number) => `${Math.round(v * 100)}%`;
  const rows: Row[] = [
    { label: t('tft.player.uniqueComps'), value: p => agg(p).uniqueComps, fmt: v => String(v), neutral: true },
    { label: t('tft.player.dominantShare'), value: p => agg(p).dominantShare, fmt: whole, neutral: true },
    { label: t('tft.player.metaPickShare'), value: p => agg(p).metaPickShare, fmt: whole, neutral: true },
    { label: t('tft.player.itemSlam'), value: p => agg(p).itemSlamScore, fmt: whole },
  ];
  return (
    <Section title={t('tft.compare.playstyle')}>
      <NameHeader players={players} />
      <StatRows players={players} rows={rows} />
    </Section>
  );
}

// ── Level bei Spielende ──────────────────────────────────────────────────────
const LEVEL_KEYS = ['le7', 'l8', 'l9', 'l10'] as const;
const LEVEL_LABEL: Record<typeof LEVEL_KEYS[number], string> = { le7: '≤7', l8: '8', l9: '9', l10: '10' };
const LEVEL_ALPHA = [70, 130, 190, 255];

export function LevelBlock({ players }: { players: Loaded[] }) {
  const { t } = useI18n();
  const withData = players.filter(({ p }) => p.stats?.extras?.recent.length);
  if (withData.length === 0) return null;
  return (
    <Section title={t('tft.compare.levelEnd')}>
      <div className="space-y-3">
        {withData.map(({ p, i }) => {
          const d = p.stats!.extras!.levelDist;
          const total = LEVEL_KEYS.reduce((s, k) => s + d[k], 0) || 1;
          return (
            <div key={i}>
              <div className="text-xs mb-1 truncate" style={{ color: PLAYER_COLORS[i] }}>{shortName(p.name)}</div>
              <div className="flex h-6 rounded overflow-hidden">
                {LEVEL_KEYS.map((k, n) => {
                  const share = d[k] / total;
                  if (share === 0) return null;
                  return (
                    <div
                      key={k}
                      className="h-full flex items-center justify-center text-[10px] font-medium tabular-nums"
                      style={{ width: `${share * 100}%`, backgroundColor: withAlpha(PLAYER_COLORS[i], LEVEL_ALPHA[n]), color: n >= 2 ? 'var(--surface-page)' : '#fff' }}
                      title={`${t('tft.match.lvl')} ${LEVEL_LABEL[k]}: ${d[k]} (${Math.round(share * 100)}%)`}
                    >
                      {share >= 0.09 ? `${Math.round(share * 100)}%` : ''}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
          {LEVEL_KEYS.map((k, n) => (
            <span key={k} className="inline-flex items-center gap-1.5 text-[11px] text-fg-secondary">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: withAlpha(PLAYER_COLORS[0], LEVEL_ALPHA[n]) }} />
              {t('tft.match.lvl')} {LEVEL_LABEL[k]}
            </span>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ── Traits ───────────────────────────────────────────────────────────────────
function stripPrefix(id: string) {
  return id.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
}

export function TraitsBlock({ players, assets }: { players: Loaded[]; assets: TftAssetsBundle | null }) {
  const { t } = useI18n();
  const withData = players.filter(({ p }) => p.stats?.extras?.traits.length);
  if (withData.length === 0) return null;
  const sets = withData.map(({ p }) => new Set(p.stats!.extras!.traits.map(x => x.name)));
  const shared = withData.length >= 2 ? new Set([...sets[0]].filter(n => sets.every(s => s.has(n)))) : new Set<string>();
  return (
    <Section title={t('tft.compare.topTraits')}>
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${LG_COLS[withData.length]} gap-4`}>
        {withData.map(({ p, i }) => (
          <div key={i} className="min-w-0">
            <div className="text-xs font-medium mb-2 truncate" style={{ color: PLAYER_COLORS[i] }}>{shortName(p.name)}</div>
            <div className="space-y-2">
              {p.stats!.extras!.traits.map(tr => {
                const trait = findTrait(assets, tr.name);
                const icon = trait ? tftIconUrl(assets, trait.icon) : null;
                const isShared = shared.has(tr.name);
                return (
                  <div key={tr.name} className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded flex items-center justify-center shrink-0 bg-surface-raised border" style={{ borderColor: isShared ? PLAYER_COLORS[i] : 'var(--border-subtle)' }}>
                      {icon ? <img src={icon} alt="" className="w-5 h-5" /> : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-white text-xs truncate">{trait?.name || stripPrefix(tr.name)}</span>
                        <span className="text-[11px] text-fg-secondary tabular-nums shrink-0">
                          {Math.round(tr.share * 100)}%{tr.avgPlacement != null ? ` · Ø ${tr.avgPlacement.toFixed(2)}` : ''}
                        </span>
                      </div>
                      <div className="h-1 rounded-full bg-surface-overlay overflow-hidden mt-1">
                        <div className="h-full rounded-full" style={{ width: `${tr.share * 100}%`, backgroundColor: PLAYER_COLORS[i] }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {shared.size > 0 && (
        <div className="mt-3 text-[11px] text-fg-muted inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm border border-fg-secondary" />
          {t('tft.compare.traits.shared')}
        </div>
      )}
    </Section>
  );
}

// ── Units ────────────────────────────────────────────────────────────────────
function unitIcon(characterId: string, assets: TftAssetsBundle | null, setNumber: number): string {
  const tile = tftChampionTileUrl(assets, findChampion(assets, characterId));
  const id = characterId.toLowerCase();
  return tile || tftGameAssetUrl(`assets/characters/${id}/hud/${id}_square.tft_set${setNumber}.png`);
}

export function UnitsBlock({ players, assets, setNumber }: { players: Loaded[]; assets: TftAssetsBundle | null; setNumber: number }) {
  const { t } = useI18n();
  const withData = players.filter(({ p }) => p.stats?.extras?.units.length);
  if (withData.length === 0) return null;
  return (
    <Section title={t('tft.compare.units')}>
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${LG_COLS[withData.length]} gap-4`}>
        {withData.map(({ p, i }) => (
          <div key={i} className="min-w-0">
            <div className="text-xs font-medium mb-2 truncate" style={{ color: PLAYER_COLORS[i] }}>{shortName(p.name)}</div>
            <div className="grid grid-cols-4 gap-x-1.5 gap-y-2">
              {p.stats!.extras!.units.map(u => {
                const name = findChampion(assets, u.characterId)?.name || stripPrefix(u.characterId);
                return (
                  <a key={u.characterId} href={`/tft/units/${encodeURIComponent(u.characterId)}`} className="flex flex-col items-center min-w-0 group" title={name}>
                    <div className="relative">
                      <img src={unitIcon(u.characterId, assets, setNumber)} alt={name} className="w-11 h-11 rounded border border-border-subtle object-cover group-hover:border-accent-a60" />
                      {u.star3Rate >= 0.05 && (
                        <span className="absolute -top-1.5 -right-1.5 text-[9px] leading-none px-1 py-0.5 rounded bg-surface-page border border-border-subtle text-gold-earnings tabular-nums">
                          3★ {Math.round(u.star3Rate * 100)}%
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-white tabular-nums mt-1">{Math.round(u.share * 100)}%</span>
                    <span className="text-[10px] text-fg-muted tabular-nums">{u.avgPlacement != null ? `Ø ${u.avgPlacement.toFixed(2)}` : ' '}</span>
                  </a>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Hoechster Rang je Set ────────────────────────────────────────────────────
const peakKey = rankKey;

type Peak = { tier: string; div: string | null; lp: number | null; end: boolean };
// Je Set gibt es teils zwei Eintraege (Halbsets, zwei Quellen, leere Zeilen) —
// der hoechste gewinnt.
function peaksBySet(rows: SeasonRankRow[]): Map<number, Peak> {
  const out = new Map<number, Peak>();
  for (const r of rows) {
    if (peakKey(r.peak_tier, r.peak_division, r.peak_lp) < 0) continue;
    const cur = out.get(r.set_number);
    if (!cur || peakKey(r.peak_tier, r.peak_division, r.peak_lp) > peakKey(cur.tier, cur.div, cur.lp)) {
      out.set(r.set_number, { tier: r.peak_tier!.toUpperCase(), div: r.peak_division, lp: r.peak_lp, end: isEndRank(r) });
    }
  }
  return out;
}

const MAX_SETS = 6;
export function SetRanksBlock({ players, currentSet }: { players: Loaded[]; currentSet: number }) {
  const { t } = useI18n();
  const peaks = players.map(({ p }) => {
    const m = peaksBySet(p.stats?.seasonRanks || []);
    // Aktuelles Set: gespeicherter Hoechstrang kann bis zu 7 Tage alt sein —
    // liegt der Live-Rang hoeher, gilt der. Nie nach unten ersetzen.
    const r = currentRank(p);
    if (r.tier && peakKey(r.tier, r.rank, r.lp) >= 0) {
      const old = m.get(currentSet);
      if (!old || peakKey(r.tier, r.rank, r.lp) > peakKey(old.tier, old.div, old.lp)) {
        m.set(currentSet, { tier: r.tier.toUpperCase(), div: r.rank, lp: r.lp, end: false });
      }
    }
    return m;
  });
  const sets = [...new Set(peaks.flatMap(m => [...m.keys()]))].sort((a, b) => b - a).slice(0, MAX_SETS);
  if (sets.length === 0) return null;
  return (
    <Section title={t('tft.compare.setRanks')}>
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left text-fg-muted font-normal pb-2 pr-2 w-14">{t('tft.set')}</th>
              {players.map(({ p, i }) => (
                <th key={i} className="text-center font-medium pb-2 px-1 truncate max-w-0" style={{ color: PLAYER_COLORS[i] }}>{shortName(p.name)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sets.map(s => {
              const keys = peaks.map(m => { const x = m.get(s); return x ? peakKey(x.tier, x.div, x.lp) : -1; });
              const best = Math.max(...keys);
              const unique = keys.filter(k => k === best).length === 1 && best >= 0;
              return (
                <tr key={s} className="border-t border-border-subtle">
                  <td className="py-1.5 pr-2 text-fg-secondary tabular-nums whitespace-nowrap">{s}{s === currentSet ? ' ●' : ''}</td>
                  {players.map(({ i }, k) => {
                    const x = peaks[k].get(s);
                    return (
                      <td key={i} className="py-1.5 px-1">
                        {x ? (
                          <div className="flex flex-col items-center" title={tierLabel(t, x.tier, x.div)}>
                            <RankEmblem tier={x.tier} label={tierLabel(t, x.tier, x.div)} className={`w-8 h-8 ${unique && keys[k] === best ? '' : 'opacity-70'}`} />
                            <span className="text-[10px] tabular-nums text-fg-secondary">
                              {NO_DIVISION_TIERS.has(x.tier) ? (x.lp != null ? `${x.lp} LP` : '') : (x.div || '')}
                            </span>
                            {x.end && <span className="text-[9px] text-fg-muted leading-tight">{t('tft.player.endRank')}</span>}
                          </div>
                        ) : <div className="text-center text-fg-muted">—</div>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ── Gemeinsame Lobbys ────────────────────────────────────────────────────────
export function SharedLobbies({ players }: { players: Loaded[] }) {
  const { t } = useI18n();
  const withData = players.filter(({ p }) => p.stats?.extras?.recent.length);
  const pairs: { a: Loaded; b: Loaded; games: { pa: number; pb: number }[] }[] = [];
  for (let x = 0; x < withData.length; x++) {
    for (let y = x + 1; y < withData.length; y++) {
      const a = withData[x], b = withData[y];
      const mb = new Map(b.p.stats!.extras!.recent.map(g => [g.id, g.p]));
      const games = a.p.stats!.extras!.recent
        .filter(g => mb.has(g.id))
        .map(g => ({ pa: g.p, pb: mb.get(g.id)! }));
      if (games.length > 0) pairs.push({ a, b, games });
    }
  }
  if (pairs.length === 0) return null;
  return (
    <Section title={t('tft.compare.sharedLobbies')}>
      <div className="space-y-3">
        {pairs.map(({ a, b, games }) => {
          const aAhead = games.filter(g => g.pa < g.pb).length;
          const bAhead = games.length - aAhead;
          const avg = (k: 'pa' | 'pb') => (games.reduce((s, g) => s + g[k], 0) / games.length).toFixed(2);
          return (
            <div key={`${a.i}-${b.i}`}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate" style={{ color: PLAYER_COLORS[a.i] }}>{shortName(a.p.name)}</span>
                <span className="tabular-nums text-white font-semibold shrink-0">{aAhead} : {bAhead}</span>
                <span className="truncate text-right" style={{ color: PLAYER_COLORS[b.i] }}>{shortName(b.p.name)}</span>
              </div>
              <div className="flex h-2 rounded-full overflow-hidden bg-surface-overlay gap-0.5 my-1">
                {aAhead > 0 && <div style={{ width: `${(aAhead / games.length) * 100}%`, backgroundColor: PLAYER_COLORS[a.i] }} />}
                {bAhead > 0 && <div style={{ width: `${(bAhead / games.length) * 100}%`, backgroundColor: PLAYER_COLORS[b.i] }} />}
              </div>
              <div className="flex justify-between text-[11px] text-fg-secondary tabular-nums">
                <span>Ø {avg('pa')}</span>
                <span>{games.length} {t('tft.gamesShort')}</span>
                <span>Ø {avg('pb')}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
