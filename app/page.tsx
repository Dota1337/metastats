'use client';
import { useState, useEffect } from 'react';

export default function Home() {
  const [name, setName] = useState('');
  const [region, setRegion] = useState('euw1');
  const [activeTab, setActiveTab] = useState<'search' | 'marktwert'>('search');
  const [topPlayers, setTopPlayers] = useState<any[]>([]);
  const [gainers, setGainers] = useState<any[]>([]);
  const [losers, setLosers] = useState<any[]>([]);
  const [recentPlayers, setRecentPlayers] = useState<any[]>([]);
  const [loadingMarket, setLoadingMarket] = useState(false);

  useEffect(() => {
    let visitorId = document.cookie.split('; ').find(r => r.startsWith('visitor_id='))?.split('=')[1];
    if (!visitorId) {
      visitorId = crypto.randomUUID();
      document.cookie = `visitor_id=${visitorId}; max-age=31536000; path=/`;
    }
    fetchRecentPlayers();
  }, []);

  useEffect(() => {
    if (activeTab === 'marktwert') {
      fetchMarketData();
    }
  }, [activeTab]);

  const fetchRecentPlayers = async () => {
    try {
      const res = await fetch('/api/recent-players');
      const data = await res.json();
      if (data.players) setRecentPlayers(data.players);
    } catch {}
  };

  const fetchMarketData = async () => {
    setLoadingMarket(true);
    try {
      const res = await fetch('/api/market-rankings');
      const data = await res.json();
      if (data.top) setTopPlayers(data.top);
      if (data.gainers) setGainers(data.gainers);
      if (data.losers) setLosers(data.losers);
    } catch {}
    setLoadingMarket(false);
  };

  const search = () => {
    if (!name.trim()) return;
    const parts = name.split('#');
    const gameName = parts[0].trim();
    const tag = parts[1]?.trim() || 'EUW';
    const slug = gameName.replace(/ /g, '-') + '-' + tag;
    window.location.href = '/player/' + slug;
  };

  const formatValue = (v: number) => {
    if (v >= 1000000) return '$' + (v / 1000000).toFixed(2) + 'M';
    if (v >= 1000) return '$' + (v / 1000).toFixed(1) + 'k';
    return '$' + v;
  };

  return (
    <main className="min-h-screen bg-[#080c18]">
      <nav className="bg-[#0a0e1a] border-b border-[#1e2a3a] px-6 py-3 flex items-center justify-between">
        <a href="/" className="text-[#c89b3c] text-lg font-medium">
          meta<span className="text-white">stats</span>.gg
        </a>
        <div className="flex gap-6">
          <a href="/" className="text-white text-sm">Spielersuche</a>
          <a href="/leaderboard" className="text-[#8a9bb0] text-sm hover:text-white">Rangliste</a>
          <a href="/champions" className="text-[#8a9bb0] text-sm hover:text-white">Champions</a>
        </div>
      </nav>

      <div className="bg-[#0a0e1a] border-b border-[#1e2a3a] px-6 py-16 text-center">
        <div className="text-[#c89b3c] text-xs uppercase tracking-widest mb-3">Die führende E-Sport Analyseplattform</div>
        <h1 className="text-white text-4xl font-medium mb-3">
          League of Legends<br />Statistiken & Marktwerte
        </h1>
        <p className="text-[#8a9bb0] text-sm mb-8 max-w-lg mx-auto">
          Echtzeit-Stats, Match History & KI-gestützte Marktwertberechnung für alle Spieler
        </p>

        <div className="flex justify-center gap-2 mb-6">
          <button
            onClick={() => setActiveTab('search')}
            className={'px-6 py-2 rounded text-sm font-medium transition-colors ' + (activeTab === 'search' ? 'bg-[#c89b3c] text-[#0a0e1a]' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white')}
          >
            Spielersuche
          </button>
          <button
            onClick={() => setActiveTab('marktwert')}
            className={'px-6 py-2 rounded text-sm font-medium transition-colors ' + (activeTab === 'marktwert' ? 'bg-[#c89b3c] text-[#0a0e1a]' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white')}
          >
            Marktwerte
          </button>
        </div>

        {activeTab === 'search' && (
          <div className="flex max-w-lg mx-auto bg-[#141c2e] border border-[#2a3a50] rounded overflow-hidden">
            <select
              value={region}
              onChange={e => setRegion(e.target.value)}
              className="bg-[#1a2438] border-r border-[#2a3a50] text-[#8a9bb0] text-sm px-3 outline-none"
            >
              <option value="euw1">EUW</option>
              <option value="eun1">EUNE</option>
              <option value="na1">NA</option>
              <option value="kr">KR</option>
            </select>
            <input
              className="flex-1 bg-transparent text-white text-sm px-4 py-3 outline-none placeholder-[#4a5a70]"
              placeholder="Summoner-Name suchen... (z.B. Name#EUW)"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()}
            />
            <button onClick={search} className="bg-[#c89b3c] text-[#0a0e1a] text-sm font-medium px-5">
              Suchen
            </button>
          </div>
        )}
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {activeTab === 'search' && (
          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-3 grid grid-cols-4 gap-3 mb-2">
              {[
                { label: 'Gespeicherte Spieler', value: '2,4M', sub: '+12.4% diese Woche' },
                { label: 'Analysierte Matches', value: '18,7M', sub: 'letzte 30 Tage' },
                { label: 'Ø KI-Marktwert', value: '$4.200', sub: 'Top 1% ab $42.000' },
                { label: 'Aktive Regionen', value: '4', sub: 'EUW · EUNE · NA · KR' },
              ].map(s => (
                <div key={s.label} className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
                  <div className="text-[#8a9bb0] text-xs mb-1">{s.label}</div>
                  <div className="text-white text-2xl font-medium">{s.value}</div>
                  <div className="text-[#c89b3c] text-xs mt-1">{s.sub}</div>
                </div>
              ))}
            </div>

            <div className="col-span-2 bg-[#0d1526] border border-[#1e2a3a] rounded p-5">
              <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">Zuletzt gesucht</div>
              {recentPlayers.length === 0 ? (
                <div className="text-[#4a5a70] text-sm text-center py-8">Noch keine Suchen</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {recentPlayers.map((p, i) => (
                    <a key={i} href={'/player/' + p.summoner_name.replace('#', '-').replace(/ /g, '-')} className="flex items-center gap-3 p-2 rounded hover:bg-[#141c2e] transition-colors">
                      <div className="w-8 h-8 rounded-full bg-[#1a2438] border border-[#2a3a50] flex items-center justify-center text-[#8a9bb0] text-xs font-medium flex-shrink-0">
                        {p.summoner_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="text-white text-sm">{p.summoner_name}</div>
                        <div className="text-[#4a5a70] text-xs">{p.region?.toUpperCase()} · Level {p.summoner_level}</div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-5">
              <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">Features</div>
              <div className="flex flex-col gap-3">
                {[
                  { icon: '◆', title: 'KI-Marktwert', desc: 'Rollenbasierte Bewertung ab Diamond 4' },
                  { icon: '◈', title: 'Match History', desc: 'Letzte 30 Spiele mit allen Stats' },
                  { icon: '◉', title: 'Rangliste', desc: 'Top Challenger Spieler EUW' },
                  { icon: '◇', title: 'Multi-Region', desc: 'EUW, EUNE, NA, KR' },
                ].map(f => (
                  <div key={f.title} className="flex gap-3 items-start">
                    <span className="text-[#c89b3c] text-sm mt-0.5">{f.icon}</span>
                    <div>
                      <div className="text-white text-sm font-medium">{f.title}</div>
                      <div className="text-[#4a5a70] text-xs">{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'marktwert' && (
          <div className="grid grid-cols-3 gap-6">
            {loadingMarket ? (
              <div className="col-span-3 text-center text-[#8a9bb0] py-20">Lade Marktwert-Daten...</div>
            ) : (
              <>
                <div className="col-span-3 bg-[#0d1526] border border-[#1e2a3a] rounded p-5">
                  <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">Top Marktwerte</div>
                  {topPlayers.length === 0 ? (
                    <div className="text-[#4a5a70] text-sm text-center py-8">
                      Noch keine Daten — Marktwerte werden gesammelt während Spieler gesucht werden
                    </div>
                  ) : (
                    <div className="grid grid-cols-5 gap-2 text-xs text-[#8a9bb0] px-2 mb-2">
                      <div>#</div><div>Spieler</div><div className="text-right">Marktwert</div>
                      <div className="text-right">Rang</div><div className="text-right">Winrate</div>
                    </div>
                  )}
                  {topPlayers.map((p, i) => (
                    <a key={i} href={'/player/' + p.summoner_name.replace('#', '-').replace(/ /g, '-')} className="grid grid-cols-5 gap-2 px-2 py-2 rounded hover:bg-[#141c2e] transition-colors">
                      <div className="text-[#8a9bb0] text-sm">{i + 1}</div>
                      <div className="text-white text-sm">{p.summoner_name}</div>
                      <div className="text-[#c89b3c] text-sm font-medium text-right">{formatValue(p.market_value)}</div>
                      <div className="text-[#8a9bb0] text-sm text-right">{p.tier} {p.rank}</div>
                      <div className="text-sm text-right">{p.winrate}%</div>
                    </a>
                  ))}
                </div>

                <div className="col-span-1 bg-[#0d1526] border border-[#1e2a3a] rounded p-5">
                  <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">
                    Größte Gewinner <span className="text-green-400">↑</span> diese Woche
                  </div>
                  {gainers.length === 0 ? (
                    <div className="text-[#4a5a70] text-xs text-center py-6">Noch keine Daten</div>
                  ) : gainers.map((p, i) => (
                    <a key={i} href={'/player/' + p.summoner_name.replace('#', '-').replace(/ /g, '-')} className="flex items-center justify-between py-2 hover:bg-[#141c2e] px-2 rounded transition-colors">
                      <span className="text-white text-sm">{p.summoner_name}</span>
                      <span className="text-green-400 text-sm font-medium">+{formatValue(p.change)}</span>
                    </a>
                  ))}
                </div>

                <div className="col-span-1 bg-[#0d1526] border border-[#1e2a3a] rounded p-5">
                  <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">
                    Größte Verlierer <span className="text-red-400">↓</span> diese Woche
                  </div>
                  {losers.length === 0 ? (
                    <div className="text-[#4a5a70] text-xs text-center py-6">Noch keine Daten</div>
                  ) : losers.map((p, i) => (
                    <a key={i} href={'/player/' + p.summoner_name.replace('#', '-').replace(/ /g, '-')} className="flex items-center justify-between py-2 hover:bg-[#141c2e] px-2 rounded transition-colors">
                      <span className="text-white text-sm">{p.summoner_name}</span>
                      <span className="text-red-400 text-sm font-medium">{formatValue(p.change)}</span>
                    </a>
                  ))}
                </div>

                <div className="col-span-1 bg-[#0d1526] border border-[#1e2a3a] rounded p-5">
                  <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">Wie wird berechnet?</div>
                  <div className="flex flex-col gap-3">
                    {[
                      { label: 'Rang', desc: 'Basis ab Diamond 4' },
                      { label: 'Winrate', desc: 'Letzte 30 Spiele' },
                      { label: 'KDA', desc: 'Rollenspezifisch' },
                      { label: 'Objectives', desc: 'Drake, Baron, Türme' },
                      { label: 'Vision', desc: 'Wards & Vision Score' },
                    ].map(f => (
                      <div key={f.label} className="flex justify-between">
                        <span className="text-white text-xs">{f.label}</span>
                        <span className="text-[#4a5a70] text-xs">{f.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <div className="text-center text-[#4a5a70] text-xs mt-8 pt-6 border-t border-[#1e2a3a]">
          metastats.gg · Nicht offiziell mit Riot Games verbunden · <a href="/datenschutz" className="hover:text-white">Datenschutz</a> · <a href="/impressum" className="hover:text-white">Impressum</a>
        </div>
      </div>
    </main>
  );
}