'use client';
import { useEffect, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n } from '../../lib/i18n';
import TftHero from '../../components/tft/TftHero';

interface TopPlayer {
  rank: number;
  gameName: string | null;
  tagLine: string | null;
  tier: string;
  lp: number;
  marketValue: number | null;
  rated: boolean;
  notRatedReason?: string;
}

export default function TftMarktwertPage() {
  const { t } = useI18n();
  const [region, setRegion] = useState('euw1');
  const [tier, setTier] = useState('CHALLENGER');
  const [players, setPlayers] = useState<TopPlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The leaderboard endpoint gives us the ladder; we then call /marktwert
  // for each player serially (rate-limit friendly). For first paint we show
  // the ladder placeholder rows immediately and fill marketValue as it
  // streams in.
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setPlayers([]);
    fetch(`/api/tft/leaderboard?region=${region}&tier=${tier}`)
      .then(async r => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(d => {
        if (cancelled) return;
        const initial: TopPlayer[] = (d.players || []).slice(0, 20).map((p: any) => ({
          rank: p.rank, gameName: p.gameName, tagLine: p.tagLine,
          tier: p.tier, lp: p.leaguePoints, marketValue: null, rated: false,
        }));
        setPlayers(initial);
        setLoading(false);
        // Fire marketvalue requests in series (slow but rate-limit friendly).
        (async () => {
          for (let i = 0; i < initial.length; i++) {
            const p = initial[i];
            if (!p.gameName) continue;
            try {
              const mvRes = await fetch(`/api/tft/marktwert?name=${encodeURIComponent(`${p.gameName}#${p.tagLine || 'EUW'}`)}&region=${region}`);
              if (!mvRes.ok) continue;
              const mv = await mvRes.json();
              if (cancelled) return;
              setPlayers(prev => prev.map((pp, idx) => idx === i ? {
                ...pp,
                marketValue: mv.marketValue?.finalValue ?? null,
                rated: !!mv.marketValue?.rated,
                notRatedReason: mv.marketValue?.notRatedReason,
              } : pp));
            } catch {}
          }
        })();
      })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [region, tier]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="marktwert" />
      <TftHero pageTitle={t('nav.marketvalue')} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-3 pb-6">
        <p className="text-[#8a9bb0] text-sm mb-4">Marktwerte ab Master · TFT Standard Ranked</p>

        <div className="flex flex-wrap gap-2 mb-3">
          {['euw1', 'kr', 'na1'].map(r => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              className={`px-3 py-1.5 rounded text-xs font-medium ${region === r ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'}`}
            >
              {r === 'euw1' ? 'EUW' : r === 'kr' ? 'KR' : 'NA'}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 mb-4">
          {['CHALLENGER', 'GRANDMASTER', 'MASTER'].map(tr => (
            <button
              key={tr}
              onClick={() => setTier(tr)}
              className={`px-3 py-1.5 rounded text-xs font-medium ${tier === tr ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'}`}
            >
              {tr}
            </button>
          ))}
        </div>

        {loading && <div className="text-[#4a5a70] text-center py-8">Lade ...</div>}
        {error && <div className="bg-red-500/10 border border-red-500/30 rounded p-4 text-red-400 text-sm">{error}</div>}

        {!loading && !error && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
            <div className="grid grid-cols-[3rem_1fr_5rem_8rem] gap-2 px-4 py-2 text-[10px] uppercase text-[#4a5a70] bg-[#0a0e1a]">
              <div className="text-right">#</div>
              <div>Spieler</div>
              <div className="text-right">LP</div>
              <div className="text-right">Marktwert</div>
            </div>
            {players.map(p => {
              const slug = p.gameName ? `${encodeURIComponent(p.gameName)}--${encodeURIComponent(p.tagLine || 'EUW')}` : null;
              return (
                <a key={`${p.rank}-${p.gameName}`}
                   href={slug ? `/tft/player/${slug}?region=${region}` : '#'}
                   className="grid grid-cols-[3rem_1fr_5rem_8rem] gap-2 px-4 py-2 items-center text-xs hover:bg-white/5 border-t border-[#1e2a3a]">
                  <div className="text-right text-[#8a9bb0]">{p.rank}</div>
                  <div className="text-white truncate">
                    {p.gameName || <span className="text-[#4a5a70]">unbekannt</span>}
                    {p.tagLine && <span className="text-[#4a5a70] text-[10px]"> #{p.tagLine}</span>}
                  </div>
                  <div className="text-right text-white">{p.lp}</div>
                  <div className="text-right">
                    {p.marketValue == null
                      ? <span className="text-[#4a5a70]">…</span>
                      : p.rated
                        ? <span className="text-[#7B61FF] font-medium">{p.marketValue.toLocaleString('de-DE')} €</span>
                        : <span className="text-[#4a5a70]">—</span>
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
