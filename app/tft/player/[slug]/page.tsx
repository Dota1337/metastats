'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar,
  BarChart, Bar, XAxis, YAxis, Tooltip,
} from 'recharts';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import MatchCard from '../../../components/tft/MatchCard';
import MarketValueHero from '../../../components/tft/MarketValueHero';
import BookmarkButton from '../../../components/BookmarkButton';
import { useI18n } from '../../../lib/i18n';
import { formatStage } from '../../../lib/tft-stage';
import { loadProLookup, lookupPro, type ProPlayer } from '../../../lib/pro-players';

interface TftTournamentResult {
  tournament: string;
  date: string;
  place: string | null;
  prize_usd: number;
  tier: string | null;
  page: string | null;
}

interface TftProRecord {
  pro_name: string;
  real_name: string | null;
  team: string | null;
  role: string | null;
  country: string | null;
  source: string;
  twitch_handle: string | null;
  twitter_handle: string | null;
  image_url?: string | null;
  total_earnings_usd?: number | null;
  tournament_results?: TftTournamentResult[] | null;
}
import { loadTftSetMeta } from '../../../lib/tft-dd-assets';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { formatTier } from '../../../lib/rank-format';
import type { TftMatchSummary } from '../../../lib/tft-match-processor';

interface SummonerData {
  summoner: { name: string; puuid: string; profileIconId: number | null; summonerLevel: number | null; tier: string | null; rank: string | null };
  ranked: { tier?: string; rank?: string; leaguePoints?: number; wins?: number; losses?: number } | null;
  matchIds: string[];
  region: string;
}

interface SeasonRank {
  set_number: number;
  set_label: string | null;
  queue_id: number;
  peak_tier: string | null;
  peak_division: string | null;
  peak_lp: number | null;
  peak_rating_label: string | null;
  total_games: number | null;
  source: string;
}

interface PlayerStats {
  hasStats: boolean;
  set?: number | null;
  currentSet?: number | null;
  availableSets?: number[];
  seasonRanks?: SeasonRank[];
  totalMatches: number;
  sampledMatches?: number;
  inSetMatches?: number;
  rankedSoloInSet?: number;
  totalHistoryIds?: number;
  avgPlacement?: number;
  top4Rate?: number;
  top1Rate?: number;
  placementDistribution?: number[];
  averages?: {
    level: number;
    goldLeft: number;
    eliminations: number;
    damage: number;
    lastRound: number;
  };
  scores?: {
    tempo: number;
    aggression: number;
    damage: number;
    survival: number;
    consistency: number;
  };
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
  const { t, lang } = useI18n();
  const params = useParams();
  const searchParams = useSearchParams();
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const slug = decodeURIComponent(String(params?.slug || ''));
  const [gameName, tagLine] = slug.includes('--')
    ? slug.split('--').map(decodeURIComponent)
    : slug.split('#').map(decodeURIComponent);
  const fullName = `${gameName}${tagLine ? '#' + tagLine : ''}`;

