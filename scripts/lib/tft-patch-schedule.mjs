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
//
// Termin erst nach Bestaetigung (G2, Plan 12.11.2026): Riots Tabelle nannte
// 18.7 ab 11.11.2026, der Patch kam nicht. Deshalb prueft confirmStarts den
// juengsten gestarteten und den morgen beginnenden Termin der laufenden Set
// gegen drei Quellen (Riots Notes, MetaTFT, CDragon-Stempel), je ja / nein /
// unbekannt:
//   >= 2 ja    `confirmed: true`; war er angehalten, gilt er ab dem
//              Sammeltag aus MetaTFTs `start` (nie vor Riots Tag, nie nach heute),
//              ohne den ab dem naechsten Sammeltag
//   >= 2 nein  `hold: { riot_from_day, since }`, from_day = laufender
//              Sammeltag + 2 (der naechste Lauf faellt in Sammeltag + 1) — alle
//              Leser sehen so das wirksame Datum
//   sonst      nichts aendern, nur Hinweis
// Ausgenommen: `pinned` (Hand hat Vorrang) und x.1 (Set-Start, den sichert
// detect-tft-set: Wechsel erst, wenn CDragon die neue Set ausliefert).

import { isDay, addDays } from './tft-patch-day.mjs';
import { currentWindowDay } from './tft-crawl-window.mjs';

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
    if (s.hold != null && (typeof s.hold !== 'object' || !isDay(s.hold.riot_from_day))) {
      throw new Error(`Halte-Eintrag ungueltig (hold braucht riot_from_day): ${JSON.stringify(s)}`);
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
 * - `hold` / `confirmed`: bleibt ebenfalls (confirmStarts entscheidet). Sonst
 *   setzte Riots altes Datum einen angehaltenen Termin zurueck oder wuerfe nach
 *   drei Tagen als "vergangener Termin". Hinweis nur, wenn Riot ein Datum nennt,
 *   das wir noch nicht kennen.
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
    if (old.hold) {
      if (r.from_day !== old.hold.riot_from_day) {
        notes.push(`${r.patch}: angehalten (gilt fruehestens ab ${old.from_day}), Riot nennt jetzt ${r.from_day} statt ${old.hold.riot_from_day}`);
      }
      continue;
    }
    if (old.confirmed) {
      if (r.from_day !== old.previous_from_day) {
        notes.push(`${r.patch}: Go-Live ab ${old.from_day} bestaetigt, Riot nennt ${r.from_day}`);
      }
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

// ---------------------------------------------------------------- Bestaetigung (G2)

const YES = 'ja';
const NO = 'nein';
const UNKNOWN = 'unbekannt';
// CDragon `latest` traegt die Daten des naechsten Patches 1–2 Tage vor dem
// Go-Live (detect-tft-set.mjs, Bump-Gate). Ein Stempel ab Riots Tag − 2 zaehlt.
export const CDRAGON_LEAD_DAYS = 2;

const isMinorOne = (patch) => /^\d+\.1$/.test(String(patch));
const riotDayOf = (s) => s.hold?.riot_from_day ?? s.from_day;
const byFromDay = (a, b) => String(a?.from_day).localeCompare(String(b?.from_day));

function toDate(now) {
  const d = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(d.getTime())) throw new Error(`Ungueltiger Zeitpunkt: ${JSON.stringify(now)}`);
  return d;
}

/**
 * Stimmen der drei Quellen fuer einen Termin, je 'ja' | 'nein' | 'unbekannt'.
 *
 * @param observations {
 *   notes:   { "18.7": 'ja' | 'nein' | 'unbekannt' }   Riots Notes: 200 ja, 404 nein
 *   metatft: { patch, b_patch_version, start } | null  Antwort von tft-stat-api/patch
 *   cdragon: ISO-Zeit | null                           Stempel von en_us.json im Listing
 * }
 * Fehlt etwas oder ist es unlesbar: unbekannt.
 */
export function patchVotes(entry, observations = {}) {
  const n = observations?.notes?.[entry.patch];
  const notes = n === YES || n === NO ? n : UNKNOWN;

  const mt = observations?.metatft;
  const mtPatch = typeof mt?.patch === 'string' && /^\d+\.\d+$/.test(mt.patch) ? mt.patch : null;
  const metatft = mtPatch ? (cmpPatch(mtPatch, entry.patch) >= 0 ? YES : NO) : UNKNOWN;

  const cd = observations?.cdragon;
  const cdMs = typeof cd === 'string' ? Date.parse(cd) : NaN;
  const cdragon = Number.isFinite(cdMs)
    ? (new Date(cdMs).toISOString().slice(0, 10) >= addDays(riotDayOf(entry), -CDRAGON_LEAD_DAYS) ? YES : NO)
    : UNKNOWN;
  return { notes, metatft, cdragon };
}

function tally(votes, observations) {
  const mt = observations?.metatft;
  const cd = observations?.cdragon;
  const mtText = typeof mt?.patch === 'string' ? ` (${mt.patch}${String(mt.b_patch_version ?? '').trim()})` : '';
  const cdText = typeof cd === 'string' && Number.isFinite(Date.parse(cd)) ? ` (${new Date(cd).toISOString().slice(0, 10)})` : '';
  return `Notes ${votes.notes}, MetaTFT ${votes.metatft}${mtText}, CDragon ${votes.cdragon}${cdText}`;
}

/**
 * Welche Termine heute geprueft werden (Reihenfolge nach Datum):
 *  (a) jeder angehaltene Termin der laufenden Set
 *  (b) der juengste gestartete Termin der laufenden Set (from_day <= laufender
 *      Sammeltag), wenn er weder bestaetigt noch angehalten ist
 *  (c) ebenso der Termin, der mit dem naechsten Sammeltag beginnt — der Lauf
 *      um 02:17 UTC liegt 3 Stunden vor dem Tageswechsel, so wird ein nicht
 *      erschienener Patch angehalten, bevor ihn ein Leser als live sieht
 * Nie `pinned` (Hand hat Vorrang), nie x.1 (Set-Start sichert detect-tft-set).
 */
export function confirmCandidates(starts, set, now) {
  const W = currentWindowDay(toDate(now));
  const own = (Array.isArray(starts) ? starts : [])
    .filter((s) => s?.set === Number(set) && isDay(s?.from_day))
    .sort(byFromDay);
  const open = (s) => s && !s.pinned && !s.confirmed && !s.hold && !isMinorOne(s.patch);
  const out = own.filter((s) => s.hold && !s.pinned && !isMinorOne(s.patch));
  const youngest = own.filter((s) => s.from_day <= W).at(-1);
  if (open(youngest)) out.push(youngest);
  const upcoming = own.find((s) => s.from_day === addDays(W, 1));
  if (open(upcoming)) out.push(upcoming);
  return out.sort(byFromDay);
}

// Spaetester Tag, auf den ein Termin ruecken darf: mindestens MIN_GAP_DAYS vor
// dem naechsten Termin und hoechstens MAX_GAP_DAYS nach dem vorigen — sonst
// verwirft checkSequence die ganze Liste.
function upperLimit(list, s) {
  const sorted = [...list].sort(byFromDay);
  const i = sorted.indexOf(s);
  const next = sorted[i + 1];
  const prev = sorted[i - 1];
  const limits = [];
  if (next) limits.push({ day: addDays(next.from_day, -MIN_GAP_DAYS), why: `weniger als ${MIN_GAP_DAYS} Tage vor ${next.patch} (${next.from_day})` });
  if (prev) limits.push({ day: addDays(prev.from_day, MAX_GAP_DAYS), why: `mehr als ${MAX_GAP_DAYS} Tage nach ${prev.patch} (${prev.from_day})` });
  return limits.sort((a, b) => a.day.localeCompare(b.day))[0] ?? null;
}

// Go-Live nach einem Halt: Sammeltag aus MetaTFTs `start`, wenn MetaTFT genau
// diesen Patch ohne B-Buchstaben meldet (sonst gehoert `start` zu einem anderen
// Stand), begrenzt auf [Riots Tag, laufender Sammeltag]. Ohne diesen Start der
// NAECHSTE Sammeltag: Notes und CDragon erscheinen meist einen Tag vor dem
// Go-Live, eine Freigabe nur auf sie laege sonst einen Tag zu frueh. An der
// Obergrenze bleibt der angehaltene Tag.
function releaseDay(s, observations, W, limit) {
  const mt = observations?.metatft;
  let day;
  let how;
  if (mt?.patch === s.patch && !String(mt.b_patch_version ?? '').trim() && Number.isFinite(Date.parse(mt.start))) {
    day = currentWindowDay(new Date(Date.parse(mt.start)));
    how = `MetaTFT-Start ${mt.start}`;
    if (day > W) day = W;
  } else {
    day = addDays(W, 1);
    how = 'naechster Sammeltag, MetaTFT bestaetigt den Start noch nicht';
    if (limit && day > limit.day) day = s.from_day;
  }
  if (day < s.hold.riot_from_day) day = s.hold.riot_from_day;
  return { day, how };
}

/**
 * Termine bestaetigen, anhalten oder freigeben (Regeln oben im Kopf).
 *
 * @param stored        patchStarts nach mergeSchedule
 * @param set           laufende Set (tft-set.json setNumber)
 * @param now           Zeitpunkt des Laufs (Date oder ISO); laufender Sammeltag
 *                      W = currentWindowDay(now)
 * @param observations  Quellen-Antworten, siehe patchVotes
 * @returns {{ starts, changes, notes, alerts, decisions }}
 *   alerts     Meldungen fuer den Menschen (Exit 2): neu angehalten, nach
 *              Halt freigegeben, Obergrenze erreicht
 *   decisions  je Kandidat { patch, votes, outcome }
 */
export function confirmStarts(stored, { set, now, nowIso, observations = {} } = {}) {
  if (!Array.isArray(stored)) throw new Error('patchStarts ist keine Liste');
  const at = toDate(now);
  const W = currentWindowDay(at);
  const stamp = nowIso ?? at.toISOString();
  const list = stored.map((s) => (s?.hold && typeof s.hold === 'object' ? { ...s, hold: { ...s.hold } } : { ...s }));
  checkSequence([...list].sort(byFromDay));
  const changes = [];
  const notes = [];
  const alerts = [];
  const decisions = [];

  for (const s of confirmCandidates(list, set, at)) {
    const votes = patchVotes(s, observations);
    const yes = Object.values(votes).filter((v) => v === YES).length;
    const no = Object.values(votes).filter((v) => v === NO).length;
    const why = tally(votes, observations);
    const decide = (outcome) => decisions.push({ patch: s.patch, votes, outcome });

    if (yes >= 2) {
      if (s.hold) {
        const riot = s.hold.riot_from_day;
        const { day, how } = releaseDay(s, observations, W, upperLimit(list, s));
        delete s.hold;
        s.confirmed = true;
        s.previous_from_day = riot;
        s.from_day = day;
        alerts.push(`${s.patch}: nach Halt bestaetigt (${why}) — gilt ab ${day} (${how}; Riot nannte ${riot})`);
        decide('released');
      } else {
        s.confirmed = true;
        changes.push(`${s.patch}: Go-Live ab ${s.from_day} bestaetigt (${why})`);
        decide('confirmed');
      }
      continue;
    }

    // Angehalten bleibt angehalten, bis 2 Quellen bestaetigen — auch wenn die
    // Quellen gerade unklar sind (sonst wuerde der Termin unbestaetigt wirksam).
    if (no >= 2 || s.hold) {
      // Uebernaechster Sammeltag: der naechste Lauf faellt in den Sammeltag W+1,
      // bis dahin muss auch der beim Vorgaenger bleiben — sonst saehen alle
      // Leser des laufenden Patches (detect-tft-set, Einheiten-Zahlen,
      // Spielseite) den unbestaetigten Patch einen Tag lang als live.
      const earliest = addDays(W, 2);
      const target = s.hold && s.from_day > earliest ? s.from_day : earliest;
      if (target === s.from_day) {
        notes.push(`${s.patch}: weiter angehalten (${why}), gilt fruehestens ab ${s.from_day}`);
        decide('hold-unchanged');
        continue;
      }
      const limit = upperLimit(list, s);
      if (limit && target > limit.day) {
        alerts.push(`${s.patch}: nicht bestaetigt (${why}), aber ab ${target} laege er ${limit.why} — nicht weiter verschoben, `
          + `bleibt ab ${s.from_day}${s.hold ? ' (angehalten)' : ''}. Von Hand entscheiden (pinned setzen)`);
        decide('capped');
        continue;
      }
      if (s.hold) {
        changes.push(`${s.patch}: weiter angehalten (${why}) — von ${s.from_day} auf ${target}`);
        decide('hold-extended');
      } else {
        s.hold = { riot_from_day: s.from_day, since: stamp };
        const lastKept = addDays(target, -1);
        const kept = s.from_day < lastKept ? `Sammeltage ${s.from_day} bis ${lastKept} bleiben` : `Sammeltag ${lastKept} bleibt`;
        alerts.push(`${s.patch}: angehalten — Riot nannte ${s.from_day}, aber ${why}. Gilt fruehestens ab ${target}, `
          + `${kept} beim Vorgaenger`);
        decide('held');
      }
      s.from_day = target;
      continue;
    }

    notes.push(`${s.patch}: nicht entschieden (${why}) — bleibt${s.hold ? ' angehalten' : ''} ab ${s.from_day}`);
    decide('undecided');
  }

  list.sort(byFromDay);
  checkSequence(list);
  return { starts: list, changes, notes, alerts, decisions };
}
