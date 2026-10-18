'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { findChampion, traitTierLabel } from '../../lib/tft-cdragon';
import { useI18n } from '../../lib/i18n';
import { compTraitFamilyKey, parseClusterKey } from '../../lib/tft-cluster';
import { compPath } from '../../lib/tft-comp-path';

// Variants-Switcher: surfaces all sub-cluster variants of a comp family on
// the Comp-Detail page. Family = (trait, level, carry) without *N / ~aug /
// #secondary suffixes.
//
// Render-Rules (per data-skeptic verdict 2026-06-18):
//   - threshold for visibility: games >= 50 AND >= 5% of family total
//     (server-side enforced, see /api/tft/comps/variants)
//   - active variant always included even when below threshold
//   - Knopf „Alle" vorne = Familien-Ansicht; immer genau ein Knopf markiert
//   - Knopfreihe in der Familien-Ansicht erst ab 2 Varianten, in der genauen
//     Ansicht immer („Alle" ist der Rueckweg)
//   - max 4 variants visible (server-capped)

interface Variant {
  clusterKey: string;
  slug: string;
  games: number;
  avgPlacement: number;
  top4Rate: number;
  top1Rate: number;
  carryStar: number;
  augmentSlug: string | null;
  secondary: string | null;
  belowThreshold: boolean;
}

interface VariantsResponse {
  family: string;
  familyTotal: number;
  variants: Variant[];
}

function prettyChar(s: string) { return s.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, ''); }

// Pfadvergleich unabhaengig von der Kodierung (%40 gegen @).
function samePath(a: string, b: string): boolean {
  try {
    return decodeURIComponent(a) === decodeURIComponent(b);
  } catch {
    return a === b;
  }
}

function variantLabel(
  v: { clusterKey: string; carryStar: number; augmentSlug: string | null; secondary: string | null },
  t: (key: any) => string,
  assets: TftAssetsBundle | null,
  withCarry = false,
): string {
  const parts: string[] = [];
  const cluster = parseClusterKey(v.clusterKey);
  // Zusammengelegte Zwei-Carry-Familien (Soraka + Zyra): ohne den Carry
  // staende zweimal „Lvl 7" nebeneinander.
  if (withCarry && cluster?.carry) {
    parts.push(findChampion(assets, cluster.carry)?.name || prettyChar(cluster.carry));
  }
  // Level-Suffix damit Buttons in der C-Konsolidierungs-Sicht differenzierbar
  // sind (architect F7 2026-06-21: ohne Level wären alle 4 Buttons „Base").
  // Seit 18.10.2026 als Unit-Zahl („7 Riftbeast“), die Stufe nur als Rueckfall.
  if (cluster && cluster.level > 0) {
    parts.push(traitTierLabel(t('tft.trait.breakpoint') as string, assets, cluster.trait, cluster.level)
      ?? (t('tft.comp.variant.level') as string).replace('{n}', String(cluster.level)));
  }
  if (v.carryStar === 3) parts.push(t('tft.comp.variant.reroll3'));
  // ~TwoTanky wurde aus doppelten Einheiten geraten (bis 2026-09-13) — alte
  // Cluster-Keys tragen es noch, das Etikett ist aber falsch.
  if (v.augmentSlug && v.augmentSlug !== 'TwoTanky') parts.push(`~${v.augmentSlug}`);
  if (v.secondary) {
    const ch = findChampion(assets, v.secondary);
    const name = ch?.name || prettyChar(v.secondary);
    parts.push((t('tft.comp.variant.with') as string).replace('{name}', name));
  }
  if (parts.length === 0) return t('tft.comp.variant.base') as string;
  return parts.join(' · ');
}

