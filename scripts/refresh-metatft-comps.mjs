#!/usr/bin/env node
/**
 * Holt die Comp-Daten von MetaTFT und schreibt public/tft-metatft-comps-{set}.json.
 *
 * Warum MetaTFT statt tftacademy (Entscheidung 2026-08-04): tftacademy pflegt
 * seine Guides redaktionell und deckte damit nur 38 Comps ab — 47 % unserer
 * Top-Familien nach Spielvolumen, Tendenz fallend, weil das Meta wandert und
 * die Redaktion nicht nachzieht. MetaTFT clustert automatisch aus Match-Daten:
 * 69 Comps, alle mit >=500 Spielen, alle Felder vollständig befüllt.
 *
 * Geprüft wurde vorher, ob wir die Felder selbst ableiten können — nein:
 *   • difficulty  Gruppenmittel korrelieren zwar (Ø Level 8,13/8,36/8,88 für
 *                 EASY/MEDIUM/HARD), im Einzelfall überlappen die Klassen aber
 *                 so stark, dass jede Schwelle danebenliegt.
 *   • earlyComp   nur 19 Familien haben >=30 früh beendete Spiele — dünner als
 *                 die Quelle, die wir ersetzen wollten.
 *   • augments    Riot liefert das Feld seit Mitte 2026 nicht mehr; verifiziert
 *                 an 1.182.847 Match-Zeilen der letzten 7 Tage: 0 % befüllt.
 *
 * Endpunkte (aus dem Frontend-Bundle ermittelt, kein offizieller Vertrag —
 * deshalb prüft der Lauf jede Annahme und bricht laut ab statt still Müll zu
 * schreiben):
 *   /tft-comps-api/latest_cluster_id    aktuelle Cluster-Generation
 *   /tft-comps-api/comps_data           Comps + Stats + difficulty + levelling
 *   /tft-comps-api/comp_augment_tiers   Augment-Empfehlungen je Comp
 *
 * Usage:
 *   node scripts/refresh-metatft-comps.mjs
 *   node scripts/refresh-metatft-comps.mjs --dry-run
 *   node scripts/refresh-metatft-comps.mjs --force   # Floor-Check übergehen
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFamilyMap } from './lib/metatft-cluster-family.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');

const BASE = 'https://api-hc.metatft.com/tft-comps-api';
// Höflicher, identifizierbarer User-Agent statt Browser-Tarnung.
const UA = 'metastats.gg comp-importer (+https://metastats.gg)';

// Mindestzahl Comps. Liefert die Quelle weniger, ist etwas kaputt — dann lieber
// den alten Stand behalten als die Seite mit einer Rumpfliste zu füllen.
const MIN_COMPS = 40;
const MIN_GAMES = 200;

// Zeitbudget. Der Lauf hängt an einem fremden Dienst, der uns nichts zusichert;
// ohne Deckel blockiert ein hängender Endpunkt den ganzen Workflow-Slot.
const CALL_TIMEOUT_MS = 15_000;
const TOTAL_BUDGET_MS = 5 * 60_000;
const startedAt = Date.now();
const budgetLeft = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

async function getJson(path) {
  const res = await fetch(`${BASE}/${path}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const json = await res.json();
  // Die API antwortet auf falsche Parameter mit HTTP 200 und einem error-Feld
  // im Body — `comp_details` ohne gültiges Paar liefert 200 mit
  // {"error":"Please request details for a single comp"}. Ein reiner
  // res.ok-Check würde das als Erfolg durchwinken und leere Felder schreiben.
  if (json && typeof json === 'object' && typeof json.error === 'string') {
    throw new Error(`${path}: API meldet "${json.error}" (HTTP ${res.status})`);
  }
  return json;
}

/** Unser aktuelles Set — der Import darf niemals Daten des falschen Sets schreiben. */
function currentSet() {
  const p = resolve(ROOT, 'public', 'tft-set.json');
  if (!existsSync(p)) throw new Error('public/tft-set.json fehlt — Set nicht bestimmbar');
  const j = JSON.parse(readFileSync(p, 'utf8'));
  const n = j.set ?? j.setNumber ?? j.current;
  if (!Number.isFinite(Number(n))) throw new Error(`Set aus tft-set.json nicht lesbar: ${JSON.stringify(j).slice(0, 120)}`);
  return Number(n);
}

