'use client';
import { useEffect, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n, LOCALE_MAP } from '../../lib/i18n';
import TftHero from '../../components/tft/TftHero';

interface Player {
  rank: number; puuid: string;
  gameName: string | null; tagLine: string | null;
  tier: string; leaguePoints: number; wins: number; losses: number;
}

interface MarketSnapshot {
  puuid: string;
  finalValue: number;
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
  const { t, lang } = useI18n();
  const [region, setRegion] = useState('euw1');
  const [tier, setTier] = useState('CHALLENGER');
  const [players, setPlayers] = useState<Player[]>([]);
  const [marketValues, setMarketValues] = useState<Map<string, number>>(new Map());
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
    setMarketValues(new Map());
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

  // Side-load marketvalues from the snapshot leaderboard. Single batch
  // request — limited to the snapshot table, no Riot calls. Result is keyed
  // by puuid so we can join without name-fuzzy-matching.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tft/marktwert/leaderboard?region=${region}&tier=${tier}&limit=500`)
      .then(r => r.ok ? r.json() : { players: [] })
      .then(d => {
        if (cancelled) return;
        const m = new Map<string, number>();
        for (const p of (d.players || []) as MarketSnapshot[]) {
          if (p.puuid && typeof p.finalValue === 'number') m.set(p.puuid, p.finalValue);
        }
        setMarketValues(m);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [region, tier]);

  const fmtEur = (n: number) =>
    new Intl.NumberFormat(LOCALE_MAP[lang], {
      style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
    }).format(n);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="leaderboard" />
      <TftHero pageTitle={t('nav.leaderboard')} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-2 pb-6">


        {tierDist && tierDist.tiers.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mb-4">
            <div className="flex items-baseline justify-between mb-3">
              <div className="text-[#a0b0c5] text-xs uppercase tracking-widest">{t('champ.rankDistribution')}</div>
              {tierDist.month && <div className="text-[#7a8aa0] text-[10px]">{tierDist.month}</div>}
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
              className={`px-3 py-1.5 rounded text-xs font-medium ${region === r.value ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#a0b0c5] hover:text-white'}`}
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
              className={`px-3 py-1.5 rounded text-xs font-medium ${tier === tr.value ? 'text-[#0a0e1a]' : 'bg-[#141c2e] text-[#a0b0c5] hover:text-white'}`}
              style={tier === tr.value ? { backgroundColor: tr.color } : {}}
            >
              {tr.value}
            </button>
          ))}
        </div>

        {loading && <div className="text-[#7a8aa0] text-center py-8">Lade ...</div>}
        {error && <div className="bg-red-500/10 border border-red-500/30 rounded p-4 text-red-400 text-sm">{error}</div>}

        {!loading && !error && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
            <div className="hidden sm:grid grid-cols-[3rem_1fr_5rem_5rem_5rem_7rem] gap-2 px-4 py-2 text-[10px] uppercase text-[#7a8aa0] bg-[#0a0e1a]">
              <div className="text-right">#</div>
              <div>Spieler</div>
              <div className="text-right">LP</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
              <div className="text-right">WR</div>
              <div className="text-right">{t('tft.marketValue')}</div>
            </div>
            {players.map(p => {
              const total = p.wins + p.losses;
              const wr = total > 0 ? Math.round((p.wins / total) * 100) : 0;
              const slug = p.gameName ? `${encodeURIComponent(p.gameName)}--${encodeURIComponent(p.tagLine || 'EUW')}` : null;
              const mv = marketValues.get(p.puuid);
              return (
                <a
                  key={p.puuid}
                  href={slug ? `/tft/player/${slug}?region=${region}` : '#'}
                  className="block sm:grid sm:grid-cols-[3rem_1fr_5rem_5rem_5rem_7rem] gap-2 px-4 py-2 sm:items-center text-xs hover:bg-white/5 border-t border-[#1e2a3a]"
                >
                  {/* Mobile: rank + name on first row, stats stacked below.
                      Desktop: original 6-col grid. */}
                  <div className="hidden sm:block text-right text-[#a0b0c5]">{p.rank}</div>
                  <div className="flex items-baseline gap-2 sm:block">
                    <span className="text-[#a0b0c5] text-[10px] sm:hidden">#{p.rank}</span>
                    <span className="text-white truncate flex-1 sm:flex-initial">
                      {p.gameName ? `${p.gameName}` : <span className="text-[#7a8aa0]">unbekannt</span>}
                      {p.tagLine && <span className="text-[#7a8aa0] text-[10px]"> #{p.tagLine}</span>}
                    </span>
                  </div>
                  <div className="hidden sm:block text-right text-white">{p.leaguePoints}</div>
                  <div className="hidden sm:block text-right text-[#7a8aa0]">{total}</div>
                  <div className="hidden sm:block text-right text-[#a0b0c5]">{wr}%</div>
                  <div className="flex sm:block items-center justify-between mt-1 sm:mt-0 sm:text-right tabular-nums">
                    <span className="text-[#7a8aa0] text-[10px] sm:hidden">
                      {p.leaguePoints} LP · {total} {t('tft.gamesShort')} · {wr}% WR
                    </span>
                    {mv != null
                      ? <span className="text-[#7B61FF] font-medium">{fmtEur(mv)}</span>
                      : <span className="text-[#7a8aa0]">—</span>
                    }
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
