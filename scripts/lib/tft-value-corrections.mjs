// Zahlen, die in den Rohdaten fehlen oder veraltet sind, aus Riots Patch-Notes
// nachziehen. User 01.11.2026: „Mit jedem Patch kommen ja neue Zahlen und wir
// muessen diese ebenfalls immer aktuell haben“.
//
// Warum das noetig ist (gemessen 01.11.2026, Riot 18.5):
// - CDragon latest traegt manche Aenderungen des laufenden Patches noch nicht:
//   Riftbeast (7) AD/AP 6 % statt 5 %, Nesting Anvils 4 statt 6 Gold. CDragon pbe
//   hat die neuen Werte. Das passiert haeufig, Rapidfire aus 18.2 kam einen Monat
//   zu spaet.
// - Faehigkeits-Texte kommen von tactics.tools und liegen mehrere Patches zurueck
//   (Kha'Zix 285/400/580, Riot 27.10. 230/310/450). CDragon hat dort gar keine Werte.
//
// Drei Wege, alle mit Riots Notes als Massstab:
// 1. correctFromNotes: Rohwert weicht von pbe ab UND eine Notes-Zeile derselben
//    Sache sagt exakt Alt ⇒ Neu. Zieht CDragon nach, gibt es keinen Unterschied
//    mehr und die Korrektur faellt von selbst weg. Ohne Zeile bleibt der Wert:
//    dann kommt er erst mit dem naechsten Patch (Taric-Mana, Blossom am 01.11.).
// 2. replaySeries: Zahlenreihen im Text in zeitlicher Folge ersetzen. Nur Reihen
//    („190/285/470“), einzelne Zahlen sind nicht eindeutig genug.
// 3. Tabellen von Hand fuer das, was 1 und 2 nicht erreichen. Passt der Wert nicht
//    mehr, wird gemeldet und nichts geaendert, nie abgebrochen: der Abruf laeuft
//    mit vielen anderen Daten, ein Abbruch liesse sie still veralten.

import { nameKey, seriesOf, isPercent, parseRiotChanges } from './tft-riot-notes.mjs';
import { createHash } from 'node:crypto';

const NEAR = 0.0015;
const near = (a, b) => Math.abs(a - b) < NEAR;

// Riot speichert Werte teils unter dem Hash des Namens, FNV-1a-32 ueber den
// kleingeschriebenen Namen (`{1b76cfed}` = CapstoneAD).
export function binHash(name) {
  let h = 0x811c9dc5;
  for (const ch of String(name).toLowerCase()) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `{${h.toString(16).padStart(8, '0')}}`;
}

/**
 * Gehoert eine Notes-Zeile zu dieser Sache? Name steht als Elternzeile, am Ende
 * einer verklebten Elternzeile („… other line Bronze for Life II“) oder vorn im
 * Etikett („Camille Ability Damage“).
 */
export function changeMatchesName(change, name) {
  const key = nameKey(name);
  if (!key) return false;
  const entity = nameKey(change.entity);
  if (entity && (entity === key || entity.endsWith(key))) return true;
  // Vorn im Etikett gewinnt auch bei fremder Elternzeile: flache Listen erben den
  // letzten Namen davor (18.4: „Camille Ability Damage: …“).
  return nameKey(change.label).startsWith(key);
}

// Passt Rohwert → pbe-Wert zur Zeile? Reihen werden stellenweise verglichen,
// Prozent-Zeilen auch als Anteil (6 % = 0,06).
export function changeMatchesValues(change, from, to) {
  const olds = seriesOf(change.old);
  const news = seriesOf(change.new);
  if (!olds.length || olds.length !== news.length) return false;
  const scales = isPercent(change.old) || isPercent(change.new) ? [1, 100] : [1];
  for (let i = 0; i < olds.length; i++) {
    for (const s of scales) {
      if (near(from * s, olds[i]) && near(to * s, news[i])) return true;
    }
  }
  return false;
}

