// Hinweis je Karte einer Item-Auswahl (match_info.item_select). Reine Rechnung
// (item-advice.test.ts).
//
// Angebote sind gemischt (Logs 04.-09.10.: Komponenten neben fertigen Items,
// nur Artefakte, nur Strahlende). Regeln:
// - Verbrauchsgegenstaende und unbekannte Items: nichts.
// - Komponente: nur, wenn ein Item der Traeger der angehefteten Comp daraus
//   gebaut wird („fuer <Item> auf <Unit>“). Nie nach Ø-Platz ordnen — MetaTFT
//   zeigt dort auch nichts.
// - fertiges Item: Treffer bei den Traegern der Comp. Emblem: Trait der Comp
//   oder Traeger-Item.
// - Strahlendes Item: ueber den Namen auf das Grund-Item, dann wie fertig.
// - Artefakt/Strahlendes ohne Comp-Treffer: Rang nach Ø-Platz innerhalb der
//   Kategorie im Angebot, nur Items ab 1000 Spielen, „beste“ nur bei mehr als
//   0,2 Plaetzen Abstand zum zweiten.
import type { CompanionComp, CompanionLookups } from '../../../../app/lib/companion-types.ts';

export type ItemCategory = 'component' | 'finished' | 'emblem' | 'radiant' | 'artifact' | 'consumable' | 'other';

export type ItemHint =
  | { kind: 'comp'; via: 'direct' | 'recipe' | 'radiant' | 'emblem'; item: string; unit: string | null }
  | { kind: 'rank'; rank: number; of: number; best: boolean; avg: number };

export const RANK_MIN_GAMES = 1000;
export const BEST_GAP = 0.2;

export function itemCategory(id: string, lk: CompanionLookups | null): ItemCategory | null {
  const it = lk?.items[id];
  if (!it) return null;
  if (/Consumable/i.test(id)) return 'consumable';
  if (it.component) return 'component';
  if (/Radiant/i.test(id) || /^Radiant /.test(it.name)) return 'radiant';
  if (/Artifact/i.test(id)) return 'artifact';
  if (/Emblem/i.test(id)) return 'emblem';
  return it.recipe ? 'finished' : 'other';
}

// Strahlendes Item → Grund-Item mit Rezept, gleicher Name ohne „Radiant “.
export function radiantBase(id: string, lk: CompanionLookups | null): string | null {
  const name = lk?.items[id]?.name;
  if (!name || !/^Radiant /.test(name)) return null;
  const base = name.slice('Radiant '.length);
  const hits = Object.entries(lk!.items).filter(([, v]) => v.name === base && v.recipe);
  return hits.find(([k]) => k.startsWith('DA_'))?.[0] ?? hits[0]?.[0] ?? null;
}

// Emblem-Kennung → Trait-Kennung (DA_18_EmblemExecutioner → DA_18_Executioner).
export const emblemTrait = (id: string) => id.replace('Emblem', '');

// Items der Traeger in Bau-Reihenfolge der Comp.
function carrierItems(comp: CompanionComp): Array<{ item: string; unit: string }> {
  return comp.units.flatMap(u => (u.items ?? []).map(item => ({ item, unit: u.id })));
}

function compHint(id: string, cat: ItemCategory, comp: CompanionComp | null, lk: CompanionLookups | null): ItemHint | null {
  if (!comp) return null;
  const carried = carrierItems(comp);
  if (cat === 'component') {
    const hit = carried.find(c => lk?.items[c.item]?.recipe?.includes(id));
    return hit ? { kind: 'comp', via: 'recipe', item: hit.item, unit: hit.unit } : null;
  }
  if (cat === 'radiant') {
    const base = radiantBase(id, lk);
    const hit = base ? carried.find(c => c.item === base) : undefined;
    return hit ? { kind: 'comp', via: 'radiant', item: hit.item, unit: hit.unit } : null;
  }
  const hit = carried.find(c => c.item === id);
  if (hit) return { kind: 'comp', via: 'direct', item: id, unit: hit.unit };
  if (cat === 'emblem' && emblemTrait(id) === comp.trait) return { kind: 'comp', via: 'emblem', item: id, unit: null };
  return null;
}

export function adviseOffer(
  offer: string[],
  lk: CompanionLookups | null,
  comp: CompanionComp | null,
  stats: Map<string, { games: number; avg: number | null }>,
): Array<ItemHint | null> {
  const cats = offer.map(id => itemCategory(id, lk));
  const hints = offer.map((id, i) => {
    const c = cats[i];
    if (!c || c === 'consumable' || c === 'other') return null;
    return compHint(id, c, comp, lk);
  });
  for (const cat of ['artifact', 'radiant'] as const) {
    const ranked = offer
      .map((id, i) => ({ i, s: stats.get(id) }))
      .filter(x => cats[x.i] === cat && !hints[x.i] && x.s && x.s.games >= RANK_MIN_GAMES && x.s.avg != null)
      .sort((a, b) => a.s!.avg! - b.s!.avg!);
    if (ranked.length < 2) continue;
    const gap = ranked[1].s!.avg! - ranked[0].s!.avg!;
    ranked.forEach((x, r) => {
      hints[x.i] = { kind: 'rank', rank: r + 1, of: ranked.length, best: r === 0 && gap > BEST_GAP, avg: x.s!.avg! };
    });
  }
  return hints;
}
