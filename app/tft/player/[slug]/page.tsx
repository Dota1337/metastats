'use client';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import MatchCard from '../../../components/tft/MatchCard';
import { useI18n } from '../../../lib/i18n';
import { loadTftSetMeta } from '../../../lib/tft-dd-assets';
import { formatTier } from '../../../lib/rank-format';
import type { TftMatchSummary } from '../../../lib/tft-match-processor';

interface SummonerData {
  summoner: { name: string; puuid: string; profileIconId: number | null; summonerLevel: number | null; tier: string | null; rank: string | null };
  ranked: { tier?: string; rank?: string; leaguePoints?: number; wins?: number; losses?: number } | null;
  matchIds: string[];
  region: string;
}

const TIER_COLORS: Record<string, string> = {
  IRON: '#6b6b6b', BRONZE: '#a0652a', SILVER: '#8fa0a8', GOLD: '#c89b3c',
  PLATINUM: '#209e85', EMERALD: '#00a86b', DIAMOND: '#576cce',
  MASTER: '#9d48e0', GRANDMASTER: '#e44040', CHALLENGER: '#f0c040',
};

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
  const [matches, setMatches] = useState<TftMatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ddVersion, setDdVersion] = useState('');
  const [currentSet, setCurrentSet] = useState<number | null>(null);
  // null = all sets, number = filter on that set
  const [selectedSet, setSelectedSet] = useState<number | null>(null);
  const [setManuallyPicked, setSetManuallyPicked] = useState(false);

  useEffect(() => {
    fetch('https://ddragon.leagueoflegends.com/api/versions.json')
      .then(r => r.json())
      .then(v => setDdVersion(v[0]))
      .catch(() => {});
    loadTftSetMeta().then(meta => { if (meta) setCurrentSet(meta.setNumber); });
  }, []);

  useEffect(() => {
    if (!gameName) return;
    setLoading(true);
    setError(null);
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
        if (d.matchIds.length === 0) return;
        setMatchesLoading(true);
        // Load all 20 ids so the set filter has enough material to pick from.
        return fetch(`/api/tft/matches?ids=${d.matchIds.slice(0, 20).join(',')}&region=${region}`)
          .then(r => r.ok ? r.json() : { matches: [] })
          .then(m => { setMatches(m.matches || []); setMatchesLoading(false); });
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [fullName, gameName, region]);

  // Available sets from the loaded matches, newest first.
  const availableSets = useMemo(() => {
    const set = new Set<number>();
    for (const m of matches) if (typeof m.setNumber === 'number') set.add(m.setNumber);
    return [...set].sort((a, b) => b - a);
  }, [matches]);

  // Auto-pick a sensible default when matches first load:
  //   - current set if the user has matches in it
  //   - else the set with the most matches in their history
  // The user's manual pick wins forever after.
  useEffect(() => {
    if (setManuallyPicked || availableSets.length === 0) return;
    if (currentSet != null && availableSets.includes(currentSet)) {
      setSelectedSet(currentSet);
    } else {
      const counts: Record<number, number> = {};
      for (const m of matches) if (m.setNumber != null) counts[m.setNumber] = (counts[m.setNumber] || 0) + 1;
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      setSelectedSet(top ? Number(top[0]) : null);
    }
  }, [availableSets, currentSet, matches, setManuallyPicked]);

  const filteredMatches = selectedSet == null ? matches : matches.filter(m => m.setNumber === selectedSet);

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
              {matchesLoading && matches.length === 0 && (
                <div className="text-[#4a5a70] text-center py-8">Lade Match-History ...</div>
              )}
              {!matchesLoading && matches.length === 0 && data.matchIds.length === 0 && (
                <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#8a9bb0] text-sm">
                  Keine Standard-Ranked-Matches gefunden.
                </div>
              )}
              {!matchesLoading && matches.length > 0 && filteredMatches.length === 0 && (
                <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#8a9bb0] text-sm">
                  {t('tft.noMatchesForSet')}
                </div>
              )}
              {filteredMatches.map(m => (
                <MatchCard key={m.matchId} match={m} selfPuuid={data.summoner.puuid} ddVersion={ddVersion} />
              ))}
            </div>
          </>
        )}
      </div>
      <Footer />
    </main>
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
