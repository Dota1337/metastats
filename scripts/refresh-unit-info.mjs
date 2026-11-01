#!/usr/bin/env node
/**
 * Baut public/tft-unit-info-{set}.json: Faehigkeit (Name + Text in 6 Sprachen,
 * Werte je Stern schon eingesetzt) und Grundwerte jeder Unit fuer den
 * Umschalter Ability | Stats auf der Unit-Detailseite.
 *
 * Quellen:
 * - Faehigkeit: dieselben Sprachdateien von tactics.tools wie die Item-Texte
 * (refresh-item-texts.mjs), dort window.s{set}Unitsi18n mit "<id>_ability" (Name)
 *   und "<id>_desc" (Text mit Werten je Stern, z. B. "375/565/6500").
 *   CommunityDragon hat fuer Set 18 nur Platzhalter (@ManaCalc1@), bei 81 von
 *   91 Champions ohne Werte. Verworfen: MetaTFTs Nachschlagedatei — dort
 *   fehlen Kurvenwerte im Text (gemessen 19.10.2026: Ahri "within  hexes",
 *   Lux "(minimum )"), tactics.tools hat sie ("within 4 hexes", "minimum 40%").
 * - Grundwerte (Leben, Mana, Ruestung …): CommunityDragon, dieselbe Quelle wie
 *   public/tft-assets-*.json.
 *
 * Formen: Eine Unit mit mehreren Formen (Lux) steht im Bundle als eigene
 * Champions "Lux (Coven)" usw. Die Basis bekommt die Liste ihrer Formen, jede
 * Form ihren eigenen Eintrag mit eigenem Text.
 *
 * Schutz: fehlt die englische Datei oder kommen weniger als MIN_UNITS Units
 * mit Text zusammen, endet das Skript mit Exit 1 und die alte Datei bleibt
 * stehen. Eine fehlende Nebensprache wird nur gemeldet (Rueckfall Englisch).
 * Erfundene Werte gibt es nie: fehlt ein Wert, fehlt er in der Datei.
 *
 * Zahlen: tactics.tools hinkt hinterher (User 01.11.2026, „immer aktuell“). Darum
 * zwei Schritte auf dem Text, in dieser Reihenfolge:
 * 1. Zahlen aus MetaTFT, nur aus einer Datei des laufenden Patches. Sie werden in
 *    public/tft-unit-numbers-{set}.json festgehalten, weil die Datei dem Spiel schon
 *    wieder voraus ist, wenn der naechste Lauf kommt (tft-unit-numbers.mjs).
 * 2. Riots Notes in zeitlicher Folge, damit auch Mid-Patch-Werte stimmen, die MetaTFT
 *    nicht hat (tft-value-corrections.mjs).
 * Riots Seite nicht erreichbar: Abbruch, die alte Datei bleibt.
 */
import { readFileSync, existsSync } from 'node:fs';
import { loadCurrentSet } from './lib/current-set.mjs';
import { extractAssigned } from './refresh-item-texts.mjs';
import { fetchNotes } from './detect-tft-bpatches.mjs';
import { livePatchOf, loadSetChanges, patchesUpTo, replaySeries } from './lib/tft-value-corrections.mjs';
import { overlayNumbers, releasePatch, unitSeries } from './lib/tft-unit-numbers.mjs';
import { writeJsonIfChanged } from './lib/write-if-changed.mjs';

const LANGS = ['en', 'de', 'ko', 'zh', 'es', 'fr'];
const CDRAGON_URL = 'https://raw.communitydragon.org/latest/cdragon/tft/en_us.json';
const MIN_UNITS = 40;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

async function get(url, timeoutMs) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r;
}

const round = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

function statsOf(cd) {
  const s = cd?.stats;
  if (!s) return null;
  return {
    hp: round(s.hp), mana: round(s.mana), initialMana: round(s.initialMana), armor: round(s.armor),
    magicResist: round(s.magicResist), attackSpeed: round(s.attackSpeed), damage: round(s.damage),
    critChance: round(s.critChance), critMultiplier: round(s.critMultiplier), range: round(s.range),
  };
}

