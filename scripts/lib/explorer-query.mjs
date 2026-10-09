// Abfrage-Logik des Explorer-Dienstes (scripts/explorer-duckdb-server.mjs),
// aus dem Dienst hierher verschoben (Paket 6), damit ein Test den heutigen
// Weg und den Masken-Weg lokal gegeneinander rechnen kann.

import { compListSql, keySelect, variantsForQuery } from './explorer-agg.mjs';

export const QUERY_TIMEOUT_MS = Number(process.env.EXPLORER_QUERY_TIMEOUT_MS || 15_000);
export const ROW_LIMIT = 500;
export const ROW_MIN_BOARDS = 5;
// Feste Reihenfolge in beiden Wegen: bei gleicher Board-Zahl entschied sonst
// der Zufall, welche Zeilen an der 500er-Grenze landen.
export const ROW_ORDER = 'ORDER BY n1 DESC, key NULLS FIRST, sub NULLS FIRST, sub2 NULLS FIRST';

export function bad(msg) { const e = new Error(msg); e.status = 400; return e; }

// ─── SQL bauen ─────────────────────────────────────────────────────────────

// Grundmenge: nur Region / Rang / Patch.
export function scopeWhere(q, params) {
  const w = [];
  if (q.region !== 'all') { w.push('b.region = ?'); params.push(q.region); }
  if (q.ranks.length) {
    const named = q.ranks.filter(r => r !== 'unknown');
    const parts = [];
    if (named.length) { parts.push(`b.rank IN (${named.map(() => '?').join(',')})`); params.push(...named); }
    if (q.ranks.includes('unknown')) parts.push('b.rank IS NULL');
    w.push(`(${parts.join(' OR ')})`);
  }
  if (q.patches.length) { w.push(`b.patch IN (${q.patches.map(() => '?').join(',')})`); params.push(...q.patches); }
  return w;
}

export function unitCond(u, params) {
  const c = ['unit = ?']; params.push(u.id);
  if (u.s != null) { c.push(u.se ? 'star = ?' : 'star >= ?'); params.push(u.s); }
  if (u.n != null) { c.push('n_items >= ?'); params.push(u.n); }
  for (const it of u.it) { c.push('list_contains([i1, i2, i3], ?)'); params.push(it); }
  for (const it of u.nit) { c.push('NOT list_contains([i1, i2, i3], ?)'); params.push(it); }
  return `SELECT bid FROM units WHERE ${c.join(' AND ')}`;
}

export function filterWhere(q, params) {
  const w = [];
  for (const u of q.units) w.push(`b.bid ${u.x ? 'NOT IN' : 'IN'} (${unitCond(u, params)})`);
  for (const i of q.items) {
    w.push(`b.bid ${i.x ? 'NOT IN' : 'IN'} (SELECT bid FROM units WHERE list_contains([i1, i2, i3], ?))`);
    params.push(i.id);
  }
  for (const t of q.traits) {
    const c = ['trait = ?']; params.push(t.id);
    if (!t.x && t.l != null) { c.push(t.le ? 'lvl = ?' : 'lvl >= ?'); params.push(t.l); }
    w.push(`b.bid ${t.x ? 'NOT IN' : 'IN'} (SELECT bid FROM traits WHERE ${c.join(' AND ')})`);
  }
  return w;
}

export function fbCte(q, params, { withFilters = true } = {}) {
  const w = scopeWhere(q, params);
  if (withFilters) w.push(...filterWhere(q, params));
  return `fb AS (SELECT b.* FROM boards b${w.length ? ` WHERE ${w.join(' AND ')}` : ''})`;
}

// Kopfzahlen einer Menge: Summen je Partie fuer die Fehlerrechnung plus
// Platz-Verteilung.
export async function setStats(conn, cteSql, params, from = 'fb') {
  const r = (await conn.runAndReadAll(`
    WITH ${cteSql},
    cl AS (SELECT mid, count(*) AS n, sum(placement) AS s FROM ${from} GROUP BY mid)
    SELECT count(*)::DOUBLE AS matches, coalesce(sum(n), 0)::DOUBLE AS n, coalesce(sum(s), 0)::DOUBLE AS s,
           coalesce(sum(s * s), 0)::DOUBLE AS ss, coalesce(sum(s * n), 0)::DOUBLE AS sn, coalesce(sum(n * n), 0)::DOUBLE AS nn
    FROM cl`, params)).getRowObjectsJS()[0];
  const hist = (await conn.runAndReadAll(`
    WITH ${cteSql}
    SELECT placement::INTEGER AS p, count(*)::DOUBLE AS c FROM ${from} GROUP BY 1 ORDER BY 1`, params)).getRowObjectsJS();
  const h = Array(8).fill(0);
  for (const x of hist) if (x.p >= 1 && x.p <= 8) h[x.p - 1] = x.c;
  return { ...r, hist: h };
}

