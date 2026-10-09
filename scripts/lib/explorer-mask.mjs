// Platz-Masken des Explorers (Paket 6). Je Partie und Schluessel ein Byte:
// Bit p-1 gesetzt = das Board auf Platz p dieser Partie hat den Schluessel.
// Eine Partie hat 8 Boards mit 8 verschiedenen Plaetzen (Pruefung g), ein
// Byte traegt also die ganze Partie. Gefilterte Ansichten rechnen dann je
// Partie mit Bit-Operationen statt mit Joins ueber alle Units (Plan
// .claude/plan-current.md, Entwurf A + B).
//
// EINE Quelle fuer Tabellen, Spalten und Masken-SQL: der Bau
// (explorer-mask-build.mjs) und der Abfragedienst setzen sich hieraus
// zusammen. MASK_SIG haengt am erzeugten SQL-Text — aendert sich eine
// Definition (auch keySelect), passen die gespeicherten Masken nicht mehr
// und werden neu gerechnet. explorer-query.mjs importiert diese Datei nie.

import crypto from 'node:crypto';
import { keySelect, nextUtc, AGG_SWAP_UTC, AGG_HARD_S } from './explorer-agg.mjs';
import { lit, qi } from './explorer-agg-build.mjs';

// ─── Tabellen und Spalten ──────────────────────────────────────────────────

// um: Units je Sternstufe (hoechster Stern des Boards), ui: Items ohne
// Komponenten, ut: Traits je Stufe und Uebercap, uk: Items mit Komponenten.
export const MASK_DATA_TABLES = ['mask_um', 'mask_ui', 'mask_ut', 'mask_uk'];
export const MASK_TABLES = [...MASK_DATA_TABLES, 'mask_days', 'mask_fail', 'mask_meta'];
export const STAR_VALUES = [1, 2, 3, 4];
export const OVER_VALUES = [0, 1, 2, 3, 4];
export const MASK_COLS = {
  mask_um: ['day', 'mid', 'unit', ...STAR_VALUES.map((s) => `m${s}`)],
  mask_ui: ['day', 'mid', 'item', 'm'],
  mask_ut: ['day', 'mid', 'trait', 'lvl', ...OVER_VALUES.map((v) => `o${v}`), 'onull'],
  mask_uk: ['day', 'mid', 'item', 'm'],
};
// Bit-Spalten je Tabelle (alle, deren ODER = "Board hat den Schluessel").
export const MASK_BIT_COLS = {
  mask_um: STAR_VALUES.map((s) => `m${s}`),
  mask_ui: ['m'],
  mask_ut: [...OVER_VALUES.map((v) => `o${v}`), 'onull'],
  mask_uk: ['m'],
};

// mask_days: gedeckte Tage mit Fingerabdruck beim Rechnen und
// Komponenten-Kennung der ui-Zeilen. mask_fail: gescheiterte Tage, neuer
// Versuch erst bei anderem Fingerabdruck. mask_meta: Rechenweg + Kennung
// (= meta.mask_token der Datei).
export const maskTablesDdl = (o) => [
  `CREATE TABLE ${o}.mask_um(day DATE, mid UBIGINT, unit VARCHAR, ${STAR_VALUES.map((s) => `m${s} UTINYINT`).join(', ')})`,
  `CREATE TABLE ${o}.mask_ui(day DATE, mid UBIGINT, item VARCHAR, m UTINYINT)`,
  `CREATE TABLE ${o}.mask_ut(day DATE, mid UBIGINT, trait VARCHAR, lvl UTINYINT, `
    + `${OVER_VALUES.map((v) => `o${v} UTINYINT`).join(', ')}, onull UTINYINT)`,
  `CREATE TABLE ${o}.mask_uk(day DATE, mid UBIGINT, item VARCHAR, m UTINYINT)`,
  `CREATE TABLE ${o}.mask_days(day DATE, fp VARCHAR, comp_hash VARCHAR)`,
  `CREATE TABLE ${o}.mask_fail(day DATE, fp VARCHAR, why VARCHAR)`,
  `CREATE TABLE ${o}.mask_meta(sig VARCHAR, token VARCHAR)`,
];