// Zahlen aus MetaTFT holen, wenn eine Datei zum laufenden Patch passt. Sonst bleibt
// der festgehaltene Stand. Ausfall ist kein Abbruch: dann gelten die Riot-Notes allein.
async function loadUnitNumbers(set, livePatch, champs) {
  const path = `public/tft-unit-numbers-${set}.json`;
  const known = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  for (const channel of ['latest', 'pbe']) {
    try {
      const url = `https://data.metatft.com/lookups/TFTSet${set}_${channel}_en_us.json`;
      const data = await (await get(url, 60_000)).json();
      const patch = releasePatch(data?._metadata);
      console.log(`       MetaTFT ${channel}: Release ${patch ?? '?'} (laufend ${livePatch})`);
      if (patch !== livePatch) continue;
      const byName = new Map((data.units || []).map(u => [u.name, u]));
      const units = {};
      for (const [id, c] of Object.entries(champs)) {
        const series = byName.has(c.name) ? unitSeries(byName.get(c.name)) : [];
        if (series.length) units[id] = series;
      }
      if (Object.keys(units).length < MIN_UNITS) {
        console.warn(`       WARN MetaTFT ${channel}: nur ${Object.keys(units).length} Units mit Zahlen — verworfen`);
        continue;
      }
      const out = { set, patch, release: data._metadata.release, source: url, fetchedAt: new Date().toISOString(), units };
      writeJsonIfChanged(path, out, d => JSON.stringify(d) + '\n');
      return out;
    } catch (err) {
      console.warn(`       WARN MetaTFT ${channel}: ${err.message}`);
    }
  }
  return known?.set === set ? known : null;
}

/** "Lux (Coven)" → { base: "Lux", form: "Coven" }; ohne Klammer null. */
export function splitFormName(name) {
  const m = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(String(name || ''));
  return m ? { base: m[1].trim(), form: m[2].trim() } : null;
}

