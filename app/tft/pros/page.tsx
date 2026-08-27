'use client';
import { useEffect, useMemo, useState } from 'react';
import { withAlpha } from '../../lib/color';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import { useI18n } from '../../lib/i18n';
import { notFound } from 'next/navigation';
import { TFT_PROS_ENABLED } from '../../lib/feature-flags';

// TFT pro player directory with multi-source classification.
// Default-View: TPC + Tournament Pros (the "verified" set). Streamer + Historic
// + Inactive are behind opt-in tabs so the long Liquipedia tail doesn't drown
// out actually-active competitive pros.

type Classification = 'tpc' | 'tournament' | 'streamer' | 'historic' | 'inactive';

interface TournamentResult {
  tournament: string;
  date: string;
  place: string | null;
  prize_usd: number;
  tier: string | null;
  page: string | null;
}

interface Pro {
  // NULL for Chinese-server pros (region='cn', migration 0050) — no Riot identity.
  puuid: string | null;
  pro_name: string;
  real_name: string | null;
  region: string;
  riot_id: string | null;
  team: string | null;
  role: string | null;
  country: string | null;
  source: 'liquipedia' | 'manual';
  tpc_verified: boolean;
  tpc_pro_points: number | null;
  tpc_region: string | null;
  classification: Classification;
  confidence_score: number;
  active_rank_tier: string | null;
  active_rank_lp: number | null;
  last_tournament_at: string | null;
  twitch_handle: string | null;
  twitter_handle: string | null;
  image_url: string | null;
  total_earnings_usd: number | null;
  earnings_sources: Record<string, number>;
  stream_platforms: Record<string, any>;
  tournament_results: TournamentResult[] | null;
  last_full_validation_at: string | null;
}

interface Response {
  pros: Pro[];
  classCounts: Record<Classification, number>;
  regionCounts: Record<string, number>;
  teamCounts: Record<string, number>;
  tpcRegionCounts: Record<string, number>;
}

function formatEarnings(v: number | null): string {
  if (!v || v <= 0) return '—';
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return '$' + Math.round(v / 1_000) + 'k';
  return '$' + v.toLocaleString('en-US');
}

const REGION_LABELS: Record<string, string> = {
  na1: 'NA', euw1: 'EUW', eun1: 'EUNE', kr: 'KR', jp1: 'JP',
  br1: 'BR', la1: 'LAN', la2: 'LAS', oc1: 'OCE', tr1: 'TR',
  ru: 'RU', vn2: 'VN', sg2: 'SG', tw2: 'TW', th2: 'TH', ph2: 'PH', me1: 'ME',
  // Non-Riot marker (Chinese-server pros, no puuid/riot_id — migration 0050).
  cn: 'CN',
};

// Classification → display config. Order here also drives tab order.
const TABS: { value: Classification | 'all'; labelKey: any; color: string; icon: string }[] = [
  { value: 'tpc',        labelKey: 'tft.pros.tab.tpc',        color: '#e0c75a', icon: '🏆' },
  { value: 'tournament', labelKey: 'tft.pros.tab.tournament', color: '#c39bff', icon: '🎯' },
  { value: 'streamer',   labelKey: 'tft.pros.tab.streamer',   color: '#3ecf8e', icon: '📺' },
  { value: 'historic',   labelKey: 'tft.pros.tab.historic',   color: 'var(--fg-muted)', icon: '📚' },
  { value: 'all',        labelKey: 'tft.pros.tab.all',        color: 'var(--fg-secondary)', icon: '∗' },
];

function classificationBadge(c: Classification) {
  switch (c) {
    case 'tpc':        return { label: 'TPC',        color: '#e0c75a', bg: '#e0c75a1f' };
    case 'tournament': return { label: 'Tournament', color: '#c39bff', bg: '#c39bff1f' };
    case 'streamer':   return { label: 'Streamer',   color: '#3ecf8e', bg: '#3ecf8e1f' };
    case 'historic':   return { label: 'Historic',   color: 'var(--fg-muted)', bg: '#7a8aa01f' };
    default:           return { label: '—',          color: 'var(--fg-faint)', bg: '#5a6a801f' };
  }
}

// Guard im Wrapper, damit die Hooks in ProsDirectory unbedingt bleiben
// (Rules of Hooks). Bei deaktiviertem Feature ist die Route per Deep-Link
// nicht mehr erreichbar; der Nav-Link ist ohnehin ausgeblendet.
export default function TftProsPage() {
  if (!TFT_PROS_ENABLED) notFound();
  return <ProsDirectory />;
}

