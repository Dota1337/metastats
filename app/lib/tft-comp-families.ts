// Familienbildung der Comp-Liste als reine Funktion. Liste (/tft/comps) und
// Uebersicht (/tft/comps/atlas) rechnen damit dieselben Familien mit denselben
// Zahlen — 1:1 aus app/tft/comps/page.tsx herausgezogen (2026-09-27).
import type { CompFamily, FamilyComp } from '../components/tft/CompFamilyRow';
import { compTraitFamilyKey, parseClusterKey } from './tft-cluster';
import { tftIsEmblem, type TftAssetsBundle } from './tft-cdragon';
import { computeRoles, componentCheckFromItems, jaccard, namedCarries, resolveFamilies, sumUnits } from './tft-comp-roles';

export type CompSortBy = 'avg' | 'win' | 'top4' | 'pick' | 'velocity' | 'games';

// Zeile der Comp-API (/api/tft/comps) plus die Felder, die die Familienbildung
// unterwegs anhaengt (_mergedFrom usw.).
export interface CompVelocity { deltaAvgPlace?: number | null; gamesNow?: number | null; [key: string]: unknown }
export interface CompApiRow extends FamilyComp {
  velocity?: CompVelocity | null;
  typicalAugments?: Array<{ apiName: string; count: number }>;
  _mergedFrom?: string[];
  _mainOrigSlug?: string;
  _mergedFromBuilds?: string[];
}

// Wie viele Comp-Familien die Liste hoechstens zeigt. Gemessen 2026-08-27:
// die 40 meistgespielten decken 62 % aller Spiele ab.
export const TOP_FAMILY_LIMIT = 40;

