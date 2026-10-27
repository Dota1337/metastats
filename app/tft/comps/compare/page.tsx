'use client';
import { useEffect, useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { withAlpha } from '../../../lib/color';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import TierFilter, { type TierBucket, tierBucketFromParam } from '../../../components/tft/TierFilter';
import { useI18n, type TranslationKey } from '../../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, findChampion, tftTraitDisplayName, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { parseClusterKey } from '../../../lib/tft-cluster';
import { costColor as costColorOf } from '../../../lib/tft-ui';
import { computeActiveTraits, activeTraitStyleColor, type ActiveTrait } from '../../../lib/tft-active-traits';
import { aggregateComponents, type CarryItemSet } from '../../../lib/tft-components';
import type { CompareTrendPoint } from '../../../components/tft/CompareTrendChart';
import { familyKeyForMerge } from '../../../lib/tft-comp-family-merge';
import { familyParts, MATCHUP_MIN_N, type MatchupVerdict } from '../../../lib/tft-comp-matchups';
import { compPath } from '../../../lib/tft-comp-path';
import { computeRoles, componentCheckFromItems, namedCarries, sortUnitsByImportance } from '../../../lib/tft-comp-roles';

// Comp-Comparison-View — zwei Comps nebeneinander. Zugang via URL-Param
// `?a=<slug>&b=<slug>` oder Compare-Button der Liste.
//
// Umbau 2026-10-10 (User: „bringt einem Spieler sehr wenig an insights"),
// Reihenfolge nach Domain-Review: Kurzurteil → Teams mit gemeinsamen Units →
// Bauteile → Risiko → Zahlen → Platz-Verteilung → Verlauf → Synergien.
// Alle Werte kommen aus der Detail-Antwort, die die Seite ohnehin laedt.
// Saetze im Kurzurteil nur, wenn der Unterschied groesser ist als der Zufall
// (data-skeptic 2026-10-10). Duell und Gegner (2026-10-11) aus
// /api/tft/comps/duel, nach den Teams: Familien-Duelle je Rang, gezeigt ab
// 100 Vergleichen, Schwellen in tft-comp-matchups.ts.

const CompareTrendChart = dynamic(() => import('../../../components/tft/CompareTrendChart'), {
  ssr: false,
  loading: () => <div className="h-[180px] rounded bg-surface-raised animate-pulse" />,
});

const COLOR_A = '#7B61FF';
const COLOR_B = '#3ecf8e';
// Zeilen unter 30 Spielen zeigen „—" (±0,8 Plaetze Zufallsfehler).
const MIN_ROW_GAMES = 30;
// Kurzurteil „doppelt gespielt" erst ab 60 Spieler-Spielen zu zweit.
const MIN_CONTESTED_SENTENCE = 60;
// 3★-Satz: mehr als die Haelfte 3★, ≥ 50 Spiele auf 2★, ≥ 1 Platz Abstand.
const STAR3_SHARE = 0.5;
const STAR2_MIN_GAMES = 50;
const STAR_GAP = 1.0;
const BOARD_UNITS = 9;

interface StarRow { star: number; games: number; avgPlacement: number }
interface ContestedRow { contested: number; games: number; avgPlacement: number }
interface LevelRow { level: number; games: number; share: number; avgPlacement: number }
interface TrendApiPoint { day: string; games: number; avgPlacement: number | null }
// Wie der Familien-Weg der Trend-Route: Tage unter 20 Spielen sind zu
// verrauscht (±0,5 Plaetze) und bleiben leer.
const MIN_TREND_DAY_GAMES = 20;
type TFn = (key: TranslationKey) => string;
// Nur die Felder der Detail-Antwort, die diese Seite liest.
interface CompData {
  clusterKey: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  pickRate: number | null;
  typicalUnits?: Array<{ characterId: string; count?: number }>;
  carryItems?: CarryItemSet[];
  carryStarOutcome?: StarRow[];
  contestedOutcome?: ContestedRow[];
  outcome?: { placementShare?: number[]; levelsStage5?: LevelRow[] };
  aliasedFromFamily?: { mergedFrom?: string[] };
  mergedFamilies?: string[];
}
// Kopf der Detail-Antwort (neben `comp`): aktueller Patch und sein Starttag.
interface PatchFilters { patch?: string | null; patchStartDay?: string | null }
// Antwort von /api/tft/comps/duel.
interface DuelEdge { fam: string; slug: string | null; games: number; rate: number }
interface DuelSide { strong: DuelEdge[]; weak: DuelEdge[] }
interface DuelData {
  days: number;
  duel: { games: number; aAhead: number; rate: number; verdict: MatchupVerdict | null } | null;
  a: DuelSide | null;
  b: DuelSide | null;
}

// Familien einer Comp fuer die Duell-Route (Zwei-Carry-Familien zusammen).
function familiesParam(comp: CompData): string {
  const fams = Array.isArray(comp.mergedFamilies) && comp.mergedFamilies.length > 0
    ? comp.mergedFamilies
    : [familyKeyForMerge(comp.clusterKey)];
  return fams.slice(0, 4).join(',');
}

// Streuung der Platzierung aus der Platz-Verteilung 1–8.
function placeSd(share: number[] | null | undefined): number | null {
  if (!Array.isArray(share) || share.length !== 8) return null;
  const mean = share.reduce((s, p, i) => s + p * (i + 1), 0);
  return Math.sqrt(share.reduce((s, p, i) => s + p * (i + 1 - mean) ** 2, 0));
}

// Unterschied ausserhalb der Zufallsschwankung (95 %)?
function beyondNoise(diff: number, sdA: number, nA: number, sdB: number, nB: number): boolean {
  if (nA <= 0 || nB <= 0) return false;
  return Math.abs(diff) > 1.96 * Math.sqrt((sdA * sdA) / nA + (sdB * sdB) / nB);
}

// Farbe gruen/rot in den Zahlen-Kaesten nur, wenn der Abstand ausserhalb der
// Zufallsschwankung liegt — sonst widerspraechen sie dem Kurzurteil
// „etwa gleich stark" (data-skeptic 2026-10-10).
function avgSignificant(a: CompData, b: CompData): boolean {
  const sdA = placeSd(a.outcome?.placementShare);
  const sdB = placeSd(b.outcome?.placementShare);
  if (sdA == null || sdB == null || a.avgPlacement == null || b.avgPlacement == null) return false;
  return beyondNoise(a.avgPlacement - b.avgPlacement, sdA, a.games, sdB, b.games);
}
function rateSignificant(pa: number | null, pb: number | null, nA: number, nB: number): boolean {
  if (pa == null || pb == null) return false;
  return beyondNoise(pa - pb, Math.sqrt(pa * (1 - pa)), nA, Math.sqrt(pb * (1 - pb)), nB);
}

function starRows(comp: CompData): { share3: number | null; s2: StarRow | null; s3: StarRow | null } {
  const rows: StarRow[] = Array.isArray(comp?.carryStarOutcome) ? comp.carryStarOutcome : [];
  const total = rows.reduce((s, r) => s + (r.games || 0), 0);
  const s3 = rows.find(r => r.star === 3) ?? null;
  const s2 = rows.find(r => r.star === 2) ?? null;
  return { share3: total > 0 && s3 ? s3.games / total : null, s2, s3 };
}

function contestedRows(comp: CompData): { c1: ContestedRow | null; c2: ContestedRow | null } {
  const rows: ContestedRow[] = Array.isArray(comp?.contestedOutcome) ? comp.contestedOutcome : [];
  return { c1: rows.find(r => r.contested === 1) ?? null, c2: rows.find(r => r.contested === 2) ?? null };
}

function boardIds(comp: CompData): string[] {
  const units: Array<{ characterId: string }> = Array.isArray(comp?.typicalUnits) ? comp.typicalUnits : [];
  return units.slice(0, BOARD_UNITS).map(u => u.characterId);
}

function familySlugsParam(comp: CompData): string {
  const merged: string[] | undefined = comp?.aliasedFromFamily?.mergedFrom;
  return Array.isArray(merged) && merged.length > 1
    ? `&familySlugs=${[...merged].sort().map(s => encodeURIComponent(s)).join(',')}`
    : '';
}

export default function TftCompsComparePage() {
  const { t, lang, withLang } = useI18n();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const slugA = search.get('a') || '';
  const slugB = search.get('b') || '';
  const [bucket, setBucket] = useState<TierBucket>(tierBucketFromParam(search.get('bucket')));
  const [region, setRegion] = useState<string>(search.get('region') || 'all');
  const days = Math.max(1, Math.min(7, parseInt(search.get('days') || '3', 10) || 3));
  const [compA, setCompA] = useState<CompData | null | undefined>(undefined);
  const [compB, setCompB] = useState<CompData | null | undefined>(undefined);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [trend, setTrend] = useState<{ a: TrendApiPoint[]; b: TrendApiPoint[] } | null>(null);
  const [patchFilters, setPatchFilters] = useState<PatchFilters | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    if (!pathname) return;
    const next = new URLSearchParams(search.toString());
    if (region === 'all') next.delete('region'); else next.set('region', region);
    if (bucket === 'master_plus') next.delete('bucket'); else next.set('bucket', bucket);
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [region, bucket, pathname, router, search]);

  // Rangwechsel (User 2026-10-10: „es passiert nichts"): ein noch nicht
  // vorberechneter Rang braucht 3–15 s. Solange bleiben die alten Zahlen
  // gedimmt stehen, und der cancelled-Guard vor den Settern verwirft die
  // spaete Antwort eines vorher gewaehlten Rangs. „Laedt" = die gezeigten
  // Daten gehoeren zu einer anderen Auswahl als der aktuellen (wie
  // compFilters auf der Detailseite, kein setState im Effect-Rumpf).
  const filterKey = `${slugA}|${slugB}|${region}|${bucket}|${days}`;
  const [loadedKey, setLoadedKey] = useState('');
  const loading = loadedKey !== filterKey;
  useEffect(() => {
    if (!slugA || !slugB) return;
    let cancelled = false;
    const key = `${slugA}|${slugB}|${region}|${bucket}|${days}`;
    const url = (slug: string) =>
      `/api/tft/comps?region=${region}&bucket=${bucket}&slug=${encodeURIComponent(slug)}&days=${days}&minGames=30&variant=family`;
    Promise.all([
      fetch(url(slugA)).then(r => r.json()).catch(() => ({ comp: null })),
      fetch(url(slugB)).then(r => r.json()).catch(() => ({ comp: null })),
    ]).then(([a, b]) => {
      if (cancelled) return;
      setCompA(a.comp || null);
      setCompB(b.comp || null);
      setPatchFilters(a.filters || b.filters || null);
      setLoadedKey(key);
    });
    return () => { cancelled = true; };
  }, [slugA, slugB, bucket, region, days]);

  // Verlauf: dieselbe Trend-Route wie die Detailseite (14 Tage, damit beide
  // Seiten denselben Cache teilen), hier die letzten 7 Tage. Familien-Slugs
  // wie auf der Detailseite, sonst zeigt der Trend nur einen Teil-Schluessel.
  useEffect(() => {
    if (!compA || !compB) return;
    let cancelled = false;
    const url = (slug: string, comp: CompData) =>
      `/api/tft/comps/trend?slug=${encodeURIComponent(slug)}&region=${region}&bucket=${bucket}&days=14&variant=family${familySlugsParam(comp)}`;
    const load = (slug: string, comp: CompData) => fetch(url(slug, comp))
      .then(r => r.ok ? r.json() : { points: [] })
      .then(d => (d.points || []) as TrendApiPoint[])
      .catch(() => [] as TrendApiPoint[]);
    Promise.all([load(slugA, compA), load(slugB, compB)]).then(([a, b]) => {
      if (!cancelled) setTrend({ a, b });
    });
    return () => { cancelled = true; };
  }, [compA, compB, slugA, slugB, region, bucket]);

  // Duell + Gegner: braucht die Familien aus der Detail-Antwort. Gezeigt wird
  // nur eine Antwort, die zur aktuellen Auswahl gehoert (cancelled-Guard wie
  // oben, Schluessel gegen spaete Antworten eines vorherigen Rangs).
  const famsA = compA ? familiesParam(compA) : '';
  const famsB = compB ? familiesParam(compB) : '';
  const duelKey = `${famsA}|${famsB}|${region}|${bucket}|${days}`;
  const [duel, setDuel] = useState<{ key: string; data: DuelData | null } | null>(null);
  useEffect(() => {
    if (!famsA || !famsB || famsA === famsB) return;
    let cancelled = false;
    const key = `${famsA}|${famsB}|${region}|${bucket}|${days}`;
    fetch(`/api/tft/comps/duel?a=${encodeURIComponent(famsA)}&b=${encodeURIComponent(famsB)}&region=${region}&bucket=${bucket}&days=${days}`)
      .then(r => (r.ok ? r.json() as Promise<DuelData> : null))
      .catch(() => null)
      .then(data => { if (!cancelled) setDuel({ key, data }); });
    return () => { cancelled = true; };
  }, [famsA, famsB, region, bucket, days]);
  const duelData = duel?.key === duelKey ? duel.data : null;
  const duelPending = !!famsA && !!famsB && famsA !== famsB && duel?.key !== duelKey;

  const traitsA = useMemo(() => compA ? computeActiveTraits(compA.typicalUnits, compA.clusterKey, assets) : [], [compA, assets]);
  const traitsB = useMemo(() => compB ? computeActiveTraits(compB.typicalUnits, compB.clusterKey, assets) : [], [compB, assets]);

  const nameA = compName(compA, compB, assets);
  const nameB = compName(compB, compA, assets);
  const sharedIds = useMemo(() => {
    if (!compA || !compB) return new Set<string>();
    const b = new Set(boardIds(compB));
    return new Set(boardIds(compA).filter(id => b.has(id)));
  }, [compA, compB]);

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="comps" />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <a href={withLang("/tft/comps")} className="inline-flex items-center py-1.5 -my-1.5 text-accent text-sm font-bold hover:underline">← {t('nav.comps')}</a>

        <div className="flex flex-wrap items-center justify-between gap-3 mt-2 mb-5">
          <h1 className="text-white text-xl font-medium">{t('tft.compare.title')}</h1>
          <div className="flex items-center gap-2">
            <TierFilter value={bucket} onChange={setBucket} />
          </div>
        </div>

        {(!slugA || !slugB) && (
          <div className="bg-surface-base border border-border-subtle rounded p-6 text-center">
            <div className="text-white text-sm font-medium">{t('tft.compare.pickTwo')}</div>
            <div className="text-fg-muted text-xs mt-2 leading-relaxed">
              {t('tft.compare.pickTwo.hint')}
            </div>
            <a
              href={withLang("/tft/comps")}
              className="inline-block mt-3 px-3 py-1.5 text-xs bg-accent-fill text-white rounded hover:bg-accent-fill-hover transition-colors"
            >
              {t('tft.compare.goToList')}
            </a>
          </div>
        )}

        {slugA && slugB && (compA === undefined || compB === undefined) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" aria-busy="true">
            {[0, 1].map(i => <div key={i} className="h-36 rounded bg-surface-base border border-border-subtle animate-pulse" />)}
            {[0, 1, 2, 3].map(i => <div key={`d${i}`} className="h-20 lg:col-span-2 rounded bg-surface-base border border-border-subtle animate-pulse" />)}
          </div>
        )}

        {slugA && slugB && compA !== undefined && compB !== undefined && (
          <div
            className={`grid grid-cols-1 lg:grid-cols-2 gap-4 transition-opacity ${loading ? 'opacity-40 animate-pulse pointer-events-none' : ''}`}
            aria-busy={loading}
          >
            {compA && compB && slugA !== slugB && (
              <Verdict compA={compA} compB={compB} nameA={nameA} nameB={nameB} shared={sharedIds.size} t={t} />
            )}
            <CompPanel comp={compA} assets={assets} t={t} side="a" sharedIds={sharedIds} />
            <CompPanel comp={compB} assets={assets} t={t} side="b" sharedIds={sharedIds} />
            {compA && compB && (
              <>
                {duelPending && (
                  <div className="h-24 col-span-1 lg:col-span-2 rounded bg-surface-base border border-border-subtle animate-pulse" />
                )}
                {duelData && (
                  <>
                    <DuelCompare data={duelData} nameA={nameA} nameB={nameB} bucketLabel={t(`tft.bucket.${bucket}` as TranslationKey)} lang={lang} t={t} />
                    <OpponentsCompare data={duelData} nameA={nameA} nameB={nameB} assets={assets} bucket={bucket} t={t} />
                  </>
                )}
                <ComponentsCompare compA={compA} compB={compB} nameA={nameA} nameB={nameB} assets={assets} t={t} />
                <RiskCompare compA={compA} compB={compB} nameA={nameA} nameB={nameB} t={t} />
                <DiffPanel
                  title={t('tft.avgPlacement')}
                  a={compA.avgPlacement}
                  b={compB.avgPlacement}
                  fmt={n => n.toFixed(2)}
                  lowerIsBetter
                  significant={avgSignificant(compA, compB)}
                />
                <DiffPanel
                  title={t('tft.top4')}
                  a={compA.top4Rate}
                  b={compB.top4Rate}
                  fmt={n => `${(n * 100).toFixed(1)}%`}
                  significant={rateSignificant(compA.top4Rate, compB.top4Rate, compA.games, compB.games)}
                />
                <DiffPanel
                  title={t('tft.top1')}
                  a={compA.top1Rate}
                  b={compB.top1Rate}
                  fmt={n => `${(n * 100).toFixed(1)}%`}
                  significant={rateSignificant(compA.top1Rate, compB.top1Rate, compA.games, compB.games)}
                />
                {/* Pick neutral: mehr Pick heisst mehr Konkurrenz um dieselben
                    Units, nicht „besser" (Domain-Review 2026-10-10). */}
                <DiffPanel
                  title={t('tft.pickRate')}
                  a={compA.pickRate}
                  b={compB.pickRate}
                  fmt={n => `${(n * 100).toFixed(2)}%`}
                  neutral
                />
                <DistributionCompare compA={compA} compB={compB} nameA={nameA} nameB={nameB} t={t} />
                <TrendCompare trend={trend} nameA={nameA} nameB={nameB} filters={patchFilters} t={t} />
                <TraitsCompare
                  traitsA={traitsA}
                  traitsB={traitsB}
                  assets={assets}
                  t={t}
                />
              </>
            )}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

// Anzeigename fuer Saetze und Spaltenkoepfe: der Carry, bei gleichem Carry
// beider Comps die Synergie.
function compName(comp: CompData | null | undefined, other: CompData | null | undefined, assets: TftAssetsBundle | null): string {
  if (!comp) return '';
  const parts = parseClusterKey(comp.clusterKey);
  if (!parts) return '';
  const carry = assets?.champions[parts.carry]?.name || '';
  const otherCarry = other ? parseClusterKey(other.clusterKey)?.carry : null;
  if (carry && otherCarry !== parts.carry) return carry;
  return tftTraitDisplayName(assets, parts.trait) || parts.trait.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
}

function fill(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), template);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-base border border-border-subtle rounded p-4 col-span-1 lg:col-span-2">
      <div className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{title}</div>
      {children}
    </div>
  );
}

