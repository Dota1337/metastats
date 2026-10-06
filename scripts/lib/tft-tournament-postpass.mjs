// Nachlaeufe des Turnier-Crawlers (2026-09-28). Laufen am Ende jedes Crawls
// und einzeln mit `node scripts/crawl-tft-tournaments.mjs --post-only`
// (Liquipedia ist dafuer nicht noetig).
//
// 1. reconvertStored — gespeicherte Zeilen mit Landesbetrag, aber ohne
//    endgueltigen Dollarwert, neu umrechnen (neue Kursquellen TWD/VND/RUB,
//    vorlaeufige Kurse nach Turnierende ersetzen).
// 2. rebuildPlayerLinks — Ergebniszeile (Turnier + Name) → Riot-Konto.
//    Regeln (data-skeptic 2026-09-28): erlaubte Server aus dem Land der Zeile,
//    sonst aus den anderen Zeilen desselben Namens (nur wenn eindeutig), sonst
//    aus dem Seitenpfad. China und Seiten ohne Region: keine Zuordnung. Der Name
//    muss auf den erlaubten Servern genau EIN Konto haben, und das muss Master+
//    sein. pro_puuid bleibt unberuehrt — die Zuordnung liegt in eigener Tabelle.
//    Vorher (D5, 2026-10-05): Namen mit Team-Kuerzel ("HR Loescher") gehen an
//    den Pro "Loescher", wenn genau EIN Pro mit Konto so heisst (Name oder
//    Liquipedia-Seite) — method 'team-prefix-pro'. Gleichnamige Pros (zwei
//    "Tropical") werden nie automatisch verknuepft.
//    Alte Verknuepfungen: nur verwaiste (Ergebniszeile weg) werden geloescht,
//    jede einzeln im Log; die uebrigen bleiben stehen und kommen als Pruefliste
//    ins Log, statt still zu verschwinden.

import { getUsdRate } from './fx-rates.mjs';

const EU_W = ['euw1', 'eun1'];
const EU_E = ['eun1', 'euw1'];
const MEA = ['euw1', 'eun1', 'me1'];
const NONE = [];

const COUNTRY_PLATFORMS = (() => {
  const m = {};
  const set = (codes, p) => { for (const c of codes) m[c] = p; };
  set(['fr', 'de', 'gb', 'uk', 'it', 'es', 'nl', 'be', 'at', 'ch', 'dk', 'se', 'no', 'fi', 'lu', 'eu', 'nordic',
    'pt', 'ie', 'is', 'mt', 'ad', 'mc', 'li', 'sm', 'va', 'gi', 'fo', 'je', 'gg', 'im', 'scotland', 'wales', 'england'], EU_W);
  set(['pl', 'cz', 'sk', 'hu', 'ro', 'bg', 'gr', 'hr', 'si', 'rs', 'ba', 'me', 'mk', 'al', 'xk', 'lt', 'lv', 'ee',
    'ua', 'by', 'md', 'cy', 'ge', 'am', 'az', 'kz'], EU_E);
  set(['eg', 'tn', 'sa', 'il', 'africa', 'ma', 'dz', 'ae', 'qa', 'kw', 'bh', 'om', 'jo', 'lb', 'iq', 'za', 'ng', 'ke'], MEA);
  set(['ru'], ['ru']);
  set(['tr'], ['tr1']);
  set(['us', 'ca', 'usca'], ['na1']);
  set(['br'], ['br1']);
  set(['mx', 'co', 'pe', 'ec', 'cr', 'pa', 'gt', 'jm', 'do', 've', 'hn', 'sv', 'ni', 'pr', 'latin america north'], ['la1']);
  set(['ar', 'cl', 'uy', 'bo', 'py', 'latin america south'], ['la2']);
  set(['kr'], ['kr']);
  set(['jp'], ['jp1']);
  set(['tw', 'hk', 'mo'], ['tw2']);
  set(['vn'], ['vn2']);
  set(['au', 'nz', 'nc', 'oc', 'oce', 'anz'], ['oc1']);
  set(['sg', 'my', 'ph', 'th', 'id', 'mysg', 'southeast asia', 'sea'], ['sg2']);
  set(['cn'], NONE);
  return m;
})();