// Schluessel je Reiter: liefert Zeilen (bid, mid, placement, key, sub, sub2)
// aus der Referenzmenge `ref`. Ohne Item-Fokus kommt die SQL aus
// scripts/lib/explorer-agg.mjs — dieselbe, aus der der Bau die
// Tages-Teilsummen rechnet. Dort auch: DISTINCT, weil eine Unit doppelt auf
// dem Board stehen kann; Sterne = hoechste Kopie je Board (zwei 2★-Kopien
// sind EIN Board mit 2★); Items erst je Board schmal, dann Partie und Platz
// (die breite Form lief bei der Startansicht ueber das Speicherlimit).
export function keySql(q, params, components) {
  // Komponenten stammen aus dem Bundle und sind per ID_RE geprueft,
  // deshalb als Literal statt als Listen-Parameter. Sie fallen in beiden
  // Item-Ansichten raus — ein Guertel im Inventar ist kein Build.
  const compList = compListSql(components);
  if (q.tab === 'items' && q.focus) {
    const its = `list_sort(list_filter([u.i1, u.i2, u.i3], x -> x IS NOT NULL AND NOT list_contains(${compList}, x)))`;
    const base = `SELECT r.bid, r.mid, r.placement, ${its} AS its FROM ref r JOIN units u USING (bid) WHERE u.unit = ?`;
    params.push(q.focus);
    if (q.combo === 1) {
      return `SELECT DISTINCT bid, mid, placement, key, NULL::INTEGER AS sub, NULL::INTEGER AS sub2 FROM (
                SELECT bid, mid, placement, unnest(its) AS key FROM (${base}))`;
    }
    if (q.combo === 2) {
      return `SELECT DISTINCT bid, mid, placement, key, NULL::INTEGER AS sub, NULL::INTEGER AS sub2 FROM (
                SELECT bid, mid, placement, unnest(CASE
                  WHEN len(its) = 2 THEN [its[1] || '|' || its[2]]
                  WHEN len(its) = 3 THEN [its[1] || '|' || its[2], its[1] || '|' || its[3], its[2] || '|' || its[3]]
                  ELSE []::VARCHAR[] END) AS key FROM (${base}))`;
    }
    return `SELECT DISTINCT bid, mid, placement, its[1] || '|' || its[2] || '|' || its[3] AS key, NULL::INTEGER AS sub, NULL::INTEGER AS sub2
            FROM (${base}) WHERE len(its) = 3`;
  }
  // Bei Sternen die Variante units_star; die Summenzeile je Unit entsteht
  // unten aus deren Zeilen (kg).
  const variant = variantsForQuery(q)?.[0];
  if (!variant) throw bad('invalid_tab');
  return keySelect(variant, { b: 'ref', compList });
}

// Kennzahlen je Zeile. Referenzmenge R (gefilterte Boards; im Item-Reiter mit
// Traeger nur Boards mit dieser Unit), Zeile = Teilmenge "mit", Rest "ohne".
//
// Fehlerrechnung ueber Partien als Klumpen: Fuer jede Partie g sei n/S Anzahl
// und Platzsumme in R, n1/S1 dasselbe in der Zeile. Die Abweichung
// m1 − m0 hat die Varianz Σ_g z_g² mit z_g = (S1−m1·n1)/N1 − (S0−m0·n0)/N0.
// Ausmultipliziert braucht das nur Summen ueber die Partien, in denen die
// Zeile vorkommt, plus drei Summen ueber ganz R (ref.ss/sn/nn).
export function rowStats(r, ref) {
  const N1 = r.n1, S1 = r.s1;
  const m1 = S1 / N1;
  const sumE2 = r.ss11 - 2 * m1 * r.sn11 + m1 * m1 * r.nn11;
  const seWith = Math.sqrt(Math.max(0, sumE2)) / N1;
  const out = {
    games: N1, matches: r.m1, avg: m1, top4: r.t4 / N1, top1: r.t1 / N1, half: 1.96 * seWith,
    dOut: null, dOutHalf: null, dBase: null, dBaseHalf: null,
  };
  const N0 = ref.n - N1;
  if (N0 > 0) {
    const m0 = (ref.s - S1) / N0;
    const sumED = r.s1S - m0 * r.s1N - m1 * r.n1S + m1 * m0 * r.n1N;
    const sumEF = r.ss11 - (m0 + m1) * r.sn11 + m1 * m0 * r.nn11;
    const sumF2 = r.ss11 - 2 * m0 * r.sn11 + m0 * m0 * r.nn11;
    const sumDF = r.s1S - m0 * r.n1S - m0 * r.s1N + m0 * m0 * r.n1N;
    const dAll = ref.ss - 2 * m0 * ref.sn + m0 * m0 * ref.nn;
    const v = sumE2 / (N1 * N1) - 2 * (sumED - sumEF) / (N1 * N0) + (sumF2 - 2 * sumDF + dAll) / (N0 * N0);
    out.dOut = m1 - m0;
    out.dOutHalf = 1.96 * Math.sqrt(Math.max(0, v));
    out.top4Out = out.top4 - (ref.t4 - r.t4) / N0;
  }
  if (ref.n > 0) {
    const m = ref.s / ref.n;
    const sumED = r.s1S - m * r.s1N - m1 * r.n1S + m1 * m * r.n1N;
    const dAll = ref.ss - 2 * m * ref.sn + m * m * ref.nn;
    const v = sumE2 / (N1 * N1) - 2 * sumED / (N1 * ref.n) + dAll / (ref.n * ref.n);
    out.dBase = m1 - m;
    out.dBaseHalf = 1.96 * Math.sqrt(Math.max(0, v));
    out.top4Base = out.top4 - ref.t4 / ref.n;
  }
  return out;
}

