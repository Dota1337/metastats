// Masken-Weg des Explorer-Dienstes (Paket 6, Plan .claude/plan-current.md
// Abschnitt C). Ansichten mit Board-Filter oder Rang rechnen je Partie mit den
// Platz-Masken (scripts/lib/explorer-mask.mjs) statt mit Joins ueber alle
// Units. Ergebnis bitgleich zum heutigen Weg (runQuery in explorer-query.mjs),
// Abgleich: scripts/oneoff/explorer-query-equality.mjs mit --way.
//
// Ablauf je Anfrage, auf der eigenen Verbindung:
//  1. Zwischentabelle g (TEMP — nur diese Verbindung sieht sie): je Partie der
//     Grundmenge (Region/Rang/Patch) die Bitmaske a ihrer Boards und f der
//     gefilterten. Unit- und Trait-Filter wie heute (filterWhere), Item-Filter
//     ueber mask_uk.
//  2. Kopf (Gesamt, Grundmenge, Abweichung) aus g.
//  3. Zeilen: Units (auch Sterne), Items ohne Fokus, Traits (auch Uebercap)
//     aus mask_um/mask_ui/mask_ut, je Partie mit f verundet. Die anderen
//     Reiter rechnet liveRows wie heute, nur mit g statt der Filter-WHERE —
//     ebenso Items, wenn die Komponenten-Liste nicht an allen Tagen passt.
//  4. g wird am Ende geloescht, auch bei Fehler.
//
// Bit p-1 = Board auf Platz p. Je Partie sind die Werte klein (hoechstens 8
// Boards, Platzsumme 36), bit_count liefert aber TINYINT: vor jedem Produkt
// ::INTEGER, sonst laeuft die Multiplikation ueber.

import {
  MASK_BIT_COLS, MASK_TOP1, MASK_TOP4, OVER_VALUES, STAR_VALUES, maskBindingReason, maskBitSql, maskPlaceSumSql,
} from './explorer-mask.mjs';
import { aggDaysFor } from './explorer-agg.mjs';
import {
  QUERY_TIMEOUT_MS, ROW_LIMIT, ROW_MIN_BOARDS, ROW_ORDER, filterWhere, finishRows, headOut, liveRows, runQuery, scopeWhere,
} from './explorer-query.mjs';

// ─── Laden ─────────────────────────────────────────────────────────────────

// Beim Oeffnen der Datei: Masken nur, wenn alle Tabellen da sind und
// Rechenweg (MASK_SIG) und Kennung (meta.mask_token) zur Datei passen. Tag →
// Patch aus den Boards selbst, unabhaengig von den Teilsummen. all(sql) →
// Zeilen als Objekte. null = kein Masken-Weg (Grund im Log).
export async function loadMask({ all, log }) {
  try {
    const db = (await all('SELECT current_database() AS v'))[0].v;
    const why = await maskBindingReason({ all, db });
    if (why) { log(`Masken unbenutzt (${why}), rechne wie bisher`); return null; }
    const md = await all('SELECT CAST(day AS VARCHAR) AS day, comp_hash FROM mask_days');
    const dayPatches = await all('SELECT DISTINCT CAST(day AS VARCHAR) AS day, patch FROM boards');
    const covered = new Set(md.map(r => r.day));
    const days = new Set(dayPatches.map(r => r.day));
    return {
      covered,
      compHashByDay: new Map(md.map(r => [r.day, r.comp_hash])),
      dayPatches,
      total: days.size,
      coveredDays: [...days].filter(d => covered.has(d)).length,
    };
  } catch (err) {
    log(`Masken nicht lesbar, rechne wie bisher: ${err.message}`);
    return null;
  }
}

// ─── Weg-Wahl ──────────────────────────────────────────────────────────────

// Masken-Weg nur fuer Anfragen mit Filter oder Rang (ohne beides nimmt der
// Dienst die Teilsummen oder rechnet wie heute) und nur, wenn alle Tage der
// Patch-Wahl gedeckt sind. Items-Zeilen ohne Fokus kommen aus mask_ui, die
// Komponenten ausschliesst — passt deren Liste an einem Tag nicht zur
// aktuellen, rechnet liveRows diese Zeilen (itemsLive). [] = Patch ohne Boards.
export function maskPlan(mask, q, compHash) {
  if (!mask) return null;
  if (q.units.length + q.items.length + q.traits.length === 0 && q.ranks.length === 0) return null;
  const days = aggDaysFor(q.patches, mask.dayPatches, mask.covered);
  if (!days) return null;
  const itemsLive = q.tab === 'items' && !q.focus && days.some(d => mask.compHashByDay.get(d) !== compHash);
  return { days, itemsLive };
}

