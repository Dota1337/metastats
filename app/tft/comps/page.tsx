'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import EmptyData from '../../components/tft/EmptyData';
import CompRow from '../../components/tft/CompRow';
import CompFamilyRow, { type CompFamily, type FamilyComp } from '../../components/tft/CompFamilyRow';
import { compTraitFamilyKey, parseClusterKey } from '../../lib/tft-cluster';
import { tftIsEmblem } from '../../lib/tft-cdragon';
import StatsFilterBar, {
  loadInitialFilters,
  persistFilters,
  filtersToQueryString,
  type Filters,
  type PatchInfo,
} from '../../components/tft/StatsFilterBar';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, type TftAssetsBundle } from '../../lib/tft-cdragon';
import { loadTierCutoffs, type TierCutoffs } from '../../lib/tft-tier-letter';
import TftHero from '../../components/tft/TftHero';
import AdvancedCompFilters, {
  ADV_DEFAULT,
  advFromUrlParam,
  advToUrlParam,
  applyAdvancedFilters,
  type AdvancedFilters,
} from '../../components/tft/AdvancedCompFilters';

// Filter shape and URL-sync mirror /tft/units and /tft/items so the
// three stats pages behave identically (patch / bucket / days / region).
// CompList stays as-is for the TFT landing page (compact widget).
export default function TftCompsPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // useState-Init läuft im SSR-Pass ohne window → loadInitialFilters fällt dort
  // auf URL-only zurück. Damit localStorage NICHT durch den ersten useEffect-
  // Tick mit Defaults überschrieben wird, gibt es einen separaten Init-Effekt
  // unten der nach Client-Mount setFilters() aus localStorage holt — UND ein
  // `hydrated`-Gate, damit der persist-Pfad erst nach diesem Init feuert.
  const [filters, setFilters] = useState<Filters>(() =>
    loadInitialFilters(new URLSearchParams(searchParams.toString())),
  );
  const [hydrated, setHydrated] = useState(false);
  const [adv, setAdv] = useState<AdvancedFilters>(() =>
    advFromUrlParam(searchParams.get('adv')),
  );
  const [sortBy, setSortBy] = useState<'avg' | 'win' | 'top4' | 'pick' | 'velocity'>(
    (searchParams.get('sort') as any) || 'avg',
  );
  // Whether the user manually picked a sort. As long as they haven't, toggling
  // the Δ-filter automatically promotes "Trending" so the column they just
  // enabled actually drives the order — otherwise the new column would render
  // but the rows would stay sorted by avg-placement, which made the feature
  // look broken in earlier sessions.
  const [sortTouched, setSortTouched] = useState<boolean>(() => searchParams.has('sort'));
  const [comps, setComps] = useState<any[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [patches, setPatches] = useState<PatchInfo[]>([]);
  const [minGames, setMinGames] = useState<number | null>(null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [tierCutoffs, setTierCutoffs] = useState<TierCutoffs | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => { loadTierCutoffs(assets?.set ?? null).then(setTierCutoffs); }, [assets?.set]);

  // Init-Effekt: läuft EINMAL nach Client-Mount. Wenn die URL keine Filter
  // mitbringt, ziehe sie aus localStorage. Erst danach öffnen wir das
  // hydrated-Gate, damit der Haupt-Effekt unten persistieren darf.
  useEffect(() => {
    if (typeof window === 'undefined') { setHydrated(true); return; }
    const params = new URLSearchParams(window.location.search);
    const hasUrlFilters = ['patch', 'bucket', 'days', 'region', 'velocity']
      .some(k => params.has(k));
    if (!hasUrlFilters) {
      const stored = loadInitialFilters(params);
      setFilters(stored);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLoading(true);
    const qs = filtersToQueryString(filters);
    fetch(`/api/tft/comps?${qs}&source=data`)
      .then(r => r.json())
      .then(d => {
        setHasData(!!d.hasData);
        setComps(d.comps || []);
        setPatches(d.patches || []);
        setMinGames(typeof d.minGames === 'number' ? d.minGames : null);
        setLoading(false);
      })
      .catch(() => { setHasData(false); setComps([]); setLoading(false); });
    // Persist NUR nach Hydration — sonst überschreibt der erste Effekt-Tick
    // mit den (URL-only) Defaults die in localStorage gespeicherte Persona,
    // bevor der Init-Effekt sie laden konnte.
    if (hydrated) persistFilters(filters);
    const advParam = advToUrlParam(adv);
    const sortParam = sortTouched && sortBy !== 'avg' ? `&sort=${sortBy}` : '';
    const url = `${pathname}?${qs}${advParam ? `&adv=${advParam}` : ''}${sortParam}`;
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== url) {
      router.replace(url, { scroll: false });
    }
  }, [filters, adv, sortBy, sortTouched, hydrated, pathname, router]);

  // Filter-change handler that also auto-flips the sort to "Trending" the
  // first time the user enables Δ — and back to "avg" when they turn it off.
  // Skips if they've explicitly chosen a sort already, so a manual decision
  // is never overridden. Done in the change handler instead of an effect to
  // avoid the setState-within-effect cascade lint flags warn about.
  const handleFiltersChange = (next: Filters) => {
    if (!sortTouched) {
      if (next.velocity > 0 && filters.velocity === 0) setSortBy('velocity');
      else if (next.velocity === 0 && filters.velocity > 0) setSortBy('avg');
    }
    setFilters(next);
  };

  const currentPatchLabel = patches[0]?.patch;

  // Apply advanced filters BEFORE sort so the result count + sort target match.
  // Client-side filter on the already-loaded comps — no extra API roundtrip.
  // Carry-Cost-Lookup: cluster_key = "<trait>@<level>_<carryCharacterId>".
  // Bundle-Champions tragen den Cost direkt; null wenn der Carry-Asset fehlt
  // (stale Carry-ID nach Set-Wechsel).
  const carryCostLookup = (clusterKey: string): number | null => {
    if (!assets) return null;
    const m = /^(.+)@\d+_(.+)$/.exec(clusterKey);
    if (!m) return null;
    const ch = assets.champions[m[2]];
    return typeof ch?.cost === 'number' ? ch.cost : null;
  };
  const filteredComps = applyAdvancedFilters(comps, adv, { carryCostLookup });

  // Family-Aggregation: gruppiert auf <trait>@<level>. Pro Family Family-
  // Aggregat (sum games, weighted avg-Placement/Top4/Top1) + Main-Comp =
  // die nach aktueller Sort-Metrik beste Variante (architect-Verdict 2026-06-20:
  // bei „Sort by Top1" zeigt Card-Headline die top-WR Variante, nicht die
  // meistgespielte — sonst wirkt der Sort-Klick wirkungslos). Plus Most-Played
  // Emblems: aggregiert aus topItems aller Family-Variants, gefiltert per
  // set-aware Pattern (^TFT<set>_Item_*EmblemItem$).
  const families: CompFamily[] = useMemo(() => {
    if (filteredComps.length === 0) return [];
    // Sort-key Helper für Main-Pick + Family-Sort.
    const sortKey = (c: any): number => {
      switch (sortBy) {
        case 'win':  return -(c.top1Rate ?? 0);
        case 'top4': return -(c.top4Rate ?? 0);
        case 'pick': return -(c.pickRate ?? 0);
        case 'velocity':
          return c.velocity?.deltaAvgPlace ?? Infinity;
        case 'avg':
        default:     return c.avgPlacement ?? 9;
      }
    };
    // Frontend-Pre-Konsolidierung: Star-Suffix (*N) und Secondary-Suffix (#X)
    // aus cluster_key strippen damit 2★ und 3★ (sowie verschiedene Filler-
    // Secondaries) als EINE Variante zählen. Aggregator-Konsolidierung ist
    // deployed (commit 50d8f7c), aber die heutigen Daily-Crawl-Daten haben
    // noch alte Suffixe → Frontend muss konsolidieren bis das rolling-30d-
    // Window mit neuen Daten durchgelaufen ist.
    const normalizeKey = (key: string): string => {
      const parts = parseClusterKey(key);
      if (!parts) return key;
      const aug = parts.augmentSlug ? `~${parts.augmentSlug}` : '';
      return `${parts.trait}@${parts.level}_${parts.carry}${aug}`;
    };
    const consolidated = new Map<string, any>();
    for (const c of filteredComps) {
      const normKey = normalizeKey(c.slug || c.clusterKey);
      const existing = consolidated.get(normKey);
      if (!existing) {
        consolidated.set(normKey, {
          ...c,
          slug: normKey,
          clusterKey: normKey,
          _mergedFrom: [c.slug || c.clusterKey],
          _mainOrigSlug: c.slug || c.clusterKey,
        });
        continue;
      }
      // Merge: weighted Stats + games-sum + pickRate-sum
      const ag = existing.games || 0;
      const bg = c.games || 0;
      const total = ag + bg;
      const wAvg = (a: any, b: any) => total > 0
        ? ((a ?? 0) * ag + (b ?? 0) * bg) / total
        : null;
      existing.games = total;
      existing.avgPlacement = wAvg(existing.avgPlacement, c.avgPlacement);
      existing.top4Rate = wAvg(existing.top4Rate, c.top4Rate);
      existing.top1Rate = wAvg(existing.top1Rate, c.top1Rate);
      existing.pickRate = (existing.pickRate ?? 0) + (c.pickRate ?? 0);
      existing.avgLevel = wAvg(existing.avgLevel, c.avgLevel);
      // typicalUnits + topItems: take meistgespielte Source-Cluster
      if (bg > ag) {
        existing.typicalUnits = c.typicalUnits;
        existing.typicalAugments = c.typicalAugments;
        existing._mainOrigSlug = c.slug || c.clusterKey;
      }
      existing._mergedFrom.push(c.slug || c.clusterKey);
    }
    // Slug auf Detail-Page-Variante zeigen die am meisten Games hat (sonst 404
    // weil normalizedKey nicht in DB ist)
    for (const v of consolidated.values()) {
      v.slug = v._mainOrigSlug;
      v.clusterKey = v._mainOrigSlug;
    }
    const consolidatedList = [...consolidated.values()];

    const groups = new Map<string, any[]>();
    for (const c of consolidatedList) {
      const k = compTraitFamilyKey(c.slug || c.clusterKey);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(c);
    }
    const out: CompFamily[] = [];
    for (const [familyKey, variants] of groups) {
      // Trait + Carry aus dem ersten Variant-ClusterKey holen (architect F1:
      // alter `familyKey.split('@')[0]`-Pfad würde bei neuem Key-Format
      // `<trait>__<carry>` den Carry mit in den Trait-String packen).
      const parts = parseClusterKey(variants[0].slug || variants[0].clusterKey);
      const trait = parts?.trait ?? familyKey;
      const carry = parts?.carry ?? '';
      const level = parts?.level ?? 0;
      // Main-Variante = sort-besten (nicht zwingend meistgespielt).
      const variantsBySort = [...variants].sort((a, b) => sortKey(a) - sortKey(b));
      const mainComp = variantsBySort[0];
      // Weighted Family-Stats über alle Variants.
      const totalGames = variants.reduce((s, v) => s + (v.games || 0), 0);
      const weightedAvgPlacement = totalGames > 0
        ? variants.reduce((s, v) => s + (v.avgPlacement ?? 0) * (v.games || 0), 0) / totalGames
        : null;
      const weightedTop4Rate = totalGames > 0
        ? variants.reduce((s, v) => s + (v.top4Rate ?? 0) * (v.games || 0), 0) / totalGames
        : null;
      const weightedTop1Rate = totalGames > 0
        ? variants.reduce((s, v) => s + (v.top1Rate ?? 0) * (v.games || 0), 0) / totalGames
        : null;
      const familyPickRate = variants.reduce((s, v) => s + (v.pickRate ?? 0), 0);
      // Emblem-Aggregation aus typicalUnits[].topItems aller Variants. Set-aware
      // Pattern (tftIsEmblem) gegen public/tft-assets-N.json verifiziert.
      const emblemMap = new Map<string, number>();
      // Augment-Aggregation aus typicalAugments aller Variants — User-Vorgabe
      // 2026-06-20: „most-played emblems sowie augments bleibt bestehen".
      const augmentMap = new Map<string, number>();
      for (const v of variants) {
        for (const u of v.typicalUnits || []) {
          for (const it of (u.topItems || [])) {
            if (!tftIsEmblem(assets, it.apiName)) continue;
            emblemMap.set(it.apiName, (emblemMap.get(it.apiName) || 0) + (it.count || 0));
          }
        }
        for (const a of ((v as any).typicalAugments || []) as Array<{ apiName: string; count: number }>) {
          if (!a?.apiName) continue;
          augmentMap.set(a.apiName, (augmentMap.get(a.apiName) || 0) + (a.count || 0));
        }
      }
      const emblems = [...emblemMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([apiName, count]) => ({ apiName, count }));
      const augments = [...augmentMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([apiName, count]) => ({ apiName, count }));
      // Family-Velocity-Override: bei sortBy='velocity' sortiert die Family-Liste
      // nach Min-Δ aller Sub-Variants, die Hauptcomp-Anzeige zeigte aber den
      // mainComp-Δ — inkonsistente UX. Wir setzen den Family-Min-Δ auf die
      // mainComp.velocity wenn velocity sortiert wird, damit die angezeigte
      // Velocity-Zahl mit der Sortierung übereinstimmt.
      if (sortBy === 'velocity') {
        let bestΔ = Infinity;
        let bestSrc: any = null;
        for (const v of variants) {
          const δ = (v as any).velocity?.deltaAvgPlace;
          if (typeof δ === 'number' && δ < bestΔ) {
            bestΔ = δ;
            bestSrc = (v as any).velocity;
          }
        }
        if (bestSrc) {
          (mainComp as any).velocity = bestSrc;
        }
      }
      out.push({
        familyKey,
        trait,
        carry,
        level,
        variants: variants as FamilyComp[],
        mainComp: mainComp as FamilyComp,
        totalGames,
        familyPickRate,
        weightedAvgPlacement,
        weightedTop4Rate,
        weightedTop1Rate,
        emblems,
        augments,
      });
    }
    // Sort families nach aktueller Sort-Metrik. Bei Sort-by-Avg nutzen wir
    // das Family-weighted-Aggregat (Sort by Top1/Pick analog).
    out.sort((a, b) => {
      switch (sortBy) {
        case 'win':  return -(a.weightedTop1Rate ?? 0) - -(b.weightedTop1Rate ?? 0);
        case 'top4': return -(a.weightedTop4Rate ?? 0) - -(b.weightedTop4Rate ?? 0);
        case 'pick': return (b.familyPickRate ?? 0) - (a.familyPickRate ?? 0);
        case 'velocity':
          // Family-Velocity = Min-Δ über Variants (most-improved sub-variant
          // drückt die Family nach oben).
          {
            const aΔ = Math.min(...a.variants.map(v => (v as any).velocity?.deltaAvgPlace ?? Infinity));
            const bΔ = Math.min(...b.variants.map(v => (v as any).velocity?.deltaAvgPlace ?? Infinity));
            return aΔ - bΔ;
          }
        case 'avg':
        default: return (a.weightedAvgPlacement ?? 9) - (b.weightedAvgPlacement ?? 9);
      }
    });
    return out;
  }, [filteredComps, sortBy, assets]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <TftHero pageTitle={t('nav.comps')} patch={currentPatchLabel} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        <StatsFilterBar filters={filters} patches={patches} onChange={handleFiltersChange} />

        <AdvancedCompFilters
          filters={adv}
          onChange={setAdv}
          resultCount={filteredComps.length}
          totalCount={comps.length}
        />

        <div className="flex items-center justify-end gap-2 mb-3 -mt-1 text-xs">
          <span className="text-[#7a8aa0]">{t('tft.sortBy')}:</span>
          <select
            value={sortBy}
            onChange={e => { setSortTouched(true); setSortBy(e.target.value as any); }}
            className="bg-[#141c2e] border border-[#1e2a3a] rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[#7B61FF]/60"
          >
            <option value="avg">{t('tft.avgPlacement')}</option>
            <option value="top4">{t('tft.top4')}</option>
            <option value="win">{t('tft.top1')}</option>
            <option value="pick">{t('tft.pickRate')}</option>
            {filters.velocity > 0 && (
              <option value="velocity">{t('tft.velocity.trending')}</option>
            )}
          </select>
        </div>

        {loading && hasData === null && (
          <div className="text-[#7a8aa0] text-center py-8">{t('tft.noDataYet').replace('Noch keine Daten', 'Lade')}</div>
        )}
        {hasData === false && <EmptyData />}

        {hasData && families.length > 0 && (
          <>
            <div className={`hidden sm:grid items-center gap-4 px-3.5 py-2 text-[11px] uppercase tracking-widest text-[#a0b0c5] font-medium ${
              filters.velocity > 0
                ? 'grid-cols-[1.5rem_1.75rem_minmax(13rem,1fr)_minmax(0,auto)_3.25rem_3.25rem_3.25rem_3.25rem_3.25rem_3.75rem_3rem]'
                : 'grid-cols-[1.5rem_1.75rem_minmax(13rem,1fr)_minmax(0,auto)_3.25rem_3.25rem_3.25rem_3.25rem_3.25rem_3rem]'
            }`}>
              <div></div>
              <div></div>
              <div>{t('nav.comps')}</div>
              <div></div>
              <div className="text-right">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.top1')}</div>
              <div className="text-right">{t('tft.pickRate')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
              {filters.velocity > 0 && (
                <div className="text-right text-[#c39bff]">
                  {t('tft.velocity.deltaVs').replace('{n}', String(filters.velocity))}
                </div>
              )}
              <div></div>
            </div>
            <div className="space-y-1.5">
              {families.map((f, i) => (
                <CompFamilyRow
                  key={f.familyKey}
                  family={f}
                  rank={i + 1}
                  assets={assets}
                  region={filters.region}
                  bucket={filters.bucket}
                  showVelocity={filters.velocity > 0}
                  velocityShift={filters.velocity}
                  tierCutoffs={tierCutoffs}
                />
              ))}
            </div>
          </>
        )}
      </div>
      <Footer />
    </main>
  );
}
