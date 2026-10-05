// Reine Regeln fuer den Historie-Modus (enrich-tft-pro-history.mjs --history).
//
// Eigene Datei statt im Skript, weil ein Import von enrich-tft-pro-history.mjs
// ohne SUPABASE_SERVICE_ROLE_KEY sofort mit Exit 1 endet — so bleiben die
// Regeln ohne Datenbank testbar (scripts/lib/tft-pro-history.test.mjs).
//
// Plan Aufgabe B (.claude/plan-current.md):
//   D7  Auswahl: nie mit neuer Liste geholt → neuere Tabellenzeilen → aelteste,
//       mindestens 40 der 93 Plaetze fuer die aeltesten.
//   D8-B Preisgeld: Infobox frisch, wenn sich bezahlte Eintraege geaendert haben
//       oder kein Wert da ist; sonst Listensumme; nie 0.
//   D10 Liste ist Hauptquelle, Tabellenzeilen 14 Tage Kulanz.

export const HISTORY_DEFAULT_MAX = 93;
export const HISTORY_MIN_OLDEST = 40;
export const LIST_GRACE_DAYS = 14;
// Ab diesem Zeitpunkt stempelt der Historie-Modus. Ein Pro ohne neue Liste,
// der danach gestempelt wurde, hat keine Results-Seite (404) — er rotiert mit
// den aeltesten statt jede Woche vorne zu stehen.
export const HISTORY_MODE_SINCE = '2026-10-05T00:00:00.000Z';

const DAY_MS = 86_400_000;

