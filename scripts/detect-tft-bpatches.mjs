#!/usr/bin/env node
// Erkennt B-Patches (Mid-Patch-Balance-Updates) aus Riots offiziellen
// Patchnotes und traegt sie als Schnitt in public/tft-set.json ein:
//   patchCuts: [{ set, patch: "18.1b", base: "18.1", from_day: "2026-09-01", source, detected_at }]
//
// Warum: Riot liefert im Match keinen Patch. Der Sammeltag bekommt seinen
// Namen aus tft-set.json (scripts/lib/tft-patch-day.mjs patchForDay) — ohne
// Schnitt landen Tage vor und nach einem Balance-Update im selben Patch.
//
// Regeln (User-Entscheid 2026-09-13):
//   • Nur Balance zaehlt (Traits, Champions, Items …). Reine Bugfix-/Feature-
//     /Double-Up-Updates → kein Schnitt.
//   • Unbekannte Kategorie → diese Basis wird nicht geschrieben und gemeldet.
//   • Ueberschrift "X AND Y" (Rollout ueber zwei Tage) → Schnitt ab Y.
//
// Welche Basen (Plan Aufgabe A, Schritt 7): gestartete Patches der eigenen Set,
// deren Zeitraum in die letzten LOOKBACK_DAYS Fenster-Tage reicht, dazu die
// Basis von heute und von latestPatch. Fenster-Tag D = D 05:00 bis D+1 05:00 UTC.
//
// Bestehende Schnitte (Plan, Entscheidungen):
//   • Erkannt ueber (Basis, Tag). Neue Buchstaben werden nur hinten angehaengt.
//   • Ein Datum darf sich nur aendern, solange alter und neuer Tag nicht vor
//     heute−3 liegen, und nie bei `pinned: true`.
//   • Steht ein Schnitt nicht mehr in den Notes, bleibt er stehen und wird gemeldet.
//   • Muesste sich ein bestehender Schnitt anders aendern (aelteres Datum,
//     Einschub vor einem bestehenden Buchstaben, mehrdeutig) → lauter Abbruch,
//     nichts wird geschrieben.
//   • Vor dem Schreiben prueft scheduleProblems jede Basis gegen den Terminplan;
//     eine Basis mit neuen Problemen wird uebersprungen und gemeldet.
//   • Abruf mit Wiederholung; ein Fehler betrifft nur seine Basis.
// MetaTFT (tft-stat-api/patch, Feld b_patch_version) ist nur Gegenprobe:
// Abweichung → Warnung, kein Abbruch.
//
// Exit-Codes: 0 alles sauber · 1 Abbruch, nichts geschrieben · 2 geschrieben
// (soweit moeglich), aber mit Befund (uebersprungene Basis, zurueckgezogener
// Schnitt, Terminplan-Problem).
//
//   node scripts/detect-tft-bpatches.mjs [--dry-run] [--today YYYY-MM-DD] [--set-file <pfad>]

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, baseOf, isDay, patchForDay, scheduleProblems, startsFor } from './lib/tft-patch-day.mjs';
import { currentWindowDay } from './lib/tft-crawl-window.mjs';

const OUT = 'public/tft-set.json';
export const notesUrl = base => `https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-${base.replace('.', '-')}/`;
const METATFT_URL = 'https://api-hc.metatft.com/tft-stat-api/patch';

// So weit zurueck werden aeltere Basen noch gelesen. Muss AUTO_SCAN_DAYS in
// scripts/lib/tft-patch-relabel.mjs entsprechen (Test prueft das): was hier
// noch als Schnitt dazukommt, benennt die Auto-Umbenennung noch um.
export const LOOKBACK_DAYS = 14;
// Bis wann ein bestehender Schnitt sein Datum aendern darf (heute−3).
export const DATE_CHANGE_DAYS = 3;
// Abstand Update-Tag zu Veroeffentlichung der Notes, sonst ist das Datum verdaechtig.
const MAX_GAP_DAYS = 28;