// Tabelle oder Spalte fehlt (Datei anders als beim Laden): heutiger Weg in
// derselben Anfrage. Zeitgrenze und Speicherfehler sind keine Strukturfehler.
export const isStructuralError = (err) => /Catalog Error|Binder Error/.test(String(err?.message ?? err));

// Anfrage ohne Teilsummen: Masken-Weg, wenn maskPlan passt, sonst runQuery.
// Bei Strukturfehler Logzeile und heutiger Weg mit der Restfrist; bleiben
// weniger als minLeftMs, 504 ohne zweite Rechnung. Liefert { result, src }.
export async function runQueryWay(holder, q, { timeoutMs = QUERY_TIMEOUT_MS, warm = false, minLeftMs = 0, log = () => {} } = {}) {
  const t0 = Date.now();
  const plan = maskPlan(holder.mask, q, holder.compHash);
  let left = timeoutMs;
  if (plan) {
    try {
      return { result: await runMaskQuery(holder, q, plan, { timeoutMs, warm }), src: 'mask' };
    } catch (err) {
      if (!isStructuralError(err)) throw err;
      left = timeoutMs - (Date.now() - t0);
      log(`Masken-Weg gescheitert, rechne wie bisher (Rest ${left} ms): ${String(err.message).split('\n')[0]} bei ${JSON.stringify(q)}`);
      if (left < Math.max(minLeftMs, 1)) { const e = new Error('timeout'); e.status = 504; throw e; }
    }
  }
  return { result: await runQuery(holder, q, { timeoutMs: left, warm }), src: 'live' };
}

// ─── SQL ───────────────────────────────────────────────────────────────────

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ps = maskPlaceSumSql;

// Tage als Bereich fuer die Masken-Tabellen (nach Tag sortiert): beschneidet
// nur, die Partien selbst begrenzt der Join auf g. Ohne Tage nichts.
function dayRange(days, col) {
  if (!days.length) return 'FALSE';
  const a = days[0], b = days[days.length - 1];
  if (!DAY_RE.test(a) || !DAY_RE.test(b)) throw new Error(`Tag ungueltig: ${a} … ${b}`);
  return `${col} BETWEEN DATE '${a}' AND DATE '${b}'`;
}

// g: je Partie der Grundmenge a = alle Boards, f = gefilterte. Parameter in
// der Reihenfolge des SQL-Texts: Unit-/Trait-Filter, Grundmenge, Items.
async function makeG(conn, q, days) {
  const p = [];
  const fw = filterWhere({ ...q, items: [] }, p);
  const sw = scopeWhere(q, p);
  const joins = [];
  const and = [];
  q.items.forEach((it, i) => {
    joins.push(`LEFT JOIN (SELECT mid, m FROM mask_uk WHERE item = ? AND ${dayRange(days, 'day')}) k${i} ON k${i}.mid = g0.mid`);
    p.push(it.id);
    and.push(`${it.x ? '~' : ''}coalesce(k${i}.m, 0::UTINYINT)`);
  });
  await conn.run(`
    CREATE TEMP TABLE g AS
    WITH s AS (SELECT b.mid, ${maskBitSql('b.placement')} AS bit, ${fw.length ? fw.join(' AND ') : 'TRUE'} AS hit
               FROM boards b${sw.length ? ` WHERE ${sw.join(' AND ')}` : ''}),
    g0 AS (SELECT mid, bit_or(bit) AS a, bit_or(CASE WHEN hit THEN bit ELSE 0::UTINYINT END) AS f FROM s GROUP BY mid)
    SELECT g0.mid, g0.a::UTINYINT AS a, (g0.f${and.map(x => ` & ${x}`).join('')})::UTINYINT AS f
    FROM g0 ${joins.join(' ')}`, p);
}

