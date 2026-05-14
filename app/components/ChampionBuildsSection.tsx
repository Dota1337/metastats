'use client';
import { useState, useEffect, useMemo } from 'react';
import { useI18n } from '../lib/i18n';

interface BuildEntry { items: number[]; games: number; wins: number }
interface ItemEntry { item: number; games: number; wins: number }
interface RuneEntry {
  primary: number; keystone: number;
  p1: number; p2: number; p3: number;
  secondary: number; s1: number; s2: number;
  off: number; flex: number; def: number;
  games: number; wins: number;
}
interface KeystoneEntry { id: number; games: number; wins: number }
interface SummonerEntry { spells: number[]; games: number; wins: number }
interface CounterEntry { enemy: string; gamesAgainst: number; lossesAgainst: number }
interface RoleData {
  games: number; wins: number;
  topBuilds: BuildEntry[];
  topBoots: ItemEntry[];
  topItems: ItemEntry[];
  topRunes: RuneEntry[];
  topKeystones: KeystoneEntry[];
  topSummoners: SummonerEntry[];
  counters: { strongAgainst: CounterEntry[]; weakAgainst: CounterEntry[] };
}
interface BuildsResponse {
  championKey: string;
  region: string;
  hasBuilds: boolean;
  collectedAt?: string;
  ddragonVersion?: string;
  matchesAnalyzed?: number;
  roles: Record<string, RoleData>;
}

interface RuneTree {
  id: number;
  key: string;
  icon: string;
  name: string;
  slots: { runes: { id: number; icon: string; name: string }[] }[];
}

interface SummonerInfo { id: number; key: string; iconFile: string }

interface ChampionInfo { key: string; id: string; name: string; image: string }

const REGIONS: { value: string; label: string }[] = [
  { value: 'euw1', label: 'EUW' },
  { value: 'kr', label: 'KR' },
];

const ROLE_TABS: { value: string; key: string }[] = [
  { value: 'TOP', key: 'role.top' },
  { value: 'JUNGLE', key: 'role.jungle' },
  { value: 'MIDDLE', key: 'role.mid' },
  { value: 'BOTTOM', key: 'role.adc' },
  { value: 'UTILITY', key: 'role.support' },
];

const STAT_SHARD_LABELS: Record<number, string> = {
  5008: 'Adaptive Force',
  5005: 'Attack Speed',
  5007: 'Ability Haste',
  5002: 'Armor',
  5003: 'Magic Resist',
  5001: 'Health Scaling',
  5011: 'Health',
  5013: 'Tenacity & Slow Resist',
};

function pct(n: number, d: number) {
  if (!d) return '0%';
  return `${Math.round((n / d) * 1000) / 10}%`;
}

interface Props { championKey: string }