// China-Abschnitte im Seitenpfad. Golden_Spatula (Americas/APAC/EMEA) und
// East_Asian_Finals (jp/kr/oce) sind KEINE China-Turniere (D5, gemessen
// 2026-10-05: gemischte Laender bzw. jp/kr/oce/au in den gespeicherten Zeilen).
const CN_SEGMENT = /^(cn|china|toc|joc|cn_qualifier)$/i;

// Seitenpfad-Abschnitte, spezifischster zuerst geprueft (letzter Abschnitt gewinnt).
const SEGMENT_PLATFORMS = [
  [CN_SEGMENT, NONE],
  [/^east_asian_finals$/i, ['kr', 'jp1', 'oc1']],
  [/^turkey$/i, ['tr1']],
  [/^north_america$/i, ['na1']],
  [/^brazil$/i, ['br1']],
  [/^latin_america$/i, ['la1', 'la2']],
  [/^lan$/i, ['la1']],
  [/^las$/i, ['la2']],
  [/^korea$/i, ['kr']],
  [/^japan$/i, ['jp1']],
  [/^(oceania|oce)$/i, ['oc1']],
  [/^sea$/i, ['sg2']],
  [/^vietnam$/i, ['vn2']],
  [/^(taiwan|tw_&_hk_series)$/i, ['tw2']],
  [/^(emea|europe)$/i, ['euw1', 'eun1', 'tr1', 'me1', 'ru']],
  [/^(amer|americas)$/i, ['na1', 'br1', 'la1', 'la2']],
  [/^apac$/i, ['kr', 'jp1', 'tw2', 'vn2', 'oc1', 'sg2']],
];

/** Server aus dem Land; null = Land sagt nichts (leer, world, in, …). */
export function platformsForCountry(country) {
  const c = String(country || '').trim().toLowerCase();
  if (!c) return null;
  return Object.prototype.hasOwnProperty.call(COUNTRY_PLATFORMS, c) ? COUNTRY_PLATFORMS[c] : null;
}

/** Server aus dem Seitenpfad; [] = keine Zuordnung (China, INT, unbekannt). */
export function platformsForPage(page) {
  const segs = String(page || '').split('/').map(s => s.replace(/ /g, '_'));
  if (segs.some(s => CN_SEGMENT.test(s) || s.split('_').some(p => CN_SEGMENT.test(p)))) return NONE;
  for (let i = segs.length - 1; i >= 0; i--) {
    // Auch Teile wie "Enchanted_Wilds_EMEA_Regional_Finals" pruefen.
    const parts = [segs[i], ...segs[i].split('_')];
    for (const part of parts) {
      for (const [re, p] of SEGMENT_PLATFORMS) if (re.test(part)) return p;
    }
  }
  return NONE;
}

export function normName(s) {
  return String(s || '').normalize('NFKC').toLowerCase().replace(/\s/g, '');
}

/** "ROC WithoutYou" → "WithoutYou" (kurzes Team-Kuerzel in Grossbuchstaben). */
export function stripTeamPrefix(name) {
  const m = String(name || '').match(/^([A-Z0-9]{2,5})\s+(\S.*)$/);
  return m ? m[2] : null;
}

/** Pros mit Konto: normName(Name) und normName(Liquipedia-Seite) → Set(puuid). */
export function buildProIndex(pros) {
  const idx = new Map();
  const add = (k, puuid) => {
    if (!k) return;
    if (!idx.has(k)) idx.set(k, new Set());
    idx.get(k).add(puuid);
  };
  for (const p of pros || []) {
    if (!p?.puuid) continue;
    add(normName(p.pro_name), p.puuid);
    add(normName(String(p.source_page || '').replace(/_/g, ' ')), p.puuid);
  }
  return idx;
}

/** "HR Loescher" → Konto des Pros "Loescher", nur wenn genau EIN Pro passt. */
export function prefixProPuuid(name, proIndex) {
  const s = stripTeamPrefix(name);
  if (!s) return null;
  const hits = proIndex.get(normName(s));
  return hits && hits.size === 1 ? [...hits][0] : null;
}

/**
 * Alte Verknuepfungen, die dieser Lauf nicht mehr setzt: verwaist (keine
 * Ergebniszeile mehr) → loeschen; sonst stehen lassen und pruefen.
 * resultKeys: Set aus `${tournament_id}|${pro_name}` aller Ergebniszeilen.
 */
