// Brett-Zaehler des Explorers (Paket B, Plan .claude/plan-current.md
// „Entscheidungen Paket B+C"). EINE Quelle fuer die Regeln: der Bau
// (scripts/build-explorer-store.mjs) rechnet daraus je Brett die Spalten in
// boards, die JS-Fassung boardCounts ist das Gegenstueck fuer den Test und
// die Gegenrechnung an echten Rohzeilen (scripts/oneoff/explorer-counts-check.mjs).
//
// Regeln wie im MetaTFT-Explorer, gemessen 18.10.2026 an deren Brettern
// (recent_matches je Zaehlwert) und an unseren Rohzeilen:
//   Items: jedes Roh-Item zaehlt nach seiner eigenen Klasse, auch die beiden
//     Items, die Diebeshandschuhe erzeugen (MetaTFT zaehlt sie mit:
//     Radiant-Handschuh-Bretter haben radiant_count 3). Emblem/Radiant/
//     Artefakt per Namensteil; „normal" = keine dieser Klassen, kein Bauteil,
//     kein Trank (Radiant-Traenke sind Radiant).
//     ACHTUNG: Die Itemsorte an einer Unit-Kopie (Paket A, ITEM_KIND_RE in
//     explorer-query.mjs) laesst Augment- und Phantom-Embleme weg; der
//     Brett-Zaehler hier zaehlt sie mit (MetaTFT emblem_count). Zwei Begriffe,
//     bewusst getrennt.
//   Units: 3★/4★ = Kopien mit Stern 3/4; doppelte = Units mit ≥ 2 Kopien;
//     Kosten k = Kopien mit Bundle-Kosten k (Alias-Kennungen wie ihre Quelle).
//   Traits: Bronze = style 1 und aktiv (Riots Match-Zaehlung; Bronze ist dort
//     wie im Bundle 1, die anderen Stufen nicht — app/lib/tft-trait-style.ts);
//     Traits = aktive Traits (fuer „keine
//     Traits"); +1 Traits = Summe ueber ALLE Trait-Zeilen (auch inaktive) von
//     max(0, num_units − eigene verschiedene Units mit dem Trait), minus 1 je
//     Form-Unit (Lux), deren Form-Trait so ein Plus hat — die gewaehlte Form
//     zaehlt Riot in num_units, das Bundle fuehrt sie nicht als eigenen Trait.
//   Tags: Brett traegt ein Item der Liste (Roh-Items, auch Radiant-Formen).
//
// Aendert sich eine Regel, aendert sich COUNTS_HASH → der Bau baut voll
// (hashes.counts in decideMode). Listen aus dem Bundle (Kosten, Eigen-Traits,
// Radiant-Formen der Tags) haengen NICHT am Hash: ein neues Bundle gilt fuer
// neue Bretter, der Wochen-Vollaufbau zieht die alten nach.

import crypto from 'node:crypto';

const ID_RE = /^[A-Za-z0-9_]{1,64}$/;

export const COUNTS_REV = 1;

// Namensteile je Klasse: has = enthaelt, end = endet auf.
export const ITEM_CLASS_RULES = {
  emblem: { has: 'Emblem' },
  radiant: { has: 'Radiant' },
  artifact: { has: '_Artifact_' },
  component: { has: '_Component_' },
  potion: { end: 'Potion18' },
};

// Tag → Grund-Items; dazu deren Radiant-Formen (`…Radiant`, `…_Radiant`) aus dem Bundle.
export const TAG_BASES = {
  shred: ['DA_VoidStaff', 'DA_IonicSpark', 'DA_Artifact_BlightingJewel'],
  sunder: ['DA_LastWhisper', 'DA_Evenshroud'],
  wound: ['DA_RedBuff', 'DA_Morellonomicon', 'DA_Artifact_Mittens', 'DA_SunfireCape'],
};
export const TAGS = Object.keys(TAG_BASES);
export const TAG_BITS = Object.fromEntries(TAGS.map((t, i) => [t, 1 << i]));

// Spalten in boards (alle UTINYINT, nie NULL). Schluessel = Name in Anfrage und URL.
export const COUNT_COLS = {
  emb: 'c_emb', rad: 'c_rad', art: 'c_art', norm: 'c_norm',
  s3: 'c_s3', s4: 'c_s4', dup: 'c_dup',
  k1: 'c_k1', k2: 'c_k2', k3: 'c_k3', k4: 'c_k4', k5: 'c_k5',
  bronze: 'c_bronze', extra: 'c_extra', tr: 'c_tr',
};
export const COUNT_KEYS = Object.keys(COUNT_COLS);
// Obergrenze der Spanne in Anfrage und Oberflaeche; hoeher = „und mehr".
export const COUNT_MAX = 15;

