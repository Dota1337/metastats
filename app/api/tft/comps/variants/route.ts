import { NextRequest, NextResponse } from 'next/server';
import { resolveFilters } from '../../../../lib/tft-supabase-reader';
import { STATS_CACHE_CONTROL, cacheControlForPatches, maybeRedirectByPatchAlias, cacheHeaders } from '../../../../lib/api-cache';
import { getAvailablePatches } from '../../../../lib/tft-supabase-reader';
import { parseClusterKey } from '../../../../lib/tft-cluster';
import { addUnitCounts, compBuildHash } from '../../../../lib/tft-comp-build-group';
import { CURRENT_SET } from '../../../../lib/current-set';

// Variants-Switcher API: returns all sub-cluster variants of a comp family.
//
// Family-Granularität (User-Entscheid 2026-06-21 / Option C):
//   compTraitFamilyKey = <trait>__<carry> — Level UND Augment werden
//   konsolidiert. Vorher (bis 2026-06-20): compFamilyKey = <trait>@<level>_
//   <carry>. Beide Formate werden hier akzeptiert (Backward-Compat alte
//   Bookmarks/Cached-URLs).
//
// PostgREST-Query-Strategie: `__` ist NICHT als Prefix in den DB-cluster_keys
// vorhanden (DB-Format ist `<trait>@<level>_<carry>...`). Heißt: wir fragen
// `like.<trait>@*_<carry>*` (kann zu viel liefern, z. B. Zweit-Carry-Suffix)
// und filtern den Carry exakt auf JS-Seite. Gelesen wird seitenweise bis zum
// Ende — ein fester Deckel (bis 15.10.2026: limit 500 ohne Sortierung) schnitt
// grosse Traits willkuerlich ab (Inferno 606, Executioner 683 Tageszeilen in
// Master+/3 Tage → 33 von 67 Knoepfen mit zu wenig Spielen).
//
// Threshold (data-skeptic 2026-06-21):
//   - min 30g absolute pro Sub-Cluster (sonst Singleton-Noise)
//   - min 5% Family-Total-Share
//   - Sort by Sample-Größe DEFAULT (most-played zuerst, statt by Avg)
//   - active-variant always included even when below threshold

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
// Supabase liefert hoechstens 1000 Zeilen je Abruf (max_rows, gemessen
// 15.10.2026: limit 5000 → 1000, Status 200 ohne Hinweis). Die Seitenschleife
// liest deshalb bis zur gezaehlten Gesamtzahl, nicht bis zur ersten kurzen
// Seite. 3 Seiten als Notbremse (~8 KB je Zeile wegen typical_units); die
// groesste Familie lag am 15.10. bei 977 Zeilen (alle Raenge, 7 Tage).
const VARIANT_PAGE = 1000;
const VARIANT_MAX_PAGES = 3;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

interface VariantRow {
  cluster_key: string;
  games: number;
  sum_placement: number;
  top4: number;
  top1: number;
  // Build-Identity: auf der TABELLE heisst die Spalte `typical_units` und ist
  // ein FLACHES jsonb-Array von { characterId, count, ... }. `typical_units_
  // merged` ist der Ausgabe-Alias der RPC (0027) — hier lesen wir per
  // PostgREST direkt, also den Tabellennamen nehmen.
  typical_units: any[] | null;
}

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