export function summarize(s) {
  const n = s.n;
  if (!n) return { games: 0, matches: 0, avg: null, top4: null, top1: null, half: null, hist: s.hist };
  const m = s.s / n;
  const sumE2 = s.ss - 2 * m * s.sn + m * m * s.nn;
  const t4 = s.hist.slice(0, 4).reduce((a, b) => a + b, 0);
  return {
    games: n, matches: s.matches, avg: m, top4: t4 / n, top1: s.hist[0] / n,
    half: 1.96 * Math.sqrt(Math.max(0, sumE2)) / n, hist: s.hist,
  };
}

// ─── Abfrage ───────────────────────────────────────────────────────────────

export async function runQuery(holder, q, { timeoutMs = QUERY_TIMEOUT_MS, warm = false } = {}) {
  const conn = await holder.instance.connect();
  if (warm) holder.warmConn = conn;
  const timer = setTimeout(() => { try { conn.interrupt(); } catch { /* bereits fertig */ } }, timeoutMs);
  try {
    // Tausch waehrend des Verbindens: pollSwap hat noch nichts zum Abbrechen gesehen.
    if (warm && holder.retired) throw new Error('swapped');
    const hasFilters = q.units.length + q.items.length + q.traits.length > 0;

    const pF = []; const cteF = fbCte(q, pF);
    const filtered = await setStats(conn, cteF, pF);

    let base = filtered;
    if (hasFilters) {
      const pB = []; const cteB = fbCte(q, pB, { withFilters: false });
      base = await setStats(conn, cteB, pB);
    }

    // Kopfzeile: gefiltert gegen den Rest der Grundmenge (disjunkt) — gleiche
    // Rechnung wie je Zeile, mit "Zeile" = gefilterte Boards.
    let headDelta = null;
    if (hasFilters && filtered.n > 0) {
      const p = [];
      const cteB = fbCte(q, p, { withFilters: false });
      const fw = filterWhere(q, p);
      const r = (await conn.runAndReadAll(`
        WITH ${cteB},
        cl AS (SELECT mid, count(*) AS n, sum(placement) AS s FROM fb GROUP BY mid),
        kg AS (SELECT mid, count(*) AS n1, sum(placement) AS s1 FROM fb b WHERE ${fw.join(' AND ')} GROUP BY mid)
        SELECT sum(s1 * cl.s)::DOUBLE AS "s1S", sum(s1 * cl.n)::DOUBLE AS "s1N",
               sum(n1 * cl.s)::DOUBLE AS "n1S", sum(n1 * cl.n)::DOUBLE AS "n1N"
        FROM kg JOIN cl USING (mid)`, p)).getRowObjectsJS()[0];
      const row = {
        n1: filtered.n, s1: filtered.s, m1: filtered.matches, ss11: filtered.ss, sn11: filtered.sn, nn11: filtered.nn,
        s1S: r.s1S, s1N: r.s1N, n1S: r.n1S, n1N: r.n1N,
        t4: filtered.hist.slice(0, 4).reduce((a, b) => a + b, 0), t1: filtered.hist[0],
      };
      const ref = { ...base, t4: base.hist.slice(0, 4).reduce((a, b) => a + b, 0) };
      headDelta = rowStats(row, ref);
    }

    const out = {
      summary: summarize(filtered),
      base: summarize(base),
      headDelta: headDelta && { dOut: headDelta.dOut, dOutHalf: headDelta.dOutHalf, dBase: headDelta.dBase, dBaseHalf: headDelta.dBaseHalf },
      rows: null,
      refGames: null,
    };

    if (q.tab !== 'summary' && filtered.n > 0) {
      const p = [];
      const cte = fbCte(q, p);
      let refCte = 'ref AS (SELECT * FROM fb)';
      let ref = filtered;
      if (q.tab === 'items' && q.focus) {
        refCte = 'ref AS (SELECT * FROM fb WHERE bid IN (SELECT bid FROM units WHERE unit = ?))';
        p.push(q.focus);
        const pr = [...p];
        ref = await setStats(conn, `${cte}, ${refCte}`, pr, 'ref');
      }
      const ks = keySql(q, p, holder.components);
      // Sterne-Vergleich: je Board genau ein Stern je Unit, also ergibt die
      // Summe ueber die Sterne je Partie exakt die Unit-Gesamtzeile (sub NULL).
      const starTotals = q.tab === 'units' && q.split === 'star';
      p.push(ROW_MIN_BOARDS, ROW_LIMIT);
      const rows = ref.n === 0 ? [] : (await conn.runAndReadAll(`
        WITH ${cte}, ${refCte},
        cl AS (SELECT mid, count(*) AS n, sum(placement) AS s FROM ref GROUP BY mid),
        k AS (${ks}),
        kg0 AS (SELECT key, sub, sub2, mid, count(*) AS n1, sum(placement) AS s1,
                      count(*) FILTER (WHERE placement <= 4) AS t4, count(*) FILTER (WHERE placement = 1) AS t1
               FROM k GROUP BY key, sub, sub2, mid),
        kg AS (${starTotals ? `SELECT * FROM kg0 UNION ALL BY NAME
               SELECT key, NULL::INTEGER AS sub, sub2, mid, sum(n1)::BIGINT AS n1, sum(s1) AS s1,
                      sum(t4)::BIGINT AS t4, sum(t1)::BIGINT AS t1
               FROM kg0 GROUP BY key, sub2, mid` : 'SELECT * FROM kg0'})
        SELECT key, sub, sub2, count(*)::DOUBLE AS m1, sum(n1)::DOUBLE AS n1, sum(s1)::DOUBLE AS s1,
               sum(t4)::DOUBLE AS t4, sum(t1)::DOUBLE AS t1,
               sum(s1 * s1)::DOUBLE AS ss11, sum(s1 * n1)::DOUBLE AS sn11, sum(n1 * n1)::DOUBLE AS nn11,
               sum(s1 * cl.s)::DOUBLE AS "s1S", sum(s1 * cl.n)::DOUBLE AS "s1N",
               sum(n1 * cl.s)::DOUBLE AS "n1S", sum(n1 * cl.n)::DOUBLE AS "n1N"
        FROM kg JOIN cl USING (mid)
        GROUP BY key, sub, sub2
        HAVING sum(n1) >= ?
        ${ROW_ORDER}
        LIMIT ?`, p)).getRowObjectsJS();
      finishRows(out, rows, ref);
      // Units: wie oft landet die Unit auf 3★ (hoechste Kopie je Board)?
      if (q.tab === 'units' && q.split !== 'star' && out.rows.length) {
        const ps = [];
        const cteS = fbCte(q, ps);
        const st = (await conn.runAndReadAll(`
          WITH ${cteS},
          s AS (SELECT u.unit, max(u.star) AS st FROM fb r JOIN units u USING (bid) GROUP BY r.bid, u.unit)
          SELECT unit, (count(*) FILTER (WHERE st >= 3))::DOUBLE / count(*) AS star3
          FROM s GROUP BY unit`, ps)).getRowObjectsJS();
        const m = new Map(st.map(x => [x.unit, x.star3]));
        for (const r of out.rows) r.star3 = m.get(r.key) ?? null;
      }
    } else if (q.tab !== 'summary') {
      out.rows = [];
      out.refGames = 0;
    }
    return out;
  } finally {
    clearTimeout(timer);
    if (holder.warmConn === conn) holder.warmConn = null;
    conn.closeSync?.();
  }
}

// Zeilen-Kennzahlen gegen die Referenzmenge; beide Wege enden hier.
export function finishRows(out, rows, ref) {
  const refT = { ...ref, t4: ref.hist.slice(0, 4).reduce((a, b) => a + b, 0) };
  out.refGames = ref.n;
  out.rows = rows.map(r => ({ key: r.key, sub: r.sub, sub2: r.sub2, ...rowStats(r, refT) }));
}