export function classifyStaleLinks(existing, keepKeys, resultKeys) {
  const orphans = [], review = [];
  for (const e of existing || []) {
    const k = `${e.tournament_id}|${e.raw_name}`;
    if (keepKeys.has(k)) continue;
    (resultKeys.has(k) ? review : orphans).push(e);
  }
  return { orphans, review };
}

const MASTER_PLUS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

function sb(url, key) {
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const get = async (path, from = 0) => {
    const r = await fetch(`${url}/rest/v1/${path}`, { headers: { ...h, Range: `${from}-${from + 999}` } });
    if (!r.ok) throw new Error(`Supabase read ${path.split('?')[0]} failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };
  const all = async (path) => {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const rows = await get(path, from);
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  };
  return { h, get, all };
}

/**
 * Pass 1: Neu-Umrechnung. `upsert(table, rows, onConflict)` kommt vom Crawler
 * (respektiert --no-supabase). Liefert { tournaments, results, awards, still }.
 * Sonderpreise (tft_tournament_awards, 0087) wie die Ergebniszeilen.
 */
export async function reconvertStored({ url, key, log = console.log }) {
  const { all } = sb(url, key);
  // Trockenlauf vor der Migration: fx_source fehlt noch.
  const fxCol = DRY ? '' : ',fx_source';
  const need = 'prize_pool_currency=not.is.null&prize_pool_currency=not.in.(MIXED,USD)';
  const tours = await all(`tft_tournaments?select=id,start_date,end_date,prize_pool_native,prize_pool_currency,prize_pool_usd${fxCol}&prize_pool_native=not.is.null&${need}&order=id`);
  const tourDates = new Map();
  for (const t of await all('tft_tournaments?select=id,start_date,end_date&order=id')) {
    tourDates.set(t.id, t.end_date || t.start_date || null);
  }
  const results = await all(`tft_tournament_results?select=tournament_id,placement,pro_name,prize_native,prize_currency,prize_usd${fxCol}&prize_native=not.is.null&prize_currency=not.is.null&prize_currency=not.in.(MIXED,USD)&order=tournament_id,placement,pro_name`);
  const awards = await all('tft_tournament_awards?select=tournament_id,award,pro_name,prize_native,prize_currency,prize_usd,fx_source&prize_native=not.is.null&prize_currency=not.is.null&prize_currency=not.in.(MIXED,USD)&order=tournament_id,award,pro_name');

  const due = r => r.prize_usd == null || /provisional/.test(r.fx_source || '') || r.fx_source == null;
  const conv = async (native, cur, date) => {
    if (!date) return null;
    const fx = await getUsdRate(cur, date);
    return fx ? { usd: Math.round(Number(native) * fx.rate), rate: fx.rate, date: fx.effectiveDate, source: fx.source } : null;
  };

  const tourRows = [];
  let still = 0;
  for (const t of tours) {
    if (!due({ prize_usd: t.prize_pool_usd, fx_source: t.fx_source })) continue;
    const c = await conv(t.prize_pool_native, t.prize_pool_currency, t.end_date || t.start_date);
    if (!c) { still++; continue; }
    tourRows.push({ id: t.id, prize_pool_usd: c.usd, fx_rate: c.rate, fx_date: c.date, fx_source: c.source });
  }
  const resRows = [];
  for (const r of results) {
    if (!due(r)) continue;
    const c = await conv(r.prize_native, r.prize_currency, tourDates.get(r.tournament_id));
    if (!c) { still++; continue; }
    resRows.push({
      tournament_id: r.tournament_id, placement: r.placement, pro_name: r.pro_name,
      prize_usd: c.usd, fx_rate: c.rate, fx_date: c.date, fx_source: c.source,
    });
  }
  const awardRows = [];
  for (const r of awards) {
    if (!due(r)) continue;
    const c = await conv(r.prize_native, r.prize_currency, tourDates.get(r.tournament_id));
    if (!c) { still++; continue; }
    awardRows.push({
      tournament_id: r.tournament_id, award: r.award, pro_name: r.pro_name,
      prize_usd: c.usd, fx_rate: c.rate, fx_date: c.date, fx_source: c.source,
    });
  }
  // Einzeln je Turnier, damit PATCH-artige Upserts keine Pflichtspalten verlangen:
  // id/PK + geaenderte Felder genuegen bei merge-duplicates auf bestehende Zeilen.
  for (const row of tourRows) await upsertPatch(url, key, 'tft_tournaments', `id=eq.${encodeURIComponent(row.id)}`, row);
  for (const row of resRows) {
    const f = `tournament_id=eq.${encodeURIComponent(row.tournament_id)}&placement=eq.${row.placement}&pro_name=eq.${encodeURIComponent(row.pro_name)}`;
    await upsertPatch(url, key, 'tft_tournament_results', f, row);
  }
  for (const row of awardRows) {
    const f = `tournament_id=eq.${encodeURIComponent(row.tournament_id)}&award=eq.${encodeURIComponent(row.award)}&pro_name=eq.${encodeURIComponent(row.pro_name)}`;
    await upsertPatch(url, key, 'tft_tournament_awards', f, row);
  }
  log(`  [fx-reconvert] ${tourRows.length} tournaments, ${resRows.length} results, ${awardRows.length} awards converted, ${still} still without rate/date`);
  return { tournaments: tourRows.length, results: resRows.length, awards: awardRows.length, still };
}

let DRY = false;
export function setDryRun(v) { DRY = !!v; }

async function upsertPatch(url, key, table, filter, row) {
  if (DRY) return;
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase patch ${table} failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}

async function lookupAccounts(url, key, norms) {
  const { get } = sb(url, key);
  const byNorm = new Map();
  const list = [...norms];
  for (let i = 0; i < list.length; i += 80) {
    const chunk = list.slice(i, i + 80);
    const inList = chunk.map(n => `"${n.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
    const rows = await get(`tft_player_names?select=puuid,name_norm,region,tier&name_norm=in.(${encodeURIComponent(inList)})`);
    for (const r of rows) {
      if (!byNorm.has(r.name_norm)) byNorm.set(r.name_norm, []);
      byNorm.get(r.name_norm).push(r);
    }
  }
  return byNorm;
}

/** Konto fuer einen Namen auf erlaubten Servern: genau eins, Master+. */
function pick(accounts, platforms) {
  const on = (accounts || []).filter(a => platforms.includes(a.region));
  if (on.length !== 1) return null;
  return MASTER_PLUS.has(String(on[0].tier || '').toUpperCase()) ? on[0] : null;
}

/**
 * Pass 2: Zuordnungen neu aufbauen. Erst alles lesen (Abbruch bei Lesefehler,
 * dann wird auch nichts geloescht), dann upserten, dann nur Verwaistes loeschen.
 */
export async function rebuildPlayerLinks({ url, key, upsert, log = console.log }) {
  const { all, h } = sb(url, key);
  const tours = await all('tft_tournaments?select=id,liquipedia_page&order=id');
  const pageOf = new Map(tours.map(t => [t.id, t.liquipedia_page]));
  // Sonderpreis-Zeilen (0087) mit: ihre Namen brauchen dieselbe Zuordnung und
  // duerfen nicht als verwaist gelten.
  const rows = [
    ...await all('tft_tournament_results?select=tournament_id,pro_name,country,pro_puuid&order=tournament_id,placement,pro_name'),
    ...await all('tft_tournament_awards?select=tournament_id,pro_name,country,pro_puuid&order=tournament_id,award,pro_name'),
  ];
  const pros = await all('tft_pro_players?select=id,pro_name,source_page,puuid&puuid=not.is.null&order=id');
  const proIndex = buildProIndex(pros);
  // Trockenlauf vor der Migration: Tabelle fehlt noch → leer. Scharf: Lesefehler bricht ab.
  const linkCols = 'tft_tournament_player_links?select=tournament_id,raw_name,puuid,method&order=tournament_id,raw_name';
  const existing = DRY ? await all(linkCols).catch(() => []) : await all(linkCols);

  // Land je Name aus allen Zeilen (fuer Zeilen ohne Land).
  const countriesByName = new Map();
  for (const r of rows) {
    const p = platformsForCountry(r.country);
    if (!p) continue;
    const n = normName(r.pro_name);
    if (!countriesByName.has(n)) countriesByName.set(n, new Set());
    countriesByName.get(n).add(p.slice().sort().join(','));
  }

  const candidates = [];
  const norms = new Set();
  const seen = new Set();
  for (const r of rows) {
    if (r.pro_puuid) continue;
    const k = `${r.tournament_id}|${r.pro_name}`;
    // Ein Name kann je Turnier mehrere Zeilen haben (verschiedene Plaetze,
    // z. B. mehrere Pools auf einer Seite): ein Link je Turnier+Name.
    if (seen.has(k)) continue;
    seen.add(k);
    let platforms = platformsForCountry(r.country);
    if (!platforms) {
      const sets = countriesByName.get(normName(r.pro_name));
      if (sets && sets.size === 1) platforms = [...sets][0].split(',');
    }
    if (!platforms) platforms = platformsForPage(pageOf.get(r.tournament_id));
    if (!platforms.length) continue;
    const full = normName(r.pro_name);
    const stripped = stripTeamPrefix(r.pro_name);
    const short = stripped ? normName(stripped) : null;
    candidates.push({ r, platforms, full, short });
    norms.add(full);
    if (short) norms.add(short);
  }

  const byNorm = await lookupAccounts(url, key, norms);
  const links = [];
  let prefixLinked = 0;
  for (const c of candidates) {
    const proPuuid = prefixProPuuid(c.r.pro_name, proIndex);
    if (proPuuid) {
      links.push({ tournament_id: c.r.tournament_id, raw_name: c.r.pro_name, puuid: proPuuid, method: 'team-prefix-pro' });
      prefixLinked++;
      continue;
    }
    const acc = pick(byNorm.get(c.full), c.platforms) || (c.short ? pick(byNorm.get(c.short), c.platforms) : null);
    if (!acc) continue;
    links.push({ tournament_id: c.r.tournament_id, raw_name: c.r.pro_name, puuid: acc.puuid, method: 'name-unique-master' });
  }

  for (let i = 0; i < links.length; i += 500) {
    await upsert('tft_tournament_player_links', links.slice(i, i + 500), 'tournament_id,raw_name');
  }
  const keep = new Set(links.map(l => `${l.tournament_id}|${l.raw_name}`));
  const resultKeys = new Set(rows.map(r => `${r.tournament_id}|${r.pro_name}`));
  const rowPuuid = new Map();
  for (const r of rows) if (r.pro_puuid) rowPuuid.set(`${r.tournament_id}|${r.pro_name}`, r.pro_puuid);
  const { orphans, review } = classifyStaleLinks(existing, keep, resultKeys);
  for (const e of orphans) {
    log(`  [player-links] geloescht (Ergebniszeile weg): ${e.tournament_id} | ${e.raw_name} | ${e.puuid} | ${e.method}`);
    if (DRY) continue;
    const res = await fetch(`${url}/rest/v1/tft_tournament_player_links?tournament_id=eq.${encodeURIComponent(e.tournament_id)}&raw_name=eq.${encodeURIComponent(e.raw_name)}`, {
      method: 'DELETE', headers: { ...h, Prefer: 'return=minimal' },
    });
    if (!res.ok) throw new Error(`Supabase delete link failed: HTTP ${res.status}`);
  }
  // Pruefliste: Verknuepfung bleibt stehen, die Regel setzt sie aber nicht mehr.
  for (const e of review) {
    const rp = rowPuuid.get(`${e.tournament_id}|${e.raw_name}`);
    const why = rp ? (rp === e.puuid ? 'Zeile traegt jetzt dasselbe Konto' : 'Zeile traegt jetzt ein ANDERES Konto') : 'Regel trifft nicht mehr (Konto nicht mehr eindeutig/Master+)';
    log(`  [player-links] PRUEFEN: ${e.tournament_id} | ${e.raw_name} | ${e.puuid} | ${e.method} | ${why}`);
  }
  log(`  [player-links] ${candidates.length} candidates, ${links.length} linked (${prefixLinked} team-prefix-pro), ${orphans.length} orphans removed, ${review.length} kept for review`);
  return { candidates: candidates.length, links, prefixLinked, orphans: orphans.length, review };
}