// Sortierung je Tabelle (uk nach Item: der Item-Filter liest dann nur die
// passenden Bloecke). Gleich in maskSql und beim Kopieren aus der Vorgaenger-Datei.
export const MASK_ORDER = {
  mask_um: 'day, unit, mid',
  mask_ui: 'day, mid, item',
  mask_ut: 'day, mid, trait, lvl',
  mask_uk: 'day, item, mid',
};

// ─── Bits ──────────────────────────────────────────────────────────────────

// Platz 1 = Bit 0. Top 4 = 0b1111, Sieg = 0b1.
export const MASK_TOP4 = 15;
export const MASK_TOP1 = 1;
export const maskBit = (p) => 1 << (p - 1);
// Platz 0 oder 9 wirft in DuckDB (UTINYINT-Ueberlauf) — Pruefung g laeuft davor.
export const maskBitSql = (p) => `(1::UTINYINT << (${p} - 1))`;
const popcount = (x) => { let n = 0; for (let v = x; v; v &= v - 1) n++; return n; };
// Platzsumme der gesetzten Bits: Platz = 1 + (Bit 0 des Index) + 2·(Bit 1) + 4·(Bit 2).
export const maskPlaceSum = (x) => popcount(x) + popcount(x & 170) + 2 * popcount(x & 204) + 4 * popcount(x & 240);
export const maskPlaceSumSql = (x) => `(bit_count(${x}) + bit_count(${x} & 170) + 2 * bit_count(${x} & 204) + 4 * bit_count(${x} & 240))`;

// ─── Masken-SQL ────────────────────────────────────────────────────────────

const orIf = (cond, name) => `bit_or(CASE WHEN ${cond} THEN ${maskBitSql('k.placement')} ELSE 0::UTINYINT END) AS ${name}`;
const dayJoin = (b) => `JOIN (SELECT DISTINCT mid, day FROM ${b}) d USING (mid)`;

// Masken-Zeilen einer Tabelle als SELECT mit Sortierung. b/u/t = Namen der
// Board- (bid, mid, day, placement), Unit- und Trait-Relation (keySelect
// braucht Namen, keine Unterabfragen). ui entsteht aus den uk-Zeilen
// derselben Partien (uk = Relation oder Unterabfrage) ohne Komponenten — die
// Schluessel-Menge ist dieselbe wie keySelect('items') mit compList.
export function maskSql(table, { b, u, t, uk, compList } = {}) {
  switch (table) {
    case 'mask_um':
      return `SELECT d.day, k.mid, k.key AS unit, ${STAR_VALUES.map((s) => orIf(`k.sub = ${s}`, `m${s}`)).join(', ')}
    FROM (${keySelect('units_star', { b, u })}) k ${dayJoin(b)}
    GROUP BY d.day, k.mid, k.key ORDER BY 1, 3, 2`;
    case 'mask_uk':
      return `SELECT d.day, k.mid, k.key AS item, bit_or(${maskBitSql('k.placement')}) AS m
    FROM (${keySelect('items', { b, u, compList: '[]::VARCHAR[]' })}) k ${dayJoin(b)}
    GROUP BY d.day, k.mid, k.key ORDER BY 1, 3, 2`;
    case 'mask_ut':
      return `SELECT d.day, k.mid, k.key AS trait, k.sub::UTINYINT AS lvl,
      ${OVER_VALUES.map((v) => orIf(`k.sub2 = ${v}`, `o${v}`)).join(', ')}, ${orIf('k.sub2 IS NULL', 'onull')}
    FROM (${keySelect('traits_over', { b, t })}) k ${dayJoin(b)}
    GROUP BY d.day, k.mid, k.key, k.sub ORDER BY 1, 2, 3, 4`;
    case 'mask_ui':
      if (!uk || !compList) throw new Error('mask_ui braucht uk und compList');
      return `SELECT day, mid, item, m FROM ${uk} WHERE NOT list_contains(${compList}, item) ORDER BY 1, 2, 3`;
    default:
      throw new Error(`unbekannte Masken-Tabelle ${table}`);
  }
}

