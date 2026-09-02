#!/usr/bin/env node
/**
 * Prueft infra/api-map.json auf Bezuege, die ins Leere zeigen.
 *
 * Getrennt von scripts/build-api-map.mjs --check, weil die beiden zwei
 * verschiedene Fragen stellen — dieselbe Trennung wie bei system-map:
 *   • `build-api-map.mjs --check`  : ist die Karte noch aktuell?
 *   • dieses Skript               : ist die Karte in sich stimmig?
 *
 * Eine Karte kann taufrisch und trotzdem kaputt sein: eine Route ruft eine
 * Datenbank-Funktion auf, die in keiner Migration steht. Dann ist nicht die
 * Karte falsch, sondern der Code — und genau das soll hier auffallen, bevor
 * es als 404 in der Live-Seite auffaellt.
 *
 * Usage: node scripts/check-api-map.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_PATH = resolve(ROOT, 'infra', 'api-map.json');

/**
 * Tabellen, die die Seite benutzt, die aber in keiner Migration angelegt
 * werden. Alle fuenf stammen aus der LoL-Zeit und wurden direkt in Supabase
 * erzeugt, bevor es den Migrations-Ordner gab. Sie stehen hier namentlich,
 * damit der Check nicht dauerhaft meckert — und damit auffaellt, wenn eine
 * SECHSTE dazukommt: dann ist gerade jemand am Migrations-Ordner vorbei.
 */
const KNOWN_UNDECLARED_TABLES = new Set([
  'champion_stats',
  'market_value_history',
  'players',
  'ranked_stats',
  'tft_position_unit_cell',
]);

if (!existsSync(MAP_PATH)) {
  console.error('✗ infra/api-map.json fehlt — `npm run build:api-map` laufen lassen.');
  process.exit(1);
}

const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
const ids = new Set(map.nodes.map(n => n.id));
const problems = [];
const notes = [];

// 1) Jede Kante muss an beiden Enden auf einen vorhandenen Knoten zeigen.
for (const e of map.edges) {
  if (!ids.has(e.from)) problems.push(`Kante zeigt von einem unbekannten Knoten: ${e.from} -> ${e.to}`);
  if (!ids.has(e.to)) problems.push(`Kante zeigt auf einen unbekannten Knoten: ${e.from} -> ${e.to}`);
}

// 2) Jede aufgerufene Datenbank-Funktion muss in einer Migration stehen.
//    Fehlt sie, antwortet Supabase zur Laufzeit mit 404 — der Aufruf ist tot.
for (const n of map.nodes) {
  if (n.kind === 'rpc' && !n.declared) {
    problems.push(`Datenbank-Funktion ${n.label} wird aufgerufen, steht aber in keiner Migration`);
  }
}

// 3) Tabellen ohne Migration: nur die fuenf bekannten sind in Ordnung.
for (const n of map.nodes) {
  if (n.kind === 'table' && !n.declared && !KNOWN_UNDECLARED_TABLES.has(n.label)) {
    problems.push(`Tabelle ${n.label} wird benutzt, steht aber in keiner Migration`);
  }
}

// 4) Jede Route-Datei aus der Karte muss es noch geben.
for (const n of map.nodes) {
  if (n.kind === 'route' && n.file && !existsSync(resolve(ROOT, n.file))) {
    problems.push(`Route ${n.label}: Datei ${n.file} existiert nicht mehr`);
  }
}

// 5) Routen ohne jede Datenquelle sind kein Fehler (Login, Cache-Leerung), aber
//    einen Hinweis wert — hier faellt auf, wenn eine Route ihre Anbindung
//    verliert, ohne dass es jemand merkt.
const withEdges = new Set(map.edges.map(e => e.from));
const orphans = map.nodes.filter(n => n.kind === 'route' && !withEdges.has(n.id)).map(n => n.label);
if (orphans.length) notes.push(`Routen ohne Datenquelle: ${orphans.join(', ')}`);

if (map.unresolved.length) {
  notes.push(`Nicht aufloesbar (Name kommt zur Laufzeit): ${map.unresolved.map(u => u.node).join(', ')}`);
}

for (const n of notes) console.log(`  · ${n}`);

if (problems.length) {
  console.error(`✗ api-map: ${problems.length} Problem(e)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`✓ api-map stimmig (${map.counts.routes} Routen, ${map.counts.edges} Kanten, ` +
  `${map.counts.tables} Tabellen, ${map.counts.rpcs} Funktionen, ${map.counts.files} Dateien)`);
