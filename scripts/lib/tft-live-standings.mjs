// Reine Bausteine des Turnier-Zwischenstands: Zeitfenster, Reiter-Liste, Leser
// fuer das Bracket-Format und die Bewertung fuer den Laufzeit-Vertrag.
//
// Eigene Datei, weil scripts/fetch-tft-live-standings.mjs beim Import Umgebung
// liest und ohne Schluessel abbricht — Vertrag und Tests brauchen beides nicht.

const DAY_MS = 86_400_000;

/** Fenster, in dem der Sammler ein Turnier liest: Start−2 … Ende+1 Tag (inkl. Endtag). */
export function inLiveWindow(t, now) {
  return !!(t.start_date && t.end_date)
    && now >= Date.parse(t.start_date) - 2 * DAY_MS
    && now <= Date.parse(t.end_date) + 2 * DAY_MS;
}

/** Vor Start+1 Tag ist eine leere Tabelle normal, kein Fehler. */
export function liveStarted(t, now) {
  return now >= Date.parse(t.start_date) + DAY_MS;
}

export const num = (s) => {
  const t = String(s ?? '').replace(/[,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

// Blattnamen stehen als JS-String im Seitenquelltext ("Days 1 \x26 2").
const unescapeJs = (s) => s
  .replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/\\(.)/g, '$1');

/** Reiter einer Google-Tabelle aus dem Quelltext von /pubhtml bzw. /htmlview. */
export function sheetTabs(html) {
  return [...html.matchAll(/items\.push\(\{name: "((?:[^"\\]|\\.)*)", pageUrl: "[^"]*", gid: "(\d+)"/g)]
    .map((m, i) => ({ name: unescapeJs(m[1]), gid: m[2], order: i }));
}

// Anzeigenamen der Stufen. Die Tabelle selbst nennt sie in der Spieler-Liste so
// („Starting Stage": Play-ins, Swiss Stage); User-Entscheid 03.11.2026.
// Einmal festgelegt lassen: eine Umbenennung hier laesst die alte Stufe stehen,
// bis ein vollstaendiger Lauf sie per staleStages() abraeumt.
const STAGE_NAMES = { 'PI-Score': 'Play-ins', 'SS-Score': 'Swiss Stage' };
export const stageName = (tab) => (Object.hasOwn(STAGE_NAMES, tab) ? STAGE_NAMES[tab] : tab);

const IS_ENGLISH_ID = /^english id$/i;
const IS_BRACKET_ID = /^bracket id$/i;
const IS_ROUND = /^r\s*\d+$/i;
const IS_TOTAL = /^(points|pts|total|total points)$/i;
const RANK = /^#(\d+)$/;

function readBracketBlock(rows, head, end) {
  const h = rows[head].map(c => c.trim());
  const en = h.findIndex(c => IS_ENGLISH_ID.test(c));
  const br = h.findIndex(c => IS_BRACKET_ID.test(c));
  const total = h.findIndex(c => IS_TOTAL.test(c));
  const rounds = h.map((c, i) => (IS_ROUND.test(c) ? i : -1)).filter(i => i >= 0);
  const out = [];
  for (const r of rows.slice(head + 1, end)) {
    const raw = (en >= 0 && (r[en] || '').trim()) || (br >= 0 && (r[br] || '').trim()) || '';
    if (!raw) continue;
    const rank = String(r[0] ?? '').trim().match(RANK);
    if (!rank) return null;   // ungeordneter Block (Spalte 0 = laufende Nummer)
    const vals = rounds.map(i => num(r[i])).filter(v => v != null);   // „-" = ausgeschieden
    const totalVal = total >= 0 ? num(r[total]) : null;
    if (!vals.length && !totalVal) continue;   // noch keine Runde gespielt
    out.push({
      raw,
      points: totalVal > 0 ? totalVal : vals.reduce((a, b) => a + b, 0),
      placement: Number(rank[1]),   // nie aus Punkten: Gleichstand ist hier normal
      region: null,                 // „Flag" ist eine Herkunft, keine Spielregion
      games: vals.filter(v => v > 0).length,
    });
  }
  return out.length ? out : null;
}

/**
 * Bracket-Format (TOC China): mehrere Bloecke je Reiter, Kopf mit `Bracket ID` /
 * `English ID` und Runden-Spalten. Nur der Block, dessen Zeilen in Spalte 0 `#n`
 * tragen, ist die Rangliste; der Block davor steht in Anmelde-Reihenfolge. Das
 * Finale hat keine TOTAL-Spalte, dort zaehlt die Summe der Runden.
 * @returns {null | Array<{raw:string, points:number, placement:number, region:null, games:number}>}
 */
export function parseBracketGrid(rows) {
  const heads = [];
  rows.forEach((r, i) => {
    const h = r.map(c => c.trim());
    if (h.some(c => IS_ENGLISH_ID.test(c) || IS_BRACKET_ID.test(c)) && h.some(c => IS_ROUND.test(c))) heads.push(i);
  });
  for (let k = 0; k < heads.length; k++) {
    const block = readBracketBlock(rows, heads[k], heads[k + 1] ?? rows.length);
    if (block) return block;
  }
  return null;
}

/**
 * Stufen eines Turniers, die in der Datenbank liegen, im vollstaendigen Lauf
 * aber keine Quelle mehr liefert — umbenannte oder geloeschte Reiter (TOC Fall
 * 2026: „TOC-Semifinal" → „Semifinals" am 08.11., die alten Zeilen blieben als
 * zweiter Reiter auf der Seite stehen). Nur aufrufen, wenn JEDE Quelle des
 * Turniers ohne Ausfall gelesen wurde, sonst verschwindet ein Reiter, der nur
 * gerade nicht erreichbar war.
 * @param {Array<{source:string, stage:string}>} dbRows
 * @param {Map<string, Set<string>>} seen  source → gelesene Stufen
 * @returns {Array<{source:string, stage:string}>}
 */
export function staleStages(dbRows, seen) {
  const out = new Map();
  for (const r of dbRows) {
    const got = seen.get(r.source);
    if (!got || !got.size || got.has(r.stage)) continue;
    out.set(`${r.source}|${r.stage}`, { source: r.source, stage: r.stage });
  }
  return [...out.values()];
}

/** Turniere, die der Vertrag gerade prueft: im Fenster, begonnen, nicht ausgenommen. */
export function liveTournamentsToCheck(tours, now, skip = []) {
  return tours.filter(t => !skip.includes(t.id) && inLiveWindow(t, now) && liveStarted(t, now));
}

/**
 * Bewertung fuer den Vertrag. Rot: Zeilen sind da, kommen aber nicht mehr nach.
 * Gelb: nie Zeilen gehabt (viele Veranstalter veroeffentlichen keine lesbare
 * Tabelle) oder eine einzelne Stufe bleibt zurueck (Reiter faellt aus, Exit-Code
 * und Turnier-Frische sehen das nicht).
 * @param {Array<{id:string}>} active
 * @param {Map<string, Array<{stage:string, fetched_at:string}>>} rowsById
 * @returns {{status:'ok'|'warn'|'broken', detail:string}}
 */
export function evaluateLiveStandings(active, rowsById, { now, maxAgeHours = 3, stageLagHours = 6 }) {
  if (!active.length) return { status: 'ok', detail: 'kein laufendes Turnier mit Quelle' };
  const hours = (ms) => (ms / 3_600_000).toFixed(1);
  const broken = [], warn = [], fine = [];
  for (const t of active) {
    const rows = rowsById.get(t.id) ?? [];
    if (!rows.length) { warn.push(`${t.id}: noch nie Zeilen`); continue; }
    const newestByStage = new Map();
    for (const r of rows) {
      const ts = Date.parse(r.fetched_at);
      if (!(newestByStage.get(r.stage) >= ts)) newestByStage.set(r.stage, ts);
    }
    const newest = Math.max(...newestByStage.values());
    if (now - newest > maxAgeHours * 3_600_000) {
      broken.push(`${t.id}: neueste Zeile vor ${hours(now - newest)} h (erlaubt ${maxAgeHours} h)`);
      continue;
    }
    const behind = [...newestByStage].filter(([, ts]) => newest - ts > stageLagHours * 3_600_000).map(([s]) => s);
    if (behind.length) warn.push(`${t.id}: Stufe bleibt zurueck: ${behind.join(', ')}`);
    else fine.push(`${t.id} (${rows.length} Zeilen, ${newestByStage.size} Stufen)`);
  }
  if (broken.length) return { status: 'broken', detail: [...broken, ...warn].join(' · ') };
  if (warn.length) return { status: 'warn', detail: warn.join(' · ') };
  return { status: 'ok', detail: fine.join(' · ') };
}
