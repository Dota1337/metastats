// Tages-Teilsummen des Explorers (Paket 5b). EINE Quelle fuer die
// Schluessel-SQL der filterlosen Ansichten: der Abfragedienst (keySql ohne
// Fokus) und der Bau (Teilsummen je Tag, Patch, Region) setzen sich beide
// hieraus zusammen. AGG_SIG haengt am erzeugten SQL-Text — aendert sich eine
// Definition, passen die gespeicherten Summen nicht mehr und werden neu
// gerechnet (Plan .claude/plan-current.md, Punkte 1, 2, 8).

import crypto from 'node:crypto';

const ID_RE = /^[A-Za-z0-9_]{1,64}$/;
const NN = 'NULL::INTEGER';

// Komponenten-Literal wie im Dienst: Bundle-IDs, per ID_RE geprueft.
export function compListSql(components) {
  return `[${components.filter(c => ID_RE.test(c)).map(c => `'${c}'`).join(', ')}]::VARCHAR[]`;
}

export const VARIANTS = ['units', 'units_star', 'items', 'traits', 'traits_over', 'comps', 'level', 'round', 'gold', 'region', 'rank'];

// Zeilen (bid, mid, placement, key, sub, sub2[, st]) einer Variante.
// b/u/t = Namen der Board-, Unit- und Trait-Relation. withStar haengt bei
// units die hoechste Sternstufe je Board als st an (nur der Bau braucht sie
// fuer n3; der Dienst rechnet star3 getrennt).
export function keySelect(variant, { b = 'ref', u = 'units', t = 'traits', compList, withStar = false } = {}) {
  const cols = `${b}.bid, ${b}.mid, ${b}.placement`;
  switch (variant) {
    case 'units':
      return withStar
        ? `SELECT ${cols}, x.unit AS key, ${NN} AS sub, ${NN} AS sub2, max(x.star)::INTEGER AS st FROM ${b} JOIN ${u} x USING (bid) GROUP BY ${cols}, x.unit`
        : `SELECT DISTINCT ${cols}, x.unit AS key, ${NN} AS sub, ${NN} AS sub2 FROM ${b} JOIN ${u} x USING (bid)`;
    case 'units_star':
      return `SELECT ${cols}, x.unit AS key, max(x.star)::INTEGER AS sub, ${NN} AS sub2 FROM ${b} JOIN ${u} x USING (bid) GROUP BY ${cols}, x.unit`;
    case 'items':
      if (!compList) throw new Error('items braucht compList');
      return `SELECT ${cols}, d.item AS key, ${NN} AS sub, ${NN} AS sub2
              FROM (SELECT DISTINCT bid, item FROM (
                      SELECT x.bid, unnest([x.i1, x.i2, x.i3]) AS item FROM ${u} x WHERE x.bid IN (SELECT bid FROM ${b}))
                    WHERE item IS NOT NULL AND NOT list_contains(${compList}, item)) d
              JOIN ${b} USING (bid)`;
    case 'traits':
      return `SELECT DISTINCT ${cols}, x.trait AS key, x.lvl::INTEGER AS sub, ${NN} AS sub2 FROM ${b} JOIN ${t} x USING (bid)`;
    case 'traits_over':
      return `SELECT DISTINCT ${cols}, x.trait AS key, x.lvl::INTEGER AS sub, x.overcap::INTEGER AS sub2 FROM ${b} JOIN ${t} x USING (bid)`;
    case 'comps':
      return `SELECT ${cols}, ${b}.family AS key, ${NN} AS sub, ${NN} AS sub2 FROM ${b} WHERE ${b}.family IS NOT NULL`;
    case 'level':
      return `SELECT ${cols}, CAST(${b}.level AS VARCHAR) AS key, ${NN} AS sub, ${NN} AS sub2 FROM ${b}`;
    case 'round':
      return `SELECT ${cols}, CAST(${b}.last_round AS VARCHAR) AS key, ${NN} AS sub, ${NN} AS sub2 FROM ${b}`;
    case 'gold':
      return `SELECT ${cols}, CASE
                WHEN ${b}.gold_left <= 0 THEN '0' WHEN ${b}.gold_left < 10 THEN '1-9' WHEN ${b}.gold_left < 20 THEN '10-19'
                WHEN ${b}.gold_left < 30 THEN '20-29' WHEN ${b}.gold_left < 50 THEN '30-49' ELSE '50+' END AS key,
              ${NN} AS sub, ${NN} AS sub2 FROM ${b}`;
    case 'region':
      return `SELECT ${cols}, ${b}.region AS key, ${NN} AS sub, ${NN} AS sub2 FROM ${b}`;
    case 'rank':
      return `SELECT ${cols}, ${b}.rank AS key, ${NN} AS sub, ${NN} AS sub2 FROM ${b} WHERE ${b}.rank IS NOT NULL`;
    default:
      throw new Error(`unbekannte Variante ${variant}`);
  }
}

