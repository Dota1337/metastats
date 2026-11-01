// Vertrag comp-boards/liste-gegen-knoepfe: die Knoepfe der Detailseite muessen
// dieselben Spiele zaehlen wie die Unterzeilen der Liste (tft-comp-build-group.ts).
// Die Regel ist durch Tests gesichert, das hier faengt den Rest: einen alten Vorrat
// und Liste und Detailseite aus verschiedenen Staenden. Rein, IO in contracts.mjs.

const gamesOf = r => Number(r?.games) || 0;

/**
 * Welche Comps pruefen: die meistgespielten ohne Teil-Comps (dort sind die Knoepfe
 * bewusst Teil-Comps, die Zeilen Bretter), mit mehr als einer Zeile.
 * @returns {Array<{ key: string, slug: string, games: Map<string, number> }>}
 */
export function compsToCheck(listBody, limit = 8) {
  const byComp = new Map();
  for (const r of listBody?.comps ?? []) {
    if (!r?.compKey || r.compParts?.length || r.listFill) continue;
    if (!byComp.has(r.compKey)) byComp.set(r.compKey, []);
    byComp.get(r.compKey).push(r);
  }
  return [...byComp.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({
      key,
      rows,
      total: rows.reduce((s, r) => s + gamesOf(r), 0),
    }))
    .sort((a, b) => b.total - a.total || (a.key < b.key ? -1 : 1))
    .slice(0, limit)
    .map(c => ({
      key: c.key,
      slug: [...c.rows].sort((a, b) => gamesOf(b) - gamesOf(a))[0].slug,
      games: new Map(c.rows.map(r => [r.slug, gamesOf(r)])),
    }));
}

/**
 * @param {Array<{ key: string, games: Map<string, number> }>} comps aus compsToCheck
 * @param {Map<string, { variants?: Array<{ slug: string, games: number, members?: string[] }>, catalogId?: string } | null>} details Detail-Antwort (comp) je Comp
 * @returns {{ status: 'ok'|'warn'|'broken', detail: string }}
 */
export function evaluateCompBoardButtons(comps, details, { minChecked = 5 } = {}) {
  let checked = 0;
  let buttons = 0;
  let oldStock = 0;
  const wrong = [];
  for (const c of comps) {
    const comp = details.get(c.key);
    if (!comp?.variants) continue;
    checked++;
    for (const v of comp.variants) {
      buttons++;
      // Stand von vor dem 01.11.2026 oder noch nicht neu gerechnet.
      if (!Array.isArray(v.members)) { oldStock++; continue; }
      const sum = v.members.reduce((s, k) => s + (c.games.get(k) ?? 0), 0);
      if (sum !== Number(v.games)) wrong.push(`${c.key}: Knopf ${v.games}, Liste ${sum}`);
    }
  }
  if (checked < minChecked) return { status: 'warn', detail: `nur ${checked} von ${comps.length} Comps pruefbar (mind. ${minChecked})` };
  if (wrong.length > 0) return { status: 'broken', detail: `${wrong.length} von ${buttons} Knoepfen zaehlen anders als die Liste: ${wrong.slice(0, 3).join('; ')}` };
  if (oldStock > 0) return { status: 'warn', detail: `${oldStock} von ${buttons} Knoepfen aus altem Vorrat (ohne members)` };
  return { status: 'ok', detail: `${buttons} Knoepfe aus ${checked} Comps zaehlen wie die Liste` };
}