function SideHead({ nameA, nameB }: { nameA: string; nameB: string }) {
  return (
    <>
      <div className="text-[11px] font-semibold truncate" style={{ color: COLOR_A }}>{nameA}</div>
      <div className="text-[11px] font-semibold truncate" style={{ color: COLOR_B }}>{nameB}</div>
    </>
  );
}

function Verdict({
  compA, compB, nameA, nameB, shared, t,
}: {
  compA: CompData; compB: CompData; nameA: string; nameB: string; shared: number; t: TFn;
}) {
  const lines: string[] = [];
  const sdA = placeSd(compA.outcome?.placementShare);
  const sdB = placeSd(compB.outcome?.placementShare);
  if (compA.avgPlacement != null && compB.avgPlacement != null && sdA != null && sdB != null) {
    const diff = compA.avgPlacement - compB.avgPlacement;
    const a = compA.avgPlacement.toFixed(2);
    const b = compB.avgPlacement.toFixed(2);
    if (beyondNoise(diff, sdA, compA.games, sdB, compB.games)) {
      const winnerA = diff < 0;
      lines.push(fill(t('tft.compVs.better'), {
        name: winnerA ? nameA : nameB, a: winnerA ? a : b, b: winnerA ? b : a,
      }));
    } else {
      lines.push(fill(t('tft.compVs.even'), { a, b }));
    }
  }
  for (const [comp, name, sd] of [[compA, nameA, sdA], [compB, nameB, sdB]] as const) {
    const { share3, s2, s3 } = starRows(comp);
    if (share3 != null && share3 > STAR3_SHARE && s2 && s3 && s2.games >= STAR2_MIN_GAMES
      && s3.games >= MIN_ROW_GAMES && s2.avgPlacement - s3.avgPlacement >= STAR_GAP) {
      lines.push(fill(t('tft.compVs.star3'), {
        name, p: String(Math.round(share3 * 100)), avg: s2.avgPlacement.toFixed(2),
      }));
    }
    const { c1, c2 } = contestedRows(comp);
    if (sd != null && c1 && c2 && c2.games >= MIN_CONTESTED_SENTENCE && c1.games >= MIN_ROW_GAMES
      && c2.avgPlacement > c1.avgPlacement
      && beyondNoise(c2.avgPlacement - c1.avgPlacement, sd, c1.games, sd, c2.games)) {
      lines.push(fill(t('tft.compVs.contested'), {
        name, a: c1.avgPlacement.toFixed(2), b: c2.avgPlacement.toFixed(2),
      }));
    }
  }
  if (lines.length === 0 && shared === 0) return null;
  return (
    <Section title={t('tft.compVs.verdict')}>
      <ul className="space-y-1.5">
        {lines.map((l, i) => (
          <li key={i} className="flex gap-2 text-sm text-fg-bright leading-snug">
            <span className="text-accent" aria-hidden="true">•</span>
            <span>{l}</span>
          </li>
        ))}
        {shared > 0 && (
          <li className="flex items-center gap-2 text-sm text-fg-bright leading-snug">
            <span className="inline-block w-3 h-3 rounded-[3px] ring-2 ring-white/80 bg-surface-raised shrink-0" aria-hidden="true" />
            <span>{fill(t('tft.compVs.shared'), { n: String(shared) })}</span>
          </li>
        )}
      </ul>
    </Section>
  );
}

