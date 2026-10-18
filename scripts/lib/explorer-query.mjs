// Abfrage-Logik des Explorer-Dienstes (scripts/explorer-duckdb-server.mjs),
// aus dem Dienst hierher verschoben (Paket 6), damit ein Test den heutigen
// Weg und den Masken-Weg lokal gegeneinander rechnen kann.

import { compListSql, keySelect, variantsForQuery } from './explorer-agg.mjs';
import { COUNT_COLS, TAG_BITS } from './explorer-counts.mjs';
import { bad, hasBoardFilters } from './explorer-normalize.mjs';

export { bad };

export const QUERY_TIMEOUT_MS = Number(process.env.EXPLORER_QUERY_TIMEOUT_MS || 15_000);
export const ROW_LIMIT = 500;
export const ROW_MIN_BOARDS = 5;
// Feste Reihenfolge in beiden Wegen: bei gleicher Board-Zahl entschied sonst
// der Zufall, welche Zeilen an der 500er-Grenze landen.
export const ROW_ORDER = 'ORDER BY n1 DESC, key NULLS FIRST, sub NULLS FIRST, sub2 NULLS FIRST';

// ─── SQL bauen ─────────────────────────────────────────────────────────────

// Grundmenge: Region / Rang / Patch, dazu Spieler-Level und Endplatz
// (Ergebnis-Groessen wie der Rang, keine Brett-Bedingung).
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
  if (q.levels?.length) { w.push(`b.level IN (${q.levels.map(() => '?').join(',')})`); params.push(...q.levels); }
  if (q.place) { w.push('b.placement BETWEEN ? AND ?'); params.push(q.place[0], q.place[1]); }
  return w;
}

// Itemsorte an einer Kopie: dieselben Muster wie extraKindOf
// (scripts/lib/tft-build-aggregator.mjs, Grundlage 0097 — ohne Augment- und
// Phantom-Embleme) plus Radiant (Endung, wie app/lib/tft-item-bucket.ts).
// Vorrang Artefakt > Emblem > Radiant. Gleichlauf mit extraKindOf:
// explorer-normalize.test.mjs gegen das Bundle.
export const ITEM_KIND_RE = { artifact: /_Artifact_/i, emblem: /Emblem/i, emblemSkip: /Augment|Phantom/i, radiant: /Radiant$/ };
export function itemKindOf(id) {
  const s = String(id ?? '');
  if (ITEM_KIND_RE.artifact.test(s)) return 'artifact';
  if (ITEM_KIND_RE.emblem.test(s) && !ITEM_KIND_RE.emblemSkip.test(s)) return 'emblem';
  if (ITEM_KIND_RE.radiant.test(s)) return 'radiant';
  return null;
}
const re = (x, r) => `regexp_matches(${x}, '${r.source}'${r.flags.includes('i') ? ", 'i'" : ''})`;
const isArtifact = (x) => re(x, ITEM_KIND_RE.artifact);
const isEmblem = (x) => `(${re(x, ITEM_KIND_RE.emblem)} AND NOT ${re(x, ITEM_KIND_RE.emblemSkip)})`;
export const ITEM_KIND_SQL = {
  artifact: isArtifact,
  emblem: (x) => `(NOT ${isArtifact(x)} AND ${isEmblem(x)})`,
  radiant: (x) => `(NOT ${isArtifact(x)} AND NOT ${isEmblem(x)} AND ${re(x, ITEM_KIND_RE.radiant)})`,
};
// Treffer je Slot, NULL-sicher (leerer Slot zaehlt 0, nie NULL).
const slotSum = (pred) => `(${['i1', 'i2', 'i3'].map(c => `coalesce(${pred(c)}, false)::INTEGER`).join(' + ')})`;

