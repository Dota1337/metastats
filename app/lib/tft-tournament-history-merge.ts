// Turnierhistorie zusammenfuehren — reine Funktion ohne Datenbank-Import,
// damit sie ohne Supabase testbar ist (architect 2026-10-05).
//
// Zwei Lesarten, je nachdem, was in tft_pro_players.tournament_results steht:
//
// 1. Neue Liste (Eintraege mit src:'results', geschrieben von
//    `enrich-tft-pro-history.mjs --history` aus Liquipedia <Spieler>/Results):
//    - Die Liste ist die Hauptquelle (D10). Eine Tabellenzeile aus
//      tft_tournament_results kommt nur dazu, wenn ihr Turnier in der Liste
//      fehlt UND nach (Lesezeitpunkt - 14 Tage) endete — also neuer ist, als
//      die Liste sein kann.
//    - Siege (D9-B): Liste nur bei genau "1st"; Tabellenzeilen bei Platz 1 ohne
//      geteilten Bereich (placement_max leer oder 1).
//    - Tier (D11-B): Text der Liste ("Misc" ist schon beim Lesen leer);
//      nur ergaenzte Tabellenzeilen zeigen unseren Tier.
//    - Preisgeld (D8-B): Liquipedia-Gesamtsumme (beim Lesen frisch geholt)
//      plus ergaenzte bezahlte Tabellenzeilen. Ohne Gesamtsumme die
//      Listensumme. Nie 0 — dann null.
//
// 2. Alte Liste (ohne src) oder keine: bisherige Zusammenfuehrung —
//    Tabellenzeilen schlagen Listeneintraege derselben Seite. Nur die
//    Sieg-Regel gilt auch hier: geteilte 1. Plaetze zaehlen nicht (D9-B).
//
// Sonderpreise (tft_tournament_awards, 0087 — Bounty, MVP …) haengen als
// bonusUsd am Eintrag desselben Turniers; ohne Eintrag als eigene Zeile ohne
// Platz. Die Liquipedia-Gesamtsumme enthaelt sie schon und bleibt unveraendert;
// gezaehlt werden sie nur dort, wo auch der Platz-Betrag dazugezaehlt wird.

export interface PlayerTournamentEntry {
  tournament: string;
  date: string | null;
  /** Platz als Anzeige: "1", "5–8". */
  place: string | null;
  /** Bester Platz der Spanne — fuer die Farbe. */
  placeMin: number | null;
  /** Schlechtester Platz bei geteilten Plaetzen, sonst null. */
  placeMax: number | null;
  /** Zaehlt als Turniersieg. */
  win: boolean;
  prizeUsd: number | null;
  prizeNative: number | null;
  prizeCurrency: string | null;
  /** Sonderpreise desselben Turniers in USD, getrennt vom Platz-Betrag. */
  bonusUsd: number | null;
  tier: string | null;
  /** Interne Turnierseite, wenn wir das Turnier haben; sonst Liquipedia. */
  href: string | null;
  internal: boolean;
}

export interface PlayerTournamentHistory {
  entries: PlayerTournamentEntry[];
  wins: number;
  earningsUsd: number | null;
}

export interface JsonResult {
  tournament?: string;
  date?: string | null;
  place?: string | null;
  placement?: number | null;
  placement_max?: number | null;
  win?: boolean;
  prize_usd?: number | null;
  tier?: string | null;
  title?: string | null;
  page?: string | null;
  src?: string;
  read_at?: string | null;
}

export interface ResultRow {
  tournament_id: string;
  placement: number;
  placement_max?: number | null;
  pro_name: string;
  prize_usd: number | null;
  prize_native: number | null;
  prize_currency: string | null;
}

export interface AwardRow {
  tournament_id: string;
  award: string;
  pro_name: string;
  place_name?: string | null;
  prize_usd: number | null;
}

export interface TourInfo {
  name: string;
  tier: string | null;
  start_date: string | null;
  end_date: string | null;
  liquipedia_page: string;
}

export const LIST_GRACE_DAYS = 14;

/** Liquipedia-Seitenname vergleichbar machen: Praefix weg, dekodiert, Leerzeichen → _. */
export function normalizeLiquipediaPage(p: string | null | undefined): string | null {
  if (!p) return null;
  let s = String(p).replace(/^https?:\/\/liquipedia\.net\/(tft|teamfighttactics)\//i, '');
  try { s = decodeURIComponent(s); } catch { /* Rohwert behalten */ }
  return s.replace(/ /g, '_').replace(/\/+$/, '').toLowerCase();
}

/** "5th-8th" → { place: "5–8", min: 5 }, "1st" → { "1", 1 }. */
export function parsePlace(raw: string | null | undefined): { place: string | null; min: number | null } {
  if (!raw) return { place: null, min: null };
  const nums = String(raw).match(/\d+/g);
  if (!nums) return { place: String(raw), min: null };
  const a = parseInt(nums[0], 10);
  const b = nums[1] ? parseInt(nums[1], 10) : null;
  return { place: b && b !== a ? `${a}–${b}` : String(a), min: a };
}

export function tierLabel(t: string | null): string | null {
  if (!t) return null;
  return /^[SABC]$/.test(t) ? `${t}-Tier` : t;
}

function placeLabel(min: number, max: number | null | undefined): string {
  return max && max > min ? `${min}–${max}` : String(min);
}

function positive(n: number | null | undefined): number | null {
  return typeof n === 'number' && n > 0 ? n : null;
}

function daysBefore(iso: string, days: number): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t - days * 86_400_000).toISOString().slice(0, 10);
}