export default function VariantsSwitcher({
  clusterKey, region, bucket, days, patch, assets,
  familyMergeActive = false,
  familySize = 1,
  families = null,
  activeKey = null,
  end = null,
}: {
  clusterKey: string;
  region: string;
  bucket: string;
  days: number;
  patch: string | null;
  assets: TftAssetsBundle | null;
  // Family-Mode-Info vom Detail-Page-Parent: ob die Detail-API gerade alle
  // Sub-Cluster zur Familie aggregiert (Default ab Familien-Merge-Spec) und
  // wie viele Sub-Cluster im Aggregat sitzen. familySize > 1 → Family-Banner.
  familyMergeActive?: boolean;
  familySize?: number;
  // Alle zusammengelegten Familien (<trait>__<carry>) aus der Detail-API,
  // Anker zuerst. Fehlt es (alter Snapshot), gilt nur die eigene Familie.
  families?: string[] | null;
  // Kennung, die die genaue Ansicht gerade anfragt (?variant=<Kennung>). Sie
  // ist sofort beim Klick markiert, nicht erst, wenn die Antwort da ist.
  activeKey?: string | null;
  // Endtag der gezeigten Seite (volle Tage): die Knopf-Zahlen rechnen ueber
  // dieselben Tage wie die Seite, auch wenn der Endtag inzwischen weiter ist.
  end?: string | null;
}) {
  const { t, withLang } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [data, setData] = useState<VariantsResponse | null>(null);
  // C-Konsolidierung (User-Entscheid 2026-06-21): compTraitFamilyKey statt
  // compFamilyKey — Family umfasst alle Sub-Cluster derselben Trait+Carry-
  // Identität (über Levels und Augments hinweg).
  const ownFamily = compTraitFamilyKey(clusterKey);
  const familyList = families && families.length > 0 ? families : [ownFamily];
  // Sortiert: Familien- und genaue Ansicht nennen dieselben Familien evtl. in
  // anderer Reihenfolge — das soll keinen neuen Abruf ausloesen.
  const familiesKey = [...familyList].sort().join(',');
  const multiFamily = familyList.length > 1;

  useEffect(() => {
    let cancelled = false;
    const load = (family: string) => {
      const params = new URLSearchParams({
        family,
        region,
        bucket,
        days: String(days),
      });
      if (patch) params.set('patch', patch);
      if (end) params.set('end', end);
      return fetch(`/api/tft/comps/variants?${params.toString()}`)
        .then(r => r.ok ? r.json() as Promise<VariantsResponse> : null)
        .catch(() => null);
    };
    Promise.all(familiesKey.split(',').map(load)).then(list => {
      if (cancelled) return;
      const ok = list.filter((x): x is VariantsResponse => !!x);
      if (ok.length === 0) { setData(null); return; }
      if (ok.length === 1) { setData(ok[0]); return; }
      // Zusammengelegt: dieselben Regeln wie der Server je Familie (>= 5 %
      // der Gesamtspiele, hoechstens 4), nur ueber die gemeinsame Summe.
      const familyTotal = ok.reduce((s, x) => s + (x.familyTotal || 0), 0);
      const variants = ok.flatMap(x => x.variants)
        .filter(v => v.belowThreshold || v.games >= 0.05 * familyTotal)
        .sort((a, b) => b.games - a.games)
        .slice(0, 4);
      setData({ family: ok[0].family, familyTotal, variants });
    });
    return () => { cancelled = true; };
  }, [familiesKey, region, bucket, days, patch, end]);

  if (!data) return null;

  // Aktiv ist ein Knopf nur in der genauen Ansicht: die Familien-Ansicht zeigt
  // alle Varianten zusammen, dort oeffnet jeder Knopf seine Variante.
  const activeCluster = familyMergeActive
    ? null
    : activeKey && activeKey.includes('@') ? activeKey : clusterKey;
  // Ensure active variant is always in the list (data-skeptic requirement):
  // if the user navigated directly to a below-threshold variant, show it
  // alongside the threshold-passing ones with a sample-size flag.
  const activeParts = activeCluster ? parseClusterKey(activeCluster) : null;
  const hasActive = !activeCluster || data.variants.some(v => v.clusterKey === activeCluster);
  const variants: Variant[] = (!hasActive && activeCluster && activeParts)
    ? [
        ...data.variants,
        {
          clusterKey: activeCluster,
          slug: activeCluster,
          games: 0,
          avgPlacement: 0,
          top4Rate: 0,
          top1Rate: 0,
          carryStar: activeParts.carryStar,
          augmentSlug: activeParts.augmentSlug,
          secondary: activeParts.secondary,
          belowThreshold: true,
        },
      ]
    : data.variants;

  // Family-Mode-Banner: wenn die Detail-API gerade alle Sub-Cluster aggregiert,
  // braucht der User den Hinweis + Toggle zur Sub-Cluster-Sicht. Wenn nur 1
  // Sub-Cluster in der Family ist, gibt es nichts zu aggregieren — Banner aus.
  const showFamilyBanner = familyMergeActive && familySize > 1;
  // Familien-Ansicht = Adresse der Anker-Familie ohne ?variant („Alle" und
  // „→ Familien-Ansicht"). Bei Zwei-Carry-Familien fuehrt das zurueck auf die
  // Adresse, die auch die Liste verlinkt: die Adresse des anderen Carries
  // zeigt dieselbe Familie, wird aber live gerechnet und kann eine andere
  // Spielzahl zeigen (gemessen 15.10.2026: Soraka 9733, Zyra-Adresse 7996).
  const openFamily = () => {
    const next = new URLSearchParams(window.location.search);
    next.delete('variant');
    const target = withLang(compPath(familyList[0]));
    const q = next.toString();
    const url = q ? `${target}?${q}` : target;
    if (samePath(target, window.location.pathname)) window.history.pushState(null, '', url);
    else router.push(url, { scroll: false });
  };
  const toggleVariantMode = () => {
    if (!familyMergeActive) { openFamily(); return; }
    if (!pathname) return;
    const next = new URLSearchParams(search?.toString() || '');
    next.set('variant', 'exact');
    // history.pushState statt router.push: Next haelt useSearchParams
    // synchron, rechnet die Server-Huelle der Detailseite aber nicht neu (die
    // genaue Ansicht hat ohnehin keine Startdaten). Eigener Verlaufseintrag
    // wie bei den Varianten-Knoepfen, sonst fuehrt Zurueck scheinbar nirgends hin.
    window.history.pushState(null, '', `${pathname}?${next.toString()}`);
  };
  // Knopf → genaue Ansicht genau dieser Variante (?variant=<Kennung>, siehe
  // compDetailTarget). Varianten einer Familie teilen sich die lesbare Adresse:
  // dann nur die Abfrage tauschen (kein Server-Umweg, Position bleibt, Zurueck
  // fuehrt zur vorigen Ansicht). Variante einer zusammengelegten Familie mit
  // eigener Adresse → Seitenwechsel, ebenfalls ohne Sprung nach oben.
  const openVariant = (v: Variant) => {
    const next = new URLSearchParams(window.location.search);
    next.set('variant', v.slug);
    const target = withLang(compPath(v.slug));
    const url = `${target}?${next.toString()}`;
    if (samePath(target, window.location.pathname)) window.history.pushState(null, '', url);
    else router.push(url, { scroll: false });
  };
  // Knopfreihe: in der Familien-Ansicht erst ab 2 Varianten (sonst stuende
  // „Alle" neben seiner einzigen Variante), in der genauen Ansicht immer —
  // „Alle" ist dort der Rueckweg zur Familie.
  const showRow = !familyMergeActive || variants.length >= 2;
  if (!showRow && !showFamilyBanner) return null;

  return (
    <section className="mt-3 bg-surface-base border border-border-subtle rounded p-3">
      {showFamilyBanner && (
        <div className="mb-3 flex items-center justify-between gap-2 px-3 py-2 bg-accent-a8 border border-accent-a30 rounded">
          <div className="text-xs text-fg-bright">
            {t('tft.comp.familyMode.banner')}
          </div>
          <button
            onClick={toggleVariantMode}
            className="text-[10px] uppercase tracking-widest px-2 py-1 bg-surface-sunken border border-accent-a40 text-fg-bright hover:text-white hover:border-accent rounded transition-colors"
          >
            {t('tft.comp.familyMode.toggleToExact')}
          </button>
        </div>
      )}
      {!familyMergeActive && (
        <div className="mb-3 flex items-center justify-between gap-2 px-3 py-2 bg-surface-sunken border border-border-subtle rounded">
          <div className="text-xs text-fg-secondary">
            {t('tft.comp.familyMode.exactNotice')}
          </div>
          <button
            onClick={toggleVariantMode}
            className="text-[10px] uppercase tracking-widest px-2 py-1 bg-surface-sunken border border-border-subtle text-fg-secondary hover:text-white hover:border-accent-a40 rounded transition-colors"
          >
            {t('tft.comp.familyMode.toggleToFamily')}
          </button>
        </div>
      )}
      {showRow && (<>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-fg-secondary text-xs uppercase tracking-widest">{t('tft.comp.variants')}</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {/* „Alle" = Familien-Ansicht; markiert, solange keine einzelne
            Variante offen ist — so ist immer genau ein Knopf hervorgehoben. */}
        <button
          onClick={() => { if (!familyMergeActive) openFamily(); }}
          className={`px-3 py-1.5 rounded border text-xs transition-colors ${
            familyMergeActive
              ? 'bg-accent-a15 border-accent text-white cursor-default'
              : 'bg-surface-sunken border-border-subtle text-fg-secondary hover:border-accent-a40 hover:text-white cursor-pointer'
          }`}
          title={t('tft.comp.variant.allTitle')}
          aria-label={t('tft.comp.variant.allTitle')}
        >
          <span className="font-medium">{t('tft.comp.variant.all')}</span>
        </button>
        {variants.map(v => {
          const isActive = v.clusterKey === activeCluster;
          const label = variantLabel(v, t, assets, multiFamily);
          return (
            <button
              key={v.clusterKey}
              onClick={() => { if (!isActive) openVariant(v); }}
              className={`px-3 py-1.5 rounded border text-xs transition-colors ${
                isActive
                  ? 'bg-accent-a15 border-accent text-white cursor-default'
                  : 'bg-surface-sunken border-border-subtle text-fg-secondary hover:border-accent-a40 hover:text-white cursor-pointer'
              }`}
              title={
                v.belowThreshold
                  ? `${label} — ${t('tft.comp.variant.lowSample')}`
                  : `${label} · Avg ${v.avgPlacement.toFixed(2)} · ${v.games} games`
              }
            >
              <span className="font-medium">{label}</span>
              {!v.belowThreshold && (
                <span className="ml-2 text-fg-muted tabular-nums">
                  {v.avgPlacement.toFixed(2)} · {v.games}
                </span>
              )}
              {v.belowThreshold && (
                <span className="ml-2 text-fg-faint text-[10px]">
                  {t('tft.comp.variant.lowSample')}
                </span>
              )}
            </button>
          );
        })}
      </div>
      </>)}
    </section>
  );
}
