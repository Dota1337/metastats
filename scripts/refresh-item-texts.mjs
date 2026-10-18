#!/usr/bin/env node
/**
 * Baut public/tft-item-texts-{set}.json aus den Sprachdateien von tactics.tools.
 *
 * Warum eine Fremdquelle: Fuer Set 18 liefert CommunityDragon bei den Items
 * keine Beschreibung (desc null, effects {} — gemessen 18.10.2026: 156 von 543
 * aktiven Items ohne Text, darunter alle normalen Items wie DA_Deathblade), und
 * Riots Stringtable hat keine tft18_da_*desc*-Schluessel. tactics.tools legt
 * die fertig aufgeloesten Texte je Sprache als JS-Datei ab:
 *   https://ap.tft.tools/static/s{set}/{lang}.js
 *   window.s{set}Itemsi18n = { "<id>": Name, "<id>_desc": Text, "<id>_statLine": Werte }
 *
 * Muster wie refresh-augment-stages.mjs: eigene Datei je Set, laeuft im
 * Wochen-Crawl vor dem Commit-Schritt, Loader app/lib/tft-item-texts.ts.
 *
 * Aus dem englischen Text werden zwei Spielregeln als feste Felder abgelegt,
 * damit der Builder nicht je Sprache nach Mustern suchen muss:
 *   unique: true  — "Unique - only 1 per champion"
 *   slots: 3      — "[Consumes 3 item slots.]" (Thief's Gloves)
 *
 * Schutz: fehlt die englische Datei oder kommen weniger als MIN_TEXTS Texte
 * zusammen, endet das Skript mit Exit 1 und die alte Datei bleibt stehen.
 * Eine fehlende Nebensprache wird nur gemeldet — der Builder faellt dort auf
 * Englisch zurueck. Erfundene Texte gibt es nie (feedback_no_fake_values).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { loadCurrentSet } from './lib/current-set.mjs';

const LANGS = ['en', 'de', 'ko', 'zh', 'es', 'fr'];
const MIN_TEXTS = 100;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// Objekt-Literal hinter `window.<name> =` herausschneiden. Die Dateien sind
// reines JSON in einer Zuweisung; Klammern in Strings werden uebersprungen.
export function extractAssigned(src, name) {
  const at = src.indexOf(`window.${name}`);
  if (at < 0) return null;
  const start = src.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(src.slice(start, i + 1));
  }
  return null;
}

async function fetchLang(set, lang) {
  const url = `https://ap.tft.tools/static/s${set}/${lang}.js`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  const obj = extractAssigned(await r.text(), `s${set}Itemsi18n`);
  if (!obj) throw new Error(`${url} → s${set}Itemsi18n nicht gefunden`);
  return obj;
}

async function main() {
  const set = loadCurrentSet();
  if (!set) throw new Error('public/tft-set.json nicht lesbar');
  const bundlePath = existsSync(`public/tft-assets-${set}.json`) ? `public/tft-assets-${set}.json` : 'public/tft-assets.json';
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
  if (bundle.set !== set) throw new Error(`${bundlePath} ist Set ${bundle.set}, erwartet ${set}`);
  const active = Array.isArray(bundle.active?.items) && bundle.active.items.length
    ? bundle.active.items
    : Object.keys(bundle.items || {});
  console.log(`[1/3] Set ${set}, ${active.length} aktive Items aus ${bundlePath}`);

  const byLang = {};
  for (const lang of LANGS) {
    try {
      byLang[lang] = await fetchLang(set, lang);
      console.log(`       ${lang}: ${Object.keys(byLang[lang]).length} Schluessel`);
    } catch (err) {
      if (lang === 'en') throw err;
      console.warn(`       ${lang}: uebersprungen (${err.message})`);
    }
  }

  console.log('[2/3] Texte zuordnen');
  const en = byLang.en;
  const items = {};
  const counts = Object.fromEntries(LANGS.map(l => [l, 0]));
  for (const id of [...active].sort()) {
    const enDesc = en[`${id}_desc`];
    if (typeof enDesc !== 'string' || !enDesc.trim()) continue;
    const entry = { i18n: {} };
    if (/Unique - only 1 per champion/i.test(enDesc)) entry.unique = true;
    if (/Consumes 3 item slots/i.test(enDesc)) entry.slots = 3;
    for (const lang of LANGS) {
      const src = byLang[lang];
      const desc = src?.[`${id}_desc`];
      if (typeof desc !== 'string' || !desc.trim()) continue;
      const loc = { desc };
      // Englischer Anzeigename kommt aus dem Bundle (tactics.tools schreibt
      // z. B. "Mogul'sMail"); die anderen Sprachen haben im Bundle keinen Namen.
      if (lang !== 'en' && typeof src[id] === 'string' && src[id].trim()) loc.name = src[id];
      const stats = src[`${id}_statLine`];
      if (typeof stats === 'string' && stats.trim()) loc.stats = stats;
      entry.i18n[lang] = loc;
      counts[lang]++;
    }
    items[id] = entry;
  }
  console.log(`       Items mit Text: ${Object.keys(items).length} (${LANGS.map(l => `${l} ${counts[l]}`).join(', ')})`);
  console.log(`       unique: ${Object.entries(items).filter(([, e]) => e.unique).map(([k]) => k).join(', ') || '-'}`);
  console.log(`       3 Plaetze: ${Object.entries(items).filter(([, e]) => e.slots === 3).map(([k]) => k).join(', ') || '-'}`);
  if (counts.en < MIN_TEXTS) {
    throw new Error(`Nur ${counts.en} englische Texte (< ${MIN_TEXTS}). Format bei tactics.tools geaendert?`);
  }

  const out = `public/tft-item-texts-${set}.json`;
  console.log(`[3/3] ${out} schreiben`);
  writeFileSync(out, JSON.stringify({
    set,
    source: `ap.tft.tools/static/s${set}`,
    fetchedAt: new Date().toISOString(),
    counts,
    items,
  }) + '\n');
  console.log('       fertig.');
}

// Nur als Programm starten, nicht beim Import (Test importiert extractAssigned).
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/refresh-item-texts.mjs')) {
  main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
}
