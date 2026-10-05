// Riots offizieller TFT-Patch-Terminplan: Seite lesen und mit dem
// gespeicherten Stand (public/tft-set.json#patchStarts) zusammenfuehren.
//
// Warum diese Quelle: Welcher Patch an einem Sammeltag galt, haengt am
// Go-Live-Datum. game_version traegt seit Set 18 keine Nummer mehr ("TFT Unreal
// Version ?.?.?.?"), ddragon kennt nur den LoL-Stand und springt bis zu zwei
// Tage zu spaet um. Die Support-Seite pflegt Riot selbst, auch bei
// Verschiebungen: "If a patch is delayed within 48 hours of its scheduled date,
// we'll put an alert at the top of this page."
//
// Reine Funktionen, kein Netz, keine Dateien. Abruf und Schreiben macht
// scripts/detect-tft-patch-schedule.mjs, die Tagesregel scripts/lib/tft-patch-day.mjs.
// Alles Unerwartete wirft: lieber ein roter Lauf als ein still falscher Termin.

import { isDay, addDays } from './tft-patch-day.mjs';

export const SCHEDULE_URL = 'https://support.riotgames.com/en-us/tft/events/patch-schedule-teamfight-tactics';

// Abstand zweier aufeinanderfolgender Go-Lives. 2026 gemessen: 13 bis 27 Tage.
// Ausserhalb dieser Spanne ist ein Lesefehler wahrscheinlicher als ein echter Plan.
const MIN_GAP_DAYS = 6;
const MAX_GAP_DAYS = 42;
// Aendert Riot einen Termin, der so weit zurueckliegt, wird das nicht still
// uebernommen — es wuerde bereits gesammelte Tage umbenennen.
const PAST_GUARD_DAYS = 3;
// Weniger Zeilen heisst: Seite umgebaut oder abgeschnitten.
const MIN_ROWS = 5;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const PATCH_RE = /^TFT\s*(\d{1,2})\.(\d{1,2})\s*([a-z])?$/i;
const DATE_RE = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i;
const TBD_RE = /^$|^(tbd|tba|tbc)$|to be (announced|determined|confirmed)/i;
const DELAY_RE = /delay|postpon|reschedul|pushed back|moved|new date|now (scheduled|releas|launch)/i;

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return NAMED[e.toLowerCase()] ?? m;
    const cp = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
}

const squash = (s) => s.replace(/\s+/g, ' ').trim();
const text = (html) => squash(decode(html.replace(/<[^>]*>/g, ' ')));
const withoutParens = (s) => squash(s.replace(/\([^)]*\)/g, ' '));

function cells(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'gi');
  return [...html.matchAll(re)].map((m) => text(m[1]));
}

function monthOf(word) {
  const w = word.toLowerCase();
  if (w === 'sept') return 9;
  const i = w.length === 3 ? MONTHS.findIndex((m) => m.startsWith(w)) : MONTHS.indexOf(w);
  return i < 0 ? null : i + 1;
}

const patchKey = (p) => p.split('.').map(Number);
function cmpPatch(a, b) {
  const [as, am] = patchKey(a);
  const [bs, bm] = patchKey(b);
  return as - bs || am - bm;
}

const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);

// Nur die gerenderte Tabelle zaehlt. Die Seite liefert sie ein zweites Mal als
// JSON-Text (`<table …`) — den findet `<table` absichtlich nicht.
function scheduleTables(html) {
  const out = [];
  for (const m of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)) {
    const head = cells(m[1], 'th');
    if (head.length >= 2 && /^patch$/i.test(head[0]) && /^scheduled date\b/i.test(head[1])) {
      out.push({ body: m[1], width: head.length });
    }
  }
  return out;
}

