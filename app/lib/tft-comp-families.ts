// Familienbildung der Comp-Liste als reine Funktion. Liste (/tft/comps) und
// Uebersicht (/tft/comps/atlas) rechnen damit dieselben Familien mit denselben
// Zahlen — 1:1 aus app/tft/comps/page.tsx herausgezogen (2026-09-27).
import type { CompFamily, FamilyComp } from '../components/tft/CompFamilyRow';
import { compTraitFamilyKey, parseClusterKey, parseFamilyKey } from './tft-cluster';
import { tftIsEmblem, type TftAssetsBundle } from './tft-cdragon';
import { computeRoles, componentCheckFromItems, coreFlexMap, jaccard, namedCarries, rerollPlan, resolveFamilies, sumUnits, type CoreFlexKind } from './tft-comp-roles';
import { sumDeltaKeys, type PatchDelta, type PatchDeltaIndex } from './tft-patch-delta';
import { sumMinorRows, type MinorCompRow } from './tft-comp-minor-rows';

// 'velocity' = „Trending": nach dem Vorpatch-Vergleich der Familie
// (attachPatchDeltas); die Familienbildung selbst rechnet dann wie bei 'avg'.
export type CompSortBy = 'avg' | 'win' | 'top4' | 'pick' | 'velocity' | 'games';

// Zeile der Comp-API (/api/tft/comps) plus die Felder, die die Familienbildung
// unterwegs anhaengt (_mergedFrom usw.).
export interface CompApiRow extends FamilyComp {
  typicalAugments?: Array<{ apiName: string; count: number }>;
  _mergedFrom?: string[];
  _mainOrigSlug?: string;
  _mergedFromBuilds?: string[];
  // Alle Roh-Cluster der Variante (fuer ihren Vorpatch-Vergleich).
  _clusterKeys?: string[];
  coreFlex?: Record<string, CoreFlexKind>;
  delta?: PatchDelta | null;
  // Comp aus dem Katalog (tft-comp-catalog-resolver, gesetzt von der Comp-API):
  // string = gehoert zu dieser Comp, null = ohne Comp (erscheint nicht),
  // fehlt = klassisch (kein Katalog) → Familie aus dem Cluster-Schluessel.
  compKey?: string | null;
  // Kleine Zeilen der Comp (unter der Listen-Schwelle, ab COMP_ROW_FLOOR), nur
  // an der meistgespielten Zeile der Comp. Zaehlen nur in die Familien-Summen.
  minorRows?: MinorCompRow[];
  // Volle Zeile unter der Listen-Schwelle: Brett einer Comp, deren Zeilen alle
  // darunter liegen, deren Summe aber nicht. Seiten, die einzelne Zeilen
  // zeigen, lassen sie weg (tft-detail-filters.ts).
  listFill?: boolean;
}

