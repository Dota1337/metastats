'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import MatchCard from '../../../components/tft/MatchCard';
import { useI18n } from '../../../lib/i18n';
import { loadTftSetMeta } from '../../../lib/tft-dd-assets';
import { loadTftAssets, tftIconUrl, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { formatTier } from '../../../lib/rank-format';
import type { TftMatchSummary } from '../../../lib/tft-match-processor';

interface SummonerData {
  summoner: { name: string; puuid: string; profileIconId: number | null; summonerLevel: number | null; tier: string | null; rank: string | null };
  ranked: { tier?: string; rank?: string; leaguePoints?: number; wins?: number; losses?: number } | null;
  matchIds: string[];
  region: string;
}

interface PlayerStats {
  hasStats: boolean;
  set?: number | null;
  totalMatches: number;
  sampledMatches?: number;
  avgPlacement?: number;
  top4Rate?: number;
  top1Rate?: number;
  topUnits?: { characterId: string; games: number; avgPlacement: number; top4Rate: number }[];
  topAugments?: { apiName: string; games: number; avgPlacement: number; top4Rate: number }[];
  topTraits?: { key: string; games: number; avgPlacement: number; top4Rate: number }[];
}

const TIER_COLORS: Record<string, string> = {
  IRON: '#6b6b6b', BRONZE: '#a0652a', SILVER: '#8fa0a8', GOLD: '#c89b3c',
  PLATINUM: '#209e85', EMERALD: '#00a86b', DIAMOND: '#576cce',
  MASTER: '#9d48e0', GRANDMASTER: '#e44040', CHALLENGER: '#f0c040',
};

const PAGE_SIZE = 30;

export default function TftPlayerPage() {
  const { t } = useI18n();
  const params = useParams();
  const searchParams = useSearchParams();
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const slug = decodeURIComponent(String(params?.slug || ''));
  // Accept both `Caps#EUW` and `Caps--EUW` (URL-safe)
  const [gameName, tagLine] = slug.includes('--')
    ? slug.split('--').map(decodeURIComponent)
    : slug.split('#').map(decodeURIComponent);
  const fullName = `${gameName}${tagLine ? '#' + tagLine : ''}`;

  const [data, setData] = useState<SummonerData | null>(null);
  // Match summaries keyed by matchId — populated lazily per page.
  const [matchCache, setMatchCache] = useState<Record<string, TftMatchSummary>>({});
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ddVersion, setDdVersion] = useState('');
  const [currentSet, setCurrentSet] = useState<number | null>(null);
  // null = all sets, number = filter on that set
  const [selectedSet, setSelectedSet] = useState<number | null>(null);
  const [setManuallyPicked, setSetManuallyPicked] = useState(false);
  const [page, setPage] = useState(0); // 0..3 for 4 pages of 30

  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => {
    fetch('https://ddragon.leagueoflegends.com/api/versions.json')
      .then(r => r.json())
      .then(v => setDdVersion(v[0]))
      .catch(() => {});
    loadTftSetMeta().then(meta => { if (meta) setCurrentSet(meta.setNumber); });
    loadTftAssets().then(setAssets);
  }, []);

  // Summoner data + the 120 match IDs.
  useEffect(() => {
    if (!gameName) return;
    setLoading(true);
    setError(null);
    setPage(0);
    setMatchCache({});
    fetch(`/api/tft/summoner?name=${encodeURIComponent(fullName)}&region=${region}`)
      .then(async r => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d: SummonerData) => {
        setData(d);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [fullName, gameName, region]);

  // Season stats — runs in the background so it doesn't block match-history.
  // Stats survey ~200 most recent matches and may take 5-10s wall time.
  useEffect(() => {
    if (!data?.summoner.puuid) return;
    setStatsLoading(true);
    fetch(`/api/tft/player-stats?puuid=${data.summoner.puuid}&region=${region}`)
      .then(r => r.ok ? r.json() : null)
      .then((s: PlayerStats | null) => { setPlayerStats(s); setStatsLoading(false); })
      .catch(() => setStatsLoading(false));
  }, [data?.summoner.puuid, region]);

  // Page IDs for the current pagination slice.
  const currentPageIds = useMemo(() => {
    if (!data) return [];
    return data.matchIds.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }, [data, page]);

  // Lazy-load match details for the current page if not already cached.
  useEffect(() => {
    if (currentPageIds.length === 0) return;
    const missing = currentPageIds.filter(id => !matchCache[id]);
    if (missing.length === 0) return;
    setPageLoading(true);
    fetch(`/api/tft/matches?ids=${missing.join(',')}&region=${region}`)
      .then(r => r.ok ? r.json() : { matches: [] })
      .then(m => {
        setMatchCache(prev => {
          const next = { ...prev };
          for (const s of m.matches || []) next[s.matchId] = s;
          return next;
        });
        setPageLoading(false);
      })
      .catch(() => setPageLoading(false));
  }, [currentPageIds.join(','), region]);

  // Available sets from loaded match details (newest first).
  const availableSets = useMemo(() => {
    const set = new Set<number>();
    for (const m of Object.values(matchCache)) if (typeof m.setNumber === 'number') set.add(m.setNumber);
    return [...set].sort((a, b) => b - a);
  }, [matchCache]);

  // Auto-pick a sensible default set when matches first load.
  useEffect(() => {
    if (setManuallyPicked || availableSets.length === 0) return;
    if (currentSet != null && availableSets.includes(currentSet)) {
      setSelectedSet(currentSet);
    } else {
      const counts: Record<number, number> = {};
      for (const m of Object.values(matchCache)) if (m.setNumber != null) counts[m.setNumber] = (counts[m.setNumber] || 0) + 1;
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      setSelectedSet(top ? Number(top[0]) : null);
    }
  }, [availableSets, currentSet, matchCache, setManuallyPicked]);

  // Page summaries: ordered by the matchId sequence, filtered by set.
  const pageMatches = useMemo(() => {
    const out: TftMatchSummary[] = [];
    for (const id of currentPageIds) {
      const m = matchCache[id];
      if (!m) continue;
      if (selectedSet != null && m.setNumber !== selectedSet) continue;
      out.push(m);
    }
    return out;
  }, [currentPageIds, matchCache, selectedSet]);

  const totalPages = Math.ceil((data?.matchIds.length || 0) / PAGE_SIZE);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="search" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {loading && <div className="text-[#8a9bb0] text-center py-12">Lade Spieler-Daten ...</div>}

        {error && (
          <div className="bg-[#0d1526] border border-red-500/40 rounded p-6 text-center">
            <div className="text-red-400 font-medium mb-1">Fehler</div>
            <div className="text-[#8a9bb0] text-sm">{error}</div>
          </div>
        )}

        {data && (
          <>
            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5">
              <div className="flex items-center gap-4 flex-wrap">
                {ddVersion && data.summoner.profileIconId != null && (
                  <img
                    src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${data.summoner.profileIconId}.png`}
                    alt=""
                    className="w-16 h-16 rounded-lg border-2 border-[#7B61FF]"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-white text-xl font-medium">{gameName}</div>
                  <div className="text-[#8a9bb0] text-sm">#{tagLine} · Level {data.summoner.summonerLevel ?? '—'}</div>
                </div>
                <RankBlock ranked={data.ranked} />
              </div>
            </div>

            <SeasonStats stats={playerStats} loading={statsLoading} currentSet={currentSet} assets={assets} />

            {availableSets.length > 0 && (
              <div className="flex items-center justify-between mb-3">
                <div className="text-[#8a9bb0] text-xs uppercase tracking-widest">
                  Match History
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[#4a5a70] text-xs">{t('tft.set')}:</span>
                  <select
                    value={selectedSet == null ? 'all' : String(selectedSet)}
                    onChange={e => {
                      const v = e.target.value;
                      setSetManuallyPicked(true);
                      setSelectedSet(v === 'all' ? null : Number(v));
                    }}
                    className="bg-[#141c2e] border border-[#1e2a3a] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#7B61FF]/60"
                  >
                    {availableSets.map(s => (
                      <option key={s} value={s}>
                        Set {s}{s === currentSet ? ` · ${t('tft.currentSet')}` : ''}
                      </option>
                    ))}
                    <option value="all">{t('tft.allSets')}</option>
                  </select>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {pageLoading && pageMatches.length === 0 && (
                <div className="text-[#4a5a70] text-center py-8">Lade Match-History ...</div>
              )}
              {!pageLoading && data.matchIds.length === 0 && (
                <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#8a9bb0] text-sm">
                  Keine Standard-Ranked-Matches gefunden.
                </div>
              )}
              {!pageLoading && data.matchIds.length > 0 && pageMatches.length === 0 && (
                <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#8a9bb0] text-sm">
                  {t('tft.noMatchesForSet')}
                </div>
              )}
              {pageMatches.map(m => (
                <MatchCard key={m.matchId} match={m} selfPuuid={data.summoner.puuid} ddVersion={ddVersion} />
              ))}
            </div>

            {totalPages > 1 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                onChange={p => setPage(p)}
                loading={pageLoading}
              />
            )}
          </>
        )}
      </div>
      <Footer />
    </main>
  );
}

function Pagination({ page, totalPages, onChange, loading }: { page: number; totalPages: number; onChange: (p: number) => void; loading: boolean }) {
  return (
    <div className="flex items-center justify-center gap-2 mt-5 text-xs">
      <button
        onClick={() => onChange(Math.max(0, page - 1))}
        disabled={page === 0 || loading}
        className="px-3 py-1.5 rounded bg-[#141c2e] border border-[#1e2a3a] text-[#8a9bb0] hover:text-white hover:border-[#7B61FF]/40 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ← Zurück
      </button>
      <div className="flex items-center gap-1">
        {Array.from({ length: totalPages }, (_, i) => (
          <button
            key={i}
            onClick={() => onChange(i)}
            disabled={loading}
            className={`w-8 h-8 rounded text-xs font-medium ${
              i === page
                ? 'bg-[#7B61FF] text-white'
                : 'bg-[#141c2e] border border-[#1e2a3a] text-[#8a9bb0] hover:text-white'
            }`}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <button
        onClick={() => onChange(Math.min(totalPages - 1, page + 1))}
        disabled={page >= totalPages - 1 || loading}
        className="px-3 py-1.5 rounded bg-[#141c2e] border border-[#1e2a3a] text-[#8a9bb0] hover:text-white hover:border-[#7B61FF]/40 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Weiter →
      </button>
    </div>
  );
}

function SeasonStats({ stats, loading, currentSet, assets }: { stats: PlayerStats | null; loading: boolean; currentSet: number | null; assets: TftAssetsBundle | null }) {
  if (loading && !stats) {
    return (
      <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5">
        <div className="text-[#4a5a70] text-xs uppercase tracking-widest mb-3">
          Saison-Statistik{currentSet != null ? ` · Set ${currentSet}` : ''}
        </div>
        <div className="text-[#4a5a70] text-sm">Berechne aus letzten ~200 Matches ...</div>
      </div>
    );
  }
  if (!stats?.hasStats) return null;

  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[#4a5a70] text-xs uppercase tracking-widest">
          Saison-Statistik{stats.set != null ? ` · Set ${stats.set}` : ''}
        </div>
        <div className="text-[#4a5a70] text-[10px]">
          n = {stats.totalMatches} Matches
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Ø Platzierung" value={stats.avgPlacement?.toFixed(2) ?? '—'} />
        <Stat label="Top 4" value={stats.top4Rate != null ? `${(stats.top4Rate * 100).toFixed(1)}%` : '—'} />
        <Stat label="Sieg" value={stats.top1Rate != null ? `${(stats.top1Rate * 100).toFixed(1)}%` : '—'} />
        <Stat label="Spiele" value={String(stats.totalMatches)} />
      </div>

      {stats.topUnits && stats.topUnits.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TopList title="Meist-gespielte Units" entries={stats.topUnits.map(u => ({
            key: u.characterId,
            label: assets?.champions[u.characterId]?.name || u.characterId.replace(/^TFT\d+_/, ''),
            icon: assets ? tftIconUrl(assets, assets.champions[u.characterId]?.icon) : null,
            games: u.games,
            avg: u.avgPlacement,
          }))} />
          {stats.topAugments && stats.topAugments.length > 0 && (
            <TopList title="Lieblings-Augments" entries={stats.topAugments.map(a => ({
              key: a.apiName,
              label: assets?.augments[a.apiName]?.name || a.apiName.replace(/^TFT\d+_Augment_/, ''),
              icon: assets ? tftIconUrl(assets, assets.augments[a.apiName]?.icon) : null,
              games: a.games,
              avg: a.avgPlacement,
            }))} />
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0a0e1a] border border-[#1e2a3a] rounded px-3 py-2">
      <div className="text-[#4a5a70] text-[10px] uppercase tracking-widest">{label}</div>
      <div className="text-white text-xl font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function TopList({ title, entries }: { title: string; entries: { key: string; label: string; icon: string | null; games: number; avg: number }[] }) {
  return (
    <div>
      <div className="text-[#4a5a70] text-[10px] uppercase tracking-widest mb-1.5">{title}</div>
      <div className="space-y-1">
        {entries.map(e => (
          <div key={e.key} className="flex items-center gap-2 bg-[#0a0e1a] border border-[#1e2a3a] rounded px-2 py-1.5">
            {e.icon ? (
              <img src={e.icon} alt={e.label} className="w-6 h-6 rounded flex-shrink-0" />
            ) : (
              <div className="w-6 h-6 rounded bg-[#1e2a3a] flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-white text-xs truncate">{e.label}</div>
              <div className="text-[#4a5a70] text-[10px]">{e.games}g · Ø {e.avg.toFixed(2)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RankBlock({ ranked }: { ranked: SummonerData['ranked'] }) {
  if (!ranked || !ranked.tier) {
    return (
      <div className="text-right">
        <div className="text-[#4a5a70] text-xs uppercase tracking-widest">Standard Ranked</div>
        <div className="text-[#8a9bb0] text-sm mt-1">Unranked</div>
      </div>
    );
  }
  const color = TIER_COLORS[ranked.tier] || '#8a9bb0';
  const wr = (ranked.wins ?? 0) + (ranked.losses ?? 0) > 0
    ? Math.round(((ranked.wins ?? 0) / ((ranked.wins ?? 0) + (ranked.losses ?? 0))) * 100)
    : null;
  return (
    <div className="text-right">
      <div className="text-[#4a5a70] text-xs uppercase tracking-widest">Standard Ranked</div>
      <div className="text-lg font-medium mt-1" style={{ color }}>
        {formatTier(ranked.tier, ranked.rank)} <span className="text-white">{ranked.leaguePoints ?? 0} LP</span>
      </div>
      <div className="text-[#4a5a70] text-xs">
        {ranked.wins ?? 0}W {ranked.losses ?? 0}L{wr != null && <> · {wr}% WR</>}
      </div>
    </div>
  );
}