// Direktes Duell: Anteil der Vergleiche (beide Comps in derselben Lobby), in
// denen A vor B landet. Unter MATCHUP_MIN_N Vergleichen ausgeblendet; der Satz
// nennt einen Sieger nur bei klarem Abstand (Urteil kommt von der Route).
function DuelCompare({
  data, nameA, nameB, bucketLabel, lang, t,
}: {
  data: DuelData; nameA: string; nameB: string; bucketLabel: string; lang: string; t: TFn;
}) {
  const d = data.duel;
  if (!d || d.games < MATCHUP_MIN_N) return null;
  const pA = Math.round(d.rate * 100);
  const pB = 100 - pA;
  const line = d.verdict === 'ahead' ? fill(t('tft.compVs.duelWins'), { name: nameA })
    : d.verdict === 'behind' ? fill(t('tft.compVs.duelWins'), { name: nameB })
      : d.verdict === 'even' ? t('tft.compVs.duelEven')
        : t('tft.compVs.duelUnclear');
  return (
    <Section title={`${t('tft.compVs.duel')} · ${bucketLabel}`}>
      <div className="flex items-baseline justify-between gap-3 text-[11px] font-semibold mb-1.5">
        <span className="truncate" style={{ color: COLOR_A }}>{nameA} {fill(t('tft.compVs.ahead'), { p: String(pA) })}</span>
        <span className="truncate text-right" style={{ color: COLOR_B }}>{nameB} {fill(t('tft.compVs.ahead'), { p: String(pB) })}</span>
      </div>
      <div className="flex h-3 rounded overflow-hidden bg-surface-raised" aria-hidden="true">
        <div style={{ width: `${pA}%`, backgroundColor: COLOR_A }} />
        <div style={{ width: `${pB}%`, backgroundColor: COLOR_B }} />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mt-2">
        <span className="text-sm text-fg-bright leading-snug">{line}</span>
        <span className="text-fg-faint text-[10px] tabular-nums">
          {fill(t('tft.compVs.comparisons'), { n: d.games.toLocaleString(lang) })}
        </span>
      </div>
    </Section>
  );
}