function numericDiffs(live, pbe) {
  const out = [];
  if (!live || !pbe) return out;
  for (const [key, value] of Object.entries(live)) {
    const next = pbe[key];
    if (typeof value === 'number' && typeof next === 'number' && !near(value, next)) out.push({ key, from: value, to: next });
  }
  return out;
}

/**
 * Regel 1 auf den Rohdaten. Aendert `cd` und `localeItems` an Ort und Stelle,
 * damit alle Sprachen dieselben Zahlen bekommen (Augment-Texte werden beim Bauen
 * je Sprache aus ihren `effects` aufgeloest). Rueckgabe: { applied, unmatched }.
 */
export function correctFromNotes({ activeSet, pbeSet, items, pbeItems, localeItems, changes }) {
  const applied = [];
  const unmatched = [];
  const lineFor = (name, from, to) => changes.find(c => changeMatchesName(c, name) && changeMatchesValues(c, from, to));

  const pbeTraits = new Map((pbeSet?.traits || []).map(t => [t.apiName, t]));
  for (const trait of activeSet?.traits || []) {
    const other = pbeTraits.get(trait.apiName);
    if (!other) continue;
    for (const effect of trait.effects || []) {
      const twin = (other.effects || []).find(e => e.minUnits === effect.minUnits);
      for (const d of numericDiffs(effect.variables, twin?.variables)) {
        const line = lineFor(trait.name, d.from, d.to);
        const row = { kind: 'trait', id: trait.apiName, name: trait.name, tier: effect.minUnits ?? null, ...d };
        if (!line) { unmatched.push(row); continue; }
        effect.variables[d.key] = d.to;
        applied.push({ ...row, patch: line.patch, line: `${line.label}: ${line.old} ⇒ ${line.new}` });
      }
    }
  }

  const pbeById = new Map((pbeItems || []).map(i => [i.apiName, i]));
  for (const item of items || []) {
    const other = pbeById.get(item.apiName);
    if (!other) continue;
    for (const d of numericDiffs(item.effects, other.effects)) {
      const line = lineFor(item.name, d.from, d.to);
      const row = { kind: 'item', id: item.apiName, name: item.name, ...d };
      if (!line) { unmatched.push(row); continue; }
      item.effects[d.key] = d.to;
      for (const map of Object.values(localeItems || {})) {
        const loc = map.get(item.apiName);
        if (loc?.effects && loc !== item && typeof loc.effects[d.key] === 'number') loc.effects[d.key] = d.to;
      }
      applied.push({ ...row, patch: line.patch, line: `${line.label}: ${line.old} ⇒ ${line.new}` });
    }
  }
  return { applied, unmatched };
}

/**
 * Ersatz fuer den Testserver, wenn CDragon pbe nicht antwortet (522 seit 12.11.2026,
 * User 13.11.: Fehler-Mails alle 3 h). Baut aus den Notes-Korrekturen des letzten
 * Bundles ein pbe im selben Format, `correctFromNotes` laeuft dann unveraendert:
 * eine Korrektur greift nur, solange latest noch den alten Wert hat UND die
 * Notes-Zeile noch steht. Neue Mid-Patch-Aenderungen fehlen bis pbe zurueck ist.
 *
 * - Eintraege derselben Sache in EINEN Eintrag (Blossom Stufe 7 und 9): correctFromNotes
 *   sammelt pbe je apiName, ein zweiter Eintrag wuerde den ersten verdraengen.
 * - Synergie-Werte aus dem letzten Bundle (`previousTraits`), wenn nahe an `to`: dort
 *   steht der Rohwert (0.550000011920929), `to` ist gerundet (0.55) — sonst aendert
 *   sich die Datei ohne Grund, mit Commit und Deploy.
 * - Ruecknahme: sagt eine spaetere Zeile derselben Sache Neu ⇒ Alt, faellt die
 *   Korrektur weg. Im Normalweg traegt pbe die Ruecknahme selbst, hier nicht.
 *   Bewusst nicht `withoutReverted` aus dem Melder: das bildet unter
 *   Sammelueberschriften auch falsche Paare.
 */