// Slug = cluster_key direct, matching the existing /api/tft/comps response
// shape (`slug: r.cluster_key`). The Comp-Detail page uses the slug as-is
// to look up the cluster, so transformations would break navigation.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const family = searchParams.get('family');
  if (!family) {
    return NextResponse.json({ error: 'family parameter required' }, { status: 400 });
  }
  // Akzeptiere BEIDE Formate: alt <trait>@<level>_<carry> (Backward-Compat)
  // + neu <trait>__<carry> (C-Konsolidierung 2026-06-21).
  const newFmt = /^([A-Za-z0-9_]+)__([A-Za-z0-9_]+)$/.exec(family);
  const oldFmt = !newFmt ? /^([A-Za-z0-9_]+)@\d+_([A-Za-z0-9_]+)$/.exec(family) : null;
  if (!newFmt && !oldFmt) {
    return NextResponse.json({ error: 'invalid family format' }, { status: 400 });
  }
  const familyTrait = (newFmt || oldFmt)![1];
  const familyCarry = (newFmt || oldFmt)![2];

  if (!SUPA_URL || !SUPA_KEY) {
    return NextResponse.json({ error: 'Supabase env vars missing' }, { status: 500 });
  }

  try {
    const patches = await getAvailablePatches();
    const redirect = maybeRedirectByPatchAlias(request, patches);
    if (redirect) return redirect;
    const cacheControl = cacheControlForPatches(patches) || STATS_CACHE_CONTROL;

    const filters = await resolveFilters(searchParams);
    const setNumber = filters.setNumber ?? CURRENT_SET;

    // Trait und Carry im Muster (gemessen 15.10.: 90-219 statt 583-683
    // Zeilen); der exakte Carry-Abgleich passiert unten in JS.
    const params = new URLSearchParams();
    params.set('select', 'cluster_key,games,sum_placement,top4,top1,typical_units');
    params.set('cluster_key', `like.${familyTrait}@*_${familyCarry}*`);
    params.set('region', `in.(${filters.regions.join(',')})`);
    params.set('bucket', `in.(${filters.buckets.join(',')})`);
    params.set('set_number', `eq.${setNumber}`);
    if (filters.patchFilter) {
      params.set('patch', `eq.${filters.patchFilter}`);
    }
    // Tagesfenster wie die Detail-Abfrage: mit Endtag (volle Tage, 0095) genau
    // [startDay, endDay], sonst wie bisher ab heute - days ohne Obergrenze.
    if (filters.startDay && filters.endDay) {
      params.append('day', `gte.${filters.startDay}`);
      params.append('day', `lte.${filters.endDay}`);
    } else {
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - filters.days);
      params.set('day', `gte.${cutoff.toISOString().slice(0, 10)}`);
    }
    // Eindeutige Reihenfolge (= Unique-Schluessel der Tabelle, 0001:104),
    // sonst ueberlappen oder fehlen Zeilen an den Seitengrenzen.
    params.set('order', 'cluster_key,day,region,bucket,patch');

    const rows: VariantRow[] = [];
    let total: number | null = null;
    for (let page = 0; total === null || rows.length < total; page++) {
      if (page >= VARIANT_MAX_PAGES) {
        console.warn(`[tft/comps/variants] ${familyTrait}__${familyCarry}: ${total ?? '?'} Zeilen, nur ${rows.length} gelesen — Knopf-Zahlen zu niedrig`);
        break;
      }
      params.set('limit', String(VARIANT_PAGE));
      params.set('offset', String(rows.length));
      const url = `${SUPA_URL}/rest/v1/tft_daily_comp_stats?${params.toString()}`;
      const res = await fetch(url, {
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${SUPA_KEY}`,
          Accept: 'application/json',
          // Gesamtzahl in Content-Range (`0-136/137`), gemessen ohne Mehrkosten.
          ...(page === 0 ? { Prefer: 'count=exact' } : {}),
        },
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Variants fetch failed: HTTP ${res.status} ${body.slice(0, 200)}`);
      }

      const chunk = (await res.json()) as VariantRow[];
      if (page === 0) {
        const m = /\/(\d+)$/.exec(res.headers.get('content-range') || '');
        total = m ? Number(m[1]) : null;
      }
      rows.push(...chunk);
      if (chunk.length === 0) break;
      // Ohne Gesamtzahl bleibt nur die kurze Seite als Ende.
      if (total === null && chunk.length < VARIANT_PAGE) break;
    }

    // Per cluster_key: Top-Counts + Top-Character-IDs für Build-Hash.
    // Build-Identity-Konsolidierung (User-Klarstellung 2026-06-21): zwei
    // Sub-Cluster mit IDENTISCHEM Champion-Set werden zu EINER Variante
    // zusammengeführt — sonst zeigt der Switcher 3x die gleiche Comp mit
    // unterschiedlichen Stats. Wir akkumulieren typical_units pro Cluster
    // und bilden danach den Hash über sortierte unique characterIds.
    type ClusterAgg = {
      games: number; sumPlacement: number; top4: number; top1: number;
      unitCounts: Map<string, number>;
    };
    const byKey = new Map<string, ClusterAgg>();
    for (const r of rows) {
      const parts = parseClusterKey(r.cluster_key);
      if (parts?.carry !== familyCarry) continue;
      const prev = byKey.get(r.cluster_key) || {
        games: 0, sumPlacement: 0, top4: 0, top1: 0,
        unitCounts: new Map<string, number>(),
      };
      prev.games += Number(r.games || 0);
      prev.sumPlacement += Number(r.sum_placement || 0);
      prev.top4 += Number(r.top4 || 0);
      prev.top1 += Number(r.top1 || 0);
      // typical_units ist pro Daily-Row ein FLACHES Array<{characterId,count,…}>.
      // Die Summierung ueber die Tage passiert durch die Schleife ueber `rows`.
      addUnitCounts(prev.unitCounts, r.typical_units);
      byKey.set(r.cluster_key, prev);
    }

    // Build-Hash pro cluster_key: dieselbe Regel wie die genaue Ansicht der
    // Detail-API (app/lib/tft-comp-build-group.ts), sonst zeigt der Knopf
    // andere Zahlen als die Seite nach dem Klick.
    const buildHashOf = (agg: ClusterAgg): string => compBuildHash(agg.unitCounts, agg.games);

    // Build-Identity-Groups bilden: Sub-Cluster mit gleichem buildHash → eine
    // Variante, weighted Stats. Anker = games-stärkster Sub-Cluster (für slug
    // + carryStar/aug/secondary-Display).
    type Group = {
      members: string[]; games: number; sumPlacement: number;
      top4: number; top1: number; anchor: string;
    };
    const byBuild = new Map<string, Group>();
    for (const [clusterKey, agg] of byKey.entries()) {
      const h = buildHashOf(agg);
      const g = byBuild.get(h) || {
        members: [], games: 0, sumPlacement: 0, top4: 0, top1: 0, anchor: clusterKey,
      };
      g.members.push(clusterKey);
      g.games += agg.games;
      g.sumPlacement += agg.sumPlacement;
      g.top4 += agg.top4;
      g.top1 += agg.top1;
      // Anker = games-stärkster Sub-Cluster (für Display-Labels)
      const anchorAgg = byKey.get(g.anchor);
      if (!anchorAgg || agg.games > anchorAgg.games) g.anchor = clusterKey;
      byBuild.set(h, g);
    }

    const familyTotal = [...byBuild.values()].reduce((s, g) => s + g.games, 0);
    // min-Sample-Threshold pro Build-Group (data-skeptic 2026-06-21):
    // 30g absolute UND 5% Family-Share.
    const MIN_ABS = 30;
    const MIN_SHARE = 0.05;

    const variants: Variant[] = [...byBuild.values()]
      .map((g): Variant | null => {
        const parts = parseClusterKey(g.anchor);
        if (!parts) return null;
        const share = familyTotal > 0 ? g.games / familyTotal : 0;
        const belowThreshold = g.games < MIN_ABS || share < MIN_SHARE;
        return {
          clusterKey: g.anchor,
          slug: g.anchor,
          games: g.games,
          avgPlacement: g.games > 0 ? g.sumPlacement / g.games : 0,
          top4Rate: g.games > 0 ? g.top4 / g.games : 0,
          top1Rate: g.games > 0 ? g.top1 / g.games : 0,
          carryStar: parts.carryStar,
          augmentSlug: parts.augmentSlug,
          secondary: parts.secondary,
          belowThreshold,
        };
      })
      .filter((v): v is Variant => v !== null)
      .filter(v => !v.belowThreshold)
      .sort((a, b) => b.games - a.games)
      .slice(0, 6);

    return NextResponse.json(
      {
        family,
        familyTotal,
        variants,
        filters: {
          region: filters.regionLabel,
          bucket: filters.bucketLabel,
          days: filters.requestedDays,
          patch: filters.patch,
          startDay: filters.startDay,
          endDay: filters.endDay,
          dataEnd: filters.dataEnd,
        },
      },
      { headers: cacheHeaders(cacheControl) },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