/** "TFT17_Aatrox, TFT17_Jax" -> ["TFT17_Aatrox", "TFT17_Jax"] */
const splitList = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
/** Die Detail-Endpunkte trennen mit "&" statt mit Komma. */
const splitAmpList = (s) => String(s || '').split('&').map(x => x.trim()).filter(Boolean);

// Wie viele Einträge je Detail-Feld wir behalten. Die Rohantwort ist rund
// 340 KB pro Cluster; über 69 Cluster wären das ~23 MB in einer Datei, die der
// Browser beim Seitenaufruf zieht. Gerendert wird davon eine Handvoll Zeilen.
const KEEP_EARLY_OPTIONS = 3;
const KEEP_CAROUSEL = 6;

/**
 * Holt die Detailseite eines Clusters und behält davon, was die UI zeigt.
 *
 * `unit_stats` und `positioning` werden bewusst reduziert statt roh übernommen:
 * beide zusammen sind ~46 KB je Cluster und werden derzeit nicht gerendert. Wir
 * behalten die Star-Verteilung der Carry-Units und je Unit die meistgespielte
 * Zelle — genug, um später etwas daraus zu bauen, ohne 3 MB totes Gewicht in
 * den Lesepfad zu legen.
 */
async function fetchCompDetails(compId, generation, carries) {
  const raw = await getJson(`comp_details?comp=${compId}&cluster_id=${generation}`);
  const d = raw?.results || {};

  // early_options ist nach Level gruppiert ("4".."7"); Level 4 ist das Opener-
  // Board, das tftacademys earlyComp gemeint hat.
  const early = (d.early_options?.['4'] || [])
    .slice(0, KEEP_EARLY_OPTIONS)
    .map(o => ({
      units: splitAmpList(o.unit_list),
      count: o.count ?? null,
      avg: o.avg ?? null,
      win: o.win ?? null,
    }))
    .filter(o => o.units.length > 0);

  const carousel = (d.first_carousel || [])
    .slice(0, KEEP_CAROUSEL)
    .map(x => ({ item: x.items, count: x.count ?? null, avg: x.avg ?? null }))
    .filter(x => x.item);

  const levels = (d.levels || [])
    .filter(l => Number(l.level) >= 4 && l.stage)
    .map(l => ({ level: Number(l.level), stage: String(l.stage), round: String(l.round ?? ''), count: l.count ?? null }));

  // Je Unit die meistgespielte Zelle (0-basiert wie PositionHeatmap erwartet:
  // cell_1 ist Index 0).
  const positions = {};
  for (const [unit, entry] of Object.entries(d.positioning?.units || {})) {
    const best = (entry?.positions || [])[0];
    if (!best?.cell) continue;
    const idx = Number(String(best.cell).split('_')[1]);
    if (!Number.isFinite(idx)) continue;
    positions[unit] = { cell: idx - 1, count: best.count ?? null };
  }

  // Star-Verteilung nur für die Carrys — für die 60+ übrigen Units der Comp
  // interessiert sie niemanden und sie macht den Löwenanteil der 29 KB aus.
  const carrySet = new Set(carries);
  const carryStars = {};
  for (const u of d.unit_stats || []) {
    if (!carrySet.has(u.unit)) continue;
    carryStars[u.unit] = (u.tiers || []).map(t => ({ star: t.tier, pcnt: t.pcnt, avg: t.avg }));
  }

  return { early, carousel, levels, positions, carryStars, rerolls: d.rerolls || null };
}