export const COUNTS_HASH = crypto.createHash('sha1')
  .update(JSON.stringify({ rev: COUNTS_REV, ITEM_CLASS_RULES, TAG_BASES, COUNT_COLS }))
  .digest('hex').slice(0, 16);

// ─── Regeln in JS ──────────────────────────────────────────────────────────

const ruleJs = (r) => (s) => (r.has ? s.includes(r.has) : s.endsWith(r.end));
const IS = Object.fromEntries(Object.entries(ITEM_CLASS_RULES).map(([k, r]) => [k, ruleJs(r)]));

// Klasse eines Roh-Items fuer die Zaehler. Ein Item kann mehreren angehoeren
// (Radiant-Artefakt); „normal" nur ohne jede.
export function itemClasses(id) {
  const s = String(id ?? '');
  const c = { emblem: IS.emblem(s), radiant: IS.radiant(s), artifact: IS.artifact(s) };
  c.normal = !c.emblem && !c.radiant && !c.artifact && !IS.component(s) && !IS.potion(s);
  return c;
}

// Listen aus dem Bundle (public/tft-assets-<set>.json).
export function countsLists(bundle) {
  const champs = bundle?.champions || {};
  const ids = Object.keys(champs).filter(id => ID_RE.test(id)).sort();
  const aliases = ids.filter(id => typeof champs[id]?.aliasOf === 'string' && ID_RE.test(champs[id].aliasOf))
    .map(id => [id, champs[id].aliasOf]);
  const res = (id) => champs[id]?.aliasOf ?? id;
  const nameToApi = new Map(Object.entries(bundle?.traits || {}).map(([k, v]) => [v?.name, k]));
  const nativeOf = (id) => [...new Set((champs[res(id)]?.traits || []).map(n => nameToApi.get(n)).filter(t => t && ID_RE.test(t)))].sort();
  const native = Object.fromEntries(ids.map(id => [id, nativeOf(id)]).filter(([, t]) => t.length));
  const costIds = Object.fromEntries([1, 2, 3, 4, 5].map(k => [k, ids.filter(id => champs[res(id)]?.cost === k)]));
  // Form-Units: „Lux" mit Formen „Lux (Coven)" … — Form-Traits = was die Formen
  // haben und die Basis nicht.
  const forms = [];
  for (const b of ids) {
    const name = champs[b]?.name;
    if (!name) continue;
    const fs = ids.filter(f => f !== b && String(champs[f]?.name || '').startsWith(`${name} (`));
    if (!fs.length) continue;
    const own = new Set(nativeOf(b));
    const traits = [...new Set(fs.flatMap(nativeOf))].filter(t => !own.has(t)).sort();
    if (traits.length) forms.push({ base: b, traits });
  }
  const itemIds = Object.keys(bundle?.items || {});
  const tags = Object.fromEntries(TAGS.map(t => [t, [...new Set(itemIds.filter(i => ID_RE.test(i)
    && TAG_BASES[t].some(b => i === b || i === `${b}Radiant` || i === `${b}_Radiant`)))].sort()]));
  for (const t of TAGS) for (const b of TAG_BASES[t]) if (!tags[t].includes(b)) tags[t].push(b);
  return { aliases, native, costIds, forms, tags };
}

// Gegenstueck in JS: Rohzeilen wie im Postgres-Satz (units: [{characterId,
// tier, items}], traits: [{name, style, num_units, tier_current}]).
export function boardCounts(units, traits, L) {
  const us = Array.isArray(units) ? units.filter(u => u && u.characterId != null) : [];
  const ts = Array.isArray(traits) ? traits.filter(Boolean) : [];
  const alias = new Map(L.aliases);
  const res = (id) => alias.get(id) ?? id;
  const items = us.flatMap(u => (Array.isArray(u.items) ? u.items : [])).filter(x => x != null).map(String);
  const cls = items.map(itemClasses);
  const out = Object.fromEntries(COUNT_KEYS.map(k => [k, 0]));
  out.emb = cls.filter(c => c.emblem).length;
  out.rad = cls.filter(c => c.radiant).length;
  out.art = cls.filter(c => c.artifact).length;
  out.norm = cls.filter(c => c.normal).length;
  out.s3 = us.filter(u => u.tier === 3).length;
  out.s4 = us.filter(u => u.tier === 4).length;
  const copies = new Map();
  for (const u of us) { const id = res(String(u.characterId)); copies.set(id, (copies.get(id) ?? 0) + 1); }
  out.dup = [...copies.values()].filter(n => n >= 2).length;
  for (const k of [1, 2, 3, 4, 5]) {
    const set = new Set(L.costIds[k]);
    out[`k${k}`] = us.filter(u => set.has(String(u.characterId))).length;
  }
  out.bronze = ts.filter(t => t.style === 1 && t.tier_current > 0).length;
  out.tr = ts.filter(t => t.tier_current > 0 && t.num_units > 0).length;
  const nat = new Map();
  for (const id of copies.keys()) for (const t of L.native[id] || []) nat.set(t, (nat.get(t) ?? 0) + 1);
  const d = ts.map(t => (Number(t.num_units) || 0) - (nat.get(t.name) ?? 0));
  let extra = d.reduce((a, x) => a + Math.max(0, x), 0);
  for (const f of L.forms) {
    if (!copies.has(f.base)) continue;
    if (ts.some((t, i) => f.traits.includes(t.name) && d[i] >= 1)) extra -= 1;
  }
  out.extra = extra;
  out.tags = TAGS.reduce((m, t) => (items.some(x => L.tags[t].includes(x)) ? m | TAG_BITS[t] : m), 0);
  return out;
}