function readDate(cell) {
  const s = withoutParens(cell);
  if (TBD_RE.test(s)) return { tbd: true };
  const m = s.match(DATE_RE);
  const month = m && monthOf(m[1]);
  if (!month) return null;
  const day = `${m[3]}-${String(month).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
  return isDay(day) ? { day } : null;
}

// Text der Hinweis-Leisten oben auf der Seite. Eine Zeile mit `title` (der
// absolute Zeitpunkt) ersetzt ihre relative Anzeige ("1 month ago") — sonst
// aenderte sich der Text jeden Tag und galt jedes Mal als neuer Hinweis.
function readAlerts(html) {
  const out = [];
  for (const m of html.matchAll(/role\s*=\s*["']alert["']/gi)) {
    let chunk = html.slice(m.index, m.index + 4000);
    const stop = chunk.indexOf('MuiAlert-action');
    if (stop > 0) chunk = chunk.slice(0, stop);
    const parts = [...chunk.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p\s*>/gi)].map(([, attrs, inner]) => {
      const title = attrs.match(/\btitle\s*=\s*"([^"]*)"/i);
      return title ? squash(decode(title[1])) : text(inner);
    }).filter(Boolean);
    const msg = parts.length ? parts.join(' · ') : text(chunk.slice(chunk.indexOf('>') + 1));
    if (msg) out.push(msg);
  }
  return out;
}

/** Spricht ein Seiten-Hinweis von einer Patch-Verschiebung? */
export function isDelayAlert(msg) {
  return /\bpatch/i.test(msg) && DELAY_RE.test(msg);
}

/**
 * Riots Terminplan-Seite lesen.
 * @returns {{ rows: {set:number, patch:string, from_day:string}[],
 *             skipped: {label:string, date:string, reason:string}[],
 *             alerts: string[] }}
 *   rows     Haupt-Patches, nach Datum sortiert
 *   skipped  B-Patches (kommen aus den Patch-Notes) und Zeilen ohne Datum
 *   alerts   Texte der Hinweis-Leisten oben auf der Seite
 */
export function parseScheduleHtml(html) {
  if (typeof html !== 'string' || !html) throw new Error('Terminplan-Seite ist leer');
  const tables = scheduleTables(html);
  if (!tables.length) throw new Error('Terminplan-Tabelle nicht gefunden — Seitenaufbau geaendert?');

  const rows = [];
  const skipped = [];
  for (const { body, width } of tables) {
    for (const tr of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
      if (!/<td\b/i.test(tr[1])) continue;
      const row = cells(tr[1], 'td');
      if (row.length !== width) throw new Error(`Terminplan-Zeile mit ${row.length} statt ${width} Zellen: "${text(tr[1])}"`);
      const [label, date] = row;
      const p = withoutParens(label).match(PATCH_RE);
      if (!p || Number(p[2]) < 1) throw new Error(`Unbekannte Patch-Bezeichnung im Terminplan: "${label}"`);
      if (p[3]) {
        skipped.push({ label, date, reason: 'B-Patch — kommt aus den Patch-Notes' });
        continue;
      }
      const d = readDate(date);
      if (!d) throw new Error(`Unlesbares Datum im Terminplan: ${label} → "${date}"`);
      if (d.tbd) {
        skipped.push({ label, date, reason: 'noch kein Datum' });
        continue;
      }
      const set = Number(p[1]);
      rows.push({ set, patch: `${set}.${Number(p[2])}`, from_day: d.day });
    }
  }

  if (rows.length < MIN_ROWS) throw new Error(`Terminplan zu kurz: ${rows.length} Zeilen, erwartet mind. ${MIN_ROWS} — Seitenaufbau geaendert?`);
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.patch)) throw new Error(`Patch doppelt im Terminplan: ${r.patch}`);
    seen.add(r.patch);
  }
  rows.sort((a, b) => a.from_day.localeCompare(b.from_day) || cmpPatch(a.patch, b.patch));
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (a.from_day === b.from_day || cmpPatch(a.patch, b.patch) >= 0) {
      throw new Error(`Terminplan widerspruechlich: ${a.patch} am ${a.from_day}, ${b.patch} am ${b.from_day}`);
    }
  }
  return { rows, skipped, alerts: readAlerts(html) };
}

// Gesamtliste pruefen: jeder Eintrag gueltig, Abstaende plausibel, keine Luecke
// in der Nummernfolge (auf x.N folgt x.N+1 oder die naechste Set mit .1).
function checkSequence(list) {
  for (const s of list) {
    const m = /^(\d+)\.(\d+)$/.exec(String(s?.patch ?? ''));
    if (!m || Number(m[2]) < 1 || !isDay(s?.from_day) || s.set !== Number(m[1])) {
      throw new Error(`Terminplan-Eintrag ungueltig: ${JSON.stringify(s)}`);
    }
  }
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    const gap = daysBetween(a.from_day, b.from_day);
    if (gap < MIN_GAP_DAYS || gap > MAX_GAP_DAYS) {
      throw new Error(`Terminplan unplausibel: ${a.patch} am ${a.from_day}, ${b.patch} am ${b.from_day} — ${gap} Tage Abstand (erlaubt ${MIN_GAP_DAYS}–${MAX_GAP_DAYS})`);
    }
    const [as, am] = patchKey(a.patch);
    const [bs, bm] = patchKey(b.patch);
    if (!((bs === as && bm === am + 1) || (bs === as + 1 && bm === 1))) {
      throw new Error(`Terminplan mit Luecke: auf ${a.patch} (${a.from_day}) folgt ${b.patch} (${b.from_day})`);
    }
  }
}

/**
 * Seite und gespeicherten Stand zusammenfuehren.
 *
 * - neuer Patch: aufnehmen
 * - `pinned`: bleibt, wie er ist (der einzige Hand-Eingriff)
 * - anderes Datum: uebernehmen, solange keiner der beiden Termine laenger als
 *   PAST_GUARD_DAYS zurueckliegt; sonst werfen — ein Mensch soll entscheiden
 * - Patches, die von der Seite verschwinden (Jahreswechsel), bleiben stehen
 *
 * @returns {{ starts: object[], changes: string[], notes: string[] }}
 */
export function mergeSchedule(stored, rows, today, nowIso) {
  if (!isDay(today)) throw new Error(`Ungueltiges Datum fuer heute: ${today}`);
  if (stored != null && !Array.isArray(stored)) throw new Error('patchStarts ist keine Liste');
  const list = (stored || []).map((s) => ({ ...s }));
  const byPatch = new Map(list.map((s) => [s?.patch, s]));
  const guard = addDays(today, -PAST_GUARD_DAYS);
  const changes = [];
  const notes = [];

  for (const r of rows) {
    const old = byPatch.get(r.patch);
    if (!old) {
      const add = { set: r.set, patch: r.patch, from_day: r.from_day, seen_at: nowIso };
      list.push(add);
      byPatch.set(r.patch, add);
      changes.push(`${r.patch}: neu ab ${r.from_day}`);
      continue;
    }
    if (old.from_day === r.from_day) continue;
    if (old.pinned) {
      notes.push(`${r.patch}: von Hand auf ${old.from_day} festgesetzt, Riot nennt ${r.from_day}`);
      continue;
    }
    const earlier = old.from_day < r.from_day ? old.from_day : r.from_day;
    if (earlier <= guard) {
      throw new Error(`Riot aendert einen vergangenen Termin: ${r.patch} von ${old.from_day} auf ${r.from_day}. `
        + 'Pruefen und in public/tft-set.json von Hand setzen (pinned: true haelt ihn fest).');
    }
    changes.push(`${r.patch}: verschoben von ${old.from_day} auf ${r.from_day}`);
    old.previous_from_day = old.from_day;
    old.from_day = r.from_day;
    old.seen_at = nowIso;
  }

  list.sort((a, b) => String(a?.from_day).localeCompare(String(b?.from_day)));
  checkSequence(list);
  return { starts: list, changes, notes };
}
