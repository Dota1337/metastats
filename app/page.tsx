'use client';
import { useState, useEffect, useRef } from 'react';
import Nav from './components/Nav';
import Footer from './components/Footer';
import { useI18n } from './lib/i18n';

// Iconic LoL champions for featured section (Data Dragon IDs)
const FEATURED_CHAMPIONS = [
  { id: 'Jinx', name: 'Jinx', role: 'ADC' },
  { id: 'Yasuo', name: 'Yasuo', role: 'Mid' },
  { id: 'Ahri', name: 'Ahri', role: 'Mid' },
];


export default function Home() {
  const [name, setName] = useState('');
  const [region, setRegion] = useState('euw1');
  const [activeTab, setActiveTab] = useState<'search' | 'marktwert'>('search');
  const [topPlayers, setTopPlayers] = useState<any[]>([]);
  const [gainers, setGainers] = useState<any[]>([]);
  const [losers, setLosers] = useState<any[]>([]);
  const [recentPlayers, setRecentPlayers] = useState<any[]>([]);
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [hoveredCard, setHoveredCard] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    let visitorId = document.cookie.split('; ').find(r => r.startsWith('visitor_id='))?.split('=')[1];
    if (!visitorId) {
      visitorId = crypto.randomUUID();
      document.cookie = `visitor_id=${visitorId}; max-age=31536000; path=/`;
    }
    fetchRecentPlayers();
    setMounted(true);
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
    const slug = encodeURIComponent(gameName) + '--' + encodeURIComponent(tag);
    window.location.href = '/player/' + slug + '?region=' + region;
  };

  const formatValue = (v: number) => {
    return '$' + v.toLocaleString('de-DE');
  };

  const makePlayerLink = (p: any) =>
    '/player/' + encodeURIComponent(p.summoner_name.split('#')[0]) + '--' + encodeURIComponent(p.summoner_name.split('#')[1] || 'EUW') + '?region=' + (p.region || 'euw1');

  return (
    <main className="min-h-screen bg-[#080c18]">
      {/* Particle animation styles */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0) translateX(0); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(-100vh) translateX(20px); opacity: 0; }
        }
        @keyframes glow {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.6; }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .particle {
          position: absolute;
          width: 2px;
          height: 2px;
          background: #c89b3c;
          border-radius: 50%;
          box-shadow: 0 0 6px #c89b3c, 0 0 12px #c89b3c40;
          pointer-events: none;
        }
        .glass {
          background: rgba(13, 21, 38, 0.6);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(200, 155, 60, 0.15);
        }
        .glass-strong {
          background: rgba(13, 21, 38, 0.8);
          backdrop-filter: blur(16px);
          border: 1px solid rgba(200, 155, 60, 0.2);
        }
        .card-3d {
          transition: transform 0.3s ease, box-shadow 0.3s ease;
          transform-style: preserve-3d;
        }
        .card-3d:hover {
          transform: translateY(-4px) perspective(800px) rotateX(2deg);
          box-shadow: 0 12px 40px rgba(200, 155, 60, 0.1), 0 4px 12px rgba(0,0,0,0.3);
        }
        .hero-animate {
          animation: slideIn 0.8s ease-out;
        }
        .gold-border {
          border: 1px solid rgba(200, 155, 60, 0.3);
          box-shadow: 0 0 20px rgba(200, 155, 60, 0.05), inset 0 0 20px rgba(200, 155, 60, 0.02);
        }
      `}</style>

      <Nav active="search" />

      {/* === HERO SECTION === */}
      <div className="relative overflow-hidden">
        {/* Hero background — LoL champion splash art */}
        <div className="absolute inset-0">
          <img
            src="https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Kaisa_0.jpg"
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{ objectPosition: 'center 10%' }}
          />
          {/* Gradient overlay — bottom fades to page bg, center stays visible */}
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(to bottom, rgba(8,12,24,0.3) 0%, rgba(8,12,24,0.4) 50%, rgba(8,12,24,0.9) 100%)',
          }} />
        </div>

        {/* Gold particles (client-only to avoid hydration mismatch) */}
        {mounted && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {Array.from({ length: 20 }).map((_, i) => (
              <div
                key={i}
                className="particle"
                style={{
                  left: `${(i * 5 + 2.5) % 100}%`,
                  bottom: '-10px',
                  animation: `float ${8 + (i * 0.6)}s linear infinite`,
                  animationDelay: `${i * 0.5}s`,
                  width: `${1.5 + (i % 3) * 0.5}px`,
                  height: `${1.5 + (i % 4) * 0.4}px`,
                }}
              />
            ))}
          </div>
        )}

        {/* Gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#080c18] via-transparent to-[#080c18]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#080c18] via-transparent to-[#080c18]" />

        {/* Hero content */}
        <div className="relative px-6 pt-20 pb-16 text-center hero-animate">
          {/* Gold accent line */}
          <div className="w-12 h-0.5 bg-gradient-to-r from-transparent via-[#c89b3c] to-transparent mx-auto mb-6" />

          <div className="text-[#c89b3c] text-xs uppercase tracking-[0.3em] mb-4 font-medium">
            {t('home.subtitle')}
          </div>
          <h1 className="text-white text-5xl font-bold mb-4 tracking-tight">
            meta<span className="text-[#c89b3c]">stats</span>.gg
          </h1>
          <p className="text-[#8a9bb0] text-sm mb-10 max-w-md mx-auto leading-relaxed">
            {t('home.desc')}
          </p>

          {/* Search bar with gold border */}
          <div className="max-w-xl mx-auto gold-border rounded-lg p-0.5 mb-8">
            <div className="flex bg-[#0d1526] rounded-lg overflow-hidden">
              <select
                value={region}
                onChange={e => setRegion(e.target.value)}
                className="bg-[#141c2e] border-r border-[#1e2a3a] text-[#8a9bb0] text-sm px-4 outline-none"
              >
                <option value="euw1">EUW</option>
                <option value="eun1">EUNE</option>
                <option value="na1">NA</option>
                <option value="kr">KR</option>
              </select>
              <input
                className="flex-1 bg-transparent text-white text-sm px-5 py-3.5 outline-none placeholder-[#4a5a70]"
                placeholder={t('home.searchPlaceholder')}
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
              />
              <button
                onClick={search}
                className="bg-[#c89b3c] hover:bg-[#d4a94a] text-[#0a0e1a] text-sm font-semibold px-6 transition-colors"
              >
                {t('home.searchBtn')}
              </button>
            </div>
          </div>

          {/* Tab switcher */}
          <div className="flex justify-center gap-2">
            <button
              onClick={() => setActiveTab('search')}
              className={`px-5 py-2 rounded-lg text-xs font-medium transition-all ${activeTab === 'search' ? 'bg-[#c89b3c]/10 text-[#c89b3c] border border-[#c89b3c]/30' : 'text-[#4a5a70] hover:text-[#8a9bb0]'}`}
            >
              {t('home.searchTab')}
            </button>
            <button
              onClick={() => setActiveTab('marktwert')}
              className={`px-5 py-2 rounded-lg text-xs font-medium transition-all ${activeTab === 'marktwert' ? 'bg-[#c89b3c]/10 text-[#c89b3c] border border-[#c89b3c]/30' : 'text-[#4a5a70] hover:text-[#8a9bb0]'}`}
            >
              {t('home.marketTab')}
            </button>
          </div>
        </div>
      </div>

      {/* === FEATURED CHAMPIONS === */}
      {activeTab === 'search' && (
        <div className="max-w-6xl mx-auto px-6 -mt-2 mb-8">
          <div className="grid grid-cols-3 gap-4">
            {FEATURED_CHAMPIONS.map((champ, i) => (
              <a
                key={champ.id}
                href={`/champions/${champ.id}`}
                className="card-3d glass rounded-xl overflow-hidden group cursor-pointer"
                onMouseEnter={() => setHoveredCard(i)}
                onMouseLeave={() => setHoveredCard(null)}
              >
                <div className="relative h-36 overflow-hidden">
                  <img
                    src={`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${champ.id}_0.jpg`}
                    alt={champ.name}
                    className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-110"
                    style={{ filter: hoveredCard === i ? 'brightness(0.7)' : 'brightness(0.5)' }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0d1526] via-transparent to-transparent" />
                  <div className="absolute bottom-3 left-4">
                    <div className="text-white text-lg font-semibold">{champ.name}</div>
                    <div className="text-[#c89b3c] text-xs">{champ.role}</div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* === MAIN CONTENT === */}
      <div className="max-w-6xl mx-auto px-6 pb-8">
        {activeTab === 'search' && (
          <>
            {/* Stats Cards with 3D effect */}
            <div className="grid grid-cols-4 gap-3 mb-6">
              {[
                { label: t('home.savedPlayers'), value: '2,4M', sub: '+12.4% ' + t('home.thisWeek') },
                { label: t('home.analyzedMatches'), value: '18,7M', sub: t('home.last30days') },
                { label: t('home.avgMarketValue'), value: '$4.200', sub: t('home.topFrom') },
                { label: t('home.activeRegions'), value: '4', sub: 'EUW · EUNE · NA · KR' },
              ].map(s => (
                <div key={s.label} className="card-3d glass rounded-lg p-4">
                  <div className="text-[#8a9bb0] text-xs mb-1">{s.label}</div>
                  <div className="text-white text-2xl font-bold">{s.value}</div>
                  <div className="text-[#c89b3c] text-xs mt-1">{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Recent searches + Features */}
            <div className="grid grid-cols-3 gap-6">
              <div className="col-span-2 glass-strong rounded-xl p-5">
                <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">{t('home.recentSearches')}</div>
                {recentPlayers.length === 0 ? (
                  <div className="text-[#4a5a70] text-sm text-center py-8">{t('home.noSearches')}</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {recentPlayers.map((p, i) => (
                      <a key={i} href={makePlayerLink(p)} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/5 transition-colors">
                        {p.profile_icon_id ? (
                          <img
                            src={`https://ddragon.leagueoflegends.com/cdn/14.1.1/img/profileicon/${p.profile_icon_id}.png`}
                            alt=""
                            className="w-9 h-9 rounded-full border border-[#2a3a50]"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-[#1a2438] border border-[#2a3a50] flex items-center justify-center text-[#8a9bb0] text-xs font-medium">
                            {p.summoner_name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1">
                          <div className="text-white text-sm font-medium">{p.summoner_name}</div>
                          <div className="text-[#4a5a70] text-xs">{p.region?.toUpperCase().replace('1', '')} · Level {p.summoner_level}</div>
                        </div>
                        {p.tier && (
                          <div className="text-[#8a9bb0] text-xs">{p.tier} {p.rank}</div>
                        )}
                        {p.market_value && (
                          <div className="text-[#c89b3c] text-xs font-medium">{formatValue(p.market_value)}</div>
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </div>

              <div className="glass-strong rounded-xl p-5">
                <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">{t('home.features')}</div>
                <div className="flex flex-col gap-4">
                  {[
                    { icon: '◆', title: t('home.feat1title'), desc: t('home.feat1desc') },
                    { icon: '◈', title: t('home.feat2title'), desc: t('home.feat2desc') },
                    { icon: '◉', title: t('home.feat3title'), desc: t('home.feat3desc') },
                    { icon: '◇', title: t('home.feat4title'), desc: t('home.feat4desc') },
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
          </>
        )}

        {activeTab === 'marktwert' && (
          <div className="grid grid-cols-3 gap-6">
            {loadingMarket ? (
              <div className="col-span-3 text-center text-[#8a9bb0] py-20">{t('common.loading')}</div>
            ) : (
              <>
                <div className="col-span-3 glass-strong rounded-xl p-5">
                  <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">{t('home.topMarketValues')}</div>
                  {topPlayers.length === 0 ? (
                    <div className="text-[#4a5a70] text-sm text-center py-8">{t('home.noMarketData')}</div>
                  ) : (
                    <div className="grid grid-cols-5 gap-2 text-xs text-[#4a5a70] px-2 mb-2">
                      <div>#</div><div>{t('mv.player')}</div><div className="text-right">{t('mv.marketValue')}</div>
                      <div className="text-right">{t('mv.rank')}</div><div className="text-right">{t('mv.winrate')}</div>
                    </div>
                  )}
                  {topPlayers.map((p, i) => (
                    <a key={i} href={makePlayerLink(p)} className="grid grid-cols-5 gap-2 px-2 py-2.5 rounded-lg hover:bg-white/5 transition-colors">
                      <div className="text-[#4a5a70] text-sm">{i + 1}</div>
                      <div className="text-white text-sm font-medium">{p.summoner_name}</div>
                      <div className="text-[#c89b3c] text-sm font-medium text-right">{formatValue(p.market_value)}</div>
                      <div className="text-[#8a9bb0] text-sm text-right">{p.tier} {p.rank}</div>
                      <div className="text-sm text-right">{p.winrate}%</div>
                    </a>
                  ))}
                </div>

                <div className="col-span-1 glass-strong rounded-xl p-5">
                  <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">
                    {t('home.winnersWeek')} <span className="text-green-400">&#9650;</span>
                  </div>
                  {gainers.length === 0 ? (
                    <div className="text-[#4a5a70] text-xs text-center py-6">{t('home.noData')}</div>
                  ) : gainers.map((p, i) => (
                    <a key={i} href={makePlayerLink(p)} className="flex items-center justify-between py-2 hover:bg-white/5 px-2 rounded-lg transition-colors">
                      <span className="text-white text-sm">{p.summoner_name}</span>
                      <span className="text-green-400 text-sm font-medium">+{formatValue(p.change)}</span>
                    </a>
                  ))}
                </div>

                <div className="col-span-1 glass-strong rounded-xl p-5">
                  <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">
                    {t('home.losersWeek')} <span className="text-red-400">&#9660;</span>
                  </div>
                  {losers.length === 0 ? (
                    <div className="text-[#4a5a70] text-xs text-center py-6">{t('home.noData')}</div>
                  ) : losers.map((p, i) => (
                    <a key={i} href={makePlayerLink(p)} className="flex items-center justify-between py-2 hover:bg-white/5 px-2 rounded-lg transition-colors">
                      <span className="text-white text-sm">{p.summoner_name}</span>
                      <span className="text-red-400 text-sm font-medium">{formatValue(p.change)}</span>
                    </a>
                  ))}
                </div>

                <div className="col-span-1 glass-strong rounded-xl p-5">
                  <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-4">{t('home.howCalc')}</div>
                  <div className="flex flex-col gap-3">
                    {[
                      { label: t('home.rank'), desc: t('home.baseFromDia') },
                      { label: t('home.winrate'), desc: t('home.last30') },
                      { label: 'KDA', desc: t('home.roleSpecific') },
                      { label: 'Objectives', desc: t('home.objectives') },
                      { label: 'Vision', desc: t('home.vision') },
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

        <Footer />
      </div>
    </main>
  );
}