// Kopfzahlen aus g, dieselben Summen wie setStats (gefiltert und Grundmenge)
// plus die Kreuzsummen der Abweichung.
async function headFromG(conn) {
  const hist = (x) => Array.from({ length: 8 }, (_, i) =>
    `coalesce(sum(((${x} >> ${i}) & 1)::INTEGER), 0)::DOUBLE AS ${x}h${i + 1}`).join(', ');
  const r = (await conn.runAndReadAll(`
    WITH x AS (SELECT f, a, bit_count(f)::INTEGER AS n1, ${ps('f')}::INTEGER AS s1,
                      bit_count(a)::INTEGER AS n0, ${ps('a')}::INTEGER AS s0 FROM g)
    SELECT (count(*) FILTER (WHERE n1 > 0))::DOUBLE AS fm, coalesce(sum(n1), 0)::DOUBLE AS fn, coalesce(sum(s1), 0)::DOUBLE AS fs,
           coalesce(sum(s1 * s1), 0)::DOUBLE AS fss, coalesce(sum(s1 * n1), 0)::DOUBLE AS fsn, coalesce(sum(n1 * n1), 0)::DOUBLE AS fnn,
           count(*)::DOUBLE AS bm, coalesce(sum(n0), 0)::DOUBLE AS bn, coalesce(sum(s0), 0)::DOUBLE AS bs,
           coalesce(sum(s0 * s0), 0)::DOUBLE AS bss, coalesce(sum(s0 * n0), 0)::DOUBLE AS bsn, coalesce(sum(n0 * n0), 0)::DOUBLE AS bnn,
           coalesce(sum(s1 * s0), 0)::DOUBLE AS c_ss, coalesce(sum(s1 * n0), 0)::DOUBLE AS c_sn,
           coalesce(sum(n1 * s0), 0)::DOUBLE AS c_ns, coalesce(sum(n1 * n0), 0)::DOUBLE AS c_nn,
           ${hist('f')}, ${hist('a')}
    FROM x`)).getRowObjectsJS()[0];
  const h = (x) => Array.from({ length: 8 }, (_, i) => r[`${x}h${i + 1}`]);
  return {
    filtered: { matches: r.fm, n: r.fn, s: r.fs, ss: r.fss, sn: r.fsn, nn: r.fnn, hist: h('f') },
    base: { matches: r.bm, n: r.bn, s: r.bs, ss: r.bss, sn: r.bsn, nn: r.bnn, hist: h('a') },
    cross: { s1S: r.c_ss, s1N: r.c_sn, n1S: r.c_ns, n1N: r.c_nn },
  };
}

// Schluessel je Partie aus einer Masken-Tabelle: key/sub/sub2 wie keySelect,
// mc = Boards mit dem Schluessel, mc3 = davon mit hoechstem Stern >= 3 (nur
// Units ohne Sterne-Split, fuer den 3★-Anteil). Sterne und Uebercap per
// zweier gleich langer unnest (DuckDB legt sie zeilenweise nebeneinander);
// der letzte Eintrag ist die Summenzeile (Sterne) bzw. Uebercap leer.
function maskKeys(q) {
  const col = (c) => `m.${c}`;
  const or = (cols) => `(${cols.map(col).join(' | ')})`;
  const um = MASK_BIT_COLS.mask_um;
  const ut = MASK_BIT_COLS.mask_ut;
  const none = '0::UTINYINT AS mc3';
  if (q.tab === 'units' && q.split === 'star') {
    return { from: 'mask_um', sel: `m.unit AS key, unnest([${STAR_VALUES.join(', ')}, NULL]::INTEGER[]) AS sub, NULL::INTEGER AS sub2,
      unnest([${um.map(col).join(', ')}, ${or(um)}]) AS mc, ${none}` };
  }
  if (q.tab === 'units') {
    const hi = STAR_VALUES.filter(s => s >= 3).map(s => `m${s}`);
    return { from: 'mask_um', sel: `m.unit AS key, NULL::INTEGER AS sub, NULL::INTEGER AS sub2, ${or(um)} AS mc, ${or(hi)} AS mc3` };
  }
  if (q.tab === 'items') {
    return { from: 'mask_ui', sel: `m.item AS key, NULL::INTEGER AS sub, NULL::INTEGER AS sub2, m.m AS mc, ${none}` };
  }
  if (q.tab === 'traits' && q.split === 'over') {
    return { from: 'mask_ut', sel: `m.trait AS key, m.lvl::INTEGER AS sub, unnest([${OVER_VALUES.join(', ')}, NULL]::INTEGER[]) AS sub2,
      unnest([${ut.map(col).join(', ')}]) AS mc, ${none}` };
  }
  if (q.tab === 'traits') {
    return { from: 'mask_ut', sel: `m.trait AS key, m.lvl::INTEGER AS sub, NULL::INTEGER AS sub2, ${or(ut)} AS mc, ${none}` };
  }
  return null;
}

