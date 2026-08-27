'use client';
import { useEffect, useState } from 'react';
import { withAlpha } from '../../lib/color';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n, LOCALE_MAP } from '../../lib/i18n';
import TftHero from '../../components/tft/TftHero';

interface Player {
  rank: number | null; puuid: string;
  gameName: string | null; tagLine: string | null;
  tier: string; division: string | null;
  leaguePoints: number; wins: number; losses: number;
}

interface MarketSnapshot {
  puuid: string;
  finalValue: number;
}

const APEX_TIERS = ['CHALLENGER', 'GRANDMASTER', 'MASTER'];
const DIVISIONS = ['I', 'II', 'III', 'IV'];

// Die Marktwertspalte gibt es nur in den Apex-Ligen. Snapshots existieren
// zwar auch fuer Diamant, aber /api/tft/marktwert/leaderboard liefert die
// nach Wert sortierte Regions-Spitze — Diamant reicht nie in die obersten 500
// hinein. Gemessen 2026-08-27 auf EUW: Challenger 256, Grandmaster 331,
// Master 413, Diamant 0 Treffer. Eine Spalte, die garantiert nur Striche
// zeigt, blenden wir aus.
const MARKET_VALUE_TIERS = ['CHALLENGER', 'GRANDMASTER', 'MASTER'];

// Deckungsgleich mit dem Spielervergleich (app/tft/compare/page.tsx) — bewusst
// dieselbe Auswahl, damit ein Spieler zwischen beiden Seiten dieselben Regionen
// findet.
const REGIONS = [
  { value: 'euw1', label: 'EUW' }, { value: 'eun1', label: 'EUNE' },
  { value: 'kr',   label: 'KR'  }, { value: 'na1',  label: 'NA' },
  { value: 'br1',  label: 'BR'  }, { value: 'jp1',  label: 'JP' },
  { value: 'la1',  label: 'LAN' }, { value: 'la2',  label: 'LAS' },
  { value: 'oc1',  label: 'OCE' }, { value: 'tr1',  label: 'TR' },
  { value: 'ru',   label: 'RU'  }, { value: 'me1',  label: 'ME' },
  { value: 'ph2',  label: 'PH'  }, { value: 'sg2',  label: 'SG' },
  { value: 'th2',  label: 'TH'  }, { value: 'tw2',  label: 'TW' },
  { value: 'vn2',  label: 'VN'  },
];

// Beide Raster stehen als komplette Klassennamen im Quelltext, damit Tailwind
// sie beim Build findet — ein aus Teilen zusammengesetzter Klassenname wird
// nicht generiert.
const GRID_APEX = 'grid-cols-[3rem_1fr_5rem_5rem_5rem_7rem]';
const GRID_APEX_NO_MV = 'grid-cols-[3rem_1fr_5rem_5rem_5rem]';
const GRID_SUB = 'grid-cols-[1fr_5rem_5rem_5rem_7rem]';
const GRID_SUB_NO_MV = 'grid-cols-[1fr_5rem_5rem_5rem]';