// Tages-Fingerabdruck der Masken-Eingaben: je Tag Anzahl und Summe eines
// zeilenweisen hash() ueber alles, was die Masken lesen. Summen sind
// additiv — neue Boards eines Tages kommen per maskFpAdd dazu.
export const maskFpSql = ({ b, u, t }) => {
  const sel = (list) => `SELECT b.day::VARCHAR AS day, count(*)::DOUBLE AS n, sum(hash(${list})::HUGEINT)::VARCHAR AS h`;
  return {
    b: `${sel('b.mid, b.placement')} FROM ${b} b GROUP BY ALL`,
    u: `${sel('b.mid, b.placement, x.unit, x.star, x.i1, x.i2, x.i3')} FROM ${u} x JOIN ${b} b USING (bid) GROUP BY ALL`,
    t: `${sel('b.mid, b.placement, x.trait, x.lvl, x.overcap')} FROM ${t} x JOIN ${b} b USING (bid) GROUP BY ALL`,
  };
};

export const MASK_FP_EMPTY = '0:0|0:0|0:0';

// Map Tag → "n:h|n:h|n:h" (boards|units|traits).
export async function maskFp(all, names) {
  const q = maskFpSql(names);
  const by = new Map();
  for (const [i, part] of ['b', 'u', 't'].entries()) {
    for (const r of await all(q[part])) {
      const day = String(r.day);
      const o = by.get(day) ?? ['0:0', '0:0', '0:0'];
      o[i] = `${Number(r.n)}:${String(r.h)}`;
      by.set(day, o);
    }
  }
  return new Map([...by].map(([d, o]) => [d, o.join('|')]));
}

// Teil-Fingerabdruecke addieren (Anzahl als Zahl, Summe als BigInt).
export function maskFpAdd(a, b) {
  const pa = String(a ?? MASK_FP_EMPTY).split('|');
  const pb = String(b ?? MASK_FP_EMPTY).split('|');
  if (pa.length !== 3 || pb.length !== 3) throw new Error(`Fingerabdruck ungueltig (${a} / ${b})`);
  return pa.map((x, i) => {
    const [na, ha] = x.split(':');
    const [nb, hb] = pb[i].split(':');
    return `${Number(na) + Number(nb)}:${(BigInt(ha) + BigInt(hb)).toString()}`;
  }).join('|');
}

// ─── Pruefungen ────────────────────────────────────────────────────────────

// (g) je Tag: kein Platz doppelt in einer Partie, Plaetze 1–8 und nicht leer,
// Sterne 1–4, Uebercap 0–4 oder leer. Zeilen (day, k, n) nur fuer Verstoesse.
export const maskCheckGSql = ({ b, u, t }) => `WITH bb AS (SELECT bid, mid, day, placement FROM ${b})
  SELECT day::VARCHAR AS day, k, n::DOUBLE AS n FROM (
    SELECT day, 'doppelter Platz' AS k, count(*) AS n
      FROM (SELECT day, mid, placement FROM bb GROUP BY ALL HAVING count(*) > 1) GROUP BY ALL
    UNION ALL SELECT day, 'Platz leer oder ausserhalb 1–8' AS k, count(*) AS n
      FROM bb WHERE placement IS NULL OR placement < 1 OR placement > 8 GROUP BY ALL
    UNION ALL SELECT bb.day, 'Stern leer oder ausserhalb 1–4' AS k, count(*) AS n
      FROM ${u} x JOIN bb USING (bid) WHERE x.star IS NULL OR x.star < 1 OR x.star > 4 GROUP BY ALL
    UNION ALL SELECT bb.day, 'Uebercap ausserhalb 0–4' AS k, count(*) AS n
      FROM ${t} x JOIN bb USING (bid) WHERE x.overcap IS NOT NULL AND (x.overcap < 0 OR x.overcap > 4) GROUP BY ALL)
  ORDER BY 1, 2`;