// Klarste Gegner je Seite (je 3, ohne die andere Seite — die steht im Duell).
// Ein Gegner, gegen den beide schwach sind, traegt „auch <Name>".
function OpponentsCompare({
  data, nameA, nameB, assets, bucket, t,
}: {
  data: DuelData; nameA: string; nameB: string; assets: TftAssetsBundle | null; bucket: string; t: TFn;
}) {
  const a = data.a;
  const b = data.b;
  if (!a || !b) return null;
  if ([a, b].every(s => s.strong.length + s.weak.length === 0)) return null;
  const weakA = new Set(a.weak.map(e => e.fam));
  const weakB = new Set(b.weak.map(e => e.fam));
  return (
    <Section title={t('tft.compVs.opponents')}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        {([[a, nameA, COLOR_A, weakB, nameB], [b, nameB, COLOR_B, weakA, nameA]] as const).map(([side, name, color, alsoWeak, other]) => (
          <div key={name + color} className="min-w-0">
            <div className="text-[11px] font-semibold truncate mb-2" style={{ color }}>{name}</div>
            <OpponentList title={t('tft.comp.beats')} tone="#3ecf8e" edges={side.strong} assets={assets} bucket={bucket} />
            <OpponentList
              title={t('tft.comp.losesTo')} tone="var(--pos-loss-text)" edges={side.weak} assets={assets} bucket={bucket}
              also={alsoWeak} alsoLabel={fill(t('tft.compVs.alsoName'), { name: other })}
            />
          </div>
        ))}
      </div>
    </Section>
  );
}