// Bedingung an EINE Kopie der Unit; c = mindestens so viele Kopien auf dem
// Brett (unabhaengig davon: eine davon erfuellt die Kopie-Bedingung).
export function unitCond(u, params) {
  const c = [];
  const p = [];
  if (u.s != null && u.sx != null) {
    if (u.s === u.sx) { c.push('star = ?'); p.push(u.s); } else { c.push('star BETWEEN ? AND ?'); p.push(u.s, u.sx); }
  } else if (u.s != null) { c.push('star >= ?'); p.push(u.s); } else if (u.sx != null) { c.push('star <= ?'); p.push(u.sx); }
  if (u.n != null && u.nx != null) {
    if (u.n === u.nx) { c.push('n_items = ?'); p.push(u.n); } else { c.push('n_items BETWEEN ? AND ?'); p.push(u.n, u.nx); }
  } else if (u.n != null) { c.push('n_items >= ?'); p.push(u.n); } else if (u.nx != null) { c.push('n_items <= ?'); p.push(u.nx); }
  // Dasselbe Item mehrfach = so oft an dieser Kopie.
  const times = new Map();
  for (const it of u.it) times.set(it, (times.get(it) ?? 0) + 1);
  for (const [it, k] of times) {
    if (k === 1) { c.push('list_contains([i1, i2, i3], ?)'); p.push(it); } else { c.push(`${slotSum(x => `${x} = ?`)} >= ?`); p.push(it, it, it, k); }
  }
  for (const it of u.nit) { c.push('NOT list_contains([i1, i2, i3], ?)'); p.push(it); }
  for (const e of u.k ?? []) { c.push(`${slotSum(ITEM_KIND_SQL[e.b])} >= ?`); p.push(e.n); }
  if (u.c != null) {
    params.push(u.id, u.c, ...p);
    return `SELECT bid FROM units WHERE unit = ? GROUP BY bid HAVING count(*) >= ?${c.length ? ` AND bool_or(${c.join(' AND ')})` : ''}`;
  }
  params.push(u.id, ...p);
  return `SELECT bid FROM units WHERE ${['unit = ?', ...c].join(' AND ')}`;
}

// Item irgendwo auf dem Brett; n = mindestens so oft. Drei Vergleiche statt
// list_contains: units ist nach Unit sortiert, hier wird die ganze Tabelle
// gelesen, und die Liste je Zeile kostet doppelt (17.10.: 29 → 17 s). Nur in
// dieser positiven Lage gleich — ein leerer Slot macht den Vergleich NULL.
export function itemCond(i, params) {
  const any = '(i1 = ? OR i2 = ? OR i3 = ?)';
  if (i.n == null) { params.push(i.id, i.id, i.id); return `SELECT bid FROM units WHERE ${any}`; }
  params.push(i.id, i.id, i.id, i.id, i.id, i.id, i.n);
  return `SELECT bid FROM units WHERE ${any} GROUP BY bid HAVING sum(${slotSum(x => `${x} = ?`)}) >= ?`;
}

export function traitCond(t, params) {
  const c = ['trait = ?']; params.push(t.id);
  if (!t.x && t.l != null) { c.push(t.le ? 'lvl = ?' : 'lvl >= ?'); params.push(t.l); }
  return `SELECT bid FROM traits WHERE ${c.join(' AND ')}`;
}

// Kasten: „eins davon" = ODER der Glieder, „keins davon" = keines davon
// (NULL-sicher; ein IN liefert hier ohnehin nie NULL).
export function groupCond(g, params) {
  const parts = [
    ...g.units.map(u => `b.bid IN (${unitCond(u, params)})`),
    ...g.items.map(i => `b.bid IN (${itemCond(i, params)})`),
    ...g.traits.map(t => `b.bid IN (${traitCond(t, params)})`),
  ];
  const any = `(${parts.join(' OR ')})`;
  return g.m === 'none' ? `NOT coalesce(${any}, false)` : any;
}