async function main() {
  const set = loadCurrentSet();
  if (!set) throw new Error('public/tft-set.json nicht lesbar');
  const bundlePath = existsSync(`public/tft-assets-${set}.json`) ? `public/tft-assets-${set}.json` : 'public/tft-assets.json';
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
  if (bundle.set !== set) throw new Error(`${bundlePath} ist Set ${bundle.set}, erwartet ${set}`);
  const champs = bundle.champions || {};

  console.log(`[1/4] Set ${set}, ${Object.keys(champs).length} Champions aus ${bundlePath} — Sprachdateien laden`);
  const byLang = {};
  for (const lang of LANGS) {
    try {
      const url = `https://ap.tft.tools/static/s${set}/${lang}.js`;
      const obj = extractAssigned(await (await get(url, 30_000)).text(), `s${set}Unitsi18n`);
      if (!obj) throw new Error(`${url} → s${set}Unitsi18n nicht gefunden`);
      byLang[lang] = obj;
    } catch (err) {
      if (lang === 'en') throw err;
      console.warn(`       ${lang}: uebersprungen (${err.message})`);
    }
  }

  console.log('[2/4] CommunityDragon-Grundwerte laden');
  const cd = await (await get(CDRAGON_URL, 180_000)).json();
  const setData = (cd.setData || []).find(s => s.number === set && (!bundle.mutator || s.mutator === bundle.mutator))
    ?? (cd.setData || []).find(s => s.number === set);
  if (!setData) throw new Error(`CommunityDragon hat kein Set ${set}`);
  const cdById = new Map((setData.champions || []).map(c => [c.apiName, c]));

  console.log('[3/4] Units zuordnen');
  const units = {};
  const counts = Object.fromEntries(LANGS.map(l => [l, 0]));
  for (const id of Object.keys(champs).sort()) {
    const name = {}, desc = {};
    for (const lang of LANGS) {
      const d = byLang[lang]?.[`${id}_desc`];
      if (typeof d !== 'string' || !d.trim()) continue;
      desc[lang] = d;
      const n = byLang[lang][`${id}_ability`];
      if (typeof n === 'string' && n.trim()) name[lang] = n.trim();
      counts[lang]++;
    }
    if (!desc.en) continue;
    // Name der Unit je Sprache: Suchleiste von „What to build".
    const unitName = {};
    for (const lang of LANGS) {
      const n = byLang[lang]?.[id];
      if (typeof n === 'string' && n.trim()) unitName[lang] = n.trim();
    }
    units[id] = { name: unitName, stats: statsOf(cdById.get(id)), ability: { name, desc } };
  }
  // Formen an die Basis haengen: gleicher Grundname, gleiche Kosten.
  const baseByName = new Map();
  for (const [id, c] of Object.entries(champs)) if (!splitFormName(c.name)) baseByName.set(`${c.name}|${c.cost}`, id);
  for (const [id, c] of Object.entries(champs)) {
    const sp = splitFormName(c.name);
    const baseId = sp ? baseByName.get(`${sp.base}|${c.cost}`) : null;
    if (!baseId || !units[baseId] || !units[id]) continue;
    units[id].formOf = baseId;
    // Knopf-Beschriftung je Sprache: Name der Form ohne den Grundnamen
    // ("Lux Lunar" → "Lunar"); passt der Anfang nicht, der ganze Name.
    const formName = { en: sp.form };
    for (const lang of LANGS) {
      if (lang === 'en') continue;
      const full = byLang[lang]?.[id], base = byLang[lang]?.[baseId];
      if (typeof full !== 'string' || !full.trim()) continue;
      formName[lang] = (typeof base === 'string' && base && full.startsWith(base) ? full.slice(base.length) : full).trim() || full.trim();
    }
    units[id].form = formName;
    (units[baseId].forms ??= []).push(id);
  }
  for (const u of Object.values(units)) u.forms?.sort((a, b) => units[a].form.en.localeCompare(units[b].form.en));

  console.log('[3.5/4] Zahlen auf den Patch-Stand bringen');
  const meta = JSON.parse(readFileSync('public/tft-set.json', 'utf8'));
  const livePatch = livePatchOf(meta, new Date().toISOString().slice(0, 10));
  const numbers = await loadUnitNumbers(set, livePatch, champs);
  const changes = await loadSetChanges(patchesUpTo(meta, livePatch), fetchNotes);
  let overlaid = 0, replayed = 0;
  for (const [id, u] of Object.entries(units)) {
    if (numbers?.units?.[id]) {
      const r = overlayNumbers(u.ability.desc, numbers.units[id]);
      u.ability.desc = r.text;
      overlaid += r.replaced.length;
    }
    // Form „Lux (Coven)“ heisst in den Notes „Lux“.
    const r = replaySeries(u.ability.desc, String(champs[id]?.name ?? '').replace(/\s*\(.*\)$/, ''), changes);
    u.ability.desc = r.text;
    replayed += r.applied.length;
  }
  console.log(`       Patch ${livePatch}: MetaTFT-Stand ${numbers?.patch ?? '-'}, ${overlaid} Reihen aus MetaTFT, ${replayed} aus Riots Notes`);

  const total = Object.keys(units).length;
  console.log(`       Units mit Text: ${total} (${LANGS.map(l => `${l} ${counts[l]}`).join(', ')})`);
  const withForms = Object.entries(units).filter(([, u]) => u.forms).map(([id, u]) => `${id} (${u.forms.length})`);
  console.log(`       mit Formen: ${withForms.join(', ') || '-'}`);
  const noStats = Object.entries(units).filter(([, u]) => !u.stats).map(([id]) => id);
  if (noStats.length) console.warn(`       ohne CommunityDragon-Werte: ${noStats.join(', ')}`);
  if (total < MIN_UNITS) throw new Error(`Nur ${total} Units mit Text (< ${MIN_UNITS}). Format bei tactics.tools geaendert?`);

  const out = `public/tft-unit-info-${set}.json`;
  console.log(`[4/4] ${out} schreiben`);
  writeJsonIfChanged(out, {
    set,
    source: `ap.tft.tools/static/s${set} + communitydragon`,
    fetchedAt: new Date().toISOString(),
    counts,
    units,
  }, d => JSON.stringify(d) + '\n');
  console.log('       fertig.');
}

// Nur als Programm starten, nicht beim Import.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/refresh-unit-info.mjs')) {
  main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });
}