// Kategorien (h4 unter einer Datums-Ueberschrift), gross geschrieben.
export const BALANCE = new Set([
  'TRAITS', 'TRAIT', 'CHAMPIONS', 'CHAMPION', 'UNITS', 'UNIT', 'ITEMS', 'ITEM',
  'AUGMENTS', 'AUGMENT', 'ARTIFACTS', 'EMBLEMS', 'RADIANT ITEMS', 'SUPPORT ITEMS',
  'SYSTEMS', 'SYSTEM', 'LARGE CHANGES', 'SMALL CHANGES', 'BALANCE CHANGES',
  'PORTALS', 'ENCOUNTERS', 'ANOMALIES', 'CHARMS',
]);
export const NON_BALANCE = new Set([
  'BUG FIXES', 'BUG FIX', 'BUGS', 'NEW FEATURE', 'NEW FEATURES',
  'GAME FEEL AND PERFORMANCE', 'GAME FEEL', 'PERFORMANCE', 'DOUBLE UP',
  'COSMETICS', 'COSMETICS AVAILABILITY',
]);

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
  'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const DATE_RE = new RegExp(`(${MONTHS.join('|')})\\s+(\\d{1,2})(?:ST|ND|RD|TH)?`, 'g');

const DAY_PART = `(?:${MONTHS.join('|')})\\s+\\d{1,2}(?:ST|ND|RD|TH)?`;
const DATE_ONLY_RE = new RegExp(`^${DAY_PART}(?:\\s*(?:AND|&|,)\\s*${DAY_PART})*$`);

// Seit 18.2 benennt Riot Kategorien frei ("18.3 B PATCH BALANCE CHANGES",
// "AUGMENTS TEMPORARILY DISABLED"). Erst die exakten Listen, dann einzelne
// Woerter: Bug/Fix/Performance gewinnen vor Balance-Woertern, damit
// "CHAMPION BUG FIXES" keinen Schnitt erzeugt. Was keins von beidem
// enthaelt, bleibt unbekannt und laesst die Basis scheitern.
const NON_BALANCE_WORDS = new Set(['BUG', 'BUGS', 'FIX', 'FIXES', 'PERFORMANCE', 'STABILITY', 'COSMETIC', 'COSMETICS']);
const BALANCE_WORDS = new Set([
  'BALANCE', 'TRAIT', 'TRAITS', 'CHAMPION', 'CHAMPIONS', 'UNIT', 'UNITS', 'ITEM', 'ITEMS',
  'AUGMENT', 'AUGMENTS', 'ARTIFACTS', 'EMBLEMS', 'SYSTEM', 'SYSTEMS', 'PORTALS',
  'ENCOUNTERS', 'ANOMALIES', 'CHARMS', 'WISPS',
]);
export function categoryKind(label) {
  if (BALANCE.has(label)) return 'balance';
  if (NON_BALANCE.has(label)) return 'other';
  const words = label.replace(/^\d+\.\d+(?:\s?[A-Z])?\s+/, '').split(/[^A-Z]+/).filter(Boolean);
  if (words.some(w => NON_BALANCE_WORDS.has(w))) return 'other';
  if (words.some(w => BALANCE_WORDS.has(w))) return 'balance';
  return 'unknown';
}

const text = html => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();