export default function TftLeaderboardPage() {
  const { t, lang } = useI18n();
  const [region, setRegion] = useState('euw1');
  const [tier, setTier] = useState('CHALLENGER');
  const [division, setDivision] = useState('I');
  const [page, setPage] = useState(1);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [totalPlayers, setTotalPlayers] = useState<number | null>(null);
  const [marketValues, setMarketValues] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tierDist, setTierDist] = useState<{ month: string; tiers: { key: string; label: string; pct: number; color: string }[] } | null>(null);
  const [search, setSearch] = useState('');

  const TIERS = [
    { value: 'CHALLENGER',  label: t('tier.challenger'),  color: '#f0c040' },
    { value: 'GRANDMASTER', label: t('tier.grandmaster'), color: '#e44040' },
    { value: 'MASTER',      label: t('tier.master'),      color: '#9d48e0' },
    { value: 'DIAMOND',     label: t('tier.diamond'),     color: '#576cce' },
    { value: 'EMERALD',     label: t('tier.emerald'),     color: '#00a86b' },
    { value: 'PLATINUM',    label: t('tier.platinum'),    color: '#209e85' },
    { value: 'GOLD',        label: t('tier.gold'),        color: '#c89b3c' },
    { value: 'SILVER',      label: t('tier.silver'),      color: '#8fa0a8' },
    { value: 'BRONZE',      label: t('tier.bronze'),      color: '#a0652a' },
    { value: 'IRON',        label: t('tier.iron'),        color: '#6b6b6b' },
  ];

  const isApex = APEX_TIERS.includes(tier);
  const showMarketValue = MARKET_VALUE_TIERS.includes(tier);
  const pageSize = 50;
  const totalPages = isApex && totalPlayers ? Math.max(1, Math.ceil(totalPlayers / pageSize)) : null;

  // Die Rangnummer gibt es nur in den Apex-Ligen — darunter liefert Riot keine
  // ligaweite Reihenfolge, eine durchlaufende Nummer waere erfunden.
  const gridCls = isApex
    ? (showMarketValue ? GRID_APEX : GRID_APEX_NO_MV)
    : (showMarketValue ? GRID_SUB : GRID_SUB_NO_MV);

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
    const params = new URLSearchParams({ region, tier, page: String(page) });
    if (!isApex) params.set('division', division);
    fetch(`/api/tft/leaderboard?${params.toString()}`)
      .then(async r => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(d => {
        setPlayers(d.players || []);
        setHasNextPage(Boolean(d.hasNextPage));
        setTotalPlayers(typeof d.totalPlayers === 'number' ? d.totalPlayers : null);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [region, tier, division, page, isApex]);

  // Side-load marketvalues from the snapshot leaderboard. Single batch
  // request — limited to the snapshot table, no Riot calls. Result is keyed
  // by puuid so we can join without name-fuzzy-matching.
  useEffect(() => {
    if (!showMarketValue) { setMarketValues(new Map()); return; }
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
  }, [region, tier, showMarketValue]);

  const fmtEur = (n: number) =>
    new Intl.NumberFormat(LOCALE_MAP[lang], {
      style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
    }).format(n);

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="leaderboard" />
      <TftHero pageTitle={t('nav.leaderboard')} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-2 pb-6">


        {tierDist && tierDist.tiers.length > 0 && (
          <div className="bg-surface-base border border-border-subtle rounded p-4 mb-4">
            <div className="flex items-baseline justify-between mb-3">
              <div className="text-fg-secondary text-xs uppercase tracking-widest">{t('champ.rankDistribution')}</div>
              {tierDist.month && <div className="text-fg-muted text-[10px]">{tierDist.month}</div>}
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
                        <div className="absolute bottom-0 w-full rounded-t transition-all duration-500" style={{ height: `${barH}%`, backgroundColor: item.color, opacity: 0.7, boxShadow: `0 0 8px ${withAlpha(item.color, 0x40)}` }} />
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
              onClick={() => { setRegion(r.value); setPage(1); }}
              className={`px-3 py-1.5 rounded text-xs font-medium ${region === r.value ? 'bg-accent text-white' : 'bg-surface-raised text-fg-secondary hover:text-white'}`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="mb-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('tft.search.player')}
            className="w-full sm:w-80 bg-surface-raised border border-border-subtle rounded px-3 py-1.5 text-sm text-white placeholder:text-fg-faint outline-none focus:border-accent-a60"
          />
        </div>

        <div className="flex flex-wrap gap-1 mb-4">
          {TIERS.map(tr => {
            const trApex = APEX_TIERS.includes(tr.value);
            const isActive = tier === tr.value;
            const isDropdownOpen = openDropdown === tr.value;
            return (
              <div key={tr.value} className="relative">
                <button
                  onClick={() => {
                    if (tr.value !== tier) { setTier(tr.value); setDivision('I'); setPage(1); }
                    setOpenDropdown(trApex ? null : (isDropdownOpen ? null : tr.value));
                  }}
                  className={`px-3 py-2 rounded text-xs font-medium transition-colors flex items-center gap-1 ${
                    isActive ? 'text-surface-sunken' : 'bg-surface-raised text-fg-secondary hover:text-white'
                  }`}
                  style={isActive ? { backgroundColor: tr.color } : {}}
                >
                  {tr.label}
                  {!trApex && isActive && <span className="text-[10px] opacity-70">{division}</span>}
                  {!trApex && (
                    <svg className={`w-3 h-3 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </button>

                {!trApex && isDropdownOpen && (
                  <div className="absolute top-full left-0 mt-1 z-20 bg-surface-base border border-border-subtle rounded shadow-lg overflow-hidden min-w-[80px]">
                    {DIVISIONS.map(div => (
                      <button
                        key={div}
                        onClick={() => {
                          setTier(tr.value);
                          setDivision(div);
                          setPage(1);
                          setOpenDropdown(null);
                        }}
                        className={`w-full px-3 py-1.5 text-xs text-left transition-colors ${
                          tier === tr.value && division === div
                            ? 'text-surface-sunken font-medium'
                            : 'text-fg-secondary hover:text-white hover:bg-surface-raised'
                        }`}
                        style={tier === tr.value && division === div ? { backgroundColor: tr.color } : {}}
                      >
                        {tr.label} {div}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {loading && <div className="text-fg-muted text-center py-8">{t('tft.loading')}</div>}
        {error && <div className="bg-red-500/10 border border-red-500/30 rounded p-4 text-red-400 text-sm">{error}</div>}

        {!loading && !error && players.length === 0 && (
          <div className="bg-surface-base border border-border-subtle rounded p-8 text-center text-fg-muted text-sm">
            {t('lb.noPlayers')}
          </div>
        )}

        {!loading && !error && players.length > 0 && (
          <div className="bg-surface-base border border-border-subtle rounded overflow-hidden">
            <div className={`hidden sm:grid ${gridCls} gap-2 px-4 py-2 text-[10px] uppercase text-fg-muted bg-surface-sunken`}>
              {isApex && <div className="text-right">#</div>}
              <div>{t('lb.player')}</div>
              <div className="text-right">LP</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
              <div className="text-right">WR</div>
              {showMarketValue && <div className="text-right">{t('tft.marketValue')}</div>}
            </div>
            {(() => {
              const q = search.trim().toLowerCase();
              const visible = q
                ? players.filter(p =>
                    (p.gameName || '').toLowerCase().includes(q)
                    || (p.tagLine || '').toLowerCase().includes(q),
                  )
                : players;
              return visible;
            })().map(p => {
              const total = p.wins + p.losses;
              const wr = total > 0 ? Math.round((p.wins / total) * 100) : 0;
              const slug = p.gameName ? `${encodeURIComponent(p.gameName)}--${encodeURIComponent(p.tagLine || 'EUW')}` : null;
              const mv = marketValues.get(p.puuid);
              return (
                <a
                  key={p.puuid}
                  href={slug ? `/tft/player/${slug}?region=${region}` : '#'}
                  className={`block sm:grid ${gridCls} gap-2 px-4 py-2 sm:items-center text-xs hover:bg-white/5 border-t border-border-subtle`}
                >
                  {/* Mobile: Rang (nur Apex) + Name in Zeile 1, Stats darunter.
                      Desktop: 4- bis 6-Spalten-Raster, je nach Liga. */}
                  {isApex && <div className="hidden sm:block text-right text-fg-secondary">{p.rank}</div>}
                  <div className="flex items-baseline gap-2 sm:block">
                    {isApex && <span className="text-fg-secondary text-[10px] sm:hidden">#{p.rank}</span>}
                    <span className="text-white truncate flex-1 sm:flex-initial">
                      {p.gameName ? `${p.gameName}` : <span className="text-fg-muted">{t('lb.unknownPlayer')}</span>}
                      {p.tagLine && <span className="text-fg-muted text-[10px]"> #{p.tagLine}</span>}
                    </span>
                  </div>
                  <div className="hidden sm:block text-right text-white">{p.leaguePoints}</div>
                  <div className="hidden sm:block text-right text-fg-muted">{total}</div>
                  <div className="hidden sm:block text-right text-fg-secondary">{wr}%</div>
                  <div className="flex sm:block items-center justify-between mt-1 sm:mt-0 sm:text-right tabular-nums">
                    <span className="text-fg-muted text-[10px] sm:hidden">
                      {p.leaguePoints} LP · {total} {t('tft.gamesShort')} · {wr}% WR
                    </span>
                    {showMarketValue && (mv != null
                      ? <span className="text-accent font-medium">{fmtEur(mv)}</span>
                      : <span className="text-fg-muted">—</span>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        )}

        {!loading && !error && !search.trim() && (page > 1 || hasNextPage) && (
          <div className="flex items-center justify-center gap-2 mt-3 bg-surface-base border border-border-subtle rounded px-3 sm:px-4 py-3">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                page <= 1
                  ? 'bg-surface-raised text-fg-muted cursor-not-allowed'
                  : 'bg-surface-raised text-fg-secondary hover:text-white'
              }`}
            >
              {t('team.prev')}
            </button>
            <span className="text-fg-secondary text-xs px-2">
              {t('team.page')} {page}{totalPages ? ` / ${totalPages}` : ''}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={!hasNextPage}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                !hasNextPage
                  ? 'bg-surface-raised text-fg-muted cursor-not-allowed'
                  : 'bg-surface-raised text-fg-secondary hover:text-white'
              }`}
            >
              {t('team.next')}
            </button>
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
