'use client';
import { useEffect, useMemo, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import { useI18n, LOCALE_MAP } from '../../lib/i18n';

// Tournament list page. Three top-level sections — Live / Upcoming / Past —
// each filterable by region + tier + set. The page mirrors /ligen for LoL
// but the data comes from Liquipedia via our crawler (not Riot Esports API)
// because TFT doesn't ship an official esports API.

interface Tournament {
  id: string;
  liquipedia_page: string;
  name: string;
  tier: string | null;          // 'S' | 'A' | 'B' | 'C'
  region: string | null;        // 'AMER' | 'EMEA' | 'APAC' | 'INT' | 'CN'
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
}

const TIER_COLORS: Record<string, string> = {
  S: '#e0c75a', A: '#7B61FF', B: '#3a8ddc', C: '#5a6a80',
};

const REGION_LABELS: Record<string, string> = {
  INT: 'International', AMER: 'Americas', EMEA: 'EMEA', APAC: 'Pacific', CN: 'China',
};

export default function TftTournamentsPage() {
  const { t, lang } = useI18n();
  const locale = LOCALE_MAP[lang];
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState<string>('');
  const [tier, setTier] = useState<string>('');
  const [set_, setSet] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (region) params.set('region', region);
    if (tier) params.set('tier', tier);
    if (set_) params.set('set', set_);
    fetch(`/api/tft/tournaments?${params.toString()}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setTournaments(d.tournaments || []); setLoading(false); } })
      .catch(() => { if (!cancelled) { setTournaments([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [region, tier, set_]);

  const live = useMemo(() => tournaments.filter(x => x.status === 'live'), [tournaments]);
  const upcoming = useMemo(() => tournaments.filter(x => x.status === 'upcoming'), [tournaments]);
  const past = useMemo(() => tournaments.filter(x => x.status === 'past'), [tournaments]);

  // Region/tier/set option sets — derived from the loaded data so we never
  // show a filter with zero matches behind it.
  const regionOptions = [...new Set(tournaments.map(x => x.region).filter(Boolean) as string[])];
  const tierOptions = [...new Set(tournaments.map(x => x.tier).filter(Boolean) as string[])].sort();
  const setOptions = [...new Set(tournaments.map(x => x.set_number).filter(Boolean) as number[])].sort((a, b) => b - a);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="tournaments" />
      <TftHero pageTitle={t('tft.tournaments.title')} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        <p className="text-[#8a9bb0] text-sm mb-4">{t('tft.tournaments.subtitle')}</p>

        {/* Filter bar — only renders rows that have ≥2 options so we don't
            crowd the layout with single-choice "filters". */}
        <div className="flex flex-wrap gap-2 mb-4">
          {regionOptions.length > 1 && (
            <select value={region} onChange={e => setRegion(e.target.value)} className="bg-[#141c2e] border border-[#1e2a3a] rounded px-2 py-1 text-xs text-white outline-none">
              <option value="">{t('tft.tournaments.allRegions')}</option>
              {regionOptions.map(r => <option key={r} value={r}>{REGION_LABELS[r] || r}</option>)}
            </select>
          )}
          {tierOptions.length > 1 && (
            <select value={tier} onChange={e => setTier(e.target.value)} className="bg-[#141c2e] border border-[#1e2a3a] rounded px-2 py-1 text-xs text-white outline-none">
              <option value="">{t('tft.tournaments.allTiers')}</option>
              {tierOptions.map(t2 => <option key={t2} value={t2}>{t2}-Tier</option>)}
            </select>
          )}
          {setOptions.length > 1 && (
            <select value={set_} onChange={e => setSet(e.target.value)} className="bg-[#141c2e] border border-[#1e2a3a] rounded px-2 py-1 text-xs text-white outline-none">
              <option value="">{t('tft.tournaments.allSets')}</option>
              {setOptions.map(s => <option key={s} value={String(s)}>Set {s}</option>)}
            </select>
          )}
        </div>

        {loading && <div className="text-[#4a5a70] text-center py-8">{t('tft.loading')}</div>}

        {!loading && tournaments.length === 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#8a9bb0] text-sm">
            {t('tft.tournaments.empty')}
          </div>
        )}

        {!loading && live.length > 0 && (
          <Section title={t('tft.tournaments.live')} accent="#e44040" pulse>
            {live.map(x => <TournamentRow key={x.id} t={x} locale={locale} />)}
          </Section>
        )}

        {!loading && upcoming.length > 0 && (
          <Section title={t('tft.tournaments.upcoming')} accent="#3ecf8e">
            {upcoming.map(x => <TournamentRow key={x.id} t={x} locale={locale} />)}
          </Section>
        )}

        {!loading && past.length > 0 && (
          <Section title={t('tft.tournaments.past')} accent="#8a9bb0">
            {past.map(x => <TournamentRow key={x.id} t={x} locale={locale} />)}
          </Section>
        )}
      </div>
      <Footer />
    </main>
  );
}

function Section({ title, accent, pulse, children }: { title: string; accent: string; pulse?: boolean; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="relative flex h-2 w-2">
          {pulse && <span className="absolute inset-0 rounded-full opacity-75 animate-ping" style={{ backgroundColor: accent }} />}
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: accent }} />
        </span>
        <h2 className="text-xs uppercase tracking-widest" style={{ color: accent }}>{title}</h2>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function TournamentRow({ t, locale }: { t: Tournament; locale: string }) {
  const tierColor = t.tier ? (TIER_COLORS[t.tier] || '#8a9bb0') : '#8a9bb0';
  const dateFmt = (s: string | null) => s ? new Date(s).toLocaleDateString(locale, { day: '2-digit', month: 'short' }) : '—';
  return (
    <a
      href={`/tft/tournaments/${encodeURIComponent(t.id)}`}
      className="block bg-[#0d1526] border border-[#1e2a3a] rounded p-3 sm:p-4 hover:border-[#7B61FF]/40 transition-colors"
    >
      <div className="flex items-start gap-3 flex-wrap">
        {/* Tier badge */}
        {t.tier && (
          <div
            className="flex items-center justify-center w-10 h-10 rounded font-bold text-base flex-shrink-0"
            style={{ color: tierColor, backgroundColor: `${tierColor}20`, border: `1px solid ${tierColor}55` }}
          >
            {t.tier}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white text-base font-medium truncate">{t.name}</span>
            {t.set_number && (
              <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#7B61FF]/15 text-[#7B61FF]">
                Set {t.set_number}
              </span>
            )}
            {t.region && (
              <span className="text-[10px] uppercase tracking-widest text-[#8a9bb0]">
                {REGION_LABELS[t.region] || t.region}
              </span>
            )}
          </div>
          <div className="text-[#8a9bb0] text-xs mt-1">
            {dateFmt(t.start_date)} – {dateFmt(t.end_date)}
            {t.format && ` · ${t.format}`}
            {t.num_participants && ` · ${t.num_participants} Teilnehmer`}
          </div>
        </div>
        {t.prize_pool_usd != null && (
          <div className="text-right">
            <div className="text-[#7B61FF] text-base font-semibold tabular-nums">
              ${t.prize_pool_usd.toLocaleString('en-US')}
            </div>
            <div className="text-[#4a5a70] text-[10px] uppercase tracking-widest">Prize Pool</div>
          </div>
        )}
      </div>
    </a>
  );
}