async function main() {
  const set = currentSet();
  console.log(`=== MetaTFT-Comps für Set ${set} ===`);

  const [idRes, data, augRes] = await Promise.all([
    getJson('latest_cluster_id'),
    getJson('comps_data'),
    getJson('comp_augment_tiers'),
  ]);

  // Set-Gate: MetaTFT liefert "TFTSet17". Nach einem Set-Wechsel darf der Lauf
  // nicht stumm die Daten des alten Sets in die neue Datei schreiben.
  const remoteSet = Number(String(data.tft_set || '').replace(/\D+/g, ''));
  if (remoteSet !== set) {
    throw new Error(
      `Set-Mismatch: wir sind auf Set ${set}, MetaTFT liefert "${data.tft_set}". `
      + 'Import abgebrochen — erst nach dem Set-Wechsel drüben erneut laufen lassen.',
    );
  }

  const clusterId = idRes.cluster_id ?? data.cluster_id;
  const details = data?.results?.data?.cluster_details;
  const games = data?.results?.games;
  if (!details || !games) throw new Error('Antwortstruktur unerwartet — cluster_details/games fehlen');

  const augByCluster = augRes?.results || {};

  const comps = [];
  for (const [key, c] of Object.entries(details)) {
    const g = games[key]?.[0];
    const count = g?.count ?? 0;
    if (count < MIN_GAMES) continue;

    comps.push({
      id: key,
      name: c.name_string || null,
      units: splitList(c.units_string),
      traits: splitList(c.traits_string),
      games: count,
      avgPlacement: g?.avg ?? null,
      // MetaTFTs difficulty ist ein zentrierter Wert (beobachtet -0,21 … +0,12),
      // KEINE EASY/MEDIUM/HARD-Stufe. Roh übernehmen statt in Klassen zu pressen —
      // die Einteilung gehört in die Darstellung, nicht in den Import.
      difficulty: typeof c.difficulty === 'number' ? c.difficulty : null,
      // "lvl 5".."lvl 7", "Fast 8", "Fast 9", "Standard" — die Level-Strategie
      // und damit das, was tftacademys earlyComp gemeint hat.
      levelling: c.levelling || null,
      itemNames: Array.isArray(c.top_itemNames) ? c.top_itemNames : [],
      builds: Array.isArray(c.builds) ? c.builds : [],
      augments: Array.isArray(augByCluster[key]?.augments)
        ? augByCluster[key].augments.map(a => ({ id: a.id, tier: a.tier }))
        : [],
    });
  }

  comps.sort((a, b) => b.games - a.games);

  console.log(`  ${comps.length} Comps mit >=${MIN_GAMES} Spielen`);
  console.log(`  mit Augments: ${comps.filter(c => c.augments.length).length}`);
  console.log(`  mit levelling: ${comps.filter(c => c.levelling).length}`);

  const outPath = resolve(ROOT, 'public', `tft-metatft-comps-${set}.json`);
  let previous = 0;
  if (existsSync(outPath)) {
    try { previous = JSON.parse(readFileSync(outPath, 'utf8')).comps?.length || 0; } catch { /* egal */ }
  }

  if (comps.length < MIN_COMPS && !FORCE) {
    throw new Error(`nur ${comps.length} Comps (min ${MIN_COMPS}) — Datei bleibt unverändert`);
  }
  if (previous > 0 && comps.length < previous * 0.7 && !FORCE) {
    throw new Error(`${comps.length} Comps gegenüber ${previous} zuvor (<70 %) — Datei bleibt unverändert`);
  }

  // Familien-Map: welche unserer `<trait>__<carry>`-Familien welchen Cluster
  // als Guide bekommt. Wird im selben Lauf gebaut, weil sie an die Cluster-IDs
  // dieses Laufs gebunden ist — die IDs tragen die Generation im Präfix
  // (409058 = Generation 409), beim nächsten Bump sind alle 69 neu. Eine
  // getrennt gepflegte Map wäre danach nicht teilweise, sondern vollständig
  // falsch, und zwar ohne dass es jemandem auffiele.
  const { map: familyMap, collisions, unclassified } = buildFamilyMap(comps, { currentSet: set });
  console.log(`  Familien-Map: ${Object.keys(familyMap).length} Familien`
    + `, ${collisions.length} mit mehreren Clustern`
    + `, ${unclassified.length} Cluster ohne Familie`);

  // Details je Cluster. Eigene Phase mit eigenem Budget: sie ist teuer (ein
  // Call pro Cluster) und der Rest der Datei ist ohne sie brauchbar.
  const carriesByCluster = new Map();
  for (const [familyKey, id] of Object.entries(familyMap)) {
    const carry = familyKey.split('__')[1];
    if (!carriesByCluster.has(id)) carriesByCluster.set(id, new Set());
    if (carry) carriesByCluster.get(id).add(carry);
  }

  const compDetails = {};
  let detailsOk = 0;
  let detailsFail = 0;
  let budgetHit = false;
  for (const c of comps) {
    if (budgetLeft() < CALL_TIMEOUT_MS) { budgetHit = true; break; }
    try {
      compDetails[c.id] = await fetchCompDetails(c.id, clusterId, [...(carriesByCluster.get(c.id) || [])]);
      detailsOk++;
    } catch (err) {
      detailsFail++;
      if (detailsFail <= 3) console.warn(`  ! Details für ${c.id}: ${err.message}`);
    }
  }
  if (budgetHit) console.warn(`  ! Zeitbudget erreicht — Details nur für ${detailsOk} von ${comps.length} Clustern`);
  console.log(`  Details: ${detailsOk} geholt, ${detailsFail} fehlgeschlagen`);

  // Details-Übernahme aus dem Vorlauf, wenn die Detail-Phase nichts brachte.
  // Die Liste ist dann trotzdem frisch — ohne diesen Zweig würde ein Ausfall
  // des Detail-Endpunkts die Guides leeren, obwohl die Comps stimmen.
  let carriedForward = 0;
  if (detailsOk === 0 && existsSync(outPath)) {
    try {
      const prev = JSON.parse(readFileSync(outPath, 'utf8'));
      if (prev.clusterId === clusterId && prev.details) {
        Object.assign(compDetails, prev.details);
        carriedForward = Object.keys(prev.details).length;
        console.warn(`  ! Details aus dem Vorlauf übernommen (${carriedForward}) — gleiche Generation ${clusterId}`);
      } else {
        console.warn('  ! Keine Details und keine übernehmbaren aus dem Vorlauf (Generation gewechselt)');
      }
    } catch { /* Vorlauf unlesbar — dann eben ohne Details */ }
  }

  const payload = {
    set,
    source: 'metatft.com (tft-comps-api)',
    clusterId,
    fetchedAt: new Date().toISOString(),
    sourceUpdated: data.updated ? new Date(data.updated).toISOString() : null,
    detailsCarriedForward: carriedForward > 0,
    familyMap,
    comps,
    details: compDetails,
  };

  if (DRY_RUN) {
    console.log('  [dry-run] nichts geschrieben');
    console.log(`  Größe: ${(JSON.stringify(payload).length / 1024).toFixed(0)} KB roh`);
    return;
  }

  // Atomar schreiben: erst vollständig danebenlegen, dann umbenennen. Sonst
  // kann ein Abbruch mitten im Schreiben eine halbe Datei hinterlassen, die
  // der Client als gültiges JSON nicht mehr parsen kann.
  const tmpPath = `${outPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + '\n');
  renameSync(tmpPath, outPath);
  console.log(`  -> public/tft-metatft-comps-${set}.json (${comps.length} Comps, zuvor ${previous}, `
    + `${(JSON.stringify(payload).length / 1024).toFixed(0)} KB)`);
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