// Familien-Aggregation: gruppiert auf <trait>__<carry>. Pro Familie Aggregat
// (sum games, weighted avg-Placement/Top4/Top1) + Main-Comp = die nach
// aktueller Sort-Metrik beste Variante (architect-Verdict 2026-06-20: bei
// „Sort by Top1" zeigt Card-Headline die top-WR Variante, nicht die
// meistgespielte — sonst wirkt der Sort-Klick wirkungslos). Plus Most-Played
// Emblems: aggregiert aus topItems aller Family-Variants, gefiltert per
// set-aware Pattern (^TFT<set>_Item_*EmblemItem$).
export function buildCompFamilies(
  filteredComps: CompApiRow[],
  sortBy: CompSortBy,
  assets: TftAssetsBundle | null,
): CompFamily[] {
  if (filteredComps.length === 0) return [];
  // Sort-key Helper für Main-Pick + Family-Sort.
  const sortKey = (c: CompApiRow): number => {
    switch (sortBy) {
      case 'win':  return -(c.top1Rate ?? 0);
      case 'top4': return -(c.top4Rate ?? 0);
      case 'pick': return -(c.pickRate ?? 0);
      case 'games': return -(c.games ?? 0);
      case 'velocity':
        return c.velocity?.deltaAvgPlace ?? Infinity;
      case 'avg':
      default:     return c.avgPlacement ?? 9;
    }
  };
  // Stufe-1-Konsolidierung der API-Comp-Rows. Behält Level + Augment, strippt
  // Star und Secondary (User-Vorgabe Pre-Override: Star/Secondary identisch,
  // Level/Aug separat). Mit C-Konsolidierung 2026-06-21 ist die Stufe-2-
  // Gruppierung unten (compTraitFamilyKey) das Aggregat — Stufe-1 hilft nur
  // noch beim Backward-Compat-Merge der Rolling-30d-Window-Daten die noch
  // Star/Secondary-Suffixe tragen (Sunset nach Set-Bump oder 2026-07-20).
  const normalizeKey = (key: string): string => {
    const parts = parseClusterKey(key);
    if (!parts) return key;
    const aug = parts.augmentSlug ? `~${parts.augmentSlug}` : '';
    return `${parts.trait}@${parts.level}_${parts.carry}${aug}`;
  };
  const consolidated = new Map<string, CompApiRow>();
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
    const wAvg = (a: number | null | undefined, b: number | null | undefined) => total > 0
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
    existing._mergedFrom!.push(c.slug || c.clusterKey);
  }
  // Slug auf Detail-Page-Variante zeigen die am meisten Games hat (sonst 404
  // weil normalizedKey nicht in DB ist)
  for (const v of consolidated.values()) {
    v.slug = v._mainOrigSlug!;
    v.clusterKey = v._mainOrigSlug!;
  }
  const consolidatedList = [...consolidated.values()];

  const rawGroups = new Map<string, CompApiRow[]>();
  for (const c of consolidatedList) {
    const k = compTraitFamilyKey(c.slug || c.clusterKey);
    if (!rawGroups.has(k)) rawGroups.set(k, []);
    rawGroups.get(k)!.push(c);
  }
  // Zwei-Carry-Familien zusammenlegen (User 2026-09-27: „lege die Comps dann
  // zusammen wie bspw. Soraka + Zyra"). Regeln in tft-comp-roles; die
  // Detail-Route nutzt dieselbe Funktion, damit Liste und Detail gleich zaehlen.
  // Units aus den ROHEN API-Zeilen summieren: die Konsolidierung oben behaelt
  // je Gruppe nur die Units der groessten Zeile, die Spielzahl aber summiert —
  // daraus gerechnet waere die Praesenz jeder Unit zu klein.
  const rawByFamily = new Map<string, CompApiRow[]>();
  for (const c of filteredComps) {
    const k = compTraitFamilyKey(c.slug || c.clusterKey);
    if (!rawByFamily.has(k)) rawByFamily.set(k, []);
    rawByFamily.get(k)!.push(c);
  }
  const familyUnits = (keys: string[]) =>
    sumUnits(keys.flatMap(k => (rawByFamily.get(k) || []).map(v => v.typicalUnits)));
  const roleOpts = { set: assets?.set, isComponent: componentCheckFromItems(assets?.items) };
  const anchorOf = resolveFamilies([...rawGroups.entries()].map(([key, list]) => {
    const p = parseClusterKey(list[0].slug || list[0].clusterKey);
    return {
      key,
      trait: p?.trait ?? key,
      keyCarry: p?.carry ?? '',
      games: list.reduce((s, v) => s + (v.games || 0), 0),
      units: familyUnits([key]),
    };
  }), roleOpts);
  const membersOf = new Map<string, string[]>();
  for (const [k] of rawGroups) {
    const a = anchorOf.get(k) ?? k;
    if (!membersOf.has(a)) membersOf.set(a, []);
    membersOf.get(a)!.push(k);
  }
  const groups = new Map<string, CompApiRow[]>();
  for (const [k] of rawGroups) {
    const a = anchorOf.get(k) ?? k;
    if (!groups.has(a)) groups.set(a, []);
  }
  for (const [k, list] of rawGroups) groups.get(anchorOf.get(k) ?? k)!.push(...list);
  const out: CompFamily[] = [];
  for (const [familyKey, rawVariants] of groups) {
    // Trait + Carry aus dem Anker holen (architect F1: alter
    // `familyKey.split('@')[0]`-Pfad würde bei neuem Key-Format
    // `<trait>__<carry>` den Carry mit in den Trait-String packen).
    const anchorVariants = rawGroups.get(familyKey) ?? rawVariants;
    const parts = parseClusterKey(anchorVariants[0].slug || anchorVariants[0].clusterKey);
    const trait = parts?.trait ?? familyKey;
    const carry = parts?.carry ?? '';
    const level = parts?.level ?? 0;
    // Build-Identity-Konsolidierung (User-Wortlaut 2026-06-21): „3x die
    // gleiche Comp (gleiche Units)" → Sub-Cluster mit IDENTISCHEM
    // typicalUnits-Set (Champion-IDs, Reihenfolge egal) werden zu EINER
    // Sub-Variant gemerged. Andere Builds bleiben separate Drop-Down-Einträge.
    // Hash über sortierte unique characterIds — Items werden NICHT in die
    // Identität einbezogen (User-Erwartung „gleiche Units" = gleiche Champions).
    const buildHash = (v: CompApiRow): string => {
      const ids = ((v.typicalUnits || []) as Array<{ characterId: string }>)
        .map(u => u.characterId)
        .filter(Boolean);
      if (ids.length === 0) return `~empty~${v.slug || v.clusterKey}`;
      return [...new Set(ids)].sort().join('|');
    };
    const byBuild = new Map<string, CompApiRow[]>();
    for (const v of rawVariants) {
      const h = buildHash(v);
      if (!byBuild.has(h)) byBuild.set(h, []);
      byBuild.get(h)!.push(v);
    }
    // Pro Build-Group: weighted Stats + Anker = games-stärkster Sub-Cluster.
    // Single-Build-Group bleibt unverändert (keine Re-Aggregation nötig).
    const variants: CompApiRow[] = [];
    for (const group of byBuild.values()) {
      if (group.length === 1) { variants.push(group[0]); continue; }
      const gTotal = group.reduce((s, v) => s + (v.games || 0), 0);
      const w = (key: string) => gTotal > 0
        ? group.reduce((s, v) => s + ((v[key] ?? 0) as number) * (v.games || 0), 0) / gTotal
        : null;
      const anchor = [...group].sort((a, b) => (b.games || 0) - (a.games || 0))[0];
      const merged = {
        ...anchor,
        games: gTotal,
        avgPlacement: w('avgPlacement'),
        top4Rate: w('top4Rate'),
        top1Rate: w('top1Rate'),
        avgLevel: w('avgLevel'),
        pickRate: group.reduce((s, v) => s + (v.pickRate ?? 0), 0),
        _mergedFromBuilds: group.map(v => v.slug || v.clusterKey),
      };
      variants.push(merged);
    }
    // Main-Variante = sort-besten der konsolidierten Build-Groups.
    // CLONE statt Reference — Code-Analyzer-F3 2026-06-21: das spätere
    // mainComp.avgPlacement = weightedAvgPlacement würde sonst
    // das Original-Objekt in variants[] mutieren und beim Re-Render mit
    // anderem sortBy einen bereits-aggregierten Wert als Input für die
    // nächste Aggregation nutzen (Cascade-Drift).
    const variantsBySort = [...variants].sort((a, b) => sortKey(a) - sortKey(b));
    const mainComp = { ...variantsBySort[0] };
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
      for (const a of (v.typicalAugments || [])) {
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
    // Family-Stats-Override (User-Entscheid 2026-06-21 / architect F1): die
    // Listing-Card zeigte heute mainComp-Stats (= eines Sub-Clusters). Mit
    // C-Konsolidierung (familyKeyForMerge auf <trait>__<carry>) mergt die
    // Detail-Page-API alle Sub-Cluster — das Card-Avg müsste sonst von der
    // Detail-Avg abweichen. Wir injizieren die weighted-Family-Stats in
    // mainComp damit CompRow die Aggregat-Werte rendert (Listing↔Detail-
    // Konsistenz). Single-Variant-Family: weighted = mainComp.avgPlacement
    // → keine sichtbare Änderung.
    if (variants.length > 1) {
      mainComp.avgPlacement = weightedAvgPlacement;
      mainComp.top4Rate = weightedTop4Rate;
      mainComp.top1Rate = weightedTop1Rate;
      mainComp.games = totalGames;
      mainComp.pickRate = familyPickRate;
    }
    // Family-Velocity-Override: bei sortBy='velocity' sortiert die Family-Liste
    // nach Min-Δ aller Sub-Variants, die Hauptcomp-Anzeige zeigte aber den
    // mainComp-Δ — inkonsistente UX. Wir setzen den Family-Min-Δ auf die
    // mainComp.velocity wenn velocity sortiert wird, damit die angezeigte
    // Velocity-Zahl mit der Sortierung übereinstimmt.
    if (sortBy === 'velocity') {
      let bestΔ = Infinity;
      let bestSrc: CompVelocity | null = null;
      for (const v of variants) {
        const δ = v.velocity?.deltaAvgPlace;
        if (typeof δ === 'number' && δ < bestΔ) {
          bestΔ = δ;
          bestSrc = v.velocity ?? null;
        }
      }
      if (bestSrc) {
        mainComp.velocity = bestSrc;
      }
    }
    const familyRoles = computeRoles(familyUnits(membersOf.get(familyKey) || [familyKey]), totalGames, { ...roleOpts, keyCarry: carry });
    // Item-Traeger am gezeigten Board messen, nicht an der ganzen Familie:
    // Units, die nur in einer Level-Variante stehen, fielen sonst unter die
    // Praesenz-Schwelle, obwohl sie auf diesem Board die Items tragen.
    const shownSlugs = new Set<string>(mainComp._mergedFromBuilds ?? [variantsBySort[0].slug || variantsBySort[0].clusterKey]);
    const shownRows = rawVariants.filter(v => shownSlugs.has(v.slug || v.clusterKey));
    const boardRoles = computeRoles(sumUnits(shownRows.map(v => v.typicalUnits)),
      shownRows.reduce((s, v) => s + (v.games || 0), 0), roleOpts);
    out.push({
      familyKey,
      trait,
      carry,
      carries: familyRoles.carries,
      tanks: familyRoles.tanks,
      itemCarriers: boardRoles.itemCarriers,
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
      case 'games': return (b.totalGames ?? 0) - (a.totalGames ?? 0);
      case 'velocity':
        // Family-Velocity = Min-Δ über Variants (most-improved sub-variant
        // drückt die Family nach oben).
        {
          const aΔ = Math.min(...a.variants.map(v => (v as CompApiRow).velocity?.deltaAvgPlace ?? Infinity));
          const bΔ = Math.min(...b.variants.map(v => (v as CompApiRow).velocity?.deltaAvgPlace ?? Infinity));
          return aΔ - bΔ;
        }
      case 'avg':
      default: return (a.weightedAvgPlacement ?? 9) - (b.weightedAvgPlacement ?? 9);
    }
  });
  return out;
}

