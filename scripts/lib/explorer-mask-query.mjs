// Masken-Weg des Explorer-Dienstes (Paket 6, Plan .claude/plan-current.md
// Abschnitt C). Ansichten mit Board-Filter oder Rang rechnen je Partie mit den
// Platz-Masken (scripts/lib/explorer-mask.mjs) statt mit Joins ueber alle
// Units. Ergebnis bitgleich zum heutigen Weg (runQuery in explorer-query.mjs),
// Abgleich: scripts/oneoff/explorer-query-equality.mjs mit --way.
//
// Ablauf je Anfrage, auf der eigenen Verbindung:
//  1. Zwischentabelle g (TEMP — nur diese Verbindung sieht sie): je Partie der
//     Grundmenge (Region/Rang/Patch) die Bitmaske a ihrer Boards und f der
//     gefilterten. Trait-Filter und Units mit Item-Zusatz oder exaktem Stern
//     wie heute (filterWhere), uebrige Units ueber mask_um, Item-Filter ueber
//     mask_uk.
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

// Frist der Live-Spur ab Eingang (Paket 6, Option 2). „Alle Patches + Filter"
// auf dem Masken-Weg braucht mit einer beliebten Unit auch nach dem Umbau um
// 15 s (Amumu, 10.10.: g 1,2 s + Zeilen 13,8 s, ohne CPU-Grenze) und bekommt
// deshalb LONG_QUERY_TIMEOUT_MS (Standard 30 s; EXPLORER_LONG_TIMEOUT_MS=0
// oder <= 15 s schaltet ab — im Dienst gemessen 10.10. mit 15 s: 5 von 7
// solcher Ansichten 504);
// alles andere QUERY_TIMEOUT_MS. minLeftMs: so viel Restzeit muss beim Platz
// noch uebrig sein, sonst 504 ohne Rechnung — eine lange Anfrage, die erst nach
// 15 s Warten drankaeme, haette kaum noch Zeit fuer ihre Rechnung.
// Die Kette dahinter muss laenger warten: refresh-api 35 s, Vercel-Route 40 s.
export const LONG_QUERY_TIMEOUT_MS = Number(process.env.EXPLORER_LONG_TIMEOUT_MS || 30_000);
export const LIVE_MIN_LEFT_MS = 2000;
export const LONG_MIN_LEFT_MS = 15_000;
export function liveBudget(holder, q, longMs = LONG_QUERY_TIMEOUT_MS) {
  const long = longMs > QUERY_TIMEOUT_MS && q.patches.length === 0 && !!maskPlan(holder.mask, q, holder.compHash);
  return long
    ? { timeoutMs: longMs, minLeftMs: LONG_MIN_LEFT_MS, long: true }
    : { timeoutMs: QUERY_TIMEOUT_MS, minLeftMs: LIVE_MIN_LEFT_MS, long: false };
}

// Tabelle oder Spalte fehlt (Datei anders als beim Laden): heutiger Weg in
// derselben Anfrage. Zeitgrenze und Speicherfehler sind keine Strukturfehler.
export const isStructuralError = (err) => /Catalog Error|Binder Error/.test(String(err?.message ?? err));