// Summen je (Tag, Patch, Region, Schluessel) aus den Zeilen k und den
// Partie-Summen cl (mid, day, patch, region, n, s). Alles ganzzahlig unter
// 2^53, als DOUBLE exakt addierbar.
export function rowSumsSql(kSql, clSql) {
  return `WITH k AS (${kSql}),
    kg AS (SELECT key, sub, sub2, mid, count(*) AS n1, sum(placement) AS s1, count(*) FILTER (WHERE placement <= 4) AS t4,
             count(*) FILTER (WHERE placement = 1) AS t1, count(*) FILTER (WHERE st >= 3) AS n3 FROM k GROUP BY key, sub, sub2, mid)
    SELECT cl.day, cl.patch, cl.region, key, sub, sub2, count(*)::DOUBLE AS m1, sum(n1)::DOUBLE AS n1, sum(s1)::DOUBLE AS s1,
      sum(t4)::DOUBLE AS t4, sum(t1)::DOUBLE AS t1, sum(s1 * s1)::DOUBLE AS ss11, sum(s1 * n1)::DOUBLE AS sn11, sum(n1 * n1)::DOUBLE AS nn11,
      sum(s1 * cl.s)::DOUBLE AS "s1S", sum(s1 * cl.n)::DOUBLE AS "s1N", sum(n1 * cl.s)::DOUBLE AS "n1S", sum(n1 * cl.n)::DOUBLE AS "n1N",
      sum(n3)::DOUBLE AS n3
    FROM kg JOIN (${clSql}) cl USING (mid) GROUP BY ALL`;
}

// Nur units mit withStar liefert st; alle anderen bekommen st = NULL dazu,
// damit rowSumsSql einheitlich bleibt (n3 dann 0).
export function variantRowsSql(variant, names, clSql) {
  const k = variant === 'units'
    ? keySelect('units', { ...names, withStar: true })
    : `SELECT *, ${NN} AS st FROM (${keySelect(variant, names)})`;
  return rowSumsSql(k, clSql);
}

// Welche gespeicherten Varianten eine filterlose Anfrage braucht. Split wie
// im Dienst: Sterne nur bei units, Uebercap nur bei traits, sonst egal.
export function variantsForQuery(q) {
  if (q.tab === 'units') return q.split === 'star' ? ['units_star', 'units'] : ['units'];
  if (q.tab === 'traits') return [q.split === 'over' ? 'traits_over' : 'traits'];
  if (VARIANTS.includes(q.tab)) return [q.tab];
  return null;
}

// Summen-Weg nur ohne Board-Filter und ohne Fokus.
export function aggEligible(q) {
  return q.ranks.length === 0 && q.units.length === 0 && q.items.length === 0
    && q.traits.length === 0 && !q.focus && q.tab !== 'summary' ? variantsForQuery(q) : null;
}

// Stand der Summen-SQL ausserhalb von variantRowsSql (aggClSql, aggHeadSql,
// rowsSelect, Fingerabdruck in explorer-agg-build.mjs). Erhoehen, wenn sich
// dort etwas aendert: dann verwirft der naechste Lauf alle Summen, auch die
// sonst im Vollaufbau uebernommenen. Bei 0 bleibt AGG_SIG wie vor Paket 5c.
// Der Stolperdraht in explorer-agg-build.test.mjs erinnert daran.
export const AGG_REV = 0;

export const AGG_SIG = crypto.createHash('sha1')
  .update(VARIANTS.map(v => variantRowsSql(v, { b: 'B', u: 'U', t: 'T', compList: 'C' }, 'CL')).join('\n')
    + (AGG_REV ? `\nrev ${AGG_REV}` : ''))
  .digest('hex').slice(0, 16);

// ─── Planung im Bau (reine Funktionen) ─────────────────────────────────────

const DAY_MS = 86_400_000;
const addDay = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export const AGG_BUDGET_DEFAULT_S = 1200;
export const AGG_HARD_S = 8400;              // Unit-Zeitlimit 9000 s minus 600 s fuer Tausch + Pruefungen
export const AGG_SWAP_UTC = [2, 55];         // Tausch + Vorwaermen vor Ende des Edge-Caches 03:30 UTC

// AGG_BUDGET_S: leer/ungueltig → Vorgabe, 0 → Summen aus.
export function aggBudgetS(raw) {
  if (raw == null || String(raw).trim() === '') return AGG_BUDGET_DEFAULT_S;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : AGG_BUDGET_DEFAULT_S;
}

// Naechster Zeitpunkt hh:mm UTC nach ms.
export function nextUtc(ms, [h, m]) {
  const d = new Date(ms);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m);
  return t > ms ? t : t + DAY_MS;
}