  const [data, setData] = useState<SummonerData | null>(null);
  const [matchCache, setMatchCache] = useState<Record<string, TftMatchSummary>>({});
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ddVersion, setDdVersion] = useState('');
  const [currentSet, setCurrentSet] = useState<number | null>(null);
  const [selectedSet, setSelectedSet] = useState<number | null>(null);
  const [setManuallyPicked, setSetManuallyPicked] = useState(false);
  const [page, setPage] = useState(0);

  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  // Lobby Master+ avg-placement per champion — lets the UI show how the
  // player's results on Champion X compare to the rest of the lobby pool.
  // Computed once per region from /api/tft/units and reused for every chip.
  const [lobbyAvgByUnit, setLobbyAvgByUnit] = useState<Record<string, number>>({});
  // null = follow current set; set to a specific number when the user picks
  // a different set in the SeasonStats pill bar.
  const [statsSetOverride, setStatsSetOverride] = useState<number | null>(null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [proInfo, setProInfo] = useState<ProPlayer | null>(null);
  const [tftProInfo, setTftProInfo] = useState<TftProRecord | null>(null);

  useEffect(() => {
    fetch('https://ddragon.leagueoflegends.com/api/versions.json')
      .then(r => r.json()).then(v => setDdVersion(v[0])).catch(() => {});
    loadTftSetMeta().then(meta => { if (meta) setCurrentSet(meta.setNumber); });
    loadTftAssets().then(setAssets);
    // Pro-Lookup against the LoL-Liquipedia JSON. Quick name-based match;
    // gets overridden by the TFT-native lookup below if that one finds a
    // hit (TFT-native carries source provenance + tournament data).
    loadProLookup().then(lookup => {
      const pro = lookupPro(lookup, fullName);
      if (pro) setProInfo(pro);
    });
  }, [fullName]);

  // TFT-native pro lookup: keyed by puuid which we only know after the
  // summoner fetch resolves. Runs in parallel with stats once that's done.
  useEffect(() => {
    if (!data?.summoner.puuid) return;
    let cancelled = false;
    fetch(`/api/tft/pros?puuid=${data.summoner.puuid}`)
      .then(r => r.ok ? r.json() : { pro: null })
      .then(d => { if (!cancelled) setTftProInfo(d.pro || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [data?.summoner.puuid]);

  useEffect(() => {
    if (!gameName) return;
    setLoading(true);
    setError(null);
    setPage(0);
    setMatchCache({});
    fetch(`/api/tft/summoner?name=${encodeURIComponent(fullName)}&region=${region}`)
      .then(async r => {
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
        return r.json();
      })
      .then((d: SummonerData) => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [fullName, gameName, region]);

  useEffect(() => {
    if (!data?.summoner.puuid) return;
    setStatsLoading(true);
    const setQuery = statsSetOverride != null ? `&set=${statsSetOverride}` : '';
    fetch(`/api/tft/player-stats?puuid=${data.summoner.puuid}&region=${region}${setQuery}`)
      .then(r => r.ok ? r.json() : null)
      .then((s: PlayerStats | null) => { setPlayerStats(s); setStatsLoading(false); })
      .catch(() => setStatsLoading(false));
  }, [data?.summoner.puuid, region, statsSetOverride]);

  // Lobby-baseline fetch — Master+ avg-placement per champion in the
  // player's region. Hits the edge-cached /api/tft/units so it's a single
  // round-trip per region+bucket.
  useEffect(() => {
    if (!region) return;
    fetch(`/api/tft/units?region=${region}&bucket=master_plus&days=7&patch=current`)
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        const map: Record<string, number> = {};
        for (const u of (j?.units || [])) {
          if (u.characterId && typeof u.avgPlacement === 'number') {
            map[u.characterId] = u.avgPlacement;
          }
        }
        setLobbyAvgByUnit(map);
      })
      .catch(() => {});
  }, [region]);

  const currentPageIds = useMemo(() => {
    if (!data) return [];
    return data.matchIds.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }, [data, page]);

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

  // Match-history set list = union of sets we see in the loaded match-card
  // batch + sets the player-stats endpoint reports cached. The stats-endpoint
  // list is broader since it walks every cached match, not just the current
  // pagination window.
  const availableSets = useMemo(() => {
    const set = new Set<number>();
    for (const m of Object.values(matchCache)) if (typeof m.setNumber === 'number') set.add(m.setNumber);
    for (const s of playerStats?.availableSets || []) set.add(s);
    return [...set].sort((a, b) => b - a);
  }, [matchCache, playerStats?.availableSets]);

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
        {loading && <div className="text-[#a0b0c5] text-center py-12">Lade Spieler-Daten ...</div>}

        {error && (
          <div className="bg-[#0d1526] border border-red-500/40 rounded p-6 text-center">
            <div className="text-red-400 font-medium mb-1">Fehler</div>
            <div className="text-[#a0b0c5] text-sm">{error}</div>
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white text-xl font-medium">{gameName}</span>
                    {/* TFT-native pro record wins if both sources match —
                        it's puuid-verified, not just name-matched. */}
                    {tftProInfo ? <TftProBadge pro={tftProInfo} /> : proInfo && <ProBadge pro={proInfo} />}
                    {gameName && tagLine && (
                      <BookmarkButton
                        type="player"
                        bookmarkKey={`${gameName}-${tagLine}`}
                        label={`${gameName}#${tagLine}`}
                        region={region}
                        size="md"
                        stopPropagation={false}
                      />
                    )}
                  </div>
                  <div className="text-[#a0b0c5] text-sm">#{tagLine} · Level {data.summoner.summonerLevel ?? '—'}</div>
                  {tftProInfo && (
                    <div className="text-[#a892ff] text-xs mt-0.5">
                      {tftProInfo.pro_name}
                      {tftProInfo.team && ` · ${tftProInfo.team}`}
                      {tftProInfo.role && ` · ${tftProInfo.role}`}
                      {tftProInfo.country && ` · ${tftProInfo.country}`}
                    </div>
                  )}
                  {!tftProInfo && proInfo && (
                    <div className="text-[#a892ff] text-xs mt-0.5">
                      {proInfo.proName} · {proInfo.team} · {proInfo.role}
                    </div>
                  )}
                </div>
                <RankBlock ranked={data.ranked} seasonRanks={playerStats?.seasonRanks} />
              </div>
            </div>

            {tftProInfo && <TournamentHistory pro={tftProInfo} />}
            {tftProInfo && data.summoner.puuid && (
              <ProSpecialty puuid={data.summoner.puuid} setNumber={currentSet} assets={assets} t={t} />
            )}

            <MarketValueHero fullName={fullName} region={region} lang={lang} />

            <SeasonStats
              stats={playerStats}
              loading={statsLoading}
              currentSet={currentSet}
              selectedSet={statsSetOverride}
              onPickSet={setStatsSetOverride}
              assets={assets}
              lobbyAvgByUnit={lobbyAvgByUnit}
            />

            <div className="mb-3">
              <div className="text-[#a0b0c5] text-xs uppercase tracking-widest">Match History</div>
            </div>

            <div className="space-y-3">
              {pageLoading && pageMatches.length === 0 && (
                <div className="text-[#7a8aa0] text-center py-8">Lade Match-History ...</div>
              )}
              {!pageLoading && data.matchIds.length === 0 && (
                <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#a0b0c5] text-sm">
                  Keine Standard-Ranked-Matches gefunden.
                </div>
              )}
              {!pageLoading && data.matchIds.length > 0 && pageMatches.length === 0 && (
                <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#a0b0c5] text-sm">
                  {t('tft.noMatchesForSet')}
                </div>
              )}
              {pageMatches.map(m => (
                <MatchCard key={m.matchId} match={m} selfPuuid={data.summoner.puuid} ddVersion={ddVersion} region={region} />
              ))}
            </div>

            {totalPages > 1 && (
              <Pagination page={page} totalPages={totalPages} onChange={p => setPage(p)} loading={pageLoading} />
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
        className="px-3 py-1.5 rounded bg-[#141c2e] border border-[#1e2a3a] text-[#a0b0c5] hover:text-white hover:border-[#7B61FF]/40 disabled:opacity-40 disabled:cursor-not-allowed"
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
              i === page ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] border border-[#1e2a3a] text-[#a0b0c5] hover:text-white'
            }`}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <button
        onClick={() => onChange(Math.min(totalPages - 1, page + 1))}
        disabled={page >= totalPages - 1 || loading}
        className="px-3 py-1.5 rounded bg-[#141c2e] border border-[#1e2a3a] text-[#a0b0c5] hover:text-white hover:border-[#7B61FF]/40 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Weiter →
      </button>
    </div>
  );
}

function SeasonStats({
  stats, loading, currentSet, selectedSet, onPickSet, assets, lobbyAvgByUnit,
}: {
  stats: PlayerStats | null;
  loading: boolean;
  currentSet: number | null;
  selectedSet: number | null;
  onPickSet: (s: number | null) => void;
  assets: TftAssetsBundle | null;
  lobbyAvgByUnit?: Record<string, number>;
}) {
  const { t } = useI18n();
  const activeSet = stats?.set ?? selectedSet ?? currentSet;

  if (loading && !stats) {
    return (
      <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5">
        <div className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">
          Saison-Statistik{activeSet != null ? ` · Set ${activeSet}` : ''}
        </div>
        <div className="text-[#a0b0c5] text-sm">Berechne aus allen Saison-Matches ...</div>
      </div>
    );
  }

  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-5 mb-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="text-[#a0b0c5] text-xs uppercase tracking-widest">
          Saison-Statistik{activeSet != null ? ` · Set ${activeSet}` : ''}
        </div>
      </div>

      {!stats?.hasStats ? (
        <div className="text-[#a0b0c5] text-sm py-4 text-center">
          Keine Solo-Ranked-Matches für Set {activeSet} im Cache.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Stat label={t('tft.avgPlacement')} value={stats.avgPlacement?.toFixed(2) ?? '—'} />
            <Stat label={t('tft.top4')} value={stats.top4Rate != null ? `${(stats.top4Rate * 100).toFixed(1)}%` : '—'} />
            <Stat label={t('tft.top1')} value={stats.top1Rate != null ? `${(stats.top1Rate * 100).toFixed(1)}%` : '—'} />
            <Stat label={t('tft.gamesShort')} value={String(stats.totalMatches)} />
          </div>

          {/* Top units: 3 column-blocks across the card's full width, each
              block holding 5 chips top-to-bottom (1-5 / 6-10 / 11-15). */}
          {stats.topUnits && stats.topUnits.length > 0 && (
            <div className="mb-5">
              <div className="text-[#a0b0c5] text-[10px] uppercase tracking-widest mb-2">{t('tft.topUnitsPlayed')}</div>
              {/* lg:grid-rows-5 + lg:grid-flow-col fills column 1 first
                  (ranks 1-5), then column 2 (6-10), then column 3 (11-15).
                  Smaller breakpoints fall back to row-wise flow. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 lg:grid-rows-5 lg:grid-flow-col gap-2">
                {stats.topUnits.slice(0, 15).map((u, i) => (
                  <UnitChip
                    key={u.characterId}
                    rank={i + 1}
                    characterId={u.characterId}
                    games={u.games}
                    avg={u.avgPlacement}
                    assets={assets}
                    lobbyAvg={lobbyAvgByUnit?.[u.characterId]}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Favourite augments: 5 chips across the full width (1 row on lg). */}
          {stats.topAugments && stats.topAugments.length > 0 && (
            <div className="mb-5">
              <div className="text-[#a0b0c5] text-[10px] uppercase tracking-widest mb-2">{t('tft.favoriteAugments')}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                {stats.topAugments.slice(0, 5).map((a, i) => (
                  <AugmentChip
                    key={a.apiName}
                    rank={i + 1}
                    apiName={a.apiName}
                    games={a.games}
                    avg={a.avgPlacement}
                    assets={assets}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Play-style: radar + placement histogram + raw averages */}
          {stats.scores && stats.placementDistribution && stats.averages && (
            <PlayStyle scores={stats.scores} dist={stats.placementDistribution} avgs={stats.averages} />
          )}
        </>
      )}
    </div>
  );
}

function rankColor(rank: number): string {
  if (rank === 1) return '#f0c040';   // gold
  if (rank === 2) return '#cfd6dc';   // silver
  if (rank === 3) return '#cd7f32';   // bronze
  return '#a0b0c5';                   // neutral
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <div
      className="w-6 text-center flex-shrink-0 text-sm font-bold tabular-nums"
      style={{ color: rankColor(rank) }}
    >
      {rank}
    </div>
  );
}

function UnitChip({ rank, characterId, games, avg, assets, lobbyAvg }: { rank: number; characterId: string; games: number; avg: number; assets: TftAssetsBundle | null; lobbyAvg?: number }) {
  const { t } = useI18n();
  const info = assets?.champions[characterId];
  const url = tftChampionTileUrl(assets, info);
  const cost = info?.cost ?? 1;
  const costColor = costToColor(cost);
  const name = info?.name || characterId.replace(/^TFT\d+_/, '');
  // Diff vs. lobby Master+ average. Negative = player places *better* than
  // the average lobby (lower placement number is better in TFT).
  const diff = typeof lobbyAvg === 'number' ? avg - lobbyAvg : null;
  const diffColor = diff == null ? '#7a8aa0' : diff <= -0.15 ? '#3ecf8e' : diff >= 0.15 ? '#e44040' : '#a0b0c5';
  return (
    <a
      href={`/tft/units/${encodeURIComponent(characterId)}`}
      title={`#${rank} ${name} — ${games} ${t('tft.gamesShort')}, Ø ${avg.toFixed(2)}${lobbyAvg != null ? ` (Lobby Ø ${lobbyAvg.toFixed(2)})` : ''}`}
      className="flex items-center gap-2.5 bg-[#0a0e1a] border border-[#1e2a3a] rounded-md px-2.5 py-2 hover:border-[#7B61FF]/50 hover:bg-[#101729] transition"
    >
      <RankBadge rank={rank} />
      <div className="w-10 h-10 rounded border-2 overflow-hidden flex-shrink-0" style={{ borderColor: costColor }}>
        {url ? <img src={url} alt={name} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-[#1e2a3a]" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-white text-sm font-medium truncate">{name}</div>
        <div className="text-[#9ab0c4] text-xs flex items-center gap-1.5 tabular-nums">
          <span>{games} {t('tft.gamesShort')} · Ø {avg.toFixed(2)}</span>
          {diff != null && (
            <span style={{ color: diffColor }}>
              {diff <= 0 ? '' : '+'}{diff.toFixed(2)}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}

function AugmentChip({ rank, apiName, games, avg, assets }: { rank: number; apiName: string; games: number; avg: number; assets: TftAssetsBundle | null }) {
  const { t } = useI18n();
  const info = assets?.augments[apiName];
  const url = tftIconUrl(assets, info?.icon);
  const tierColor = info?.tier === 3 ? '#c39bff' : info?.tier === 2 ? '#e0c75a' : '#9ab0bf';
  const name = info?.name || apiName.replace(/^TFT\d+_Augment_/, '');
  return (
    <div
      title={`#${rank} ${name} — ${games} ${t('tft.gamesShort')}, Ø ${avg.toFixed(2)}`}
      className="flex items-center gap-2.5 bg-[#0a0e1a] border border-[#1e2a3a] rounded-md px-2.5 py-2"
    >
      <RankBadge rank={rank} />
      <div className="w-10 h-10 rounded border-2 overflow-hidden flex-shrink-0" style={{ borderColor: tierColor }}>
        {url ? <img src={url} alt={name} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-[#1e2a3a]" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-white text-sm font-medium truncate">{name}</div>
        <div className="text-[#9ab0c4] text-xs">{games} {t('tft.gamesShort')} · Ø {avg.toFixed(2)}</div>
      </div>
    </div>
  );
}

function PlayStyle({ scores, dist, avgs }: { scores: NonNullable<PlayerStats['scores']>; dist: number[]; avgs: NonNullable<PlayerStats['averages']> }) {
  const { t } = useI18n();
  const radarData = [
    { axis: t('tft.tempo'),       value: round1(scores.tempo) },
    { axis: t('tft.aggression'),  value: round1(scores.aggression) },
    { axis: t('tft.damage'),      value: round1(scores.damage) },
    { axis: t('tft.survival'),    value: round1(scores.survival) },
    { axis: t('tft.consistency'), value: round1(scores.consistency) },
  ];
  const histData = dist.map((c, i) => ({ place: `${i + 1}.`, count: c }));
  const total = dist.reduce((a, b) => a + b, 0) || 1;

  return (
    <>
      <div className="text-[#a0b0c5] text-[10px] uppercase tracking-widest mb-2">{t('tft.gameStyle')}</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-3">
        <div className="bg-[#0a0e1a] border border-[#1e2a3a] rounded p-3" style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData}>
              <PolarGrid stroke="#1e2a3a" />
              <PolarAngleAxis dataKey="axis" stroke="#a0b0c5" tick={{ fontSize: 11 }} />
              <Radar name="Score" dataKey="value" stroke="#7B61FF" fill="#7B61FF" fillOpacity={0.35} />
              <Tooltip
                cursor={{ fill: 'transparent' }}
                contentStyle={{ backgroundColor: '#0d1526', border: '1px solid #1e2a3a', fontSize: 11 }}
                formatter={(v: any) => [`${v}/100`, '']}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-[#0a0e1a] border border-[#1e2a3a] rounded p-3" style={{ height: 240 }}>
          <div className="text-[#a0b0c5] text-[10px] mb-1">{t('tft.placementDistribution')}</div>
          <ResponsiveContainer width="100%" height="90%">
            <BarChart data={histData} margin={{ top: 5, right: 0, bottom: 0, left: -25 }}>
              <XAxis dataKey="place" stroke="#a0b0c5" tick={{ fontSize: 10 }} />
              <YAxis stroke="#a0b0c5" tick={{ fontSize: 10 }} />
              <Tooltip
                cursor={{ fill: 'rgba(123,97,255,0.1)' }}
                contentStyle={{ backgroundColor: '#0d1526', border: '1px solid #1e2a3a', fontSize: 11 }}
                formatter={(v: any) => [`${v} (${((Number(v) / total) * 100).toFixed(1)}%)`, t('tft.matches')]}
              />
              <Bar dataKey="count" fill="#7B61FF" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <MiniStat label={t('tft.avgLevel')}        value={avgs.level.toFixed(2)} />
        <MiniStat label={t('tft.avgGoldLeft')}     value={avgs.goldLeft.toFixed(1)} />
        <MiniStat label={t('tft.avgEliminations')} value={avgs.eliminations.toFixed(2)} />
        <MiniStat label={t('tft.avgDamage')}       value={Math.round(avgs.damage).toString()} />
        <MiniStat label={t('tft.avgLastRound')}    value={formatStage(avgs.lastRound)} />
      </div>
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0a0e1a] border border-[#1e2a3a] rounded px-2 py-1.5">
      <div className="text-[#a0b0c5] text-[9px] uppercase tracking-widest">{label}</div>
      <div className="text-white text-sm font-medium mt-0.5">{value}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#0a0e1a] border border-[#1e2a3a] rounded px-3 py-2">
      <div className="text-[#a0b0c5] text-[10px] uppercase tracking-widest">{label}</div>
      <div className="text-white text-xl font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function ProBadge({ pro }: { pro: ProPlayer }) {
  // Fallback badge — name-matched against the LoL-Liquipedia list. Used
  // only when the puuid-verified TFT list has nothing for this account.
  return (
    <span
      title={`Verifizierter Pro · ${pro.team} ${pro.role}`}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#7B61FF]/15 text-[#7B61FF] text-[10px] uppercase tracking-widest font-medium border border-[#7B61FF]/40"
    >
      ✓ Verified Pro
    </span>
  );
}

function formatProEarnings(v: number | null | undefined): string {
  if (!v || v <= 0) return '—';
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return '$' + Math.round(v / 1_000) + 'k';
  return '$' + v.toLocaleString('en-US');
}

function placeColor(place: string | null): string {
  if (!place) return '#a0b0c5';
  const p = place.toLowerCase();
  if (p.startsWith('1')) return '#f0c040';
  if (p.startsWith('2')) return '#c0c0c0';
  if (p.startsWith('3')) return '#cd7f32';
  return '#a0b0c5';
}

function TournamentHistory({ pro }: { pro: TftProRecord }) {
  const [open, setOpen] = useState(false);
  const all = pro.tournament_results || [];
  if (all.length === 0) return null;
  const visible = open ? all : all.slice(0, 10);
  const wins = all.filter((r) => String(r.place || '').startsWith('1')).length;
  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mb-3">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-white text-sm font-medium uppercase tracking-widest">Tournament History</h2>
        <div className="text-xs text-[#a0b0c5]">
          <span className="text-white">{all.length}</span> Turniere ·{' '}
          <span className="text-[#f0c040]">{wins}× 1.</span> ·{' '}
          <span className="text-[#c89b3c]">{formatProEarnings(pro.total_earnings_usd)}</span>
        </div>
      </div>
      <div className="hidden sm:grid grid-cols-[6rem_3rem_1fr_5rem_6rem] gap-2 text-[10px] uppercase text-[#7a8aa0] pb-2 border-b border-[#1e2a3a]">
        <div>Datum</div>
        <div>Platz</div>
        <div>Turnier</div>
        <div>Tier</div>
        <div className="text-right">Preisgeld</div>
      </div>
      {visible.map((r, i) => (
        <div
          key={i}
          className="grid grid-cols-[6rem_3rem_1fr_5rem_6rem] gap-2 py-1.5 text-xs items-center border-b border-[#1e2a3a]/40 last:border-b-0"
        >
          <div className="text-[#7a8aa0] tabular-nums">{r.date?.slice(0, 10) || '—'}</div>
          <div className="font-medium tabular-nums" style={{ color: placeColor(r.place) }}>
            {r.place || '—'}
          </div>
          <div className="min-w-0 truncate text-white">
            {r.page ? (
              <a href={r.page} target="_blank" rel="noreferrer" className="hover:text-[#a892ff]">
                {r.tournament}
              </a>
            ) : (
              r.tournament
            )}
          </div>
          <div className="text-[#7a8aa0] hidden sm:block">{r.tier || '—'}</div>
          <div className="text-[#c89b3c] text-right tabular-nums">{formatProEarnings(r.prize_usd)}</div>
        </div>
      ))}
      {all.length > 10 && (
        <button
          onClick={() => setOpen(!open)}
          className="mt-2 w-full text-center text-xs text-[#a892ff] hover:text-white"
        >
          {open ? 'Weniger anzeigen' : `+ ${all.length - 10} weitere anzeigen`}
        </button>
      )}
    </div>
  );
}

function TftProBadge({ pro }: { pro: TftProRecord }) {
  // TFT-native badge — the puuid is itself the verification (the crawler
  // resolves Liquipedia's lolchess field against Riot's account-v1).
  return (
    <span
      title={`Verifizierter TFT-Pro · ${pro.team || 'Free Agent'} ${pro.role || ''}`.trim()}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#3ecf8e]/15 text-[#3ecf8e] text-[10px] uppercase tracking-widest font-medium border border-[#3ecf8e]/40"
    >
      ✓ Verified TFT Pro
    </span>
  );
}

function RankBlock({ ranked, seasonRanks }: { ranked: SummonerData['ranked']; seasonRanks?: SeasonRank[] }) {
  const [open, setOpen] = useState(false);
  const pastSeasons = (seasonRanks || []).filter(s => s.peak_tier).sort((a, b) => b.set_number - a.set_number);

  const inner = !ranked || !ranked.tier ? (
    <>
      <div className="text-[#a0b0c5] text-xs uppercase tracking-widest">Standard Ranked</div>
      <div className="text-[#a0b0c5] text-sm mt-1">Unranked</div>
    </>
  ) : (
    <>
      <div className="text-[#a0b0c5] text-xs uppercase tracking-widest">Standard Ranked</div>
      <div className="text-lg font-medium mt-1" style={{ color: TIER_COLORS[ranked.tier] || '#a0b0c5' }}>
        {formatTier(ranked.tier, ranked.rank)} <span className="text-white">{ranked.leaguePoints ?? 0} LP</span>
      </div>
      <div className="text-[#a0b0c5] text-xs">
        {ranked.wins ?? 0}W {ranked.losses ?? 0}L
        {(ranked.wins ?? 0) + (ranked.losses ?? 0) > 0 && (
          <> · {Math.round(((ranked.wins ?? 0) / ((ranked.wins ?? 0) + (ranked.losses ?? 0))) * 100)}% WR</>
        )}
      </div>
    </>
  );

  return (
    <div className="text-right relative">
      {inner}
      {pastSeasons.length > 0 && (
        <>
          <button
            onClick={() => setOpen(o => !o)}
            className="mt-2 text-[10px] text-[#7B61FF] hover:text-[#a892ff] uppercase tracking-widest"
          >
            Alle Saisons ({pastSeasons.length}) {open ? '▲' : '▼'}
          </button>
          {open && (
            <div className="absolute right-0 mt-1 z-20 bg-[#0d1526] border border-[#1e2a3a] rounded-lg shadow-lg p-3 min-w-[280px] text-left">
              <div className="text-[#a0b0c5] text-[10px] uppercase tracking-widest mb-2">
                Höchster Rang pro Set
              </div>
              <div className="space-y-1.5">
                {pastSeasons.map(s => (
                  <SeasonRankRow key={s.set_number} season={s} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SeasonRankRow({ season }: { season: SeasonRank }) {
  const { t } = useI18n();
  const tier = (season.peak_tier || '').toUpperCase();
  const color = TIER_COLORS[tier] || '#a0b0c5';
  const setLabel = formatSetLabel(season.set_label, season.set_number);
  // Build from structured fields via formatTier so Challenger/GM/Master
  // never render the bogus "I" division. peak_rating_label is from the
  // source (metatft/dakgg) and contains the raw tier+division string,
  // so it would re-introduce the "I" — only use it as a last-resort
  // fallback when peak_tier is missing.
  const tierLabel = tier
    ? formatTier(tier, season.peak_division)
    : (season.peak_rating_label || '');
  const rankText = [
    tierLabel,
    season.peak_lp != null ? `${season.peak_lp} LP` : '',
  ].filter(Boolean).join(' ');
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <div className="text-[#a0b0c5] flex-shrink-0">{setLabel}</div>
      <div className="flex items-center gap-2 min-w-0">
        <span style={{ color }} className="font-medium truncate">{rankText}</span>
        {season.total_games != null && (
          <span className="text-[#7a8aa0] text-[10px] flex-shrink-0">{season.total_games} {t('tft.gamesShort')}</span>
        )}
      </div>
    </div>
  );
}

// "TFTSet9_2" → "Set 9.2", "TFTSet16" → "Set 16"
function formatSetLabel(rawLabel: string | null, setNumber: number): string {
  if (!rawLabel) return `Set ${setNumber}`;
  const m = /^TFTSet(\d+)(?:_(\d+))?/i.exec(rawLabel);
  if (!m) return `Set ${setNumber}`;
  return m[2] ? `Set ${m[1]}.${m[2]}` : `Set ${m[1]}`;
}

function costToColor(cost: number) {
  return cost === 1 ? '#9aa6b2' : cost === 2 ? '#3a8' : cost === 3 ? '#3a8ddc' : cost === 4 ? '#c39bff' : '#e0c75a';
}
function round1(n: number) { return Math.round(n * 10) / 10; }

// Pro-Specialty + Pro-Build-Drift (Sprint 3.2 + 3.3). Fetches the new
// /api/tft/pros/specialty endpoint and renders the pro's top comps + their
// signature item builds per carry. Only mounted for verified TFT pros.
interface SpecialtyComp {
  clusterKey: string;
  carryUnit: string;
  games: number;
  share: number;
  avgPlacement: number | null;
  top4Rate: number | null;
}
interface SpecialtyBuild { items: string[]; count: number; avgPlacement: number | null }
interface SpecialtyUnit {
  unitId: string;
  games: number;
  tiers: Record<string, SpecialtyBuild[]>;
}
function ProSpecialty({ puuid, setNumber, assets, t }: {
  puuid: string;
  setNumber: number | null | undefined;
  assets: TftAssetsBundle | null;
  t: (k: any) => string;
}) {
  const [data, setData] = useState<{ comps: SpecialtyComp[]; unitBuilds: SpecialtyUnit[]; classifiedGames: number } | null>(null);
  // Cluster keys that actually resolve to a comp page. The detail page only
  // shows data for euw1/master_plus clusters, so we mirror that exact query and
  // link conditionally: matching clusters → comp page, the rest stay on the
  // carry's unit page (no "no data" dead-ends). The specialty API classifies
  // with the new num_units≥2 logic while the aggregator still uses the old one,
  // so today only the overlap (e.g. Dark Star · Kai'Sa) matches; once the
  // aggregator is realigned (Task #18) more keys resolve here automatically.
  const [compKeys, setCompKeys] = useState<Set<string> | null>(null);
  useEffect(() => {
    const setParam = setNumber != null ? `&set=${setNumber}` : '';
    fetch(`/api/tft/pros/specialty?puuid=${encodeURIComponent(puuid)}${setParam}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d && (d.comps?.length || d.unitBuilds?.length)) setData(d); })
      .catch(() => {});
  }, [puuid, setNumber]);
  useEffect(() => {
    fetch('/api/tft/comps?region=euw1&bucket=master_plus')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (Array.isArray(d?.comps)) setCompKeys(new Set(d.comps.map((c: any) => c.clusterKey))); })
      .catch(() => {});
  }, []);
  if (!data) return null;
  return (
    <section className="mt-4 bg-gradient-to-br from-[#0d1526] to-[#1a0e26] border border-[#a892ff]/30 rounded p-4">
      <h2 className="text-[#a892ff] text-xs uppercase tracking-widest mb-3">{t('tft.player.proSpecialty')}</h2>
      {data.comps.length > 0 && (
        <div className="mb-4">
          <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest mb-2">
            {t('tft.player.signatureComps')} · {data.classifiedGames} {t('tft.gamesShort')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {data.comps.slice(0, 6).map(c => {
              const m = /^(.+)@(\d+)_(.+)$/.exec(c.clusterKey);
              const trait = m ? m[1] : '';
              const carry = m ? m[3] : c.carryUnit;
              const traitName = assets?.traits[trait]?.name || trait.replace(/^TFT\d+_/, '');
              const carryAsset = assets?.champions[carry];
              // Comp page if this cluster resolves there, else the carry's unit page.
              const href = compKeys?.has(c.clusterKey)
                ? `/tft/comps/${encodeURIComponent(c.clusterKey)}`
                : `/tft/units/${encodeURIComponent(c.carryUnit)}`;
              return (
                <a
                  key={c.clusterKey}
                  href={href}
                  className="flex items-center gap-2 bg-[#141c2e] border border-[#1e2a3a] rounded p-2 hover:border-[#a892ff]/40 transition-colors"
                >
                  {tftChampionTileUrl(assets, carryAsset) && (
                    <img src={tftChampionTileUrl(assets, carryAsset)!} alt="" className="w-8 h-8 rounded border border-[#c39bff]/60 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-[11px] font-medium truncate">
                      {traitName} · {carryAsset?.name || carry.replace(/^TFT\d+_/, '')}
                    </div>
                    <div className="text-[#7a8aa0] text-[10px] tabular-nums">
                      {(c.share * 100).toFixed(0)}% · Ø {c.avgPlacement?.toFixed(2) ?? '—'} · {c.games} {t('tft.gamesShort')}
                    </div>
                  </div>
                  <div className="text-[10px] tabular-nums text-[#3ecf8e]">
                    {c.top4Rate != null ? `${(c.top4Rate * 100).toFixed(0)}% T4` : ''}
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}
      {data.unitBuilds.length > 0 && (
        <div>
          <div className="text-[#7a8aa0] text-[10px] uppercase tracking-widest mb-2">{t('tft.player.signatureBuilds')}</div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {data.unitBuilds.slice(0, 4).map(u => {
              const unitAsset = assets?.champions[u.unitId];
              const tierKeys = Object.keys(u.tiers).sort();
              return (
                <div key={u.unitId} className="bg-[#141c2e] border border-[#1e2a3a] rounded p-2.5">
                  <div className="flex items-center gap-2 mb-2">
                    {tftChampionTileUrl(assets, unitAsset) && (
                      <img src={tftChampionTileUrl(assets, unitAsset)!} alt="" className="w-8 h-8 rounded border border-[#c39bff]/60" />
                    )}
                    <span className="text-white text-[11px]">{unitAsset?.name || u.unitId.replace(/^TFT\d+_/, '')}</span>
                    <span className="text-[#7a8aa0] text-[10px] tabular-nums ml-auto">{u.games} {t('tft.gamesShort')}</span>
                  </div>
                  <div className="space-y-1">
                    {tierKeys.flatMap(tier => (u.tiers[tier] || []).map((build, i) => (
                      <div key={`${tier}-${i}`} className="flex items-center gap-1.5">
                        <span className="text-[10px] text-[#a892ff] w-5">{tier}★</span>
                        <div className="flex gap-0.5">
                          {build.items.map((it, j) => {
                            const iconUrl = tftIconUrl(assets, assets?.items[it]?.icon);
                            return iconUrl ? (
                              <img key={j} src={iconUrl} alt="" className="w-5 h-5 rounded" title={assets?.items[it]?.name || it} />
                            ) : (
                              <div key={j} className="w-5 h-5 rounded bg-[#1e2a3a]" />
                            );
                          })}
                        </div>
                        <span className="text-[10px] text-[#7a8aa0] tabular-nums ml-auto">{build.count}× · Ø{build.avgPlacement?.toFixed(1) ?? '—'}</span>
                      </div>
                    )))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
