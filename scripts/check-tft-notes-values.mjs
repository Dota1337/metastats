#!/usr/bin/env node
/**
 * Melder: Stehen auf der Seite noch Zahlen, die Riots Notes des laufenden Patches
 * schon geaendert haben? Gemeldet wird nur „alter Wert steht noch da, neuer fehlt“.
 *
 * Bewusst ein Melder, kein Beweis der Richtigkeit: Zahlen, die Riot anders schreibt
 * als der Text, sieht er nicht. Laeuft im Daten-Lauf (tft-data-refresh.yml) und landet
 * als Issue, nie im pre-push: am Patchtag waere sonst jeder Push blockiert.
 *
 * Exit 0 sauber · 2 Befund · 1 Fehler
 *   node scripts/check-tft-notes-values.mjs [--today YYYY-MM-DD]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { changeMatchesName, livePatchOf, loadSetChanges } from './lib/tft-value-corrections.mjs';
import { isPercent, nameKey, seriesOf } from './lib/tft-riot-notes.mjs';
import { fetchNotes } from './detect-tft-bpatches.mjs';

// Einzelne Zahlen, ohne Riots Symbole („40 %i:scaleMR%“ sind nicht 40 %) und ohne
// Stellen einer Reihe: die 20 aus „15/20/100“ ist keine „20 %“ (Sivir).
function singleNumbers(text, pct) {
  const clean = String(text ?? '').replace(/<[^>]+>/g, ' ').replace(/%i:\w+%/g, ' ');
  const out = new Set();
  for (const m of clean.matchAll(/(?<![\d./])(\d+(?:\.\d+)?)(\s*%)?(?![\d./]|\s*\/)/g)) {
    if (!pct || m[2]) out.add(Number(m[1]));
  }
  return out;
}

// Reihen als Ganzes („190/285/470“), sonst schlaegt jede Einzelzahl im Text an.
function seriesIn(text) {
  return new Set((String(text ?? '').match(/(?<![\d./])\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+/g) ?? []));
}

/** Traegt der Text noch den alten Wert und nicht den neuen? */
export function staleInText(text, change) {
  const olds = seriesOf(change.old);
  const news = seriesOf(change.new);
  if (!olds.length || olds.length !== news.length) return false;
  if (olds.length > 1) {
    const have = [...seriesIn(text)];
    const hit = values => have.some(s => s === values.join('/') || s.startsWith(`${values.join('/')}/`));
    return hit(olds) && !hit(news);
  }
  // Alt nur mit Prozentzeichen, wenn Riot es so schreibt. Neu in jeder Form: „3 % ⇒
  // 2,5 %“ bei Bronze For Life II steht als „2.5 Armor“ da, und die 3 % im selben Text
  // sind etwas anderes.
  return singleNumbers(text, isPercent(change.old)).has(olds[0]) && !singleNumbers(text, false).has(news[0]);
}

/** Dasselbe fuer die Stufenwerte einer Synergie. */
export function staleInTrait(trait, change) {
  const olds = seriesOf(change.old);
  const news = seriesOf(change.new);
  if (!olds.length || olds.length !== news.length) return false;
  const pct = isPercent(change.old);
  const have = new Set();
  const add = vars => {
    for (const v of Object.values(vars ?? {})) {
      if (typeof v !== 'number') continue;
      // Prozent nur aus Anteilen: 5 Ruestung ist kein Beleg fuer 5 % AD.
      if (!pct) have.add(Math.round(v * 1000) / 1000);
      else if (Math.abs(v) < 5) { have.add(Math.round(v * 10000) / 100); have.add(Math.round((v - 1) * 10000) / 100); }
    }
  };
  for (const t of trait?.tiers ?? []) add(t.variables);
  add(trait?.variables);
  return olds.some((o, i) => have.has(o) && !have.has(news[i]));
}

// Zuruecknahmen raus: 18.5 „Alpha Mark Heal 4 % ⇒ 5 %“, Mid-Patch „Healing On-Hit
// 5 % ⇒ 4 %“ heben sich auf, die 4 % im Text stimmen (Brambleback, gemessen 01.11.).
export function withoutReverted(changes) {
  const key = side => seriesOf(side).join('/');
  // Der Name steht mal als Elternzeile, mal im Etikett („Brambleback: Healing On-Hit“).
  const sameThing = (a, b) => (nameKey(a.entity) && nameKey(a.entity) === nameKey(b.entity))
    || changeMatchesName(b, a.entity ?? '') || changeMatchesName(a, b.entity ?? '');
  const drop = new Set();
  changes.forEach((c, i) => {
    if (drop.has(i)) return;
    for (let j = i + 1; j < changes.length; j++) {
      const d = changes[j];
      if (drop.has(j) || !sameThing(c, d)) continue;
      if (key(d.old) === key(c.new) && key(d.new) === key(c.old)) { drop.add(i); drop.add(j); break; }
    }
  });
  return changes.filter((_, i) => !drop.has(i));
}