function tableEntry(r: ResultRow, t: TourInfo): PlayerTournamentEntry {
  const max = r.placement_max ?? null;
  return {
    tournament: t.name,
    date: t.end_date || t.start_date,
    place: placeLabel(r.placement, max),
    placeMin: r.placement,
    placeMax: max && max > r.placement ? max : null,
    win: r.placement === 1 && (max == null || max === 1),
    prizeUsd: r.prize_usd,
    prizeNative: r.prize_native,
    prizeCurrency: r.prize_currency,
    bonusUsd: null,
    tier: tierLabel(t.tier),
    href: `/tft/tournaments/${r.tournament_id}`,
    internal: true,
  };
}

/** Sonderpreis ohne eigenen Platz-Eintrag. */
function bonusOnlyEntry(tid: string, t: TourInfo, bonusUsd: number): PlayerTournamentEntry {
  return {
    tournament: t.name,
    date: t.end_date || t.start_date,
    place: null,
    placeMin: null,
    placeMax: null,
    win: false,
    prizeUsd: null,
    prizeNative: null,
    prizeCurrency: null,
    bonusUsd,
    tier: tierLabel(t.tier),
    href: `/tft/tournaments/${tid}`,
    internal: true,
  };
}

/** Bonus je Turnier genau einmal vergeben — am ersten Eintrag, der danach fragt. */
function bonusPool(bonus: Map<string, number>) {
  const left = new Map(bonus);
  return {
    left,
    take(tid: string | null | undefined): number | null {
      if (!tid) return null;
      const b = left.get(tid);
      if (b == null) return null;
      left.delete(tid);
      return b;
    },
  };
}

function tidByPage(tours: Map<string, TourInfo>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, t] of tours) {
    const page = normalizeLiquipediaPage(t.liquipedia_page);
    if (page && !out.has(page)) out.set(page, id);
  }
  return out;
}

function finish(entries: PlayerTournamentEntry[], wins: number, earningsUsd: number | null): PlayerTournamentHistory {
  entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { entries, wins, earningsUsd };
}

export function mergeTournamentHistory(input: {
  json: JsonResult[] | null | undefined;
  totalEarningsUsd: number | null | undefined;
  rows: ResultRow[];
  tours: Map<string, TourInfo>;
  awards?: AwardRow[];
}): PlayerTournamentHistory {
  const json = Array.isArray(input.json) ? input.json : [];
  const rows = input.rows.filter(r => input.tours.has(r.tournament_id));
  const bonus = new Map<string, number>();
  for (const a of input.awards || []) {
    const usd = positive(a.prize_usd);
    if (usd == null || !input.tours.has(a.tournament_id)) continue;
    bonus.set(a.tournament_id, (bonus.get(a.tournament_id) || 0) + usd);
  }
  const listMode = json.some(j => j && j.src === 'results');
  return listMode
    ? mergeWithList(json.filter(j => j && j.src === 'results'), input.totalEarningsUsd, rows, input.tours, bonus)
    : mergeLegacy(json, input.totalEarningsUsd, rows, input.tours, bonus);
}