function ProsDirectory() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Default tab from URL or "tpc"+"tournament" combined view ("verified").
  const initialTab = (searchParams.get('tab') as Classification | 'all') || 'verified' as any;
  const [tab, setTab] = useState<Classification | 'all' | 'verified'>(initialTab);
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState<string>(searchParams.get('region') || '');
  const [team, setTeam] = useState<string>(searchParams.get('team') || '');
  const [search, setSearch] = useState('');

  // Sync filter state into URL so refresh/share keeps the user's view.
  useEffect(() => {
    const next = new URLSearchParams();
    if (tab !== 'verified') next.set('tab', tab);
    if (region) next.set('region', region);
    if (team) next.set('team', team);
    const qs = next.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== url) {
      router.replace(url, { scroll: false });
    }
  }, [tab, region, team, pathname, router]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    // "verified" = tpc + tournament merged
    if (tab === 'verified') params.set('classification', 'tpc,tournament');
    else if (tab !== 'all') params.set('classification', tab);
    else params.set('classification', 'all');
    if (region) params.set('region', region);
    if (team) params.set('team', team);
    fetch(`/api/tft/pros?${params.toString()}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [tab, region, team]);

  // Client-side fuzzy search on top of server filters.
  const filteredPros = useMemo(() => {
    if (!data?.pros) return [];
    if (!search.trim()) return data.pros;
    const q = search.trim().toLowerCase();
    return data.pros.filter(p =>
      p.pro_name.toLowerCase().includes(q) ||
      (p.real_name?.toLowerCase().includes(q) ?? false) ||
      (p.team?.toLowerCase().includes(q) ?? false) ||
      (p.riot_id?.toLowerCase().includes(q) ?? false)
    );
  }, [data, search]);

  const regionOptions = useMemo(() => {
    if (!data?.regionCounts) return [];
    return Object.entries(data.regionCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => ({ code, count, label: REGION_LABELS[code] || code.toUpperCase() }));
  }, [data]);

  const teamOptions = useMemo(() => {
    if (!data?.teamCounts) return [];
    return Object.entries(data.teamCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([name, count]) => ({ name, count }));
  }, [data]);

  // Tab counts. "verified" = sum(tpc, tournament).
  const tabCount = (value: typeof TABS[number]['value'] | 'verified'): number => {
    if (!data?.classCounts) return 0;
    if (value === 'verified') return (data.classCounts.tpc || 0) + (data.classCounts.tournament || 0);
    if (value === 'all') return Object.values(data.classCounts).reduce((s, n) => s + n, 0);
    return data.classCounts[value] || 0;
  };

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="pros" />
      <TftHero pageTitle={t('tft.pros.title')} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        <p className="text-fg-secondary text-sm mb-4">{t('tft.pros.subtitle')}</p>

        {/* Tab strip — primary classification filter */}
        <div className="flex flex-wrap gap-1 mb-3 border-b border-border-subtle">
          <button
            onClick={() => setTab('verified')}
            className={`px-3 py-2 text-xs font-medium uppercase tracking-widest border-b-2 -mb-px ${
              tab === 'verified'
                ? 'text-white border-accent'
                : 'text-fg-secondary border-transparent hover:text-white'
            }`}
          >
            {t('tft.pros.tab.verified')}{' '}
            <span className="text-[10px] opacity-70 ml-0.5">{tabCount('verified')}</span>
          </button>
          {TABS.map(o => (
            <button
              key={o.value}
              onClick={() => setTab(o.value)}
              className={`px-3 py-2 text-xs font-medium uppercase tracking-widest border-b-2 -mb-px ${
                tab === o.value
                  ? 'text-white border-accent'
                  : 'text-fg-secondary border-transparent hover:text-white'
              }`}
            >
              <span style={{ color: tab === o.value ? o.color : undefined }}>{o.icon}</span>{' '}
              {t(o.labelKey)}{' '}
              <span className="text-[10px] opacity-70 ml-0.5">{tabCount(o.value)}</span>
            </button>
          ))}
        </div>

        {/* Region filter — only over the active tab */}
        {regionOptions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            <button
              onClick={() => setRegion('')}
              className={`px-2.5 py-1 rounded text-xs font-medium ${region === '' ? 'bg-accent text-white' : 'bg-surface-raised text-fg-secondary hover:text-white'}`}
            >
              {t('tft.filter.allRegions')}
            </button>
            {regionOptions.map(r => (
              <button
                key={r.code}
                onClick={() => setRegion(r.code)}
                className={`px-2.5 py-1 rounded text-xs font-medium ${region === r.code ? 'bg-accent text-white' : 'bg-surface-raised text-fg-secondary hover:text-white'}`}
              >
                {r.label} <span className="text-[10px] opacity-70">{r.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Team + Search */}
        <div className="flex flex-wrap gap-2 mb-4">
          <select
            value={team}
            onChange={e => setTeam(e.target.value)}
            className="bg-surface-raised border border-border-subtle rounded px-2 py-1 text-xs text-white outline-none"
          >
            <option value="">{t('tft.pros.allTeams')}</option>
            {teamOptions.map(t => (
              <option key={t.name} value={t.name}>{t.name} ({t.count})</option>
            ))}
          </select>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('tft.pros.searchPlaceholder')}
            className="flex-1 min-w-[180px] bg-surface-raised border border-border-subtle rounded px-3 py-1 text-xs text-white outline-none focus:border-accent-a60"
          />
        </div>

        {loading && (
          <div className="text-fg-muted text-center py-8">{t('tft.loading')}</div>
        )}

        {!loading && filteredPros.length === 0 && (
          <div className="bg-surface-base border border-border-subtle rounded p-6 text-center text-fg-secondary text-sm">
            {t('tft.pros.empty')}
          </div>
        )}

        {!loading && filteredPros.length > 0 && (
          <div className="bg-surface-base border border-border-subtle rounded overflow-hidden">
            <div className="grid grid-cols-[2.5rem_1fr_5.5rem_6rem_4rem_5rem_3rem] gap-2 px-4 py-2 text-[10px] uppercase text-fg-muted bg-surface-sunken">
              <div></div>
              <div>{t('tft.pros.col.player')}</div>
              <div>{t('tft.pros.col.classification')}</div>
              <div className="hidden sm:block">{t('tft.pros.col.team')}</div>
              <div className="hidden sm:block">{t('tft.pros.col.region')}</div>
              <div className="text-right">{t('tft.pros.col.earnings')}</div>
              <div></div>
            </div>
            {filteredPros.map(p => {
              // CN pros carry no Riot identity (riot_id/puuid NULL, region='cn')
              // — there is no player page to link to, so the row renders as a
              // plain (unlinked) anchor.
              const [gameName, tagLine] = (p.riot_id ?? '').split('#');
              const slug = p.riot_id
                ? `${encodeURIComponent(gameName)}--${encodeURIComponent(tagLine || p.region.replace(/\d+$/, '').toUpperCase())}`
                : null;
              const badge = classificationBadge(p.classification);
              const earningsSources = p.earnings_sources || {};
              const earningSourcesNonZero = Object.entries(earningsSources).filter(([, v]) => Number(v) > 0);
              const earningsTooltip = earningSourcesNonZero.length > 0
                ? earningSourcesNonZero.map(([src, v]) => `${src}: ${formatEarnings(Number(v))}`).join(' · ')
                : undefined;
              return (
                <a
                  key={p.puuid ?? p.pro_name}
                  href={slug ? `/tft/player/${slug}?region=${p.region}` : undefined}
                  className="grid grid-cols-[2.5rem_1fr_5.5rem_6rem_4rem_5rem_3rem] gap-2 px-4 py-2 items-center text-xs hover:bg-white/5 border-t border-border-subtle"
                >
                  <div className="flex-shrink-0">
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt=""
                        loading="lazy"
                        className="w-8 h-8 rounded-full object-cover bg-surface-raised border border-border-subtle"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-surface-raised border border-border-subtle flex items-center justify-center text-fg-muted text-[10px]">
                        {p.pro_name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-white font-medium truncate flex items-center gap-1.5">
                      {p.pro_name}
                      {p.tpc_verified && p.tpc_region && (
                        <span
                          className="text-[9px] px-1 rounded font-semibold tabular-nums"
                          style={{ color: '#e0c75a', backgroundColor: '#e0c75a1f', border: '1px solid #e0c75a40' }}
                          title={`TPC ${p.tpc_region}`}
                        >
                          {p.tpc_region}
                        </span>
                      )}
                    </div>
                    {(p.real_name || p.country) && (
                      <div className="text-fg-muted text-[10px] truncate">
                        {p.real_name}{p.real_name && p.country ? ' · ' : ''}{p.country}
                      </div>
                    )}
                  </div>
                  <div>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ color: badge.color, backgroundColor: badge.bg, border: `1px solid ${withAlpha(badge.color, 0x40)}` }}
                      title={`Confidence: ${p.confidence_score ?? 0}/100`}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <div className="hidden sm:block text-fg-secondary truncate">{p.team || '—'}</div>
                  <div className="hidden sm:block text-fg-secondary">{REGION_LABELS[p.region] || p.region.toUpperCase()}</div>
                  <div className="text-gold-earnings text-right tabular-nums" title={earningsTooltip}>
                    {formatEarnings(p.total_earnings_usd)}
                    {earningSourcesNonZero.length >= 2 && (
                      <span className="text-[8px] text-fg-muted ml-0.5" title={earningsTooltip}>•{earningSourcesNonZero.length}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-1.5 text-fg-muted">
                    {p.twitch_handle && (
                      <a
                        href={`https://twitch.tv/${p.twitch_handle}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="hover:text-[#a970ff]"
                        title={`Twitch: ${p.twitch_handle}`}
                      >
                        ▶
                      </a>
                    )}
                    {p.twitter_handle && (
                      <a
                        href={`https://x.com/${p.twitter_handle}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="hover:text-accent"
                        title={`X: ${p.twitter_handle}`}
                      >
                        𝕏
                      </a>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