// Zeilen aus den Masken; Summen und Reihenfolge wie liveRows, Referenzmenge =
// gefilterte Boards (cs/cn = Platzsumme/Anzahl der Partie darin).
async function maskRows(conn, q, days, out, filtered, keys) {
  if (filtered.n === 0) { out.rows = []; out.refGames = 0; return; }
  const rows = (await conn.runAndReadAll(`
    WITH gg AS (SELECT mid, f, bit_count(f)::INTEGER AS cn, ${ps('f')}::INTEGER AS cs FROM g WHERE f <> 0),
    k AS (SELECT ${keys.sel}, gg.f, gg.cn, gg.cs FROM ${keys.from} m JOIN gg USING (mid) WHERE ${dayRange(days, 'm.day')}),
    kh AS (SELECT key, sub, sub2, cn, cs, (mc & f) AS hit, (mc3 & f) AS hit3 FROM k),
    kg AS (SELECT key, sub, sub2, cn, cs, bit_count(hit)::INTEGER AS n1, ${ps('hit')}::INTEGER AS s1,
                  bit_count(hit & ${MASK_TOP4})::INTEGER AS t4, bit_count(hit & ${MASK_TOP1})::INTEGER AS t1,
                  bit_count(hit3)::INTEGER AS n3
           FROM kh WHERE hit <> 0)
    SELECT key, sub, sub2, count(*)::DOUBLE AS m1, sum(n1)::DOUBLE AS n1, sum(s1)::DOUBLE AS s1,
           sum(t4)::DOUBLE AS t4, sum(t1)::DOUBLE AS t1,
           sum(s1 * s1)::DOUBLE AS ss11, sum(s1 * n1)::DOUBLE AS sn11, sum(n1 * n1)::DOUBLE AS nn11,
           sum(s1 * cs)::DOUBLE AS "s1S", sum(s1 * cn)::DOUBLE AS "s1N",
           sum(n1 * cs)::DOUBLE AS "n1S", sum(n1 * cn)::DOUBLE AS "n1N", sum(n3)::DOUBLE AS n3
    FROM kg
    GROUP BY key, sub, sub2
    HAVING sum(n1) >= ?
    ${ROW_ORDER}
    LIMIT ?`, [ROW_MIN_BOARDS, ROW_LIMIT])).getRowObjectsJS();
  finishRows(out, rows, filtered);
  // 3★-Anteil: n3 = Boards mit der Unit auf 3★ (hoechste Kopie), n1 = alle.
  if (q.tab === 'units' && q.split !== 'star') rows.forEach((r, i) => { out.rows[i].star3 = r.n3 / r.n1; });
}

// fb-CTE fuer liveRows: gefilterte Boards = Bit ihres Platzes in g.f. Die
// Grundmenge steht nur zum Beschneiden dabei (Platz je Partie eindeutig,
// Pruefung g im Bau).
function gCte(q, p) {
  const w = ['((g.f >> (b.placement - 1)) & 1) = 1', ...scopeWhere(q, p)];
  return `fb AS (SELECT b.* FROM boards b JOIN g USING (mid) WHERE ${w.join(' AND ')})`;
}

// ─── Abfrage ───────────────────────────────────────────────────────────────

// Wie runQuery, nur ueber g. out.rowsVia (nicht im JSON): 'mask' = Zeilen aus
// den Masken, 'live' = liveRows (auch Uebersicht ohne Zeilen).
export async function runMaskQuery(holder, q, plan, { timeoutMs = QUERY_TIMEOUT_MS, warm = false } = {}) {
  const conn = await holder.instance.connect();
  if (warm) holder.warmConn = conn;
  const timer = setTimeout(() => { try { conn.interrupt(); } catch { /* bereits fertig */ } }, timeoutMs);
  try {
    if (warm && holder.retired) throw new Error('swapped');
    const hasFilters = q.units.length + q.items.length + q.traits.length > 0;
    await makeG(conn, q, plan.days);
    const { filtered, base, cross } = await headFromG(conn);
    const out = headOut(filtered, hasFilters ? base : filtered, hasFilters && filtered.n > 0 ? cross : null);
    const keys = q.tab === 'items' && (q.focus || plan.itemsLive) ? null : maskKeys(q);
    if (keys) await maskRows(conn, q, plan.days, out, filtered, keys);
    else await liveRows(conn, q, holder, out, filtered, p => gCte(q, p));
    Object.defineProperty(out, 'rowsVia', { value: keys ? 'mask' : 'live', enumerable: false });
    return out;
  } finally {
    clearTimeout(timer);
    try { await conn.run('DROP TABLE IF EXISTS g'); } catch { /* Verbindung wird ohnehin geschlossen */ }
    if (holder.warmConn === conn) holder.warmConn = null;
    conn.closeSync?.();
  }
}
