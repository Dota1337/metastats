'use client';
import { useState, useEffect } from 'react';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import PageHero from '../components/PageHero';
import { useI18n } from '../lib/i18n';

const TIER_COLORS: Record<string, string> = {
  CHALLENGER: '#f0c040',
  GRANDMASTER: '#e44040',
  MASTER: '#9d48e0',
  DIAMOND: '#576cce',
};

interface Player {
  id: number;
  name: string;
  region: string;
  tier: string;
  rank: string;
  winrate: number;
  marketValue: number;
  level: number;
  profileIcon: number;
  weeklyChange: number;
  weeklyChangePct: number;
}

export default function MarktwertPage() {
  const { t } = useI18n();

  const REGIONS = [
    { value: 'all', label: t('mv.allRegions') },
    { value: 'euw1', label: 'EUW' }, { value: 'eun1', label: 'EUNE' },
    { value: 'na1', label: 'NA' }, { value: 'kr', label: 'KR' },
    { value: 'br1', label: 'BR' }, { value: 'la1', label: 'LAN' },
    { value: 'la2', label: 'LAS' }, { value: 'oc1', label: 'OCE' },
    { value: 'tr1', label: 'TR' }, { value: 'ru', label: 'RU' },
    { value: 'jp1', label: 'JP' }, { value: 'ph2', label: 'PH' },
    { value: 'sg2', label: 'SG' }, { value: 'th2', label: 'TH' },
    { value: 'tw2', label: 'TW' }, { value: 'vn2', label: 'VN' },
    { value: 'me1', label: 'ME' },
  ];

  const TIERS = [
    { value: 'all', label: t('mv.allElos'), color: undefined as string | undefined },
    { value: 'CHALLENGER', label: t('tier.challenger'), color: '#f0c040' },
    { value: 'GRANDMASTER', label: t('tier.grandmaster'), color: '#e44040' },
    { value: 'MASTER', label: t('tier.master'), color: '#9d48e0' },
    { value: 'DIAMOND', label: t('tier.diamond'), color: '#576cce' },
  ];

  const [players, setPlayers] = useState<Player[]>([]);
  const [gainers, setGainers] = useState<Record<string, Player[]>>({});
  const [losers, setLosers] = useState<Record<string, Player[]>>({});
  const [tierStats, setTierStats] = useState<Record<string, { count: number; avgValue: number; minValue: number; maxValue: number }>>({});
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState('all');
  const [tier, setTier] = useState('all');
  const [total, setTotal] = useState(0);

  useEffect(() => {
    fetchData();
  }, [region, tier]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/marktwert?region=${region}&tier=${tier}`);
      const data = await res.json();
      setPlayers(data.players || []);
      setGainers(data.gainersPerTier || {});
      setLosers(data.losersPerTier || {});
      setTierStats(data.tierStats || {});
      setTotal(data.total || 0);
    } catch {
      setPlayers([]);
    }
    setLoading(false);
  };

  const formatValue = (v: number) => {
    return '$' + v.toLocaleString('de-DE');
  };

  const formatChange = (v: number) => {
    const prefix = v > 0 ? '+' : '';
    return prefix + '$' + Math.abs(v).toLocaleString('de-DE');
  };

  const makePlayerLink = (name: string, playerRegion?: string) => {
    if (!name) return '#';
    const parts = name.split('#');
    return '/player/' + encodeURIComponent(parts[0]) + '--' + encodeURIComponent(parts[1] || 'EUW') + '?region=' + (playerRegion || 'euw1');
  };

  const activeTiers = tier === 'all'
    ? ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND']
    : [tier];

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="marktwert" />

      <PageHero title={t('mv.title')} subtitle={t('mv.subtitle')} leftChampion="Jinx" rightChampion="Caitlyn" />

      <div className="max-w-6xl mx-auto px-6 pb-8">

        {/* Filters */}
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4 mb-4 flex flex-wrap items-start gap-4">
          <div className="w-full sm:w-auto">
            <div className="text-[#8a9bb0] text-xs mb-2">{t('mv.region')}</div>
            <div className="flex flex-wrap gap-1">
              {REGIONS.map(r => (
                <button
                  key={r.value}
                  onClick={() => setRegion(r.value)}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    region === r.value ? 'bg-[#c89b3c] text-[#0a0e1a]' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[#8a9bb0] text-xs mb-2">{t('mv.elo')}</div>
            <div className="flex gap-1">
              {TIERS.map(tr => (
                <button
                  key={tr.value}
                  onClick={() => setTier(tr.value)}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                    tier === tr.value ? 'text-[#0a0e1a]' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'
                  }`}
                  style={tier === tr.value ? { backgroundColor: tr.color || '#c89b3c' } : {}}
                >
                  {tr.label}
                </button>
              ))}
            </div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[#8a9bb0] text-xs">{t('mv.ratedPlayers')}</div>
            <div className="text-white text-xl font-medium">{total}</div>
          </div>
        </div>

        {loading ? (
          <div className="text-center text-[#8a9bb0] py-20">{t('common.loading')}</div>
        ) : players.length === 0 ? (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-8 text-center">
            <div className="text-[#8a9bb0] text-sm mb-2">{t('mv.noData')}</div>
            <div className="text-[#4a5a70] text-xs">
              {t('mv.noDataDesc')}
              <br />{t('mv.buildDb')} <a href="/" className="text-[#c89b3c] hover:text-white">{t('mv.searchOnHome')}</a>{t('mv.buildDbEnd')}
            </div>
          </div>
        ) : (
          <>
            {/* Tier Stats Overview */}
            {Object.keys(tierStats).length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND'].map(tr => {
                  const stats = tierStats[tr];
                  if (!stats) return (
                    <div key={tr} className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3 opacity-50">
                      <div className="text-xs font-medium mb-1" style={{ color: TIER_COLORS[tr] }}>{tr}</div>
                      <div className="text-[#4a5a70] text-xs">{t('mv.noDataTier')}</div>
                    </div>
                  );
                  return (
                    <div key={tr} className="bg-[#0d1526] border border-[#1e2a3a] rounded p-3">
                      <div className="text-xs font-medium mb-1" style={{ color: TIER_COLORS[tr] }}>{tr}</div>
                      <div className="text-white text-lg font-medium">{formatValue(stats.avgValue)}</div>
                      <div className="text-[#4a5a70] text-xs mt-0.5">
                        {stats.count} {t('mv.players')} · {formatValue(stats.minValue)} - {formatValue(stats.maxValue)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Top Market Values */}
            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-[#1e2a3a] bg-[#0a0e1a]">
                <div className="text-[#8a9bb0] text-xs uppercase tracking-widest">{t('mv.topValues')}</div>
              </div>
              {/* Desktop header */}
              <div className="hidden md:grid grid-cols-[3rem_1fr_5rem_5rem_6rem_6rem] gap-3 px-4 py-2 border-b border-[#1e2a3a] text-[#4a5a70] text-xs">
                <div>#</div>
                <div>{t('mv.player')}</div>
                <div className="text-right">{t('mv.rank')}</div>
                <div className="text-right">{t('mv.winrate')}</div>
                <div className="text-right">{t('mv.marketValue')}</div>
                <div className="text-right">{t('mv.7days')}</div>
              </div>
              {players.slice(0, 25).map((p, i) => (
                <a
                  key={p.id}
                  href={makePlayerLink(p.name, p.region)}
                  className="block md:grid md:grid-cols-[3rem_1fr_5rem_5rem_6rem_6rem] gap-3 px-4 py-2.5 border-b border-[#1e2a3a]/30 hover:bg-[#141c2e] transition-colors items-center"
                >
                  {/* Mobile */}
                  <div className="md:hidden flex items-center gap-3">
                    <div className={`text-sm w-6 flex-shrink-0 ${i < 3 ? 'font-bold' : ''} ${
                      i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-[#4a5a70]'
                    }`}>{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-sm font-medium truncate">{p.name}</div>
                      <div className="text-[#4a5a70] text-xs">{p.tier} {p.rank} · {p.winrate}%</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-[#c89b3c] text-sm font-medium">{formatValue(p.marketValue)}</div>
                      {p.weeklyChange !== 0 && (
                        <div className={`text-xs ${p.weeklyChange > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {formatChange(p.weeklyChange)}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Desktop */}
                  <div className="hidden md:contents">
                    <div className={`text-sm ${i < 3 ? 'font-bold' : ''} ${
                      i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-[#4a5a70]'
                    }`}>
                      {i + 1}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-white text-sm font-medium">{p.name}</div>
                      <span className="text-[#4a5a70] text-xs">{(p.region || '').toUpperCase().replace('1', '')}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-medium" style={{ color: TIER_COLORS[p.tier] || '#8a9bb0' }}>
                        {p.tier} {p.rank}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className={`text-sm ${p.winrate >= 55 ? 'text-green-400' : p.winrate >= 50 ? 'text-white' : 'text-red-400'}`}>
                        {p.winrate}%
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[#c89b3c] text-sm font-medium">{formatValue(p.marketValue)}</span>
                    </div>
                    <div className="text-right">
                      {p.weeklyChange !== 0 ? (
                        <span className={`text-xs font-medium ${p.weeklyChange > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {formatChange(p.weeklyChange)}
                          <span className="text-[#4a5a70] ml-1">({p.weeklyChangePct > 0 ? '+' : ''}{p.weeklyChangePct}%)</span>
                        </span>
                      ) : (
                        <span className="text-[#4a5a70] text-xs">-</span>
                      )}
                    </div>
                  </div>
                </a>
              ))}
            </div>

            {/* Weekly Movers */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              {/* Gainers */}
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1e2a3a] bg-[#0a0e1a]">
                  <div className="text-green-400 text-xs uppercase tracking-widest flex items-center gap-2">
                    {t('mv.gainersWeek')} &#9650;
                  </div>
                </div>
                {activeTiers.map(tr => {
                  const tierGainers = gainers[tr] || [];
                  if (tierGainers.length === 0) return null;
                  return (
                    <div key={tr} className="border-b border-[#1e2a3a]/30">
                      <div className="px-4 py-1.5 bg-[#0a0e1a]/50">
                        <span className="text-xs font-medium" style={{ color: TIER_COLORS[tr] }}>{tr}</span>
                      </div>
                      {tierGainers.map((p, i) => (
                        <a
                          key={i}
                          href={makePlayerLink(p.name, p.region)}
                          className="flex items-center justify-between px-4 py-2 hover:bg-[#141c2e] transition-colors"
                        >
                          <div>
                            <div className="text-white text-sm">{p.name}</div>
                            <div className="text-[#4a5a70] text-xs">{formatValue(p.marketValue)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-green-400 text-sm font-medium">{formatChange(p.weeklyChange)}</div>
                            <div className="text-green-400/60 text-xs">+{p.weeklyChangePct}%</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  );
                })}
                {activeTiers.every(tr => !(gainers[tr]?.length)) && (
                  <div className="px-4 py-6 text-center text-[#4a5a70] text-xs">
                    {t('mv.noWeeklyData')}
                  </div>
                )}
              </div>

              {/* Losers */}
              <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1e2a3a] bg-[#0a0e1a]">
                  <div className="text-red-400 text-xs uppercase tracking-widest flex items-center gap-2">
                    {t('mv.losersWeek')} &#9660;
                  </div>
                </div>
                {activeTiers.map(tr => {
                  const tierLosers = losers[tr] || [];
                  if (tierLosers.length === 0) return null;
                  return (
                    <div key={tr} className="border-b border-[#1e2a3a]/30">
                      <div className="px-4 py-1.5 bg-[#0a0e1a]/50">
                        <span className="text-xs font-medium" style={{ color: TIER_COLORS[tr] }}>{tr}</span>
                      </div>
                      {tierLosers.map((p, i) => (
                        <a
                          key={i}
                          href={makePlayerLink(p.name, p.region)}
                          className="flex items-center justify-between px-4 py-2 hover:bg-[#141c2e] transition-colors"
                        >
                          <div>
                            <div className="text-white text-sm">{p.name}</div>
                            <div className="text-[#4a5a70] text-xs">{formatValue(p.marketValue)}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-red-400 text-sm font-medium">{formatChange(p.weeklyChange)}</div>
                            <div className="text-red-400/60 text-xs">{p.weeklyChangePct}%</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  );
                })}
                {activeTiers.every(tr => !(losers[tr]?.length)) && (
                  <div className="px-4 py-6 text-center text-[#4a5a70] text-xs">
                    {t('mv.noWeeklyData')}
                  </div>
                )}
              </div>
            </div>

            {/* Market Value Scale */}
            <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
              <div className="text-[#8a9bb0] text-xs uppercase tracking-widest mb-3">{t('mv.scale')}</div>
              <div className="flex flex-col gap-2">
                {[
                  { tier: 'Challenger', range: '$25.000 - $750.000', desc: '#1 bekommt den Höchstwert, Top 10 ab $200k', color: '#f0c040' },
                  { tier: 'Grandmaster', range: '$8.000 - $25.000', desc: 'Skaliert linear mit LP (bis 400 LP)', color: '#e44040' },
                  { tier: 'Master', range: '$2.000 - $8.000', desc: 'Skaliert linear mit LP (bis 200 LP)', color: '#9d48e0' },
                  { tier: 'Diamond', range: '$10 - $2.000', desc: 'Diamond IV ($10) bis Diamond I ($2.000)', color: '#576cce' },
                ].map(s => (
                  <div key={s.tier} className="flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-2 sm:gap-3 py-1">
                    <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5 sm:mt-0" style={{ backgroundColor: s.color }} />
                    <div className="w-20 sm:w-28 text-sm font-medium flex-shrink-0" style={{ color: s.color }}>{s.tier}</div>
                    <div className="w-full sm:w-40 text-white text-sm flex-shrink-0">{s.range}</div>
                    <div className="text-[#4a5a70] text-xs flex-1">{s.desc}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-[#1e2a3a] text-[#4a5a70] text-xs">
                {t('mv.scaleDesc')}
              </div>
            </div>
          </>
        )}

        <Footer />
      </div>
    </main>
  );
}
