'use client';
import { useEffect, useState } from 'react';
import { useI18n, LOCALE_MAP } from '../../lib/i18n';
import { formatPrize, formatUsd } from '../../lib/prize-format';
import type { PlayerTournamentHistory as History } from '../../lib/tft-tournament-history';

// Turnierhistorie auf der Spielerseite (2026-09-28) — fuer ALLE Spieler, nicht
// nur verifizierte Pros. Quelle: /api/tft/player-tournaments (Liquipedia-
// Spielerseite + Turniertabellen + Name→Konto-Zuordnung). Zugeklappt; ohne
// Eintraege wird nichts gezeigt.

function placeColor(min: number | null): string {
  if (min === 1) return '#f0c040';
  if (min === 2) return '#c0c0c0';
  if (min === 3) return '#cd7f32';
  return 'var(--fg-secondary)';
}

export default function PlayerTournamentHistory({ puuid }: { puuid: string }) {
  const { t, lang } = useI18n();
  const locale = LOCALE_MAP[lang];
  const [data, setData] = useState<History | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setData(null);
    setOpen(false);
    fetch(`/api/tft/player-tournaments?puuid=${encodeURIComponent(puuid)}`, { signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && Array.isArray(d.entries)) setData(d); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [puuid]);

  if (!data || data.entries.length === 0) return null;
  const { entries, wins, earningsUsd } = data;

  return (
    <div className="bg-surface-base border border-border-subtle rounded-lg mb-3 sm:mb-5">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 flex-wrap px-3 sm:px-5 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <svg
            width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"
            className={`text-fg-muted transition-transform ${open ? 'rotate-90' : ''}`}
          >
            <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="text-white text-sm font-medium uppercase tracking-widest">{t('tft.player.tournamentHistory')}</span>
        </span>
        <span className="text-xs text-fg-secondary">
          <span className="text-white">{entries.length}</span> {t('tft.player.tournaments')}
          {wins > 0 && <> · <span className="text-[#f0c040]">{wins}× 1.</span></>}
          {earningsUsd != null && <> · <span className="text-gold-earnings tabular-nums">{formatUsd(earningsUsd)}</span></>}
        </span>
      </button>

      {open && (
        <div className="px-3 sm:px-5 pb-3">
          <div className="hidden sm:grid grid-cols-[6rem_3.5rem_1fr_5rem_7rem] gap-2 text-[10px] uppercase text-fg-muted pb-2 border-b border-border-subtle">
            <div>{t('tft.player.colDate')}</div>
            <div>{t('tft.player.colPlace')}</div>
            <div>{t('tft.player.colTournament')}</div>
            <div>{t('tft.player.colTier')}</div>
            <div className="text-right">{t('tft.player.colPrize')}</div>
          </div>
          {entries.map((e, i) => (
            <div
              key={`${e.tournament}-${e.place}-${i}`}
              className="grid grid-cols-[5rem_2.5rem_1fr_5rem] sm:grid-cols-[6rem_3.5rem_1fr_5rem_7rem] gap-2 py-1.5 text-xs items-center border-b border-border-subtle/40 last:border-b-0"
            >
              <div className="text-fg-muted tabular-nums">{e.date?.slice(0, 10) || '—'}</div>
              <div className="font-medium tabular-nums" style={{ color: placeColor(e.placeMin) }}>{e.place || '—'}</div>
              <div className="min-w-0 truncate text-white">
                {e.href ? (
                  <a
                    href={e.href}
                    {...(e.internal ? {} : { target: '_blank', rel: 'noreferrer' })}
                    className="hover:text-[#a892ff]"
                  >
                    {e.tournament}
                  </a>
                ) : e.tournament}
              </div>
              <div className="text-fg-muted hidden sm:block">{e.tier || '—'}</div>
              <div className="text-gold-earnings text-right tabular-nums">
                {formatPrize(e.prizeUsd, e.prizeNative, e.prizeCurrency, locale)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
