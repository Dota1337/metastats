'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import { useI18n, LOCALE_MAP } from '../../../lib/i18n';

interface Result {
  placement: number;
  proName: string;
  proPuuid: string | null;
  team: string | null;
  country: string | null;
  prizeUsd: number | null;
}

interface Tournament {
  id: string;
  liquipedia_page: string;
  name: string;
  tier: string | null;
  region: string | null;
  set_number: number | null;
  start_date: string | null;
  end_date: string | null;
  status: 'upcoming' | 'live' | 'past';
  prize_pool_usd: number | null;
  twitch_channel: string | null;
  format: string | null;
  num_participants: number | null;
  logo_url: string | null;
  source: string;
  results: Result[];
}

const TIER_COLORS: Record<string, string> = { S: '#e0c75a', A: '#7B61FF', B: '#3a8ddc', C: '#5a6a80' };
const REGION_LABELS: Record<string, string> = {
  INT: 'International', AMER: 'Americas', EMEA: 'EMEA', APAC: 'Pacific', CN: 'China',
};

// Same cleaner used on the list page — drop set-codename suffix/prefix and
// collapse the "/" hierarchy so the tournament reads as a single human name.
function cleanTournamentName(raw: string): string {
  let name = raw;
  name = name.replace(/\s*\([^)]+\)\s*$/, '');
  name = name.replace(/^[^/]+\/(.+)$/, '$1');
  name = name.replace(/\//g, ' ');
  return name.trim();
}