// Nur Comps des laufenden Sets. Das rollierende Zeitfenster reicht ueber den
// Set-Wechsel hinweg (gemessen 2026-08-27: 32 der 40 meistgespielten Familien
// stammten aus Set 17), und die RPC filtert nicht nach Set — `p_set` ist ohne
// `?set=`-Parameter null. Kriterium ist die Trait-Existenz im aktuellen
// Asset-Bundle statt einer Set-Nummer-Regex: das Bundle IST die Set-Grenze
// und kennt keine Praefix-Sonderfaelle (TFT17_ vs DA_18_ vs DA_Juggernaut18).
export function currentSetFamilies(families: CompFamily[], assets: TftAssetsBundle | null): CompFamily[] {
  if (!assets) return families;
  return families.filter(f => !!assets.traits[f.trait]);
}

// Harter Schnitt auf die 40 meistgespielten Familien — unabhaengig von der
// gewaehlten Sortierung. Erst nach Spielvolumen auswaehlen, dann in der
// Sortier-Reihenfolge rendern; sonst waeren es „die 40 besten" statt „die 40
// meistgespielten". Die Suche hebt den Schnitt auf, damit eine existierende
// Comp jenseits von Rang 40 auffindbar bleibt.
export function topFamilyKeys(families: CompFamily[]): Set<string> | null {
  if (families.length <= TOP_FAMILY_LIMIT) return null;
  return new Set(
    [...families]
      .sort((a, b) => (b.totalGames ?? 0) - (a.totalGames ?? 0))
      .slice(0, TOP_FAMILY_LIMIT)
      .map(f => f.familyKey),
  );
}

