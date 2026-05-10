'use client';
import { useEffect, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n } from '../../lib/i18n';
import TftHero from '../../components/tft/TftHero';

interface Player {
  rank: number; puuid: string;
  gameName: string | null; tagLine: string | null;
  tier: string; leaguePoints: number; wins: number; losses: number;
}

const TIERS = [
  { value: 'CHALLENGER',  color: '#f0c040' },
  { value: 'GRANDMASTER', color: '#e44040' },
  { value: 'MASTER',      color: '#9d48e0' },
];

const REGIONS = [
  { value: 'euw1', label: 'EUW' },
  { value: 'kr',   label: 'KR' },
  { value: 'na1',  label: 'NA' },
];

export default function TftLeaderboardPage() {
  const { t } = useI18n();
  const [region, setRegion] = useState('euw1');
  const [tier, setTier] = useState('CHALLENGER');
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tierDist, setTierDist] = useState<{ month: string; tiers: { key: string; label: string; pct: number; color: string }[] } | null>(null);

  useEffect(() => {
    fetch('/tft-tier-distribution.json')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.tiers) setTierDist({ month: d.month || '', tiers: d.tiers }); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/tft/leaderboard?region=${region}&tier=${tier}`)
      .then(async r => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(d => { setPlayers(d.players || []); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [region, tier]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="leaderboard" />
      <TftHero pageTitle={t('nav.leaderboard')} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-3 pb-6">


        {tierDist && tierDist.tiers.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mb-4">
            <div className="flex items-baseline justify-between mb-3">
              <div className="text-[#8a9bb0] text-xs uppercase tracking-widest">{t('champ.rankDistribution')}</div>
              {tierDist.month && <div className="text-[#4a5a70] text-[10px]">{tierDist.month}</div>}
            </div>
            <div className="flex items-end gap-2 h-32 mb-2">
              {(() => {
                const maxPct = Math.max(...tierDist.tiers.map(t => t.pct), 1);
                return tierDist.tiers.map(item => {
                  const barH = Math.max((item.pct / maxPct) * 100, 2);
                  const display = item.pct >= 1 ? item.pct.toFixed(1) + '%' : item.pct + '%';
                  return (
                    <div key={item.key} className="flex-1 flex flex-col items-center gap-1">
                      <div className="text-[10px] font-medium" style={{ color: item.color }}>{display}</div>
                      <div className="w-full relative" style={{ height: '90px' }}>
                        <div className="absolute bottom-0 w-full rounded-t transition-all duration-500" style={{ height: `${barH}%`, backgroundColor: item.color, opacity: 0.7, boxShadow: `0 0 8px ${item.color}40` }} />
                      </div>
                      <div className="text-[10px] text-center" style={{ color: item.color }}>{item.label}</div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-3">
          {REGIONS.map(r => (
            <button
              key={r.value}
              onClick={() => setRegion(r.value)}
              className={`px-3 py-1.5 rounded text-xs font-medium ${region === r.value ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'}`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1 mb-4">
          {TIERS.map(tr => (
            <button
              key={tr.value}
              onClick={() => setTier(tr.value)}
              className={`px-3 py-1.5 rounded text-xs font-medium ${tier === tr.value ? 'text-[#0a0e1a]' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'}`}
              style={tier === tr.value ? { backgroundColor: tr.color } : {}}
            >
              {tr.value}
            </button>
          ))}
        </div>

        {loading && <div className="text-[#4a5a70] text-center py-8">Lade ...</div>}
        {error && <div className="bg-red-500/10 border border-red-500/30 rounded p-4 text-red-400 text-sm">{error}</div>}

        {!loading && !error && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
            <div className="grid grid-cols-[3rem_1fr_5rem_5rem_5rem] gap-2 px-4 py-2 text-[10px] uppercase text-[#4a5a70] bg-[#0a0e1a]">
              <div className="text-right">#</div>
              <div>Spieler</div>
              <div className="text-right">LP</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
              <div className="text-right">WR</div>
            </div>
            {players.map(p => {
              const total = p.wins + p.losses;
              const wr = total > 0 ? Math.round((p.wins / total) * 100) : 0;
              const slug = p.gameName ? `${encodeURIComponent(p.gameName)}--${encodeURIComponent(p.tagLine || 'EUW')}` : null;
              return (
                <a
                  key={p.puuid}
                  href={slug ? `/tft/player/${slug}?region=${region}` : '#'}
                  className="grid grid-cols-[3rem_1fr_5rem_5rem_5rem] gap-2 px-4 py-2 items-center text-xs hover:bg-white/5 border-t border-[#1e2a3a]"
                >
                  <div className="text-right text-[#8a9bb0]">{p.rank}</div>
                  <div className="text-white truncate">
                    {p.gameName ? `${p.gameName}` : <span className="text-[#4a5a70]">unbekannt</span>}
                    {p.tagLine && <span className="text-[#4a5a70] text-[10px]"> #{p.tagLine}</span>}
                  </div>
                  <div className="text-right text-white">{p.leaguePoints}</div>
                  <div className="text-right text-[#4a5a70]">{total}</div>
                  <div className="text-right text-[#8a9bb0]">{wr}%</div>
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
