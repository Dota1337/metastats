'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import PageHero from '../components/PageHero';
import { useI18n, LOCALE_MAP } from '../lib/i18n';
import { usePageTitle } from '../lib/use-page-title';
import { formatTier, NO_DIVISION_TIERS } from '../lib/rank-format';

const CompareRadar = dynamic(() => import('../components/CompareRadar'), { ssr: false });

// === Shared types & helpers ===

const REGIONS = [
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

const TIER_ORDER: Record<string, number> = {
  IRON: 1, BRONZE: 2, SILVER: 3, GOLD: 4, PLATINUM: 5,
  EMERALD: 6, DIAMOND: 7, MASTER: 8, GRANDMASTER: 9, CHALLENGER: 10,
};
const RANK_ORDER: Record<string, number> = { IV: 1, III: 2, II: 3, I: 4 };

function getTierColor(tier: string | undefined): string {
  if (!tier) return '#a0b0c5';
  const colors: Record<string, string> = {
    IRON: '#6b6b6b', BRONZE: '#a0522d', SILVER: '#b0b0b0', GOLD: '#c89b3c',
    PLATINUM: '#2d9e8f', EMERALD: '#2dbe6e', DIAMOND: '#4488ee',
    MASTER: '#9b59b6', GRANDMASTER: '#e74c3c', CHALLENGER: '#f1c40f',
  };
  return colors[tier.toUpperCase()] || '#a0b0c5';
}

function formatMarketValue(value: number): string {
  if (value >= 1_000_000) return '$' + (value / 1_000_000).toFixed(1) + 'M';
  if (value >= 1_000) return '$' + (value / 1_000).toFixed(0) + 'k';
  return '$' + String(value);
}

function rankToNumber(tier: string, rank: string, lp: number): number {
  return (TIER_ORDER[tier] || 0) * 1000 + (RANK_ORDER[rank] || 0) * 100 + lp;
}

function formatRank(tier: string, rank: string, lp: number): string {
  const t = tier.charAt(0) + tier.slice(1).toLowerCase();
  // Drop the division for Challenger / GM / Master — those tiers have none.
  if (NO_DIVISION_TIERS.has(tier)) return `${t} (${lp} LP)`;
  return `${t} ${rank} (${lp} LP)`;
}

function getChampionStats(matches: any[]): Array<{ champion: string; games: number; wins: number; winrate: number }> {
  const map: Record<string, { games: number; wins: number }> = {};
  for (const m of matches) {
    if (!map[m.champion]) map[m.champion] = { games: 0, wins: 0 };
    map[m.champion].games++;
    if (m.win) map[m.champion].wins++;
  }
  return Object.entries(map)
    .map(([champion, s]) => ({ champion, games: s.games, wins: s.wins, winrate: Math.round((s.wins / s.games) * 100) }))
    .sort((a, b) => b.games - a.games);
}

// Recent-form takes the newest N matches and returns them as compact W/L
// markers. Returns newest-first so the UI can render left-to-right
// chronologically by reversing.
function getRecentForm(matches: any[], n = 10): boolean[] {
  return matches.slice(0, n).map(m => Boolean(m.win));
}

// Streak helpers — counts the current (newest-end) consecutive run and the
// longest run anywhere in the window. Positive = win-streak, negative = lose.
function getStreaks(matches: any[]): { current: number; longestWin: number; longestLose: number } {
  if (matches.length === 0) return { current: 0, longestWin: 0, longestLose: 0 };
  // Current streak: scan from newest (index 0) forward, all same outcome
  const newestWin = !!matches[0].win;
  let current = 0;
  for (const m of matches) {
    if (!!m.win !== newestWin) break;
    current++;
  }
  current = newestWin ? current : -current;
  // Longest streaks anywhere in the window
  let lw = 0, ll = 0, runW = 0, runL = 0;
  for (const m of matches) {
    if (m.win) { runW++; runL = 0; lw = Math.max(lw, runW); }
    else { runL++; runW = 0; ll = Math.max(ll, runL); }
  }
  return { current, longestWin: lw, longestLose: ll };
}

// Damage breakdown across the sample — anti-noise by aggregating before
// computing the ratio. Returns physical/magic/true % shares.
function getDamageBreakdown(matches: any[]): { phys: number; mag: number; tru: number; total: number } {
  let p = 0, m = 0, tr = 0;
  for (const x of matches) {
    p += x.physicalDamageDealtToChampions || 0;
    m += x.magicDamageDealtToChampions || 0;
    tr += x.trueDamageDealtToChampions || 0;
  }
  const total = p + m + tr || 1;
  return { phys: (p / total) * 100, mag: (m / total) * 100, tru: (tr / total) * 100, total: p + m + tr };
}

function getVisionStats(matches: any[]): { wardsPlaced: number; wardsKilled: number; controlWards: number } {
  const games = matches.length || 1;
  let wp = 0, wk = 0, cw = 0;
  for (const m of matches) {
    wp += m.wardsPlaced || 0;
    wk += m.wardsKilled || 0;
    cw += m.controlWardsPlaced || 0;
  }
  return {
    wardsPlaced: Math.round((wp / games) * 10) / 10,
    wardsKilled: Math.round((wk / games) * 10) / 10,
    controlWards: Math.round((cw / games) * 10) / 10,
  };
}

function getObjectiveStats(matches: any[]): { drakes: number; barons: number; turrets: number; firstBloods: number } {
  const games = matches.length || 1;
  let dr = 0, br = 0, tu = 0, fb = 0;
  for (const m of matches) {
    dr += m.dragonKills || m.dragonTakedowns || 0;
    br += m.baronKills || m.baronTakedowns || 0;
    tu += m.turretKills || m.turretTakedowns || 0;
    if (m.firstBloodKill || m.firstBloodAssist) fb++;
  }
  return {
    drakes: Math.round((dr / games) * 10) / 10,
    barons: Math.round((br / games) * 10) / 10,
    turrets: Math.round((tu / games) * 10) / 10,
    firstBloods: Math.round((fb / games) * 100),
  };
}

// Riot's `teamPosition` is the most reliable role marker (final assigned
// role); fall back to the raw `role`/`lane` if missing.
function getRoleDistribution(matches: any[]): { role: string; count: number; pct: number }[] {
  const counts: Record<string, number> = { TOP: 0, JUNGLE: 0, MIDDLE: 0, BOTTOM: 0, UTILITY: 0, OTHER: 0 };
  for (const m of matches) {
    const r = (m.teamPosition || m.individualPosition || m.role || '').toUpperCase();
    if (r === 'TOP') counts.TOP++;
    else if (r === 'JUNGLE') counts.JUNGLE++;
    else if (r === 'MIDDLE' || r === 'MID') counts.MIDDLE++;
    else if (r === 'BOTTOM' || r === 'ADC' || r === 'CARRY') counts.BOTTOM++;
    else if (r === 'UTILITY' || r === 'SUPPORT' || r === 'SUP') counts.UTILITY++;
    else counts.OTHER++;
  }
  const total = matches.length || 1;
  return Object.entries(counts)
    .filter(([, c]) => c > 0)
    .map(([role, count]) => ({ role, count, pct: (count / total) * 100 }))
    .sort((a, b) => b.count - a.count);
}

// Riot CommunityDragon ships rank emblem PNGs at this stable path. Tier
// strings come uppercase from the ranked API; we lowercase for the URL.
function rankEmblemUrl(tier: string | undefined): string | null {
  if (!tier) return null;
  return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${tier.toLowerCase()}.png`;
}

// Head-to-head winner counter — used by the score banner. Stats where
// higher = better; KDA / winrate / damage / vision / rank / objectives.
function countCategoryWins(s1: any, s2: any): { p1: number; p2: number; tie: number } {
  const cats: Array<[number, number]> = [
    [s1.rankNum, s2.rankNum],
    [s1.winrate, s2.winrate],
    [s1.kda, s2.kda],
    [s1.csPerMin, s2.csPerMin],
    [s1.dmgPerMin, s2.dmgPerMin],
    [s1.visionScore, s2.visionScore],
    [s1.marketValue, s2.marketValue],
  ];
  let p1 = 0, p2 = 0, tie = 0;
  for (const [a, b] of cats) {
    if (a > b) p1++;
    else if (b > a) p2++;
    else tie++;
  }
  return { p1, p2, tie };
}

// === ComparisonBar ===

function ComparisonBar({ label, value1, value2, format1, format2 }: {
  label: string; value1: number; value2: number; format1: string; format2: string;
}) {
  const max = Math.max(value1, value2) || 1;
  const pct1 = (value1 / max) * 100;
  const pct2 = (value2 / max) * 100;
  const p1Wins = value1 > value2;
  const p2Wins = value2 > value1;
  const tie = value1 === value2;
  // Gold accent on the winning side, dim grey on the loser. Tie = both gold.
  const c1 = tie ? '#c89b3c' : p1Wins ? '#c89b3c' : '#3a4a64';
  const c2 = tie ? '#c89b3c' : p2Wins ? '#c89b3c' : '#3a4a64';
  return (
    <div className="mb-4">
      <div className="text-center text-[#a0b0c5] text-xs mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <span className={`text-xs sm:text-sm w-16 sm:w-24 text-right shrink-0 tabular-nums font-medium ${p1Wins ? 'text-[#c89b3c]' : 'text-white'}`}>{format1}</span>
        <div className="flex-1 flex gap-1">
          <div className="flex-1 flex justify-end">
            <div
              className="h-5 rounded-l transition-all duration-500"
              style={{ width: `${pct1}%`, backgroundColor: c1, boxShadow: p1Wins ? '0 0 12px rgba(200,155,60,0.35)' : 'none' }}
            />
          </div>
          <div className="flex-1 flex justify-start">
            <div
              className="h-5 rounded-r transition-all duration-500"
              style={{ width: `${pct2}%`, backgroundColor: c2, boxShadow: p2Wins ? '0 0 12px rgba(200,155,60,0.35)' : 'none' }}
            />
          </div>
        </div>
        <span className={`text-xs sm:text-sm w-16 sm:w-24 shrink-0 tabular-nums font-medium ${p2Wins ? 'text-[#c89b3c]' : 'text-white'}`}>{format2}</span>
      </div>
    </div>
  );
}

// === New visual blocks ===

function HeadToHeadBanner({ p1, p2, name1, name2 }: { p1: number; p2: number; name1: string; name2: string }) {
  const total = p1 + p2 || 1;
  const w1 = (p1 / total) * 100;
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between text-xs mb-2">
        <span className={`font-semibold ${p1 > p2 ? 'text-[#c89b3c]' : 'text-[#a0b0c5]'}`}>{name1}</span>
        <span className="text-[#7a8aa0]">Head-to-Head</span>
        <span className={`font-semibold ${p2 > p1 ? 'text-[#c89b3c]' : 'text-[#a0b0c5]'}`}>{name2}</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-[#1e2a3a] overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-gradient-to-r from-[#c89b3c] to-[#d4a94a] transition-all duration-700"
          style={{ width: `${w1}%`, boxShadow: '0 0 8px rgba(200,155,60,0.45)' }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] mt-1.5 tabular-nums">
        <span className={p1 > p2 ? 'text-[#c89b3c] font-bold' : 'text-[#7a8aa0]'}>{p1} {p1 === 1 ? 'Kategorie' : 'Kategorien'}</span>
        <span className={p2 > p1 ? 'text-[#c89b3c] font-bold' : 'text-[#7a8aa0]'}>{p2} {p2 === 1 ? 'Kategorie' : 'Kategorien'}</span>
      </div>
    </div>
  );
}

function TierBadgeRow({ s1, s2 }: { s1: any; s2: any }) {
  const e1 = rankEmblemUrl(s1.tier);
  const e2 = rankEmblemUrl(s2.tier);
  return (
    <div className="grid grid-cols-2 gap-3 mb-6">
      {[
        { stat: s1, emblem: e1 },
        { stat: s2, emblem: e2 },
      ].map((p, i) => (
        <div key={i} className="bg-[#0a0e1a] border border-[#1e2a3a] rounded-lg p-3 flex items-center gap-3">
          {p.emblem ? (
            <img src={p.emblem} alt={p.stat.tier || ''} className="w-14 h-14 object-contain" />
          ) : (
            <div className="w-14 h-14 rounded bg-[#1e2a3a]" />
          )}
          <div className="min-w-0">
            <div className="text-white text-sm font-medium">{p.stat.rankStr}</div>
            {p.stat.tier && (
              <div className="text-[10px] uppercase tracking-widest mt-0.5" style={{ color: getTierColor(p.stat.tier) }}>
                {p.stat.tier}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentFormRow({ form, streaks, side }: { form: boolean[]; streaks: { current: number; longestWin: number; longestLose: number }; side: 'left' | 'right' }) {
  const wins = form.filter(Boolean).length;
  const losses = form.length - wins;
  // Render chronologically left→right (oldest first). The match list is
  // newest-first so we reverse for display.
  const ordered = [...form].reverse();
  const streakText =
    streaks.current > 0 ? `${streaks.current}W Streak` :
    streaks.current < 0 ? `${-streaks.current}L Streak` :
    '–';
  return (
    <div className={`flex items-center gap-2 ${side === 'right' ? 'justify-end' : ''}`}>
      <div className="flex gap-1">
        {ordered.map((w, i) => (
          <div
            key={i}
            className={`w-3.5 h-3.5 rounded-sm ${w ? 'bg-[#3ecf8e]' : 'bg-[#e44040]'}`}
            style={{ boxShadow: w ? '0 0 4px rgba(62,207,142,0.4)' : '0 0 4px rgba(228,64,64,0.3)' }}
            title={w ? 'Win' : 'Loss'}
          />
        ))}
      </div>
      <div className="text-[10px] tabular-nums">
        <span className="text-[#3ecf8e]">{wins}</span>
        <span className="text-[#7a8aa0]">-</span>
        <span className="text-[#e44040]">{losses}</span>
        <span className={`ml-1.5 ${streaks.current > 0 ? 'text-[#3ecf8e]' : streaks.current < 0 ? 'text-[#e44040]' : 'text-[#7a8aa0]'}`}>
          · {streakText}
        </span>
      </div>
    </div>
  );
}

function DamageBreakdownBar({ breakdown }: { breakdown: { phys: number; mag: number; tru: number } }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-3 rounded overflow-hidden bg-[#0a0e1a]">
        <div className="bg-[#e0a85a] transition-all duration-500" style={{ width: `${breakdown.phys}%` }} title={`Physical ${breakdown.phys.toFixed(0)}%`} />
        <div className="bg-[#4488ee] transition-all duration-500" style={{ width: `${breakdown.mag}%` }} title={`Magic ${breakdown.mag.toFixed(0)}%`} />
        <div className="bg-[#cfd6dc] transition-all duration-500" style={{ width: `${breakdown.tru}%` }} title={`True ${breakdown.tru.toFixed(0)}%`} />
      </div>
      <div className="flex justify-between text-[9px] tabular-nums text-[#a0b0c5]">
        <span>P {breakdown.phys.toFixed(0)}%</span>
        <span>M {breakdown.mag.toFixed(0)}%</span>
        <span>T {breakdown.tru.toFixed(0)}%</span>
      </div>
    </div>
  );
}

function MiniStatCard({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="bg-[#0a0e1a] border border-[#1e2a3a] rounded p-2 text-center">
      <div className={`text-base font-semibold tabular-nums ${accent ? 'text-[#c89b3c]' : 'text-white'}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-[#7a8aa0] mt-0.5">{label}</div>
    </div>
  );
}

const ROLE_COLORS: Record<string, string> = {
  TOP: '#c89b3c', JUNGLE: '#3ecf8e', MIDDLE: '#4488ee',
  BOTTOM: '#e0a85a', UTILITY: '#a892ff', OTHER: '#7a8aa0',
};
const ROLE_LABELS: Record<string, string> = {
  TOP: 'Top', JUNGLE: 'Jng', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Sup', OTHER: 'Other',
};

function RoleDonut({ roles, size = 80 }: { roles: { role: string; count: number; pct: number }[]; size?: number }) {
  if (roles.length === 0) {
    return <div className="text-[#7a8aa0] text-xs text-center py-2">–</div>;
  }
  // Build conic-gradient string from role percentages
  let acc = 0;
  const stops: string[] = [];
  for (const r of roles) {
    const start = acc;
    acc += r.pct;
    stops.push(`${ROLE_COLORS[r.role]} ${start}% ${acc}%`);
  }
  const bg = `conic-gradient(${stops.join(', ')})`;
  const primary = roles[0];
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="rounded-full relative"
        style={{ width: size, height: size, background: bg }}
      >
        <div
          className="absolute inset-2 rounded-full bg-[#0d1526] flex items-center justify-center"
          style={{ inset: `${size * 0.18}px` }}
        >
          <div className="text-center leading-tight">
            <div className="text-white text-xs font-semibold">{ROLE_LABELS[primary.role]}</div>
            <div className="text-[9px] text-[#a0b0c5] tabular-nums">{primary.pct.toFixed(0)}%</div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 justify-center text-[9px]">
        {roles.map(r => (
          <div key={r.role} className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ROLE_COLORS[r.role] }} />
            <span className="text-[#a0b0c5] tabular-nums">{ROLE_LABELS[r.role]} {r.pct.toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChampionPoolBlock({ pool, count }: { pool: { champion: string; games: number; winrate: number }[]; count: number }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="text-white text-2xl font-semibold tabular-nums">{count}</div>
      <div className="text-[9px] uppercase tracking-widest text-[#7a8aa0]">Champions</div>
      <div className="flex gap-1 mt-1 flex-wrap justify-center">
        {pool.slice(0, 6).map(c => (
          <img
            key={c.champion}
            src={`https://ddragon.leagueoflegends.com/cdn/14.10.1/img/champion/${c.champion}.png`}
            alt={c.champion}
            title={`${c.champion} · ${c.games} games · ${c.winrate}% WR`}
            className="w-7 h-7 rounded-sm border border-[#1e2a3a]"
          />
        ))}
      </div>
    </div>
  );
}

// === Main Page ===

export default function AnalysePage() {
  usePageTitle('pageTitle.compare');
  const { t } = useI18n();
  const [mode, setMode] = useState<'multi' | 'compare'>('compare');
  const [region, setRegion] = useState('euw1');

  return (
    <div className="min-h-screen bg-[#0e1525] flex flex-col">
      <Nav active="analyse" />

      <PageHero title={t('nav.analyse')} subtitle={t('compare.subtitle')} leftChampion="Darius" rightChampion="Garen" />

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        {/* Mode tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setMode('compare')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'compare' ? 'bg-[#c89b3c]/10 text-[#c89b3c] border border-[#c89b3c]/30' : 'text-[#7a8aa0] hover:text-[#a0b0c5]'}`}
          >
            {t('compare.title')}
          </button>
          <button
            onClick={() => setMode('multi')}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${mode === 'multi' ? 'bg-[#c89b3c]/10 text-[#c89b3c] border border-[#c89b3c]/30' : 'text-[#7a8aa0] hover:text-[#a0b0c5]'}`}
          >
            {t('multi.title')}
          </button>
        </div>

        {mode === 'multi' ? (
          <MultiSearchTab region={region} setRegion={setRegion} />
        ) : (
          <CompareTab region={region} setRegion={setRegion} />
        )}
      </main>

      <Footer />
    </div>
  );
}

// === Multi-Search Tab ===

interface PlayerResult { name: string; tag: string; loading: boolean; error: boolean; data: any | null; }

function MultiSearchTab({ region, setRegion }: { region: string; setRegion: (r: string) => void }) {
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const [results, setResults] = useState<PlayerResult[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    const lines = input.split('\n').map(l => l.trim()).filter(l => l.length > 0).slice(0, 5);
    if (lines.length === 0) return;

    const initial: PlayerResult[] = lines.map(line => {
      const parts = line.split('#');
      return { name: parts[0]?.trim() || line, tag: parts[1]?.trim() || '', loading: true, error: false, data: null };
    });
    setResults(initial);
    setSearching(true);

    await Promise.all(initial.map(async (player, index) => {
      const fullName = player.tag ? `${player.name}#${player.tag}` : player.name;
      try {
        const res = await fetch(`/api/summoner?name=${encodeURIComponent(fullName)}&region=${region}`);
        if (!res.ok) throw new Error('Not found');
        const data = await res.json();
        setResults(prev => { const next = [...prev]; next[index] = { ...next[index], loading: false, data }; return next; });
      } catch {
        setResults(prev => { const next = [...prev]; next[index] = { ...next[index], loading: false, error: true }; return next; });
      }
    }));
    setSearching(false);
  };

  const getSoloQueue = (ranked: any[]) => Array.isArray(ranked) ? ranked.find((r: any) => r.queueType === 'RANKED_SOLO_5x5') || null : null;
  const getKDA = (data: any) => {
    if (!data?.matches || data.matches.length === 0) return null;
    const m = data.matches;
    const k = m.reduce((s: number, g: any) => s + (g.kills || 0), 0);
    const d = m.reduce((s: number, g: any) => s + (g.deaths || 0), 0);
    const a = m.reduce((s: number, g: any) => s + (g.assists || 0), 0);
    return d === 0 ? 'Perfect' : ((k + a) / d).toFixed(2);
  };
  const getWinrate = (solo: any) => {
    if (!solo) return null;
    const total = solo.wins + solo.losses;
    return total === 0 ? null : Math.round((solo.wins / total) * 100);
  };
  const getPlayerLink = (player: PlayerResult) =>
    `/player/${encodeURIComponent(player.name)}--${encodeURIComponent(player.tag || 'EUW')}?region=${region}`;

  return (
    <>
      <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4 sm:p-6 mb-6">
        <label className="block text-[#a0b0c5] text-sm mb-2">
          {t('multi.subtitle')} (max. 5, Name#Tag)
        </label>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={t('compare.placeholder')}
          rows={4}
          className="w-full bg-[#0e1525] border border-[#1e2a3a] rounded-lg p-3 text-white text-sm placeholder-[#7a8aa0] focus:outline-none focus:border-[#c89b3c] resize-none"
        />
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <select value={region} onChange={e => setRegion(e.target.value)}
            className="bg-[#0e1525] border border-[#1e2a3a] rounded px-3 py-2 text-white text-sm outline-none">
            {REGIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button onClick={handleSearch} disabled={searching || !input.trim()}
            className="bg-[#c89b3c] hover:bg-[#d4a94e] disabled:opacity-50 text-black font-semibold px-6 py-2 rounded text-sm transition-colors">
            {searching ? t('common.loading') : t('home.searchBtn')}
          </button>
        </div>
      </div>

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((player, i) => {
            if (player.loading) return (
              <div key={i} className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-[#1e2a3a] animate-pulse" />
                <div className="flex-1"><div className="h-4 w-32 bg-[#1e2a3a] rounded animate-pulse" /></div>
                <span className="text-[#a0b0c5] text-sm">{t('common.loading')}</span>
              </div>
            );
            if (player.error) return (
              <div key={i} className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-[#1e2a3a] flex items-center justify-center text-[#7a8aa0]">?</div>
                <span className="text-white text-sm flex-1">{player.name}{player.tag ? `#${player.tag}` : ''}</span>
                <span className="text-red-400 text-sm">{t('compare.notFound')}</span>
              </div>
            );

            const data = player.data;
            const summoner = data?.summoner;
            const solo = getSoloQueue(data?.ranked);
            const winrate = getWinrate(solo);
            const kda = getKDA(data);
            const marketValue = data?.storedMarketValue;

            return (
              <a key={i} href={getPlayerLink(player)}
                className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4 flex items-center gap-3 hover:border-[#c89b3c]/40 transition-colors">
                {summoner?.profileIconId ? (
                  <img src={`https://ddragon.leagueoflegends.com/cdn/14.1.1/img/profileicon/${summoner.profileIconId}.png`}
                    alt="" className="w-10 h-10 rounded-full border border-[#1e2a3a] flex-shrink-0" />
                ) : <div className="w-10 h-10 rounded-full bg-[#1e2a3a] flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium truncate">{summoner?.name || `${player.name}#${player.tag}`}</div>
                  <div className="text-[#7a8aa0] text-xs">Lvl {summoner?.summonerLevel || '?'}</div>
                </div>
                <div className="hidden sm:block text-center">
                  {solo ? (
                    <span className="text-sm font-medium" style={{ color: getTierColor(solo.tier) }}>
                      {formatTier(solo.tier, solo.rank)}
                    </span>
                  ) : <span className="text-[#7a8aa0] text-xs">{t('player.unranked')}</span>}
                </div>
                <div className="hidden sm:block text-center w-14">
                  {winrate !== null ? (
                    <span className="text-sm font-medium" style={{ color: winrate >= 50 ? '#2dbe6e' : '#e74c3c' }}>{winrate}%</span>
                  ) : <span className="text-[#7a8aa0] text-xs">-</span>}
                </div>
                <div className="hidden sm:block text-center w-12">
                  {kda ? <span className="text-white text-sm">{kda}</span> : <span className="text-[#7a8aa0] text-xs">-</span>}
                </div>
                <div className="text-right flex-shrink-0">
                  {marketValue ? (
                    <span className="text-[#c89b3c] text-sm font-semibold">{formatMarketValue(marketValue)}</span>
                  ) : <span className="text-[#7a8aa0] text-xs">-</span>}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}

// === Compare Tab ===

function CompareTab({ region, setRegion }: { region: string; setRegion: (r: string) => void }) {
  const { t, lang } = useI18n();
  const numLocale = LOCALE_MAP[lang];
  const [player1Input, setPlayer1Input] = useState('');
  const [player2Input, setPlayer2Input] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [player1, setPlayer1] = useState<any>(null);
  const [player2, setPlayer2] = useState<any>(null);

  async function fetchPlayer(name: string) {
    const summonerRes = await fetch(`/api/summoner?name=${encodeURIComponent(name)}&region=${region}`);
    if (!summonerRes.ok) throw new Error(`"${name}" ${t('compare.notFound').toLowerCase()}`);
    const summoner = await summonerRes.json();
    // Summoner response already includes matches when fresh
    if (summoner.matches && summoner.matches.length > 0) {
      return { summoner, matches: { matches: summoner.matches } };
    }
    // Fallback: fetch matches separately
    const matchesRes = await fetch(`/api/matches?puuid=${summoner.summoner.puuid}&region=${region}`);
    const matches = matchesRes.ok ? await matchesRes.json() : { matches: [] };
    return { summoner, matches };
  }

  async function handleCompare() {
    if (!player1Input.trim() || !player2Input.trim()) { setError(t('compare.enterBoth')); return; }
    setLoading(true); setError(''); setPlayer1(null); setPlayer2(null);
    try {
      // Sequential to avoid rate limiting (each player uses ~30-70 API calls)
      const p1 = await fetchPlayer(player1Input.trim());
      setPlayer1(p1);
      const p2 = await fetchPlayer(player2Input.trim());
      setPlayer2(p2);
    } catch (e: any) { setError(e.message || 'Fehler'); }
    finally { setLoading(false); }
  }

  function getStats(data: any) {
    const solo = Array.isArray(data.summoner.ranked)
      ? data.summoner.ranked.find((r: any) => r.queueType === 'RANKED_SOLO_5x5')
      : null;
    const matches = data.matches?.matches || data.summoner?.matches || [];
    const totalGames = matches.length || 1;
    const wins = matches.filter((m: any) => m.win).length;
    const winrate = Math.round((wins / totalGames) * 100);
    const kills = matches.reduce((s: number, m: any) => s + (m.kills || 0), 0);
    const deaths = matches.reduce((s: number, m: any) => s + (m.deaths || 0), 0);
    const assists = matches.reduce((s: number, m: any) => s + (m.assists || 0), 0);
    const kda = deaths === 0 ? kills + assists : (kills + assists) / deaths;
    const totalMin = matches.reduce((s: number, m: any) => s + (m.gameDuration || 0) / 60, 0);
    const csPerMin = totalMin > 0 ? matches.reduce((s: number, m: any) => s + (m.cs || 0), 0) / totalMin : 0;
    const dmgPerMin = totalMin > 0 ? matches.reduce((s: number, m: any) => s + (m.damageDealt || m.totalDamageDealtToChampions || 0), 0) / totalMin : 0;
    const visionScore = matches.reduce((s: number, m: any) => s + (m.visionScore || 0), 0) / totalGames;
    const allChampions = getChampionStats(matches);
    return {
      tier: solo?.tier as string | undefined,
      rank: solo?.rank as string | undefined,
      lp: solo?.leaguePoints as number | undefined,
      rankNum: solo ? rankToNumber(solo.tier, solo.rank, solo.leaguePoints) : 0,
      rankStr: solo ? formatRank(solo.tier, solo.rank, solo.leaguePoints) : 'Unranked',
      winrate, kda: Math.round(kda * 100) / 100,
      csPerMin: Math.round(csPerMin * 10) / 10,
      dmgPerMin: Math.round(dmgPerMin),
      visionScore: Math.round(visionScore * 10) / 10,
      marketValue: data.summoner.storedMarketValue || 0,
      champions: allChampions.slice(0, 3),
      championPoolSize: allChampions.length,
      topChampions: allChampions.slice(0, 6),
      recentForm: getRecentForm(matches),
      streaks: getStreaks(matches),
      damage: getDamageBreakdown(matches),
      vision: getVisionStats(matches),
      objectives: getObjectiveStats(matches),
      roles: getRoleDistribution(matches),
      sampleSize: matches.length,
    };
  }

  const s1 = player1 ? getStats(player1) : null;
  const s2 = player2 ? getStats(player2) : null;

  return (
    <>
      <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4 sm:p-6 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[#a0b0c5] text-xs mb-1">{t('compare.player1')}</label>
            <input type="text" placeholder="Name#Tag" value={player1Input}
              onChange={e => setPlayer1Input(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCompare()}
              className="w-full bg-[#0e1525] border border-[#1e2a3a] rounded px-3 py-2 text-white text-sm placeholder-[#7a8aa0] outline-none focus:border-[#c89b3c]" />
          </div>
          <div>
            <label className="block text-[#a0b0c5] text-xs mb-1">{t('compare.player2')}</label>
            <input type="text" placeholder="Name#Tag" value={player2Input}
              onChange={e => setPlayer2Input(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCompare()}
              className="w-full bg-[#0e1525] border border-[#1e2a3a] rounded px-3 py-2 text-white text-sm placeholder-[#7a8aa0] outline-none focus:border-[#c89b3c]" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select value={region} onChange={e => setRegion(e.target.value)}
            className="bg-[#0e1525] border border-[#1e2a3a] rounded px-3 py-2 text-white text-sm outline-none">
            {REGIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button onClick={handleCompare} disabled={loading}
            className="flex-1 sm:flex-none bg-[#c89b3c] hover:bg-[#b08a34] text-black font-semibold text-sm px-6 py-2 rounded transition-colors disabled:opacity-50">
            {loading ? t('common.loading') : t('compare.title')}
          </button>
        </div>
        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
      </div>

      {player1 && player2 && s1 && s2 && (() => {
        const score = countCategoryWins(s1, s2);
        return (
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded-lg p-4 sm:p-6">
          {/* Profile headers */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <img src={`https://ddragon.leagueoflegends.com/cdn/14.10.1/img/profileicon/${player1.summoner.summoner.profileIconId}.png`}
                alt="" className="w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 border-[#c89b3c]" />
              <div>
                <div className="text-white text-sm font-semibold truncate max-w-[100px] sm:max-w-none">{player1.summoner.summoner.name}</div>
                <div className="text-[#a0b0c5] text-xs">Lvl {player1.summoner.summoner.summonerLevel}</div>
              </div>
            </div>
            <div className="text-[#7a8aa0] text-xs font-semibold">VS</div>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="text-right">
                <div className="text-white text-sm font-semibold truncate max-w-[100px] sm:max-w-none">{player2.summoner.summoner.name}</div>
                <div className="text-[#a0b0c5] text-xs">Lvl {player2.summoner.summoner.summonerLevel}</div>
              </div>
              <img src={`https://ddragon.leagueoflegends.com/cdn/14.10.1/img/profileicon/${player2.summoner.summoner.profileIconId}.png`}
                alt="" className="w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 border-[#c89b3c]" />
            </div>
          </div>

          {/* Head-to-head score banner */}
          <HeadToHeadBanner
            p1={score.p1}
            p2={score.p2}
            name1={player1.summoner.summoner.name}
            name2={player2.summoner.summoner.name}
          />

          {/* Tier-Embleme */}
          <TierBadgeRow s1={s1} s2={s2} />

          {/* Recent form — letzte 10 Spiele als W/L-Quadrate + Streak */}
          <div className="bg-[#0a0e1a] border border-[#1e2a3a] rounded-lg p-3 mb-6">
            <div className="text-center text-[10px] uppercase tracking-widest text-[#7a8aa0] mb-2">Letzte 10 Spiele · Streak</div>
            <div className="grid grid-cols-2 gap-3">
              <RecentFormRow form={s1.recentForm} streaks={s1.streaks} side="left" />
              <RecentFormRow form={s2.recentForm} streaks={s2.streaks} side="right" />
            </div>
          </div>

          {/* Radar Chart */}
          {(() => {
            const normalize = (v: number, max: number) => Math.min(Math.round((v / max) * 100), 100);
            const maxRank = Math.max(s1.rankNum, s2.rankNum, 1);
            const maxKda = Math.max(s1.kda, s2.kda, 1);
            const maxCs = Math.max(s1.csPerMin, s2.csPerMin, 1);
            const maxDmg = Math.max(s1.dmgPerMin, s2.dmgPerMin, 1);
            const maxVis = Math.max(s1.visionScore, s2.visionScore, 1);

            return (
              <CompareRadar
                data={[
                  { stat: 'Winrate', p1: s1.winrate, p2: s2.winrate },
                  { stat: 'KDA', p1: normalize(s1.kda, maxKda), p2: normalize(s2.kda, maxKda) },
                  { stat: 'CS/Min', p1: normalize(s1.csPerMin, maxCs), p2: normalize(s2.csPerMin, maxCs) },
                  { stat: 'DMG/Min', p1: normalize(s1.dmgPerMin, maxDmg), p2: normalize(s2.dmgPerMin, maxDmg) },
                  { stat: 'Vision', p1: normalize(s1.visionScore, maxVis), p2: normalize(s2.visionScore, maxVis) },
                  { stat: 'Rang', p1: normalize(s1.rankNum, maxRank), p2: normalize(s2.rankNum, maxRank) },
                ]}
                name1={player1.summoner.summoner.name}
                name2={player2.summoner.summoner.name}
              />
            );
          })()}

          <ComparisonBar label="Rang" value1={s1.rankNum} value2={s2.rankNum} format1={s1.rankStr} format2={s2.rankStr} />
          <ComparisonBar label="Winrate" value1={s1.winrate} value2={s2.winrate} format1={`${s1.winrate}%`} format2={`${s2.winrate}%`} />
          <ComparisonBar label="KDA" value1={s1.kda} value2={s2.kda} format1={s1.kda.toFixed(2)} format2={s2.kda.toFixed(2)} />
          <ComparisonBar label="CS/Min" value1={s1.csPerMin} value2={s2.csPerMin} format1={s1.csPerMin.toFixed(1)} format2={s2.csPerMin.toFixed(1)} />
          <ComparisonBar label="DMG/Min" value1={s1.dmgPerMin} value2={s2.dmgPerMin} format1={s1.dmgPerMin.toLocaleString(numLocale)} format2={s2.dmgPerMin.toLocaleString(numLocale)} />
          <ComparisonBar label="Vision" value1={s1.visionScore} value2={s2.visionScore} format1={s1.visionScore.toFixed(1)} format2={s2.visionScore.toFixed(1)} />
          <ComparisonBar label="Marktwert" value1={s1.marketValue} value2={s2.marketValue}
            format1={s1.marketValue ? formatMarketValue(s1.marketValue) : 'N/A'}
            format2={s2.marketValue ? formatMarketValue(s2.marketValue) : 'N/A'} />

          {/* Schadens-Verteilung */}
          <div className="mt-6 pt-4 border-t border-[#1e2a3a]">
            <div className="text-center text-[#a0b0c5] text-xs mb-3">Schadens-Verteilung</div>
            <div className="grid grid-cols-2 gap-4">
              <DamageBreakdownBar breakdown={s1.damage} />
              <DamageBreakdownBar breakdown={s2.damage} />
            </div>
          </div>

          {/* Vision (Ø pro Spiel) */}
          <div className="mt-6 pt-4 border-t border-[#1e2a3a]">
            <div className="text-center text-[#a0b0c5] text-xs mb-3">Vision (Ø pro Spiel)</div>
            <div className="grid grid-cols-2 gap-4">
              {[s1, s2].map((s, si) => (
                <div key={si} className="grid grid-cols-3 gap-1.5">
                  <MiniStatCard label="Wards" value={s.vision.wardsPlaced} />
                  <MiniStatCard label="Killed" value={s.vision.wardsKilled} />
                  <MiniStatCard label="Control" value={s.vision.controlWards} />
                </div>
              ))}
            </div>
          </div>

          {/* Objectives & First Blood */}
          <div className="mt-6 pt-4 border-t border-[#1e2a3a]">
            <div className="text-center text-[#a0b0c5] text-xs mb-3">Objectives (Ø pro Spiel)</div>
            <div className="grid grid-cols-2 gap-4">
              {[s1, s2].map((s, si) => (
                <div key={si} className="grid grid-cols-4 gap-1.5">
                  <MiniStatCard label="Drakes" value={s.objectives.drakes} />
                  <MiniStatCard label="Baron" value={s.objectives.barons} />
                  <MiniStatCard label="Turrets" value={s.objectives.turrets} />
                  <MiniStatCard label="First Blood" value={`${s.objectives.firstBloods}%`} accent />
                </div>
              ))}
            </div>
          </div>

          {/* Rollen-Verteilung + Champion Pool */}
          <div className="mt-6 pt-4 border-t border-[#1e2a3a] grid grid-cols-2 gap-6">
            <div>
              <div className="text-center text-[#a0b0c5] text-xs mb-3">Rollen-Verteilung</div>
              <div className="grid grid-cols-2 gap-4 place-items-center">
                <RoleDonut roles={s1.roles} />
                <RoleDonut roles={s2.roles} />
              </div>
            </div>
            <div>
              <div className="text-center text-[#a0b0c5] text-xs mb-3">Champion-Pool</div>
              <div className="grid grid-cols-2 gap-4 place-items-center">
                <ChampionPoolBlock pool={s1.topChampions} count={s1.championPoolSize} />
                <ChampionPoolBlock pool={s2.topChampions} count={s2.championPoolSize} />
              </div>
            </div>
          </div>

          {/* Top Champions detail */}
          <div className="mt-6 pt-4 border-t border-[#1e2a3a]">
            <div className="text-center text-[#a0b0c5] text-xs mb-3">{t('compare.topChampions')}</div>
            <div className="grid grid-cols-2 gap-4 sm:gap-8">
              {[s1, s2].map((s, si) => (
                <div key={si}>
                  {s.champions.map(c => (
                    <div key={c.champion} className="flex items-center justify-between py-1">
                      <span className="text-white text-sm">{c.champion}</span>
                      <span className="text-[#a0b0c5] text-xs">{c.winrate}% ({c.games})</span>
                    </div>
                  ))}
                  {s.champions.length === 0 && <span className="text-[#7a8aa0] text-xs">-</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
        );
      })()}
    </>
  );
}