export function pbeFromCorrections(corrections, { activeSet, items, changes, previousTraits }) {
  const names = {
    trait: new Map((activeSet?.traits || []).map(t => [t.apiName, t.name])),
    item: new Map((items || []).map(i => [i.apiName, i.name])),
  };
  const lastIndex = (name, from, to) => changes.findLastIndex(c => changeMatchesName(c, name) && changeMatchesValues(c, from, to));
  const traits = new Map();
  const itemMap = new Map();
  const dropped = [];
  for (const c of corrections || []) {
    if (c?.via !== 'notes' || typeof c.from !== 'number' || typeof c.to !== 'number') continue;
    const name = names[c.kind]?.get(c.id);
    if (!name) continue;
    if (lastIndex(name, c.to, c.from) > lastIndex(name, c.from, c.to)) { dropped.push(c); continue; }
    if (c.kind === 'trait') {
      const prev = previousTraits?.[c.id];
      const prevBag = c.tier == null ? prev?.variables : prev?.tiers?.find(t => t.minUnits === c.tier)?.variables;
      const raw = prevBag?.[c.key];
      const value = typeof raw === 'number' && near(raw, c.to) ? raw : c.to;
      if (!traits.has(c.id)) traits.set(c.id, { apiName: c.id, effects: [] });
      const effects = traits.get(c.id).effects;
      // Ohne Stufe (Eclipse) fehlt minUnits auch im Rohformat: null wuerde nie passen.
      let effect = effects.find(e => e.minUnits === (c.tier ?? undefined));
      if (!effect) { effect = c.tier == null ? { variables: {} } : { minUnits: c.tier, variables: {} }; effects.push(effect); }
      effect.variables[c.key] = value;
    } else if (c.kind === 'item') {
      if (!itemMap.has(c.id)) itemMap.set(c.id, { apiName: c.id, effects: {} });
      itemMap.get(c.id).effects[c.key] = c.to;
    }
  }
  return { pbeSet: { traits: [...traits.values()] }, pbeItems: [...itemMap.values()], dropped };
}

// Reihe im Text: nicht mitten in einer laengeren Reihe, darf aber der Anfang einer
// laengeren sein („225/335“ in „225/335/1000“, Riot nennt die 3-Sterne-Zahl nur
// wenn sie sich aendert).
function seriesPattern(values) {
  const body = values.map(v => String(v).replace('.', '\\.')).join('/');
  return new RegExp(`(?<![\\d./])${body}(?![\\d.]|/?\\.)`, 'g');
}

/**
 * Regel 2: Riots Zeilen in zeitlicher Folge auf einen Text je Sprache anwenden.
 * Zahlenreihen sind sprachneutral, also gilt derselbe Ersatz ueberall. Wer auf einem
 * alten Stand steht, laeuft die Kette nach (Kha'Zix 255/… ⇒ 250/… ⇒ 230/…).
 */
export function replaySeries(textByLang, name, changes) {
  const out = { ...textByLang };
  const applied = [];
  for (const c of changes) {
    if (!changeMatchesName(c, name)) continue;
    const olds = seriesOf(c.old);
    const news = seriesOf(c.new);
    if (olds.length < 2 || olds.length !== news.length) continue;
    const re = seriesPattern(olds);
    if (!re.test(out.en ?? '')) continue;
    const to = news.join('/');
    for (const lang of Object.keys(out)) out[lang] = String(out[lang]).replace(seriesPattern(olds), to);
    applied.push({ patch: c.patch, mid: !!c.mid, label: c.label, from: olds.join('/'), to });
  }
  return { text: out, applied };
}

// ----------------------------------------------------------- Tabellen von Hand

const SOURCE_185 = 'https://teamfighttactics.leagueoflegends.com/en-us/news/game-updates/teamfight-tactics-patch-18-5/';

