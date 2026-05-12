'use client';
import { useEffect, useMemo, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import { useI18n } from '../../lib/i18n';

// TFT pro player directory. Sourced from Liquipedia (primary) + manual
// streamer allowlist (fallback). The page joins by puuid to whatever data
// we already have for the player on the TFT side (match cache, marketvalue
// snapshot) so each row also links to their full profile.

interface Pro {
  puuid: string;
  pro_name: string;
  real_name: string | null;
  region: string;
  riot_id: string;
  team: string | null;
  role: string | null;
  country: string | null;
  source: 'liquipedia' | 'manual';
  twitch_handle: string | null;
  twitter_handle: string | null;
}

interface Response {
  pros: Pro[];
  regionCounts: Record<string, number>;
  teamCounts: Record<string, number>;
}

// Region selector mirrors /tft/marktwert. We show only regions that
// actually have pros — derived from the aggregates response.
const REGION_LABELS: Record<string, string> = {
  na1: 'NA', euw1: 'EUW', eun1: 'EUNE', kr: 'KR', jp1: 'JP',
  br1: 'BR', la1: 'LAN', la2: 'LAS', oc1: 'OCE', tr1: 'TR',
  ru: 'RU', vn2: 'VN', sg2: 'SG', tw2: 'TW', th2: 'TH', ph2: 'PH', me1: 'ME',
};

export default function TftProsPage() {
  const { t } = useI18n();
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState<string>('');
  const [team, setTeam] = useState<string>('');
  const [role, setRole] = useState<string>('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (region) params.set('region', region);
    if (team) params.set('team', team);
    if (role) params.set('role', role);
    fetch(`/api/tft/pros?${params.toString()}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [region, team, role]);

  // Client-side fuzzy search on top of the server filters. We never round-
  // trip for substring matches — the pro list is small enough (<1000) that
  // local filtering stays instant.
  const filteredPros = useMemo(() => {
    if (!data?.pros) return [];
    if (!search.trim()) return data.pros;
    const q = search.trim().toLowerCase();
    return data.pros.filter(p =>
      p.pro_name.toLowerCase().includes(q) ||
      (p.real_name?.toLowerCase().includes(q) ?? false) ||
      (p.team?.toLowerCase().includes(q) ?? false) ||
      p.riot_id.toLowerCase().includes(q)
    );
  }, [data, search]);

  // Region buttons: only show ones that actually have pros, sorted by count.
  const regionOptions = useMemo(() => {
    if (!data?.regionCounts) return [];
    return Object.entries(data.regionCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => ({ code, count, label: REGION_LABELS[code] || code.toUpperCase() }));
  }, [data]);

  // Top teams by pro count for the dropdown — capped at 30 so the
  // selector stays usable on smaller screens.
  const teamOptions = useMemo(() => {
    if (!data?.teamCounts) return [];
    return Object.entries(data.teamCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([name, count]) => ({ name, count }));
  }, [data]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="search" />
      <TftHero pageTitle={t('tft.pros.title')} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        <p className="text-[#8a9bb0] text-sm mb-4">{t('tft.pros.subtitle')}</p>

        {/* Region filter */}
        {regionOptions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            <button
              onClick={() => setRegion('')}
              className={`px-2.5 py-1 rounded text-xs font-medium ${region === '' ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'}`}
            >
              {t('tft.filter.allRegions')}
            </button>
            {regionOptions.map(r => (
              <button
                key={r.code}
                onClick={() => setRegion(r.code)}
                className={`px-2.5 py-1 rounded text-xs font-medium ${region === r.code ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'}`}
              >
                {r.label} <span className="text-[10px] opacity-70">{r.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Team + Role selectors + Search */}
        <div className="flex flex-wrap gap-2 mb-4">
          <select
            value={team}
            onChange={e => setTeam(e.target.value)}
            className="bg-[#141c2e] border border-[#1e2a3a] rounded px-2 py-1 text-xs text-white outline-none"
          >
            <option value="">{t('tft.pros.allTeams')}</option>
            {teamOptions.map(t => (
              <option key={t.name} value={t.name}>{t.name} ({t.count})</option>
            ))}
          </select>
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            className="bg-[#141c2e] border border-[#1e2a3a] rounded px-2 py-1 text-xs text-white outline-none"
          >
            <option value="">{t('tft.pros.allRoles')}</option>
            <option value="Player">Player</option>
            <option value="Streamer">Streamer</option>
            <option value="Coach">Coach</option>
            <option value="Caster">Caster</option>
          </select>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('tft.pros.searchPlaceholder')}
            className="flex-1 min-w-[180px] bg-[#141c2e] border border-[#1e2a3a] rounded px-3 py-1 text-xs text-white outline-none focus:border-[#7B61FF]/60"
          />
        </div>

        {loading && (
          <div className="text-[#4a5a70] text-center py-8">{t('tft.loading')}</div>
        )}

        {!loading && filteredPros.length === 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#8a9bb0] text-sm">
            {t('tft.pros.empty')}
          </div>
        )}

        {!loading && filteredPros.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
            <div className="grid grid-cols-[1fr_8rem_7rem_6rem_3rem] gap-2 px-4 py-2 text-[10px] uppercase text-[#4a5a70] bg-[#0a0e1a]">
              <div>{t('tft.pros.col.player')}</div>
              <div className="hidden sm:block">{t('tft.pros.col.team')}</div>
              <div className="hidden sm:block">{t('tft.pros.col.role')}</div>
              <div className="hidden sm:block">{t('tft.pros.col.region')}</div>
              <div></div>
            </div>
            {filteredPros.map(p => {
              const [gameName, tagLine] = p.riot_id.split('#');
              const slug = `${encodeURIComponent(gameName)}--${encodeURIComponent(tagLine || p.region.replace(/\d+$/, '').toUpperCase())}`;
              return (
                <a
                  key={p.puuid}
                  href={`/tft/player/${slug}?region=${p.region}`}
                  className="grid grid-cols-[1fr_8rem_7rem_6rem_3rem] gap-2 px-4 py-2 items-center text-xs hover:bg-white/5 border-t border-[#1e2a3a]"
                >
                  <div className="min-w-0">
                    <div className="text-white font-medium truncate">{p.pro_name}</div>
                    {(p.real_name || p.country) && (
                      <div className="text-[#4a5a70] text-[10px] truncate">
                        {p.real_name}{p.real_name && p.country ? ' · ' : ''}{p.country}
                      </div>
                    )}
                  </div>
                  <div className="hidden sm:block text-[#8a9bb0] truncate">{p.team || '—'}</div>
                  <div className="hidden sm:block text-[#8a9bb0] truncate">{p.role || '—'}</div>
                  <div className="hidden sm:block text-[#8a9bb0]">{REGION_LABELS[p.region] || p.region.toUpperCase()}</div>
                  <div className="flex items-center justify-end gap-1.5 text-[#4a5a70]">
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
                        className="hover:text-[#7B61FF]"
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