// Anfrage ohne Teilsummen: Masken-Weg, wenn maskPlan passt, sonst runQuery.
// Bei Strukturfehler Logzeile und heutiger Weg mit der Restfrist, hoechstens
// fallbackMaxMs (eine lange Frist gilt nur fuer den Masken-Weg; der heutige Weg
// braucht fuer „alle Patches + Filter" weit laenger und hielte nur die Spur
// fest); bleiben weniger als minLeftMs, 504 ohne zweite Rechnung. Liefert
// { result, src }.
export async function runQueryWay(holder, q, {
  timeoutMs = QUERY_TIMEOUT_MS, warm = false, minLeftMs = 0, fallbackMaxMs = Infinity, log = () => {},
} = {}) {
  const t0 = Date.now();
  const plan = maskPlan(holder.mask, q, holder.compHash);
  let left = timeoutMs;
  if (plan) {
    try {
      return { result: await runMaskQuery(holder, q, plan, { timeoutMs, warm }), src: 'mask' };
    } catch (err) {
      if (!isStructuralError(err)) throw err;
      left = Math.min(timeoutMs - (Date.now() - t0), fallbackMaxMs);
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

// Unit-Filter ohne Item-Zusatz und ohne exakten Stern liest makeG aus mask_um
// statt ueber die units-Tabelle (Amumu, alle Patches: 7,3 → 1,2 s, 0
// Abweichungen bei 4.163.307 Partien). Maske = Boards mit hoechster Kopie auf
// Stern s..4: „Stern >= s" trifft irgendeine Kopie genau dann, wenn die
// hoechste ihn erreicht. Exakter Stern bleibt auf units — `star = ?` trifft
// JEDE Kopie (Board mit 2★- und 3★-Kopie), m_s nur die hoechste.
// EXPLORER_MASK_G=units schaltet zurueck auf die units-Tabelle.
const MASK_G_ON = process.env.EXPLORER_MASK_G !== 'units';
export const unitViaMask = (u, on = MASK_G_ON) =>
  on && u.n == null && !u.se && u.it.length === 0 && u.nit.length === 0;
export const unitMaskSql = (u) => `(${STAR_VALUES.filter(s => s >= (u.s ?? 1)).map(s => `m${s}`).join(' | ')})`;

// g: je Partie der Grundmenge a = alle Boards, f = gefilterte. Parameter in
// der Reihenfolge des SQL-Texts: Unit-/Trait-Filter, Grundmenge, Items,
// Units aus mask_um.
async function makeG(conn, q, days) {
  const p = [];
  const fw = filterWhere({ ...q, items: [], units: q.units.filter(u => !unitViaMask(u)) }, p);
  const sw = scopeWhere(q, p);
  const joins = [];
  const and = [];
  q.items.forEach((it, i) => {
    joins.push(`LEFT JOIN (SELECT mid, m FROM mask_uk WHERE item = ? AND ${dayRange(days, 'day')}) k${i} ON k${i}.mid = g0.mid`);
    p.push(it.id);
    and.push(`${it.x ? '~' : ''}coalesce(k${i}.m, 0::UTINYINT)`);
  });
  q.units.filter(u => unitViaMask(u)).forEach((u, i) => {
    joins.push(`LEFT JOIN (SELECT mid, ${unitMaskSql(u)} AS m FROM mask_um WHERE unit = ? AND ${dayRange(days, 'day')}) u${i} ON u${i}.mid = g0.mid`);
    p.push(u.id);
    and.push(`${u.x ? '~' : ''}coalesce(u${i}.m, 0::UTINYINT)`);
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

// Schluessel je Partie aus einer Masken-Tabelle, schon mit der Partie-Maske f
// verundet. sel = Spalten von k (cols = ihre Namen), any = Zeile traegt etwas
// bei, expand = aus den gezaehlten Zeilen key/sub/sub2 wie keySelect,
// hit = Boards mit dem Schluessel, hit3 = davon mit hoechstem Stern >= 3 (nur
// Units ohne Sterne-Split, fuer den 3★-Anteil). Sterne und Uebercap werden
// erst NACH dem Zaehlen per zweier gleich langer unnest entfaltet (DuckDB legt
// sie zeilenweise nebeneinander) — vorher verfuenffachten sie die Zeilen, die
// gezaehlt werden (Amumu, alle Patches, Sterne: > 30 s im Dienst). Der letzte
// Eintrag ist die Summenzeile (Sterne) bzw. Uebercap leer.
function maskKeys(q) {
  const or = (xs) => `(${xs.join(' | ')})`;
  const masked = (cols) => cols.map((c, i) => `(m.${c} & gg.f) AS x${i}`);
  const xs = (cols) => cols.map((_, i) => `x${i}`);
  const plain = (key, sub, hit, hit3 = '0::UTINYINT') => ({
    sel: [`${key} AS key`, `${sub} AS sub`, `(${hit} & gg.f) AS hit`, `(${hit3} & gg.f) AS hit3`],
    cols: ['key', 'sub', 'hit', 'hit3'],
    any: 'hit',
    expand: 'key, sub, NULL::INTEGER AS sub2, hit, hit3',
  });
  const um = MASK_BIT_COLS.mask_um;
  const ut = MASK_BIT_COLS.mask_ut;
  const m = (cols) => or(cols.map(c => `m.${c}`));
  if (q.tab === 'units' && q.split === 'star') {
    return {
      from: 'mask_um', sel: ['m.unit AS key', ...masked(um)], cols: ['key', ...xs(um)], any: or(xs(um)),
      expand: `key, unnest([${STAR_VALUES.join(', ')}, NULL]::INTEGER[]) AS sub, NULL::INTEGER AS sub2,
        unnest([${xs(um).join(', ')}, ${or(xs(um))}]) AS hit, 0::UTINYINT AS hit3`,
    };
  }
  if (q.tab === 'units') {
    return { from: 'mask_um', ...plain('m.unit', 'NULL::INTEGER', m(um), m(STAR_VALUES.filter(s => s >= 3).map(s => `m${s}`))) };
  }
  if (q.tab === 'items') return { from: 'mask_ui', ...plain('m.item', 'NULL::INTEGER', 'm.m') };
  if (q.tab === 'traits' && q.split === 'over') {
    return {
      from: 'mask_ut', sel: ['m.trait AS key', 'm.lvl::INTEGER AS sub', ...masked(ut)], cols: ['key', 'sub', ...xs(ut)], any: or(xs(ut)),
      expand: `key, sub, unnest([${OVER_VALUES.join(', ')}, NULL]::INTEGER[]) AS sub2,
        unnest([${xs(ut).join(', ')}]) AS hit, 0::UTINYINT AS hit3`,
    };
  }
  if (q.tab === 'traits') return { from: 'mask_ut', ...plain('m.trait', 'm.lvl::INTEGER', m(ut)) };
  return null;
}

// Zeilen aus den Masken; Summen und Reihenfolge wie liveRows, Referenzmenge =
// gefilterte Boards (cs/cn = Platzsumme/Anzahl der Partie darin).
// Erst je (Schluessel, hit, hit3, f) zaehlen, dann mit der Anzahl c gewichtet
// summieren: alle Werte einer Partie haengen nur an diesen Masken, die Summen
// bleiben also exakt; es gibt aber weit weniger Kombinationen als Partien
// (Rang Diamond, alle Patches: 19,2 → 10,8 s, Amumu: 23,1 → 13,8 s, Zeilen
// identisch). Sterne/Uebercap entfaltet kx erst nach dem Zaehlen; gleiche
// (key, sub, sub2, hit, f) aus verschiedenen kc-Zeilen stoeren nicht, die
// Summen sind linear in c.
async function maskRows(conn, q, days, out, filtered, keys) {
  if (filtered.n === 0) { out.rows = []; out.refGames = 0; return; }
  const cols = keys.cols.join(', ');
  const rows = (await conn.runAndReadAll(`
    WITH gg AS (SELECT mid, f FROM g WHERE f <> 0),
    k AS (SELECT ${keys.sel.join(', ')}, gg.f FROM ${keys.from} m JOIN gg USING (mid) WHERE ${dayRange(days, 'm.day')}),
    kc AS (SELECT ${cols}, f, count(*) AS c FROM k WHERE ${keys.any} <> 0 GROUP BY ${cols}, f),
    kx AS (SELECT ${keys.expand}, f, c FROM kc),
    kg AS (SELECT key, sub, sub2, c, bit_count(f)::INTEGER AS cn, ${ps('f')}::INTEGER AS cs,
                  bit_count(hit)::INTEGER AS n1, ${ps('hit')}::INTEGER AS s1,
                  bit_count(hit & ${MASK_TOP4})::INTEGER AS t4, bit_count(hit & ${MASK_TOP1})::INTEGER AS t1,
                  bit_count(hit3)::INTEGER AS n3
           FROM kx WHERE hit <> 0)
    SELECT key, sub, sub2, sum(c)::DOUBLE AS m1, sum(c * n1)::DOUBLE AS n1, sum(c * s1)::DOUBLE AS s1,
           sum(c * t4)::DOUBLE AS t4, sum(c * t1)::DOUBLE AS t1,
           sum(c * s1 * s1)::DOUBLE AS ss11, sum(c * s1 * n1)::DOUBLE AS sn11, sum(c * n1 * n1)::DOUBLE AS nn11,
           sum(c * s1 * cs)::DOUBLE AS "s1S", sum(c * s1 * cn)::DOUBLE AS "s1N",
           sum(c * n1 * cs)::DOUBLE AS "n1S", sum(c * n1 * cn)::DOUBLE AS "n1N", sum(c * n3)::DOUBLE AS n3
    FROM kg
    GROUP BY key, sub, sub2
    HAVING sum(c * n1) >= ?
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