// Suche matched gegen Trait-Display-Name + Carry-Display-Name + raw apiNames.
export function visibleFamilies(
  families: CompFamily[],
  topKeys: Set<string> | null,
  search: string,
  assets: TftAssetsBundle | null,
): CompFamily[] {
  const q = search.trim().toLowerCase();
  if (!q || !assets) {
    return topKeys ? families.filter(f => topKeys.has(f.familyKey)) : families;
  }
  return families.filter(f => {
    const traitMeta = assets.traits[f.trait];
    const traitName = (traitMeta?.name || f.trait.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '')).toLowerCase();
    // Alle Carries der Familie durchsuchen — nach dem Zusammenlegen steht
    // z. B. Soraka nicht mehr im Familien-Key, ist aber zweiter Carry.
    const carryIds = [...new Set([f.carry, ...f.carries].filter(Boolean))];
    return traitName.includes(q)
      || f.trait.toLowerCase().includes(q)
      || carryIds.some(cid => {
        const name = (assets.champions[cid]?.name || cid.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '')).toLowerCase();
        return name.includes(q) || cid.toLowerCase().includes(q);
      });
  });
}

// Uebersicht ohne Doppelungen (User 2026-09-28: „Nimm immer nur die Comp mit
// dem höchsten AVP", Option C + Nachtrag in .claude/plan-current.md). Zwei
// Familien gelten als dieselbe Comp, wenn
//  a) jeder benannte Carry der einen in der anderen Carry oder Item-Traeger ist
//     und umgekehrt — Hunter und Juggernaut Ashe & Sivir sind dieselbe Comp mit
//     anderer Frontline (nur 33 % gleiche Units), oder
//  b) sie einen benannten Carry teilen UND ihre Kern-Units
// zu >= 60 % gleich sind (die 8 meistgespielten Units des gezeigten Boards —
// nicht die Praesenz-Schwelle aus resolveFamilies: mainComp.games ist nach dem
// Familien-Override die Summe der Familie, die Units stammen aber aus EINER
// Variante, dann faellt fast jede Unit unter 50 %). Behalten wird die mit der
// besten Ø-Platzierung. Verglichen wird nur gegen bereits behaltene Familien, nie verkettet — sonst
// schluckt ein Knoten-Carry wie Sivir (9 von 40 Familien) fremde Boards.
// Reihenfolge der Rueckgabe = Reihenfolge der Eingabe.
export const DEDUPE_MIN_JACCARD = 0.6;
const DEDUPE_BOARD_UNITS = 8;