// Gruppen-Schluessel einer Zeile: die Katalog-Comp, sonst die klassische
// Familie <trait>__<carry>. Liste, Startdaten und Detail-Vorrat gruppieren
// damit gleich.
export function rowFamilyKey(c: { compKey?: string | null; slug?: string | null; clusterKey?: string | null }): string {
  return c.compKey ?? compTraitFamilyKey(c.slug || c.clusterKey || '');
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
  // Zeilen ohne Katalog-Comp erscheinen nicht (compKey === null).
  filteredComps = filteredComps.filter(c => c.compKey !== null);
  if (filteredComps.length === 0) return [];
  // Sort-key Helper für Main-Pick + Family-Sort.
  const sortKey = (c: CompApiRow): number => {
    switch (sortBy) {
      case 'win':  return -(c.top1Rate ?? 0);
      case 'top4': return -(c.top4Rate ?? 0);
      case 'pick': return -(c.pickRate ?? 0);
      case 'games': return -(c.games ?? 0);
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
    const k = rowFamilyKey(c);
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
    const k = rowFamilyKey(c);
    if (!rawByFamily.has(k)) rawByFamily.set(k, []);
    rawByFamily.get(k)!.push(c);
  }
  const familyUnits = (keys: string[]) =>
    sumUnits(keys.flatMap(k => (rawByFamily.get(k) || []).map(v => v.typicalUnits)));
  // Kleine Zeilen (tft-comp-minor-rows) je Gruppen-Schluessel ihrer Anker-Zeile.
  const minorByGroup = new Map<string, MinorCompRow[]>();
  for (const c of filteredComps) {
    if (!c.minorRows?.length) continue;
    const k = rowFamilyKey(c);
    if (!minorByGroup.has(k)) minorByGroup.set(k, []);
    minorByGroup.get(k)!.push(...c.minorRows);
  }
  const roleOpts = { set: assets?.set, isComponent: componentCheckFromItems(assets?.items) };
  // Katalog-Modus: die Comps des Katalogs sind schon die zusammengelegte
  // Einheit, kein Zwei-Carry-Zusammenlegen (gemessen 20.10.2026: kein Paar von
  // Katalog-Comps erfuellt gleichen Trait + Kern-Jaccard >= 0,7 + gegenseitig
  // Carry; Aphelios + Nidalee und Soraka + Zyra liegen schon in je einer Comp).
  const catalogMode = filteredComps.some(c => typeof c.compKey === 'string');
  // Trait und Carry aus dem Gruppen-Schluessel, nicht aus der ersten Zeile: eine
  // Katalog-Comp hat Zeilen mit verschiedenen Traits (architect 20.10.2026).
  const anchorOf = catalogMode ? new Map<string, string>() : resolveFamilies([...rawGroups.entries()].map(([key, list]) => {
    const p = parseFamilyKey(key) ?? parseClusterKey(list[0].slug || list[0].clusterKey);
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
    // Katalog-Comp: Trait + Carry aus ihrem Namen, Stufe aus der ersten Zeile
    // mit diesem Trait (Zeilen anderer Traits tragen deren Stufe).
    const anchorVariants = rawGroups.get(familyKey) ?? rawVariants;
    const named = parseFamilyKey(familyKey);
    const parts = parseClusterKey(anchorVariants[0].slug || anchorVariants[0].clusterKey);
    const trait = named?.trait ?? parts?.trait ?? familyKey;
    const carry = named?.carry ?? parts?.carry ?? '';
    const levelRow = named
      ? anchorVariants.map(v => parseClusterKey(v.slug || v.clusterKey)).find(x => x?.trait === named.trait)
      : parts;
    const level = levelRow?.level ?? 0;
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
      // Core/Flex je Variante: Zaehler und Nenner aus denselben Zeilen. Die
      // zusammengelegte Variante traegt nur die Units des Ankers, aber die
      // Spiele der ganzen Gruppe — deshalb ueber alle Gruppenzeilen summieren.
      const clusterKeys = group.flatMap(v => v._mergedFrom ?? [v.slug || v.clusterKey]);
      if (group.length === 1) {
        variants.push({ ...group[0], _clusterKeys: clusterKeys, coreFlex: coreFlexMap(group[0].typicalUnits, group[0].games || 0) });
        continue;
      }
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
        _clusterKeys: clusterKeys,
        coreFlex: coreFlexMap(sumUnits(group.map(v => v.typicalUnits)), gTotal),
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
    // Weighted Family-Stats über alle Variants plus die kleinen Zeilen der
    // Gruppe (tft-comp-minor-rows) — die zaehlen nur hier, nicht in Varianten,
    // Brett oder Rollen. Rollen rechnen deshalb mit den Spielen der vollen
    // Zeilen (boardGames): Zaehler und Nenner aus denselben Zeilen.
    const groupKeys = membersOf.get(familyKey) || [familyKey];
    const fullKeys = new Set(groupKeys.flatMap(k => (rawByFamily.get(k) || []).map(v => v.slug || v.clusterKey)));
    const minor = sumMinorRows(groupKeys.flatMap(k => minorByGroup.get(k) || []), fullKeys);
    const boardGames = variants.reduce((s, v) => s + (v.games || 0), 0);
    const totalGames = boardGames + minor.games;
    const weightedAvgPlacement = totalGames > 0
      ? (variants.reduce((s, v) => s + (v.avgPlacement ?? 0) * (v.games || 0), 0) + minor.place) / totalGames
      : null;
    const weightedTop4Rate = totalGames > 0
      ? (variants.reduce((s, v) => s + (v.top4Rate ?? 0) * (v.games || 0), 0) + minor.top4) / totalGames
      : null;
    const weightedTop1Rate = totalGames > 0
      ? (variants.reduce((s, v) => s + (v.top1Rate ?? 0) * (v.games || 0), 0) + minor.top1) / totalGames
      : null;
    const familyPickRate = variants.reduce((s, v) => s + (v.pickRate ?? 0), 0) + minor.pick;
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
    if (variants.length > 1 || minor.games > 0) {
      mainComp.avgPlacement = weightedAvgPlacement;
      mainComp.top4Rate = weightedTop4Rate;
      mainComp.top1Rate = weightedTop1Rate;
      mainComp.games = totalGames;
      mainComp.pickRate = familyPickRate;
    }
    const famUnits = familyUnits(groupKeys);
    const familyRoles = computeRoles(famUnits, boardGames, { ...roleOpts, keyCarry: carry });
    // Core/Flex der Hauptzeile: die Einteilung ihrer Build-Gruppe (oben), also
    // des gezeigten Boards — User 2026-10-10 „Gezeigtes Board" statt Familie,
    // nachdem 23 von 40 Zeilen nach Familie dem Board widersprachen. Die
    // Comp-DNA der Detailseite misst weiter die ganze Familie.
    // Item-Traeger am gezeigten Board messen, nicht an der ganzen Familie:
    // Units, die nur in einer Level-Variante stehen, fielen sonst unter die
    // Praesenz-Schwelle, obwohl sie auf diesem Board die Items tragen.
    const shownSlugs = new Set<string>(mainComp._mergedFromBuilds ?? [variantsBySort[0].slug || variantsBySort[0].clusterKey]);
    const shownRows = rawVariants.filter(v => shownSlugs.has(v.slug || v.clusterKey));
    const boardRoles = computeRoles(sumUnits(shownRows.map(v => v.typicalUnits)),
      shownRows.reduce((s, v) => s + (v.games || 0), 0), roleOpts);
    out.push({
      familyKey,
      // Katalog-Modus: alle klassischen Familien der Comp-Zeilen (der Δ-Vergleich
      // summiert ueber sie, attachPatchDeltas), die Comp zuerst.
      memberKeys: catalogMode
        ? [...new Set([familyKey, ...(rawByFamily.get(familyKey) || []).map(v => compTraitFamilyKey(v.slug || v.clusterKey || '')),
          ...minor.keys.map(k => compTraitFamilyKey(k))])]
        : membersOf.get(familyKey) || [familyKey],
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

// Kosten einer Comp fuer die Uebersicht nach Kosten und den Kostenfilter der
// Liste: die des ersten genannten Carrys (User 2026-09-28: Spellweaver · Veigar
// & LeBlanc gehoert zu 1-Cost). Wird ein genannter Carry mit 1–3 Kosten ueber
// die Familie ueberwiegend auf 3 Sternen gespielt (rerollPlan, dieselbe Regel
// wie die Companion-App), zaehlen seine Kosten (User 22.10.2026: Reroll-Carry
// hinter einem teureren Carry). null, wenn das Bundle keine Kosten 1–5 kennt.
export function familyCost(f: CompFamily, assets: TftAssetsBundle): number | null {
  const named = namedCarries({ carries: f.carries, tanks: f.tanks }, f.carry);
  const costOf = (cid: string) => assets.champions[cid]?.cost;
  const reroll = rerollPlan(named, f.variants, costOf);
  const costs = (reroll ? reroll.targets : named)
    .map(costOf)
    .filter((c): c is number => typeof c === 'number' && c >= 1 && c <= 5);
  return costs[0] ?? null;
}

// Harter Schnitt auf die 40 meistgespielten Familien — unabhaengig von der
// gewaehlten Sortierung. Erst nach Spielvolumen auswaehlen, dann in der
// Sortier-Reihenfolge rendern; sonst waeren es „die 40 besten" statt „die 40
// meistgespielten". Die Suche hebt den Schnitt auf, damit eine existierende
// Comp jenseits von Rang 40 auffindbar bleibt.
// Gleichstand nach familyKey: sonst entschiede bei gleichen Spielen auf Platz
// 40/41 die Sortierung, wer drin ist — und Startdaten (gerechnet mit avg)
// zeigten andere Familien als die Uebersicht in einer anderen Sortierung.
export function topFamilyKeys(families: CompFamily[]): Set<string> | null {
  if (families.length <= TOP_FAMILY_LIMIT) return null;
  return new Set(
    [...families]
      .sort((a, b) => (b.totalGames ?? 0) - (a.totalGames ?? 0) || a.familyKey.localeCompare(b.familyKey))
      .slice(0, TOP_FAMILY_LIMIT)
      .map(f => f.familyKey),
  );
}

/**
 * Kennung, auf die eine Familie verlinkt (Liste, Atlas, Sitemap) und die der
 * Publisher abfragt: die Hauptvariante, wenn sie in der Anker-Haelfte
 * (`familyKey`) liegt, sonst deren meistgespielte Variante. Bei zusammengelegten
 * Familien kann die Hauptvariante (beste Platzierung) in der anderen Haelfte
 * liegen — dann truege die lesbare Adresse einen anderen Carry als der erste
 * Name der Karte, und der Vorrat laege unter der falschen Haelfte (L2).
 */
type LinkVariant = { slug?: string | null; clusterKey?: string | null; games?: number | null };
// Katalog-Comp: bevorzugt eine Zeile, deren klassische Familie der Comp-Name
// ist; sonst die Hauptvariante — ihre Familie fuehrt die Detail-Route ueber den
// Katalog auf dieselbe Comp.
export function familyLinkSlug(f: { familyKey: string; mainComp: LinkVariant; variants?: LinkVariant[] }): string {
  const slugOf = (v: LinkVariant) => v.slug || v.clusterKey || '';
  const main = slugOf(f.mainComp);
  if (main && compTraitFamilyKey(main) === f.familyKey) return main;
  const own = (f.variants || [])
    .filter(v => compTraitFamilyKey(slugOf(v)) === f.familyKey)
    .sort((a, b) => (b.games ?? 0) - (a.games ?? 0));
  return own.length > 0 ? slugOf(own[0]) : main;
}

// Die Familien der Standardliste (laufendes Set, 40 meistgespielte, ohne Suche)
// mit dem Slug, auf den die Liste verlinkt (familyLinkSlug). Sitemap und der
// Detail-Vorrat des Publishers (/api/tft/comps/families) nutzen dieselbe Regel —
// sonst verlinkt die Sitemap Seiten, fuer die nichts vorgerechnet ist.
// `familyKey` ist der Schluessel des Detail-Vorrats (familyKeyForMerge).
export function listFamilyTargets(
  rows: CompApiRow[],
  assets: TftAssetsBundle | null,
): { slug: string; familyKey: string }[] {
  // Vorrat-Schluessel = Gruppen-Schluessel (Katalog-Comp oder klassische
  // Familie), nicht die Familie des verlinkten Slugs — bei Katalog-Comps kann
  // der Slug aus einem anderen Trait stammen.
  return standardListFamilies(rows, assets)
    .map(f => ({ slug: familyLinkSlug(f), familyKey: f.familyKey }))
    .filter(t => typeof t.slug === 'string' && t.slug.length > 0);
}

// Die Standardansicht der Liste: laufendes Set, 40 meistgespielte Familien,
// ohne Suche. EINE Stelle fuer Sitemap, Detail-Vorrat (listFamilyTargets) und
// die Startdaten der Liste (shownFamilyRows) — liefen sie auseinander,
// verlinkte die Sitemap andere Comps, als vorgerechnet sind.
export function standardListFamilies(rows: CompApiRow[], assets: TftAssetsBundle | null): CompFamily[] {
  const families = currentSetFamilies(buildCompFamilies(rows, 'avg', assets), assets);
  return visibleFamilies(families, topFamilyKeys(families), '', assets);
}

// Endtag einer /api/tft/comps-Antwort (volle Tage, filters.dataEnd).
// Folgeabfragen (Aufstellungsbrett) rechnen damit ueber dieselben Tage.
export function dataEndOf(filters: unknown): string | null {
  const v = (filters as { dataEnd?: unknown } | null | undefined)?.dataEnd;
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

// Unit-Detailseite (User 19.10.2026: „Comps with this unit genau so wie auf dem
// Comps-Reiter"): die Familien der Standardansicht der Liste, deren gezeigtes
// Brett die Unit traegt. Gezeigt wird in CompRow die Hauptvariante mit ihren
// 9 meistgespielten Units — dieselbe Regel hier, sonst stuende eine Comp in
// der Liste ohne die Unit auf dem Brett.
export const SHOWN_BOARD_UNITS = 9;
export function familyShowsUnit(f: CompFamily, unitId: string): boolean {
  return [...(f.mainComp.typicalUnits || [])]
    .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0))
    .slice(0, SHOWN_BOARD_UNITS)
    .some(u => u.characterId === unitId);
}
export function unitListFamilies(rows: CompApiRow[], assets: TftAssetsBundle | null, unitId: string): CompFamily[] {
  return standardListFamilies(rows, assets).filter(f => familyShowsUnit(f, unitId));
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

// Die API-Zeilen, aus denen die Standardansicht der Liste und der Uebersicht
// entsteht: alle Zeilen der gezeigten Familien (laufendes Set, 40
// meistgespielte, ohne Suche). Die Server-Seite schickt nur diese als
// Startdaten (app/lib/seo/initial-data.ts), in der Form von `transform`.
// Gemessen 2026-10-14: 111 von 293 Zeilen; buildCompFamilies darauf ergibt fuer
// avg/top4/win/pick dieselben 40 Familien mit denselben Zahlen wie auf allen
// Zeilen. Die Auswahl der 40 (nach Spielen) haengt nicht an der Sortierung.
// Das gilt nur, solange die Familienregeln familien-lokal rechnen. Deshalb
// prueft die Funktion es bei jedem Aufruf nach (Standard-Sortierung, auf den
// Zeilen, wie sie ausgeliefert werden) und gibt null zurueck, wenn die
// Teildaten etwas anderes zeigen wuerden — dann gibt es keine Startdaten und
// die Seite laedt wie frueher alles im Browser.
export function shownFamilyRows<T extends CompApiRow>(
  rows: T[],
  assets: TftAssetsBundle | null,
  transform: (row: T) => T = row => row,
): T[] | null {
  return familyRowsFor(rows, list => standardListFamilies(list, assets), transform);
}

// Wie shownFamilyRows, fuer eine beliebige Auswahl von Familien (view): die
// Zeilen genau dieser Familien, oder null, wenn die Teildaten etwas anderes
// zeigen wuerden.
export function familyRowsFor<T extends CompApiRow>(
  rows: T[],
  view: (list: T[]) => CompFamily[],
  transform: (row: T) => T = row => row,
): T[] | null {
  const shown = view(rows);
  // Alle Zeilen der gezeigten Gruppen (inkl. Zwei-Carry-Mitglieder) — gleich,
  // ob die Gruppe eine klassische Familie oder eine Katalog-Comp ist.
  const keys = new Set<string>(shown.flatMap(f => f.memberKeys ?? [f.familyKey]));
  const subset = rows.filter(r => keys.has(rowFamilyKey(r))).map(transform);
  return familiesSignature(view(subset)) === familiesSignature(shown) ? subset : null;
}

// Alles, was eine Zeile der Liste oder eine Kachel der Uebersicht zeigt
// (Hauptzeile, Varianten, Rollen, welche Familien die Uebersicht nach dem
// Entdoppeln behaelt). Der Vorpatch-Vergleich kommt aus einer eigenen Abfrage
// (attachPatchDeltas), nicht aus diesen Zeilen.
function familiesSignature(families: CompFamily[]): string {
  return JSON.stringify([
    families.map(f => [
      f.familyKey, f.carries, f.tanks, f.itemCarriers, f.totalGames, f.familyPickRate,
      f.weightedAvgPlacement, f.weightedTop4Rate, f.weightedTop1Rate, f.emblems,
      f.mainComp.slug, f.mainComp.games, f.mainComp.avgPlacement, f.mainComp.coreFlex,
      f.variants.map(v => [v.slug, v.games, v.avgPlacement, v.top4Rate, v.top1Rate, v.pickRate, (v as CompApiRow).coreFlex]),
      f.memberKeys,
    ]),
    dedupeByCarry(families).map(f => f.familyKey),
  ]);
}

// Startdaten-Zeile: ohne Mitspiel-Anteil je Unit (cooccurrence) — die Liste
// zeigt ihn in der Standardansicht nicht. Ein altes Trend-Feld (gespeicherte
// Staende von vor dem 18.10.2026) faellt weg: den Vergleich liefert seitdem
// /api/tft/patch-diff?full=1.
export function leanCompRow<Row extends CompApiRow>(row: Row): Row {
  const lean: CompApiRow = {
    ...row,
    typicalUnits: (row.typicalUnits || []).map(u => {
      const unit: typeof u & { cooccurrence?: unknown } = { ...u };
      delete unit.cooccurrence;
      return unit;
    }),
  };
  delete (lean as { velocity?: unknown }).velocity;
  return lean as Row;
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

// Vorpatch-Vergleich (User 18.10.2026) an Familien und Varianten haengen.
// Familie: alle Cluster ihrer Teil-Familien (memberKeys, inkl. Zwei-Carry-
// Merge) im ganzen Patch, jede Seite fuer sich summiert — so zaehlen Cluster mit,
// die im gewaehlten Tage-Fenster nicht vorkommen. Die Hauptzeile zeigt den Wert
// der Familie (wie ihre uebrigen Zahlen), Unterzeilen den ihrer Variante.
// sortByDelta (Trending): beste Verbesserung zuerst, ohne Wert ans Ende,
// Gleichstand nach Ø-Platz. Ohne Index unveraendert.
export function attachPatchDeltas(
  families: CompFamily[],
  index: PatchDeltaIndex | null,
  sortByDelta: boolean,
): CompFamily[] {
  if (!index) return families;
  const byFamily = new Map<string, string[]>();
  for (const k of new Set([...index.now.keys(), ...index.prev.keys()])) {
    const fk = compTraitFamilyKey(k);
    const list = byFamily.get(fk);
    if (list) list.push(k); else byFamily.set(fk, [k]);
  }
  // Beide Seiten je Katalog-Comp gezaehlt: ihre Zeilen tragen schon den
  // Comp-Schluessel, die klassischen Mitglieder wuerden fremde Comps mitzaehlen.
  const keysOf = (f: CompFamily) => (index.assign === 'catalog' ? [f.familyKey] : (f.memberKeys ?? [f.familyKey]));
  const out = families.map(f => {
    const delta = sumDeltaKeys(index, keysOf(f).flatMap(m => byFamily.get(m) ?? []));
    return {
      ...f,
      delta,
      mainComp: { ...f.mainComp, delta },
      variants: f.variants.map(v => ({
        ...v,
        delta: sumDeltaKeys(index, (v as CompApiRow)._clusterKeys ?? [v.slug || v.clusterKey]),
      })),
    };
  });
  if (sortByDelta) {
    const d = (f: CompFamily) => f.delta?.deltaAvgPlace ?? Number.POSITIVE_INFINITY;
    out.sort((a, b) => d(a) - d(b) || (a.weightedAvgPlacement ?? 9) - (b.weightedAvgPlacement ?? 9));
  }
  return out;
}
