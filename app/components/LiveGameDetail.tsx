'use client';
import { useState, useEffect } from 'react';
import { formatTier, type SoloRank } from '../lib/rank-format';
import { useI18n } from '../lib/i18n';

interface Props {
  gameData: any;
  ddVersion: string;
  championMap: Record<number, { id: string; name: string }>;
  region: string;
}

interface PlayerData {
  puuid: string;
  summonerName: string;
  champion: string;
  championId: number;
  teamId: number;
  spell1Id: number;
  spell2Id: number;
  perks?: { perkStyle: number; perkSubStyle: number };
  // null = ungewertet, 'unknown' = Rang gerade nicht abrufbar (Riot-Ueberlast)
  ranked?: SoloRank | null | 'unknown';
  loading: boolean;
}

const SUMMONER_SPELL_MAP: Record<number, string> = {
  1: 'SummonerBoost', 4: 'SummonerFlash', 6: 'SummonerHaste',
  7: 'SummonerHeal', 11: 'SummonerSmite', 12: 'SummonerTeleport',
  14: 'SummonerDot', 21: 'SummonerBarrier', 3: 'SummonerExhaust',
  32: 'SummonerSnowball',
};

export default function LiveGameDetail({ gameData, ddVersion, championMap, region }: Props) {
  const { t } = useI18n();
  const [players, setPlayers] = useState<PlayerData[]>([]);

  useEffect(() => {
    if (!gameData?.participants) return;

    const initial: PlayerData[] = gameData.participants.map((p: any) => {
      const champ = championMap[p.championId];
      return {
        puuid: p.puuid || '',
        summonerName: p.riotId || p.summonerName || 'Unknown',
        champion: champ?.id || 'Unknown',
        championId: p.championId,
        teamId: p.teamId,
        spell1Id: p.spell1Id,
        spell2Id: p.spell2Id,
        perks: p.perks ? { perkStyle: p.perks.perkStyle, perkSubStyle: p.perks.perkSubStyle } : undefined,
        ranked: null,
        loading: true,
      };
    });
    setPlayers(initial);

    // Raenge aller Mitspieler in EINEM schlanken Aufruf (nur league-v4) —
    // nicht /api/summoner je Teilnehmer, der den ganzen Profil-Abruf macht.
    const puuids = initial.map(p => p.puuid).filter(Boolean);
    if (puuids.length === 0) {
      setPlayers(prev => prev.map(pl => ({ ...pl, ranked: 'unknown', loading: false })));
      return;
    }
    const ctrl = new AbortController();
    fetch(`/api/live-game/ranks?puuids=${puuids.map(encodeURIComponent).join(',')}&region=${region}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const ranks: Record<string, SoloRank | null | 'unknown'> = data?.ranks || {};
        setPlayers(prev => prev.map(pl => ({
          ...pl,
          // ohne puuid (von Riot anonymisiert) ist der Rang unbekannt, nicht ungewertet
          ranked: pl.puuid && pl.puuid in ranks ? ranks[pl.puuid] : 'unknown',
          loading: false,
        })));
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setPlayers(prev => prev.map(pl => ({ ...pl, ranked: 'unknown', loading: false })));
      });
    return () => ctrl.abort();
  }, [gameData, championMap, region]);

  if (!gameData?.participants || players.length === 0) return null;

  const team1 = players.filter(p => p.teamId === 100);
  const team2 = players.filter(p => p.teamId === 200);

  // Bans
  const bans = gameData.bannedChampions || [];
  const team1Bans = bans.filter((b: any) => b.teamId === 100);
  const team2Bans = bans.filter((b: any) => b.teamId === 200);

  const gameDuration = gameData.gameLength ? Math.floor(gameData.gameLength / 60) : 0;

  const renderTeam = (team: PlayerData[], teamLabel: string, teamBans: any[]) => (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-white text-sm font-medium">{teamLabel}</div>
        {teamBans.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-fg-muted text-xs mr-1">{t('live.bans')}</span>
            {teamBans.map((b: any, i: number) => {
              const c = championMap[b.championId];
              return c ? (
                <img
                  key={i}
                  src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${c.id}.png`}
                  alt={c.name}
                  className="w-5 h-5 rounded grayscale opacity-60"
                  title={c.name}
                />
              ) : null;
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {team.map((p, i) => {
          const wr = p.ranked && p.ranked !== 'unknown' && p.ranked.wins + p.ranked.losses > 0
            ? Math.round((p.ranked.wins / (p.ranked.wins + p.ranked.losses)) * 100)
            : null;
          const spell1 = SUMMONER_SPELL_MAP[p.spell1Id];
          const spell2 = SUMMONER_SPELL_MAP[p.spell2Id];

          return (
            <div key={i} className="grid grid-cols-[2.5rem_1.2rem_1.2rem_1fr_6rem_3.5rem] gap-2 items-center bg-surface-raised rounded px-2 py-1.5">
              <img
                src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${p.champion}.png`}
                alt={p.champion}
                className="w-8 h-8 rounded"
              />
              <div className="flex flex-col gap-0.5">
                {spell1 && (
                  <img
                    src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/spell/${spell1}.png`}
                    alt=""
                    className="w-4 h-4 rounded-sm"
                  />
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                {spell2 && (
                  <img
                    src={`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/spell/${spell2}.png`}
                    alt=""
                    className="w-4 h-4 rounded-sm"
                  />
                )}
              </div>
              <div>
                <div className="text-white text-xs font-medium truncate">{p.summonerName}</div>
                <div className="text-fg-muted text-[10px]">{p.champion}</div>
              </div>
              <div className="text-right">
                {p.loading ? (
                  <div className="text-fg-muted text-xs">...</div>
                ) : p.ranked === 'unknown' ? (
                  <div className="text-fg-muted text-xs">-</div>
                ) : p.ranked ? (
                  <>
                    <div className="text-fg-secondary text-xs font-medium">{formatTier(p.ranked.tier, p.ranked.rank)}</div>
                    <div className="text-fg-muted text-[10px]">{p.ranked.leaguePoints} LP</div>
                  </>
                ) : (
                  <div className="text-fg-muted text-xs">{t('player.unranked')}</div>
                )}
              </div>
              <div className="text-right">
                {wr !== null ? (
                  <span className={`text-xs font-medium ${wr >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                    {wr}% WR
                  </span>
                ) : (
                  <span className="text-fg-muted text-xs">-</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="bg-surface-base border border-border-subtle rounded p-6 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1 bg-green-500/20 text-green-400 text-xs font-bold px-2 py-0.5 rounded-full border border-green-500/40">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            LIVE
          </span>
          <span className="text-fg-secondary text-xs uppercase tracking-widest">
            Live Game
          </span>
        </div>
        {gameDuration > 0 && (
          <div className="text-fg-muted text-xs">{gameDuration} Min.</div>
        )}
      </div>

      {renderTeam(team1, 'Blaue Seite', team1Bans)}
      <div className="border-t border-border-subtle my-3" />
      {renderTeam(team2, 'Rote Seite', team2Bans)}
    </div>
  );
}