export function filterWhere(q, params) {
  const w = [];
  for (const u of q.units) w.push(`b.bid ${u.x ? 'NOT IN' : 'IN'} (${unitCond(u, params)})`);
  for (const i of q.items) w.push(`b.bid ${i.x ? 'NOT IN' : 'IN'} (${itemCond(i, params)})`);
  for (const t of q.traits) w.push(`b.bid ${t.x ? 'NOT IN' : 'IN'} (${traitCond(t, params)})`);
  for (const g of q.groups ?? []) w.push(groupCond(g, params));
  // Brett-Zaehler und Tags (Paket B): fertige Spalten in boards, gerechnet im
  // Bau (scripts/lib/explorer-counts.mjs). Die Tag-Maske kommt aus TAG_BITS,
  // daher als Literal — ein DOUBLE-Parameter passt nicht zu UTINYINT & .
  for (const e of q.bc ?? []) {
    if (!COUNT_COLS[e.k]) throw bad('invalid_board_count');
    const col = `b.${COUNT_COLS[e.k]}`;
    if (e.n != null && e.nx != null) {
      if (e.n === e.nx) { w.push(`${col} = ?`); params.push(e.n); } else { w.push(`${col} BETWEEN ? AND ?`); params.push(e.n, e.nx); }
    } else if (e.n != null) { w.push(`${col} >= ?`); params.push(e.n); } else { w.push(`${col} <= ?`); params.push(e.nx); }
  }
  if (q.tags?.length) {
    const m = q.tags.reduce((a, t) => a | TAG_BITS[t], 0);
    if (!Number.isInteger(m) || m <= 0) throw bad('invalid_tags');
    w.push(`(b.tags & ${m}::UTINYINT) = ${m}`);
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
// Builds-Reiter (Paket C): Schluessel = komplettes Build der Kopie (units.bk,
// Items ohne Bauteile, sortiert, 1–3 Items). Mit Diebeshandschuhen zaehlt nur
// der Handschuh — die Items daneben wuerfelt das Spiel jede Runde neu.
export const BUILD_KEY_SQL = (bk) =>
  `CASE WHEN contains(${bk}, 'ThiefsGloves') THEN regexp_extract(${bk}, '[A-Za-z0-9_]*ThiefsGloves[A-Za-z0-9_]*') ELSE ${bk} END`;

// opts.bk: units.bk passt zur Komponenten-Liste des Dienstes (holder.bkOk).
// Dann liest „komplette Builds" (combo 3) den fertigen Schluessel statt die
// Liste je Zeile zu bauen (17.10.: 504 bei beliebten Units).
export function keySql(q, params, components, { bk = false } = {}) {
  // Komponenten stammen aus dem Bundle und sind per ID_RE geprueft,
  // deshalb als Literal statt als Listen-Parameter. Sie fallen in beiden
  // Item-Ansichten raus — ein Guertel im Inventar ist kein Build.
  const compList = compListSql(components);
  if (q.tab === 'builds') {
    if (!q.focus || !bk) throw bad('invalid_tab');
    params.push(q.focus);
    return `SELECT DISTINCT r.bid, r.mid, r.placement, ${BUILD_KEY_SQL('u.bk')} AS key, NULL::INTEGER AS sub, NULL::INTEGER AS sub2
            FROM ref r JOIN units u USING (bid) WHERE u.unit = ? AND u.bk IS NOT NULL`;
  }
  if (q.tab === 'items' && q.focus && q.combo === 3 && bk) {
    params.push(q.focus);
    return `SELECT DISTINCT r.bid, r.mid, r.placement, u.bk AS key, NULL::INTEGER AS sub, NULL::INTEGER AS sub2
            FROM ref r JOIN units u USING (bid) WHERE u.unit = ? AND u.bk LIKE '%|%|%'`;
  }
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

// Kopf der Antwort aus gefilterter Menge, Grundmenge und den Kreuzsummen der
// Abweichung (null = keine Abweichung). Heutiger Weg und Masken-Weg
// (explorer-mask-query.mjs) bauen ihn hier, damit Form und Reihenfolge gleich bleiben.
export function headOut(filtered, base, cross) {
  let headDelta = null;
  if (cross) {
    const row = {
      n1: filtered.n, s1: filtered.s, m1: filtered.matches, ss11: filtered.ss, sn11: filtered.sn, nn11: filtered.nn,
      s1S: cross.s1S, s1N: cross.s1N, n1S: cross.n1S, n1N: cross.n1N,
      t4: filtered.hist.slice(0, 4).reduce((a, b) => a + b, 0), t1: filtered.hist[0],
    };
    const ref = { ...base, t4: base.hist.slice(0, 4).reduce((a, b) => a + b, 0) };
    headDelta = rowStats(row, ref);
  }
  return {
    summary: summarize(filtered),
    base: summarize(base),
    headDelta: headDelta && { dOut: headDelta.dOut, dOutHalf: headDelta.dOutHalf, dBase: headDelta.dBase, dBaseHalf: headDelta.dBaseHalf },
    rows: null,
    refGames: null,
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
    const hasFilters = hasBoardFilters(q);

    const pF = []; const cteF = fbCte(q, pF);
    const filtered = await setStats(conn, cteF, pF);

    let base = filtered;
    if (hasFilters) {
      const pB = []; const cteB = fbCte(q, pB, { withFilters: false });
      base = await setStats(conn, cteB, pB);
    }

    // Kopfzeile: gefiltert gegen den Rest der Grundmenge (disjunkt) — gleiche
    // Rechnung wie je Zeile, mit "Zeile" = gefilterte Boards.
    let cross = null;
    if (hasFilters && filtered.n > 0) {
      const p = [];
      const cteB = fbCte(q, p, { withFilters: false });
      const fw = filterWhere(q, p);
      cross = (await conn.runAndReadAll(`
        WITH ${cteB},
        cl AS (SELECT mid, count(*) AS n, sum(placement) AS s FROM fb GROUP BY mid),
        kg AS (SELECT mid, count(*) AS n1, sum(placement) AS s1 FROM fb b WHERE ${fw.join(' AND ')} GROUP BY mid)
        SELECT sum(s1 * cl.s)::DOUBLE AS "s1S", sum(s1 * cl.n)::DOUBLE AS "s1N",
               sum(n1 * cl.s)::DOUBLE AS "n1S", sum(n1 * cl.n)::DOUBLE AS "n1N"
        FROM kg JOIN cl USING (mid)`, p)).getRowObjectsJS()[0];
    }
    const out = headOut(filtered, base, cross);

    await liveRows(conn, q, holder, out, filtered);
    return out;
  } finally {
    clearTimeout(timer);
    if (holder.warmConn === conn) holder.warmConn = null;
    conn.closeSync?.();
  }
}

// Tabellenzeilen live aus den Boards (und units-3★). mkCte(params) liefert die
// fb-CTE; der Masken-Weg (Paket 6) gibt statt der Filter-WHERE den Join auf
// seine Partien-Tabelle g mit, Rechnung und Ausgabe bleiben dieselben.
export async function liveRows(conn, q, holder, out, filtered, mkCte = p => fbCte(q, p)) {
  if (q.tab === 'games') return gamesRows(conn, out, filtered, mkCte);
  // Builds nur mit Traeger; der Dienst prueft vorher, ob die Datei bk hat.
  if (q.tab === 'builds' && !q.focus) { out.rows = []; out.refGames = 0; return; }
  if (q.tab !== 'summary' && filtered.n > 0) {
    const p = [];
    const cte = mkCte(p);
    let refCte = 'ref AS (SELECT * FROM fb)';
    let ref = filtered;
    if ((q.tab === 'items' || q.tab === 'builds') && q.focus) {
      refCte = 'ref AS (SELECT * FROM fb WHERE bid IN (SELECT bid FROM units WHERE unit = ?))';
      p.push(q.focus);
      const pr = [...p];
      ref = await setStats(conn, `${cte}, ${refCte}`, pr, 'ref');
    }
    const ks = keySql(q, p, holder.components, { bk: !!holder.bkOk });
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
      const cteS = mkCte(ps);
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
}

// Spiele-Reiter (Paket C): die GAMES_LIMIT neuesten gefilterten Bretter mit
// Units, Traits und Spieler. Die puuid braucht nur die Route (Namen und
// Link), sie entfernt sie vor dem Browser; die interne Brett-Nummer bleibt
// hier. Die Nummern der 20 Bretter stammen aus der eigenen Datei und gehen
// als Zahl-Literal in die Abfrage — so kann DuckDB board_rank (nach bid
// sortiert) gezielt lesen.
export const GAMES_LIMIT = 20;
export async function gamesRows(conn, out, filtered, mkCte) {
  out.rows = [];
  out.refGames = filtered.n;
  out.games = [];
  if (!(filtered.n > 0)) return;
  const p = [];
  const cte = mkCte(p);
  p.push(GAMES_LIMIT);
  const top = (await conn.runAndReadAll(`
    WITH ${cte}
    SELECT bid, ts, placement, level, last_round, patch, region, rank FROM fb
    ORDER BY ts DESC, mid, placement LIMIT ?`, p)).getRowObjectsJS();
  if (!top.length) return;
  const bids = top.map(r => Number(r.bid));
  if (!bids.every(Number.isSafeInteger)) throw new Error('bid ungueltig');
  const inList = bids.join(', ');
  const units = (await conn.runAndReadAll(
    `SELECT bid, unit, star, i1, i2, i3 FROM units WHERE bid IN (${inList}) ORDER BY bid, unit`)).getRowObjectsJS();
  const traits = (await conn.runAndReadAll(
    `SELECT bid, trait, lvl, num_units FROM traits WHERE bid IN (${inList}) ORDER BY bid, lvl DESC, num_units DESC, trait`)).getRowObjectsJS();
  const players = (await conn.runAndReadAll(
    `SELECT br.bid, p.puuid FROM board_rank br JOIN players p USING (ph) WHERE br.bid IN (${inList})`)).getRowObjectsJS();
  const by = (rows) => {
    const m = new Map();
    for (const r of rows) { const k = Number(r.bid); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return m;
  };
  const ub = by(units);
  const tb = by(traits);
  const pb = new Map(players.map(r => [Number(r.bid), r.puuid]));
  out.games = top.map(r => {
    const bid = Number(r.bid);
    return {
      ts: Number(r.ts), placement: r.placement, level: r.level, round: r.last_round, patch: r.patch, region: r.region, rank: r.rank ?? null,
      puuid: pb.get(bid) ?? null,
      units: (ub.get(bid) ?? []).map(u => ({ id: u.unit, s: u.star, it: [u.i1, u.i2, u.i3].filter(x => x != null) })),
      traits: (tb.get(bid) ?? []).map(t => ({ id: t.trait, l: t.lvl, n: t.num_units })),
    };
  });
}

// Zeilen-Kennzahlen gegen die Referenzmenge; beide Wege enden hier.
export function finishRows(out, rows, ref) {
  const refT = { ...ref, t4: ref.hist.slice(0, 4).reduce((a, b) => a + b, 0) };
  out.refGames = ref.n;
  out.rows = rows.map(r => ({ key: r.key, sub: r.sub, sub2: r.sub2, ...rowStats(r, refT) }));
}
