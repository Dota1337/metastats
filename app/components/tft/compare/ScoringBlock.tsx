'use client';
import { useState } from 'react';
import { useI18n, LOCALE_MAP } from '../../../lib/i18n';
import { PLAYER_COLORS, shortName, type ComparePlayer } from './model';
import { Section } from './CompareBlocks';
import { buildScoringView, metricOf, SCORING_MAINS, SCORING_SUBS, type Band } from './scoring-view';
import type { PlayerScoring, PlayerScoringResponse, ScoringMain } from '../../../lib/tft-player-scoring-types';

type Loaded = { p: ComparePlayer; i: number };
type Row = Loaded & { s: PlayerScoring };
type T = ReturnType<typeof useI18n>['t'];
type Key = Parameters<T>[0];

const mainLabel = (t: T, m: ScoringMain) => t(`tft.compare.scoring.main.${m}` as Key);
const subLabel = (t: T, id: string) => t(`tft.compare.scoring.m.${id.replace('.', '_')}` as Key);

// Balken 0–100: duenn der Wert, breit und blass der Bereich (90 % der
// Wiederholungen), damit beide Grenzen sichtbar bleiben.
function ScoreBar({ band, color }: { band: Band; color: string }) {
  const { value, lo, hi } = band;
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 h-3 rounded-full bg-surface-overlay overflow-hidden">
        {lo != null && hi != null && (
          <div
            className="absolute inset-y-0 rounded-full"
            style={{ left: `${lo}%`, width: `${Math.max(1, hi - lo)}%`, backgroundColor: color, opacity: 0.25 }}
          />
        )}
        {value != null && (
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full"
            style={{ width: `${value}%`, backgroundColor: color }}
          />
        )}
      </div>
      <span className="w-7 text-right text-[11px] tabular-nums text-white">{value != null ? Math.round(value) : '—'}</span>
    </div>
  );
}

function Bars({ rows, bands }: { rows: Row[]; bands: Band[] }) {
  return (
    <div className="space-y-1">
      {rows.map(({ i }, k) => <ScoreBar key={i} band={bands[k]} color={PLAYER_COLORS[i]} />)}
    </div>
  );
}

export function ScoringBlock({ players, scorings }: { players: Loaded[]; scorings: (PlayerScoringResponse | null | undefined)[] }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState<ScoringMain | null>(null);
  const [game, setGame] = useState<{ i: number; matchId: string } | null>(null);

  const rows: Row[] = players.flatMap(({ p, i }) => {
    const s = scorings[i];
    return s && s.available ? [{ p, i, s }] : [];
  });
  if (rows.length < 2) return null;
  const view = buildScoringView(rows.map(r => r.s));
  const mains = SCORING_MAINS.filter(m => view.common[m].length > 0);
  if (mains.length === 0) return null;

  const subBand = (r: Row, id: string): Band => {
    const m = metricOf(r.s, view.pick[id]);
    return { value: m?.value ?? null, lo: m?.lo ?? null, hi: m?.hi ?? null };
  };
  const picked = rows.find(r => r.i === game?.i)?.s.recent.find(g => g.matchId === game?.matchId) ?? null;

  return (
    <Section title={t('tft.compare.scoring')}>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[11px] text-fg-secondary">
        {rows.map(({ p, i, s }) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PLAYER_COLORS[i] }} />
            <span className="text-white">{shortName(p.name)}</span>
            <span className="tabular-nums">
              {t('tft.compare.scoring.games').replace('{n}', String(s.games))}
              {s.lobbyModel && <> · {t('tft.compare.scoring.known').replace('{n}', String(s.knownGames))}</>}
            </span>
          </span>
        ))}
      </div>

      <div className="space-y-3">
        <div>
          <div className="text-white text-xs font-semibold mb-1">{t('tft.compare.scoring.overall')}</div>
          <Bars rows={rows} bands={view.overall} />
        </div>
        {mains.map(m => (
          <div key={m}>
            <button
              type="button"
              onClick={() => setOpen(open === m ? null : m)}
              aria-expanded={open === m}
              className="w-full flex items-center justify-between text-left text-fg-secondary text-[10px] uppercase tracking-widest mb-1 hover:text-white"
            >
              <span>{mainLabel(t, m)}</span>
              <span aria-hidden className={`transition-transform ${open === m ? 'rotate-180' : ''}`}>▾</span>
            </button>
            <Bars rows={rows} bands={rows.map((_, k) => view.main[k][m])} />
            {open === m && (
              <div className="mt-2 ml-3 pl-3 border-l border-border-subtle space-y-2">
                {SCORING_SUBS[m].map(id => (
                  <div key={id}>
                    <div className="text-fg-secondary text-[11px] mb-1">{subLabel(t, id)}</div>
                    <div className="space-y-1">
                      {rows.map(r => {
                        const b = subBand(r, id);
                        const met = metricOf(r.s, view.pick[id]);
                        return b.value != null || !met
                          ? <ScoreBar key={r.i} band={b} color={PLAYER_COLORS[r.i]} />
                          : (
                            <div key={r.i} className="flex items-center gap-2">
                              <div className="flex-1 h-3 rounded-full bg-surface-overlay" />
                              <span className="w-7 text-right text-[11px] tabular-nums text-fg-muted">—</span>
                              <span className="text-[10px] tabular-nums text-fg-muted">{met.n}/{met.minN}</span>
                            </div>
                          );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-border-subtle">
        <div className="text-fg-secondary text-[10px] uppercase tracking-widest mb-2">{t('tft.compare.scoring.recent')}</div>
        <div className="space-y-1.5">
          {rows.map(({ i, s }) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-2 h-2 shrink-0 rounded-full" style={{ backgroundColor: PLAYER_COLORS[i] }} />
              <div className="flex flex-wrap gap-1">
                {s.recent.map(g => {
                  const active = game?.i === i && game.matchId === g.matchId;
                  return (
                    <button
                      key={g.matchId}
                      type="button"
                      onClick={() => setGame(active ? null : { i, matchId: g.matchId })}
                      aria-pressed={active}
                      className={`px-1.5 py-0.5 rounded text-[11px] tabular-nums border ${active ? 'border-white text-white' : 'border-border-subtle text-fg-secondary hover:text-white'}`}
                    >
                      #{g.placement}<span className="text-fg-muted"> · </span>{g.overall != null ? Math.round(g.overall) : '—'}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {picked && (
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-1 text-[11px]">
            {Object.entries(picked.scores).filter(([, v]) => v != null).map(([id, v]) => (
              <div key={id} className="flex justify-between gap-2">
                <span className="text-fg-secondary">{subLabel(t, id)}</span>
                <span className="text-white tabular-nums">{Math.round(v!)}</span>
              </div>
            ))}
            {picked.E != null && (
              <div className="flex justify-between gap-2">
                <span className="text-fg-secondary">{t('tft.compare.scoring.expected')}</span>
                <span className="text-white tabular-nums">{picked.E.toLocaleString(LOCALE_MAP[lang], { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
              </div>
            )}
            {picked.C != null && (
              <div className="flex justify-between gap-2">
                <span className="text-fg-secondary">{t('tft.compare.scoring.contest')}</span>
                <span className="text-white tabular-nums">{picked.C}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}