export default function ChampionBuildsSection({ championKey }: Props) {
  const { t } = useI18n();
  const [region, setRegion] = useState('euw1');
  const [data, setData] = useState<BuildsResponse | null>(null);
  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [runeTrees, setRuneTrees] = useState<RuneTree[]>([]);
  const [summoners, setSummoners] = useState<Record<number, SummonerInfo>>({});
  const [championMap, setChampionMap] = useState<Record<string, ChampionInfo>>({});

  // Builds data
  useEffect(() => {
    setData(null);
    setActiveRole(null);
    fetch(`/api/champions/${encodeURIComponent(championKey)}/builds?region=${region}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: BuildsResponse | null) => {
        setData(d);
        const firstRole = d?.roles && Object.keys(d.roles)[0];
        if (firstRole) setActiveRole(firstRole);
      })
      .catch(() => setData(null));
  }, [championKey, region]);

  // DataDragon assets — fetched once per ddragonVersion change
  const ddVersion = data?.ddragonVersion;
  useEffect(() => {
    if (!ddVersion) return;
    Promise.all([
      fetch(`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/data/en_US/runesReforged.json`).then(r => r.json()).catch(() => []),
      fetch(`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/data/en_US/summoner.json`).then(r => r.json()).catch(() => null),
      fetch(`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/data/en_US/champion.json`).then(r => r.json()).catch(() => null),
    ]).then(([runes, sums, champs]) => {
      setRuneTrees(runes || []);
      const sumMap: Record<number, SummonerInfo> = {};
      if (sums?.data) {
        for (const s of Object.values(sums.data) as any[]) {
          sumMap[Number(s.key)] = { id: Number(s.key), key: s.id, iconFile: s.image.full };
        }
      }
      setSummoners(sumMap);
      const champMap: Record<string, ChampionInfo> = {};
      if (champs?.data) {
        for (const c of Object.values(champs.data) as any[]) {
          champMap[c.key] = { key: c.key, id: c.id, name: c.name, image: c.image.full };
        }
      }
      setChampionMap(champMap);
    });
  }, [ddVersion]);

  // Rune ID → tree+name+icon lookup
  const runeIndex = useMemo(() => {
    const idx: Record<number, { name: string; icon: string }> = {};
    for (const tree of runeTrees) {
      idx[tree.id] = { name: tree.name, icon: tree.icon };
      for (const slot of tree.slots || []) {
        for (const r of slot.runes || []) {
          idx[r.id] = { name: r.name, icon: r.icon };
        }
      }
    }
    return idx;
  }, [runeTrees]);

  if (!data || !data.hasBuilds || !activeRole) return null;
  const role = data.roles[activeRole];
  if (!role) return null;
  const v = ddVersion || '';
  const ddImg = (path: string) => `https://ddragon.leagueoflegends.com/cdn/${v}/img/${path}`;
  const runeImg = (icon: string) => `https://ddragon.leagueoflegends.com/cdn/img/${icon}`;
  const matches = data.matchesAnalyzed || 0;

  return (
    <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4 sm:p-6 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-xl font-semibold text-white">{t('champBuild.heading')}</h2>
          {matches > 0 && (
            <div className="text-[#7a8aa0] text-xs mt-0.5">
              {t('champBuild.fromMatches').replace('{n}', matches.toLocaleString('de-DE'))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[#a0b0c5] text-xs uppercase tracking-wider">{t('champBuild.region')}</span>
          <div className="flex bg-[#141c2e] border border-[#1e2a3a] rounded">
            {REGIONS.map(r => (
              <button
                key={r.value}
                onClick={() => setRegion(r.value)}
                className={`px-3 py-1.5 text-xs uppercase ${region === r.value ? 'bg-[#1e2a3a] text-[#c89b3c]' : 'text-[#a0b0c5] hover:text-white'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Role tabs */}
      <div className="flex flex-wrap gap-1 mb-5 border-b border-[#1e2a3a]">
        {ROLE_TABS.filter(rt => data.roles[rt.value]).map(rt => {
          const r = data.roles[rt.value];
          const isActive = activeRole === rt.value;
          const wr = pct(r.wins, r.games);
          return (
            <button
              key={rt.value}
              onClick={() => setActiveRole(rt.value)}
              className={`px-4 py-2 text-sm border-b-2 transition-colors ${
                isActive
                  ? 'border-[#c89b3c] text-[#c89b3c]'
                  : 'border-transparent text-[#a0b0c5] hover:text-white'
              }`}
            >
              <div className="font-medium">{t(rt.key as any)}</div>
              <div className="text-[10px] text-[#7a8aa0]">{r.games} {t('champBuild.games')} · {wr}</div>
            </button>
          );
        })}
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Stat label={t('champBuild.winRate')} value={pct(role.wins, role.games)} />
        <Stat label={t('champBuild.games')} value={role.games.toLocaleString('de-DE')} />
        <Stat label="KDA" value={null} />
      </div>

      {/* Runes */}
      {role.topRunes[0] && (
        <Section title={t('champBuild.runes')}>
          <RunesPage rune={role.topRunes[0]} runeIndex={runeIndex} runeImg={runeImg} games={role.topRunes[0].games} wins={role.topRunes[0].wins} t={t as (k: string) => string} />
        </Section>
      )}

      {/* Summoners */}
      {role.topSummoners.length > 0 && (
        <Section title={t('champBuild.summoners')}>
          <div className="flex flex-wrap gap-3">
            {role.topSummoners.map((s, idx) => (
              <div key={idx} className="flex items-center gap-2 bg-[#141c2e] border border-[#1e2a3a] rounded px-3 py-2">
                <div className="flex gap-1">
                  {s.spells.map(spId => (
                    summoners[spId] ? (
                      <img
                        key={spId}
                        src={ddImg(`spell/${summoners[spId].iconFile}`)}
                        alt={summoners[spId].key}
                        title={summoners[spId].key}
                        className="w-8 h-8 rounded"
                      />
                    ) : (
                      <div key={spId} className="w-8 h-8 rounded bg-[#1e2a3a] text-[10px] text-[#7a8aa0] flex items-center justify-center">{spId}</div>
                    )
                  ))}
                </div>
                <div className="text-xs">
                  <div className="text-white">{pct(s.wins, s.games)} WR</div>
                  <div className="text-[#7a8aa0]">{s.games} {t('champBuild.games')}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Boots */}
      {role.topBoots.length > 0 && (
        <Section title={t('champBuild.boots')}>
          <ItemRow items={role.topBoots} ddImg={ddImg} gamesLabel={t('champBuild.games') as string} />
        </Section>
      )}

      {/* Builds */}
      {role.topBuilds.length > 0 && (
        <Section title={t('champBuild.builds')}>
          <div className="space-y-2">
            {role.topBuilds.map((b, idx) => (
              <div key={idx} className="flex items-center gap-3 bg-[#141c2e] border border-[#1e2a3a] rounded p-2">
                <div className="flex gap-1.5 flex-wrap">
                  {b.items.map((it, i) => (
                    it > 0 ? (
                      <img
                        key={`${i}-${it}`}
                        src={ddImg(`item/${it}.png`)}
                        alt={`Item ${it}`}
                        className="w-10 h-10 rounded border border-[#1e2a3a]"
                      />
                    ) : null
                  ))}
                </div>
                <div className="ml-auto text-right text-xs whitespace-nowrap">
                  <div className="text-white">{pct(b.wins, b.games)} WR</div>
                  <div className="text-[#7a8aa0]">{b.games} {t('champBuild.games')}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Most-used items */}
      {role.topItems.length > 0 && (
        <Section title={t('champBuild.items')}>
          <ItemRow items={role.topItems.slice(0, 12)} ddImg={ddImg} gamesLabel={t('champBuild.games') as string} />
        </Section>
      )}

      {/* Counters */}
      {(role.counters.strongAgainst.length > 0 || role.counters.weakAgainst.length > 0) && (
        <Section title={t('champBuild.counters')}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CounterList title={t('champBuild.strongAgainst')} entries={role.counters.strongAgainst} championMap={championMap} ddImg={ddImg} kind="strong" gamesLabel={t('champBuild.games') as string} />
            <CounterList title={t('champBuild.weakAgainst')} entries={role.counters.weakAgainst} championMap={championMap} ddImg={ddImg} kind="weak" gamesLabel={t('champBuild.games') as string} />
          </div>
        </Section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3">
      <div className="text-[#a0b0c5] text-xs uppercase tracking-wider">{label}</div>
      <div className="text-white text-lg font-medium mt-1">{value ?? '—'}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="text-[#a0b0c5] text-xs uppercase tracking-wider mb-2">{title}</h3>
      {children}
    </div>
  );
}

function ItemRow({ items, ddImg, gamesLabel }: { items: ItemEntry[]; ddImg: (p: string) => string; gamesLabel: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it, idx) => (
        <div key={idx} className="flex flex-col items-center gap-1 bg-[#141c2e] border border-[#1e2a3a] rounded p-1.5">
          <img src={ddImg(`item/${it.item}.png`)} alt={`Item ${it.item}`} className="w-9 h-9 rounded" />
          <div className="text-[10px] text-white">{pct(it.wins, it.games)}</div>
          <div className="text-[10px] text-[#7a8aa0] whitespace-nowrap">{it.games} {gamesLabel}</div>
        </div>
      ))}
    </div>
  );
}

function RunesPage({
  rune, runeIndex, runeImg, games, wins, t,
}: {
  rune: RuneEntry;
  runeIndex: Record<number, { name: string; icon: string }>;
  runeImg: (icon: string) => string;
  games: number;
  wins: number;
  t: (k: string) => string;
}) {
  const renderRune = (id: number, big = false) => {
    const info = runeIndex[id];
    if (!info) return <div className={`${big ? 'w-12 h-12' : 'w-8 h-8'} rounded-full bg-[#1e2a3a]`} />;
    return (
      <img
        src={runeImg(info.icon)}
        alt={info.name}
        title={info.name}
        className={`${big ? 'w-12 h-12' : 'w-8 h-8'} rounded-full`}
      />
    );
  };
  return (
    <div className="bg-[#141c2e] border border-[#1e2a3a] rounded p-3 flex flex-col md:flex-row md:items-center gap-4">
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center">
          <div className="text-[10px] text-[#7a8aa0] uppercase mb-1">Primary</div>
          {renderRune(rune.keystone, true)}
        </div>
        <div className="flex gap-2">
          {renderRune(rune.p1)}
          {renderRune(rune.p2)}
          {renderRune(rune.p3)}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center">
          <div className="text-[10px] text-[#7a8aa0] uppercase mb-1">Secondary</div>
          {renderRune(rune.secondary, true)}
        </div>
        <div className="flex gap-2">
          {renderRune(rune.s1)}
          {renderRune(rune.s2)}
        </div>
      </div>
      <div className="flex flex-col gap-1 text-[11px] text-[#a0b0c5]">
        <div className="text-[10px] text-[#7a8aa0] uppercase">{t('champBuild.statShards')}</div>
        <div>{STAT_SHARD_LABELS[rune.off] || rune.off}</div>
        <div>{STAT_SHARD_LABELS[rune.flex] || rune.flex}</div>
        <div>{STAT_SHARD_LABELS[rune.def] || rune.def}</div>
      </div>
      <div className="md:ml-auto text-right">
        <div className="text-white text-sm">{pct(wins, games)} WR</div>
        <div className="text-[11px] text-[#7a8aa0]">{games} {t('champBuild.games')}</div>
      </div>
    </div>
  );
}

function CounterList({
  title, entries, championMap, ddImg, kind, gamesLabel,
}: {
  title: string;
  entries: CounterEntry[];
  championMap: Record<string, ChampionInfo>;
  ddImg: (p: string) => string;
  kind: 'strong' | 'weak';
  gamesLabel: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-[#a0b0c5] mb-2">{title}</div>
      <div className="space-y-1.5">
        {entries.map((c, idx) => {
          const champ = championMap[c.enemy];
          const winsAgainst = c.gamesAgainst - c.lossesAgainst;
          const wr = pct(winsAgainst, c.gamesAgainst);
          return (
            <div key={idx} className="flex items-center gap-3 bg-[#141c2e] border border-[#1e2a3a] rounded p-2">
              {champ ? (
                <img src={ddImg(`champion/${champ.image}`)} alt={champ.name} className="w-8 h-8 rounded" />
              ) : (
                <div className="w-8 h-8 rounded bg-[#1e2a3a]" />
              )}
              <div className="flex-1 text-sm text-white">{champ?.name || c.enemy}</div>
              <div className={`text-sm font-medium ${kind === 'strong' ? 'text-green-400' : 'text-red-400'}`}>
                {wr}
              </div>
              <div className="text-[11px] text-[#7a8aa0] text-right whitespace-nowrap">{c.gamesAgainst} {gamesLabel}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
