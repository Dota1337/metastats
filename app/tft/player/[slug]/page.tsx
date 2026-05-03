'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import MatchCard from '../../../components/tft/MatchCard';
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

  useEffect(() => {
    fetch('https://ddragon.leagueoflegends.com/api/versions.json')
      .then(r => r.json())
      .then(v => setDdVersion(v[0]))
      .catch(() => {});
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
        return fetch(`/api/tft/matches?ids=${d.matchIds.slice(0, 10).join(',')}&region=${region}`)
          .then(r => r.ok ? r.json() : { matches: [] })
          .then(m => { setMatches(m.matches || []); setMatchesLoading(false); });
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [fullName, gameName, region]);

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

            <div className="space-y-2">
              {matchesLoading && matches.length === 0 && (
                <div className="text-[#4a5a70] text-center py-8">Lade Match-History ...</div>
              )}
              {!matchesLoading && matches.length === 0 && data.matchIds.length === 0 && (
                <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#8a9bb0] text-sm">
                  Keine Standard-Ranked-Matches gefunden.
                </div>
              )}
              {matches.map(m => (
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
        {ranked.tier} {ranked.rank || ''} <span className="text-white">{ranked.leaguePoints ?? 0} LP</span>
      </div>
      <div className="text-[#4a5a70] text-xs">
        {ranked.wins ?? 0}W {ranked.losses ?? 0}L{wr != null && <> · {wr}% WR</>}
      </div>
    </div>
  );
}