/** Gleiche Regel wie normalizeLiquipediaPage (app/lib/tft-tournament-history-merge.ts) — Kreuztest im Test. */
export function normalizePage(p) {
  if (!p) return null;
  let s = String(p).replace(/^https?:\/\/liquipedia\.net\/(tft|teamfighttactics)\//i, '');
  try { s = decodeURIComponent(s); } catch { /* Rohwert behalten */ }
  return s.replace(/ /g, '_').replace(/\/+$/, '').toLowerCase();
}

/** Liste aus dem Historie-Modus? (alle Eintraege tragen src:'results') */
export function isResultsList(list) {
  return Array.isArray(list) && list.length > 0 && list.every(e => e && e.src === 'results');
}

function entryPage(e) {
  return normalizePage(e?.title || e?.page);
}

/** Zeilen von parseResultsHtml → gespeicherte Eintraege. */
export function buildHistoryEntries(rows, readAt) {
  return rows.map(r => ({
    tournament: r.tournament,
    date: r.date ?? null,
    place: r.placeText || null,
    placement: r.placement ?? null,
    placement_max: r.placementMax ?? null,
    win: r.win === true,
    prize_usd: typeof r.prizeUsd === 'number' && r.prizeUsd > 0 ? r.prizeUsd : null,
    tier: r.tier ?? null,
    title: r.pageTitle ?? null,
    page: r.url ?? null,
    mode: r.mode,
    team: r.team ?? null,
    partners: Array.isArray(r.partners) ? r.partners : [],
    src: 'results',
    read_at: readAt,
  }));
}

export function listPrizeSum(entries) {
  return entries.reduce((s, e) => s + (typeof e.prize_usd === 'number' && e.prize_usd > 0 ? e.prize_usd : 0), 0);
}

/**
 * Plausibel genug zum Ueberschreiben? Kopfzeile da, mindestens eine Zeile,
 * kein starker Einbruch (alte Liste >= 10 und neue unter der Haelfte).
 */
export function checkPlausible(parsed, oldCount) {
  if (!parsed || !parsed.headerFound) return { ok: false, reason: 'keine Ergebnistabelle' };
  const n = parsed.rows.length;
  if (n < 1) return { ok: false, reason: 'Tabelle leer' };
  const old = Number(oldCount) || 0;
  if (old >= 10 && n < old * 0.5) return { ok: false, reason: `Einbruch ${old} → ${n}` };
  return { ok: true, reason: null };
}

/**
 * Muss die Hauptseite (Infobox) frisch gelesen werden? (D8-B)
 * Ja, wenn: noch kein Wert gespeichert, die alte Liste nicht aus diesem Modus
 * stammt, oder ein bezahlter Eintrag neu ist bzw. seinen Betrag geaendert hat.
 */
export function needsInfobox(oldList, entries, storedTotal) {
  if (!(typeof storedTotal === 'number' && storedTotal > 0)) return true;
  if (!isResultsList(oldList)) return true;
  const key = (e) => `${entryPage(e) || `${e.tournament}|${e.date}`}|${e.placement ?? e.place}`;
  const oldPaid = new Map(oldList.filter(e => e.prize_usd > 0).map(e => [key(e), e.prize_usd]));
  for (const e of entries) {
    if (!(e.prize_usd > 0)) continue;
    if (oldPaid.get(key(e)) !== e.prize_usd) return true;
  }
  return false;
}

/**
 * Preisgeld zum Schreiben. undefined = Feld nicht anfassen.
 * infoboxFetched=false: gespeicherter Wert bleibt (Liste hat sich nicht bezahlt geaendert).
 */
export function decideEarnings({ infoboxFetched, infobox, listSum }) {
  if (!infoboxFetched) return undefined;
  if (typeof infobox === 'number' && infobox > 0) return infobox;
  if (listSum > 0) return listSum;
  return undefined; // nie 0 schreiben
}

/**
 * Tabellen-Turniere, die in der Liste fehlen und nach (Lesezeitpunkt − 14 Tage)
 * endeten — Zeichen, dass die Liste veraltet ist (D7 Stufe 2).
 * @param list   gespeicherte Liste (src:'results')
 * @param tours  [{ page, end }] der mit dem Pro verknuepften Turniere
 */
export function newerTablePages(list, tours) {
  if (!isResultsList(list)) return [];
  const readAt = list.map(e => e.read_at).filter(Boolean).sort().pop();
  const t = readAt ? Date.parse(readAt) : NaN;
  if (!Number.isFinite(t)) return [];
  const cutoff = new Date(t - LIST_GRACE_DAYS * DAY_MS).toISOString().slice(0, 10);
  const pages = new Set(list.map(entryPage).filter(Boolean));
  const out = [];
  for (const tour of tours) {
    const p = normalizePage(tour.page);
    if (!p || pages.has(p)) continue;
    if (!tour.end || tour.end < cutoff) continue;
    out.push(p);
  }
  return [...new Set(out)];
}

function stampTime(p) {
  const t = p.last_history_enriched_at ? Date.parse(p.last_history_enriched_at) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}

function byOldest(a, b) {
  const d = stampTime(a) - stampTime(b);
  if (d !== 0) return d;
  return String(a.pro_name || '').localeCompare(String(b.pro_name || ''));
}

/**
 * Auswahl fuer einen Lauf (D7).
 * @param pros  Zeilen mit id, pro_name, source_page, last_history_enriched_at,
 *              hist_src (Quelle des ersten Listeneintrags)
 * @param newerIds  Set der Pro-ids mit neueren Tabellenzeilen (newerTablePages)
 * @returns {{ selected, groups: { never, newer, oldest }, deferred }}
 */
export function selectHistoryTargets(pros, {
  newerIds = new Set(), max = HISTORY_DEFAULT_MAX, minOldest = HISTORY_MIN_OLDEST, since = HISTORY_MODE_SINCE,
} = {}) {
  const sinceT = Date.parse(since);
  const never = [], newer = [], oldest = [];
  for (const p of pros) {
    if (!p.source_page) continue;
    const hasList = p.hist_src === 'results';
    const seenByMode = stampTime(p) >= sinceT;
    if (!hasList && !seenByMode) never.push(p);
    else if (hasList && newerIds.has(p.id)) newer.push(p);
    else oldest.push(p);
  }
  never.sort(byOldest); newer.sort(byOldest); oldest.sort(byOldest);

  const reserved = Math.min(minOldest, oldest.length, max);
  const first = [...never, ...newer].slice(0, max - reserved);
  const rest = oldest.slice(0, max - first.length);
  const selected = [...first, ...rest];
  const total = never.length + newer.length + oldest.length;
  return {
    selected,
    groups: { never: never.length, newer: newer.length, oldest: oldest.length },
    deferred: Math.max(0, total - selected.length),
  };
}

/**
 * Zeitlimit eines Schritts ueberschritten. Eigene Klasse, weil der Aufrufer
 * danach ANHALTEN muss: der abgehaengte Abruf laeuft im Hintergrund weiter und
 * koennte mit dem naechsten Abruf gleichzeitig an Liquipedia gehen — die
 * Wartesperre in liquipedia-tft.mjs ist nicht gegen Gleichzeitigkeit geschuetzt.
 */
export class StepTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StepTimeoutError';
  }
}

/** Promise mit Zeitlimit. Der Abruf selbst laeuft weiter, wird aber ignoriert. */
export function withTimeout(promise, ms, label) {
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new StepTimeoutError(`Zeitlimit ${Math.round(ms / 1000)} s: ${label}`)), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}