// ─── SQL ───────────────────────────────────────────────────────────────────

const lit = (s) => {
  if (!ID_RE.test(s)) throw new Error(`Kennung ungueltig: ${s}`);
  return `'${s}'`;
};
const strList = (l) => (l.length ? `[${l.map(lit).join(', ')}]::VARCHAR[]` : '[]::VARCHAR[]');
// hash('…') faltet DuckDB beim Binden zur Konstante; die Zahlen haengen an der
// DuckDB-Version, deshalb nie gespeichert, nur innerhalb einer Anweisung verglichen.
const hashList = (l) => (l.length ? `[${l.map(s => `hash(${lit(s)})`).join(', ')}]::UBIGINT[]` : '[]::UBIGINT[]');
const ruleSql = (r, x) => (r.has ? `contains(${x}, '${r.has}')` : `suffix(${x}, '${r.end}')`);
const R = ITEM_CLASS_RULES;

// Typen fuer from_json: dieselben Felder, die nu/nt bisher per ->> lasen.
export const UNITS_JSON_TYPE = `'[{"tier":"UTINYINT","items":["VARCHAR"],"characterId":"VARCHAR"}]'`;
export const TRAITS_JSON_TYPE = `'[{"name":"VARCHAR","style":"UTINYINT","num_units":"UTINYINT","tier_current":"UTINYINT"}]'`;

// Unit-Kennung mit Alias-Umschreibung (wie nu.unit).
export function unitIdSql(x, aliases) {
  return aliases.length
    ? `CASE ${x} ${aliases.map(([id, src]) => `WHEN ${lit(id)} THEN ${lit(src)}`).join(' ')} ELSE ${x} END`
    : x;
}

