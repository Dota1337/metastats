#!/usr/bin/env node
// Erkennt B-Patches (Mid-Patch-Balance-Updates) aus Riots offiziellen
// Patchnotes und traegt sie als Schnitt in public/tft-set.json ein:
//   patchCuts: [{ set, patch: "18.1b", base: "18.1", from_day: "2026-09-01", source, detected_at }]
//
// Warum: Riot liefert im Match keinen Patch. Der Crawler stempelt jeden
// Sammeltag mit tft-set.json — ohne Schnitt landen Tage vor und nach einem
// Balance-Update im selben Patch (scripts/collect-tft-allranks.mjs resolvePatch).
//
// Regeln (User-Entscheid 2026-09-13):
//   • Nur Balance zaehlt (Traits, Champions, Items …). Reine Bugfix-/Feature-
//     /Double-Up-Updates → kein Schnitt.
//   • Unbekannte Kategorie → lauter Abbruch, nichts wird geschrieben.
//   • Ueberschrift "X AND Y" (Rollout ueber zwei Tage) → Schnitt ab Y.
// MetaTFT (tft-stat-api/patch, Feld b_patch_version) ist nur Gegenprobe:
// Abweichung → Warnung, kein Abbruch.
//
//   node scripts/detect-tft-bpatches.mjs [--dry-run]

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = 'public/tft-set.json';
const notesUrl = base => `https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-${base.replace('.', '-')}/`;
const METATFT_URL = 'https://api-hc.metatft.com/tft-stat-api/patch';

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
    if (h[1] === '3') {
      const day = headingDay(label, publishIso);
      if (!day) throw new Error(`Datums-Ueberschrift nicht lesbar: "${label}"`);
      updates.push({ day, heading: label, categories: [], balance: false });
      continue;
    }
    const cur = updates[updates.length - 1];
    if (!cur) throw new Error(`Kategorie "${label}" ohne Datums-Ueberschrift`);
    if (BALANCE.has(label)) cur.balance = true;
    else if (!NON_BALANCE.has(label)) throw new Error(`Unbekannte Kategorie "${label}" (${cur.heading}) — Liste in detect-tft-bpatches.mjs pruefen`);
    cur.categories.push(label);
  }
  return updates;
}

// Balance-Tage → Schnitte 18.1b, 18.1c … in zeitlicher Reihenfolge.
export function cutsFor(set, base, updates, source, nowIso) {
  const days = [...new Set(updates.filter(u => u.balance).map(u => u.day))].sort();
  return days.map((from_day, i) => ({
    set, patch: base + String.fromCharCode(98 + i), base, from_day, source, detected_at: nowIso,
  }));
}

async function fetchNotes(base) {
  const url = notesUrl(base);
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  const html = await r.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`${url}: __NEXT_DATA__ fehlt — Seitenaufbau geaendert?`);
  const page = JSON.parse(m[1])?.props?.pageProps?.page;
  const body = (page?.blades || []).map(b => b?.richText?.body).filter(Boolean).join('\n');
  if (!body || !page?.displayedPublishDate) throw new Error(`${url}: kein Notes-Text gefunden — Seitenaufbau geaendert?`);
  return { url, body, publishIso: page.displayedPublishDate };
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const stored = JSON.parse(readFileSync(OUT, 'utf8'));
  const set = stored.setNumber;
  const latestBase = String(stored.latestPatch || '').match(/^(\d+)\.(\d+)/);
  if (!set || !latestBase) throw new Error(`tft-set.json ohne setNumber/latestPatch`);
  const minor = Number(latestBase[2]);
  // Aktueller Patch und der davor: ein Balance-Update wird oft erst im Nachgang
  // in den Notes des laufenden Patches nachgetragen, der Vorpatch bleibt
  // aber pruefenswert, bis der neue Patch Daten hat.
  const bases = [`${set}.${minor}`, ...(minor > 1 ? [`${set}.${minor - 1}`] : [])];
  const nowIso = new Date().toISOString();

  const detected = [];
  const checked = [];
  for (const base of bases) {
    const notes = await fetchNotes(base);
    if (!notes) { console.log(`  ${base}: keine Notes (404) — uebersprungen`); continue; }
    const updates = parseMidpatch(notes.body, notes.publishIso);
    const pubDay = notes.publishIso.slice(0, 10);
    for (const u of updates) {
      const gap = (Date.parse(u.day) - Date.parse(pubDay)) / 86_400_000;
      if (gap < 0 || gap > 28) throw new Error(`${base}: Update "${u.heading}" (${u.day}) liegt ${gap} Tage neben der Veroeffentlichung ${pubDay}`);
      console.log(`  ${base} ${u.day} ${u.balance ? 'BALANCE' : 'kein Balance'}: ${u.categories.join(', ')}`);
    }
    const cuts = cutsFor(set, base, updates, notes.url, nowIso);
    if (!updates.length) console.log(`  ${base}: keine Mid-Patch-Updates`);
    detected.push(...cuts);
    checked.push(base);
  }

  // Gegenprobe MetaTFT — nur fuer den aktuellen Patch, nur Warnung.
  try {
    const r = await fetch(METATFT_URL, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20_000) });
    const mt = await r.json();
    const ours = detected.filter(c => c.base === bases[0]).map(c => c.patch.slice(bases[0].length)).pop() || '';
    if (mt.patch !== bases[0]) console.warn(`  WARN MetaTFT meldet Patch ${mt.patch}, wir ${bases[0]}`);
    else if ((mt.b_patch_version || '') !== ours) console.warn(`  WARN MetaTFT b_patch_version="${mt.b_patch_version}", Riot-Notes ergeben "${ours}"`);
    else console.log(`  MetaTFT stimmt ueberein (${mt.patch}${mt.b_patch_version || ''})`);
  } catch (e) {
    console.warn(`  WARN MetaTFT-Gegenprobe nicht moeglich: ${e.message}`);
  }

  // Zusammenfuehren: gepruefte Basis-Patches ersetzen, alles andere behalten.
  const old = stored.patchCuts || [];
  const keep = old.filter(c => !(c.set === set && checked.includes(c.base)));
  const merged = [...keep, ...detected.map(c => {
    const same = old.find(o => o.set === c.set && o.patch === c.patch && o.from_day === c.from_day);
    return same ? { ...c, detected_at: same.detected_at } : c;
  })].sort((a, b) => a.set - b.set || a.from_day.localeCompare(b.from_day));

  const strip = cs => JSON.stringify(cs.map(({ detected_at, ...c }) => c));
  if (strip(merged) === strip(old)) { console.log('patchCuts unveraendert'); return; }
  console.log('patchCuts neu:', JSON.stringify(merged.map(c => `${c.patch} ab ${c.from_day}`)));
  if (dry) { console.log('(dry-run, nichts geschrieben)'); return; }
  writeFileSync(OUT, JSON.stringify({ ...stored, patchCuts: merged }, null, 2) + '\n');
  console.log(`  -> ${OUT}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
