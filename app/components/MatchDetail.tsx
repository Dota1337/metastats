'use client';
import { useState, useEffect } from 'react';
import { useI18n } from '../lib/i18n';
import { loadRuneIndex, loadSummonerIndex, RUNE_IMG_BASE, type RuneInfo, type SummonerInfo } from '../lib/dd-assets';

interface Participant {
  summonerName: string;
  champion: string;
  championId: number;
  champLevel: number;
  teamId: number;
  role: string;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  damageDealtToChampions: number;
  damageTaken: number;
  goldEarned: number;
  visionScore: number;
  wardsPlaced: number;
  controlWardsPlaced: number;
  items: number[];
  summoner1Id: number;
  summoner2Id: number;
  win: boolean;
  perks?: {
    primary: number;
    secondary: number;
    keystone: number;
    primarySelections: number[];
    secondarySelections: number[];
    statPerks: { off: number; flex: number; def: number };
  };
}

interface Props {
  match: any;
  ddVersion: string;
  isExpanded: boolean;
  onToggle: () => void;
  formatDuration: (s: number) => string;
  timeAgo: (ts: number) => string;
  getQueueName: (m: any) => string;
  roleLabels: Record<string, string>;
}

export default function MatchDetail({ match, ddVersion, isExpanded, onToggle, formatDuration, timeAgo, getQueueName, roleLabels }: Props) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'overview' | 'damage'>('overview');
  const [runeIdx, setRuneIdx] = useState<Record<number, RuneInfo>>({});
  const [summonerIdx, setSummonerIdx] = useState<Record<number, SummonerInfo>>({});

  useEffect(() => {
    if (!ddVersion) return;
    let cancelled = false;
    loadRuneIndex(ddVersion).then(idx => { if (!cancelled) setRuneIdx(idx); });
    loadSummonerIndex(ddVersion).then(idx => { if (!cancelled) setSummonerIdx(idx); });
    return () => { cancelled = true; };
  }, [ddVersion]);
  const kdaVal = match.deaths > 0
    ? ((match.kills + match.assists) / match.deaths).toFixed(2)
    : 'Perfect';
  const csPerMin = match.gameDuration > 0
    ? (match.cs / (match.gameDuration / 60)).toFixed(1)
    : '0';
  const dmgPerMin = match.gameDuration > 0
    ? Math.round(match.damageDealt / (match.gameDuration / 60))
    : 0;
  const killParticipation = match.teamKills > 0
    ? Math.round(((match.kills + match.assists) / match.teamKills) * 100)
    : 0;
  const dmgShare = match.teamDamage > 0
    ? Math.round((match.damageDealt / match.teamDamage) * 100)
    : 0;
  const goldShare = match.teamGold > 0
    ? Math.round((match.goldEarned / match.teamGold) * 100)
    : 0;

  const participants: Participant[] = match.participants || [];
  const team1 = participants.filter(p => p.teamId === 100);
  const team2 = participants.filter(p => p.teamId === 200);
  const maxDamage = Math.max(...participants.map(p => p.damageDealtToChampions || 0), 1);
  const maxDamageTaken = Math.max(...participants.map(p => p.damageTaken || 0), 1);

  return (
    <div className={'rounded border-l-4 overflow-hidden ' + (match.win ? 'border-green-500 bg-[#0a1f0a]' : 'border-red-500 bg-[#1f0a0a]')}>
      {/* Main compact row */}
      <div className="flex items-center gap-2 sm:gap-3 p-2 sm:p-3 cursor-pointer hover:bg-white/5 transition-colors" onClick={onToggle}>
        <img
          src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${match.champion}.png`}
          alt={match.champion}
          className="w-8 h-8 sm:w-10 sm:h-10 rounded flex-shrink-0"
        />
        <div className="flex-1 min-w-0 sm:flex-none sm:w-auto sm:max-w-[14rem]">
          <div className="text-white text-sm font-medium truncate">{match.champion}</div>
          <div className="text-[#a0b0c5] text-xs whitespace-nowrap">{getQueueName(match)} · {formatDuration(match.gameDuration)}{match.gameCreation ? ` · ${timeAgo(match.gameCreation)}` : ''}</div>
        </div>
        <div className="text-center flex-shrink-0">
          <div className="text-white text-sm font-medium">{match.kills}/{match.deaths}/{match.assists}</div>
          <div className="text-[#a0b0c5] text-xs">{kdaVal} KDA</div>
        </div>
        <div className="hidden sm:block text-center w-14">
          <div className="text-white text-sm font-medium">{match.cs}</div>
          <div className="text-[#a0b0c5] text-xs">{csPerMin}/m</div>
        </div>
        <div className="hidden md:block text-center w-16">
          <div className="text-white text-sm font-medium">{(match.damageDealt / 1000).toFixed(1)}k</div>
          <div className="text-[#a0b0c5] text-xs">{dmgPerMin}/m</div>
        </div>
        <div className="hidden md:block text-center w-12">
          <div className="text-white text-sm font-medium">{match.visionScore}</div>
          <div className="text-[#a0b0c5] text-xs">Vis</div>
        </div>
        <div className="hidden lg:block text-center w-12">
          <div className="text-white text-sm font-medium">{killParticipation}%</div>
          <div className="text-[#a0b0c5] text-xs">KP</div>
        </div>
        <div className="hidden lg:block text-center w-14">
          <div className="text-white text-sm font-medium">{(match.goldEarned / 1000).toFixed(1)}k</div>
          <div className="text-[#a0b0c5] text-xs">Gold</div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2 ml-auto flex-shrink-0">
          {match.pentaKills > 0 && <span className="bg-[#f0c040]/20 text-[#f0c040] text-[10px] font-bold px-1.5 py-0.5 rounded">PENTA</span>}
          {!match.pentaKills && match.quadraKills > 0 && <span className="bg-[#c89b3c]/20 text-[#c89b3c] text-[10px] font-bold px-1.5 py-0.5 rounded">QUADRA</span>}
          {!match.pentaKills && !match.quadraKills && match.tripleKills > 0 && <span className="bg-[#a0b0c5]/20 text-[#a0b0c5] text-[10px] font-bold px-1.5 py-0.5 rounded">TRIPLE</span>}
          <div className={'text-xs sm:text-sm font-medium ' + (match.win ? 'text-green-400' : 'text-red-400')}>
            {match.win ? t('match.win') : t('match.loss')}
          </div>
          <svg className={`w-4 h-4 text-[#7a8aa0] transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Detail row (quick stats) */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-4 px-3 pb-2 text-xs text-[#6a7a90]">
        <span>{roleLabels[match.role] || '-'}</span>
        <span>{t('match.dmgShare')}: {dmgShare}%</span>
        <span>{t('match.goldShare')}: {goldShare}%</span>
        <span>{t('match.wards')}: {match.wardsPlaced}</span>
        <span>{t('match.ctrlWards')}: {match.controlWardsPlaced}</span>
        {match.soloKills > 0 && <span>{t('match.soloKills')}: {match.soloKills}</span>}
        {match.doubleKills > 0 && <span>{t('match.double')}: {match.doubleKills}</span>}
        {match.tripleKills > 0 && <span className="text-[#c89b3c]">{t('match.triple')}: {match.tripleKills}</span>}
        {match.quadraKills > 0 && <span className="text-[#c89b3c]">{t('match.quadra')}: {match.quadraKills}</span>}
        {match.pentaKills > 0 && <span className="text-[#f0c040] font-bold">PENTA!</span>}
        {match.turretKills > 0 && <span>{t('match.turrets')}: {match.turretKills}</span>}
        {match.firstBloodKill && <span className="text-red-400">{t('match.firstBlood')}</span>}
      </div>

      {/* Expanded: Full Game Details */}
      {isExpanded && participants.length > 0 && (
        <div className="border-t border-[#1e2a3a] px-3 py-3">
          {/* Tab Switcher */}
          <div className="flex gap-2 mb-3">
            {(['overview', 'damage'] as const).map(tab => (
              <button
                key={tab}
                onClick={(e) => { e.stopPropagation(); setActiveTab(tab); }}
                className={`px-3 py-1 rounded text-xs transition-colors ${
                  activeTab === tab
                    ? 'bg-[#c89b3c]/20 text-[#c89b3c] border border-[#c89b3c]/30'
                    : 'text-[#7a8aa0] hover:text-[#a0b0c5]'
                }`}
              >
                {tab === 'overview' ? t('match.player') : t('match.damage')}
              </button>
            ))}
          </div>

          {/* Team Tables */}
          {[team1, team2].map((team, ti) => {
            const teamWon = team[0]?.win;
            return (
              <div key={ti} className={`mb-3 rounded overflow-hidden border ${teamWon ? 'border-green-500/20' : 'border-red-500/20'}`}>
                <div className={`px-3 py-1.5 text-xs font-medium ${teamWon ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                  {teamWon ? t('match.win') : t('match.loss')} — Team {ti + 1}
                </div>

                {activeTab === 'overview' && (
                  <>
                    {/* Desktop header */}
                    <div className="hidden md:grid grid-cols-[2rem_3.4rem_1.8rem_1fr_4.5rem_3.5rem_4rem_3rem_3rem_10rem] gap-1 px-2 py-1 text-[#7a8aa0] text-[10px] uppercase bg-[#0a0e1a]">
                      <div />
                      <div />
                      <div />
                      <div>{t('match.player')}</div>
                      <div className="text-center">KDA</div>
                      <div className="text-center">CS</div>
                      <div className="text-center">DMG</div>
                      <div className="text-center">Gold</div>
                      <div className="text-center">Vis</div>
                      <div className="text-center">Items</div>
                    </div>
                    {/* Mobile header */}
                    <div className="md:hidden grid grid-cols-[1.5rem_1fr_4rem_3rem] gap-1 px-2 py-1 text-[#7a8aa0] text-[10px] uppercase bg-[#0a0e1a]">
                      <div />
                      <div>{t('match.player')}</div>
                      <div className="text-center">KDA</div>
                      <div className="text-center">CS</div>
                    </div>
                    {team.map((p, pi) => {
                      const pKda = p.deaths > 0 ? ((p.kills + p.assists) / p.deaths).toFixed(1) : 'P';
                      const sum1 = summonerIdx[p.summoner1Id];
                      const sum2 = summonerIdx[p.summoner2Id];
                      const keystone = p.perks ? runeIdx[p.perks.keystone] : undefined;
                      const secondaryTree = p.perks ? runeIdx[p.perks.secondary] : undefined;
                      return (
                        <div key={pi}>
                          {/* Desktop row */}
                          <div className="hidden md:grid grid-cols-[2rem_3.4rem_1.8rem_1fr_4.5rem_3.5rem_4rem_3rem_3rem_10rem] gap-1 px-2 py-1 items-center hover:bg-white/5 text-xs">
                            <img
                              src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${p.champion}.png`}
                              alt=""
                              className="w-6 h-6 rounded"
                            />
                            <div className="flex items-center gap-0.5">
                              <div className="flex flex-col gap-0.5">
                                {sum1 ? (
                                  <img src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/spell/${sum1.iconFile}`} alt={sum1.key} title={sum1.key} className="w-[14px] h-[14px] rounded-sm" />
                                ) : <div className="w-[14px] h-[14px] rounded-sm bg-[#1e2a3a]" />}
                                {sum2 ? (
                                  <img src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/spell/${sum2.iconFile}`} alt={sum2.key} title={sum2.key} className="w-[14px] h-[14px] rounded-sm" />
                                ) : <div className="w-[14px] h-[14px] rounded-sm bg-[#1e2a3a]" />}
                              </div>
                              <div className="flex flex-col items-center gap-0.5">
                                {keystone ? (
                                  <img src={`${RUNE_IMG_BASE}${keystone.icon}`} alt={keystone.name} title={keystone.name} className="w-[18px] h-[18px] rounded-full bg-black/40" />
                                ) : <div className="w-[18px] h-[18px] rounded-full bg-[#1e2a3a]" />}
                                {secondaryTree ? (
                                  <img src={`${RUNE_IMG_BASE}${secondaryTree.icon}`} alt={secondaryTree.name} title={secondaryTree.name} className="w-[12px] h-[12px] rounded-full bg-black/40" />
                                ) : <div className="w-[12px] h-[12px] rounded-full bg-[#1e2a3a]" />}
                              </div>
                            </div>
                            <div className="text-[#7a8aa0] text-[10px]">{p.champLevel}</div>
                            <div className="text-white truncate text-xs">{p.summonerName.split('#')[0]}</div>
                            <div className="text-center">
                              <span className="text-white">{p.kills}/{p.deaths}/{p.assists}</span>
                              <span className="text-[#7a8aa0] ml-1">({pKda})</span>
                            </div>
                            <div className="text-[#a0b0c5] text-center">{p.cs}</div>
                            <div className="text-[#a0b0c5] text-center">{(p.damageDealtToChampions / 1000).toFixed(1)}k</div>
                            <div className="text-[#c89b3c] text-center">{(p.goldEarned / 1000).toFixed(1)}k</div>
                            <div className="text-[#a0b0c5] text-center">{p.visionScore}</div>
                            <div className="flex gap-0.5 justify-center">
                              {p.items.filter(id => id > 0).map((itemId, ii) => (
                                <img
                                  key={ii}
                                  src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/item/${itemId}.png`}
                                  alt=""
                                  className="w-5 h-5 rounded-sm"
                                />
                              ))}
                            </div>
                          </div>
                          {/* Mobile row */}
                          <div className="md:hidden grid grid-cols-[1.5rem_1fr_4rem_3rem] gap-1 px-2 py-1 items-center hover:bg-white/5 text-xs">
                            <img
                              src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${p.champion}.png`}
                              alt=""
                              className="w-5 h-5 rounded"
                            />
                            <div className="text-white truncate text-xs">{p.summonerName.split('#')[0]}</div>
                            <div className="text-center text-white text-xs">{p.kills}/{p.deaths}/{p.assists}</div>
                            <div className="text-[#a0b0c5] text-center text-xs">{p.cs}</div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}

                {activeTab === 'damage' && (
                  <>
                    <div className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-2 px-2 py-1 text-[#7a8aa0] text-[10px] uppercase bg-[#0a0e1a]">
                      <div />
                      <div>{t('match.player')}</div>
                      <div>{t('match.damageDealt')}</div>
                      <div>{t('match.damageTaken')}</div>
                    </div>
                    {team.map((p, pi) => (
                      <div key={pi} className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-2 px-2 py-1.5 items-center text-xs">
                        <img
                          src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${p.champion}.png`}
                          alt=""
                          className="w-6 h-6 rounded"
                        />
                        <div className="text-white truncate">{p.summonerName.split('#')[0]}</div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-3 bg-[#141c2e] rounded overflow-hidden">
                            <div
                              className="h-full bg-red-500/60 rounded"
                              style={{ width: `${(p.damageDealtToChampions / maxDamage) * 100}%` }}
                            />
                          </div>
                          <span className="text-white w-10 text-right">{(p.damageDealtToChampions / 1000).toFixed(1)}k</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-3 bg-[#141c2e] rounded overflow-hidden">
                            <div
                              className="h-full bg-blue-500/60 rounded"
                              style={{ width: `${(p.damageTaken / maxDamageTaken) * 100}%` }}
                            />
                          </div>
                          <span className="text-white w-10 text-right">{(p.damageTaken / 1000).toFixed(1)}k</span>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