/**
 * Item-Texte (public/tft-item-texts-*.json) kommen von tactics.tools und tragen
 * die Mid-Patch-Werte nicht. Zahlen im Fliesstext ohne Reihe sind fuer eine
 * Automatik nicht eindeutig, deshalb von Hand. `patches`: solange gilt der Eintrag.
 */
export const ITEM_TEXT_CORRECTIONS = Object.freeze([
  { id: 'DA_HandOfJustice', from: '15%', to: '12%', patches: ['18.5', '18.6'], source: SOURCE_185 },
  { id: 'DA_HandOfJusticeRadiant', from: '30%', to: '25%', patches: ['18.5', '18.6'], source: SOURCE_185 },
  { id: 'DA_BlueBuffRadiant', field: 'stats', from: '30%', to: '25%', hits: 2, patches: ['18.5', '18.6'], source: SOURCE_185 },
  { id: 'DA_AdaptiveHelm_Radiant', field: 'stats', from: '7', to: '6', patches: ['18.5', '18.6'], source: SOURCE_185 },
  { id: 'DA_AdaptiveHelm_Radiant', from: '40%', to: '35%', patches: ['18.5', '18.6'], source: SOURCE_185 },
]);

/**
 * Rohwerte, die weder pbe noch eine exakte Notes-Zeile hergeben. `cdragon`: nur fuer
 * diese Version, danach wirkungslos und gemeldet.
 * Omega Riftbeast: Notes 18.5 „Bonus HP 10% ⇒ 8%, Bonus AS 10% ⇒ 8%“, CDragon latest
 * steht noch auf dem Stand davor (15 % und 12 %), pbe hat 8 % und 8 %.
 */
export const VALUE_CORRECTIONS = Object.freeze([
  { kind: 'item', id: 'DA_18_RiftbeastTraitAugment', key: 'BonusHP', cdragon: '16.21', from: 0.15, to: 0.08, source: SOURCE_185 },
  { kind: 'item', id: 'DA_18_RiftbeastTraitAugment', key: 'BonusAS', cdragon: '16.21', from: 0.12, to: 0.08, source: SOURCE_185 },
]);

/**
 * Zeilen, die in Riots Notes fehlen, damit die Kette nicht abreisst. Kha'Zix: 18.3
 * Mid-Patch endet bei 265/370/535, 18.5 beginnt bei 255/360/515, dazwischen gibt es
 * keine Zeile. `before`: wird vor den Zeilen dieses Patches eingereiht.
 */
export const NOTE_GAPS = Object.freeze([
  { entity: "Kha'Zix", label: 'Base Damage', old: '265/370/535', new: '255/360/515', before: '18.5', patch: '18.4', mid: true },
]);

const numberPattern = token => {
  const m = /^(-?\d+(?:\.\d+)?)(%?)$/.exec(token);
  if (!m) return null;
  // `i:` schliesst Riots Symbol-Platzhalter aus: „40 %i:scaleMR%“ sind nicht 40 %.
  return new RegExp(`(?<![\\d./])${m[1].replace('.', '\\.')}(\\s*${m[2]})(?![\\d/]|i:)`, 'g');
};

/**
 * Tabellen-Ersatz in einem Textfeld je Sprache (`field`, sonst desc). Trifft die Zahl
 * im englischen Text nicht so oft wie erwartet (`hits`, sonst einmal), passiert nichts
 * und die Meldung sagt warum.
 */
