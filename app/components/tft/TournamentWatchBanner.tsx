'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '../../lib/i18n';

interface LiveTournament {
  id: string;
  name: string;
  tier: string | null;
  region: string | null;
  start_date: string;
  end_date: string;
  prize_pool_usd: number | null;
  twitch_channel: string | null;
  logo_url: string | null;
}

export default function TournamentWatchBanner() {
  const { t } = useI18n();
  const [tournaments, setTournaments] = useState<LiveTournament[]>([]);

  useEffect(() => {
    fetch('/api/tft/tournaments?status=live&limit=5')
      .then(r => r.ok ? r.json() : { tournaments: [] })
      .then(d => setTournaments(d.tournaments || []))
      .catch(() => {});
  }, []);

  if (tournaments.length === 0) return null;
  return (
    <section className="bg-gradient-to-r from-[#1a0e26] via-[#0d1526] to-[#0a1c14] border border-[#a892ff]/30 rounded p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-[#3ecf8e] animate-pulse" />
        <h2 className="text-[#a892ff] text-xs uppercase tracking-widest">{t('tft.tournamentWatch.title')}</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {tournaments.map(tr => (
          <a
            key={tr.id}
            href={`/tft/tournaments/${encodeURIComponent(tr.id)}`}
            className="flex items-center gap-3 bg-[#141c2e] border border-[#1e2a3a] rounded p-3 hover:border-[#a892ff]/40 transition-colors"
          >
            {tr.logo_url ? (
              <img src={tr.logo_url} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded bg-[#1e2a3a] flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-white text-sm font-medium truncate">{tr.name}</div>
              <div className="text-[#7a8aa0] text-[11px] truncate">
                {tr.region || '—'}
                {tr.tier ? ` · ${tr.tier}-Tier` : ''}
                {tr.prize_pool_usd ? ` · $${tr.prize_pool_usd.toLocaleString('en-US')}` : ''}
              </div>
            </div>
            {tr.twitch_channel && (
              <span className="text-[10px] text-[#e44040] font-medium">{t('tft.tournamentWatch.live')}</span>
            )}
          </a>
        ))}
      </div>
    </section>
  );
}