const unitGames = (u: object): number => Number((u as { gamesWithUnit?: unknown }).gamesWithUnit) || 0;

function boardUnitIds(f: CompFamily): Set<string> {
  return new Set([...(f.mainComp.typicalUnits || [])]
    .sort((a, b) => (unitGames(b) || b.count || 0) - (unitGames(a) || a.count || 0))
    .slice(0, DEDUPE_BOARD_UNITS)
    .map(u => u.characterId));
}

export function dedupeByCarry(families: CompFamily[]): CompFamily[] {
  const info = families.map(f => ({
    f,
    named: namedCarries({ carries: f.carries, tanks: f.tanks }, f.carry),
    core: boardUnitIds(f),
    carriers: new Set([...(f.carries || []), ...(f.itemCarriers || [])]),
  }));
  const avp = (f: CompFamily) => f.weightedAvgPlacement ?? Number.POSITIVE_INFINITY;
  const kept: typeof info = [];
  for (const x of [...info].sort((a, b) => avp(a.f) - avp(b.f) || (b.f.totalGames ?? 0) - (a.f.totalGames ?? 0))) {
    const dup = kept.some(k =>
      (k.named.length > 0 && k.named.every(c => x.carriers.has(c)) && x.named.every(c => k.carriers.has(c)))
      || (k.named.some(c => x.named.includes(c)) && jaccard(k.core, x.core) >= DEDUPE_MIN_JACCARD));
    if (!dup) kept.push(x);
  }
  const keep = new Set(kept.map(k => k.f));
  return families.filter(f => keep.has(f));
}

// Trend einer Familie: nach Spielen gewichtetes Δ Ø-Platz ueber die Varianten,
// die ein belastbares Δ haben (route.ts deriveVelocity, ≥30 Spiele je Fenster).
// Gewicht = Spiele im aktuellen Fenster der Zeile, zu der das Δ gehoert.
// null, wenn keine Variante eines hat — dann zeigt die Uebersicht keinen Pfeil.
export function familyTrend(f: CompFamily): number | null {
  let w = 0;
  let s = 0;
  for (const v of f.variants) {
    const vel = (v as CompApiRow).velocity;
    const d = vel?.deltaAvgPlace;
    if (typeof d !== 'number' || !Number.isFinite(d)) continue;
    const g = Number(vel?.gamesNow) || 0;
    s += d * g;
    w += g;
  }
  return w > 0 ? s / w : null;
}