function OpponentList({
  title, tone, edges, assets, bucket, also, alsoLabel,
}: {
  title: string; tone: string; edges: DuelEdge[]; assets: TftAssetsBundle | null; bucket: string;
  also?: Set<string>; alsoLabel?: string;
}) {
  const { withLang } = useI18n();
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: tone }}>{title}</div>
      {edges.length === 0 ? (
        <div className="text-fg-faint text-xs">{'—'}</div>
      ) : (
        <div className="space-y-1.5">
          {edges.map(e => {
            const parts = familyParts(e.fam);
            const strip = (s: string) => s.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
            const champ = parts && assets ? assets.champions[parts.carry] : null;
            const carryName = champ?.name || (parts ? strip(parts.carry) : e.fam);
            const traitName = parts ? (tftTraitDisplayName(assets, parts.trait) || strip(parts.trait)) : '';
            const tile = tftChampionTileUrl(assets, champ);
            const body = (
              <>
                {tile ? (
                  <img src={tile} alt="" className="w-7 h-7 rounded border border-[#c39bff]/50 flex-shrink-0" />
                ) : (
                  <div className="w-7 h-7 rounded bg-surface-overlay flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-fg-secondary text-[9px] truncate">{traitName}</div>
                  <div className="text-white text-[11px] flex items-center gap-1 min-w-0">
                    <span className="truncate">{carryName}</span>
                    {also?.has(e.fam) && alsoLabel && (
                      <span
                        className="inline-flex items-center px-1 py-[1px] rounded text-[8px] font-medium flex-shrink-0 whitespace-nowrap"
                        style={{ color: 'var(--pos-loss-text)', backgroundColor: 'rgba(228,64,64,0.12)', border: '1px solid rgba(228,64,64,0.4)' }}
                      >{alsoLabel}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end flex-shrink-0">
                  <span className="text-[11px] tabular-nums font-medium" style={{ color: tone }}>{(e.rate * 100).toFixed(0)}%</span>
                  <span className="text-fg-faint text-[9px] tabular-nums">{e.games}</span>
                </div>
              </>
            );
            return e.slug ? (
              <a
                key={e.fam}
                href={withLang(`${compPath(e.slug)}?bucket=${bucket}`)}
                title={`${traitName} · ${carryName}`}
                className="flex items-center gap-2 hover:opacity-80 transition"
              >{body}</a>
            ) : (
              <div key={e.fam} title={`${traitName} · ${carryName}`} className="flex items-center gap-2">{body}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CompPanel({
  comp, assets, t, side, sharedIds,
}: {
  comp: CompData | null;
  assets: TftAssetsBundle | null;
  t: TFn;
  side: 'a' | 'b';
  sharedIds: Set<string>;
}) {
  if (!comp) {
    return (
      <div className="bg-surface-base border border-border-subtle rounded p-4 text-center">
        <div className="text-fg-muted text-xs">{t('tft.compare.notFound')}</div>
      </div>
    );
  }
  const parts = parseClusterKey(comp.clusterKey);
  const traitName = parts ? (tftTraitDisplayName(assets, parts.trait) || parts.trait.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '')) : '';
  const carry = parts && assets ? assets.champions[parts.carry] : null;
  const carryUrl = tftChampionTileUrl(assets, carry);
  const accentColor = side === 'a' ? COLOR_A : COLOR_B;
  // Dieselben 9 Units wie bisher (und wie sharedIds), nach Wichtigkeit wie in
  // der Comp-Liste (User 18.10.2026, sortUnitsByImportance).
  const isComponent = componentCheckFromItems(assets?.items);
  const roles = computeRoles(comp.typicalUnits, comp.games, { set: assets?.set, isComponent, keyCarry: parts?.carry });
  const board = sortUnitsByImportance((comp.typicalUnits || []).slice(0, BOARD_UNITS), roles, namedCarries(roles, parts?.carry), {
    set: assets?.set,
    isComponent,
    costOf: cid => assets?.champions[cid]?.cost ?? 1,
    nameOf: cid => (assets?.champions[cid]?.name || cid).toLowerCase(),
  });
  return (
    <div
      className="bg-surface-base border rounded p-4"
      style={{ borderColor: `${withAlpha(accentColor, 0x40)}` }}
    >
      <div className="flex items-center gap-3 mb-3">
        {carryUrl ? (
          <img src={carryUrl} alt="" className="w-12 h-12 rounded-md border-2" style={{ borderColor: '#c39bff' }} />
        ) : (
          <div className="w-12 h-12 rounded-md bg-surface-overlay" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-fg-bright text-xs truncate">{traitName}</div>
          <div className="text-white text-base font-medium truncate">{carry?.name || ''}</div>
        </div>
      </div>
      {comp.typicalUnits && comp.typicalUnits.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {board.map((u: { characterId: string }) => {
            const ch = findChampion(assets, u.characterId);
            const url = tftChampionTileUrl(assets, ch);
            const cost = ch?.cost ?? 1;
            const shared = sharedIds.has(u.characterId);
            return (
              <div key={u.characterId} className="flex flex-col items-center">
                <div
                  className={`w-9 h-9 rounded-md border-2 overflow-hidden ${shared ? 'ring-2 ring-white/80 ring-offset-1 ring-offset-surface-base' : ''}`}
                  style={{ borderColor: costColorOf(cost) }}
                  title={ch?.name || u.characterId}
                >
                  {url && <img src={url} alt={ch?.name || ''} className="w-full h-full object-cover" />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Bauteile statt fertiger Items: in Stage 2–3 haelt man Bauteile, und gleiche
// Bauteile kann man beim Wechsel mitnehmen (Domain-Review 2026-10-10).
function ComponentsCompare({
  compA, compB, nameA, nameB, assets, t,
}: {
  compA: CompData; compB: CompData; nameA: string; nameB: string; assets: TftAssetsBundle | null; t: TFn;
}) {
  const rowsA = aggregateComponents((compA.carryItems || []) as CarryItemSet[], assets, 6);
  const rowsB = aggregateComponents((compB.carryItems || []) as CarryItemSet[], assets, 6);
  if (!assets || (rowsA.length === 0 && rowsB.length === 0)) return null;
  const setB = new Set(rowsB.map(r => r.component));
  const both = new Set(rowsA.map(r => r.component).filter(c => setB.has(c)));
  const list = (rows: typeof rowsA) => (
    <div className="flex flex-wrap gap-2">
      {rows.map(r => {
        const item = assets.items[r.component];
        const url = item?.icon ? tftIconUrl(assets, item.icon) : null;
        const inBoth = both.has(r.component);
        return (
          <div key={r.component} className="flex flex-col items-center gap-0.5" title={item?.name || r.component}>
            <div className={`w-8 h-8 rounded overflow-hidden bg-surface-raised ${inBoth ? 'ring-2 ring-white/80 ring-offset-1 ring-offset-surface-base' : ''}`}>
              {url && <img src={url} alt={item?.name || ''} className="w-full h-full object-cover" />}
            </div>
            <span className="text-[10px] tabular-nums text-fg-muted">{Math.round(r.weight * 100)}%</span>
          </div>
        );
      })}
    </div>
  );
  return (
    <Section title={t('tft.compVs.components')}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        <SideHead nameA={nameA} nameB={nameB} />
        {list(rowsA)}
        {list(rowsB)}
      </div>
      {both.size > 0 && (
        <div className="flex items-center gap-2 mt-3 text-[11px] text-fg-secondary">
          <span className="inline-block w-3 h-3 rounded-[3px] ring-2 ring-white/80 bg-surface-raised" aria-hidden="true" />
          {t('tft.compVs.inBoth')}
        </div>
      )}
    </Section>
  );
}

function RiskCompare({
  compA, compB, nameA, nameB, t,
}: {
  compA: CompData; compB: CompData; nameA: string; nameB: string; t: TFn;
}) {
  const dash = <span className="text-fg-faint">—</span>;
  const starCell = (comp: CompData) => {
    const { share3, s2, s3 } = starRows(comp);
    if (share3 == null || !s3 || s3.games < MIN_ROW_GAMES) return dash;
    return (
      <div className="tabular-nums">
        <div className="text-white">{Math.round(share3 * 100)}% · Ø {s3.avgPlacement.toFixed(2)}</div>
        <div className="text-fg-muted text-[11px]">2★ · {s2 && s2.games >= MIN_ROW_GAMES ? `Ø ${s2.avgPlacement.toFixed(2)}` : '—'}</div>
      </div>
    );
  };
  const contestedCell = (comp: CompData) => {
    const { c1, c2 } = contestedRows(comp);
    if (!c1 || !c2 || c1.games < MIN_ROW_GAMES || c2.games < MIN_ROW_GAMES) return dash;
    return (
      <div className="tabular-nums">
        <div className="text-white">{t('tft.compVs.alone')} Ø {c1.avgPlacement.toFixed(2)}</div>
        <div className="text-fg-muted text-[11px]">{t('tft.compVs.twice')} Ø {c2.avgPlacement.toFixed(2)} ({c2.games})</div>
      </div>
    );
  };
  // End-Level nur von Spielern, die Stage 5 erreicht haben — sonst zaehlen
  // frueh Ausgeschiedene als „Level 7" (data-skeptic 2026-10-10).
  const levelCell = (comp: CompData) => {
    const rows: LevelRow[] = (Array.isArray(comp.outcome?.levelsStage5) ? comp.outcome.levelsStage5 : [])
      .filter((r: LevelRow) => r.games >= MIN_ROW_GAMES);
    if (rows.length === 0) return dash;
    const top = [...rows].sort((a, b) => b.share - a.share).slice(0, 2).sort((a, b) => a.level - b.level);
    return (
      <div className="tabular-nums text-white">
        {top.map(r => `Lv ${r.level} · ${Math.round(r.share * 100)}%`).join('  ·  ')}
      </div>
    );
  };
  const rows: Array<{ key: string; label: string; a: React.ReactNode; b: React.ReactNode }> = [
    { key: 'star', label: t('tft.compVs.row.star3'), a: starCell(compA), b: starCell(compB) },
    { key: 'contested', label: t('tft.compVs.row.contested'), a: contestedCell(compA), b: contestedCell(compB) },
    { key: 'level', label: t('tft.compVs.row.endLevel'), a: levelCell(compA), b: levelCell(compB) },
  ];
  return (
    <Section title={t('tft.compVs.risk')}>
      <div className="grid grid-cols-[minmax(0,6.5rem)_1fr_1fr] gap-x-4 gap-y-3 text-xs items-start">
        <div />
        <SideHead nameA={nameA} nameB={nameB} />
        {rows.map(r => (
          <div key={r.key} className="contents">
            <div className="text-fg-secondary text-[11px] uppercase tracking-wide pt-0.5">{r.label}</div>
            <div className="min-w-0">{r.a}</div>
            <div className="min-w-0">{r.b}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function DistributionCompare({
  compA, compB, nameA, nameB, t,
}: {
  compA: CompData; compB: CompData; nameA: string; nameB: string; t: TFn;
}) {
  const a: number[] | undefined = compA.outcome?.placementShare;
  const b: number[] | undefined = compB.outcome?.placementShare;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 8 || b.length !== 8) return null;
  const max = Math.max(...a, ...b, 0.01);
  return (
    <Section title={t('tft.compVs.distribution')}>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 gap-y-1 text-[11px] tabular-nums items-center">
        <div className="text-right text-[11px] font-semibold truncate" style={{ color: COLOR_A }}>{nameA}</div>
        <div />
        <div className="text-[11px] font-semibold truncate" style={{ color: COLOR_B }}>{nameB}</div>
        {a.map((pa, i) => (
          <div key={i} className="contents">
            <div className="flex items-center justify-end gap-2">
              <span className="text-fg-secondary">{(pa * 100).toFixed(1)}%</span>
              <div className="h-2 rounded-sm" style={{ width: `${(pa / max) * 70}%`, backgroundColor: COLOR_A }} />
            </div>
            <div className="text-fg-muted w-4 text-center">{i + 1}</div>
            <div className="flex items-center gap-2">
              <div className="h-2 rounded-sm" style={{ width: `${(b[i] / max) * 70}%`, backgroundColor: COLOR_B }} />
              <span className="text-fg-secondary">{(b[i] * 100).toFixed(1)}%</span>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function TrendCompare({
  trend, nameA, nameB, filters, t,
}: {
  trend: { a: TrendApiPoint[]; b: TrendApiPoint[] } | null;
  nameA: string; nameB: string;
  filters: PatchFilters | null;
  t: TFn;
}) {
  if (!trend) {
    return <Section title={t('tft.compVs.trend')}><div className="h-[180px] rounded bg-surface-raised animate-pulse" /></Section>;
  }
  const avg = (p: TrendApiPoint) => (p.games >= MIN_TREND_DAY_GAMES ? p.avgPlacement : null);
  const byDay = new Map<string, CompareTrendPoint>();
  for (const p of trend.a) byDay.set(p.day, { day: p.day, a: avg(p), b: null });
  for (const p of trend.b) {
    const cur = byDay.get(p.day) ?? { day: p.day, a: null, b: null };
    cur.b = avg(p);
    byDay.set(p.day, cur);
  }
  const points = [...byDay.values()].sort((x, y) => x.day.localeCompare(y.day)).slice(-7);
  // Patchgrenze aus der Detail-Antwort (Starttag des aktuellen Patchs): ein
  // Knick davor kommt aus dem alten Patch, nicht aus der Comp (data-skeptic).
  const start = filters?.patchStartDay?.slice(0, 10);
  const boundaryPoint = start ? points.find((p, i) => i > 0 && p.day.slice(0, 10) === start) : undefined;
  const patchBoundary = boundaryPoint && filters?.patch ? { day: boundaryPoint.day, patch: filters.patch } : null;
  if (points.filter(p => p.a != null || p.b != null).length < 2) {
    return <Section title={t('tft.compVs.trend')}><div className="text-fg-faint text-xs text-center py-6">{t('tft.trend.empty')}</div></Section>;
  }
  return (
    <Section title={t('tft.compVs.trend')}>
      <div className="flex items-center gap-4 mb-1 text-[11px]">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ backgroundColor: COLOR_A }} />{nameA}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ backgroundColor: COLOR_B }} />{nameB}</span>
      </div>
      <CompareTrendChart points={points} nameA={nameA} nameB={nameB} colorA={COLOR_A} colorB={COLOR_B} patchBoundary={patchBoundary} />
    </Section>
  );
}

function DiffPanel({
  title, a, b, fmt, lowerIsBetter, neutral, significant,
}: {
  title: string;
  a: number | null;
  b: number | null;
  fmt: (n: number) => string;
  lowerIsBetter?: boolean;
  neutral?: boolean;
  significant?: boolean;
}) {
  if (a == null || b == null) {
    return (
      <div className="bg-surface-base border border-border-subtle rounded p-4 col-span-1 lg:col-span-2">
        <div className="text-fg-secondary text-xs uppercase tracking-widest mb-2">{title}</div>
        <div className="text-fg-muted text-sm">—</div>
      </div>
    );
  }
  const diff = a - b;
  const aIsBetter = lowerIsBetter ? a < b : a > b;
  const muted = neutral || significant === false;
  const tieClass = muted || Math.abs(diff) < 0.001;
  return (
    <div className="bg-surface-base border border-border-subtle rounded p-4 col-span-1 lg:col-span-2">
      <div className="text-fg-secondary text-xs uppercase tracking-widest mb-2">{title}</div>
      <div className="grid grid-cols-3 items-center gap-2">
        <div
          className="text-right text-lg font-medium tabular-nums"
          style={{ color: tieClass ? 'var(--fg-bright)' : aIsBetter ? '#3ecf8e' : 'var(--pos-loss-text)' }}
        >
          {fmt(a)}
        </div>
        <div className="text-center text-fg-muted text-xs tabular-nums">
          {Math.abs(diff) < 0.001 ? '=' : muted ? `Δ ${fmt(Math.abs(diff))}` : (
            <span style={{ color: lowerIsBetter ? (diff < 0 ? '#3ecf8e' : 'var(--pos-loss-text)') : (diff > 0 ? '#3ecf8e' : 'var(--pos-loss-text)') }}>
              Δ {fmt(Math.abs(diff))}
            </span>
          )}
        </div>
        <div
          className="text-left text-lg font-medium tabular-nums"
          style={{ color: tieClass ? 'var(--fg-bright)' : !aIsBetter ? '#3ecf8e' : 'var(--pos-loss-text)' }}
        >
          {fmt(b)}
        </div>
      </div>
    </div>
  );
}

function TraitsCompare({
  traitsA, traitsB, assets, t,
}: {
  traitsA: ActiveTrait[];
  traitsB: ActiveTrait[];
  assets: TftAssetsBundle | null;
  t: TFn;
}) {
  const setA = new Set(traitsA.map(tr => tr.apiName));
  const setB = new Set(traitsB.map(tr => tr.apiName));
  const shared = traitsA.filter(tr => setB.has(tr.apiName));
  const onlyA = traitsA.filter(tr => !setB.has(tr.apiName));
  const onlyB = traitsB.filter(tr => !setA.has(tr.apiName));
  return (
    <div className="bg-surface-base border border-border-subtle rounded p-4 col-span-1 lg:col-span-2">
      <div className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.compare.traits')}</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <TraitColumn title={t('tft.compare.traits.shared')} traits={shared} assets={assets} accent="var(--fg-bright)" />
        <TraitColumn title={t('tft.compare.traits.onlyA')} traits={onlyA} assets={assets} accent={COLOR_A} />
        <TraitColumn title={t('tft.compare.traits.onlyB')} traits={onlyB} assets={assets} accent={COLOR_B} />
      </div>
    </div>
  );
}

function TraitColumn({
  title, traits, assets, accent,
}: {
  title: string;
  traits: ActiveTrait[];
  assets: TftAssetsBundle | null;
  accent: string;
}) {
  return (
    <div className="bg-surface-raised border border-border-subtle rounded p-3">
      <div className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: accent }}>{title}</div>
      {traits.length === 0 ? (
        <div className="text-fg-faint text-[11px]">—</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {traits.map(tr => {
            const color = activeTraitStyleColor(tr.tier);
            const iconUrl = tr.icon ? tftIconUrl(assets, tr.icon) : null;
            return (
              <div
                key={tr.apiName}
                className="flex items-center gap-1 px-1.5 py-1 rounded border bg-surface-sunken"
                style={{ borderColor: `${withAlpha(color, 0x55)}` }}
                title={tr.displayName}
              >
                {iconUrl && <img src={iconUrl} alt="" className="w-4 h-4" style={{ filter: `drop-shadow(0 0 2px ${color})` }} />}
                <span className="text-[10px] font-bold tabular-nums" style={{ color }}>{tr.count}</span>
                <span className="text-white text-[11px]">{tr.displayName}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
