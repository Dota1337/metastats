'use client';
import { useState, useEffect, useRef } from 'react';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import PageHero from '../components/PageHero';
import { useI18n, LOCALE_MAP } from '../lib/i18n';
import ApiUnavailable from '../components/ApiUnavailable';
import { CHAMPION_LIST_DEFAULTS, championListKey, type ChampionListPayload } from '../lib/lol-champion-filters';

// Unter dieser Spielzahl ist eine Siegrate Zufall; beim Sortieren nach Siegrate hinten.
const MIN_WINRATE_GAMES = 30;

type SortKey = 'name' | 'winRate' | 'pickRate' | 'banRate' | 'games' | 'avgKDA';

interface Champion {
  id: string;
  key: string;
  name: string;
  title: string;
  tags: string[];
  image: string;
  role: string;
  winRate: number | null;
  pickRate: number | null;
  banRate: number | null;
  games: number;
  avgKDA: number | null;
}

// `initial`: Standardansicht vom Server (page.tsx, SEO-Plan Schritt 6) — dann
// entfaellt der erste Abruf. Fehlt sie, laedt die Liste wie bisher im Browser.
export default function ChampionsPage({ initial = null }: { initial?: ChampionListPayload | null }) {
  const [champions, setChampions] = useState<Champion[]>(initial?.champions ?? []);
  const [loading, setLoading] = useState(!initial);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [tier, setTier] = useState(CHAMPION_LIST_DEFAULTS.tier);
  const [role, setRole] = useState(CHAMPION_LIST_DEFAULTS.role);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [version, setVersion] = useState(initial?.version ?? '');
  const [hasStats, setHasStats] = useState(initial?.hasStats ?? false);
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState(CHAMPION_LIST_DEFAULTS.region);
  // Zu welchen Filtern die gezeigte Liste gehoert. Gleich → kein Abruf (die
  // Startdaten beim ersten Rendern, auch beim doppelten Effekt im StrictMode).
  // Waehrend eines Abrufs leer: scheitert er, laedt die Rueckkehr zu den
  // vorigen Filtern neu, statt die Fehlermeldung stehen zu lassen.
  const shownKey = useRef<string | null>(initial ? `${championListKey(CHAMPION_LIST_DEFAULTS)}|0` : null);
  const { t, lang, withLang } = useI18n();

  const REGIONS = [
    { value: 'euw1', label: 'EUW' },
    { value: 'eun1', label: 'EUNE' },
    { value: 'na1', label: 'NA' },
    { value: 'kr', label: 'KR' },
    { value: 'br1', label: 'BR' },
    { value: 'la1', label: 'LAN' },
    { value: 'la2', label: 'LAS' },
    { value: 'oc1', label: 'OCE' },
    { value: 'tr1', label: 'TR' },
    { value: 'ru', label: 'RU' },
    { value: 'jp1', label: 'JP' },
    { value: 'ph2', label: 'PH' },
    { value: 'sg2', label: 'SG' },
    { value: 'th2', label: 'TH' },
    { value: 'tw2', label: 'TW' },
    { value: 'vn2', label: 'VN' },
    { value: 'me1', label: 'ME' },
  ];

  const TIERS = [
    { value: 'all', label: t('tier.all') },
    { value: 'CHALLENGER', label: t('tier.challenger') },
    { value: 'GRANDMASTER_PLUS', label: t('tier.grandmasterPlus') },
    { value: 'MASTER_PLUS', label: t('tier.masterPlus') },
  ];

  const ROLES = [
    { value: 'all', label: t('role.all') },
    { value: 'top', label: t('role.top') },
    { value: 'jungle', label: t('role.jungle') },
    { value: 'mid', label: t('role.mid') },
    { value: 'adc', label: t('role.adc') },
    { value: 'support', label: t('role.support') },
  ];

  const fetchChampions = async (signal: AbortSignal, key: string) => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/champions?tier=${tier}&role=${role}&region=${region}`, { signal });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (signal.aborted) return;
      if (!Array.isArray(data.champions)) throw new Error('no champions');
      setChampions(data.champions);
      setVersion(data.version);
      setHasStats(data.hasStats);
      shownKey.current = key;
    } catch {
      if (signal.aborted) return;
      // Sonst bliebe die Liste des vorigen Filters unter dem neuen Filter stehen.
      setChampions([]);
      setFailed(true);
    }
    if (!signal.aborted) setLoading(false);
  };

  // Abbruch im Cleanup: zwei schnelle Filter-Klicks starten zwei Requests, und
  // ohne Guard gewinnt der zuletzt EINTREFFENDE statt des zuletzt angeforderten
  // — sichtbar als falsche Champion-Liste bei korrekt markiertem Filter.
  useEffect(() => {
    const key = `${championListKey({ tier, role, region })}|${reloadKey}`;
    if (shownKey.current === key) return;
    shownKey.current = null;
    const ctl = new AbortController();
    fetchChampions(ctl.signal, key);
    return () => ctl.abort();
  }, [tier, role, region, reloadKey]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const sorted = [...champions]
    .filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      // Feste Sprache: ohne sie sortiert der Server (Node) nach seiner, der
      // Browser nach der Systemsprache — die Startdaten passten dann nicht.
      if (sortKey === 'name') return a.name.localeCompare(b.name, LOCALE_MAP[lang]) * dir;
      // Siegrate aus wenigen Spielen ist Zufall (5 Spiele, 100 %). Unter
      // MIN_WINRATE_GAMES stehen solche Champions beim Sortieren nach Siegrate hinten.
      if (sortKey === 'winRate') {
        const aLow = a.games < MIN_WINRATE_GAMES;
        const bLow = b.games < MIN_WINRATE_GAMES;
        if (aLow !== bLow) return aLow ? 1 : -1;
      }
      const av = a[sortKey] ?? -1;
      const bv = b[sortKey] ?? -1;
      return ((av as number) - (bv as number)) * dir;
    });

  const tierColors: Record<string, string> = {
    IRON: '#6b6b6b', BRONZE: '#a0652a', SILVER: '#8fa0a8', GOLD: '#c89b3c',
    PLATINUM: '#209e85', EMERALD: '#00a86b', DIAMOND: '#576cce',
    MASTER: '#9d48e0', GRANDMASTER: '#e44040', CHALLENGER: '#f0c040',
    MASTER_PLUS: '#9d48e0', GRANDMASTER_PLUS: '#e44040',
  };

  const roleLabels: Record<string, string> = {
    TOP: 'Top', JUNGLE: 'Jungle', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support', SUPPORT: 'Support',
  };

  // Als Aufruf statt als Komponente: eine hier definierte Komponente waere bei
  // jedem Rendern eine neue und wuerde neu eingehaengt (Fokus weg nach Klick).
  const sortHeader = (label: string, sKey: SortKey, className?: string) => (
    <button
      onClick={() => handleSort(sKey)}
      className={`text-xs uppercase tracking-wider hover:text-white transition-colors flex items-center gap-1 ${className || ''} ${sortKey === sKey ? 'text-accent' : 'text-fg-secondary'}`}
    >
      {label}
      {sortKey === sKey && (
        <span className="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span>
      )}
    </button>
  );

  const currentTierLabel = TIERS.find((tr) => tr.value === tier)?.label || t('tier.all');
  const currentRoleLabel = ROLES.find((r) => r.value === role)?.label || t('role.all');

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="champions" />

      <PageHero title={t('champ.title')} subtitle={t('champ.subtitle')} leftChampion="Lux" rightChampion="Teemo" />

      <div className="max-w-6xl mx-auto px-3 sm:px-6 pb-8">
        {/* Filters */}
        <div className="bg-surface-base border border-border-subtle rounded p-3 sm:p-4 mb-4">
          <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-3 sm:gap-4">
            {/* Tier Filter */}
            <div className="w-full sm:w-auto">
              <div className="text-fg-secondary text-xs mb-2">{t('champ.rank')}</div>
              <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
                {TIERS.map((tr) => (
                  <button
                    key={tr.value}
                    onClick={() => setTier(tr.value)}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors flex-shrink-0 ${
                      tier === tr.value
                        ? 'bg-accent text-surface-sunken'
                        : 'bg-surface-raised text-fg-secondary hover:text-white hover:bg-[#1a2438]'
                    }`}
                    style={tier === tr.value && tr.value !== 'all' ? { backgroundColor: tierColors[tr.value] || '#c89b3c' } : {}}
                  >
                    {tr.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Role Filter */}
            <div className="w-full sm:w-auto">
              <div className="text-fg-secondary text-xs mb-2">{t('champ.role')}</div>
              <div className="flex gap-1 overflow-x-auto pb-1">
                {ROLES.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setRole(r.value)}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                      role === r.value
                        ? 'bg-accent text-surface-sunken'
                        : 'bg-surface-raised text-fg-secondary hover:text-white hover:bg-[#1a2438]'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Region Filter */}
            <div className="w-full sm:w-auto">
              <div className="text-fg-secondary text-xs mb-2">{t('champ.regionLabel')}</div>
              <div className="flex gap-1 overflow-x-auto pb-1">
                {REGIONS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setRegion(r.value)}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                      region === r.value
                        ? 'bg-accent text-surface-sunken'
                        : 'bg-surface-raised text-fg-secondary hover:text-white hover:bg-[#1a2438]'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Search */}
            <div className="w-full sm:w-auto sm:ml-auto">
              <div className="text-fg-secondary text-xs mb-2">{t('champ.search')}</div>
              <input
                type="text"
                placeholder={t('champ.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-surface-raised border border-border-default rounded px-3 py-1.5 text-white text-xs outline-none placeholder-fg-muted w-full sm:w-48"
              />
            </div>
          </div>
        </div>

        {/* Info: no data for selected tier */}
        {tier !== 'all' && !loading && !failed && !hasStats && (
          <div className="bg-surface-raised border border-border-default rounded p-3 mb-4 text-center">
            <div className="text-fg-secondary text-xs">
              {t('champ.noDataFor')} <span className="text-white font-medium" style={{ color: tierColors[tier] }}>{currentTierLabel}</span> {t('champ.noDataAvailable')}
            </div>
          </div>
        )}

        {/* Info Banner if no stats at all */}
        {tier === 'all' && !hasStats && !loading && !failed && (
          <div className="bg-surface-raised border border-border-default rounded p-3 mb-4 text-center">
            <div className="text-fg-secondary text-xs">
              {t('champ.noDataFor')} <span className="text-white font-medium">{REGIONS.find(r => r.value === region)?.label}</span> {t('champ.noDataAvailable')}
            </div>
          </div>
        )}

        {/* Stats Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-surface-base border border-border-subtle rounded p-3 text-center">
            <div className="text-fg-secondary text-xs">{t('nav.champions')}</div>
            <div className="text-white text-xl font-medium">{sorted.length}</div>
          </div>
          <div className="bg-surface-base border border-border-subtle rounded p-3 text-center">
            <div className="text-fg-secondary text-xs">{t('champ.rank')}</div>
            <div className="text-xl font-medium" style={{ color: tierColors[tier] || '#c89b3c' }}>
              {currentTierLabel}
            </div>
          </div>
          <div className="bg-surface-base border border-border-subtle rounded p-3 text-center">
            <div className="text-fg-secondary text-xs">{t('champ.withData')}</div>
            <div className="text-white text-xl font-medium">
              {sorted.filter((c) => c.games > 0).length}
            </div>
          </div>
          <div className="bg-surface-base border border-border-subtle rounded p-3 text-center">
            <div className="text-fg-secondary text-xs">{t('champ.role')}</div>
            <div className="text-white text-xl font-medium">{currentRoleLabel}</div>
          </div>
        </div>

        {/* Champion Table */}
        <div className="bg-surface-base border border-border-subtle rounded overflow-hidden">
          {/* Table Header — Desktop */}
          <div className="hidden md:grid grid-cols-[3rem_3rem_1fr_5rem_5rem_5rem_5rem_5rem_4rem] gap-2 px-4 py-3 border-b border-border-subtle bg-surface-sunken">
            <div className="text-fg-secondary text-xs uppercase tracking-wider">#</div>
            <div />
            {sortHeader(t('champ.champion'), 'name')}
            <div className="text-fg-secondary text-xs uppercase tracking-wider">{t('champ.role')}</div>
            {sortHeader('Winrate', 'winRate', 'justify-end')}
            {sortHeader('Pickrate', 'pickRate', 'justify-end')}
            {sortHeader('Banrate', 'banRate', 'justify-end')}
            {sortHeader('KDA', 'avgKDA', 'justify-end')}
            {sortHeader(t('champ.games'), 'games', 'justify-end')}
          </div>
          {/* Mobile sort buttons */}
          <div className="md:hidden flex flex-wrap gap-1 px-3 py-2 border-b border-border-subtle bg-surface-sunken">
            {sortHeader('Name', 'name')}
            {sortHeader('WR', 'winRate')}
            {sortHeader('Pick', 'pickRate')}
            {sortHeader('Ban', 'banRate')}
            {sortHeader('KDA', 'avgKDA')}
          </div>

          {loading ? (
            <div className="text-center text-fg-secondary py-20">{t('champ.loading')}</div>
          ) : failed ? (
            <div className="p-4">
              <ApiUnavailable badge={false} messageKey="error.temporarilyUnavailable" onRetry={() => setReloadKey(k => k + 1)} />
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center text-fg-muted py-20">{t('champ.noChampions')}</div>
          ) : (
            <div className="divide-y divide-border-subtle/50">
              {sorted.map((champ, i) => {
                const winColor = champ.winRate === null ? 'text-fg-muted'
                  : champ.winRate >= 53 ? 'text-green-400'
                  : champ.winRate >= 50 ? 'text-blue-400'
                  : champ.winRate >= 48 ? 'text-fg-secondary'
                  : 'text-red-400';

                return (
                  <a
                    key={champ.key}
                    href={withLang(`/champions/${champ.id}`)}
                    className="block md:grid md:grid-cols-[3rem_3rem_1fr_5rem_5rem_5rem_5rem_5rem_4rem] gap-2 px-4 py-2 items-center hover:bg-surface-raised transition-colors"
                  >
                    {/* Mobile layout */}
                    <div className="md:hidden flex items-center gap-3">
                      <span className="text-fg-muted text-xs w-6">{i + 1}</span>
                      <img
                        src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champ.id}.png`}
                        alt={champ.name}
                        className="w-8 h-8 rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-sm font-medium">{champ.name}</div>
                        <div className="text-fg-muted text-xs">{roleLabels[champ.role] || champ.tags.join(', ')}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className={`text-sm font-medium ${winColor}`}>
                          {champ.winRate !== null ? `${champ.winRate}%` : '-'}
                        </div>
                        <div className="text-fg-muted text-xs">{champ.games > 0 ? champ.games.toLocaleString(LOCALE_MAP[lang]) + ' G' : '-'}</div>
                      </div>
                    </div>
                    {/* Desktop layout */}
                    <div className="hidden md:contents">
                      <div className="text-fg-muted text-sm">{i + 1}</div>
                      <img
                        src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champ.id}.png`}
                        alt={champ.name}
                        className="w-8 h-8 rounded"
                      />
                      <div>
                        <div className="text-white text-sm font-medium">{champ.name}</div>
                        <div className="text-fg-muted text-xs">{champ.tags.join(', ')}</div>
                      </div>
                      <div className="text-fg-secondary text-xs">{roleLabels[champ.role] || '-'}</div>
                      <div className={`text-sm text-right font-medium ${winColor}`}>
                        {champ.winRate !== null ? `${champ.winRate}%` : '-'}
                      </div>
                      <div className="text-fg-secondary text-sm text-right">
                        {champ.pickRate !== null ? `${champ.pickRate}%` : '-'}
                      </div>
                      <div className="text-sm text-right" style={{ color: champ.banRate !== null && champ.banRate > 10 ? '#e44040' : 'var(--fg-secondary)' }}>
                        {champ.banRate !== null ? `${champ.banRate}%` : '-'}
                      </div>
                      <div className="text-fg-secondary text-sm text-right">
                        {champ.avgKDA !== null ? champ.avgKDA.toFixed(2) : '-'}
                      </div>
                      <div className="text-fg-muted text-xs text-right">
                        {champ.games > 0 ? champ.games.toLocaleString(LOCALE_MAP[lang]) : '-'}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </div>

        <Footer />
      </div>
    </main>
  );
}