// Welche gedeckten Tage bleiben. Raus: Tage vor dem Fenster (Boards
// geloescht) und Tage mit geaendertem Patch — der Patch haengt am Sammeltag
// (Spielzeit − 5 h), ein Sammeltag P landet also auf den Kalendertagen P und
// P+1. rankDays: gedeckte Tage ab der Frost-Grenze, dort aendern sich Raenge
// alter Boards.
export function aggCoveredDays({ covered, w, f, patchChanged = [] }) {
  const touched = new Set();
  for (const d of patchChanged) { touched.add(d); touched.add(addDay(d, 1)); }
  const keep = [];
  const drop = [];
  for (const d of [...new Set(covered)].sort()) (d < w || touched.has(d) ? drop : keep).push(d);
  return { keep, drop, touched: [...touched].sort(), rankDays: keep.filter(d => d >= f) };
}

// Frist und Reihenfolge. Frist = min(jetzt + Budget, naechstes 02:55 UTC nach
// Laufbeginn, Laufbeginn + 8400 s). Tage des neuesten Patches sind Pflicht und
// laufen bis zur harten Grenze; sie kommen zuerst, sonst neueste zuerst.
export function planAgg({ nowMs, t0Ms, budgetS, days, covered, newestDays = [] }) {
  const hardMs = t0Ms + AGG_HARD_S * 1000;
  const deadlineMs = Math.min(nowMs + budgetS * 1000, nextUtc(t0Ms, AGG_SWAP_UTC), hardMs);
  const cov = new Set(covered);
  const must = new Set(newestDays);
  const todo = [...new Set(days)].filter(d => !cov.has(d))
    .map(day => ({ day, must: must.has(day) }))
    .sort((a, b) => (Number(b.must) - Number(a.must)) || (a.day < b.day ? 1 : -1));
  return { deadlineMs, hardMs, todo };
}

export const aggDue = (plan, entry, nowMs) => nowMs < (entry.must ? plan.hardMs : plan.deadlineMs);

// Block-Kopie vorab einpreisen: ein Tag kommt nur in den Block, wenn er nach
// der Kopie noch faellig ist. Schaetzung = max(180 s, laengste Kopie dieses
// Laufs) × 1,1 (gemessen 115–170 s je 7-Tage-Block).
export const AGG_COPY_MIN_S = 180;
export const aggCopyEstS = (maxCopyS = 0) => Math.max(AGG_COPY_MIN_S, maxCopyS) * 1.1;
export const aggDueForCopy = (plan, entry, nowMs, estS) => aggDue(plan, entry, nowMs + estS * 1000);

// ─── Vollaufbau mit Uebernahme (Paket 5c, reine Funktionen) ────────────────

// Gruende gegen eine Uebernahme; null = versuchen.
export function aggCarryBlocked({ prevKind, prevTestRun, testRun, carryEnv, budgetS, aggtryExists }) {
  if (prevKind !== 'ok') return `vorige Datei: ${prevKind}`;
  if (testRun) return 'Testlauf';
  if (prevTestRun) return 'vorige Datei aus einem Testlauf';
  if (String(carryEnv ?? '').trim() === '0') return 'AGG_CARRY=0';
  if (budgetS === 0) return 'AGG_BUDGET_S=0';
  if (aggtryExists) return 'Versuchs-Stempel vom letzten Lauf';
  return null;
}

// Zeitgrenze der Uebernahme ist die harte Grenze, nicht die Tauschfrist.
// Rest-Schaetzung: neuer Fingerabdruck wie der alte, dazu Partie-Delta und
// Rang-Schritt (600 s).
export const aggCarryLate = ({ nowMs, t0Ms, fpOldS }) => nowMs + (2 * fpOldS + 600) * 1000 > t0Ms + AGG_HARD_S * 1000;

// Uebernommen wird ein Tag, der gedeckt war und dessen alte Boards in beiden
// Dateien denselben Fingerabdruck haben.
export function aggCarryDays({ oldFp, newFp, covered }) {
  const cov = new Set(covered);
  const days = [];
  const differ = [];
  const uncovered = [];
  const noOld = [];
  for (const d of [...newFp.keys()].sort()) {
    if (!oldFp.has(d)) noOld.push(d);
    else if (oldFp.get(d) !== newFp.get(d)) differ.push(d);
    else if (!cov.has(d)) uncovered.push(d);
    else days.push(d);
  }
  return { days, differ, uncovered, noOld };
}

// ─── Dienst (reine Funktion) ───────────────────────────────────────────────

// Tage, die eine filterlose Anfrage braucht: alle Tage mit Boards der
// gewuenschten Patches, ohne Patch-Wahl alle Tage (auch Boards ohne Patch).
// null, wenn einer davon nicht gedeckt ist. [] = Patch ohne Boards.
export function aggDaysFor(patches, dayPatches, covered) {
  const want = patches.length ? new Set(patches) : null;
  const days = [...new Set(dayPatches.filter(r => !want || want.has(r.patch)).map(r => r.day))].sort();
  return days.every(d => covered.has(d)) ? days : null;
}