// SELECT ueber src (Spalten ul, tl = typisierte Listen) mit allen Spalten von
// src plus den Zaehlern. Hilfsspalten heissen cx_* und fallen am Ende weg.
export function countsSelectSql(src, L) {
  const maxNat = Math.max(1, ...Object.values(L.native).map(t => t.length));
  const natIds = Object.keys(L.native).sort();
  const NH = hashList(natIds);
  const NT = Array.from({ length: maxNat }, (_, j) =>
    `[${natIds.map(id => (L.native[id][j] ? `hash(${lit(L.native[id][j])})` : 'NULL')).join(', ')}]::UBIGINT[]`);
  const formFlags = L.forms.map((f, j) => `f${j}: list_contains(${hashList(f.traits)}, hash(x.name))`);
  const tl2 = `list_transform(tl, x -> {h: hash(x.name), n: coalesce(x.num_units, 0)::INTEGER${formFlags.map(s => `, ${s}`).join('')}})`;
  const tl3 = `list_transform(cx_tl2, x -> {d: x.n - len(list_filter(cx_natl, m -> m = x.h))${L.forms.map((_, j) => `, f${j}: x.f${j}`).join('')}})`;
  const lux = L.forms.map((f, j) => `(list_contains(cx_dh, hash(${lit(f.base)}))
      AND coalesce(list_bool_or(list_transform(cx_tl3, y -> y.f${j} AND y.d >= 1)), false))::INTEGER`);
  const itemsAll = 'cx_its';
  const cols = {
    emb: `len(list_filter(${itemsAll}, x -> ${ruleSql(R.emblem, 'x')}))`,
    rad: `len(list_filter(${itemsAll}, x -> ${ruleSql(R.radiant, 'x')}))`,
    art: `len(list_filter(${itemsAll}, x -> ${ruleSql(R.artifact, 'x')}))`,
    norm: `len(list_filter(${itemsAll}, x -> NOT (${['emblem', 'radiant', 'artifact', 'component', 'potion'].map(k => ruleSql(R[k], 'x')).join(' OR ')})))`,
    s3: 'len(list_filter(cx_ul, u -> u.tier = 3))',
    s4: 'len(list_filter(cx_ul, u -> u.tier = 4))',
    dup: 'len(list_filter(range(2, len(cx_shs) + 1), i -> cx_shs[i] = cx_shs[i - 1] AND (i = 2 OR cx_shs[i - 1] <> cx_shs[i - 2])))',
    ...Object.fromEntries([1, 2, 3, 4, 5].map(k => [`k${k}`, `len(list_filter(cx_raw, h -> list_contains(${hashList(L.costIds[k])}, h)))`])),
    bronze: 'len(list_filter(tl, x -> x.style = 1 AND x.tier_current > 0))',
    tr: 'len(list_filter(tl, x -> x.tier_current > 0 AND x.num_units > 0))',
    extra: `coalesce(list_sum(list_transform(cx_tl3, y -> greatest(0, y.d))), 0)${lux.map(s => ` - ${s}`).join('')}`,
  };
  const tags = `(${TAGS.map(t => `(list_has_any(${itemsAll}, ${strList(L.tags[t])})::INTEGER << ${Math.log2(TAG_BITS[t])})`).join(' | ')})`;
  const out = [
    ...COUNT_KEYS.map(k => `coalesce((${cols[k]}), 0)::UTINYINT AS ${COUNT_COLS[k]}`),
    `coalesce(${tags}, 0)::UTINYINT AS tags`,
  ];
  const pl = 'list_transform(cx_dh, h -> list_position(' + NH + ', h))';
  const natl = `list_filter(flatten([${NT.map(nt => `list_transform(cx_pl, p -> (${nt})[p])`).join(', ')}]), m -> m IS NOT NULL)`;
  return `SELECT * EXCLUDE (cx_ul, cx_its, cx_raw, cx_uh, cx_shs, cx_dh, cx_pl, cx_natl, cx_tl2, cx_tl3),
    ${out.join(',\n    ')}
  FROM (SELECT *, ${tl3} AS cx_tl3 FROM (
    SELECT *, ${natl} AS cx_natl, ${tl2} AS cx_tl2 FROM (
      SELECT *, ${pl} AS cx_pl FROM (
        SELECT *, list_sort(cx_uh) AS cx_shs, list_distinct(cx_uh) AS cx_dh FROM (
          SELECT *,
            list_filter(flatten(list_transform(cx_ul, u -> coalesce(u.items, []::VARCHAR[]))), x -> x IS NOT NULL) AS cx_its,
            list_transform(cx_ul, u -> hash(u.characterId)) AS cx_raw,
            list_transform(cx_ul, u -> hash(${unitIdSql('u.characterId', L.aliases)})) AS cx_uh
          FROM (SELECT *, list_filter(ul, u -> u.characterId IS NOT NULL) AS cx_ul FROM ${src}))))))`;
}

// Build-Schluessel einer Kopie: Items ohne Bauteile, sortiert, mit '|'
// verbunden; NULL ohne Item. Gleich der Liste, die der Items-Reiter mit
// Traeger je Anfrage rechnet (keySql: list_sort(list_filter([i1, i2, i3] …))),
// nur ohne Listen-Funktionen (Stichprobe 18.10.: 4,2 statt 8,5 s, 0 Abweichungen
// bei 1,64 Mio Kopien). '~' sortiert hinter jede Kennung (ID_RE).
export function buildKeySql(i1, i2, i3, compList) {
  const k = (x) => `CASE WHEN ${x} IS NULL OR list_contains(${compList}, ${x}) THEN '~' ELSE ${x} END`;
  const a = k(i1), b = k(i2), c = k(i3);
  return `nullif(concat_ws('|', nullif(least(${a}, ${b}, ${c}), '~'),
    nullif(greatest(least(${a}, ${b}), least(greatest(${a}, ${b}), ${c})), '~'), nullif(greatest(${a}, ${b}, ${c}), '~')), '')`;
}

// JS-Gegenstueck zu buildKeySql.
export function buildKeyJs(items, components) {
  const comp = new Set(components);
  const kept = (items || []).slice(0, 3).filter(x => x != null && !comp.has(x)).map(String).sort();
  return kept.length ? kept.join('|') : null;
}