// Map Tag → Grund, nur Tage mit Verstoss.
export async function maskCheckG(all, names) {
  const by = new Map();
  for (const r of await all(maskCheckGSql(names))) {
    const day = String(r.day);
    by.set(day, [...(by.get(day) ?? []), `${Number(r.n)}× ${r.k}`]);
  }
  return new Map([...by].map(([d, list]) => [d, `(g) ${list.join(', ')}`]));
}

// (g) ueber die ganze Datei: Tage mit Partien, die an mehr als einem Tag liegen.
export const maskMultiDaySql = (o) => `SELECT DISTINCT day::VARCHAR AS v FROM ${o}.boards
  WHERE mid IN (SELECT mid FROM ${o}.boards GROUP BY mid HAVING count(DISTINCT day) > 1) ORDER BY 1`;

// (h) Summe der gesetzten Bits je Tabelle = Anzahl (Board, Schluessel) aus
// der Kopie. Masken-Zeilen von Tag D in o, wahlweise nur Partien aus mids;
// b/u/t = Kopie genau dieser Boards.
export function maskCheckHSql({ o, D, b, u, t, compList, mids = null }) {
  const scope = `day = ${D}${mids ? ` AND mid IN (SELECT mid FROM ${mids})` : ''}`;
  const bits = (tab) => `(SELECT coalesce(sum(${MASK_BIT_COLS[tab].map((c) => `bit_count(${c})`).join(' + ')}), 0)::DOUBLE
      FROM ${o}.${tab} WHERE ${scope})`;
  const items = (extra) => `(SELECT count(*)::DOUBLE FROM (SELECT DISTINCT bid, item FROM (
      SELECT x.bid, unnest([x.i1, x.i2, x.i3]) AS item FROM ${u} x WHERE x.bid IN (SELECT bid FROM ${b}))
      WHERE item IS NOT NULL${extra}))`;
  return `SELECT
    ${bits('mask_um')} AS um_bits,
    (SELECT count(*)::DOUBLE FROM (SELECT DISTINCT x.bid, x.unit FROM ${u} x WHERE x.bid IN (SELECT bid FROM ${b}))) AS um_n,
    ${bits('mask_uk')} AS uk_bits, ${items('')} AS uk_n,
    ${bits('mask_ui')} AS ui_bits, ${items(` AND NOT list_contains(${compList}, item)`)} AS ui_n,
    ${bits('mask_ut')} AS ut_bits,
    (SELECT count(*)::DOUBLE FROM (SELECT DISTINCT x.bid, x.trait, x.lvl, x.overcap FROM ${t} x WHERE x.bid IN (SELECT bid FROM ${b}))) AS ut_n`;
}

// Liste der Abweichungen, leer = in Ordnung.
export async function maskCheckH(all, args) {
  const r = (await all(maskCheckHSql(args)))[0];
  const out = [];
  for (const k of ['um', 'uk', 'ui', 'ut']) {
    const bitsN = Number(r[`${k}_bits`]);
    const n = Number(r[`${k}_n`]);
    if (bitsN !== n) out.push(`(h) mask_${k} ${bitsN} Bits ≠ ${n} Zeilen`);
  }
  return out;
}

// ─── Bindung ───────────────────────────────────────────────────────────────

