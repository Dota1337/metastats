'use client';
import { useState, useEffect } from 'react';
import { useI18n, LOCALE_MAP } from '../lib/i18n';

interface Anomaly {
  type: string;
  severity: string;
  title: string;
  description: string;
  playerName: string;
  playerId: number;
  detectedAt: string;
  tier: string | null;
  rank: string | null;
  winrate: number | null;
  marketValue: number | null;
  region: string | null;
  summonerLevel: number | null;
  puuid: string | null;
}

interface TransferPrediction {
  playerName: string;
  currentTeam: string;
  role: string;
  probability: number;
  reasons: string[];
  predictedDirection: string;
  marketValue: number | null;
  marketTrend: string;
  tier: string | null;
  riotId: string | null;
  winrate: number | null;
  region: string;
  teamRegion: string;
  gamesPlayed: number | null;
  teamAvgPlace: number | null;
  contractEnd: string | null;
}

type Tab = 'anomalies' | 'transfers';

const SEVERITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  significant: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
  notable: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20' },
  info: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
};

const TYPE_ICONS: Record<string, string> = {
  market_surge: '\u2191\u2191',   // ↑↑
  market_crash: '\u2193\u2193',   // ↓↓
  smurf_suspect: '\u{1F50D}',    // 🔍
  hot_streak: '\u{1F525}',       // 🔥
  cold_streak: '\u2744',         // ❄
  performance_spike: '\u26A1',   // ⚡
  performance_drop: '\u{1F4C9}', // 📉
};

const TREND_ICONS: Record<string, { icon: string; color: string }> = {
  rising: { icon: '\u2191', color: 'text-green-400' },
  stable: { icon: '\u2192', color: 'text-[#a0b0c5]' },
  falling: { icon: '\u2193', color: 'text-red-400' },
};

