#!/usr/bin/env node
/**
 * Erzeugt app/lib/seo/known-ids.generated.json: alle Kennungen, zu denen es
 * eine Detailseite gibt (Units, Items, Traits aus jedem public/tft-assets-N.json,
 * Teams aus public/pro-teams.json), dazu die festen Unterseiten neben den
 * dynamischen Segmenten (app/tft/comps/atlas …). Die Middleware beantwortet
 * damit erfundene Adressen mit einer echten 404 (app/lib/seo/not-found-gate.ts,
 * SEO-Plan Schritt 2).
 *
 * Nicht eingecheckt (.gitignore), wie die pro-teams-Derivate: die Datei
 * entsteht im selben Lauf wie die Quellen, die sie liest — in `postinstall`,
 * `build`, `dev` und `pretest`. Damit gibt es keine Kopie, die hinter den
 * Bundles herlaufen kann, und keinen Bot, der sie mitschreiben muss.
 *
 * Bricht NIE ab: fehlt eine Quelle (z. B. tft-set.json steht schon auf dem
 * naechsten Set, dessen Bundle aber noch nicht da ist), wird mit dem
 * gerechnet, was da ist; geht gar nichts, entsteht eine leere Liste, und die
 * Pruefung laesst alles durch. Ein Build darf an dieser Datei nie scheitern.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DST = resolve(ROOT, 'app/lib/seo/known-ids.generated.json');
const readJson = p => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

// Routen, deren letztes Segment die Pruefung kennt (not-found-gate.ts).
const GATED_ROUTES = ['tft/units', 'tft/items', 'tft/traits', 'tft/comps', 'teams'];

const EMPTY = {
  currentSet: null, sets: [], plausiblePrefixes: [], units: [], items: [], traits: [], teams: [], staticSegments: {},
};

// Feste Ordner neben dem dynamischen Segment: app/tft/comps/atlas usw. Kommt
// eine neue Unterseite dazu, steht sie beim naechsten Lauf automatisch hier.
// Routengruppen ((name)/) tauchen in der Adresse nicht auf — ihre Kinder
// zaehlen wie direkte Unterordner.
function staticSegments() {
  const isDir = p => statSync(p).isDirectory();
  const children = dir => readdirSync(dir).filter(name => isDir(join(dir, name)));
  const out = {};
  for (const route of GATED_ROUTES) {
    const dir = join(ROOT, 'app', route);
    if (!existsSync(dir)) continue;
    const names = new Set();
    for (const name of children(dir)) {
      if (/^\(.+\)$/.test(name)) {
        for (const inner of children(join(dir, name))) if (!/^[[(_@]/.test(inner)) names.add(inner);
      } else if (!/^[[(_@]/.test(name)) {
        names.add(name);
      }
    }
    out[route] = [...names].sort();
  }
  return out;
}

export function buildKnownIds() {
  const warnings = [];
  let currentSet = null;
  try {
    currentSet = readJson('public/tft-set.json').setNumber;
  } catch (e) {
    warnings.push(`tft-set.json: ${e.message}`);
  }

  const sets = readdirSync(resolve(ROOT, 'public'))
    .map(f => /^tft-assets-(\d+)\.json$/.exec(f)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);

  const units = new Set(), items = new Set(), traits = new Set();
  const bundles = {};
  for (const set of sets) {
    try {
      const bundle = readJson(`public/tft-assets-${set}.json`);
      bundles[set] = bundle;
      for (const id of Object.keys(bundle.champions || {})) units.add(id);
      for (const id of Object.keys(bundle.items || {})) items.add(id);
      for (const [id, trait] of Object.entries(bundle.traits || {})) {
        traits.add(id);
        // Trait-Liste und Unit-Seiten verlinken den Anzeigenamen; die Seite
        // zeigt unter beiden Adressen dasselbe (E4 im SEO-Plan).
        if (typeof trait?.name === 'string' && trait.name) traits.add(trait.name);
      }
    } catch (e) {
      warnings.push(`tft-assets-${set}.json: ${e.message}`);
    }
  }

  // Kennungen, die im laufenden Set neu auftauchen koennen, bevor das Bundle
  // sie kennt (B-Patch, neues Item): TFT<Set>_ plus die Praefixe ohne
  // Set-Nummer (DA_, TFT_) aus dem juengsten Bundle. Alte Sets (TFT17_ …)
  // zaehlen nicht dazu — dort kommt nichts mehr dazu. Fehlt das Bundle des
  // laufenden Sets noch, nimmt das juengste vorhandene dessen Platz ein.
  const prefixes = new Set();
  if (Number.isInteger(currentSet)) prefixes.add(`TFT${currentSet}_`);
  else warnings.push('tft-set.json ohne setNumber');
  const newest = bundles[currentSet] || bundles[Math.max(...Object.keys(bundles).map(Number))];
  for (const id of [...Object.keys(newest?.champions || {}), ...Object.keys(newest?.traits || {})]) {
    const m = /^([A-Za-z]+)_/.exec(id);
    if (m) prefixes.add(`${m[1]}_`);
  }

  const teams = new Set();
  try {
    const raw = readJson('public/pro-teams.json');
    for (const t of Array.isArray(raw) ? raw : raw.teams || []) {
      if (typeof t?.id === 'string' && t.id) teams.add(t.id);
    }
  } catch (e) {
    warnings.push(`pro-teams.json: ${e.message}`);
  }

  // Steht tft-set.json schon auf dem naechsten Set, das Bundle aber noch
  // nicht da (der Set-Wechsel kommt taeglich automatisch, das Bundle erst mit
  // dem Samstagslauf): dann ist die Liste fuer das neue Set wertlos und wuerde
  // dessen echte Seiten tagelang 404 antworten lassen. Leere Listen = die
  // Pruefung laesst alle TFT-Detailadressen durch, bis das Bundle da ist.
  if (Number.isInteger(currentSet) && !bundles[currentSet]) {
    units.clear();
    items.clear();
    traits.clear();
    warnings.push(`tft-assets-${currentSet}.json fehlt — TFT-Detailadressen ungeprueft, bis es da ist`);
  }

  const sorted = s => [...s].sort();
  return {
    data: {
      currentSet: Number.isInteger(currentSet) ? currentSet : null,
      sets: Object.keys(bundles).map(Number),
      plausiblePrefixes: sorted(prefixes),
      units: sorted(units),
      items: sorted(items),
      traits: sorted(traits),
      teams: sorted(teams),
      staticSegments: staticSegments(),
    },
    warnings,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let data = EMPTY;
  try {
    const built = buildKnownIds();
    data = built.data;
    for (const w of built.warnings) console.warn(`[build-known-ids] Warnung: ${w}`);
  } catch (e) {
    console.warn(`[build-known-ids] Warnung: ${e.message} — leere Liste, die 404-Pruefung laesst alles durch`);
  }
  try {
    mkdirSync(dirname(DST), { recursive: true });
    writeFileSync(DST, JSON.stringify(data) + '\n');
    const seg = Object.entries(data.staticSegments).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.join('/')}`).join(', ');
    console.log(`[build-known-ids] Set ${data.currentSet}, Bundles ${data.sets.join('/')}: ${data.units.length} Units, ${data.items.length} Items, ${data.traits.length} Traits, ${data.teams.length} Teams, Praefixe ${data.plausiblePrefixes.join(' ')}; feste Unterseiten ${seg || '–'}`);
  } catch (e) {
    // Auch das darf den aufrufenden Build/Install nicht kippen.
    console.warn(`[build-known-ids] Warnung: ${DST} nicht schreibbar: ${e.message}`);
  }
}