/** Prueft alle Zeilen. Rueckgabe: Liste der Befunde. */
export function findStale({ bundle, itemTexts, unitInfo, changes }) {
  const findings = [];
  const say = (kind, name, c) => findings.push(`${c.patch}${c.mid ? ' Mid-Patch' : ''} · ${kind} ${name} · ${c.label}: ${c.old} ⇒ ${c.new}`);

  const units = new Map();
  for (const [id, u] of Object.entries(unitInfo?.units ?? {})) {
    const name = bundle.champions?.[id]?.name ?? id;
    const key = nameKey(name);
    if (!units.has(key)) units.set(key, { name, texts: [] });
    units.get(key).texts.push(u.ability?.desc?.en ?? '');
  }
  const traits = new Map(Object.values(bundle.traits ?? {}).map(t => [nameKey(t.name), t]));
  // Gleicher Name kommt mehrfach vor (DA_* und alte Kennung): jeder Text zaehlt.
  const augments = new Map();
  for (const a of Object.values(bundle.augments ?? {})) {
    if (!a?.name || a.aliasOf) continue;
    const key = nameKey(a.name);
    if (!augments.has(key)) augments.set(key, { name: a.name, texts: [] });
    augments.get(key).texts.push(a.desc ?? '');
  }
  const items = new Map();
  for (const id of bundle.active?.items ?? []) {
    const name = bundle.items?.[id]?.name;
    const text = itemTexts?.items?.[id]?.i18n?.en;
    if (name && text) items.set(nameKey(name), { name, text: `${text.desc ?? ''} ${text.stats ?? ''}` });
  }

  const lookup = (map, c) => {
    const entity = nameKey(c.entity);
    if (entity && map.has(entity)) return map.get(entity);
    for (const [key, value] of map) if (key.length > 2 && changeMatchesName(c, value.name)) return value;
    return null;
  };

  for (const c of withoutReverted(changes)) {
    const unit = lookup(units, c);
    if (unit) { if (unit.texts.some(t => staleInText(t, c))) say('Unit', unit.name, c); continue; }
    const trait = lookup(traits, c);
    if (trait) { if (staleInTrait(trait, c)) say('Synergie', trait.name, c); continue; }
    const augment = lookup(augments, c);
    if (augment) { if (augment.texts.some(t => staleInText(t, c))) say('Augment', augment.name, c); continue; }
    // Radiant-Zeile unter dem Grundnamen: eigener Abschnitt („RADIANT ITEMS · Blue Buff“)
    // oder im Etikett („Hand of Justice · Radiant Omnivamp“).
    const isRadiant = /^radiant\b/i.test(c.label) || /radiant/i.test(c.section ?? '');
    const radiant = isRadiant ? items.get(nameKey(`Radiant ${c.entity ?? ''}`)) : null;
    const item = radiant ?? lookup(items, c);
    if (item && staleInText(item.text, c)) say('Item', item.name, c);
  }
  return findings;
}

async function main() {
  const at = process.argv.indexOf('--today');
  const today = at >= 0 ? process.argv[at + 1] : new Date().toISOString().slice(0, 10);
  const meta = JSON.parse(readFileSync('public/tft-set.json', 'utf8'));
  const set = meta.setNumber ?? meta.currentSet?.number;
  const read = f => JSON.parse(readFileSync(`public/${f}-${set}.json`, 'utf8'));
  const live = livePatchOf(meta, today);
  const changes = await loadSetChanges([live], fetchNotes);
  const findings = findStale({ bundle: read('tft-assets'), itemTexts: read('tft-item-texts'), unitInfo: read('tft-unit-info'), changes });
  console.log(`Patch ${live}: ${changes.length} Notes-Zeilen, ${findings.length} Befunde`);
  for (const f of findings) console.log(`BEFUND ${f}`);
  process.exitCode = findings.length ? 2 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
}