export default function MarketInsights() {
  const { t, lang } = useI18n();
  const locale = LOCALE_MAP[lang];
  const [tab, setTab] = useState<Tab>('transfers');
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [transfers, setTransfers] = useState<TransferPrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    if (tab === 'anomalies' && anomalies.length === 0) fetchAnomalies();
    if (tab === 'transfers' && transfers.length === 0) fetchTransfers();
  }, [expanded, tab]);

  const fetchAnomalies = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/anomalies');
      const data = await res.json();
      if (data.anomalies) setAnomalies(data.anomalies);
    } catch {} finally { setLoading(false); }
  };

  const fetchTransfers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/transfer-predictions');
      const data = await res.json();
      if (data.predictions) setTransfers(data.predictions);
    } catch {} finally { setLoading(false); }
  };

  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg overflow-hidden mb-4">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#141c2e] transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#c89b3c] to-[#785a28] flex items-center justify-center text-[10px] font-bold text-white">
            AI
          </div>
          <div>
            <div className="text-white text-sm font-medium">{t('mi.title')}</div>
            <div className="text-[#7a8aa0] text-[10px]">{t('mi.subtitle')}</div>
          </div>
        </div>
        <svg className={`w-4 h-4 text-[#7a8aa0] transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {/* Tabs */}
          <div className="flex gap-1 bg-[#141c2e] rounded-lg p-0.5 mb-3">
            <button
              onClick={() => setTab('transfers')}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                tab === 'transfers' ? 'bg-[#1e2a3a] text-white shadow-sm' : 'text-[#a0b0c5] hover:text-white'
              }`}
            >
              {t('mi.transferRadar')}
            </button>
            <button
              onClick={() => setTab('anomalies')}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                tab === 'anomalies' ? 'bg-[#1e2a3a] text-white shadow-sm' : 'text-[#a0b0c5] hover:text-white'
              }`}
            >
              {t('mi.anomalies')}
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 border-2 border-[#c89b3c] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : tab === 'transfers' ? (
            <div className="space-y-2">
              {transfers.length === 0 ? (
                <div className="text-[#7a8aa0] text-xs text-center py-6">{t('mi.noTransfers')}</div>
              ) : (
                transfers.slice(0, 15).map((tp, i) => {
                  const playerLink = tp.riotId ? `/player/${encodeURIComponent(tp.riotId.split('#')[0])}--${encodeURIComponent(tp.riotId.split('#')[1] || 'KR1')}?region=kr` : null;
                  const Wrapper = playerLink ? 'a' : 'div';
                  const directionLabel = tp.predictedDirection === 'upgrade' ? t('mi.upgrade') : tp.predictedDirection === 'lateral' ? t('mi.lateral') : tp.predictedDirection === 'downgrade' ? t('mi.downgrade') : null;
                  const directionColor = tp.predictedDirection === 'upgrade' ? 'text-green-400' : tp.predictedDirection === 'downgrade' ? 'text-red-400' : 'text-[#a0b0c5]';

                  return (
                    <Wrapper
                      key={i}
                      {...(playerLink ? { href: playerLink } : {})}
                      className={`block bg-[#141c2e] border border-[#1e2a3a] rounded-lg px-4 py-3 ${playerLink ? 'hover:border-[#c89b3c]/40 cursor-pointer transition-colors' : ''}`}
                    >
                      {/* Row 1: Name + Probability */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-white text-sm font-semibold">{tp.playerName}</span>
                          <span className="text-[#a0b0c5] text-xs bg-[#1e2a3a] px-1.5 py-0.5 rounded">{tp.role}</span>
                          {playerLink && (
                            <svg className="w-3.5 h-3.5 text-[#7a8aa0]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          )}
                        </div>
                        <div className="text-right">
                          <span className={`text-lg font-bold ${
                            tp.probability >= 60 ? 'text-red-400' : tp.probability >= 40 ? 'text-[#c89b3c]' : 'text-[#a0b0c5]'
                          }`}>
                            {tp.probability}%
                          </span>
                          <div className="text-[#7a8aa0] text-[10px]">{t('mi.transferProb')}</div>
                        </div>
                      </div>

                      {/* Row 2: Team + Stats */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <div>
                            <div className="text-[#a0b0c5] text-xs">{tp.currentTeam}</div>
                            {tp.teamRegion && <div className="text-[#7a8aa0] text-[10px]">{tp.teamRegion}</div>}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {tp.winrate && (
                            <div className="text-center">
                              <div className={`text-xs font-medium ${tp.winrate >= 55 ? 'text-green-400' : tp.winrate < 45 ? 'text-red-400' : 'text-white'}`}>
                                {tp.winrate}%
                              </div>
                              <div className="text-[#7a8aa0] text-[10px]">{t('mv.winrate')}</div>
                            </div>
                          )}
                          {tp.tier && (
                            <div className="text-center">
                              <div className="text-xs font-medium text-white">{tp.tier}</div>
                              <div className="text-[#7a8aa0] text-[10px]">{t('mv.rank')}</div>
                            </div>
                          )}
                          {tp.marketValue && (
                            <div className="text-center">
                              <div className="text-xs font-medium text-[#c89b3c] flex items-center gap-1">
                                ${tp.marketValue.toLocaleString(locale)}
                                <span className={TREND_ICONS[tp.marketTrend]?.color || ''}>
                                  {TREND_ICONS[tp.marketTrend]?.icon || ''}
                                </span>
                              </div>
                              <div className="text-[#7a8aa0] text-[10px]">{t('mv.marketValue')}</div>
                            </div>
                          )}
                          {tp.teamAvgPlace && (
                            <div className="text-center">
                              <div className={`text-xs font-medium ${tp.teamAvgPlace <= 3 ? 'text-green-400' : tp.teamAvgPlace > 6 ? 'text-red-400' : 'text-white'}`}>
                                Ø {tp.teamAvgPlace.toFixed(1)}
                              </div>
                              <div className="text-[#7a8aa0] text-[10px]">{t('mi.teamPlace')}</div>
                            </div>
                          )}
                          <div className="text-center">
                            <div className={`text-xs font-medium ${
                              !tp.contractEnd ? 'text-[#7a8aa0]' :
                              new Date(tp.contractEnd) < new Date() ? 'text-red-400' :
                              new Date(tp.contractEnd).getTime() - Date.now() < 180 * 86400000 ? 'text-yellow-400' :
                              'text-white'
                            }`}>
                              {tp.contractEnd ? new Date(tp.contractEnd).toLocaleDateString(locale, { month: 'short', year: 'numeric' }) : 'n/a'}
                            </div>
                            <div className="text-[#7a8aa0] text-[10px]">{t('mi.contractUntil')}</div>
                          </div>
                        </div>
                      </div>

                      {/* Probability bar */}
                      <div className="w-full h-1.5 bg-[#1e2a3a] rounded-full mb-2">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${tp.probability}%`,
                            backgroundColor: tp.probability >= 60 ? '#f87171' : tp.probability >= 40 ? '#f0c040' : '#7a8aa0',
                          }}
                        />
                      </div>

                      {/* Reasons + Direction */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5 flex-1">
                          {tp.reasons.map((r, j) => (
                            <div key={j} className="text-[#a0b0c5] text-xs flex items-start gap-1.5">
                              <span className="text-[#c89b3c] mt-0.5">·</span>{r}
                            </div>
                          ))}
                        </div>
                        {directionLabel && (
                          <span className={`${directionColor} text-[10px] font-medium bg-[#0d1526] px-2 py-0.5 rounded-full border border-[#1e2a3a] flex-shrink-0`}>
                            {directionLabel}
                          </span>
                        )}
                      </div>
                    </Wrapper>
                  );
                })
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {anomalies.length === 0 ? (
                <div className="text-[#7a8aa0] text-xs text-center py-6">{t('mi.noAnomalies')}</div>
              ) : (
                anomalies.slice(0, 15).map((a, i) => {
                  const colors = SEVERITY_COLORS[a.severity] || SEVERITY_COLORS.info;
                  const playerLink = a.playerName && a.playerName.includes('#')
                    ? `/player/${encodeURIComponent(a.playerName.split('#')[0])}--${encodeURIComponent(a.playerName.split('#')[1])}?region=${a.region || 'euw1'}`
                    : null;
                  const Wrapper = playerLink ? 'a' : 'div';

                  const TIER_COLORS: Record<string, string> = {
                    CHALLENGER: '#f0c040', GRANDMASTER: '#e44040', MASTER: '#9d48e0',
                    DIAMOND: '#576cce', EMERALD: '#2dba6e', PLATINUM: '#4ea38c',
                  };

                  return (
                    <Wrapper
                      key={i}
                      {...(playerLink ? { href: playerLink } : {})}
                      className={`block ${colors.bg} border ${colors.border} rounded-lg px-4 py-3 ${playerLink ? 'hover:border-[#c89b3c]/40 cursor-pointer transition-colors' : ''}`}
                    >
                      {/* Header: Icon + Name + Badge */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{TYPE_ICONS[a.type] || '\u26A0'}</span>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-white text-sm font-semibold">{a.playerName}</span>
                              {playerLink && (
                                <svg className="w-3.5 h-3.5 text-[#7a8aa0]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                              )}
                            </div>
                            <span className={`${colors.text} text-xs font-medium`}>{a.title}</span>
                          </div>
                        </div>
                        {a.severity === 'significant' && (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400">{t('mi.notable')}</span>
                        )}
                      </div>

                      {/* Description */}
                      <div className="text-[#a0b0c5] text-xs mb-2">{a.description}</div>

                      {/* Player stats row */}
                      <div className="flex items-center gap-4 flex-wrap">
                        {a.tier && (
                          <div className="text-center">
                            <div className="text-xs font-medium" style={{ color: TIER_COLORS[a.tier] || '#a0b0c5' }}>
                              {a.tier} {a.rank && a.rank !== 'I' ? a.rank : ''}
                            </div>
                            <div className="text-[#7a8aa0] text-[10px]">{t('mv.rank')}</div>
                          </div>
                        )}
                        {a.winrate != null && (
                          <div className="text-center">
                            <div className={`text-xs font-medium ${a.winrate >= 55 ? 'text-green-400' : a.winrate < 45 ? 'text-red-400' : 'text-white'}`}>
                              {a.winrate}%
                            </div>
                            <div className="text-[#7a8aa0] text-[10px]">{t('mv.winrate')}</div>
                          </div>
                        )}
                        {a.marketValue != null && a.marketValue > 0 && (
                          <div className="text-center">
                            <div className="text-xs font-medium text-[#c89b3c]">${a.marketValue.toLocaleString(locale)}</div>
                            <div className="text-[#7a8aa0] text-[10px]">{t('mv.marketValue')}</div>
                          </div>
                        )}
                        {a.region && (
                          <div className="text-center">
                            <div className="text-xs font-medium text-white">{a.region.toUpperCase()}</div>
                            <div className="text-[#7a8aa0] text-[10px]">{t('lb.region')}</div>
                          </div>
                        )}
                        {a.summonerLevel != null && (
                          <div className="text-center">
                            <div className="text-xs font-medium text-white">{a.summonerLevel}</div>
                            <div className="text-[#7a8aa0] text-[10px]">{t('player.level')}</div>
                          </div>
                        )}
                      </div>
                    </Wrapper>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