// Passen die Masken in Datei db zu ihr? Alle Tabellen da, Rechenweg, Kennung
// (mask_meta = meta.mask_token). null = ja, sonst der Grund.
export async function maskBindingReason({ all, db }) {
  const tables = (await all(`SELECT table_name AS v FROM duckdb_tables() WHERE database_name = ${lit(db)}`)).map((r) => r.v);
  const missing = MASK_TABLES.filter((t) => !tables.includes(t));
  if (missing.length === MASK_TABLES.length) return 'keine Masken in der vorigen Datei';
  if (missing.length) return `Masken-Tabellen fehlen (${missing.join(', ')})`;
  const mm = await all(`SELECT sig, token FROM ${qi(db)}.mask_meta`);
  const metaCols = (await all(`SELECT column_name AS v FROM duckdb_columns() WHERE database_name = ${lit(db)} AND table_name = 'meta'`))
    .map((r) => r.v);
  const prevToken = metaCols.includes('mask_token') ? ((await all(`SELECT mask_token AS v FROM ${qi(db)}.meta`))[0]?.v ?? null) : null;
  if (mm.length !== 1) return `mask_meta mit ${mm.length} Zeilen`;
  if (mm[0].sig !== MASK_SIG) return `Rechenweg geaendert (${mm[0].sig} → ${MASK_SIG})`;
  if (!mm[0].token || mm[0].token !== prevToken) return 'Kennung passt nicht zur Datei';
  return null;
}

// ─── Planung im Bau (reine Funktionen) ─────────────────────────────────────

// AGG_MASKS=0 schaltet die Masken ab (vorhandene werden geloescht).
export const maskEnabled = (raw) => String(raw ?? '').trim() !== '0';

// Vollaufbau mit Uebernahme: Tage, die in der vorigen Datei masken-gedeckt
// waren, im Fenster liegen und deren alte Boards in beiden Dateien denselben
// Teilsummen-Fingerabdruck haben (aggFingerprint deckt mid, Platz, Unit,
// Stern, Items, Trait, Stufe, Uebercap ab). Neueste zuerst.
export function maskCarryDays({ oldFp, newFp, maskDays, w }) {
  return [...new Set(maskDays)]
    .filter((d) => d >= w && oldFp.has(d) && newFp.has(d) && oldFp.get(d) === newFp.get(d))
    .sort().reverse();
}

// Rechen-Reihenfolge: ungedeckte Tage ohne Sperre (mask_fail mit gleichem
// Fingerabdruck), neueste zuerst. Masken haben keine Pflicht-Tage.
export function maskQueue({ days, covered, skip = [] }) {
  const cov = new Set(covered);
  const sk = new Set(skip);
  return [...new Set(days)].filter((d) => !cov.has(d) && !sk.has(d)).sort().reverse();
}

// Frist fuer neue Tage, Uebernahme und ui-Nachrechnung: was vom Teilsummen-
// Budget uebrig ist (gezaehlt ab Start der Teilsummen), hoechstens bis zur
// Tauschfrist und zur harten Grenze; capMs = Obergrenze des Baus (Vollaufbau:
// Laufzeit-Alarm minus Reserve).
export function maskDeadlineMs({ aggStartMs, t0Ms, budgetS, capMs = null }) {
  return Math.min(aggStartMs + budgetS * 1000, nextUtc(t0Ms, AGG_SWAP_UTC), maskHardMs({ t0Ms, capMs }));
}

// Frist fuer das Nachziehen gedeckter Tage (neue Partien): harte Grenze —
// sonst muesste der Tag seine Deckung verlieren.
export const maskHardMs = ({ t0Ms, capMs = null }) => Math.min(t0Ms + AGG_HARD_S * 1000, capMs ?? Infinity);

// ─── Rechenweg-Kennung ─────────────────────────────────────────────────────

// Stand der Masken-SQL ausserhalb von maskSql/maskFpSql/maskTablesDdl.
// Erhoehen, wenn sich am Bau etwas aendert, das die gespeicherten Masken
// betrifft: dann verwirft der naechste Lauf alle Masken. Der Stolperdraht in
// explorer-mask.test.mjs erinnert daran.
export const MASK_REV = 0;

const SIG_NAMES = { b: 'B', u: 'U', t: 'T', uk: 'K', compList: 'C' };
export const MASK_SIG = crypto.createHash('sha1')
  .update([
    ...maskTablesDdl('O'),
    ...MASK_DATA_TABLES.map((t) => maskSql(t, SIG_NAMES)),
    ...Object.values(maskFpSql(SIG_NAMES)),
  ].join('\n') + (MASK_REV ? `\nrev ${MASK_REV}` : ''))
  .digest('hex').slice(0, 16);