// Letztes Datum einer Ueberschrift als YYYY-MM-DD. Das Jahr kommt vom
// Veroeffentlichungsdatum der Notes; ein Monat weit davor liegt im Folgejahr.
export function headingDay(heading, publishIso) {
  const all = [...heading.matchAll(DATE_RE)];
  if (!all.length) return null;
  const [, mon, dd] = all[all.length - 1];
  const pub = new Date(publishIso);
  const m = MONTHS.indexOf(mon);
  const y = pub.getUTCFullYear() + (m < pub.getUTCMonth() - 6 ? 1 : 0);
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(Number(dd)).padStart(2, '0')}`;
}

// Liest den Abschnitt "Mid-Patch Updates" aus dem richText-HTML.
// Rueckgabe: [{ day, heading, categories, balance }]. Wirft bei Unbekanntem.
export function parseMidpatch(body, publishIso) {
  const start = body.indexOf('id="patch-midpatch-updates"');
  if (start < 0) return [];
  const after = body.slice(start);
  const next = after.slice(1).search(/<h2[\s>]/);
  const section = next < 0 ? after : after.slice(0, next + 1);
  const updates = [];
  for (const h of section.matchAll(/<h([34])[^>]*>([\s\S]*?)<\/h\1>/g)) {
    const label = text(h[2]);
    // Seit 18.2 setzt Riot das Datum als h4 ("SEPTEMBER 14", "SEPTEMBER 28TH").
    if (h[1] === '3' || DATE_ONLY_RE.test(label)) {
      const day = headingDay(label, publishIso);
      if (!day) throw new Error(`Datums-Ueberschrift nicht lesbar: "${label}"`);
      updates.push({ day, heading: label, categories: [], balance: false });
      continue;
    }
    const cur = updates[updates.length - 1];
    if (!cur) throw new Error(`Kategorie "${label}" ohne Datums-Ueberschrift`);
    const kind = categoryKind(label);
    if (kind === 'balance') cur.balance = true;
    else if (kind !== 'other') throw new Error(`Unbekannte Kategorie "${label}" (${cur.heading}) — Liste in detect-tft-bpatches.mjs pruefen`);
    cur.categories.push(label);
  }
  return updates;
}

// Notes-Text aus dem __NEXT_DATA__ einer Riot-Seite. Wirft, wenn der Aufbau nicht passt.
export function notesFromHtml(html, url) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`${url}: __NEXT_DATA__ fehlt — Seitenaufbau geaendert?`);
  const page = JSON.parse(m[1])?.props?.pageProps?.page;
  const body = (page?.blades || []).map(b => b?.richText?.body).filter(Boolean).join('\n');
  if (!body || !page?.displayedPublishDate) throw new Error(`${url}: kein Notes-Text gefunden — Seitenaufbau geaendert?`);
  return { url, body, publishIso: page.displayedPublishDate };
}

const realSleep = ms => new Promise(r => setTimeout(r, ms));

// Riot-Notes einer Basis. 404 → null. Netzfehler, 429 und 5xx werden
// wiederholt (Wartezeit 5 s × Versuch), andere HTTP-Fehler werfen sofort.
export async function fetchNotes(base, { fetchImpl = fetch, sleep = realSleep, attempts = 3, timeoutMs = 30_000 } = {}) {
  const url = notesUrl(base);
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    let status = 0;
    let html = null;
    try {
      const r = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      status = r.status;
      if (r.ok) html = await r.text();
    } catch (e) {
      lastErr = new Error(`${url} → ${e.message}`);
    }
    if (status === 404) return null;
    if (html != null) return notesFromHtml(html, url);
    if (status) {
      lastErr = new Error(`${url} → HTTP ${status}`);
      if (status !== 429 && status < 500) throw lastErr;
    }
    if (i < attempts) await sleep(5_000 * i);
  }
  throw lastErr;
}

const setOfBase = base => Number(base.split('.')[0]);
const minorOfBase = base => Number(base.split('.')[1]);
const byDay = (a, b) => (a.from_day < b.from_day ? -1 : a.from_day > b.from_day ? 1 : 0);

// Welche Basen heute gelesen werden, neueste zuerst.
export function basesToCheck(meta, today) {
  const set = Number(meta?.setNumber);
  const own = startsFor(meta, set);
  const from = addDays(today, -LOOKBACK_DAYS);
  const out = new Set();
  own.forEach((s, i) => {
    if (s.from_day > today) return;
    const next = own[i + 1];
    // Letzter Tag der Basis; ohne Nachfolger ist sie noch offen.
    if (!next || addDays(next.from_day, -1) >= from) out.add(s.patch);
  });
  const add = b => { if (b && setOfBase(b) === set) out.add(b); };
  add(patchForDay(today, meta, set).base);
  const lp = baseOf(meta?.latestPatch);
  add(lp);
  // Ohne Terminplan wie frueher: latestPatch und der Patch davor.
  if (!own.length && lp && setOfBase(lp) === set && minorOfBase(lp) > 1) add(`${set}.${minorOfBase(lp) - 1}`);
  return [...out].sort((a, b) => minorOfBase(b) - minorOfBase(a));
}

const letterAt = i => String.fromCharCode(98 + i);   // 0 → b, 1 → c …

// Fuehrt die Balance-Tage einer Basis mit ihren bestehenden Schnitten zusammen.
// Rueckgabe: { cuts, changes, findings, notes, conflict } — conflict != null heisst:
// diese Aenderung waere nicht erlaubt, der ganze Lauf bricht ab.
export function mergeBaseCuts({ existing, days, base, set, today, source, nowIso }) {
  const result = { cuts: [], changes: [], findings: [], notes: [], conflict: null };
  const fail = msg => ({ ...result, conflict: `${base}: ${msg}` });
  const old = [...existing].sort(byDay);
  for (let i = 0; i < old.length; i++) {
    if (old[i].patch !== base + letterAt(i)) {
      return fail(`bestehende Schnitte nicht lueckenlos ab b (${old.map(c => `${c.patch} ${c.from_day}`).join(', ')})`);
    }
  }
  const wanted = [...new Set(days)].sort();
  const used = new Set();
  const cuts = old.map(c => c);
  // 1) Gleicher Tag → Schnitt bleibt unveraendert (auch detected_at und pinned).
  for (const c of old) if (wanted.includes(c.from_day)) used.add(c.from_day);
  // 2) Schnitte ohne gleichen Tag: steht ein neuer Tag zwischen den Nachbarn?
  const limit = addDays(today, -DATE_CHANGE_DAYS);
  for (let i = 0; i < old.length; i++) {
    const c = old[i];
    if (wanted.includes(c.from_day)) continue;
    const lo = i > 0 ? old[i - 1].from_day : '';
    const hi = i + 1 < old.length ? old[i + 1].from_day : '9999-12-31';
    const cand = wanted.filter(d => !used.has(d) && d > lo && d < hi);
    if (cand.length > 1) return fail(`${c.patch} ab ${c.from_day} fehlt, an seiner Stelle stehen ${cand.join(', ')} — mehrdeutig`);
    if (cand.length === 0) {
      if (c.pinned) result.notes.push(`${c.patch} ab ${c.from_day} (pinned) steht nicht mehr in den Notes`);
      else result.findings.push(`${c.patch} ab ${c.from_day} steht nicht mehr in den Notes — bleibt stehen, bitte pruefen`);
      continue;
    }
    const d = cand[0];
    used.add(d);
    if (c.pinned) {
      result.notes.push(`${c.patch} ab ${c.from_day} ist pinned, Notes nennen ${d} — bleibt`);
      continue;
    }
    if (c.from_day < limit || d < limit) {
      return fail(`${c.patch} muesste von ${c.from_day} auf ${d} wandern — aelter als heute−${DATE_CHANGE_DAYS} (${limit})`);
    }
    cuts[i] = { ...c, from_day: d, source, detected_at: nowIso };
    result.changes.push(`${c.patch}: ${c.from_day} → ${d}`);
  }
  // 3) Uebrige Tage nur hinten anhaengen.
  const rest = wanted.filter(d => !used.has(d));
  const lastDay = cuts.length ? cuts[cuts.length - 1].from_day : '';
  const early = rest.filter(d => d <= lastDay);
  if (early.length) return fail(`neue Balance-Tage ${early.join(', ')} liegen vor dem letzten Schnitt ${cuts[cuts.length - 1].patch} (${lastDay}) — Buchstaben wuerden sich verschieben`);
  for (const d of rest) {
    const i = cuts.length;
    if (i > 24) return fail('mehr als 25 Schnitte');
    const c = { set, patch: base + letterAt(i), base, from_day: d, source, detected_at: nowIso };
    cuts.push(c);
    result.changes.push(`${c.patch} neu ab ${d}`);
  }
  result.cuts = cuts;
  return result;
}

// Gueltiger Schnitt dieser Basis (gleiche Regel wie readCuts in tft-patch-day).
// Kaputte Eintraege fasst der Lauf nicht an: sie bleiben in der Datei und
// erscheinen als Terminplan-Befund.
function isOwnCut(c, set, base) {
  return Number(c?.set) === set && baseOf(c?.base) === base && isDay(c?.from_day)
    && new RegExp(`^${base.replace('.', '\\.')}[a-z]$`).test(String(c?.patch));
}

const strip = cs => JSON.stringify(cs.map(({ detected_at, ...c }) => c));
const sortCuts = cs => [...cs].sort((a, b) => Number(a.set) - Number(b.set) || byDay(a, b));

// Ein kompletter Lauf ohne Datei- und Netzzugriff (fetchNotes wird uebergeben).
// Rueckgabe: { cuts, changed, exitCode, findings, conflicts, perBase }.
export async function run({ meta, today, nowIso, fetchNotes: fetcher, log = () => {} }) {
  const set = Number(meta?.setNumber);
  const stored = Array.isArray(meta?.patchCuts) ? meta.patchCuts : [];
  const findings = [];
  const conflicts = [];
  const perBase = {};
  if (!Number.isInteger(set) || set <= 0 || !isDay(today)) {
    return { cuts: stored, changed: false, exitCode: 1, findings, conflicts: [`ungueltige Eingabe: Set ${meta?.setNumber}, Tag ${today}`], perBase };
  }
  const baseline = scheduleProblems(meta, set);
  for (const p of baseline) findings.push(`Terminplan: ${p}`);
  const own = startsFor(meta, set);
  const bases = basesToCheck(meta, today);
  if (!bases.length) findings.push(`keine Basis fuer Set ${set} am ${today} gefunden`);
  log(`Basen am ${today}: ${bases.join(', ') || '—'}`);

  const merged = [];
  for (const base of bases) {
    const skip = msg => { perBase[base] = `uebersprungen: ${msg}`; findings.push(`${base}: ${msg}`); };
    let notes;
    try {
      notes = await fetcher(base);
    } catch (e) {
      skip(`Abruf fehlgeschlagen — ${e.message}`);
      continue;
    }
    if (!notes) {
      const started = own.some(s => s.patch === base && s.from_day <= today);
      if (started) skip('keine Notes (404)');
      else { perBase[base] = 'keine Notes (404), noch nicht live'; log(`  ${base}: keine Notes (404), noch nicht live`); }
      continue;
    }
    let updates;
    try {
      updates = parseMidpatch(notes.body, notes.publishIso);
    } catch (e) {
      skip(e.message);
      continue;
    }
    const pubDay = notes.publishIso.slice(0, 10);
    const odd = updates.filter(u => {
      const gap = (Date.parse(u.day) - Date.parse(pubDay)) / 86_400_000;
      return !(gap >= 0 && gap <= MAX_GAP_DAYS);
    });
    if (odd.length) {
      skip(`Update ${odd.map(u => `"${u.heading}" (${u.day})`).join(', ')} liegt mehr als ${MAX_GAP_DAYS} Tage neben der Veroeffentlichung ${pubDay}`);
      continue;
    }
    for (const u of updates) log(`  ${base} ${u.day} ${u.balance ? 'BALANCE' : 'kein Balance'}: ${u.categories.join(', ') || '—'}`);
    if (!updates.length) log(`  ${base}: keine Mid-Patch-Updates`);
    const existing = stored.filter(c => isOwnCut(c, set, base));
    const r = mergeBaseCuts({
      existing, days: updates.filter(u => u.balance).map(u => u.day),
      base, set, today, source: notes.url, nowIso,
    });
    if (r.conflict) {
      perBase[base] = `Abbruch: ${r.conflict}`;
      conflicts.push(r.conflict);
      continue;
    }
    for (const n of r.notes) log(`  ${base}: ${n}`);
    merged.push({ base, r });
  }
  if (conflicts.length) return { cuts: stored, changed: false, exitCode: 1, findings, conflicts, perBase };

  // Je Basis einsetzen und gegen den Terminplan pruefen. Neue Probleme
  // (gegenueber dem Stand vor dem Lauf) verwerfen nur diese Basis.
  let cuts = [...stored];
  for (const { base, r } of merged) {
    const candidate = [...cuts.filter(c => !isOwnCut(c, set, base)), ...r.cuts];
    const fresh = scheduleProblems({ ...meta, patchCuts: candidate }, set).filter(p => !baseline.includes(p));
    if (fresh.length) {
      perBase[base] = `verworfen: ${fresh.join('; ')}`;
      findings.push(`${base}: verworfen — ${fresh.join('; ')}`);
      continue;
    }
    cuts = candidate;
    findings.push(...r.findings.map(f => `${base}: ${f}`));
    perBase[base] = r.changes.length ? r.changes.join(', ') : 'unveraendert';
  }
  cuts = sortCuts(cuts);
  // Nur Inhalt zaehlt, nicht die Reihenfolge in der Datei.
  const changed = strip(cuts) !== strip(sortCuts(stored));
  return { cuts, changed, exitCode: findings.length ? 2 : 0, findings, conflicts, perBase };
}

// Gegenprobe MetaTFT — nur fuer die Basis von heute, nur Warnung.
async function metatftCheck(base, cuts) {
  if (!base) return;
  try {
    const r = await fetch(METATFT_URL, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20_000) });
    const mt = await r.json();
    const ours = cuts.filter(c => c.base === base).map(c => c.patch.slice(base.length)).pop() || '';
    if (mt.patch !== base) console.warn(`  WARN MetaTFT meldet Patch ${mt.patch}, wir ${base}`);
    else if ((mt.b_patch_version || '') !== ours) console.warn(`  WARN MetaTFT b_patch_version="${mt.b_patch_version}", Riot-Notes ergeben "${ours}"`);
    else console.log(`  MetaTFT stimmt ueberein (${mt.patch}${mt.b_patch_version || ''})`);
  } catch (e) {
    console.warn(`  WARN MetaTFT-Gegenprobe nicht moeglich: ${e.message}`);
  }
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const file = argValue(args, '--set-file') || OUT;
  const today = argValue(args, '--today') || currentWindowDay(new Date());
  if (!isDay(today)) throw new Error(`--today ungueltig: ${today}`);
  const meta = JSON.parse(readFileSync(file, 'utf8'));
  if (!meta?.setNumber) throw new Error(`${file} ohne setNumber`);

  const res = await run({ meta, today, nowIso: new Date().toISOString(), fetchNotes, log: console.log });
  await metatftCheck(patchForDay(today, meta).base, res.cuts);

  for (const [base, state] of Object.entries(res.perBase)) console.log(`  ${base}: ${state}`);
  for (const f of res.findings) console.warn(`  BEFUND ${f}`);
  for (const c of res.conflicts) console.error(`  ABBRUCH ${c}`);
  if (res.exitCode === 1) {
    console.error('FAIL: bestehender Schnitt muesste sich unerlaubt aendern — nichts geschrieben');
  } else if (!res.changed) {
    console.log('patchCuts unveraendert');
  } else {
    console.log('patchCuts neu:', JSON.stringify(res.cuts.filter(c => Number(c.set) === Number(meta.setNumber)).map(c => `${c.patch} ab ${c.from_day}`)));
    if (dry) console.log('(dry-run, nichts geschrieben)');
    else {
      writeFileSync(file, JSON.stringify({ ...meta, patchCuts: res.cuts }, null, 2) + '\n');
      console.log(`  -> ${file}`);
    }
  }
  process.exitCode = res.exitCode;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