export default function TftTournamentDetailPage() {
  const { t, lang } = useI18n();
  const params = useParams();
  const slug = decodeURIComponent(String(params?.slug || ''));
  const [tournament, setTournament] = useState<Tournament | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/tft/tournaments?slug=${encodeURIComponent(slug)}`)
      .then(r => r.json())
      .then(d => { setTournament(d.tournament || null); setLoading(false); })
      .catch(() => { setTournament(null); setLoading(false); });
  }, [slug]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0e1525]">
        <Nav active="tournaments" />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 text-[#a0b0c5] text-center">{t('tft.loading')}</div>
        <Footer />
      </main>
    );
  }
  if (!tournament) {
    return (
      <main className="min-h-screen bg-[#0e1525]">
        <Nav active="tournaments" />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 text-[#a0b0c5] text-center">{t('tft.tournaments.notFound')}</div>
        <Footer />
      </main>
    );
  }

  const tierColor = tournament.tier ? (TIER_COLORS[tournament.tier] || '#a0b0c5') : '#a0b0c5';
  const locale = LOCALE_MAP[lang];
  const dateFmt = (s: string | null) => s ? new Date(s).toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
  const statusColor = tournament.status === 'live' ? '#e44040' : tournament.status === 'upcoming' ? '#3ecf8e' : '#a0b0c5';

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="tournaments" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <a href="/tft/tournaments" className="text-[#7B61FF] text-xs hover:underline">← {t('tft.tournaments.title')}</a>

        {/* Header */}
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5 mt-2">
          <div className="flex items-start gap-4 flex-wrap">
            {tournament.tier && (
              <div
                className="flex items-center justify-center w-14 h-14 rounded-lg font-bold text-xl flex-shrink-0"
                style={{ color: tierColor, backgroundColor: `${tierColor}20`, border: `1px solid ${tierColor}55` }}
              >
                {tournament.tier}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-white text-2xl font-medium">{cleanTournamentName(tournament.name)}</h1>
              <div className="flex items-center gap-2 flex-wrap mt-1.5">
                <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded" style={{ backgroundColor: `${statusColor}25`, color: statusColor }}>
                  {t(`tft.tournaments.${tournament.status}` as const)}
                </span>
                {tournament.region && (
                  <span className="text-xs text-[#a0b0c5]">{REGION_LABELS[tournament.region] || tournament.region}</span>
                )}
              </div>
              <div className="text-[#a0b0c5] text-sm mt-2">
                {dateFmt(tournament.start_date)} – {dateFmt(tournament.end_date)}
              </div>
              {tournament.format && (
                <div className="text-[#7a8aa0] text-xs mt-1">{tournament.format}</div>
              )}
            </div>
            {tournament.prize_pool_usd != null && (
              <div className="text-right">
                <div className="text-[#7B61FF] text-2xl font-semibold tabular-nums">
                  ${tournament.prize_pool_usd.toLocaleString('en-US')}
                </div>
                <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest">Prize Pool</div>
              </div>
            )}
          </div>

        </div>

        {/* Twitch embed if available + tournament is live */}
        {tournament.status === 'live' && tournament.twitch_channel && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 mb-5">
            <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-2">{t('tft.tournaments.liveStream')}</div>
            <div className="aspect-video">
              <iframe
                src={`https://player.twitch.tv/?channel=${tournament.twitch_channel}&parent=metastats.gg&parent=www.metastats.gg&parent=localhost`}
                allowFullScreen
                className="w-full h-full rounded"
              />
            </div>
          </div>
        )}

        {/* Standings — only rendered when we have data. No info text when
            empty (per user preference to skip explanatory copy). */}
        {tournament.results && tournament.results.length > 0 && (
          <section className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
            <div className="px-4 py-2 bg-[#0a0e1a] text-[10px] uppercase tracking-widest text-[#7a8aa0]">
              {t('tft.tournaments.standings')}
            </div>
            <div className="hidden sm:grid grid-cols-[3rem_1fr_8rem_5rem_6rem] gap-2 px-4 py-2 text-[10px] uppercase text-[#7a8aa0] border-t border-[#1e2a3a]">
              <div className="text-right">#</div>
              <div>{t('tft.pros.col.player')}</div>
              <div>{t('tft.pros.col.team')}</div>
              <div>{t('tft.pros.col.region')}</div>
              <div className="text-right">Prize</div>
            </div>
            {tournament.results.map(r => {
              const placeColor = r.placement === 1 ? '#f0c040' : r.placement === 2 ? '#cfd6dc' : r.placement === 3 ? '#cd7f32' : '#a0b0c5';
              const playerLink = r.proPuuid ? `/api/tft/pros?puuid=${r.proPuuid}` : null;
              return (
                <div
                  key={`${r.placement}-${r.proName}`}
                  className="block sm:grid sm:grid-cols-[3rem_1fr_8rem_5rem_6rem] gap-2 px-4 py-2 sm:items-center text-xs border-t border-[#1e2a3a]"
                >
                  <div className="hidden sm:block text-right text-base font-bold tabular-nums" style={{ color: placeColor }}>
                    {r.placement}
                  </div>
                  <div className="flex items-baseline gap-2 sm:block">
                    <span className="text-base font-bold tabular-nums sm:hidden" style={{ color: placeColor }}>#{r.placement}</span>
                    {playerLink ? (
                      <PlayerNameLink puuid={r.proPuuid!} name={r.proName} />
                    ) : (
                      <span className="text-white font-medium">{r.proName}</span>
                    )}
                  </div>
                  <div className="hidden sm:block text-[#a0b0c5] truncate">{r.team || '—'}</div>
                  <div className="hidden sm:block text-[#a0b0c5]">{r.country || '—'}</div>
                  <div className="flex sm:block items-center justify-between mt-1 sm:mt-0 sm:text-right tabular-nums">
                    <span className="text-[#7a8aa0] text-[10px] sm:hidden">{r.team}{r.team && r.country ? ' · ' : ''}{r.country}</span>
                    <span className="text-[#7B61FF] font-medium">
                      {r.prizeUsd != null ? `$${r.prizeUsd.toLocaleString('en-US')}` : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </div>
      <Footer />
    </main>
  );
}

// Pro name link — resolves PUUID → TFT player profile URL via the /api/tft/pros
// endpoint to pull the riot_id (which we need for the slug). Cached client-side
// so going to the same tournament twice doesn't refetch the same pro.
const playerLinkCache = new Map<string, { gameName: string; tagLine: string; region: string }>();

function PlayerNameLink({ puuid, name }: { puuid: string; name: string }) {
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    const cached = playerLinkCache.get(puuid);
    if (cached) {
      setLink(`/tft/player/${encodeURIComponent(cached.gameName)}--${encodeURIComponent(cached.tagLine)}?region=${cached.region}`);
      return;
    }
    fetch(`/api/tft/pros?puuid=${puuid}`)
      .then(r => r.ok ? r.json() : { pro: null })
      .then(d => {
        if (!d.pro?.riot_id) return;
        const [gameName, tagLine] = d.pro.riot_id.split('#');
        if (!gameName) return;
        playerLinkCache.set(puuid, { gameName, tagLine: tagLine || '', region: d.pro.region });
        setLink(`/tft/player/${encodeURIComponent(gameName)}--${encodeURIComponent(tagLine || '')}?region=${d.pro.region}`);
      })
      .catch(() => {});
  }, [puuid]);

  if (link) {
    return (
      <a href={link} className="text-white font-medium hover:text-[#7B61FF] truncate">
        {name}
      </a>
    );
  }
  return <span className="text-white font-medium">{name}</span>;
}