function mergeWithList(
  json: JsonResult[], totalEarningsUsd: number | null | undefined, rows: ResultRow[], tours: Map<string, TourInfo>,
  bonus: Map<string, number>,
): PlayerTournamentHistory {
  // Tabellenzeilen nach Seite — fuer den internen Link und als Preis-Ersatz,
  // wenn die Liste keinen Betrag hat (Landeswaehrung).
  const rowsByPage = new Map<string, ResultRow[]>();
  for (const r of rows) {
    const page = normalizeLiquipediaPage(tours.get(r.tournament_id)!.liquipedia_page);
    if (!page) continue;
    const list = rowsByPage.get(page) || [];
    list.push(r);
    rowsByPage.set(page, list);
  }

  const entries: PlayerTournamentEntry[] = [];
  const listPages = new Set<string>();
  const pageTid = tidByPage(tours);
  const pool = bonusPool(bonus);
  let wins = 0;
  let listSum = 0;
  let listBonus = 0;
  let readAt: string | null = null;
  for (const j of json) {
    if (j.read_at && (!readAt || j.read_at > readAt)) readAt = j.read_at;
    const page = normalizeLiquipediaPage(j.title || j.page);
    if (page) listPages.add(page);
    const min = typeof j.placement === 'number' ? j.placement : parsePlace(j.place).min;
    const max = typeof j.placement_max === 'number' && min != null && j.placement_max > min ? j.placement_max : null;
    const same = page ? rowsByPage.get(page) || [] : [];
    const match = same.length === 1 && same[0].placement === min ? same[0] : null;
    let prizeUsd = positive(j.prize_usd);
    let prizeNative: number | null = null;
    let prizeCurrency: string | null = null;
    if (prizeUsd == null && match) {
      prizeUsd = positive(match.prize_usd);
      if (prizeUsd == null) { prizeNative = positive(match.prize_native); prizeCurrency = prizeNative ? match.prize_currency : null; }
    }
    const win = j.win === true;
    if (win) wins++;
    listSum += positive(j.prize_usd) ?? 0;
    const bonusUsd = pool.take(same[0]?.tournament_id ?? (page ? pageTid.get(page) : null));
    listBonus += bonusUsd ?? 0;
    entries.push({
      tournament: j.tournament || '—',
      date: j.date || null,
      place: min != null ? placeLabel(min, max) : parsePlace(j.place).place,
      placeMin: min,
      placeMax: max,
      win,
      prizeUsd,
      prizeNative,
      prizeCurrency,
      bonusUsd,
      tier: j.tier || null,
      href: same.length ? `/tft/tournaments/${same[0].tournament_id}` : j.page || null,
      internal: same.length > 0,
    });
  }

  // Neuere Tabellenzeilen ergaenzen (D10). Ohne Lesezeitpunkt nichts
  // ergaenzen — sonst kaemen alle alten Zeilen doppelt dazu.
  const cutoff = readAt ? daysBefore(readAt, LIST_GRACE_DAYS) : null;
  let addedSum = 0;
  if (cutoff) {
    for (const r of rows) {
      const t = tours.get(r.tournament_id)!;
      const page = normalizeLiquipediaPage(t.liquipedia_page);
      if (page && listPages.has(page)) continue;
      const end = t.end_date || t.start_date;
      if (!end || end < cutoff) continue;
      const e = tableEntry(r, t);
      e.bonusUsd = pool.take(r.tournament_id);
      if (e.win) wins++;
      addedSum += (positive(r.prize_usd) ?? 0) + (e.bonusUsd ?? 0);
      entries.push(e);
    }
  }

  // Sonderpreise ohne Platz-Eintrag. Die Liste fuehrt sie nie (0 von 14.353
  // Eintraegen), deshalb auch ohne Lesezeitpunkt zeigen; zur Summe zaehlen
  // sie wie ein Listeneintrag, ausser das Turnier ist neuer als die Liste.
  for (const [tid, b] of pool.left) {
    const t = tours.get(tid)!;
    const page = normalizeLiquipediaPage(t.liquipedia_page);
    if (page && listPages.has(page)) continue;
    const end = t.end_date || t.start_date;
    if (cutoff && end && end >= cutoff) addedSum += b;
    else listBonus += b;
    entries.push(bonusOnlyEntry(tid, t, b));
  }

  const total = positive(totalEarningsUsd);
  const listTotal = listSum + listBonus;
  const base = total ?? (listTotal > 0 ? listTotal : null);
  const earningsUsd = base != null ? base + addedSum : addedSum > 0 ? addedSum : null;
  return finish(entries, wins, earningsUsd);
}

function mergeLegacy(
  json: JsonResult[], totalEarningsUsd: number | null | undefined, rows: ResultRow[], tours: Map<string, TourInfo>,
  bonus: Map<string, number>,
): PlayerTournamentHistory {
  const entries: PlayerTournamentEntry[] = [];
  const tablePages = new Set<string>();
  const pageTid = tidByPage(tours);
  const pool = bonusPool(bonus);
  for (const r of rows) {
    const t = tours.get(r.tournament_id)!;
    const page = normalizeLiquipediaPage(t.liquipedia_page);
    if (page) tablePages.add(page);
    const e = tableEntry(r, t);
    e.bonusUsd = pool.take(r.tournament_id);
    entries.push(e);
  }
  for (const j of json) {
    const page = normalizeLiquipediaPage(j.page);
    if (page && tablePages.has(page)) continue;
    const p = parsePlace(j.place);
    const nums = String(j.place || '').match(/\d+/g) || [];
    const max = nums[1] ? parseInt(nums[1], 10) : null;
    entries.push({
      tournament: j.tournament || '—',
      date: j.date || null,
      place: p.place,
      placeMin: p.min,
      placeMax: max && p.min != null && max > p.min ? max : null,
      win: p.min === 1 && (max == null || max === 1),
      prizeUsd: positive(j.prize_usd),
      prizeNative: null,
      prizeCurrency: null,
      bonusUsd: pool.take(page ? pageTid.get(page) : null),
      tier: j.tier || null,
      href: j.page || null,
      internal: false,
    });
  }
  for (const [tid, b] of pool.left) entries.push(bonusOnlyEntry(tid, tours.get(tid)!, b));
  // Sieg nur bei ungeteiltem 1. Platz (D9-B)
  const wins = entries.filter(e => e.win).length;
  const summed = entries.reduce((s, e) => s + (e.prizeUsd || 0) + (e.bonusUsd || 0), 0);
  const proTotal = positive(totalEarningsUsd);
  const earningsUsd = proTotal ? Math.max(proTotal, summed) : summed > 0 ? summed : null;
  return finish(entries, wins, earningsUsd);
}
