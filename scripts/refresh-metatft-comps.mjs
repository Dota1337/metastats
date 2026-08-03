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

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function getJson(path) {
  const res = await fetch(`${BASE}/${path}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
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

  const payload = {
    set,
    source: 'metatft.com (tft-comps-api)',
    clusterId,
    fetchedAt: new Date().toISOString(),
    sourceUpdated: data.updated ? new Date(data.updated).toISOString() : null,
    comps,
  };

  if (DRY_RUN) {
    console.log('  [dry-run] nichts geschrieben');
    console.log('  Beispiel:', JSON.stringify(comps[0]).slice(0, 300));
    return;
  }

  writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
  console.log(`  -> public/tft-metatft-comps-${set}.json (${comps.length} Comps, zuvor ${previous})`);
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
