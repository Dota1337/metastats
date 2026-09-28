'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n } from '../../lib/i18n';
import TftHero from '../../components/tft/TftHero';
import { loadTftAssets, type TftAssetsBundle } from '../../lib/tft-cdragon';
import { CDRAGON_PLUGINS_BASE } from '../../lib/cdragon-base';
import { CURRENT_SET } from '../../lib/current-set';
import {
  MAX_PLAYERS, MIN_PLAYERS, PLAYER_COLORS, isPlayer,
  type ComparePlayer, type HistoryPoint, type Slot,
} from '../../components/tft/compare/model';
import {
  PlayerCards, CategoryWins, KeyStats, PlaystyleBlock, LevelBlock,
  TraitsBlock, UnitsBlock, SetRanksBlock, SharedLobbies,
} from '../../components/tft/compare/CompareBlocks';
import { PlacementChart, FormChart, HistoryChart, FactorBlock } from '../../components/tft/compare/CompareCharts';

const REGIONS: { value: string; label: string }[] = [
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

type Stats = NonNullable<ComparePlayer['stats']>;

/* eslint-disable @typescript-eslint/no-explicit-any -- API-Antworten ungetypt */
function toStats(s: any): Stats | null {
  if (!s || typeof s !== 'object') return null;
  return {
    totalMatches: s.totalMatches ?? 0,
    avgPlacement: s.avgPlacement ?? 0,
    top4Rate: s.top4Rate ?? 0,
    top1Rate: s.top1Rate ?? 0,
    placementDistribution: Array.isArray(s.placementDistribution) ? s.placementDistribution : [0, 0, 0, 0, 0, 0, 0, 0],
    statsSource: s.statsSource === 'season_aggregate' ? 'season_aggregate' : 'live',
    seasonAggregate: s.seasonAggregate ?? null,
    seasonRanks: Array.isArray(s.seasonRanks) ? s.seasonRanks : [],
    extras: s.extras ?? null,
  };
}

function toPlayer(d: any, fallbackName: string): ComparePlayer {
  return {
    name: d.summoner?.name || fallbackName,
    puuid: d.summoner?.puuid || '',
    tier: d.summoner?.tier || null,
    rank: d.summoner?.rank || null,
    lp: d.summoner?.lp ?? null,
    marketValue: d.marketValue?.finalValue ?? null,
    rated: !!d.marketValue?.rated,
    multiplier: d.marketValue?.multiplier ?? null,
    agents: (d.marketValue?.agents || []).map((a: any) => ({ signal: a.signal, z: a.z ?? null, available: !!a.available })),
    stats: null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function ComparePageInner() {
  // Seitenlokal statt im Layout -- siehe app/compare/page.tsx. Das Rang-Wappen
  // ist hier das einzige verbliebene Direktziel bei CommunityDragon.
  ReactDOM.preconnect(CDRAGON_PLUGINS_BASE);
  const { t } = useI18n();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Vorbelegung aus der URL (?p=Name%23Tag&p=...&region=), damit ein geteilter
  // Link denselben Vergleich oeffnet.
  const [inputs, setInputs] = useState<string[]>(() => {
    const fromUrl = search.getAll('p').map(s => s.trim()).filter(Boolean).slice(0, MAX_PLAYERS);
    while (fromUrl.length < MIN_PLAYERS) fromUrl.push('');
    return fromUrl;
  });
  const [region, setRegion] = useState(() => {
    const r = search.get('region');
    return r && REGIONS.some(x => x.value === r) ? r : 'euw1';
  });
  const [slots, setSlots] = useState<Slot[]>([]);
  const [histories, setHistories] = useState<HistoryPoint[][]>([]);
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  // Jeder Vergleich bekommt eine Nummer; Antworten eines ueberholten Laufs
  // werden verworfen.
  const runId = useRef(0);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  const setSlot = (run: number, i: number, fn: (s: Slot) => Slot) => {
    if (runId.current !== run) return;
    setSlots(prev => prev.map((s, idx) => (idx === i ? fn(s) : s)));
  };

  const loadStats = async (run: number, i: number, puuid: string, reg: string) => {
    const sr = await fetch(`/api/tft/player-stats?puuid=${encodeURIComponent(puuid)}&region=${reg}&extras=1`).catch(() => null);
    const stats = sr?.ok ? toStats(await sr.json().catch(() => null)) : null;
    setSlot(run, i, s => (isPlayer(s) ? { ...s, stats: stats ?? { ...emptyStats } } : s));
    // Noch keine Einzelpartien im Speicher: Nachladen anstossen und danach
    // die Statistik erneut holen (200 = gelaufen, 429 = kuerzlich gelaufen).
    if (stats?.statsSource === 'season_aggregate') {
      const rr = await fetch('/api/tft/marktwert/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ puuid, region: reg }),
      }).catch(() => null);
      if (!rr || (!rr.ok && rr.status !== 429)) return;
      const again = await fetch(`/api/tft/player-stats?puuid=${encodeURIComponent(puuid)}&region=${reg}&extras=1`).catch(() => null);
      const fresh = again?.ok ? toStats(await again.json().catch(() => null)) : null;
      if (fresh) setSlot(run, i, s => (isPlayer(s) ? { ...s, stats: fresh } : s));
    }
  };

  const runCompare = async (names: string[], reg: string) => {
    const run = ++runId.current;
    const list = names.map(n => n.trim());
    setLoading(true);
    setSlots(list.map(() => null));
    setHistories(list.map(() => []));

    const params = new URLSearchParams();
    list.filter(Boolean).forEach(n => params.append('p', n));
    params.set('region', reg);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });

    // 1) Rang + Marktwert fuer alle gleichzeitig
    const players = await Promise.all(list.map(async (name, i): Promise<ComparePlayer | null> => {
      if (!name) return null;
      try {
        const r = await fetch(`/api/tft/marktwert?name=${encodeURIComponent(name)}&region=${reg}`);
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setSlot(run, i, () => ({ error: j.error || `HTTP ${r.status}` }));
          return null;
        }
        const p = toPlayer(await r.json(), name);
        setSlot(run, i, () => p);
        return p;
      } catch (e) {
        setSlot(run, i, () => ({ error: e instanceof Error ? e.message : String(e) }));
        return null;
      }
    }));
    if (runId.current !== run) return;

    // 2) Verlauf nur fuer bewertete Spieler, im Hintergrund
    players.forEach((p, i) => {
      if (!p?.rated || !p.puuid) return;
      fetch(`/api/tft/marktwert/history?puuid=${encodeURIComponent(p.puuid)}&region=${reg}&days=30`)
        .then(r => (r.ok ? r.json() : { series: [] }))
        .then(h => {
          if (runId.current !== run) return;
          setHistories(prev => prev.map((x, idx) => (idx === i ? (h.series || []) : x)));
        })
        .catch(() => {});
    });

    // 3) Statistik: bewertete Spieler gleichzeitig (liegen im Speicher),
    //    unbewertete nacheinander, weil sie Einzelabrufe bei Riot ausloesen.
    const rated = players.map((p, i) => ({ p, i })).filter(x => x.p?.puuid && x.p.rated);
    const unrated = players.map((p, i) => ({ p, i })).filter(x => x.p?.puuid && !x.p.rated);
    await Promise.all(rated.map(({ p, i }) => loadStats(run, i, p!.puuid, reg)));
    for (const { p, i } of unrated) {
      if (runId.current !== run) return;
      await loadStats(run, i, p!.puuid, reg);
    }
    if (runId.current === run) setLoading(false);
  };

  // Geteilter Link: Vergleich direkt starten. Ueber einen Microtask, damit
  // der Effekt selbst keinen Zustand setzt.
  useEffect(() => {
    const names = inputs.filter(n => n.trim());
    if (names.length < MIN_PLAYERS) return;
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) runCompare(inputs, region); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur beim ersten Laden
  }, []);

  const canCompare = inputs.filter(n => n.trim()).length >= MIN_PLAYERS && !loading;
  const loaded = slots.map((s, i) => ({ s, i })).filter(x => isPlayer(x.s)).map(x => ({ p: x.s as ComparePlayer, i: x.i }));
  const errors = slots.map((s, i) => ({ s, i })).filter(x => x.s && !isPlayer(x.s));
  const showBlocks = loaded.length >= MIN_PLAYERS;

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="analyse" />
      <TftHero pageTitle={t('nav.analyse')} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-6">

        <div className="bg-surface-base border border-border-subtle rounded-lg p-4 mb-4">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {REGIONS.map(r => (
              <button
                key={r.value}
                onClick={() => setRegion(r.value)}
                className={`px-2.5 py-1 rounded text-xs font-medium ${
                  region === r.value ? 'bg-accent text-white' : 'bg-surface-raised text-fg-secondary hover:text-white'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <form
            onSubmit={e => { e.preventDefault(); if (canCompare) runCompare(inputs, region); }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2"
          >
            {inputs.map((v, i) => (
              <div key={i} className="relative">
                <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r" style={{ backgroundColor: PLAYER_COLORS[i] }} />
                <input
                  type="text"
                  value={v}
                  onChange={e => setInputs(prev => prev.map((p, idx) => (idx === i ? e.target.value : p)))}
                  placeholder={`${t('tft.compare.player')} ${i + 1} (Name#Tag)`}
                  aria-label={`${t('tft.compare.player')} ${i + 1}`}
                  className="w-full bg-surface-raised border border-border-subtle rounded pl-3 pr-8 py-2 text-white text-sm outline-none focus:border-accent-a60"
                />
                {inputs.length > MIN_PLAYERS && (
                  <button
                    type="button"
                    onClick={() => setInputs(prev => prev.filter((_, idx) => idx !== i))}
                    aria-label={t('tft.compare.remove')}
                    title={t('tft.compare.remove')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded text-fg-muted hover:text-white hover:bg-surface-overlay"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
              {inputs.length < MAX_PLAYERS && (
                <button
                  type="button"
                  onClick={() => setInputs(prev => [...prev, ''])}
                  className="px-3 py-2 rounded text-sm bg-surface-raised text-fg-secondary hover:text-white border border-dashed border-border-subtle"
                >
                  + {t('tft.compare.addPlayer')}
                </button>
              )}
              <button
                type="submit"
                disabled={!canCompare}
                className="bg-accent hover:bg-accent-a80 text-white text-sm px-5 py-2 rounded disabled:opacity-50"
              >
                {loading ? t('tft.compare.comparing') : t('tft.compare.button')}
              </button>
            </div>
          </form>
        </div>

        {errors.length > 0 && (
          <div className="space-y-2 mb-4">
            {errors.map(({ s, i }) => (
              <div key={i} className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-400 text-sm">
                <span className="font-medium">{inputs[i] || `${t('tft.compare.player')} ${i + 1}`}:</span> {(s as { error: string }).error}
              </div>
            ))}
          </div>
        )}

        {loading && loaded.length === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {inputs.filter(n => n.trim()).map((_, i) => (
              <div key={i} className="h-36 rounded-lg bg-surface-base border border-border-subtle animate-pulse" />
            ))}
          </div>
        )}

        {loaded.length > 0 && <PlayerCards players={loaded} region={region} />}

        {showBlocks && (
          <>
            <CategoryWins players={loaded} />
            <KeyStats players={loaded} />
            <FactorBlock players={loaded} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-4">
              <PlacementChart players={loaded} />
              <FormChart players={loaded} />
            </div>
            <HistoryChart players={loaded} histories={histories} />
            <SharedLobbies players={loaded} />
            <TraitsBlock players={loaded} assets={assets} />
            <UnitsBlock players={loaded} assets={assets} setNumber={CURRENT_SET} />
            {/* Spielstil gibt es nur, wenn alle Spieler Saisonwerte haben;
                sonst nimmt das Level die volle Breite. */}
            <div className={`grid grid-cols-1 gap-x-4 ${loaded.every(({ p }) => p.stats?.seasonAggregate) ? 'lg:grid-cols-2' : ''}`}>
              <LevelBlock players={loaded} />
              <PlaystyleBlock players={loaded} />
            </div>
            <SetRanksBlock players={loaded} currentSet={CURRENT_SET} />
          </>
        )}
      </div>
      <Footer />
    </main>
  );
}

const emptyStats: Stats = {
  totalMatches: 0, avgPlacement: 0, top4Rate: 0, top1Rate: 0,
  placementDistribution: [0, 0, 0, 0, 0, 0, 0, 0], statsSource: 'live',
  seasonAggregate: null, seasonRanks: [], extras: null,
};

export default function TftComparePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-surface-page" />}>
      <ComparePageInner />
    </Suspense>
  );
}