export function correctItemText(i18n, entry, livePatch) {
  if (!entry.patches.includes(livePatch)) return { i18n, status: 'expired' };
  const field = entry.field ?? 'desc';
  const from = numberPattern(entry.from);
  const to = numberPattern(entry.to);
  const en = i18n?.en?.[field] ?? '';
  const hits = (en.match(from) || []).length;
  if (hits === 0) return { i18n, status: (en.match(to) || []).length ? 'already' : 'missing' };
  if (hits !== (entry.hits ?? 1)) return { i18n, status: 'ambiguous' };
  const value = /^-?\d+(?:\.\d+)?/.exec(entry.to)[0];
  const out = {};
  for (const [lang, loc] of Object.entries(i18n)) {
    out[lang] = { ...loc, [field]: String(loc[field]).replace(numberPattern(entry.from), `${value}$1`) };
  }
  return { i18n: out, status: 'applied' };
}

/** Rohwerte per Tabelle. Andere Version oder anderer Wert: nichts tun, melden. */
export function applyValueTable({ traits, items, version, table = VALUE_CORRECTIONS }) {
  const applied = [];
  const notes = [];
  for (const e of table) {
    if (e.cdragon && !String(version).startsWith(`${e.cdragon}.`)) {
      notes.push(`${e.id} ${e.key}: Eintrag gilt fuer CDragon ${e.cdragon}, aktuell ${version} — bitte loeschen`);
      continue;
    }
    const bag = e.kind === 'trait'
      ? traits?.find(t => t.apiName === e.id)?.effects?.find(x => x.minUnits === e.tier)?.variables
      : items?.find(i => i.apiName === e.id)?.effects;
    const raw = bag?.[e.key];
    if (typeof raw !== 'number') { notes.push(`${e.id} ${e.key}: Feld fehlt`); continue; }
    if (near(raw, e.to)) { notes.push(`${e.id} ${e.key}: Quelle hat ${e.to} schon — bitte loeschen`); continue; }
    if (!near(raw, e.from)) { notes.push(`${e.id} ${e.key}: Quelle hat ${raw}, Tabelle erwartet ${e.from}`); continue; }
    bag[e.key] = e.to;
    applied.push({ kind: e.kind, id: e.id, key: e.key, from: e.from, to: e.to, source: e.source });
  }
  return { applied, notes };
}

// ----------------------------------------------------------- Patch und Notes

const patchDays = meta => (meta?.patchStarts ? Object.values(meta.patchStarts) : []);

/** Der heute laufende Patch laut Terminplan. `latestPatch` kippt erst am Tag danach. */
export function livePatchOf(meta, todayIso) {
  const set = meta?.setNumber ?? meta?.currentSet?.number;
  const starts = patchDays(meta)
    .filter(s => s?.set === set && s.patch && s.from_day <= todayIso)
    .sort((a, b) => (a.from_day < b.from_day ? -1 : 1));
  return starts.at(-1)?.patch ?? meta?.latestPatch ?? null;
}

/** Alle Patches des Sets bis zum laufenden, aeltester zuerst. */
export function patchesUpTo(meta, livePatch) {
  const set = meta?.setNumber ?? meta?.currentSet?.number;
  const minor = Number(String(livePatch).split('.')[1]);
  if (!Number.isInteger(minor)) return [];
  const out = [];
  for (let i = 1; i <= minor; i++) out.push(`${set}.${i}`);
  return out;
}

/**
 * Riots Zeilen aller Patches des Sets, zeitlich. 404 ist normal (Seite noch nicht
 * da, Patch ohne eigene Notes); Netzfehler werfen, denn ohne Notes wuerde eine
 * Korrektur still wegfallen und alte Zahlen kaemen zurueck.
 */
export async function loadSetChanges(patches, fetchNotes) {
  const changes = [];
  for (const patch of patches) {
    changes.push(...NOTE_GAPS.filter(g => g.before === patch));
    const notes = await fetchNotes(patch);
    if (notes) changes.push(...parseRiotChanges(notes.body, patch));
  }
  return changes;
}

/** Fingerabdruck der Zeilen: aendert sich nur, wenn Riot wirklich etwas aendert. */
export function changesFingerprint(changes) {
  const lines = changes.map(c => `${c.patch}|${c.mid ? 1 : 0}|${c.entity}|${c.label}|${c.old}|${c.new}`);
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}
